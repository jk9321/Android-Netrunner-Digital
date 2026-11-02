import { GameState } from '../core/types/state';
import { SideCode } from '../core/types/card';

const ENABLED_STORAGE_KEY = 'netrunner.music';
const VOLUME_STORAGE_KEY = 'netrunner.music.volume';

let enabledCache = true;
let volumeCache = 0.6;

export function musicEnabled(): boolean {
  try {
    const val = typeof window !== 'undefined' ? window.localStorage.getItem(ENABLED_STORAGE_KEY) : null;
    return val !== null ? val !== 'off' : enabledCache;
  } catch {
    return enabledCache;
  }
}

export function setMusicEnabled(on: boolean): void {
  enabledCache = on;
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ENABLED_STORAGE_KEY, on ? 'on' : 'off');
    }
  } catch {
    // Not saved
  }
  applyMuteState();
}

export function musicVolume(): number {
  try {
    const v = typeof window !== 'undefined' ? window.localStorage.getItem(VOLUME_STORAGE_KEY) : null;
    return v !== null ? Math.max(0, Math.min(1, parseFloat(v))) : volumeCache;
  } catch {
    return volumeCache;
  }
}

export function setMusicVolume(vol: number): void {
  const clamped = Math.max(0, Math.min(1, vol));
  volumeCache = clamped;
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(VOLUME_STORAGE_KEY, clamped.toString());
    }
  } catch {
    // Not saved
  }
  applyVolume();
}

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;

let padGain: GainNode | null = null;
let bassGain: GainNode | null = null;
let arpGain: GainNode | null = null;
let climaxGain: GainNode | null = null;

let isPlaying = false;
let timerId: number | null = null;
let nextStepTime = 0;
let currentStep = 0; // 0 to 63 (4 bars x 16 steps)

let currentSide: SideCode = 'runner';
let currentCorpScore = 0;
let currentRunnerScore = 0;
let isGameOver = false;

// 4-Bar Harmonic Progressions
const RUNNER_PROGRESSION = [
  { name: 'Dm9', notes: [146.83, 220.00, 261.63, 329.63, 349.23], bass: 73.42 },
  { name: 'Bbmaj7', notes: [116.54, 174.61, 220.00, 261.63, 349.23], bass: 58.27 },
  { name: 'Gm7', notes: [98.00, 146.83, 220.00, 261.63, 293.66], bass: 49.00 },
  { name: 'C9sus', notes: [130.81, 196.00, 261.63, 293.66, 392.00], bass: 65.41 },
];

const CORP_PROGRESSION = [
  { name: 'Cmaj9', notes: [130.81, 196.00, 246.94, 293.66, 329.63], bass: 65.41 },
  { name: 'Em7', notes: [164.81, 196.00, 246.94, 293.66, 392.00], bass: 82.41 },
  { name: 'Fmaj7#11', notes: [174.61, 220.00, 246.94, 329.63, 369.99], bass: 87.31 },
  { name: 'Gsus4', notes: [196.00, 261.63, 293.66, 392.00, 440.00], bass: 98.00 },
];

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      ctx = new AudioCtx();

      masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(musicEnabled() ? musicVolume() : 0.0001, ctx.currentTime);
      masterGain.connect(ctx.destination);

      padGain = ctx.createGain();
      bassGain = ctx.createGain();
      arpGain = ctx.createGain();
      climaxGain = ctx.createGain();

      padGain.connect(masterGain);
      bassGain.connect(masterGain);
      arpGain.connect(masterGain);
      climaxGain.connect(masterGain);

      updateLayerGains();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function applyMuteState(): void {
  if (!ctx || !masterGain) return;
  const target = musicEnabled() ? musicVolume() : 0.0001;
  masterGain.gain.setTargetAtTime(target, ctx.currentTime, 0.05);
}

function applyVolume(): void {
  if (!ctx || !masterGain || !musicEnabled()) return;
  masterGain.gain.setTargetAtTime(musicVolume(), ctx.currentTime, 0.05);
}

function updateLayerGains(): void {
  if (!ctx || !padGain || !bassGain || !arpGain || !climaxGain) return;
  const now = ctx.currentTime;

  if (isGameOver) {
    padGain.gain.setTargetAtTime(0.0001, now, 0.2);
    bassGain.gain.setTargetAtTime(0.0001, now, 0.2);
    arpGain.gain.setTargetAtTime(0.0001, now, 0.2);
    climaxGain.gain.setTargetAtTime(0.0001, now, 0.2);
    return;
  }

  const maxScore = Math.max(currentCorpScore, currentRunnerScore);
  const isTightClimax = (currentCorpScore >= 5 && currentRunnerScore >= 5) || maxScore === 6;

  // Tier 1: Pad always active
  padGain.gain.setTargetAtTime(0.24, now, 0.4);

  // Tier 2: Bass activates at >= 3 points
  const bassOn = maxScore >= 3;
  bassGain.gain.setTargetAtTime(bassOn ? 0.35 : 0.0001, now, 0.4);

  // Tier 3: Arp activates at >= 5 points
  const arpOn = maxScore >= 5;
  arpGain.gain.setTargetAtTime(arpOn ? 0.28 : 0.0001, now, 0.4);

  // Tier 4: Frenetic Climax
  const climaxOn = isTightClimax && maxScore >= 5;
  climaxGain.gain.setTargetAtTime(climaxOn ? 0.48 : 0.0001, now, 0.3);
}

function scheduleStep(step: number, time: number, bpm: number): void {
  const ac = audio();
  if (!ac || !padGain || !bassGain || !arpGain || !climaxGain) return;

  const barIndex = Math.floor(step / 16);
  const stepInBar = step % 16;
  const barDuration = (60 / bpm) * 4;

  const progression = currentSide === 'runner' ? RUNNER_PROGRESSION : CORP_PROGRESSION;
  const currentChord = progression[barIndex];

  // 1. Layer 1: Evolving Pad & Chimes
  if (stepInBar === 0) {
    playEvolvingChord(ac, currentChord.notes, time, barDuration, padGain, currentSide === 'runner' ? 'sawtooth' : 'sine');
  }
  if (stepInBar === 10 && (barIndex === 1 || barIndex === 3)) {
    const chimeFreq = currentSide === 'runner' ? 880 : 1046.5;
    playSparseChime(ac, chimeFreq, time, padGain);
  }

  // 2. Layer 2: Bass Pulse (Tier 2+)
  if (stepInBar % 2 === 0) {
    if (currentSide === 'runner') {
      const bassRoot = currentChord.bass;
      const isOffbeat = stepInBar % 4 === 2;
      const freq = isOffbeat ? bassRoot * 1.5 : bassRoot;
      playBass(ac, freq, time, 0.16, bassGain, 'sawtooth', 420);
    } else {
      if (stepInBar === 0 || stepInBar === 8) {
        playBass(ac, currentChord.bass, time, 0.42, bassGain, 'sine', 200);
      }
      playClockTick(ac, time, bassGain);
    }
  }

  // 3. Layer 3: 16th-Note Arpeggiator (Tier 3+)
  if (currentSide === 'runner') {
    const arpNotes = [
      currentChord.notes[0] * 2,
      currentChord.notes[1] * 2,
      currentChord.notes[2] * 2,
      currentChord.notes[3] * 2,
      currentChord.notes[4] * 2,
      currentChord.notes[2] * 2,
      currentChord.notes[1] * 2,
      currentChord.notes[0] * 2,
    ];
    const note = arpNotes[stepInBar % arpNotes.length];
    playPluck(ac, note, time, 0.11, arpGain, 'triangle');
  } else {
    if (stepInBar % 2 === 0) {
      const corpNotes = currentChord.notes.map(n => n * 2);
      const idx = (stepInBar / 2) % corpNotes.length;
      playPluck(ac, corpNotes[idx], time, 0.2, arpGain, 'sine', true);
    }
  }

  // 4. Layer 4: Climax (Tier 4)
  if (currentSide === 'runner') {
    if (stepInBar % 4 === 0) {
      playKick(ac, time, climaxGain);
    }
    if (stepInBar % 2 === 1) {
      playNoiseTick(ac, time, climaxGain, 0.05);
    }
  } else {
    // Corp Containment Alert Protocol
    if (stepInBar % 4 === 0) {
      playKick(ac, time, climaxGain, 130, 45);
    }
    const alarmPattern = [739.99, 554.37, 739.99, 987.77, 739.99, 554.37, 739.99, 880.00];
    const alarmFreq = alarmPattern[stepInBar % alarmPattern.length];
    playAlarmSynth(ac, alarmFreq, time, climaxGain);
    if (stepInBar % 2 === 1) {
      playClockTick(ac, time, climaxGain, 1600, 0.08);
    }
  }
}

function stepScheduler(): void {
  const ac = audio();
  if (!ac) return;
  const bpm = currentSide === 'runner' ? 124 : 108;
  const stepDuration = 60 / bpm / 4;

  while (nextStepTime < ac.currentTime + 0.12) {
    scheduleStep(currentStep, nextStepTime, bpm);
    nextStepTime += stepDuration;
    currentStep = (currentStep + 1) % 64;
  }
}

// Synth Voices
function playEvolvingChord(ac: AudioContext, freqs: number[], time: number, dur: number, destNode: AudioNode, type: OscillatorType = 'sawtooth'): void {
  freqs.forEach((f, i) => {
    [-3.5, 3.5].forEach(detune => {
      const osc = ac.createOscillator();
      const filter = ac.createBiquadFilter();
      const gain = ac.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(f, time);
      osc.detune.setValueAtTime(detune, time);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(450, time);
      filter.frequency.linearRampToValueAtTime(1100 + i * 80, time + dur * 0.5);
      filter.frequency.linearRampToValueAtTime(450, time + dur);

      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(0.025, time + 0.6);
      gain.gain.setValueAtTime(0.025, time + dur - 0.6);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);

      osc.connect(filter).connect(gain).connect(destNode);
      osc.start(time);
      osc.stop(time + dur + 0.05);
    });
  });
}

function playSparseChime(ac: AudioContext, freq: number, time: number, destNode: AudioNode): void {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, time);

  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(0.035, time + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.85);

  osc.connect(gain).connect(destNode);
  osc.start(time);
  osc.stop(time + 0.9);
}

function playBass(ac: AudioContext, freq: number, time: number, dur: number, destNode: AudioNode, type: OscillatorType = 'sawtooth', cutoff = 350): void {
  const osc = ac.createOscillator();
  const filter = ac.createBiquadFilter();
  const gain = ac.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, time);

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(cutoff, time);

  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(0.14, time + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);

  osc.connect(filter).connect(gain).connect(destNode);
  osc.start(time);
  osc.stop(time + dur + 0.02);
}

function playPluck(ac: AudioContext, freq: number, time: number, dur: number, destNode: AudioNode, type: OscillatorType = 'triangle', harmonic = false): void {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, time);

  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(0.09, time + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);

  osc.connect(gain).connect(destNode);
  osc.start(time);
  osc.stop(time + dur + 0.02);

  if (harmonic) {
    const overtone = ac.createOscillator();
    const otGain = ac.createGain();
    overtone.type = 'sine';
    overtone.frequency.setValueAtTime(freq * 2.0, time);
    otGain.gain.setValueAtTime(0.03, time);
    otGain.gain.exponentialRampToValueAtTime(0.0001, time + dur * 0.7);
    overtone.connect(otGain).connect(destNode);
    overtone.start(time);
    overtone.stop(time + dur + 0.02);
  }
}

function playAlarmSynth(ac: AudioContext, freq: number, time: number, destNode: AudioNode): void {
  const osc = ac.createOscillator();
  const filter = ac.createBiquadFilter();
  const gain = ac.createGain();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(freq, time);

  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1800, time);
  filter.Q.value = 2.8;

  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(0.14, time + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.095);

  osc.connect(filter).connect(gain).connect(destNode);
  osc.start(time);
  osc.stop(time + 0.1);
}

function playKick(ac: AudioContext, time: number, destNode: AudioNode, startFreq = 110, endFreq = 35): void {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(startFreq, time);
  osc.frequency.exponentialRampToValueAtTime(endFreq, time + 0.12);

  gain.gain.setValueAtTime(0.28, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.15);

  osc.connect(gain).connect(destNode);
  osc.start(time);
  osc.stop(time + 0.16);
}

function playClockTick(ac: AudioContext, time: number, destNode: AudioNode, freq = 800, vol = 0.06): void {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, time);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.5, time + 0.02);

  gain.gain.setValueAtTime(vol, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.02);

  osc.connect(gain).connect(destNode);
  osc.start(time);
  osc.stop(time + 0.025);
}

function playNoiseTick(ac: AudioContext, time: number, destNode: AudioNode, vol = 0.04): void {
  const buffer = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.03), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const noise = ac.createBufferSource();
  noise.buffer = buffer;

  const filter = ac.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.setValueAtTime(4500, time);

  const gain = ac.createGain();
  gain.gain.setValueAtTime(vol, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.028);

  noise.connect(filter).connect(gain).connect(destNode);
  noise.start(time);
}

export function startMusic(side: SideCode = 'runner'): void {
  currentSide = side;
  const ac = audio();
  if (!ac) return;

  if (!isPlaying) {
    isPlaying = true;
    currentStep = 0;
    nextStepTime = ac.currentTime + 0.05;
    timerId = window.setInterval(stepScheduler, 25);
  }
  updateLayerGains();
}

export function stopMusic(): void {
  if (timerId !== null) {
    window.clearInterval(timerId);
    timerId = null;
  }
  isPlaying = false;
  if (ctx && masterGain) {
    masterGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.08);
  }
}

export function updateMusic(state: GameState, activeSide: SideCode | null): void {
  currentSide = activeSide ?? (state.activePlayer === 'corp' ? 'corp' : 'runner');
  currentCorpScore = state.corp.score;
  currentRunnerScore = state.runner.score;
  isGameOver = Boolean(state.winner);

  if (isPlaying) {
    updateLayerGains();
  } else if (!isGameOver) {
    startMusic(currentSide);
  }
}

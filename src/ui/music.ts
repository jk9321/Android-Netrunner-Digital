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

// Host (Player) Layers
let padGain: GainNode | null = null;
let bassGain: GainNode | null = null;
let leadGain: GainNode | null = null;

// Opponent Infiltration Layers
let oppTickGain: GainNode | null = null;
let oppInfilGain: GainNode | null = null;
let oppAlarmGain: GainNode | null = null;

// Climax Layer
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
      leadGain = ctx.createGain();
      oppTickGain = ctx.createGain();
      oppInfilGain = ctx.createGain();
      oppAlarmGain = ctx.createGain();
      climaxGain = ctx.createGain();

      padGain.connect(masterGain);
      bassGain.connect(masterGain);
      leadGain.connect(masterGain);
      oppTickGain.connect(masterGain);
      oppInfilGain.connect(masterGain);
      oppAlarmGain.connect(masterGain);
      climaxGain.connect(masterGain);

      updateLayerGains();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function isTabVisible(): boolean {
  if (typeof document === 'undefined') return true;
  return !document.hidden;
}

function applyMuteState(): void {
  if (!ctx || !masterGain) return;
  const shouldPlay = musicEnabled() && isTabVisible();
  const target = shouldPlay ? musicVolume() : 0.0001;
  masterGain.gain.setTargetAtTime(target, ctx.currentTime, 0.05);
}

function applyVolume(): void {
  if (!ctx || !masterGain || !musicEnabled() || !isTabVisible()) return;
  masterGain.gain.setTargetAtTime(musicVolume(), ctx.currentTime, 0.05);
}

function handleVisibilityChange(): void {
  if (typeof document === 'undefined') return;
  if (!document.hidden && ctx) {
    nextStepTime = ctx.currentTime + 0.05;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
  }
  applyMuteState();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

function updateLayerGains(): void {
  if (!ctx || !padGain || !bassGain || !leadGain || !oppTickGain || !oppInfilGain || !oppAlarmGain || !climaxGain) return;
  const now = ctx.currentTime;

  if (isGameOver) {
    padGain.gain.setTargetAtTime(0.0001, now, 0.2);
    bassGain.gain.setTargetAtTime(0.0001, now, 0.2);
    leadGain.gain.setTargetAtTime(0.0001, now, 0.2);
    oppTickGain.gain.setTargetAtTime(0.0001, now, 0.2);
    oppInfilGain.gain.setTargetAtTime(0.0001, now, 0.2);
    oppAlarmGain.gain.setTargetAtTime(0.0001, now, 0.2);
    climaxGain.gain.setTargetAtTime(0.0001, now, 0.2);
    return;
  }

  const myScore = currentSide === 'runner' ? currentRunnerScore : currentCorpScore;
  const oppScore = currentSide === 'runner' ? currentCorpScore : currentRunnerScore;

  // 1. My Home Stems
  // Pad is always active
  padGain.gain.setTargetAtTime(0.26, now, 0.4);

  // My Bass unlocks at myScore >= 3
  const myBassOn = myScore >= 3;
  bassGain.gain.setTargetAtTime(myBassOn ? 0.40 : 0.0001, now, 0.4);

  // My Lead/Ostinato unlocks at myScore >= 5
  const myLeadOn = myScore >= 5;
  leadGain.gain.setTargetAtTime(myLeadOn ? 0.32 : 0.0001, now, 0.4);

  // 2. Opponent Infiltration Stems (Carefully balanced so host stays dominant)
  // Opponent Tick/Texture unlocks at oppScore >= 2
  const oppTickOn = oppScore >= 2;
  oppTickGain.gain.setTargetAtTime(oppTickOn ? 0.16 : 0.0001, now, 0.4);

  // Opponent Melodic Infiltration unlocks at oppScore >= 4
  const oppInfilOn = oppScore >= 4;
  oppInfilGain.gain.setTargetAtTime(oppInfilOn ? 0.18 : 0.0001, now, 0.4);

  // Opponent Alarm/Breach Lead unlocks at oppScore >= 6 or close match (both >= 5)
  const oppAlarmOn = oppScore >= 6 || (oppScore >= 5 && myScore >= 5);
  oppAlarmGain.gain.setTargetAtTime(oppAlarmOn ? 0.24 : 0.0001, now, 0.3);

  // 3. Shared Overdrive Climax Kick (Match point / tight contest)
  const kickOn = (myScore >= 5 && oppScore >= 5) || Math.max(myScore, oppScore) >= 6;
  climaxGain.gain.setTargetAtTime(kickOn ? 0.36 : 0.0001, now, 0.3);
}

function scheduleStep(step: number, time: number, bpm: number): void {
  const ac = audio();
  if (!ac || !padGain || !bassGain || !leadGain || !oppTickGain || !oppInfilGain || !oppAlarmGain || !climaxGain) return;

  const barIndex = Math.floor(step / 16);
  const stepInBar = step % 16;
  const barDuration = (60 / bpm) * 4;

  const homeProgression = currentSide === 'runner' ? RUNNER_PROGRESSION : CORP_PROGRESSION;
  const homeChord = homeProgression[barIndex];

  if (currentSide === 'runner') {
    // ==========================================
    // PERSPECTIVE: RUNNER (Home: D Minor @ 124 BPM)
    // ==========================================
    // 1. My Home Stems (Runner)
    if (stepInBar === 0) {
      playEvolvingChord(ac, homeChord.notes, time, barDuration, padGain, 'sawtooth');
    }
    if (stepInBar % 2 === 0) {
      const bassRoot = homeChord.bass;
      const isOffbeat = stepInBar % 4 === 2;
      playBass(ac, isOffbeat ? bassRoot * 1.5 : bassRoot, time, 0.16, bassGain, 'sawtooth', 420);
    }
    const arpNotes = [
      homeChord.notes[0] * 2,
      homeChord.notes[1] * 2,
      homeChord.notes[2] * 2,
      homeChord.notes[3] * 2,
      homeChord.notes[4] * 2,
      homeChord.notes[2] * 2,
      homeChord.notes[1] * 2,
      homeChord.notes[0] * 2,
    ];
    playPluck(ac, arpNotes[stepInBar % arpNotes.length], time, 0.11, leadGain, 'triangle');

    // 2. Opponent Infiltration Stems (Corp invading Runner audio space, transposed to D minor)
    if (stepInBar % 2 === 0) {
      playClockTick(ac, time, oppTickGain, 980, 0.06);
    }
    if (stepInBar % 4 === 0) {
      const corpGlassNotes = [587.33, 698.46, 880.00, 1046.50]; // D5, F5, A5, C6
      const gIdx = Math.floor(stepInBar / 4) % corpGlassNotes.length;
      playPluck(ac, corpGlassNotes[gIdx], time, 0.28, oppInfilGain, 'sine', true);
    }
    if (stepInBar % 2 === 1) {
      const alarmFreq = stepInBar % 4 === 1 ? 880.00 : 659.25;
      playAlarmSynth(ac, alarmFreq, time, oppAlarmGain, 1900);
    }

    // 3. Climax Kick
    if (stepInBar % 4 === 0) {
      playKick(ac, time, climaxGain, 115, 38);
    }
  } else {
    // ==========================================
    // PERSPECTIVE: CORP (Home: C Lydian @ 108 BPM)
    // ==========================================
    // 1. My Home Stems (Corp)
    if (stepInBar === 0) {
      playEvolvingChord(ac, homeChord.notes, time, barDuration, padGain, 'sine');
    }
    // Moog / SH-101 Corporate Bass on quarter beats (steps 0, 4, 8, 12) with octave bounce on beats 2 & 4
    if (stepInBar % 4 === 0) {
      const isQuarterBeat = stepInBar === 4 || stepInBar === 12;
      const noteFreq = isQuarterBeat ? homeChord.bass * 2.0 : homeChord.bass;
      playCorpMoogBass(ac, noteFreq, time, 0.28, bassGain);
    }
    // Pristine glass ostinato chimes
    if (stepInBar % 2 === 0) {
      const corpNotes = homeChord.notes.map(n => n * 2);
      const idx = Math.floor(stepInBar / 2) % corpNotes.length;
      playPluck(ac, corpNotes[idx], time, 0.25, leadGain, 'sine', true, 0.14);
    }

    // 2. Opponent Infiltration Stems (Runner invading Corp audio space, balanced & tamed)
    // Subtle off-beat glitch noise tick
    if (stepInBar % 4 === 3) {
      playNoiseTick(ac, time, oppTickGain, 0.035);
    }
    // Acid Saw Accent on offbeats
    if (stepInBar === 6 || stepInBar === 14) {
      const acidNotes = [155.56, 196.00, 233.08, 261.63]; // Eb3, G3, Bb3, C4
      const aIdx = barIndex % acidNotes.length;
      playTamedAcidSaw(ac, acidNotes[aIdx], time, 0.16, oppInfilGain);
    }
    // Breach Lead burst on beat 3 (steps 8 to 11)
    if (stepInBar >= 8 && stepInBar <= 11) {
      const runnerBreachNotes = [523.25, 622.25, 783.99, 932.33]; // C5, Eb5, G5, Bb5
      playTamedBreachLead(ac, runnerBreachNotes[stepInBar - 8], time, 0.09, oppAlarmGain);
    }

    // 3. Climax Kick
    if (stepInBar % 4 === 0) {
      playKick(ac, time, climaxGain, 130, 45);
    }
  }
}

function stepScheduler(): void {
  const ac = audio();
  if (!ac) return;
  const bpm = currentSide === 'runner' ? 124 : 108;
  const stepDuration = 60 / bpm / 4;

  if (nextStepTime < ac.currentTime - 0.25) {
    nextStepTime = ac.currentTime + 0.05;
  }

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

function playCorpMoogBass(ac: AudioContext, freq: number, time: number, dur: number, destNode: AudioNode): void {
  // Dual oscillator: Triangle fundamental + subtle Sawtooth 2nd harmonic (audible on laptop speakers)
  const sub = ac.createOscillator();
  const grit = ac.createOscillator();
  const filter = ac.createBiquadFilter();
  const gain = ac.createGain();

  sub.type = 'triangle';
  sub.frequency.setValueAtTime(freq, time);

  grit.type = 'sawtooth';
  grit.frequency.setValueAtTime(freq * 2.0, time); // One octave up for speaker presence

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(550, time);
  filter.frequency.exponentialRampToValueAtTime(220, time + dur);
  filter.Q.value = 2.0;

  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(0.22, time + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);

  const subGain = ac.createGain();
  subGain.gain.value = 0.8;
  const gritGain = ac.createGain();
  gritGain.gain.value = 0.25;

  sub.connect(subGain).connect(filter);
  grit.connect(gritGain).connect(filter);
  filter.connect(gain).connect(destNode);

  sub.start(time);
  grit.start(time);
  sub.stop(time + dur + 0.02);
  grit.stop(time + dur + 0.02);
}

function playTamedAcidSaw(ac: AudioContext, freq: number, time: number, dur: number, destNode: AudioNode): void {
  const osc = ac.createOscillator();
  const filter = ac.createBiquadFilter();
  const gain = ac.createGain();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(freq, time);

  filter.type = 'bandpass';
  filter.Q.value = 2.2;
  filter.frequency.setValueAtTime(700, time);
  filter.frequency.exponentialRampToValueAtTime(320, time + dur);

  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(0.08, time + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);

  osc.connect(filter).connect(gain).connect(destNode);
  osc.start(time);
  osc.stop(time + dur + 0.02);
}

function playTamedBreachLead(ac: AudioContext, freq: number, time: number, dur: number, destNode: AudioNode): void {
  const osc = ac.createOscillator();
  const filter = ac.createBiquadFilter();
  const gain = ac.createGain();

  osc.type = 'triangle'; // Smoother than raw saw, cuts cleanly without masking
  osc.frequency.setValueAtTime(freq, time);

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1400, time);

  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(0.065, time + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);

  osc.connect(filter).connect(gain).connect(destNode);
  osc.start(time);
  osc.stop(time + dur + 0.02);
}

function playPluck(
  ac: AudioContext,
  freq: number,
  time: number,
  dur: number,
  destNode: AudioNode,
  type: OscillatorType = 'triangle',
  harmonic = false,
  customGain = 0.09,
): void {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, time);

  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(customGain, time + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);

  osc.connect(gain).connect(destNode);
  osc.start(time);
  osc.stop(time + dur + 0.02);

  if (harmonic) {
    const overtone = ac.createOscillator();
    const otGain = ac.createGain();
    overtone.type = 'sine';
    overtone.frequency.setValueAtTime(freq * 2.0, time);
    otGain.gain.setValueAtTime(customGain * 0.4, time);
    otGain.gain.exponentialRampToValueAtTime(0.0001, time + dur * 0.7);
    overtone.connect(otGain).connect(destNode);
    overtone.start(time);
    overtone.stop(time + dur + 0.02);
  }
}

function playAlarmSynth(ac: AudioContext, freq: number, time: number, destNode: AudioNode, cutoff = 1800): void {
  const osc = ac.createOscillator();
  const filter = ac.createBiquadFilter();
  const gain = ac.createGain();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(freq, time);

  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(cutoff, time);
  filter.Q.value = 2.5;

  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(0.12, time + 0.012);
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
  applyMuteState();
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
  const newSide = activeSide ?? (state.activePlayer === 'corp' ? 'corp' : 'runner');
  const sideChanged = newSide !== currentSide;
  currentSide = newSide;
  currentCorpScore = state.corp.score;
  currentRunnerScore = state.runner.score;
  isGameOver = Boolean(state.winner);

  if (isPlaying) {
    if (sideChanged) {
      currentStep = 0;
    }
    updateLayerGains();
  } else if (!isGameOver) {
    startMusic(currentSide);
  }
}

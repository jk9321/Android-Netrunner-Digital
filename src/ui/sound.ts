import { GameState, LogEvent } from '../core/types/state';
import { SideCode } from '../core/types/card';

/**
 * Short synthesized sound effects (Web Audio, no audio files). Each action
 * plays the most important sound for what it changed, read from the game
 * state and the events on its new log lines (never from their wording).
 */

type Sound =
  | 'win'
  | 'lose'
  | 'runner_win'
  | 'corp_win'
  | 'deckout'
  | 'concede'
  | 'score'
  | 'steal'
  | 'damage'
  | 'tag'
  | 'run'
  | 'rez'
  | 'access'
  | 'install'
  | 'credit'
  | 'draw'
  | 'click';

const loggedEvent = (event: LogEvent) => (prev: GameState, next: GameState) => next.log.slice(prev.log.length).some(e => e.event === event);
const handSize = (state: GameState) => state.corp.hq.length + state.runner.grip.length;

// Most important first
const RULES: [Sound, (prev: GameState, next: GameState) => boolean][] = [

  ['score', (prev, next) => next.corp.score > prev.corp.score],
  ['steal', (prev, next) => next.runner.score > prev.runner.score],
  ['damage', loggedEvent('damage')],
  ['tag', (prev, next) => next.runner.tags > prev.runner.tags],
  ['run', (prev, next) => !prev.activeRun && !!next.activeRun],
  ['rez', loggedEvent('rez')],
  ['access', loggedEvent('access')],
  ['install', loggedEvent('install')],
  ['credit', (prev, next) => next.corp.credits > prev.corp.credits || next.runner.credits > prev.runner.credits],
  ['draw', (prev, next) => handSize(next) > handSize(prev)],
];

const STORAGE_KEY = 'netrunner.sound';

export function soundEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Not saved; the toggle still works for this page
  }
}

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function createNoiseBuffer(ac: AudioContext, duration: number): AudioBuffer {
  const bufferSize = Math.floor(ac.sampleRate * duration);
  const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
  const output = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    output[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function play(sound: Sound) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.01;
  switch (sound) {
    case 'win': {
      // Neon Surge: 4-stage polyphonic ascending cyberpunk arpeggio with shimmering resonance
      const steps = [
        { f: 523.25, time: 0 },
        { f: 587.33, time: 0.11 },
        { f: 783.99, time: 0.22 },
        { f: 1046.50, time: 0.33 },
      ];

      steps.forEach((s, idx) => {
        const start = t + s.time;
        const osc = ac.createOscillator();
        const filter = ac.createBiquadFilter();
        const gain = ac.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(s.f, start);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2600, start);
        filter.Q.value = 1.8;

        const isLast = idx === steps.length - 1;
        const dur = isLast ? 0.65 : 0.2;
        gain.gain.setValueAtTime(isLast ? 0.12 : 0.08, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);

        osc.connect(filter).connect(gain).connect(ac.destination);
        osc.start(start);
        osc.stop(start + dur + 0.02);
      });

      // Ringing high octave chime
      const chime = ac.createOscillator();
      const cGain = ac.createGain();
      chime.type = 'sine';
      chime.frequency.setValueAtTime(1318.51, t + 0.33); // E6
      cGain.gain.setValueAtTime(0.05, t + 0.33);
      cGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
      chime.connect(cGain).connect(ac.destination);
      chime.start(t + 0.33);
      chime.stop(t + 0.87);
      break;
    }

    case 'lose': {
      // Cyber Meltdown: 4-note descending minor arpeggio C5 -> Ab4 -> F4 -> C4 with analog tape-stop glide
      const notes = [
        { f: 523.25, time: 0, sag: 523.25 },
        { f: 415.30, time: 0.13, sag: 415.30 },
        { f: 349.23, time: 0.26, sag: 349.23 },
        { f: 261.63, time: 0.39, sag: 110.0 },
      ];

      notes.forEach((n, idx) => {
        const start = t + n.time;
        const osc = ac.createOscillator();
        const filter = ac.createBiquadFilter();
        const gain = ac.createGain();

        osc.type = idx === 3 ? 'sawtooth' : 'triangle';
        osc.frequency.setValueAtTime(n.f, start);
        if (idx === 3) {
          osc.frequency.exponentialRampToValueAtTime(n.sag, start + 0.38);
        }

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1600, start);
        filter.frequency.exponentialRampToValueAtTime(350, start + (idx === 3 ? 0.38 : 0.18));

        gain.gain.setValueAtTime(0.1, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + (idx === 3 ? 0.4 : 0.18));

        osc.connect(filter).connect(gain).connect(ac.destination);
        osc.start(start);
        osc.stop(start + (idx === 3 ? 0.42 : 0.2));
      });
      break;
    }

    case 'runner_win': {
      // 7 syncopated heist notes for 7 agenda points: D4, F4, G4, A4, D5, G5, A5 + neon overtone
      const pattern = [
        { f: 293.66, time: 0, dur: 0.09 },
        { f: 349.23, time: 0.11, dur: 0.09 },
        { f: 392.00, time: 0.20, dur: 0.08 },
        { f: 440.00, time: 0.28, dur: 0.09 },
        { f: 587.33, time: 0.40, dur: 0.14 },
        { f: 783.99, time: 0.54, dur: 0.10 },
        { f: 880.00, time: 0.64, dur: 0.48 },
      ];
      pattern.forEach((note, idx) => {
        const start = t + note.time;
        const osc = ac.createOscillator();
        const filter = ac.createBiquadFilter();
        const gain = ac.createGain();

        osc.type = idx >= 4 ? 'sawtooth' : 'triangle';
        osc.frequency.setValueAtTime(note.f, start);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(idx >= 4 ? 3200 : 1800, start);
        filter.Q.value = 1.6;

        gain.gain.setValueAtTime(0.11, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + note.dur);

        osc.connect(filter).connect(gain).connect(ac.destination);
        osc.start(start);
        osc.stop(start + note.dur + 0.02);
      });

      const topChime = ac.createOscillator();
      const tcGain = ac.createGain();
      topChime.type = 'sine';
      topChime.frequency.setValueAtTime(1760, t + 0.64);
      tcGain.gain.setValueAtTime(0.06, t + 0.64);
      tcGain.gain.exponentialRampToValueAtTime(0.0001, t + 1.15);
      topChime.connect(tcGain).connect(ac.destination);
      topChime.start(t + 0.64);
      topChime.stop(t + 1.18);
      break;
    }

    case 'corp_win': {
      // 7 architectural corporate chimes in C Major / Lydian
      const corpNotes = [
        { f: 261.63, time: 0, dur: 0.18 },
        { f: 329.63, time: 0.10, dur: 0.18 },
        { f: 392.00, time: 0.20, dur: 0.18 },
        { f: 493.88, time: 0.32, dur: 0.20 },
        { f: 587.33, time: 0.44, dur: 0.22 },
        { f: 659.25, time: 0.58, dur: 0.24 },
        { f: 783.99, time: 0.72, dur: 0.68 },
      ];
      const sub = ac.createOscillator();
      const subG = ac.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(130.81, t);
      sub.frequency.exponentialRampToValueAtTime(65.4, t + 0.9);
      subG.gain.setValueAtTime(0.14, t);
      subG.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      sub.connect(subG).connect(ac.destination);
      sub.start(t);
      sub.stop(t + 0.92);

      corpNotes.forEach((n, idx) => {
        const start = t + n.time;
        const fundamental = ac.createOscillator();
        const overtone = ac.createOscillator();
        const gain = ac.createGain();
        const filter = ac.createBiquadFilter();

        fundamental.type = 'sine';
        fundamental.frequency.setValueAtTime(n.f, start);

        overtone.type = 'sine';
        overtone.frequency.setValueAtTime(n.f * 2.0, start);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2200, start);

        const isLast = idx === corpNotes.length - 1;
        gain.gain.setValueAtTime(isLast ? 0.12 : 0.08, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + n.dur);

        fundamental.connect(filter);
        overtone.connect(filter);
        filter.connect(gain).connect(ac.destination);

        fundamental.start(start);
        overtone.start(start);
        fundamental.stop(start + n.dur + 0.02);
        overtone.stop(start + n.dur + 0.02);
      });
      break;
    }

    case 'deckout': {
      // Corporate Liquidation / Memory fault cascade (descending saw bitcrush + power-down whine)
      const notes = [659.25, 523.25, 440.0, 329.63, 261.63, 196.0, 110.0];
      notes.forEach((freq, i) => {
        const start = t + i * 0.075;
        const osc = ac.createOscillator();
        const filter = ac.createBiquadFilter();
        const gain = ac.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, start);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.85, start + 0.07);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2200 - (i * 260), start);

        gain.gain.setValueAtTime(0.09, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);

        osc.connect(filter).connect(gain).connect(ac.destination);
        osc.start(start);
        osc.stop(start + 0.14);
      });

      const shutdown = ac.createOscillator();
      const sGain = ac.createGain();
      shutdown.type = 'triangle';
      shutdown.frequency.setValueAtTime(180, t + 0.35);
      shutdown.frequency.exponentialRampToValueAtTime(35, t + 1.1);
      sGain.gain.setValueAtTime(0.001, t + 0.35);
      sGain.gain.linearRampToValueAtTime(0.16, t + 0.45);
      sGain.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      shutdown.connect(sGain).connect(ac.destination);
      shutdown.start(t + 0.35);
      shutdown.stop(t + 1.15);
      break;
    }

    case 'concede': {
      // Terminal disconnect switch snap + capacitor frequency discharge
      const click = ac.createOscillator();
      const clkGain = ac.createGain();
      click.type = 'triangle';
      click.frequency.setValueAtTime(1600, t);
      click.frequency.exponentialRampToValueAtTime(300, t + 0.02);
      clkGain.gain.setValueAtTime(0.1, t);
      clkGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
      click.connect(clkGain).connect(ac.destination);
      click.start(t);
      click.stop(t + 0.025);

      const discharge = ac.createOscillator();
      const dGain = ac.createGain();
      discharge.type = 'sine';
      discharge.frequency.setValueAtTime(480, t + 0.02);
      discharge.frequency.exponentialRampToValueAtTime(50, t + 0.35);
      dGain.gain.setValueAtTime(0.12, t + 0.02);
      dGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      discharge.connect(dGain).connect(ac.destination);
      discharge.start(t + 0.02);
      discharge.stop(t + 0.37);
      break;
    }

    case 'score': {
      // Corporate Chime Lock: 3-tone harmonic major sequence with warm body
      const notes = [440, 554, 659];
      notes.forEach((freq, i) => {
        const start = t + i * 0.09;
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.12, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
        osc.connect(gain).connect(ac.destination);
        osc.start(start);
        osc.stop(start + 0.22);
      });
      break;
    }

    case 'steal': {
      // Data Extraction Surge: energetic ascending chords with saw bite
      const notes = [392, 587, 880];
      notes.forEach((freq, i) => {
        const start = t + i * 0.08;
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.05, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
        osc.connect(gain).connect(ac.destination);
        osc.start(start);
        osc.stop(start + 0.2);
      });
      break;
    }

    case 'damage': {
      // Filtered Saw Bite: 180Hz -> 45Hz downward sawtooth with 1400Hz -> 320Hz resonant lowpass filter
      const osc = ac.createOscillator();
      const filter = ac.createBiquadFilter();
      const gain = ac.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.22);

      filter.type = 'lowpass';
      filter.Q.value = 2.2;
      filter.frequency.setValueAtTime(1400, t);
      filter.frequency.exponentialRampToValueAtTime(320, t + 0.2);

      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);

      osc.connect(filter).connect(gain).connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.23);
      break;
    }

    case 'tag': {
      // Tactical Radar Lock: crisp dual target chirp
      [1050, 1400].forEach((freq, idx) => {
        const start = t + idx * 0.07;
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.08, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.05);
        osc.connect(gain).connect(ac.destination);
        osc.start(start);
        osc.stop(start + 0.06);
      });
      break;
    }

    case 'run': {
      // Coupler Latch & Sync: tactile switch snap + optical carrier sync
      const click = ac.createOscillator();
      const clkGain = ac.createGain();
      click.type = 'triangle';
      click.frequency.setValueAtTime(1800, t);
      click.frequency.exponentialRampToValueAtTime(420, t + 0.018);
      clkGain.gain.setValueAtTime(0.07, t);
      clkGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.018);
      click.connect(clkGain).connect(ac.destination);
      click.start(t);
      click.stop(t + 0.02);

      const sync = ac.createOscillator();
      const sGain = ac.createGain();
      sync.type = 'sine';
      sync.frequency.setValueAtTime(980, t + 0.015);
      sync.frequency.exponentialRampToValueAtTime(1480, t + 0.065);
      sGain.gain.setValueAtTime(0.05, t + 0.015);
      sGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.065);
      sync.connect(sGain).connect(ac.destination);
      sync.start(t + 0.015);
      sync.stop(t + 0.07);
      break;
    }

    case 'rez': {
      // Node Wakeup: gentle, glassy rising micro-chime (D5 587.3Hz -> A5 880Hz)
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.3, t);
      osc.frequency.exponentialRampToValueAtTime(880, t + 0.07);
      gain.gain.setValueAtTime(0.09, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      osc.connect(gain).connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.26);
      break;
    }

    case 'access': {
      // Optical Decrypter Lock: rapid two-stage digital chirp (1760Hz, 2640Hz)
      [1760, 2640].forEach((freq, i) => {
        const start = t + i * 0.04;
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.06, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.035);
        osc.connect(gain).connect(ac.destination);
        osc.start(start);
        osc.stop(start + 0.04);
      });
      break;
    }

    case 'install': {
      // Server Caddy Dock: guide runner slide + spring-loaded lever latch
      const noise = ac.createBufferSource();
      noise.buffer = createNoiseBuffer(ac, 0.05);
      const filter = ac.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1800, t);
      filter.Q.value = 2.0;
      const nGain = ac.createGain();
      nGain.gain.setValueAtTime(0.1, t);
      nGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      noise.connect(filter).connect(nGain).connect(ac.destination);
      noise.start(t);

      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1200, t + 0.035);
      osc.frequency.exponentialRampToValueAtTime(350, t + 0.075);
      gain.gain.setValueAtTime(0.09, t + 0.035);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      osc.connect(gain).connect(ac.destination);
      osc.start(t + 0.035);
      osc.stop(t + 0.085);
      break;
    }

    case 'credit': {
      // Crystal Micro-Tick: 1760Hz -> 2200Hz sine sweep (48ms) + faint 3520Hz crystalline overtone (25ms)
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1760, t);
      osc.frequency.exponentialRampToValueAtTime(2200, t + 0.048);
      gain.gain.setValueAtTime(0.045, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.048);
      osc.connect(gain).connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.05);

      const ot = ac.createOscillator();
      const otG = ac.createGain();
      ot.type = 'sine';
      ot.frequency.setValueAtTime(3520, t);
      otG.gain.setValueAtTime(0.015, t);
      otG.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
      ot.connect(otG).connect(ac.destination);
      ot.start(t);
      ot.stop(t + 0.028);
      break;
    }

    case 'draw': {
      // Subtle bandpass friction slice (card drawn from stack/heap)
      const noise = ac.createBufferSource();
      noise.buffer = createNoiseBuffer(ac, 0.12);
      const filter = ac.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(800, t);
      filter.frequency.exponentialRampToValueAtTime(2200, t + 0.1);
      filter.Q.value = 2.0;

      const gain = ac.createGain();
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.12, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);

      noise.connect(filter).connect(gain).connect(ac.destination);
      noise.start(t);
      break;
    }

    case 'click': {
      // Cyberdeck mechanical switch snap
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(2400, t);
      osc.frequency.exponentialRampToValueAtTime(300, t + 0.025);
      gain.gain.setValueAtTime(0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
      osc.connect(gain).connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.03);
      break;
    }
  }
}

/**
 * The sound for an action that turned `prev` into `next` (exported for tests).
 * `listener` is the side hearing it: when that side has just lost, the end of
 * the game plays the lose sound instead of the win fanfare.
 */
export function soundFor(prev: GameState, next: GameState, listener: SideCode | null = null): Sound | null {
  if (next === prev) return null;
  // Specific victory and defeat signatures when a game concludes
  if (!prev.winner && !!next.winner) {
    const reason = next.winReason ?? '';
    if (reason.includes('conceded')) {
      return 'concede';
    }
    if (reason.includes('decked out')) {
      return 'deckout';
    }
    if (reason.includes('flatlined')) {
      return listener && next.winner !== listener ? 'lose' : 'win';
    }
    // Agenda point victory (7 notes)
    if (listener && next.winner !== listener) {
      return 'lose';
    }
    return next.winner === 'runner' ? 'runner_win' : 'corp_win';
  }
  for (const [sound, happened] of RULES) {
    if (!happened(prev, next)) continue;

    return sound;
  }
  return 'click';
}

export function playForAction(prev: GameState, next: GameState, listener: SideCode | null = null): void {
  if (!soundEnabled()) return;
  const sound = soundFor(prev, next, listener);
  if (sound) play(sound);
}

import { GameState, LogEvent } from '../core/types/state';

/**
 * Short synthesized sound effects (Web Audio, no audio files). Each action
 * plays the most important sound for what it changed, read from the game
 * state and the events on its new log lines (never from their wording).
 */

type Sound = 'win' | 'score' | 'steal' | 'damage' | 'tag' | 'run' | 'rez' | 'access' | 'install' | 'credit' | 'draw' | 'click';

const loggedEvent = (event: LogEvent) => (prev: GameState, next: GameState) => next.log.slice(prev.log.length).some(e => e.event === event);
const handSize = (state: GameState) => state.corp.hq.length + state.runner.grip.length;

// Most important first
const RULES: [Sound, (prev: GameState, next: GameState) => boolean][] = [
  ['win', (prev, next) => !prev.winner && !!next.winner],
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

/** One tone: frequency sweep from `from` to `to` Hz. */
function tone(ac: AudioContext, at: number, from: number, to: number, length: number, type: OscillatorType, volume = 0.08) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(to, at + length);
  gain.gain.setValueAtTime(volume, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(ac.destination);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

function play(sound: Sound) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.01;
  switch (sound) {
    case 'win':
      [523, 659, 784, 1047].forEach((f, i) => tone(ac, t + i * 0.12, f, f, 0.25, 'triangle', 0.1));
      break;
    case 'score':
      tone(ac, t, 440, 440, 0.12, 'triangle');
      tone(ac, t + 0.12, 660, 660, 0.22, 'triangle');
      break;
    case 'steal':
      tone(ac, t, 330, 660, 0.12, 'sawtooth', 0.05);
      tone(ac, t + 0.12, 660, 990, 0.2, 'sawtooth', 0.05);
      break;
    case 'damage':
      tone(ac, t, 180, 50, 0.35, 'sawtooth', 0.1);
      break;
    case 'tag':
      tone(ac, t, 900, 700, 0.08, 'square', 0.04);
      tone(ac, t + 0.1, 900, 700, 0.08, 'square', 0.04);
      break;
    case 'run':
      tone(ac, t, 200, 800, 0.3, 'sawtooth', 0.05);
      break;
    case 'rez':
      tone(ac, t, 300, 1200, 0.18, 'square', 0.04);
      break;
    case 'access':
      tone(ac, t, 1200, 1200, 0.05, 'square', 0.03);
      tone(ac, t + 0.07, 1500, 1500, 0.05, 'square', 0.03);
      break;
    case 'install':
      tone(ac, t, 220, 160, 0.12, 'triangle', 0.09);
      break;
    case 'credit':
      tone(ac, t, 1800, 2400, 0.08, 'sine', 0.06);
      break;
    case 'draw':
      tone(ac, t, 600, 900, 0.07, 'triangle', 0.05);
      break;
    case 'click':
      tone(ac, t, 500, 500, 0.04, 'square', 0.02);
      break;
  }
}

/** The sound for an action that turned `prev` into `next` (exported for tests). */
export function soundFor(prev: GameState, next: GameState): Sound | null {
  if (next === prev) return null;
  for (const [sound, happened] of RULES) {
    if (happened(prev, next)) return sound;
  }
  return 'click';
}

export function playForAction(prev: GameState, next: GameState): void {
  if (!soundEnabled()) return;
  const sound = soundFor(prev, next);
  if (sound) play(sound);
}

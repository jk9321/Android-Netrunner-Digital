/**
 * Roadmap step 3 (spec /mnt/project-files/netrunner-ai/redesign/spec-step3-rez.md): the counted rez on approached ice
 * (rezModel.ts countedRez, consulted by corpAI decideRez before the value model), and no ice installed on Archives
 * without a reason (R6).
 *
 * Rules (Comprehensive Rules v26.03):
 *  - 6.4.3, 6.9.2b the Corp may rez the approached ice in the approach-ice paid ability window; 6.9.2c ice left
 *    unrezzed is passed. 3.4.3a the Corp rezzes when it chooses; 1.16.8 the rez cost is paid in credits.
 *  - 7.1 accessing: HQ's cards are accessed at random, R&D's from the top (so an agenda in HQ is at risk on every HQ
 *    run, and with none in HQ the agendas left are in R&D).
 *  - Card text: Maintenance Access "Run Archives. When you would approach Archives (after passing all ice), instead change
 *    the attacked server to HQ and approach HQ."
 *
 * Position (tests/fixtures/rez-toll.json, as in rezToll.test.ts): turn 8, the Runner (1 credit, Cleaver) approaching
 * the outer unrezzed Palisade on R&D with a rezzed Palisade behind it; the Corp has 3 credits and Offworld Office in HQ.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { CardInstance, GameState, cardDef, createCardInstance } from '../src/core';
import { HeuristicCorpAI } from '../src/ai/corpAI';
import { createAgent } from '../src/ai';
import { archivesWantsIce, countedRez } from '../src/ai/rezModel';
import { tuning } from '../src/ai/synergy';
import { inDecision } from './helpers/pricing';
import { giveCard, newGame } from './helpers';

const saved = { ...tuning.plan };
afterEach(() => {
  Object.assign(tuning.plan, saved);
});

function position(): { state: GameState; cards: string[] } {
  return JSON.parse(readFileSync(new URL('./fixtures/rez-toll.json', import.meta.url), 'utf8'));
}
const isAgenda = (c: CardInstance) => cardDef(c).type_code === 'agenda';

/** The run moved to `server` with the approached Palisade (and the rezzed one behind it, unless `alone`) on it. */
function at(server: 'rd' | 'hq' | 'archives' | 'remote-1', opts: { runnerCredits?: number; corpCredits?: number; hqAgenda?: boolean; rootAgenda?: boolean; alone?: boolean } = {}) {
  const { state, cards } = position();
  const rd = state.corp.servers.rd;
  const outer = rd.ice.find(c => c.instanceId === cards[0])!;
  const inner = rd.ice.filter(c => c !== outer);
  const ice = opts.alone ? [outer] : [...inner, outer];
  const agenda = state.corp.hq.find(isAgenda)!;
  const hq = opts.hqAgenda === false ? state.corp.hq.filter(c => !isAgenda(c)) : opts.rootAgenda ? state.corp.hq.filter(c => c !== agenda) : state.corp.hq;
  const servers: GameState['corp']['servers'] = { ...state.corp.servers, rd: { ...rd, ice: server === 'rd' ? ice : [] } };
  servers[server] = { ...(servers[server] ?? { id: server, name: server, isRemote: true, ice: [], root: [] }), ice, root: opts.rootAgenda ? [agenda] : servers[server]?.root ?? [] };
  const s: GameState = {
    ...state,
    runner: { ...state.runner, credits: opts.runnerCredits ?? state.runner.credits },
    activeRun: { ...state.activeRun!, server, icePosition: ice.length - 1 },
    corp: { ...state.corp, credits: opts.corpCredits ?? state.corp.credits, hq, servers },
  };
  return { s, ice: outer };
}
const call = (s: GameState, ice: CardInstance) => inDecision(s, 'corp', () => countedRez(s, ice));
const choose = (s: GameState, ice: CardInstance) => new HeuristicCorpAI({ synergy: true }).chooseRez(s, [ice]);

describe('counted rez on approached ice (6.4.3, 6.9.2b-c)', () => {
  it('R2: an agenda in the root and the Runner cannot pay through: rez', () => {
    // 5 credits: the rez (3) leaves 2, which still covers HQ's unrezzed Whitespace (the floor after a line, 2)
    const { s, ice } = at('remote-1', { runnerCredits: 0, rootAgenda: true, alone: true, corpCredits: 5 });
    expect(call(s, ice)).toBe('rez');
    expect(choose(s, ice)?.type).toBe('REZ_CARD');
    tuning.plan.rezStopper = false;
    expect(call(s, ice)).toBeNull();
  });

  it("Hard: the counted rez reaches Hard's rez decision (its search starts from the rule-based AI's choice)", () => {
    const { s, ice } = at('remote-1', { runnerCredits: 0, rootAgenda: true, alone: true, corpCredits: 5 });
    const hard = createAgent('corp', 'hard', { samples: 2, candidates: 2, seed: 1 });
    expect(hard.chooseRez!(s, [ice])?.type).toBe('REZ_CARD');
  }, 30000);

  it('R3: a run on HQ with an agenda in HQ: rez when it stops the run (R3s) and when it takes a toll (R3t)', () => {
    const stop = at('hq', { runnerCredits: 0, alone: true });
    expect(call(stop.s, stop.ice)).toBe('rez');
    const toll = at('hq', { runnerCredits: 5, alone: true });
    expect(call(toll.s, toll.ice)).toBe('rez');
    tuning.plan.rezHqToll = false;
    expect(call(toll.s, toll.ice)).toBeNull();
    expect(call(stop.s, stop.ice)).toBe('rez');
    tuning.plan.rezHqStop = false;
    expect(call(stop.s, stop.ice)).toBeNull();
    // No agenda in HQ: no opinion
    tuning.plan.rezHqStop = true;
    const none = at('hq', { runnerCredits: 0, alone: true, hqAgenda: false });
    expect(call(none.s, none.ice)).toBeNull();
  });

  it('R4: a run on R&D with no agenda in HQ and agendas left in R&D by the deck list: rez (stop and toll)', () => {
    // 1 credit: the outer Palisade (1) and the rezzed one behind (1) are 2 together; the rez is what stops the run
    const stop = at('rd', { hqAgenda: false });
    expect(call(stop.s, stop.ice)).toBe('rez');
    const toll = at('rd', { hqAgenda: false, runnerCredits: 9 });
    expect(call(toll.s, toll.ice)).toBe('rez');
    tuning.plan.rezRdToll = false;
    expect(call(toll.s, toll.ice)).toBeNull();
    // An agenda in HQ: R4 has no opinion (the value model decides, as rezToll.test.ts pins)
    const held = at('rd');
    expect(call(held.s, held.ice)).toBeNull();
  });

  it("can afford it: no opinion when the rez leaves the Corp under the floor after a line (countedScore.ts afterLineFloor)", () => {
    // 3 credits: the rez (3) leaves 0, and HQ (agendas there) still needs its unrezzed Whitespace (2)
    const { s, ice } = at('remote-1', { runnerCredits: 0, rootAgenda: true, alone: true });
    expect(call(s, ice)).toBeNull();
    tuning.plan.rezFloor = false;
    expect(call(s, ice)).toBe('rez');
  });

  it('no opinion when the ice ahead stops the Runner already', () => {
    const { s, ice } = at('hq', { runnerCredits: 0 });
    expect(call(s, ice)).toBeNull();
  });

  it('R5: Archives ice with no agenda there and no Runner Archives card is not rezzed; with Maintenance Access in the Runner\'s list it is the model\'s call', () => {
    const { s, ice } = at('archives', { runnerCredits: 0, alone: true });
    expect(inDecision(s, 'corp', () => archivesWantsIce(s))).toBe(false);
    expect(call(s, ice)).toBe('pass');
    expect(choose(s, ice)).toBeNull();
    const ma = structuredClone(s);
    ma.runner.stack.push(createCardInstance(ma, '35016'));
    expect(inDecision(ma, 'corp', () => archivesWantsIce(ma))).toBe(true);
    expect(inDecision(ma, 'corp', () => countedRez(ma, ma.corp.servers.archives.ice[0]))).not.toBe('pass');
  });
});

describe('R6: no ice installed on Archives without an agenda there or a Runner Archives card', () => {
  it('the install on Archives is never ranked; with the switch off it is', () => {
    const s = structuredClone(newGame(1));
    s.corp.rd.push(...s.corp.hq.splice(0));
    const ice = giveCard(s, 'corp', '30072'); // Palisade
    s.runner.stack = s.runner.stack.filter(c => !['35016', '36015', '34007', '34068', '35003', '34072', '36007', '36001', '34070', '34079'].includes(c.cardCode));
    const archivesInstall = () =>
      new HeuristicCorpAI({ synergy: true })
        .rankMainActions(s)
        .find(r => r.action.type === 'INSTALL_CARD' && r.action.cardInstanceId === ice && (r.action as { targetServerId?: string }).targetServerId === 'archives');
    expect(archivesInstall()?.score ?? -Infinity).toBe(-Infinity);
    tuning.plan.iceArchives = false;
    expect(archivesInstall()?.score ?? -Infinity).toBeGreaterThan(-Infinity);
  }, 30000);
});

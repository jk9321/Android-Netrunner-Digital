// R-109 after-merge red team probes (2026-11-27). Copy into tests/ and run: npx vitest run tests/r109-probes.test.ts
// Prints what the Runner's knowledge holds after each constructed line; asserts nothing except where marked.
import { describe, it } from 'vitest';
import { appendFileSync } from 'node:fs';
const out = (line: string) => appendFileSync(process.env.PROBE_OUT ?? '/dev/stdout', line + '\n');
import { createCardInstance, createRng, GameState, nextFloat, getCardDefinition } from '../../../../src/core';
import { certainInHand, certainInArchives, revealInHand, updateHandKnowledge } from '../../../../src/core/engine/helpers';
import { runnerSeesRd, shuffleRD, updateRdKnowledge, noteRdPrivate } from '../../../../src/core/engine/rdKnowledge';
import { dealFallbacks, dealRunnerUnknowns } from '../../../../src/ai/runnerReply';
import { frameChecks } from '../../../../src/ai/pricing';
import { newGame } from '../../../../tests/helpers';
import '../../../../src/ai';

const SG = { hedgeFund: '30075', palisade: '30072', funhouse: '30054', regolith: '30069' };
function act(s: GameState, change: (next: GameState) => void): GameState {
  const next = structuredClone(s);
  change(next);
  updateHandKnowledge(s, next, updateRdKnowledge(s, next));
  return next;
}
const take = (zone: { instanceId: string }[], id: string) => zone.splice(zone.findIndex(c => c.instanceId === id), 1)[0];
const show = (tag: string, s: GameState) =>
  out(`${tag}\n  marks ${JSON.stringify(s.corp.rdKnownToRunner ?? [])}\n  hqList ${JSON.stringify(s.corp.knownToRunner ?? [])}\n  certainHQ ${JSON.stringify(certainInHand(s, 'corp'))}  archList ${JSON.stringify(s.corp.archKnownToRunner ?? [])} certainArch ${JSON.stringify(certainInArchives(s))}\n  real HQ ${s.corp.hq.map(c => c.instanceId + ':' + c.cardCode).join(' ')}`);

/** A Hedge Fund M seen in R&D, R&D shuffled (M one of 3), one drawn: M's mark is left 'hq', pending. */
function pending(extraHq: string[] = []) {
  const s0 = newGame();
  const m = createCardInstance(s0, SG.hedgeFund);
  s0.corp.rd = [m, createCardInstance(s0, SG.palisade), createCardInstance(s0, SG.funhouse)];
  s0.corp.hq = extraHq.map(code => createCardInstance(s0, code));
  let s = act(s0, n => runnerSeesRd(n, m));
  s = act(s, n => shuffleRD(n));
  s = act(s, n => n.corp.hq.push(n.corp.rd.shift()!));
  return { s, m };
}

describe('R-110: a same-code card surfacing from HQ while a left hq mark is pending', () => {
  it('A1: another Hedge Fund (not on the list) is played from HQ, then R&D is drawn out', () => {
    const { s: s1, m } = pending([SG.hedgeFund]);
    const other = s1.corp.hq.find(c => c.cardCode === SG.hedgeFund && c.instanceId !== m.instanceId) ?? s1.corp.hq.find(c => c.cardCode === SG.hedgeFund)!;
    show('A1 pending', s1);
    // play a Hedge Fund from HQ: which one? Try both: the one that is not M (if M was drawn) and M
    for (const which of ['other', 'm'] as const) {
      const id = which === 'm' ? m.instanceId : s1.corp.hq.find(c => c.cardCode === SG.hedgeFund && c.instanceId !== m.instanceId)!.instanceId;
      if (!s1.corp.hq.some(c => c.instanceId === id)) { out(`A1 ${which}: not in HQ (M not drawn), skip`); continue; }
      let s = act(s1, n => n.corp.archives.faceUp.push(take(n.corp.hq, id)));
      show(`A1 ${which} after play`, s);
      s = act(s, n => n.corp.hq.push(...n.corp.rd.splice(0)));
      show(`A1 ${which} after R&D drawn out`, s);
    }
    void other;
  });
  it('A3: the HQ list also holds a seen Hedge Fund: both forgotten for one surfaced card?', () => {
    const { s: s1, m } = pending([SG.hedgeFund]);
    const seen = s1.corp.hq.find(c => c.cardCode === SG.hedgeFund && c.instanceId !== m.instanceId)!;
    let s = act(s1, n => revealInHand(n, 'corp', [n.corp.hq.find(c => c.instanceId === seen.instanceId)!]));
    show('A3 before play', s);
    s = act(s, n => n.corp.archives.faceUp.push(take(n.corp.hq, seen.instanceId)));
    show('A3 after play of the seen one', s);
  });
});

describe('same-code copies told apart by instance id', () => {
  it('B1: two HQ accesses with no Corp action between, each shows "a Hedge Fund"', () => {
    for (const same of [true, false]) {
      const s0 = newGame();
      const a = createCardInstance(s0, SG.hedgeFund);
      const b = createCardInstance(s0, SG.hedgeFund);
      s0.corp.hq = [a, b, createCardInstance(s0, SG.palisade)];
      let s = act(s0, n => revealInHand(n, 'corp', [n.corp.hq[0]]));
      s = act(s, n => revealInHand(n, 'corp', [n.corp.hq[same ? 0 : 1]]));
      show(`B1 second access ${same ? 'the same copy' : 'the other copy'}`, s);
    }
  });
  it('B2: seen A, 2 cards leave unseen, seen B; then one Hedge Fund is played: which one decides the count', () => {
    for (const played of ['a', 'b'] as const) {
      const s0 = newGame();
      const a = createCardInstance(s0, SG.hedgeFund);
      const b = createCardInstance(s0, SG.hedgeFund);
      s0.corp.hq = [a, b, createCardInstance(s0, SG.palisade), createCardInstance(s0, SG.palisade)];
      let s = act(s0, n => revealInHand(n, 'corp', [n.corp.hq[0]]));
      s = act(s, n => { n.corp.archives.faceDown.push(n.corp.hq.pop()!); n.corp.archives.faceDown.push(n.corp.hq.pop()!); });
      s = act(s, n => revealInHand(n, 'corp', [n.corp.hq[1]]));
      s = act(s, n => n.corp.archives.faceUp.push(take(n.corp.hq, played === 'a' ? a.instanceId : b.instanceId)));
      show(`B2 played ${played}`, s);
    }
  });
});

describe('destination by instance id inside one action', () => {
  it('C1: exact top mark M (Palisade); one action draws 2 and installs one of HQ as ice', () => {
    for (const installed of ['m', 'x', 'y'] as const) {
      const s0 = newGame();
      const m = createCardInstance(s0, SG.palisade);
      const x = createCardInstance(s0, SG.palisade);
      const y = createCardInstance(s0, SG.palisade);
      s0.corp.rd = [m, x, createCardInstance(s0, SG.hedgeFund)];
      s0.corp.hq = [y];
      let s = act(s0, n => runnerSeesRd(n, m));
      s = act(s, n => {
        n.corp.hq.push(n.corp.rd.shift()!, n.corp.rd.shift()!);
        const id = { m: m.instanceId, x: x.instanceId, y: y.instanceId }[installed];
        n.corp.servers.hq.ice.push(take(n.corp.hq, id));
      });
      show(`C1 installed ${installed}`, s);
    }
  });
  it('C2: exact top mark M; one action draws it and discards one HQ card facedown', () => {
    for (const discarded of ['m', 'y'] as const) {
      const s0 = newGame();
      const m = createCardInstance(s0, SG.hedgeFund);
      const y = createCardInstance(s0, SG.hedgeFund);
      s0.corp.rd = [m, createCardInstance(s0, SG.palisade)];
      s0.corp.hq = [y];
      let s = act(s0, n => runnerSeesRd(n, m));
      s = act(s, n => {
        n.corp.hq.push(n.corp.rd.shift()!);
        n.corp.archives.faceDown.push(take(n.corp.hq, discarded === 'm' ? m.instanceId : y.instanceId));
      });
      show(`C2 discarded ${discarded}`, s);
    }
  });
});


describe('Archives: a secret trash from the top of R&D (Cultivate, AU Co.: rules 8.3.3b)', () => {
  it('C3: the Runner knows the top card X exactly; the Corp looks at the top 5 and trashes one facedown', () => {
    for (const trashed of ['x', 'other'] as const) {
      const s0 = newGame();
      const x = createCardInstance(s0, SG.hedgeFund);
      const rest = [SG.palisade, SG.funhouse, SG.hedgeFund, SG.regolith, SG.palisade].map(c => createCardInstance(s0, c));
      s0.corp.rd = [x, ...rest];
      let s = act(s0, n => runnerSeesRd(n, x));
      s = act(s, n => {
        const id = trashed === 'x' ? x.instanceId : rest[2].instanceId; // the other is a Hedge Fund too
        n.corp.archives.faceDown.push(take(n.corp.rd, id));
        noteRdPrivate(n, 5); // as cultivateFlow.trash does
      });
      show(`C3 trashed ${trashed}`, s);
    }
  });
});

describe('the deal tripwire: which false certainty it sees', () => {
  const deal = (s: GameState) => { const v = structuredClone(s); const r = createRng(5); dealRunnerUnknowns(v, () => nextFloat(r)); return v; };
  it('E1: false "Palisade certain in HQ" while that Palisade is installed unrezzed, a spare ice in R&D', () => {
    const s = newGame();
    const wall = createCardInstance(s, SG.palisade);
    s.corp.hq = [createCardInstance(s, SG.hedgeFund)];
    s.corp.rd = [createCardInstance(s, SG.funhouse)];
    s.corp.servers.hq.ice.push(wall);
    s.corp.knownToRunner = [{ id: wall.instanceId, code: SG.palisade }];
    let thrown = ''; let v: GameState | undefined;
    try { v = deal(s); } catch (e) { thrown = String(e); }
    out(`E1 throw: ${thrown || 'none'}; HQ dealt ${v?.corp.hq.map(c => getCardDefinition(c.cardCode).title).join(', ')}; ice slot ${v && getCardDefinition(v.corp.servers.hq.ice[0].cardCode).title}`);
  });
  it('E2: false "Hedge Fund certain in HQ" while that Hedge Fund is in the heap (out of the pool)', () => {
    const s = newGame();
    const hf = createCardInstance(s, SG.hedgeFund);
    s.corp.hq = [createCardInstance(s, SG.palisade)];
    s.corp.rd = [createCardInstance(s, SG.hedgeFund)];
    s.corp.archives.faceUp.push(hf);
    s.corp.knownToRunner = [{ id: hf.instanceId, code: SG.hedgeFund }];
    let thrown = ''; let v: GameState | undefined;
    try { v = deal(s); } catch (e) { thrown = String(e); }
    out(`E2 throw: ${thrown || 'none'}; HQ dealt ${v?.corp.hq.map(c => getCardDefinition(c.cardCode).title).join(', ')}`);
  });
  it('E3: fallback count with frameChecks off on E1 board', () => {
    void frameChecks; void dealFallbacks; void noteRdPrivate; void SG.regolith;
  });
});

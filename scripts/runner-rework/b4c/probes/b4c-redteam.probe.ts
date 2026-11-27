// B4c red team probes (2026-11-27). Copy into tests/ and run: PROBE_OUT=<file> npx vitest run tests/b4c-redteam-probes.test.ts
// Prints the Runner's knowledge after each constructed line; asserts nothing.
import { describe, it } from 'vitest';
import { appendFileSync } from 'node:fs';
const out = (line: string) => appendFileSync(process.env.PROBE_OUT ?? '/dev/stdout', line + '\n');
import { createCardInstance, GameState } from '../../../../src/core';
import { certainInHand, certainInArchives, revealInHand, updateHandKnowledge } from '../../../../src/core/engine/helpers';
import { runnerSeesRd, updateRdKnowledge } from '../../../../src/core/engine/rdKnowledge';
import { newGame } from '../../../../tests/helpers';

const SG = { hedgeFund: '30075', palisade: '30072' };
function act(s: GameState, change: (next: GameState) => void): GameState {
  const next = structuredClone(s);
  change(next);
  updateHandKnowledge(s, next, updateRdKnowledge(s, next));
  return next;
}
const take = (zone: { instanceId: string }[], id: string) => zone.splice(zone.findIndex(c => c.instanceId === id), 1)[0];
const j = (x: unknown) => JSON.stringify(x);

describe('D: an HQ card shown going into R&D is followed by instance id (helpers.ts `followed`)', () => {
  it('D1: the Runner saw a Hedge Fund in HQ; a Hedge Fund is revealed and put on top of R&D', () => {
    for (const moved of ['a', 'b'] as const) {
      const s0 = newGame();
      const a = createCardInstance(s0, SG.hedgeFund);
      const b = createCardInstance(s0, SG.hedgeFund);
      s0.corp.hq = [a, b, createCardInstance(s0, SG.palisade)];
      s0.corp.rd = [createCardInstance(s0, SG.palisade)];
      let s = act(s0, n => revealInHand(n, 'corp', [n.corp.hq[0]]));
      const id = moved === 'a' ? a.instanceId : b.instanceId;
      s = act(s, n => {
        const c = take(n.corp.hq, id) as (typeof n.corp.hq)[number];
        n.corp.rd.unshift(c);
        runnerSeesRd(n, c);
      });
      out(`D1 moved copy ${moved} (the ${moved === 'a' ? 'seen' : 'other'} one): certainInHand ${j(certainInHand(s, 'corp'))} hqList ${j(s.corp.knownToRunner)}`);
    }
  });
});

describe('A: a facedown Archives card that turns up in the open is forgotten by instance id', () => {
  it('A1: the Runner knows one facedown Hedge Fund; a facedown Hedge Fund turns faceup', () => {
    for (const moved of ['a', 'b'] as const) {
      const s0 = newGame();
      const a = createCardInstance(s0, SG.hedgeFund);
      const b = createCardInstance(s0, SG.hedgeFund);
      s0.corp.archives.faceDown = [a, b];
      s0.corp.archKnownToRunner = [{ id: a.instanceId, code: a.cardCode }];
      const id = moved === 'a' ? a.instanceId : b.instanceId;
      const s = act(s0, n => n.corp.archives.faceUp.push(take(n.corp.archives.faceDown, id) as (typeof n.corp.hq)[number]));
      out(`A1 surfaced copy ${moved}: certainInArchives ${j(certainInArchives(s))}`);
    }
  });
});

describe('S: the swap invariant as written ("swap two same-title instances inside HQ on a clone, same certainInHand")', () => {
  it('S1: on the base B1 board (the leak), a literal swap of the two Hedge Funds in HQ changes nothing', () => {
    const s0 = newGame();
    const a = createCardInstance(s0, SG.hedgeFund);
    const b = createCardInstance(s0, SG.hedgeFund);
    s0.corp.hq = [a, b, createCardInstance(s0, SG.palisade)];
    let s = act(s0, n => revealInHand(n, 'corp', [n.corp.hq[0]]));
    s = act(s, n => revealInHand(n, 'corp', [n.corp.hq[1]]));
    const swapped = structuredClone(s);
    [swapped.corp.hq[0], swapped.corp.hq[1]] = [swapped.corp.hq[1], swapped.corp.hq[0]];
    const relabelled = structuredClone(s);
    for (const c of relabelled.corp.hq) c.instanceId = c.instanceId === a.instanceId ? b.instanceId : c.instanceId === b.instanceId ? a.instanceId : c.instanceId;
    out(`S1 base B1 (other copy): certainInHand ${j(certainInHand(s, 'corp'))}; HQ order swapped ${j(certainInHand(swapped, 'corp'))}; card ids swapped ${j(certainInHand(relabelled, 'corp'))}`);
  });
  it('S2: the same board with the swap made on the list ids BEFORE the second sighting, then the same action', () => {
    const s0 = newGame();
    const a = createCardInstance(s0, SG.hedgeFund);
    const b = createCardInstance(s0, SG.hedgeFund);
    s0.corp.hq = [a, b, createCardInstance(s0, SG.palisade)];
    const s1 = act(s0, n => revealInHand(n, 'corp', [n.corp.hq[0]]));
    const r1 = structuredClone(s1);
    r1.corp.knownToRunner = (r1.corp.knownToRunner ?? []).map(e => ({ ...e, id: e.id === a.instanceId ? b.instanceId : e.id }));
    const second = (n: GameState) => revealInHand(n, 'corp', [n.corp.hq.find(c => c.instanceId === b.instanceId)!]);
    const s2 = act(s1, second);
    const r2 = act(r1, second);
    out(`S2 sees copy b second: as played ${j(certainInHand(s2, 'corp'))}; with the list relabelled a->b first ${j(certainInHand(r2, 'corp'))}`);
  });
});

describe('J: a drawn R&D mark joins HQ by instance id (joinHand dedupes by id)', () => {
  it('J1: a pending Hedge Fund mark (left hq), an HQ access shows a Hedge Fund, then R&D is drawn out', async () => {
    const { shuffleRD } = await import('../../../../src/core/engine/rdKnowledge');
    for (const seenCopy of ['m', 'other'] as const) {
      const s0 = newGame();
      const m = createCardInstance(s0, SG.hedgeFund);
      s0.corp.rd = [m, createCardInstance(s0, SG.palisade), createCardInstance(s0, '30054')];
      s0.corp.hq = [createCardInstance(s0, SG.hedgeFund)];
      let s = act(s0, n => runnerSeesRd(n, m));
      s = act(s, n => shuffleRD(n));
      // draw until M is in HQ (it is one of 3), so both copies can be the one accessed
      while (!s.corp.hq.some(c => c.instanceId === m.instanceId)) s = act(s, n => n.corp.hq.push(n.corp.rd.shift()!));
      const pendingMarks = j(s.corp.rdKnownToRunner);
      const id = seenCopy === 'm' ? m.instanceId : s.corp.hq.find(c => c.cardCode === SG.hedgeFund && c.instanceId !== m.instanceId)!.instanceId;
      s = act(s, n => revealInHand(n, 'corp', [n.corp.hq.find(c => c.instanceId === id)!]));
      s = act(s, n => n.corp.hq.push(...n.corp.rd.splice(0)));
      out(`J1 accessed copy ${seenCopy} (marks before access ${pendingMarks}): after R&D drawn out certainInHand ${j(certainInHand(s, 'corp'))} hqList ${j(s.corp.knownToRunner)}`);
    }
  });
});

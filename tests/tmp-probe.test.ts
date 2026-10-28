import { it } from 'vitest';
import { cardDef } from '../src/core';
import { playedWorth } from '../src/ai/handValues';
import { tuning } from '../src/ai/synergy';
import { newGame } from './helpers';
it('probe', () => {
  const s = newGame();
  const cards = [...s.corp.hq, ...s.corp.rd].filter((c, i, a) => a.findIndex(d => d.cardCode === c.cardCode) === i);
  for (const on of [true, false]) {
    tuning.plan.agendaBoard = on;
    for (const c of cards) if (['agenda', 'ice'].includes(cardDef(c).type_code!)) console.log(on, cardDef(c).type_code, cardDef(c).title, cardDef(c).advancement_cost, cardDef(c).agenda_points, playedWorth(s, c).toFixed(2));
  }
  tuning.plan.agendaBoard = true;
});

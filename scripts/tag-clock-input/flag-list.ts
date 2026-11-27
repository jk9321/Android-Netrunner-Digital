/** The cards the ifTagged flag is on, with their type (tests/tagClockInput.test.ts boards). */
import '../../src/ai';
import { ALL_CARDS, getCardDefinition } from '../../src/core';
import { cardSynergy } from '../../src/ai/synergyTags';
for (const c of Object.values(ALL_CARDS) as { code: string }[]) {
  const d = getCardDefinition(c.code);
  if (cardSynergy(d).when?.includes('ifTagged')) console.log(c.code, d.type_code, d.side_code, d.title);
}

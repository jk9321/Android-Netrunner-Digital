/**
 * Every engine action type and prompt choice kind has a case in the online
 * sanitizer (src/net/protocol.ts), so a new action can't be silently refused
 * online. Read from the source text of the types, not a hand-kept list.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** The body of a top-level function, from its declaration to the next one. */
function body(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  expect(start, `function ${name} in src/net/protocol.ts`).toBeGreaterThan(-1);
  const next = src.indexOf('\nfunction ', start + 1);
  const nextExport = src.indexOf('\nexport function ', start + 1);
  const end = Math.min(...[next, nextExport, src.length].filter(i => i > start));
  return src.slice(start, end);
}

const cases = (code: string) => new Set([...code.matchAll(/case '([A-Za-z_]+)':/g)].map(m => m[1]));

describe('The online sanitizer knows every engine action', () => {
  const protocol = read('src/net/protocol.ts');

  it('every GameAction type has a case in sanitizeAction', () => {
    const actions = read('src/core/types/actions.ts');
    const union = actions.slice(actions.indexOf('export type GameAction ='));
    const members = [...union.slice(0, union.indexOf(';')).matchAll(/\|\s*(\w+)/g)].map(m => m[1]);
    expect(members.length).toBeGreaterThan(20);
    const types = members.map(name => {
      const decl = actions.match(new RegExp(`interface ${name} extends BaseAction \\{[^}]*?type: '([A-Z_]+)'`));
      expect(decl, `${name} declares its type`).not.toBeNull();
      return decl![1];
    });
    const handled = cases(body(protocol, 'sanitizeAction'));
    expect(types.filter(t => !handled.has(t))).toEqual([]);
  });

  it('every PromptChoice kind has a case in choiceOf', () => {
    const prompts = read('src/core/types/prompts.ts');
    const union = prompts.slice(prompts.indexOf('export type PromptChoice ='));
    const kinds = [...union.slice(0, union.indexOf('};\n') + 2).matchAll(/kind: '(\w+)'/g)].map(m => m[1]);
    expect(kinds.length).toBeGreaterThan(5);
    const handled = cases(body(protocol, 'choiceOf'));
    expect(kinds.filter(k => !handled.has(k))).toEqual([]);
  });
});

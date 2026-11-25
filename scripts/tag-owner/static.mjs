/**
 * F108 count, Part 0 (brief /mnt/project-files/netrunner-ai/tag-owner/brief-count.md rev 0): the static table of
 * `perTurn`'s call sites. Reads src/ai with the TypeScript parser (no src change, nothing run): every call
 * `perTurn(state, x, owner, ...)`, its owner argument as written, and the card it prices (the 5-digit card-entry key it
 * sits under in src/ai/cards/<set>.ts) with that card's type from src/data/*-cards.json. A call whose owner is not the
 * literal 'runner' or 'corp' is listed with its owner text.
 *
 *   node scripts/tag-owner/static.mjs > /mnt/project-files/netrunner-ai/tag-owner/perturn-sites.md
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const cards = new Map();
for (const f of readdirSync('src/data').filter(f => f.endsWith('-cards.json'))) for (const c of JSON.parse(readFileSync(join('src/data', f), 'utf8'))) cards.set(c.code, c);

const files = [];
const walkDir = d => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) walkDir(join(d, e.name));
    else if (e.name.endsWith('.ts')) files.push(join(d, e.name));
  }
};
walkDir('src/ai');
files.sort();

const rows = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const visit = (node, code) => {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && /^\d{5}$/.test(node.name.text)) code = node.name.text;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'perTurn') {
      const owner = node.arguments[2]?.getText(sf) ?? '?';
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      // the property the call sits under inside the card entry (runner: / value: / counters.x / corp: ...)
      let p = node.parent;
      let prop = '';
      while (p && !(ts.isPropertyAssignment(p) && ts.isStringLiteral(p.name) && /^\d{5}$/.test(p.name.text))) {
        if (ts.isPropertyAssignment(p) && !prop) prop = p.name.getText(sf);
        p = p.parent;
      }
      const c = code ? cards.get(code) : undefined;
      rows.push({ file, line, owner, code: code ?? '', title: c?.title ?? '', type: c?.type_code ?? (code ? 'not in card data' : 'not known at the call'), side: c?.side_code ?? '', prop });
    }
    ts.forEachChild(node, n => visit(n, code));
  };
  visit(sf, undefined);
}

const runner = rows.filter(r => r.owner === "'runner'");
const tally = {};
for (const r of runner) tally[r.type] = (tally[r.type] ?? 0) + 1;
console.log(`# perTurn call sites (src/ai at ${process.env.SHA ?? 'HEAD'})\n`);
console.log(`Calls: ${rows.length} (owner 'runner' ${runner.length}, 'corp' ${rows.filter(r => r.owner === "'corp'").length}, other ${rows.filter(r => r.owner !== "'runner'" && r.owner !== "'corp'").length}). The definition (effectValues.ts:113) is the 84th grep line.\n`);
console.log(`Owner 'runner' by the priced card's type: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', ')}.\n`);
console.log('| file:line | owner | card | title | type | side | under |');
console.log('|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.file.replace('src/ai/', '')}:${r.line} | ${r.owner.replace(/\|/g, '\\|')} | ${r.code} | ${r.title} | ${r.type} | ${r.side} | ${r.prop} |`);

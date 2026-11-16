// Copied unchanged from /mnt/project-files/audits/2026-11-16-ai-valuation/probes/val-lits.mjs (valuation audit 2026-11-16; V-A red-team ruling 15),
// so the V-A checkpoint counts and the independent audit recount run the same code. Run: node scripts/value-owners/val-lits.mjs .
// Hand-set literals (other than 0 and 1) in the valuation layer, per file; method of audits/2026-11-15-stage-c/probes/lits.mjs
// (comments and strings stripped). Also splits literals inside a top-level `export const X = {...}` / `const X = ...` rate table
// from those scattered in function bodies. Usage: node val-lits.mjs <repo root> [--list]
import fs from 'fs'; import path from 'path';
const root = process.argv[2]; const list = process.argv.includes('--list');
const files = ['evaluate','valueModel','handValues','effectValues','iceValues','counterValues','threatModel','cardPlans','cardProfiles','cardValues','pricing','payoutRisk','synergyTags','synergy'].map(f=>`src/ai/${f}.ts`)
  .concat(fs.readdirSync(path.join(root,'src/ai/cards')).map(f=>'src/ai/cards/'+f));
let total=0, tTable=0;
for (const f of files) {
  let t = fs.readFileSync(path.join(root,f),'utf8');
  t = t.replace(/\/\*[\s\S]*?\*\//g,m=>m.replace(/[^\n]/g,' ')).replace(/\/\/.*$/gm,'').replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g,"''");
  const lines = t.split('\n');
  // a "table" literal: on a line that is a top-level const declaration with a number, or inside a top-level const object literal
  let inTable=false, depth=0; let table=0, scattered=0; const where=[];
  for (let i=0;i<lines.length;i++){
    const L=lines[i];
    const start = /^(export )?(const|let) [A-Z_][A-Z0-9_]*\b/.test(L);
    if (!inTable && start) { inTable = true; depth = 0; }
    const nums=[...L.matchAll(/(?<![\w.$])(\d+(?:\.\d+)?|\.\d+)(?![\w$])/g)].map(x=>x[1]).filter(x=>!['0','1','0.0','1.0'].includes(x));
    if (inTable) table+=nums.length; else scattered+=nums.length;
    if (nums.length && list) where.push(`${f}:${i+1} ${inTable?'T':'S'} ${nums.join(' ')}`);
    if (inTable){ for (const ch of L){ if('{[('.includes(ch)) depth++; else if('}])'.includes(ch)) depth--; } if (depth<=0) inTable=false; }
  }
  total+=table+scattered; tTable+=table;
  console.log(f.padEnd(34), String(table+scattered).padStart(4), 'table', String(table).padStart(4), 'scattered', String(scattered).padStart(4));
  if (list) console.log(where.join('\n'));
}
console.log('TOTAL', total, 'table', tTable, 'scattered', total-tTable);

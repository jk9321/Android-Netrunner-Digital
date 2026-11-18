/**
 * Stage D item 6 step 1, count 1 (stage-d/item6-install-prompts/brief.md section 2.1): the inventory, by script, of every
 * Corp card whose prompt flow asks the Corp for a card to install or a server to install into. Reads the card scripts as
 * text (src/core/scripts/**), so it covers every Corp card in the game, not only the sample decks; no source change.
 *
 * For each typed flow (`const NAME = prompts({ ... })`, src/core/scripts/steps.ts) its steps and each step's body; a step
 *  - 'server' when its body installs the card its data names (installCorpChoice, installAndRez, installCorpCardFrom),
 *  - 'pick'   when its body asks a server question for the card it was given (flow.corpInstall, installAmongQuestion,
 *             a choice step whose answer installs) or installs the picked card itself at a fixed place ('pick+place'),
 *  - else not an install step.
 * A card's flows are the ones its script spreads (`...NAME.script`), in its own file or a helper's. Per card the script
 * reports: code, title, type, set file, stripped_text, the install steps with the options at the call (ignoreCosts,
 * discount, revealed, remoteRootOnly; installAndRez's discount), the zones the pick reads (HQ, R&D, Archives), whether a
 * pick may be declined (min 0, or the step returns on no card), whether an agenda can be picked (the candidate filter), the
 * places the flow is asked from (subroutine, trigger names, ability, onPlay), whether the flow can open during a run, and
 * the block of src/ai/prompts.ts that answers each step today (or 'fallback'). It also lists every Corp card whose text
 * says "install" with no install step found, with the text, for the note to classify by hand.
 *   npx vite-node scripts/stage-d/prompt-place-inventory.ts > inventory.json      (TABLE=1 prints a text table)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (d: string): string[] => readdirSync(d).flatMap(f => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.ts') ? [join(d, f)] : []));
const files = walk('src/core/scripts').filter(f => !/\/(steps|types|effects)\.ts$/.test(f));
const text = new Map(files.map(f => [f, readFileSync(f, 'utf8')]));

/** The balanced block that opens at `open` (an index of '{' or '('), as text. */
function block(s: string, open: number): string {
  const pairs: Record<string, string> = { '{': '}', '(': ')', '[': ']' };
  const stack: string[] = [];
  let quote: string | null = null;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && s[i + 1] === '/') {
      i = s.indexOf('\n', i);
      if (i < 0) break;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === stack[stack.length - 1]) {
      stack.pop();
      if (!stack.length) return s.slice(open, i + 1);
    }
  }
  return s.slice(open);
}

/** The top-level `key: value` entries of an object literal's text (its braces included). */
function entries(obj: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  let i = 1;
  while (i < obj.length - 1) {
    const m = /^\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$-]*))\s*:\s*/.exec(obj.slice(i));
    if (!m) {
      // a spread or a comment line: skip to the next top-level comma
      const rest = obj.slice(i);
      const spread = /^\s*\.\.\.[\w$.]+\s*,?/.exec(rest) ?? /^\s*\/\/[^\n]*\n/.exec(rest) ?? /^\s*,/.exec(rest);
      if (!spread) break;
      i += spread[0].length;
      continue;
    }
    const key = m[1] ?? m[2] ?? m[3];
    let j = i + m[0].length;
    const start = j;
    // the value runs to the next comma at depth 0
    let depth = 0;
    let quote: string | null = null;
    for (; j < obj.length - 1; j++) {
      const ch = obj[j];
      if (quote) {
        if (ch === '\\') j++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '/' && obj[j + 1] === '/') {
        j = obj.indexOf('\n', j);
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') quote = ch;
      else if ('{(['.includes(ch)) depth++;
      else if ('})]'.includes(ch)) depth--;
      else if (ch === ',' && depth === 0) break;
    }
    out.push({ key, value: obj.slice(start, j) });
    i = j + 1;
  }
  return out;
}

interface Step {
  flow: string;
  step: string;
  kind: string;
  body: string;
  file: string;
}
const flows = new Map<string, { file: string; steps: Step[]; text: string }[]>();
for (const [file, s] of text) {
  for (const m of s.matchAll(/(?:export\s+)?const\s+([\w$]+)\s*=\s*prompts\(\{/g)) {
    const obj = block(s, m.index! + m[0].length - 1);
    const steps = entries(obj).map(e => ({ flow: m[1], step: e.key, kind: /^\s*(cards|choice|psi)\b/.exec(e.value)?.[1] ?? '?', body: e.value, file }));
    (flows.get(m[1]) ?? flows.set(m[1], []).get(m[1])!).push({ file, steps, text: obj });
  }
}

const INSTALLS = /swapWithInstalled\(|installCorpChoice\(|installAndRez\(|installCorpCardFrom\(|\.ice\.splice\([^)]*,\s*0\s*,\s*[\w$]+\)/;
function classify(st: Step, all: Step[]): 'server' | 'pick' | 'pick+place' | null {
  const b = st.body;
  if (st.kind === 'choice' && (INSTALLS.test(b) || /InstallData|install: true/.test(b.slice(0, 200)))) return 'server';
  if (st.kind === 'cards') {
    if (/\.corpInstall\(|askInstallFromHQ\(/.test(b)) return 'pick';
    // asks a later step of this flow that installs
    const next = all.filter(o => o !== st && o.kind === 'choice' && (INSTALLS.test(o.body) || /InstallData/.test(o.body.slice(0, 200))));
    if (next.some(o => new RegExp(`'${o.step}'`).test(b))) return 'pick';
    if (INSTALLS.test(b)) return 'pick+place';
  }
  return null;
}

/** Option flags in the text of a call site. */
function opts(b: string) {
  return {
    ignoreCosts: /ignoreCosts:\s*true|installAndRez\([^)]*,\s*true\)|installCorpCardFrom\([^)]*,\s*true\)/.test(b),
    discount: /discount:\s*(\d+)/.exec(b)?.[1] ?? /installAndRez(?:Options)?\([^)]*?,\s*(\d+)\s*[,)]/.exec(b)?.[1] ?? null,
    revealed: /revealed:\s*true/.test(b),
    remoteRootOnly: /remoteRootOnly:\s*true/.test(b),
    installAndRez: /installAndRez|rezForFree/.test(b),
  };
}

// Card data
type Card = { code: string; title: string; type_code: string; side_code: string; stripped_text?: string; pack_code?: string };
const cards: (Card & { set: string })[] = [];
for (const f of readdirSync('src/data').filter(f => f.endsWith('-cards.json'))) {
  const j = JSON.parse(readFileSync(join('src/data', f), 'utf8'));
  const arr: Card[] = Array.isArray(j) ? j : (j.data ?? j.cards ?? Object.values(j));
  for (const c of arr) cards.push({ ...c, set: f.replace('-cards.json', '') });
}
const corp = cards.filter(c => c.side_code === 'corp');

// code -> script text
const scriptOf = new Map<string, { file: string; ident: string; text: string }>();
for (const [file, s] of text) {
  for (const m of s.matchAll(/:\s*Record<string,\s*CardScript>\s*=\s*\{/g)) {
    const table = block(s, m.index! + m[0].length - 1);
    for (const e of entries(table)) {
      if (!/^\d{5}$/.test(e.key)) continue;
      const v = e.value.trim();
      if (v.startsWith('{')) scriptOf.set(e.key, { file, ident: '(inline)', text: v });
      else {
        const ident = /^[\w$]+/.exec(v)?.[0] ?? v;
        const def = new RegExp(`const\\s+${ident.replace('$', '\\$')}\\s*(?::\\s*CardScript\\s*)?=\\s*`).exec(s);
        let body = '';
        if (def) {
          const at = def.index + def[0].length;
          const open = s.slice(at).search(/[{(]/);
          body = open >= 0 ? block(s, at + open) : '';
        }
        scriptOf.set(e.key, { file, ident, text: body || v });
      }
    }
  }
}

// Today's answer in prompts.ts, by card code and step
const P = readFileSync('src/ai/prompts.ts', 'utf8');
const libInstallers = JSON.parse((/const LIB_INSTALLERS = (\[[^\]]+\])/.exec(P)?.[1] ?? '[]').replace(/'/g, '"')) as string[];
function todayBlock(code: string, step: Step, cls: string): string {
  if (code === '35058') return cls === 'pick' ? 'Synapse block (freeInstallTarget, order position; no agenda)' : 'Synapse block (freeInstallTarget server)';
  if (['34098', '34115'].includes(code) && step.step === 'pick') return 'WR/Janaina block (ice the Corp can afford, costliest; else asset/upgrade; no agenda)';
  if (code === '34048' && step.step === 'pick') return 'Epiphany block (agenda if safeAgendaRemote; ice <= credits; asset/upgrade)';
  if (libInstallers.includes(code) && cls === 'server') return 'LIB_INSTALLERS block for an agenda (safeAgendaRemote), else fallback';
  return 'fallback';
}

const report: unknown[] = [];
const seen = new Set<string>();
for (const c of corp) {
  const sc = scriptOf.get(c.code);
  if (!sc) continue;
  // the flows the script spreads (...NAME.script) or hands to a factory (dividendAgenda(1, '...', test, NAME))
  const spreads = [...new Set([...sc.text.matchAll(/\b([\w$]+)\b/g)].map(m => m[1]).filter(n => flows.has(n)))];
  const steps: unknown[] = [];
  for (const name of spreads) {
    const defs = flows.get(name) ?? [];
    const def = defs.find(d => d.file === sc.file) ?? defs[0];
    if (!def) continue;
    for (const st of def.steps) {
      const cls = classify(st, def.steps);
      if (!cls) continue;
      // the call that asks this step's server question, or the server step's own install call
      const fileText = text.get(def.file)!;
      const site = cls === 'server' ? st.body : st.body + (def.steps.find(o => o.kind === 'choice' && INSTALLS.test(o.body))?.body ?? '');
      steps.push({ flow: name, step: st.step, kind: st.kind, cls, opts: opts(site), helper: def.file !== sc.file ? def.file : undefined, today: todayBlock(c.code, st, cls) });
      void fileText;
    }
  }
  if (!steps.length) continue;
  seen.add(c.code);
  // Where the flow is asked from, in the card's script text (and its file's ask helpers)
  const s = sc.text;
  const from = [
    /subroutines\s*:/.test(s) || c.type_code === 'ice' ? 'subroutine' : null,
    ...[...s.matchAll(/triggers\s*:\s*\{/g)].flatMap(m => entries(block(s, m.index! + m[0].length - 1)).map(e => `trigger:${e.key}`)),
    /abilities\s*:/.test(s) ? 'ability' : null,
    /onPlay\s*:/.test(s) ? 'onPlay' : null,
    /onScore\s*:|whenScored|onScored/.test(s) ? 'onScore' : null,
    /dividendAgenda\(/.test(s) ? 'trigger:discard_phase_ends (dividendAgenda)' : null,
    /onPass\s*:/.test(s) ? 'onPass (ice passed)' : null,
  ].filter(Boolean) as string[];
  const zones = [/corp\.hq\b|\bhq\b/i.test(s) ? 'HQ' : null, /corp\.rd\b|takeFromRD|search R&D/i.test(s + (c.stripped_text ?? '')) ? 'R&D' : null, /archivesCards|archives/i.test(s) ? 'Archives' : null].filter(Boolean);
  const runTriggers = /trigger:(run|access|breach|encounter|approach|pass|stolen|agenda_stolen|steal|successful|run_ends|jack)/;
  const inRun = from.includes('subroutine') || from.some(f => runTriggers.test(f)) || /during a run|encounter/i.test(c.stripped_text ?? '');
  const t = c.stripped_text ?? '';
  report.push({
    code: c.code,
    title: c.title,
    type: c.type_code,
    set: c.set,
    file: sc.file,
    text: t,
    steps,
    from,
    zones,
    mayDecline: /\byou may\b|up to/i.test(t),
    agendaPickable: !/piece of ice|1 ice|an? (asset|upgrade)\b/i.test(t.split(/install/i)[1] ?? t) ? 'by text: any card type' : 'by text: restricted',
    reveals: /reveal/i.test(t),
    inRun,
  });
}
const unmatched = corp
  .filter(c => /\binstall/i.test(c.stripped_text ?? '') && !seen.has(c.code))
  .map(c => ({ code: c.code, title: c.title, type: c.type_code, set: c.set, scripted: scriptOf.has(c.code), text: c.stripped_text }));

if (process.env.TABLE) {
  for (const r of report as { code: string; title: string; type: string; steps: { step: string; cls: string; opts: Record<string, unknown>; today: string }[]; from: string[]; zones: string[]; inRun: boolean }[]) {
    console.log(`${r.code} ${r.title} (${r.type}) from ${r.from.join(',')} zones ${r.zones.join(',')} inRun ${r.inRun}`);
    for (const st of r.steps) console.log(`   ${st.step} ${st.cls} ${JSON.stringify(Object.fromEntries(Object.entries(st.opts).filter(([, v]) => v)))} -> ${st.today}`);
  }
  console.log(`\n${report.length} cards with install steps; ${unmatched.length} Corp cards say "install" with none found:`);
  for (const u of unmatched) console.log(`  ${u.code} ${u.title} (${u.type}${u.scripted ? '' : ', unscripted'}): ${u.text}`);
} else console.log(JSON.stringify({ corpCards: corp.length, scripted: corp.filter(c => scriptOf.has(c.code)).length, cards: report, unmatched }, null, 1));

/**
 * Stage D found row 59, count step A1: the inventory from the code. Every card script (all sets on this checkout) whose
 * prompt answer leaves the same card's next prompt pending for the same side, read from the `prompts()` flows in
 * src/core/scripts: for each step, the flow's own asks inside its handler (flow.choice / cards / ask / askIf /
 * corpInstall / runnerInstall / installRunner / arrangeNext / psiGame / evenIfNone), the side each step is asked of
 * (from the asks' question side, 'corp' for corpInstall, 'runner' for runnerInstall/installRunner), and what the later
 * step does (from its handler text: a credit cost, cards trashed or discarded from the asker's hand, a tag, damage,
 * an install, a choice of target only). A cost of the ASKING side in a later step is marked `cost`.
 * Then: which of these the per-card blocks in src/ai/prompts.ts answer first (by card code, read from todayAnswer), and
 * which are identities (followChain already follows them). A static read: helpers that ask on a flow's behalf from
 * another function are listed as `via helper` when the handler passes the flow on.
 *   npx vite-node scripts/stage-d/prompt-chain-inventory.ts > out.json
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getCardDefinition } from '../../src/core';
import { ALL_CARDS } from '../../src/core/cards';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** The text from `open` (an opening bracket index) to its matching close, skipping strings and comments roughly. */
function block(text: string, open: number): string {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const stack: string[] = [];
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '/' && text[i + 1] === '/') i = text.indexOf('\n', i) - 1;
    else if (pairs[c]) stack.push(pairs[c]);
    else if (c === ')' || c === '}' || c === ']') {
      stack.pop();
      if (stack.length === 0) return text.slice(open, i + 1);
    }
  }
  return text.slice(open);
}

/** The top-level `name: kind(` entries of a prompts({...}) object, each with its handler text. */
function steps(obj: string): { name: string; kind: string; body: string }[] {
  const outS: { name: string; kind: string; body: string }[] = [];
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < obj.length; i++) {
    const c = obj[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      continue;
    }
    if ('({['.includes(c)) depth++;
    else if (')}]'.includes(c)) depth--;
    else if (depth === 1) {
      const m = /^\s*([A-Za-z_][\w]*|'[^']+')\s*:\s*([A-Za-z_]\w*)\s*(<[^>(]*>)?\s*\(/.exec(obj.slice(i));
      if (m && /[{,\s]/.test(obj[i - 1] ?? '{')) {
        const name = m[1].replace(/'/g, '');
        const open = i + m[0].length - 1;
        const body = block(obj, open);
        outS.push({ name, kind: m[2], body });
        i = open + body.length - 1;
        depth = 1;
      }
    }
  }
  return outS;
}

const ASK = /\.(choice|cards|ask|askIf|corpInstall|runnerInstall|installRunner|arrangeNext|arrangeTop|psiGame|evenIfNone)\(\s*[^,]+,\s*(?:[^,]*?,\s*)?'([\w-]+)'/g;

function effects(body: string, side: string | null) {
  const own = side ?? '?';
  const e: string[] = [];
  if (/corp\.credits\s*-=|loseCredits\(\s*state\s*,\s*'corp'|payCorp|spendCorp/.test(body) && own === 'corp') e.push('credits');
  if (/runner\.credits\s*-=|payRunner|spendRunner|loseCredits\(\s*state\s*,\s*'runner'/.test(body) && own === 'runner') e.push('credits');
  if (/trashFromHQ|discardFromHQ/.test(body) && own === 'corp') e.push('hq cards');
  if (/trashFromGrip|discardFromGrip|discard\(/.test(body) && own === 'runner') e.push('grip cards');
  if (/giveTags|takeTag/.test(body) && own === 'runner') e.push('tag');
  if (/[dD]amage\(/.test(body) && own === 'runner') e.push('damage');
  if (/forfeit/i.test(body)) e.push('forfeit');
  if (/clicks\s*-=|loseClick/.test(body)) e.push('click');
  const cost = e.length > 0;
  // An install by the shared helper pays the install cost (rules 8.5.4, the ice install cost) in this step unless the costs are ignored
  if (/installCorpChoice|corpInstall|installRunnerChoice|installRunner/.test(body) && !/ignoreCosts|ignoreAllCosts|free/.test(body)) e.push('install cost in this step');
  if (/installCorpChoice|install/i.test(body)) e.push('install');
  if (/endTheRun|endRun/.test(body)) e.push('ends run');
  if (/trashInstalledRunnerCard|trashInstalled/.test(body)) e.push('trash installed');
  if (/corp\.credits\s*\+=|gainCredits/.test(body)) e.push('gain');
  if (!e.length) e.push('choice of target only');
  return { cost, does: e };
}

function main() {
  const all = files('src/core/scripts');
  const texts = new Map(all.map(f => [f, readFileSync(f, 'utf8')]));
  // card code -> script const name, script const -> flows it spreads
  const codeOf = new Map<string, string[]>();
  for (const t of texts.values()) for (const m of t.matchAll(/'(\d{5})':\s*([A-Za-z_]\w*)/g)) codeOf.set(m[2], [...(codeOf.get(m[2]) ?? []), m[1]]);
  const prompts = readFileSync('src/ai/prompts.ts', 'utf8');
  const today = prompts.slice(prompts.indexOf('function todayAnswer'), prompts.indexOf('// Everything else: try each answer'));
  const blockCodes = new Set([...today.matchAll(/'(\d{5})'/g)].map(m => m[1]));
  for (const m of today.matchAll(/\b([A-Z][A-Z_]+)\b/g)) {
    const def = new RegExp(`const ${m[1]} = '(\\d{5})'`).exec(prompts);
    if (def) blockCodes.add(def[1]);
  }
  const rows: Record<string, unknown>[] = [];
  for (const [file, text] of texts) {
    for (const m of text.matchAll(/const\s+([A-Za-z_]\w*)\s*=\s*prompts\(\s*\{/g)) {
      const flow = m[1];
      const obj = block(text, m.index! + m[0].length - 1);
      const st = steps(obj);
      // the side of each step, from every ask of this flow in the file
      const sideOf = new Map<string, string>();
      for (const a of text.matchAll(new RegExp(`${flow}\\.(choice|cards|ask|askIf|corpInstall|runnerInstall|installRunner|arrangeTop|arrangeNext|evenIfNone)\\(([\\s\\S]{0,400}?)\\)\\s*[;)]`, 'g'))) {
        const stepM = /'([\w-]+)'/.exec(a[2]);
        if (!stepM) continue;
        const side = a[1] === 'corpInstall' ? 'corp' : a[1] === 'runnerInstall' || a[1] === 'installRunner' ? 'runner' : (/(?:choiceQuestion|cardsQuestion)\(\s*'(corp|runner)'/.exec(a[2])?.[1] ?? (a[1] === 'evenIfNone' ? /,\s*'(corp|runner)'/.exec(a[2])?.[1] : undefined) ?? (/side:\s*'(corp|runner)'/.exec(a[2])?.[1]));
        if (side && !sideOf.has(stepM[1])) sideOf.set(stepM[1], side);
      }
      // the scripts that spread this flow, and their codes: the nearest script const (or inline code key) before each `...flow.script`
      const codes: string[] = [];
      for (const u of text.matchAll(new RegExp(`\\.\\.\\.${flow}\\.script`, 'g'))) {
        const before = text.slice(0, u.index);
        const owners = [...before.matchAll(/(?:const\s+([A-Za-z_]\w*)\s*(?::\s*[\w<>]+)?\s*=|'(\d{5})'\s*:\s*\{)/g)];
        const last = owners[owners.length - 1];
        if (!last) continue;
        if (last[2]) codes.push(last[2]);
        else codes.push(...(codeOf.get(last[1]) ?? []));
      }
      // No script spreads it by name (a helper builds the script, e.g. dividendAgenda(..., flow)): the consts whose
      // initializer passes the flow, then the card named in the flow's question messages ("Project Ingatan: ...")
      if (!codes.length) {
        for (const u of text.matchAll(new RegExp(`const\\s+([A-Za-z_]\\w*)\\s*(?::\\s*[\\w<>]+)?\\s*=\\s*[^;]*\\b${flow}\\b`, 'g'))) if (u[1] !== flow) codes.push(...(codeOf.get(u[1]) ?? []));
      }
      if (!codes.length) {
        for (const q of obj.matchAll(/(?:choiceQuestion|cardsQuestion)\(\s*'(?:corp|runner)'\s*,\s*[`']([^`':]+):/g)) {
          const c = ALL_CARDS.find(x => x.title === q[1]);
          if (c) {
            codes.push(c.code);
            break;
          }
        }
      }
      for (const s of st) {
        const nexts = [...s.body.matchAll(new RegExp(`${flow}${ASK.source.slice(0)}`, 'g'))].map(x => x[2]).filter(n => n !== s.name || true);
        const viaHelper = new RegExp(`\\(\\s*${flow}\\s*[,)]|,\\s*${flow}\\s*[,)]`).test(s.body);
        if (!nexts.length && !viaHelper) continue;
        let side = sideOf.get(s.name) ?? (s.kind === 'psi' ? 'both' : null);
        for (const n of new Set(nexts)) {
          const target = st.find(x => x.name === n);
          const nside0 = sideOf.get(n) ?? null;
          for (const code of codes.length ? [...new Set(codes)] : [null]) {
            let def: { title: string; type_code: string; side_code: string } | null;
            try {
              def = code ? (getCardDefinition(code) as never) : null;
            } catch {
              def = null;
            }
            // A side the static read cannot see (a helper builds the question): the card's own side, marked inferred
            const inferred = (!side || !nside0) && !!def;
            side = side ?? def?.side_code ?? null;
            const nside = nside0 ?? def?.side_code ?? null;
            const eff = target ? effects(target.body, nside) : { cost: false, does: ['?'] };
            rows.push({
              code,
              card: def?.title ?? null,
              type: def?.type_code ?? null,
              cardSide: def?.side_code ?? null,
              file: file.replace('src/core/scripts/', ''),
              flow,
              step: s.name,
              side,
              next: n,
              nextSide: nside,
              sameSide: !!side && side === nside,
              self: n === s.name,
              cost: eff.cost && !!side && side === nside,
              does: eff.does,
              block: code ? blockCodes.has(code) : false,
              identity: def?.type_code === 'identity',
              inferred,
            });
          }
        }
        if (viaHelper && !nexts.length) rows.push({ codes, file: file.replace('src/core/scripts/', ''), flow, step: s.name, side, next: 'via helper', does: ['?'] });
      }
    }
  }
  const chains = rows.filter(r => r.sameSide);
  console.log(JSON.stringify({ flows: [...texts.values()].reduce((n, t) => n + [...t.matchAll(/=\s*prompts\(\s*\{/g)].length, 0), rows: rows.length, sameSide: chains.length, costSameSide: chains.filter(r => r.cost).length, blockCodes: [...blockCodes], list: rows }, null, 1));
}
main();

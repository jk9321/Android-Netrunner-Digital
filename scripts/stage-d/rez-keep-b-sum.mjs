// Sums scripts/stage-d/rez-keep-b.ts output: node scripts/stage-d/rez-keep-b-sum.mjs <files or dirs...> [--list]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const list = args.includes('--list');
const files = args.filter(a => !a.startsWith('--')).flatMap(p => (statSync(p).isDirectory() ? readdirSync(p).filter(f => f.endsWith('.txt')).map(f => join(p, f)) : [p]));
const rows = files.flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));
const decisions = rows.filter(r => r.kind === 'decision');
const breaches = rows.filter(r => r.kind === 'breach');
const ends = rows.filter(r => r.kind === 'end');
const whoOf = {};
for (const r of [...decisions, ...breaches]) whoOf[r.src] = r.who;
const games = {};
for (const e of ends) {
  const who = e.src.startsWith('deal:') ? 'self' : whoOf[e.src] ?? 'person-?';
  games[who] = (games[who] ?? 0) + 1;
}
const arms = decisions.length ? Object.keys(decisions[0].ms).filter(a => a !== 'base') : [];
const per = (a, b) => (b ? (a / b).toFixed(2) : '-');
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = xs => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};
console.log(`Sources: games ${JSON.stringify(games)}; ${decisions.length} Corp decisions; ${breaches.length} breaches of a remote holding a non-agenda card; arms ${arms.join(', ')}\n`);

console.log('== Breaches of a remote holding a non-agenda root card');
for (const who of Object.keys(games)) {
  const bs = breaches.filter(b => b.who === who);
  if (!bs.length) continue;
  const iced = bs.filter(b => b.ice > 0);
  const passed = iced.filter(b => b.unrezzedLeft > 0);
  const short = passed.filter(b => b.turnStart.holds && !b.turnStart.heldNow);
  const unholdable = passed.filter(b => !b.turnStart.holds);
  const trashed = bs.filter(b => b.trashed.length);
  const notTrap = c => !c.trap;
  const worthOf = b => b.cards.filter(notTrap).reduce((n, c) => n + Math.max(0, c.w), 0);
  console.log(
    `${who}: ${bs.length} (${per(bs.length, games[who])} a game); behind ice ${iced.length}; ice passed unrezzed ${passed.length}, of which holdable but the Corp could not pay at the turn's start ${short.length}, no rez set holds ${unholdable.length}; a card trashed ${trashed.length} (behind ice ${trashed.filter(b => b.ice > 0).length}, in the 'could not pay' group ${short.filter(b => b.trashed.length).length})`,
  );
  console.log(`   worth of the non-trap cards (corpCardValue left, Corp view): all breaches mean ${mean(bs.map(worthOf)).toFixed(2)}; 'could not pay' group mean ${mean(short.map(worthOf)).toFixed(2)}; traps among breached cards ${bs.filter(b => b.cards.some(c => c.trap)).length}`);
  if (list)
    for (const b of short)
      console.log(`   SHORT ${b.src} T${b.T} ${b.server} ${b.cards.map(c => `${c.t}${c.trap ? '(trap)' : ''}${c.r ? '' : '(u)'} h${c.h} tc${c.tc} w${c.w}`).join('; ')} corp@start ${b.turnStart.corp} rez ${b.turnStart.rezCost} trashed ${b.trashed.join('|') || '-'} runner ${b.runnerAtBreach}->${b.runnerAfter}`);
}

console.log('\n== Decisions changed by each arm (Corp decisions, main phase and prompts)');
for (const who of Object.keys(games)) {
  const ds = decisions.filter(d => d.who === who);
  if (!ds.length) continue;
  for (const arm of arms) {
    const ch = ds.filter(d => d.changed.includes(arm));
    const more = ds.filter(d => d.staked[arm].length > d.staked.base.length);
    const kept = ds.filter(d => d.keep[arm] > d.keep.base);
    const err = ds.filter(d => (d.picks?.[arm] ?? '').startsWith('error'));
    console.log(`${who} ${arm}: changed ${ch.length} (${per(ch.length, games[who])} a game); stakes more ${more.length}; keep higher ${kept.length} (mean +${mean(kept.map(d => d.keep[arm] - d.keep.base)).toFixed(2)}); errors ${err.length}; changed by base pick type ${JSON.stringify(types(ch))}`);
  }
}

console.log('\n== Time and hold asks per decision (all decisions; and those where the arm stakes more)');
for (const arm of ['base', ...arms]) {
  const all = decisions;
  const more = decisions.filter(d => arm !== 'base' && d.staked[arm].length > d.staked.base.length);
  const r = xs => ({ ms: mean(xs.map(d => d.ms[arm])), base: mean(xs.map(d => d.ms.base)), asked: mean(xs.map(d => d.asked[arm])), askedBase: mean(xs.map(d => d.asked.base)) });
  const a = r(all);
  const m = more.length ? r(more) : null;
  console.log(`${arm.padEnd(10)} mean ${a.ms.toFixed(1)} ms (x${(a.ms / a.base).toFixed(3)}), median x${median(all.filter(d => d.ms.base > 50).map(d => d.ms[arm] / d.ms.base)).toFixed(3)} on decisions over 50 ms, max ${Math.max(...all.map(d => d.ms[arm]))} ms; hold asks mean ${a.asked.toFixed(1)} (x${(a.asked / a.askedBase).toFixed(2)})${m ? `; where it stakes more (${more.length}): ms x${(m.ms / m.base).toFixed(3)}, asks x${(m.asked / m.askedBase).toFixed(2)}` : ''}`);
}

if (list) {
  console.log('\n== Changed decisions (arm d9 first), with the next Runner turn on the added servers');
  for (const arm of arms)
    for (const d of decisions.filter(x => x.changed.includes(arm))) {
      const added = d.staked[arm].filter(id => !d.staked.base.includes(id));
      const next = breaches.filter(b => b.src === d.src && b.T === d.T && added.includes(b.server));
      const assets = (d.assets ?? []).filter(a => added.includes(a.id));
      console.log(
        `${arm} ${d.src} #${d.i} T${d.T} ${d.phase} corp ${d.corp} clicks ${d.clicks} keep ${d.keep.base}->${d.keep[arm]} added ${added.join(',') || '-'}\n    base ${short(d.picks.base)}\n    arm  ${short(d.picks[arm])}\n    ${assets.map(a => `${a.id}: ${a.cards.map(c => `${c.t}${c.trap ? '(trap)' : ''}${c.r ? '' : '(u)'} h${c.h} tc${c.tc} w${c.w}`).join('; ')} ice ${a.ice}/${a.unrezzed}u rez ${a.rezCost} price ${a.price} open ${a.open.need}/${a.open.budget} heldNow ${a.heldNow}`).join(' | ')}\n    next Runner turn on added: ${next.map(b => `${b.server} breached, trashed ${b.trashed.join('|') || '-'}, unrezzed left ${b.unrezzedLeft}, corp@start ${b.turnStart.corp}`).join('; ') || 'no breach'}`,
      );
    }
}

function types(ds) {
  const o = {};
  for (const d of ds) {
    const p = d.picks.base;
    const t = p && p.startsWith('{') ? JSON.parse(p).type : p;
    o[t] = (o[t] ?? 0) + 1;
  }
  return o;
}
function short(p) {
  if (!p || !p.startsWith('{')) return p;
  const a = JSON.parse(p);
  return [a.type, a.cardInstanceId, a.targetServerId ?? a.serverId ?? (a.asNewRemote ? 'new' : ''), a.abilityIndex ?? ''].filter(x => x !== undefined && x !== '').join(' ');
}

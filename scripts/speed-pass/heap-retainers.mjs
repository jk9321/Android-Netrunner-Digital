// Speed pass G0 leak check (ruling "G0, ruled" 3): who holds a G board after the move. Reads a heap snapshot that
// g0-heap.ts wrote with SNAP=<n> (the boards still alive are under globalThis.__leaked) and prints, for each board, the
// shortest strong retainer path to a GC root that does not run through __leaked.
//   node --max-old-space-size=8000 scripts/speed-pass/heap-retainers.mjs <file.heapsnapshot>
import { readFileSync } from 'node:fs';

const snap = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const { node_fields: nf, edge_fields: ef, node_types: nt, edge_types: et } = snap.snapshot.meta;
const N = nf.length;
const E = ef.length;
const nodes = snap.nodes;
const edges = snap.edges;
const str = snap.strings;
const nTypes = nt[0];
const eTypes = et[0];
const iType = nf.indexOf('type');
const iName = nf.indexOf('name');
const iEdges = nf.indexOf('edge_count');
const count = nodes.length / N;
// First edge of each node, and the reverse edges (to node index -> [from node index, edge index])
const first = new Uint32Array(count + 1);
for (let i = 0, e = 0; i < count; i++) {
  first[i] = e;
  e += nodes[i * N + iEdges];
  first[i + 1] = e;
}
const edgeName = e => {
  const t = eTypes[edges[e * E]];
  const v = edges[e * E + 1];
  return t === 'element' || t === 'hidden' ? `[${v}]` : str[v];
};
const nodeName = i => `${nTypes[nodes[i * N + iType]]}:${str[nodes[i * N + iName]].slice(0, 60)}`;
const rev = new Map();
for (let i = 0; i < count; i++)
  for (let e = first[i]; e < first[i + 1]; e++) {
    if (eTypes[edges[e * E]] === 'weak') continue;
    const to = edges[e * E + 2] / N;
    let r = rev.get(to);
    if (!r) rev.set(to, (r = []));
    r.push([i, e]);
  }
// The leaked array: the target of a property edge named __leaked
let leakedArr = -1;
for (let e = 0; e < edges.length / E && leakedArr < 0; e++) if (eTypes[edges[e * E]] === 'property' && str[edges[e * E + 1]] === '__leaked') leakedArr = edges[e * E + 2] / N;
if (leakedArr < 0) throw new Error('no __leaked in this snapshot');
const boards = [];
for (let e = first[leakedArr]; e < first[leakedArr + 1]; e++) if (eTypes[edges[e * E]] === 'element') boards.push(edges[e * E + 2] / N);
console.log(`${boards.length} leaked boards`);
const isRoot = i => nTypes[nodes[i * N + iType]] === 'synthetic';
for (const b of boards.slice(0, 5)) {
  // Breadth first over retainers, never through the __leaked array
  const prev = new Map([[b, null]]);
  const queue = [b];
  let root = -1;
  while (queue.length && root < 0) {
    const x = queue.shift();
    for (const [from, e] of rev.get(x) ?? []) {
      if (from === leakedArr || prev.has(from)) continue;
      prev.set(from, [x, e]);
      if (isRoot(from)) {
        root = from;
        break;
      }
      queue.push(from);
    }
  }
  const path = [];
  for (let x = root; x >= 0 && prev.get(x); x = prev.get(x)[0]) path.push(`${nodeName(x)} .${edgeName(prev.get(x)[1])}`);
  console.log(`board ${nodeName(b)}:\n  ${root < 0 ? '(only through __leaked)' : path.join('\n  -> ')}`);
}

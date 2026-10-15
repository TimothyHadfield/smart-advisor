// Run: node tests/layout.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildModel, flowNodes, flowEdges } from '../js/planner.js';
import { layoutGraph, countCrossings, labPairs, foldLabs } from '../js/layout.js';

const ee = JSON.parse(readFileSync(fileURLToPath(new URL('../data/programs/ee-bs.json', import.meta.url)), 'utf8'));
const model = buildModel(ee);
const nodes = flowNodes(model);
const edges = flowEdges(model);

// The layout the app used before js/layout.js (copied from the old js/app.js columns()):
// columns by prereq depth, each column sorted by the average row of its prereqs, centred.
function oldColumns() {
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  const coreqPartner = (n) => nodes.find((m) => m !== n && ((n.coreqs || []).includes(m.code) || (m.coreqs || []).includes(n.code)));
  const isolated = (n) => !linked.has(n.id) && !(coreqPartner(n) && linked.has(coreqPartner(n).id));
  const hasIso = nodes.some(isolated);
  const cols = [];
  for (const n of nodes) {
    const c = isolated(n) ? 0 : n.depth + (hasIso ? 1 : 0);
    (cols[c] ??= []).push(n);
  }
  const pos = new Map();
  const into = (n) => edges.filter((e) => e.to === n.id).map((e) => pos.get(e.from)).filter((v) => v !== undefined);
  cols.forEach((col, ci) => {
    if (!col) { cols[ci] = []; return; }
    if (ci > 0 || !hasIso) {
      const key = new Map(col.map((n) => { const p = into(n); return [n.id, p.length ? p.reduce((a, b) => a + b, 0) / p.length : -1 + n.order / 1000]; }));
      col.sort((a, b) => key.get(a.id) - key.get(b.id) || a.order - b.order);
    }
    for (const n of col.slice()) {
      const p = coreqPartner(n);
      if (!p || !col.includes(p) || n.credits < p.credits || (n.credits === p.credits && n.order > p.order)) continue;
      col.splice(col.indexOf(p), 1);
      col.splice(col.indexOf(n) + 1, 0, p);
    }
    col.forEach((n, i) => pos.set(n.id, i - col.length / 2));
  });
  const at = new Map();
  cols.forEach((col, ci) => col.forEach((n, ri) => at.set(n.id, { col: ci, y: ri - col.length / 2 })));
  return at;
}

const oldAt = oldColumns();
const oldPaths = edges.map((e) => [oldAt.get(e.from), oldAt.get(e.to)]);
const L = layoutGraph(nodes, edges, { pairs: labPairs(nodes) });
const newPaths = L.paths.map((p) => p.pts);
const before = countCrossings(oldPaths);
const after = countCrossings(newPaths);
console.log(`EE flowchart arrow crossings: old layout ${before}, new layout ${after}`);

test('countCrossings counts a simple X and ignores touching ends', () => {
  assert.equal(countCrossings([[[0, 0], [1, 1]], [[0, 1], [1, 0]]]), 1);
  assert.equal(countCrossings([[[0, 0], [1, 0]], [[0, 1], [1, 1]]]), 0);
  assert.equal(countCrossings([[[0, 0], [1, 1]], [[0, 0], [1, -1]]]), 0, 'same start box');
  // a long straight arrow crossing a short one in the middle gap
  assert.equal(countCrossings([[[0, 0], [2, 2]], [[1, 2], [2, 0]]]), 1);
});

test('new layout has far fewer arrow crossings than the old one on the real EE data', () => {
  assert.ok(before >= 20, `old layout should have plenty of crossings (got ${before})`);
  assert.ok(after <= before / 2, `new ${after} should be at most half of old ${before}`);
  assert.equal(after, L.crossings, 'geometric count matches the order-based count');
});

test('every box is placed once, no two boxes overlap, arrows only go rightward', () => {
  assert.equal(L.pos.size, nodes.length);
  const byCol = new Map();
  for (const n of nodes) {
    const p = L.pos.get(n.id);
    assert.ok(p && Number.isFinite(p.y), n.id);
    assert.ok(p.y >= 0.5 - 1e-9 && p.y <= L.height - 0.5 + 1e-9, `${n.id} inside the chart`);
    (byCol.get(p.col) ?? byCol.set(p.col, []).get(p.col)).push(p.y);
  }
  for (const ys of byCol.values()) {
    ys.sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= 1 - 1e-6, 'boxes overlap');
  }
  for (const p of L.paths) {
    for (let k = 1; k < p.pts.length; k++) assert.equal(p.pts[k].col, p.pts[k - 1].col + 1, `${p.from}>${p.to} skips a column`);
  }
  assert.equal(L.paths.length, edges.length);
});

test('long arrows pass between boxes, not through them', () => {
  const boxesInCol = new Map();
  for (const n of nodes) { const p = L.pos.get(n.id); (boxesInCol.get(p.col) ?? boxesInCol.set(p.col, []).get(p.col)).push(p.y); }
  for (const p of L.paths) for (const q of p.pts.slice(1, -1)) {
    for (const y of boxesInCol.get(q.col) || []) assert.ok(Math.abs(q.y - y) >= 0.5, `${p.from}>${p.to} runs through a box in column ${q.col}`);
  }
});

test('prereqs sit left of the courses that need them; labs (when drawn separately) share their lecture column', () => {
  for (const e of edges) assert.ok(L.pos.get(e.from).col < L.pos.get(e.to).col, `${e.from} > ${e.to}`);
  for (const [lec, lab] of labPairs(nodes)) if (!L.isolated.includes(lec)) assert.equal(L.pos.get(lec).col, L.pos.get(lab).col, `${lec}/${lab}`);
});

test('boxes with no arrows form their own row under the graph', () => {
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  assert.ok(L.isolated.length >= 5);
  const graphBottom = Math.max(...nodes.filter((n) => !L.isolated.includes(n.id)).map((n) => L.pos.get(n.id).y));
  const rowY = Math.min(...L.isolated.map((id) => L.pos.get(id).y));
  assert.ok(rowY >= graphBottom + 1.5, 'set apart from the graph');
  for (const id of L.isolated) assert.ok(!linked.has(id), id);
  assert.ok(L.isolated.some((id) => id.startsWith('ph:')), 'Gen Ed placeholders are in that row');
});

// Tim's own EE flowchart (docs/reference/ee-flowchart-tim.png), read off the picture: [column, y px].
// His chart leaves out MATH 1210, the electives and the labs, so this is his graph, not the catalog's.
const TIM_POS = {
  'ECE 1000': [0, 513], 'ECE 3710': [0, 655], 'PHYS 2210': [0, 988], 'CS 1400': [0, 1111], 'MATH 1220': [0, 1233],
  'ECE 2700': [1, 344], 'ECE 2750': [1, 513], 'PHYS 2220': [1, 944], 'MATH 2210': [1, 1233],
  'ECE 3740': [2, 244], 'ECE 3770': [2, 544], 'ECE 2250': [2, 877],
  'ECE 4700': [3, 200], 'ECE 3730': [3, 344], 'ECE 3350': [3, 477], 'ECE 3780': [3, 600], 'ECE 4750': [3, 711],
  'ECE 3250': [3, 811], 'ECE 3760': [3, 922], 'ECE 3450': [3, 1022],
  'ECE 4730': [4, 311], 'ECE 4760': [4, 922], 'ECE 4900': [5, 311], 'ECE 4950': [6, 311],
};
const TIM_EDGES = ('ECE 1000>ECE 2700,ECE 1000>ECE 2750,ECE 1000>ECE 2250,ECE 2700>ECE 3740,ECE 2700>ECE 3730,' +
  'ECE 3740>ECE 4700,ECE 3740>ECE 4730,ECE 3730>ECE 4730,ECE 2750>ECE 3350,ECE 2750>ECE 3770,ECE 3770>ECE 3350,' +
  'ECE 3770>ECE 3780,ECE 3770>ECE 4750,ECE 3710>ECE 3780,ECE 3710>ECE 4750,ECE 2250>ECE 3730,ECE 2250>ECE 3250,' +
  'ECE 2250>ECE 3760,ECE 2250>ECE 3450,PHYS 2210>PHYS 2220,PHYS 2220>ECE 2250,PHYS 2220>ECE 3760,PHYS 2220>ECE 3450,' +
  'ECE 3760>ECE 4760,ECE 4900>ECE 4950,MATH 1220>MATH 2210').split(',').map((s) => { const [from, to] = s.split('>'); return { from, to }; });

test("on Tim's own graph the auto layout crosses no more than his hand layout", () => {
  const tim = countCrossings(TIM_EDGES.map((e) => [TIM_POS[e.from], TIM_POS[e.to]]));
  const T = layoutGraph(Object.keys(TIM_POS).map((id, order) => ({ id, order })), TIM_EDGES);
  const ours = countCrossings(T.paths.map((p) => p.pts));
  console.log(`Tim's graph: his layout ${tim} crossings, auto layout ${ours}`);
  assert.ok(ours <= tim, `${ours} > ${tim}`);
  assert.equal(T.clusters, 3, 'main graph + ECE 4900>4950 + MATH 1220>2210 as their own clusters');
  assert.deepEqual(T.isolated, ['CS 1400']);
  // the small clusters don't sit among the main graph's boxes
  for (const id of ['ECE 4900', 'MATH 1220']) {
    const p = T.pos.get(id);
    for (const [other, q] of T.pos) if (other !== id && q.col === p.col) assert.ok(Math.abs(q.y - p.y) >= 1, `${id} vs ${other}`);
  }
});

test('real EE chart with labs folded into their lecture: few crossings, every lab folded', () => {
  const F = foldLabs(nodes, edges);
  const FL = layoutGraph(F.nodes, F.edges);
  const x = countCrossings(FL.paths.map((p) => p.pts));
  console.log(`EE chart as drawn (labs folded): ${x} crossings, ${FL.clusters} clusters, ${F.nodes.length} boxes`);
  assert.ok(x <= 10, `${x} crossings`);
  const folded = F.nodes.flatMap((n) => n.labs.map((l) => l.id)).sort();
  assert.deepEqual(folded, ['CHEM 1215', 'ECE 2255', 'ECE 2705', 'ECE 3765', 'ECE 3785', 'ECE 4755', 'ECE 4765', 'PHYS 2215', 'PHYS 2225']);
  assert.ok(!F.nodes.some((n) => folded.includes(n.id)));
  assert.ok(F.edges.some((e) => e.from === 'ECE 2250' && e.to === 'ECE 3760'), 'lab arrows move to the lecture box');
});

// Run: node tests/layout.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildModel, flowNodes, flowEdges } from '../js/planner.js';
import { layoutGraph, countCrossings, labPairs, foldLabs, flowChart, chartStats, splitGenEd } from '../js/layout.js';

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

// ---- the drawn chart (pixels) ----
// The arrows as the app drew them before routeChart (js/app.js layout() at 9d42e08, laptop size
// 1040x826): the "before" for the bends / overlap numbers. Arrows from one box shared a track there.
const OLD_DRAWN = { crossings: 8, bends: 104, straight: 5, overlaps: 80 }; // measured with chartStats
const F0 = foldLabs(nodes, edges);
const CH = flowChart(F0.nodes, F0.edges);
const ST = chartStats(CH);
console.log(`EE chart drawn: crossings ${OLD_DRAWN.crossings} -> ${ST.crossings}, bends ${OLD_DRAWN.bends} -> ${ST.bends}, ` +
  `straight arrows ${OLD_DRAWN.straight} -> ${ST.straight} of ${ST.edges}, overlapping pieces ${OLD_DRAWN.overlaps} -> ${ST.overlaps.length}`);

test('chartStats spots shared lines, lines through boxes, bends and crossings', () => {
  const boxes = new Map([['A', { x: 0, y: 0, w: 10, h: 10 }], ['B', { x: 50, y: 0, w: 10, h: 10 }], ['M', { x: 25, y: 40, w: 10, h: 10 }]]);
  const st = chartStats({ boxes, edges: [
    { from: 'A', to: 'B', pts: [[10, 5], [50, 5]] },                        // straight
    { from: 'A', to: 'M', pts: [[10, 6], [20, 6], [20, 45], [25, 45]] },    // runs on top of A>B for 10px
    { from: 'X', to: 'Y', pts: [[30, 30], [30, 60]] },                      // through box M
    { from: 'P', to: 'Q', pts: [[12, -5], [12, 40]] },                      // crosses A>B and A>M's level piece
  ] });
  assert.equal(st.straight, 3);
  assert.equal(st.bends, 2);
  assert.equal(st.overlaps.length, 1, st.overlaps.join());
  assert.ok(st.boxHits.some((s) => s.includes('M')), st.boxHits.join());
  assert.equal(st.crossings, 2); // P>Q crosses A>B and A>M (level piece at y=6)
});

test('drawn EE chart: no two arrows share or hug a line, no arrow runs through a box', () => {
  assert.deepEqual(ST.overlaps, [], 'arrows on top of each other');
  assert.deepEqual(ST.boxHits, [], 'arrows through boxes');
  // and the old drawing did have them (the check isn't vacuous)
  assert.ok(OLD_DRAWN.overlaps > 0);
});

test('drawn EE chart: far fewer bends, many straight arrows, at most one jog almost everywhere', () => {
  assert.ok(ST.bends <= OLD_DRAWN.bends / 2, `bends ${ST.bends}`);
  assert.ok(ST.straight >= 15, `straight ${ST.straight}`);
  assert.ok(ST.crossings <= OLD_DRAWN.crossings, `crossings ${ST.crossings}`);
  const multi = CH.edges.filter((e) => e.pts.length > 4).map((e) => `${e.from}>${e.to}`);
  assert.ok(multi.length <= 1, `arrows with more than one jog: ${multi}`);
  for (const e of CH.edges) {
    for (let k = 1; k < e.pts.length; k++) {
      const [x1, y1] = e.pts[k - 1], [x2, y2] = e.pts[k];
      assert.ok(Math.abs(x1 - x2) < 0.01 || Math.abs(y1 - y2) < 0.01, 'only level and upright pieces');
      assert.ok(x2 >= x1 - 0.01, 'never runs backwards');
    }
    const a = CH.boxes.get(e.from), b = CH.boxes.get(e.to);
    assert.equal(e.pts[0][0], a.x + a.w, 'leaves from the right side');
    assert.equal(e.pts.at(-1)[0], b.x, 'arrives at the left side');
    assert.ok(e.pts[0][1] > a.y && e.pts[0][1] < a.y + a.h && e.pts.at(-1)[1] > b.y && e.pts.at(-1)[1] < b.y + b.h);
  }
});

test('each arrow has its own exit and entry point, and jogs in one gap are spaced apart', () => {
  const ends = new Set();
  for (const e of CH.edges) for (const [x, y] of [e.pts[0], e.pts.at(-1)]) {
    const k = `${x},${y}`;
    assert.ok(!ends.has(k), `two arrows share the point ${k}`);
    ends.add(k);
  }
  const xs = [...new Set(CH.edges.flatMap((e) => e.pts.slice(1, -1).map((p) => p[0])))].sort((p, q) => p - q);
  const boxEdges = new Set([...CH.boxes.values()].flatMap((r) => [r.x, r.x + r.w]));
  for (let i = 1; i < xs.length; i++) if (!boxEdges.has(xs[i]) && !boxEdges.has(xs[i - 1])) assert.ok(xs[i] - xs[i - 1] >= 8 - 1e-6, `tracks ${xs[i - 1]} / ${xs[i]} too close`);
});

test('Gen Ed boxes get their own section under the chart; MATH 1210 (prereq of the core) stays in the chart', () => {
  const { gen } = splitGenEd(F0.nodes, F0.edges);
  const ids = gen.nodes.map((n) => n.id);
  for (const id of ['ENGL 1010', 'ENGL 2010', 'COMM 1020', 'CHEM 1210']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('MATH 1210'));
  assert.ok(CH.genTop !== null);
  for (const id of ids) assert.ok(CH.boxes.get(id).y > CH.genTop, `${id} under the Gen Ed heading`);
  for (const n of F0.nodes) if (!ids.includes(n.id)) assert.ok(CH.boxes.get(n.id).y + CH.boxes.get(n.id).h < CH.genTop, `${n.id} above it`);
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

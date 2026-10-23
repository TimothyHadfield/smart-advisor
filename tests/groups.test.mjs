// Requirement groups under the flowchart (js/groups.js): loose boxes go in labelled frames.
// Run: node --test tests/groups.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildModel, flowNodes, flowEdges, optionDone, unitDone } from '../js/planner.js';
import { foldLabs, flowChart } from '../js/layout.js';
import { groupNodes, placeGroups, groupProgress, shortName, fullText } from '../js/groups.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => JSON.parse(readFileSync(root + f, 'utf8'));
const extra = { extraCourses: read('data/prereq-courses.json'), gened: read('data/gened.json') };
const SIZES = { boxW: 116, boxH: 48, rowH: 58, gapMin: 26, port: 10, near: 8, pad: 12, track: 9 };

function build(id) {
  const model = buildModel(read(`data/programs/${id}.json`), extra);
  const { nodes, edges } = foldLabs(flowNodes(model), flowEdges(model));
  const G = groupNodes(model, nodes, edges, []);
  const chart = placeGroups(flowChart(G.chart, edges, SIZES, []), G.groups, SIZES, []);
  return { model, nodes, edges, G, chart };
}
const overlap = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
const inside = (r, f) => r.x >= f.x - 0.5 && r.y >= f.y - 0.5 && r.x + r.w <= f.x + f.w + 0.5 && r.y + r.h <= f.y + f.h + 0.5;

test('a "choose N" requirement becomes one group titled with its count, holding its option classes', () => {
  const { G, chart } = build('art-design-bs');
  // "Choose 15 credits" (catalog: "Complete 5 Upper division ART classes"), 6 options, no lines
  const g = G.groups.find((x) => x.unit?.label === 'Choose 15 credits');
  assert.ok(g, 'group exists');
  assert.equal(g.kind, 'pick');
  assert.equal(g.title, 'Pick 15 cr · Upper Division Core');
  assert.equal(g.items.length + g.inChart, 6); // ART 3660R has a prereq line: it stays in the chart
  for (const id of g.items) assert.ok(inside(chart.boxes.get(id), chart.frames.get(g.id)), `${id} inside its frame`);
  assert.ok(chart.inChart.has(g.id));
  // a long list with no lines: the old "Choose N" box is gone; its classes are boxes now
  const l = G.groups.find((x) => x.unit?.label === 'ART/ARTH Lower Division');
  assert.equal(l.title, 'Pick 9 cr · ART/ARTH Lower Division');
  assert.ok(!G.boxes.some((n) => n.id === l.unit.id));
  assert.equal(l.items.length, 7);
  assert.ok(l.items.every((id) => G.boxes.some((n) => n.id === id && n.kind === 'option')));
});

test('the group is met (turns green) once enough of its classes are taken', () => {
  const { G } = build('art-design-bs');
  const g = G.groups.find((x) => x.unit?.label === 'ART/ARTH Lower Division');
  const opts = g.unit.options;
  const s = new Set();
  const doneOf = () => false;
  assert.deepEqual(groupProgress(g, s, doneOf), { text: '0 of 9 cr', met: false });
  for (const o of opts.slice(0, 2)) o.codes.forEach((c) => s.add(c));
  const p2 = groupProgress(g, s, doneOf);
  assert.equal(p2.met, false);
  assert.match(p2.text, /^6 of 9 cr$/);
  for (const o of opts) { if (unitDone(g.unit, s)) break; o.codes.forEach((c) => s.add(c)); }
  assert.deepEqual(groupProgress(g, s, doneOf), { text: '9 of 9 cr', met: true });
  // a count pick: "Pick 1" -> "0 of 1" -> "1 of 1"
  const { G: P } = build('public-health-bs');
  const c = P.groups.find((x) => x.kind === 'pick' && x.unit.pick?.count === 1 && !x.unit.pick.credits);
  assert.ok(c, 'a pick-1 group');
  const t = new Set();
  assert.deepEqual(groupProgress(c, t), { text: '0 of 1', met: false });
  c.unit.options[0].codes.forEach((k) => t.add(k));
  assert.ok(optionDone(c.unit.options[0], t));
  assert.deepEqual(groupProgress(c, t), { text: '1 of 1', met: true });
});

test('required classes with no lines land in one "Also required" grid', () => {
  const { G, chart } = build('dental-hygiene-aas');
  const all = G.groups.filter((g) => g.kind === 'all');
  assert.equal(all.length, 1);
  assert.equal(all[0].title, 'Also required');
  assert.ok(all[0].items.length >= 12);
  const rs = all[0].items.map((id) => chart.boxes.get(id));
  const rows = new Set(rs.map((r) => r.y)), cols = new Set(rs.map((r) => r.x));
  assert.ok(rows.size >= 2 && cols.size >= 3, `grid ${cols.size} x ${rows.size}`);
  assert.ok(rows.size <= Math.ceil(rs.length / cols.size), 'rows filled before a new row starts');
  // progress counts taken classes
  const s = new Set();
  const doneOf = (id) => s.has(id);
  s.add(all[0].items[0]);
  assert.deepEqual(groupProgress(all[0], s, doneOf), { text: `1 of ${all[0].items.length}`, met: false });
});

test('a long list shows a few classes and "+N more"; a stub label shows its catalog line', () => {
  const { G, chart } = build('environmental-studies-bs');
  const big = G.groups.find((g) => g.kind === 'pick' && g.more.length);
  assert.ok(big, 'a long list');
  assert.equal(big.items.length, 5);
  assert.equal(big.items.length + big.more.length, big.unit.options.length);
  assert.ok(chart.more.has(big.id) && inside(chart.more.get(big.id), chart.frames.get(big.id)));
  // "Elective" placeholder -> its catalog wording
  assert.equal(fullText({ label: 'Elective', src: 'Elective Requirements (21 credits) › Complete any courses 3000 or higher' }), 'Complete any courses 3000 or higher');
  assert.equal(shortName({ label: 'Complete one of the following:', area: 'Upper Division Core' }), 'Upper Division Core');
  assert.equal(shortName({ label: 'ART/ARTH Lower Division', area: 'Lower Division Core' }), 'ART/ARTH Lower Division');
});

test('every program: every box is placed once, groups never overlap the chart or each other', () => {
  const dir = root + 'data/programs/';
  let n = 0, frames = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const p = read('data/programs/' + f);
    if (!p.requirements) continue;
    const { G, chart } = build(f.replace('.json', ''));
    n++;
    for (const b of G.boxes) assert.ok(chart.boxes.has(b.id), `${f}: ${b.id} placed`);
    const fr = [...chart.frames.entries()];
    frames += fr.length;
    for (let i = 0; i < fr.length; i++) for (let j = i + 1; j < fr.length; j++) assert.ok(!overlap(fr[i][1], fr[j][1]), `${f}: ${fr[i][0]} / ${fr[j][0]}`);
    const inGroup = new Set(G.groups.flatMap((g) => g.items));
    for (const [id, r] of chart.boxes) {
      if (inGroup.has(id)) continue;
      for (const [gid, q] of fr) assert.ok(!overlap(r, q), `${f}: chart box ${id} under frame ${gid}`);
    }
    for (const g of G.groups) for (const id of g.items) assert.ok(inside(chart.boxes.get(id), chart.frames.get(g.id)), `${f}: ${id} in ${g.id}`);
    assert.ok(Number.isFinite(chart.width) && Number.isFinite(chart.height), `${f}: size`);
    for (const [, r] of chart.boxes) assert.ok(r.y + r.h <= chart.height + 0.5 && r.x + r.w <= chart.width + 0.5, `${f}: inside the chart`);
  }
  assert.ok(n > 400 && frames > 1000, `${n} programs, ${frames} frames`);
});

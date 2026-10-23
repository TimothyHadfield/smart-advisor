// Run: node --test tests/matric.test.mjs
// Matriculation: the dotted line in the flowchart (classes that need program admission on its right, the
// rest on its left) and the facts its sheet shows. Real program data, built like the site builds it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildModel, flowNodes, flowEdges } from '../js/planner.js';
import { flowChart, foldLabs, layoutGraph, routeChart } from '../js/layout.js';
import { matricSides, matricFacts, sectionText, codeStatus } from '../js/matric.js';

const ROOT = fileURLToPath(new URL('../data/', import.meta.url));
const rj = (p) => JSON.parse(readFileSync(ROOT + p, 'utf8'));
const EXTRA = { extraCourses: rj('prereq-courses.json'), gened: rj('gened.json'), seasons: rj('seasons.json') };
const SIZES = { boxH: 48, rowH: 58, gapMin: 26, port: 10, near: 8, pad: 12, boxW: 116, track: 9 };
function chartOf(id) {
  const program = rj(`programs/${id}.json`);
  const model = buildModel(program, EXTRA);
  const { nodes, edges } = foldLabs(flowNodes(model), flowEdges(model));
  const sides = matricSides(nodes, edges);
  const chart = flowChart(nodes, edges, { ...SIZES, split: sides?.after });
  return { program, nodes, edges, sides, chart };
}
const codesOf = (n) => [n, ...(n.labs || [])].flatMap((u) => u.codes || [u.code]).filter(Boolean);
// The line bends (upright runs down column gaps, level steps between rows), so a box's side is read off
// the upright run at the box's height. A box no line can put on its side is outlined instead (strays).
function lineXAt(split, y) {
  const p = split.pts;
  for (let k = 1; k < p.length; k++) if (p[k - 1][0] === p[k][0] && y >= Math.min(p[k - 1][1], p[k][1]) && y <= Math.max(p[k - 1][1], p[k][1])) return p[k][0];
  return null;
}
const sideOf = (split, r) => { const x = lineXAt(split, r.y + r.h / 2); return r.x > x ? 'right' : r.x + r.w < x ? 'left' : 'on'; };
const outlined = (split, r) => split.strays.some((s) => s.x === r.x && s.y === r.y);
const through = (split, r) => split.pts.slice(1).some((q, k) => { // a piece of the line inside the box
  const [x1, y1] = split.pts[k], [x2, y2] = q;
  return Math.min(x1, x2) < r.x + r.w && Math.max(x1, x2) > r.x && Math.min(y1, y2) < r.y + r.h && Math.max(y1, y2) > r.y;
});

test('EE BS: a dotted line with the catalog\'s matriculation list on its left and the admission-only classes on its right', () => {
  const { program, nodes, sides, chart } = chartOf('electrical-engineering-bs');
  const info = program.admissionInfo;
  assert.ok(sides, 'EE has classes that need matriculation');
  assert.ok(chart.split, 'the chart has a line');
  // every class the catalog lists as needing admission, drawn as a box, is right of the line
  const box = (code) => nodes.find((n) => codesOf(n).includes(code));
  for (const code of info.gated) {
    const n = box(code);
    if (!n) continue;
    const r = chart.boxes.get(n.id);
    assert.ok(sides.after.has(n.id), `${code} needs matriculation`);
    assert.ok(sideOf(chart.split, r) === 'right' || outlined(chart.split, r), `${code} (x ${r.x}) right of the line (x ${lineXAt(chart.split, r.y + r.h / 2)})`);
  }
  // the catalog's "complete before admission" classes are all left of it
  let left = 0;
  for (const code of info.before) {
    const n = box(code);
    if (!n) continue;
    const r = chart.boxes.get(n.id);
    assert.ok(!sides.after.has(n.id), `${code} doesn't need matriculation`);
    assert.equal(sideOf(chart.split, r), 'left', `${code} left of the line`);
    left++;
  }
  assert.ok(left >= 8, `the matriculation list is drawn (${left} boxes)`);
  // and every box of the main chart is on its own side, or (when no line can do it) outlined; the line
  // never runs through a box. EE has one outlined box at most (ECE 4810R: an arrowless box in the bottom
  // row's first column, with a box that doesn't need matriculation to its right)
  for (const id of chart.layout.pos.keys()) {
    const r = chart.boxes.get(id);
    assert.ok(!through(chart.split, r), `the line runs through ${id}`);
    if (outlined(chart.split, r)) continue;
    assert.equal(sideOf(chart.split, r), sides.after.has(id) ? 'right' : 'left', id);
  }
  assert.ok(chart.split.strays.length <= 1, `outlined boxes: ${chart.split.strays.length}`);
  // the line only runs level or upright, top to bottom
  for (let k = 1; k < chart.split.pts.length; k++) {
    const [a, b] = [chart.split.pts[k - 1], chart.split.pts[k]];
    assert.ok(a[0] === b[0] || a[1] === b[1], 'level or upright');
    assert.ok(b[1] >= a[1], 'never runs back up');
  }
  // the line runs from the label band at the top down past the chart's last box (not into Gen Ed)
  const mainBottom = Math.max(...[...chart.layout.pos.keys()].map((id) => chart.boxes.get(id).y + chart.boxes.get(id).h));
  assert.ok(chart.split.top < Math.min(...[...chart.boxes.values()].map((r) => r.y)), 'label band above every box');
  assert.deepEqual(chart.split.pts[0], [chart.split.x, chart.split.top], 'the label sits on the top end of the line');
  assert.ok(chart.split.bottom >= mainBottom - 1 && chart.split.bottom < chart.genTop, 'line ends above Gen Ed');
  // no arrow's upright jog runs along an upright run of the line
  for (const e of chart.edges) for (let i = 1; i < e.pts.length; i++) {
    const [a, b] = [e.pts[i - 1], e.pts[i]];
    if (a[0] !== b[0]) continue;
    for (let k = 1; k < chart.split.pts.length; k++) {
      const [c, d] = [chart.split.pts[k - 1], chart.split.pts[k]];
      if (c[0] !== d[0]) continue;
      const overlap = Math.min(Math.max(a[1], b[1]), d[1]) - Math.max(Math.min(a[1], b[1]), c[1]);
      if (overlap > 1) assert.ok(Math.abs(a[0] - c[0]) > 2, `${e.from} -> ${e.to} jog on the line`);
    }
  }
});

test('a program without matriculation has no line, and the layout is unchanged', () => {
  for (const id of ['mathematics-emphasis-bs', 'history-ba']) {
    let got;
    try { got = chartOf(id); } catch { continue; }
    assert.equal(got.sides, null, `${id}: no class needs admission`);
    assert.equal(got.chart.split, null, `${id}: no line`);
  }
  // asking for no split = the old layout exactly
  const p = rj('programs/electrical-engineering-bs.json');
  const model = buildModel(p, EXTRA);
  const { nodes, edges } = foldLabs(flowNodes(model), flowEdges(model));
  const a = flowChart(nodes, edges, SIZES), b = flowChart(nodes, edges, { ...SIZES, split: new Set() });
  assert.equal(a.split, null);
  assert.deepEqual([...b.boxes], [...a.boxes]);
});

// Tim (2026-10-22): "I was meaning that we would keep the flowchart identical to how it is and we would
// bend the dotted line to fit around the classes."
test('the matriculation line moves no box: positions are identical with and without it', () => {
  for (const id of ['electrical-engineering-bs', 'computer-engineering-bs', 'software-engineering-bs', 'finance-bs', 'accounting-bs', 'nursing-bs']) {
    const { nodes, edges, sides } = chartOf(id);
    assert.ok(sides, `${id} has a line`);
    const a = flowChart(nodes, edges, SIZES), b = flowChart(nodes, edges, { ...SIZES, split: sides.after });
    assert.deepEqual([...b.layout.pos], [...a.layout.pos], `${id}: same layout`);
    assert.deepEqual([...b.boxes].map(([k, r]) => [k, r.x]), [...a.boxes].map(([k, r]) => [k, r.x]), `${id}: same columns`);
    // the label band above the chart moves everything down by one amount; nothing else changes
    const dy = new Set([...a.boxes].map(([k, r]) => +(b.boxes.get(k).y - r.y).toFixed(6)));
    assert.equal(dy.size, 1, `${id}: boxes shift by one amount (${[...dy]})`);
  }
});

test('the line bends around the boxes (arrowless ones too) instead of moving them', () => {
  const nodes = ['A', 'B', 'C', 'D', 'X', 'Y', 'Z'].map((id) => ({ id }));
  const edges = [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'A', to: 'D' }];
  const L = layoutGraph(nodes, edges);
  for (const split of [new Set(['D', 'Z']), new Set(['A', 'B', 'C', 'D']), new Set(['B', 'C', 'D', 'Y', 'Z'])]) {
    const R = routeChart(L, { ...SIZES, split });
    assert.ok(R.split, [...split].join());
    assert.deepEqual(R.split.strays, [], `${[...split]}: one line separates them`);
    for (const [id, r] of R.boxes) {
      assert.ok(!through(R.split, r), `${id}: line through the box`);
      assert.equal(sideOf(R.split, r), split.has(id) ? 'right' : 'left', `${[...split]}: ${id}`);
    }
  }
  // a box that needs it with one that doesn't to its right in the same row: no line can do it, so it's outlined
  const R = routeChart(L, { ...SIZES, split: new Set(['A']) });
  assert.ok(R.split.strays.length >= 1, 'outlined');
});

test('EE sheet facts come from the catalog section: GPA, grade, the 12 classes, catalog link', () => {
  const f = matricFacts(rj('programs/electrical-engineering-bs.json'));
  assert.equal(f.gpa, '2.5');
  assert.equal(f.minGrade, 'C');
  assert.equal(f.before.length, 12);
  assert.ok(f.before.includes('MATH 1210') && f.before.includes('ECE 2250'));
  assert.match(f.text, /^To be admitted to the BSEE program/);
  assert.match(f.text, /provisional admission status/);
  assert.match(f.text, /MATH 1210, MATH 1220, PHYS 2210, PHYS 2215/, 'the class list keeps every code, without titles');
  assert.doesNotMatch(f.text, /Calculus I QL/);
  assert.equal(f.deadline, null, 'no deadline in the catalog');
  assert.match(f.url, /^https:\/\/catalog\.uvu\.edu\/.+electrical-engineering-bs\/#:~:text=To%20be%20admitted/);
});

test('sheet text: table headings dropped, a class named in a sentence keeps its title', () => {
  const courses = { 'SW 1010': { title: 'Introduction to Social Work' }, 'PSY 1010': { title: 'General Psychology' }, 'ACC 2110': { title: 'Principles of Accounting I' }, 'ACC 2120': { title: 'Principles of Accounting II' } };
  assert.equal(sectionText('Completion of SW 1010 Introduction to Social Work and PSY 1010 General Psychology with a B- grade or higher.', [], courses),
    'Completion of SW 1010 Introduction to Social Work and PSY 1010 General Psychology with a B- grade or higher.');
  assert.equal(sectionText('Course List Code Title Credit Hours ACC 2110 Principles of Accounting I 3 ACC 2120 Principles of Accounting II 3 Total Credit Hours 6', [], courses), 'ACC 2110, ACC 2120');
  assert.equal(codeStatus('A', { done: new Set(['A']), grades: { A: 'IP' } }), 'ip');
  assert.equal(codeStatus('A', { done: new Set(['A']), grades: { A: 'B' } }), 'done');
  assert.equal(codeStatus('B', { done: new Set(), planned: new Map([['B', 'Fa 27']]) }), 'Fa 27');
});

test('business BS (Finance): line between the business foundation and the classes that need matriculation', () => {
  const { program, nodes, sides, chart } = chartOf('finance-bs');
  assert.ok(chart.split);
  for (const code of program.admissionInfo.before) {
    const n = nodes.find((x) => codesOf(x).includes(code));
    if (n && chart.layout.pos.has(n.id)) { const r = chart.boxes.get(n.id); assert.ok(sideOf(chart.split, r) === 'left' || outlined(chart.split, r), `${code} left`); }
  }
  for (const id of sides.gated) if (chart.layout.pos.has(id)) { const r = chart.boxes.get(id); assert.ok(sideOf(chart.split, r) === 'right' || outlined(chart.split, r), `${id} right`); }
});

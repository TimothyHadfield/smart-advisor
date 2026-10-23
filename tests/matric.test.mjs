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
    assert.ok(r.x > chart.split.x, `${code} (x ${r.x}) right of the line (x ${chart.split.x})`);
  }
  // the catalog's "complete before admission" classes are all left of it
  let left = 0;
  for (const code of info.before) {
    const n = box(code);
    if (!n) continue;
    const r = chart.boxes.get(n.id);
    assert.ok(!sides.after.has(n.id), `${code} doesn't need matriculation`);
    assert.ok(r.x + r.w < chart.split.x, `${code} left of the line`);
    left++;
  }
  assert.ok(left >= 8, `the matriculation list is drawn (${left} boxes)`);
  // and every box of the main chart is on its own side (none straddles or sits on the wrong side)
  for (const id of chart.layout.pos.keys()) {
    const r = chart.boxes.get(id);
    if (sides.after.has(id)) assert.ok(r.x > chart.split.x, `${id} right`);
    else assert.ok(r.x + r.w < chart.split.x, `${id} left`);
  }
  // the line runs from the label band at the top down past the chart's last box (not into Gen Ed)
  const mainBottom = Math.max(...[...chart.layout.pos.keys()].map((id) => chart.boxes.get(id).y + chart.boxes.get(id).h));
  assert.ok(chart.split.top < Math.min(...[...chart.boxes.values()].map((r) => r.y)), 'label band above every box');
  assert.ok(chart.split.bottom >= mainBottom - 1 && chart.split.bottom < chart.genTop, 'line ends above Gen Ed');
  // no arrow's upright jog sits on the line
  for (const e of chart.edges) for (let i = 1; i < e.pts.length; i++) {
    const [a, b] = [e.pts[i - 1], e.pts[i]];
    if (a[0] === b[0]) assert.ok(Math.abs(a[0] - chart.split.x) > 2, `${e.from} -> ${e.to} jog clear of the line`);
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

test('layout: boxes with no arrows go on their own side of the line too', () => {
  const nodes = ['A', 'B', 'C', 'D', 'X', 'Y', 'Z'].map((id) => ({ id }));
  const edges = [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'A', to: 'D' }];
  const L = layoutGraph(nodes, edges, { split: new Set(['D', 'Z']) });
  assert.equal(L.split, 3, 'line after the furthest box that needs nothing (C, column 2)');
  assert.ok(L.pos.get('D').col >= 3, 'D moved right of the line');
  assert.ok(L.pos.get('Z').col >= 3 && L.pos.get('X').col < 3 && L.pos.get('Y').col < 3, 'arrowless boxes split too');
  const R = routeChart(L, SIZES);
  assert.ok(R.split && R.split.x > R.boxes.get('C').x + 116 && R.split.x < R.boxes.get('D').x);
  // every box needs it except the arrowless ones: they take the first column
  const M = layoutGraph(nodes, edges, { split: new Set(['A', 'B', 'C', 'D']) });
  assert.ok(M.split >= 1 && M.pos.get('A').col >= M.split && M.pos.get('X').col < M.split);
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
    if (n && chart.layout.pos.has(n.id)) assert.ok(chart.boxes.get(n.id).x < chart.split.x, `${code} left`);
  }
  for (const id of sides.gated) if (chart.layout.pos.has(id)) assert.ok(chart.boxes.get(id).x > chart.split.x, `${id} right`);
});

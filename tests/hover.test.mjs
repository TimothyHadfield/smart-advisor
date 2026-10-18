// Flowchart hover (js/hover.js): which lines light up, the tiny when/grade label and where it sits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { edgeRoles, hintText, placeHint, termMonth } from '../js/hover.js';
import { buildModel, flowNodes, flowEdges } from '../js/planner.js';
import { foldLabs } from '../js/layout.js';

test('edgeRoles: lines into the box are "pre", lines out of it are "post", one level only', () => {
  const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }, { from: 'x', to: 'b', or: true }, { from: 'a', to: 'c' }];
  assert.deepEqual(edgeRoles(edges, 'b'), { pre: [0, 3], post: [1] });
  assert.deepEqual(edgeRoles(edges, 'd'), { pre: [2], post: [] });
  assert.deepEqual(edgeRoles(edges, 'zz'), { pre: [], post: [] });
});

test('edgeRoles on the real EE chart (labs folded): ECE 2250 has both kinds, none two levels away', () => {
  const ee = JSON.parse(readFileSync(fileURLToPath(new URL('../data/programs/electrical-engineering-bs.json', import.meta.url)), 'utf8'));
  const model = buildModel(ee);
  const { edges } = foldLabs(flowNodes(model), flowEdges(model));
  const id = model.byCode['ECE 2250'].id;
  const r = edgeRoles(edges, id);
  assert.ok(r.pre.length > 0 && r.post.length > 0, 'ECE 2250 has prereqs and classes that need it');
  for (const i of r.pre) assert.equal(edges[i].to, id);
  for (const i of r.post) assert.equal(edges[i].from, id);
  assert.equal(r.pre.length + r.post.length, edges.filter((e) => e.to === id || e.from === id).length);
});

test('termMonth: UVU term start months', () => {
  assert.equal(termMonth('Spring 2027'), 'Jan 2027');
  assert.equal(termMonth('Summer 2026'), 'May 2026');
  assert.equal(termMonth('Fall 2025'), 'Aug 2025');
  assert.equal(termMonth(''), '');
  assert.equal(termMonth('Winter 2025'), '');
});

test('hintText: taken, in progress, planned, nothing else', () => {
  assert.equal(hintText({ done: true, grade: 'A', term: 'Fall 2025' }), 'Aug 2025 · A');
  assert.equal(hintText({ done: true, grade: 'TCR', term: 'Summer 2025' }), 'May 2025 · TCR');
  assert.equal(hintText({ done: true, grade: 'B+' }), 'Taken · B+', 'no term known: says Taken, with the grade');
  assert.equal(hintText({ done: true, grade: '', term: 'Spring 2026' }), 'Jan 2026');
  assert.equal(hintText({ done: true, grade: '' }), 'Taken', 'every taken class gets a label');
  assert.equal(hintText({ done: true, grade: 'IP', term: 'Fall 2026', now: 'Fall 2026' }), 'Now · Aug 2026');
  assert.equal(hintText({ done: true, grade: 'IP', now: 'Fall 2026' }), 'Now · Aug 2026', 'in progress without a term: this term');
  assert.equal(hintText({ done: true, grade: 'IP', term: 'Spring 2027', now: 'Fall 2026' }), 'Jan 2027', 'registered for a later term');
  assert.equal(hintText({ done: false, planned: 'Spring 2027' }), 'Planned Jan 2027');
  assert.equal(hintText({ done: false }), '');
});

test('placeHint: exactly the box width (never left or right of it); above, or below at the top edge', () => {
  const box = { x: 140, y: 200, w: 116, h: 48 };
  const a = placeHint(box, { h: 14, gap: 2, top: 0 });
  assert.equal(a.left, box.x);
  assert.equal(a.left + a.width, box.x + box.w);
  assert.equal(a.side, 'above');
  assert.equal(a.top + 14, box.y - 2, 'sits right on top of the box');
  const b = placeHint({ ...box, y: 12 }, { h: 14, gap: 2, top: 0 });
  assert.equal(b.side, 'below');
  assert.equal(b.top, 12 + 48 + 2);
  assert.equal(b.left, box.x);
  assert.equal(b.width, box.w);
  // scrolled: the top edge of what's visible counts
  assert.equal(placeHint(box, { h: 14, gap: 2, top: 190 }).side, 'below');
});

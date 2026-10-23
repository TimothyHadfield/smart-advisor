// Run: node --test tests/classes.test.mjs
// Classes section, Hypothetical | Actual, grades + GPA (js/classes.js), on the real EE program file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildModel, flowNodes, flowEdges } from '../js/planner.js';
import { foldLabs } from '../js/layout.js';
import { viewSet, hypoFrom, normHypo, hasHypo, hypoShown, sandboxOn, statusOf, boxGrade, gpa, classGroups, GRADES, srcOf, geBoxFor } from '../js/classes.js';
import { toDoc, applyDoc } from '../js/sync.js';
import { clearTaken, undoClear } from '../js/uistate.js';
import { parseAudit, matchAudit } from '../js/audit.js';

const EE = JSON.parse(readFileSync(new URL('../data/programs/electrical-engineering-bs.json', import.meta.url)));
const model = buildModel(EE);
const { nodes } = foldLabs(flowNodes(model), flowEdges(model));
const node = (id) => nodes.find((n) => n.id === id);

test('Actual = audit + added only; Hypothetical = taps on top (adds and hides)', () => {
  const actual = new Set(['MATH 1210', 'ENGL 1010']);
  const hypo = { add: ['MATH 1220'], del: ['ENGL 1010'] };
  assert.deepEqual([...viewSet(actual, hypo, 'actual')].sort(), ['ENGL 1010', 'MATH 1210']);
  assert.deepEqual([...viewSet(actual, hypo, 'hypo')].sort(), ['MATH 1210', 'MATH 1220']);
  assert.equal(hasHypo(hypo), true);
  assert.equal(hasHypo({ add: [], del: [] }), false);
  assert.equal(hasHypo(undefined), false);
});

test('a tap never changes actual data: untapping an audit class only hides it, tapping it back un-hides', () => {
  const actual = new Set(['MATH 1210', 'ENGL 1010']);
  // untap ENGL 1010 (audit), tap MATH 1220
  const h1 = hypoFrom(actual, new Set(['MATH 1210', 'MATH 1220']));
  assert.deepEqual(h1, { add: ['MATH 1220'], del: ['ENGL 1010'] });
  assert.deepEqual([...actual].sort(), ['ENGL 1010', 'MATH 1210'], 'actual untouched');
  // tap ENGL 1010 again, untap MATH 1220: no hypotheticals left
  assert.deepEqual(hypoFrom(actual, new Set(['MATH 1210', 'ENGL 1010'])), { add: [], del: [] });
  // stale entries (a tap that later became real) drop out
  assert.deepEqual(normHypo(new Set(['A 1', 'B 1']), { add: ['A 1', 'C 1'], del: ['B 1', 'D 1'] }), { add: ['C 1'], del: ['B 1'] });
});

test('statusOf: in progress, AP/CE (transfer/test credit), taken', () => {
  assert.equal(statusOf('IP'), 'ip');
  for (const g of ['TCR', 'T', 'TA', 'TB+', 'TR', 'CR']) assert.equal(statusOf(g), 'apce', g);
  for (const g of ['A', 'C-', 'P', '', undefined]) assert.equal(statusOf(g), 'taken', String(g));
  assert.ok(GRADES.includes('A') && GRADES.includes('E') && GRADES.includes('TR') && !GRADES.includes('IP'));
});

test('box grade: folded lecture + lab shows the lower grade; one graded part shows that one; IP wins', () => {
  const n = node('ECE 2250');
  assert.deepEqual(n.labs.map((l) => l.code), ['ECE 2255']);
  const done = new Set(['ECE 2250', 'ECE 2255']);
  assert.equal(boxGrade(n, done, { 'ECE 2250': 'A-', 'ECE 2255': 'B+' }), 'B+');
  assert.equal(boxGrade(n, done, { 'ECE 2250': 'C', 'ECE 2255': 'A' }), 'C');
  assert.equal(boxGrade(n, done, { 'ECE 2250': 'A-' }), 'A-', 'lab not graded yet');
  assert.equal(boxGrade(n, done, { 'ECE 2255': 'P', 'ECE 2250': 'B' }), 'B', 'a pass mark never beats a letter');
  assert.equal(boxGrade(n, done, { 'ECE 2250': 'IP', 'ECE 2255': 'IP' }), 'IP');
  assert.equal(boxGrade(n, done, {}), '');
});

test('box grade: a pick-one box (American Institutions) shows the grade of the option taken', () => {
  const n = node('choice:3');
  const o = n.options[0];
  const done = new Set(o.codes);
  const grades = Object.fromEntries(o.codes.map((c, i) => [c, i ? 'B' : 'A']));
  assert.equal(boxGrade(n, done, grades), o.codes.length > 1 ? 'B' : 'A');
  // tapped as a whole (no class named): the box's own grade, if any
  assert.equal(boxGrade(n, new Set(['choice:3']), { 'choice:3': 'TCR' }), 'TCR');
});

test('box grade: a Gen Ed box shows the picked class\'s grade, else its own (older imports)', () => {
  const n = node('ph:7');
  assert.equal(boxGrade(n, new Set(['ph:7', 'ph:7=DANC 1010']), { 'DANC 1010': 'A-' }), 'A-');
  assert.equal(boxGrade(n, new Set(['ph:7']), { 'ph:7': 'B' }), 'B');
});

test('GPA on the UVU 4.0 scale, credit weighted; P, TR, IP and ungraded rows left out; E counts 0', () => {
  assert.deepEqual(gpa([{ grade: 'A', credits: 3 }, { grade: 'B', credits: 4 }]), { gpa: 3.43, credits: 7 });
  assert.deepEqual(gpa([{ grade: 'A-', credits: 3 }, { grade: 'E', credits: 3 }, { grade: 'P', credits: 1 }, { grade: 'TCR', credits: 3 }, { grade: 'IP', credits: 4 }, { grade: '', credits: 3 }]), { gpa: 1.85, credits: 6 });
  assert.deepEqual(gpa([{ grade: 'C+', credits: 3 }, { grade: 'D-', credits: 1.5 }]), { gpa: 1.77, credits: 4.5 });
  assert.equal(gpa([{ grade: 'P', credits: 3 }]).gpa, null);
});

test('classGroups: Taken / AP/CE / Current / Still need / Not used, with title, credits, grade, source', () => {
  // (DANC 1010 is listed on its own too, as an added Gen Ed class is: it still shows once, as the box)
  const actual = new Set(['MATH 1210', 'DANC 1010', 'ENGL 1010', 'ECE 2250', 'ECE 2255', 'ph:7', 'ph:7=DANC 1010', 'ZZZ 1999', 'CHEM 1210']);
  const hypo = { add: ['MATH 1220'], del: ['CHEM 1210'] };
  const grades = { 'MATH 1210': 'A', 'ENGL 1010': 'TCR', 'ECE 2250': 'IP', 'ECE 2255': 'IP', 'DANC 1010': 'B+', 'ZZZ 1999': 'C', 'MATH 1220': 'B' };
  const src = { 'MATH 1210': 'audit', 'ENGL 1010': 'audit' };
  const catalog = { 'DANC 1010': { title: 'Introduction to Dance', credits: 3 } };
  const completed = viewSet(actual, hypo, 'hypo');
  const g = classGroups({ model, completed, actual, grades, src, catalog });
  assert.deepEqual(g.map((x) => x.key), ['taken', 'apce', 'ip', 'need', 'other']);
  const rows = Object.fromEntries(g.map((x) => [x.key, x.rows]));
  const codes = (k) => rows[k].map((r) => r.code || r.label);
  assert.deepEqual(codes('taken'), ['DANC 1010', 'MATH 1210', 'MATH 1220']);
  assert.deepEqual(codes('apce'), ['ENGL 1010']);
  assert.deepEqual(codes('ip'), ['ECE 2250', 'ECE 2255']);
  assert.deepEqual(codes('other'), ['ZZZ 1999']);
  const m1210 = rows.taken.find((r) => r.code === 'MATH 1210');
  assert.equal(m1210.title, 'Calculus I');
  assert.equal(m1210.credits, 4);
  assert.equal(m1210.grade, 'A');
  assert.equal(m1210.src, 'audit');
  assert.equal(rows.taken.find((r) => r.code === 'MATH 1220').src, 'tap');
  const danc = rows.taken.find((r) => r.code === 'DANC 1010');
  assert.equal(danc.title, 'Introduction to Dance');
  assert.equal(danc.key, 'ph:7');
  assert.equal(danc.src, 'added', 'no source saved = added by the student');
  // hidden by a tap: not taken here, so it is still needed
  assert.ok(codes('need').includes('CHEM 1210'));
  assert.ok(!codes('need').includes('MATH 1210'));
  assert.ok(rows.need.every((r) => !completed.has(r.code)));
  // Actual view: the tap is gone, the hidden class is back
  const a = Object.fromEntries(classGroups({ model, completed: viewSet(actual, hypo, 'actual'), actual, grades, src, catalog }).map((x) => [x.key, x.rows.map((r) => r.code || r.label)]));
  assert.ok(a.taken.includes('CHEM 1210') && !a.taken.includes('MATH 1220'));
});

test('srcOf: audit / added / tap', () => {
  const actual = new Set(['A 1', 'B 1']);
  assert.equal(srcOf('A 1', actual, { 'A 1': 'audit' }), 'audit');
  assert.equal(srcOf('B 1', actual, {}), 'added');
  assert.equal(srcOf('C 1', actual, {}), 'tap');
});

test('an added Gen Ed class fills an open Gen Ed box whose list has it', () => {
  const boxes = [{ id: 'ph:7', kind: 'placeholder' }, { id: 'ph:8', kind: 'placeholder' }];
  const lists = { 'ph:7': ['DANC 1010', 'ART 1010'], 'ph:8': ['BIOL 1010'] };
  const listOf = (b) => ({ groups: [{ courses: lists[b.id].map((code) => ({ code })) }] });
  assert.equal(geBoxFor('BIOL 1010', boxes, listOf, new Set()), 'ph:8');
  assert.equal(geBoxFor('DANC 1010', boxes, listOf, new Set(['ph:7'])), null, 'box already filled');
  assert.equal(geBoxFor('XYZ 1000', boxes, listOf, new Set()), null);
});

test('sync: hypotheticals and sources ride in settings (no new doc fields, so the rules stay the same)', () => {
  const state = { settings: { max: 15, hypo: { m: { add: ['MATH 1220'], del: ['ENGL 1010'] } }, src: { m: { 'ENGL 1010': 'audit' } } }, done: { m: ['ENGL 1010'] }, grades: { m: {} }, plan: { programs: ['m'] } };
  const d = toDoc(state, 'm');
  assert.deepEqual(d.settings.hypo, state.settings.hypo);
  assert.deepEqual(d.settings.src, state.settings.src);
  assert.deepEqual(Object.keys(d).sort(), ['catalogYear', 'grades', 'program', 'programs', 'settings', 'taken']);
  const other = applyDoc({ settings: {} }, d, 'm');
  assert.deepEqual(other.settings.hypo, state.settings.hypo);
  assert.deepEqual(other.settings.src, state.settings.src);
});

test('Clear taken also clears the hypotheticals and sources; Undo brings them back', () => {
  const state = { done: { m: ['ENGL 1010'] }, grades: { m: { 'ENGL 1010': 'A' } }, settings: { lastTerm: 'Fall 2026', hypo: { m: { add: ['X 1'], del: [] }, n: { add: ['Y 1'], del: [] } }, src: { m: { 'ENGL 1010': 'audit' } } } };
  const snap = clearTaken(state, 'm');
  assert.deepEqual(state.settings.hypo.m, { add: [], del: [] });
  assert.deepEqual(state.settings.hypo.n, { add: ['Y 1'], del: [] }, 'other programs untouched');
  assert.deepEqual(state.settings.src.m, {});
  undoClear(state, snap);
  assert.deepEqual(state.settings.hypo.m, { add: ['X 1'], del: [] });
  assert.deepEqual(state.settings.src.m, { 'ENGL 1010': 'audit' });
});

test('audit match keeps the classes outside the program (for AP/CE and "Not used") and names a Gen Ed box\'s class', () => {
  const text = [
    'Catalog Year: 2025-2026',
    '',
    'MATH 1210 Calculus I A 4 Fall 2024',
    'FINE ARTS DISTRIBUTION DANC 1010 Introduction to Dance B+ 3 Fall 2024',
    'PSY 1010 General Psychology TCR 3 Fall 2023',
    'ACC 2010 Survey of Accounting IP (3) Spring 2027',
  ].join('\n');
  const m = matchAudit(parseAudit(text), model);
  const box = m.rows.find((r) => r.key === 'ph:7');
  assert.equal(box?.code, 'DANC 1010');
  assert.deepEqual(m.others.map((r) => [r.code, r.status, r.grade]).sort(), [['ACC 2010', 'ip', 'IP'], ['PSY 1010', 'taken', 'TCR']]);
  assert.equal(m.other, 2);
});

test('Hypothetical sandbox: on once a tap was made (even when taps cancel out), off on Actual or with no taps', () => {
  const none = { add: [], del: [] }, some = { add: ['PHYS 2210'], del: [] };
  assert.equal(sandboxOn(none, false, 'hypo'), false, 'no taps: the student\'s own view');
  assert.equal(sandboxOn(some, false, 'hypo'), true);
  // Tim's case: untap an in-progress class, select it again -> no change left, still Hypothetical
  assert.equal(sandboxOn(none, true, 'hypo'), true);
  assert.equal(hypoShown(none, true), true);
  assert.equal(sandboxOn(some, true, 'actual'), false, 'Actual shows everything');
  assert.equal(sandboxOn(null, false, 'hypo'), false);
});

// js/uistate.js: ?p= links vs the saved plan, first visit, Clear taken + Undo, labels, links, Apply row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { urlPrograms, programsFromLink, urlWithPrograms, isFirstVisit, clearTaken, undoClear, pickLabel, courseURL, issueURL, applyIndex, tracksOf } from '../js/uistate.js';

const group = (id) => (/minor/.test(id) ? 'minor' : 'major');
const SAVED = ['electrical-engineering-bs', 'mathematics-minor'];

test('urlPrograms: comma list, junk dropped, none -> null', () => {
  assert.deepEqual(urlPrograms('?p=electrical-engineering-bs,mathematics-minor'), SAVED);
  assert.deepEqual(urlPrograms('?p=electrical-engineering-bs%2Cmathematics-minor'), SAVED);
  assert.equal(urlPrograms('?x=1'), null);
  assert.equal(urlPrograms('?p=<script>'), null);
});

test('a ?p= link never wipes the saved plan', () => {
  // the old bug: a bookmark of the major alone dropped the minor on every load
  assert.deepEqual(programsFromLink(SAVED, ['electrical-engineering-bs'], group), SAVED);
  assert.deepEqual(programsFromLink(SAVED, SAVED, group), SAVED);
  // another major: like picking it (minor stays)
  assert.deepEqual(programsFromLink(SAVED, ['nursing-bs'], group), ['nursing-bs', 'mathematics-minor']);
  // a minor: added
  assert.deepEqual(programsFromLink(['nursing-bs'], ['mathematics-minor'], group), ['nursing-bs', 'mathematics-minor']);
  // a shared combination: exactly that
  assert.deepEqual(programsFromLink(SAVED, ['nursing-bs', 'chemistry-minor'], group), ['nursing-bs', 'chemistry-minor']);
  // nothing saved yet: the link
  assert.deepEqual(programsFromLink([], ['nursing-bs'], group), ['nursing-bs']);
});

test('urlWithPrograms keeps other parameters and the hash', () => {
  assert.equal(urlWithPrograms('http://x/app/?p=a&data=tests/fixtures#z', ['b', 'c-minor']), 'http://x/app/?p=b,c-minor&data=tests%2Ffixtures#z');
  assert.equal(urlWithPrograms('http://x/?p=a', []), 'http://x/');
});

test('first visit: nothing saved, nothing taken, no link', () => {
  assert.equal(isFirstVisit({ plan: { programs: [] }, done: {}, grades: {} }, null), true);
  assert.equal(isFirstVisit({}, null), true);
  assert.equal(isFirstVisit({}, ['nursing-bs']), false);
  assert.equal(isFirstVisit({ plan: { programs: ['nursing-bs'] } }, null), false);
  // saved before programs could be picked (EE classes taken): not a new student
  assert.equal(isFirstVisit({ plan: { programs: [] }, done: { 'ee-bs': ['ENGL 1010'] } }, null), false);
  assert.equal(isFirstVisit({ plan: { programs: [] }, done: { 'ee-bs': [] } }, null), true);
});

test('Clear taken, then Undo, restores classes, grades and the imported term', () => {
  const state = { done: { m: ['ENGL 1010', 'ph:3=DANC 1010'], other: ['X 1'] }, grades: { m: { 'ENGL 1010': 'A' } }, settings: { lastTerm: 'Fall 2026', max: 15 } };
  const snap = clearTaken(state, 'm');
  assert.deepEqual(state.done.m, []);
  assert.deepEqual(state.grades.m, {});
  assert.ok('lastTerm' in state.settings && state.settings.lastTerm === null);
  assert.deepEqual(state.done.other, ['X 1'], 'other programs untouched');
  undoClear(state, snap);
  assert.deepEqual(state.done.m, ['ENGL 1010', 'ph:3=DANC 1010']);
  assert.deepEqual(state.grades.m, { 'ENGL 1010': 'A' });
  assert.equal(state.settings.lastTerm, 'Fall 2026');
  assert.equal(state.settings.max, 15);
});

test('labels and links', () => {
  assert.equal(pickLabel({ count: 1 }), 'Pick 1');
  assert.equal(pickLabel({ count: 2 }), 'Pick 2');
  assert.equal(pickLabel({ credits: 6 }), 'Pick 6 cr');
  assert.equal(courseURL('ECE 2250'), 'https://catalog.uvu.edu/search/?P=ECE%202250');
  const u = new URL(issueURL({ program: 'Nursing, B.S.', programId: 'nursing-bs', year: '2026-2027', code: 'NURS 2300', title: 'Foundations' }));
  assert.equal(u.origin + u.pathname, 'https://github.com/TimothyHadfield/smart-advisor/issues/new');
  assert.match(u.searchParams.get('title'), /Nursing, B\.S\. · NURS 2300/);
  assert.match(u.searchParams.get('body'), /nursing-bs, catalog 2026-2027/);
  assert.match(u.searchParams.get('body'), /Class: NURS 2300 Foundations/);
  assert.doesNotMatch(u.href, /@/, 'no email');
});

test('applyIndex reads the planner phases in any of its shapes; none -> -1', () => {
  const plan = { semesters: [{ term: 'Spring 2027' }, { term: 'Fall 2027' }, { term: 'Spring 2028' }] };
  assert.equal(applyIndex(plan, null), -1);
  assert.equal(applyIndex(plan, [{ name: 'Before you apply', start: 0 }, { name: 'Program', start: 1 }]), 1);
  assert.equal(applyIndex(plan, [{ key: 'pre', semesters: [0] }, { key: 'program', semesters: [2] }]), 2);
  assert.equal(applyIndex(plan, [{ name: 'Before you apply', terms: ['Spring 2027'] }, { name: 'Program', terms: ['Fall 2027'] }]), 1);
  assert.equal(applyIndex({ ...plan, phases: [{ name: 'pre', start: 0 }, { name: 'program', start: 2 }] }), 2);
  assert.equal(applyIndex({ semesters: [{ term: 'a', phase: 'pre' }, { term: 'b', phase: 'program' }] }), 1);
  assert.equal(applyIndex(plan, [{ name: 'Program', start: 0 }]), -1, 'no pre-admission phase: no row');
});

test('tracksOf: only tracks that have courses', () => {
  const g = { tracks: ['A Track', 'Includes 36 credits', 'B Track'], options: [{ section: 'A Track' }, { section: 'B Track' }] };
  assert.deepEqual(tracksOf(g), ['A Track', 'B Track']);
  assert.deepEqual(tracksOf({}), []);
});

// Run: node tests/sync.test.mjs
// The account sync's pure parts: local state <-> users/{uid} doc, the first-sign-in merge, and
// what to do when a signed-in session starts on a device.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDoc, applyDoc, mergeDocs, decide, sameDoc } from '../js/sync.js';

// A local state shaped like js/app.js keeps it (localStorage 'smart-advisor:v1') after an audit
// import of ~20 classes plus a few taps (real course codes and box ids from data/programs/ee-bs.json).
const AUDIT = ['ENGL 1010', 'ENGL 2010', 'MATH 1210', 'MATH 1220', 'MATH 2210', 'MATH 2250', 'PHYS 2210',
  'PHYS 2215', 'PHYS 2220', 'PHYS 2225', 'CHEM 1210', 'CHEM 1215', 'COMM 1020', 'ECE 1000', 'ECE 1010',
  'ECE 2250', 'ECE 2255', 'ECE 2260', 'ECE 2265'];
function localState() {
  return {
    settings: { max: 15, summers: true, start: 'Spring 2027', grades: true },
    done: { 'ee-bs': [...AUDIT, 'ph:6', 'choice:3'] },
    grades: { 'ee-bs': Object.fromEntries(AUDIT.map((c, i) => [c, ['A', 'A-', 'B+', 'TCR', 'IP', ''][i % 6]])) },
    audit: { 'ee-bs': { catalogYear: '2025-2026' } },
  };
}

test('toDoc: the current program only, small, Firestore-safe (no undefined, no nested arrays)', () => {
  const d = toDoc(localState(), 'ee-bs');
  assert.deepEqual(Object.keys(d).sort(), ['catalogYear', 'grades', 'program', 'programs', 'settings', 'taken']);
  assert.deepEqual(d.programs, ['ee-bs']);
  assert.equal(d.program, 'ee-bs');
  assert.equal(d.catalogYear, '2025-2026');
  assert.equal(d.taken.length, 21);
  assert.equal(d.grades['ECE 2250'], 'TCR');
  assert.deepEqual(d.settings, { max: 15, summers: true, start: 'Spring 2027', grades: true });
  const walk = (v) => { assert.notEqual(v, undefined); if (Array.isArray(v)) v.forEach((x) => { assert.ok(!Array.isArray(x)); walk(x); }); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(d);
  assert.ok(JSON.stringify(d).length < 2000);
});

test('toDoc: a fresh guest (nothing saved yet) gives empty lists and null catalog year', () => {
  const d = toDoc({ settings: { max: 16, summers: false, start: null, grades: true }, done: {}, grades: {} }, 'ee-bs');
  assert.deepEqual(d.taken, []);
  assert.deepEqual(d.grades, {});
  assert.equal(d.catalogYear, null);
  assert.equal(d.settings.start, null);
});

test('applyDoc: writes the account into local state for this program and keeps defaults', () => {
  const s = { settings: { max: 16, summers: false, start: null, grades: true }, done: {}, grades: {} };
  applyDoc(s, { taken: ['MATH 1210', 'ph:7'], grades: { 'MATH 1210': 'B' }, settings: { max: 12 }, program: 'ee-bs', catalogYear: '2026-2027', updatedAt: { seconds: 1 } }, 'ee-bs');
  assert.deepEqual(s.done['ee-bs'], ['MATH 1210', 'ph:7']);
  assert.deepEqual(s.grades['ee-bs'], { 'MATH 1210': 'B' });
  assert.deepEqual(s.settings, { max: 12, summers: false, start: null, grades: true });
  assert.equal(s.audit['ee-bs'].catalogYear, '2026-2027');
  assert.ok(sameDoc(toDoc(s, 'ee-bs'), { taken: ['MATH 1210', 'ph:7'], grades: { 'MATH 1210': 'B' }, settings: s.settings, program: 'ee-bs', programs: ['ee-bs'], catalogYear: '2026-2027', updatedAt: 5 }));
});

test('applyDoc: a doc missing fields does not wipe local settings to undefined', () => {
  const s = localState();
  applyDoc(s, { taken: ['MATH 1210'] }, 'ee-bs');
  assert.deepEqual(s.done['ee-bs'], ['MATH 1210']);
  assert.deepEqual(s.grades['ee-bs'], {});
  assert.equal(s.settings.max, 15);
});

test('mergeDocs: union of taken, grades from whichever has them, account settings win', () => {
  const local = toDoc(localState(), 'ee-bs');
  const remote = { taken: ['MATH 1210', 'ECE 3300', 'ph:8'], grades: { 'MATH 1210': '', 'ECE 3300': 'A', 'ECE 2250': 'B' },
    settings: { max: 18, summers: false, start: 'Fall 2026', grades: false }, program: 'ee-bs', catalogYear: '2026-2027', updatedAt: { seconds: 9 } };
  const m = mergeDocs(local, remote);
  assert.equal(m.taken.length, 23); // 21 local + ECE 3300 + ph:8, MATH 1210 once
  assert.equal(new Set(m.taken).size, m.taken.length);
  assert.ok(m.taken.includes('ECE 3300') && m.taken.includes('ph:8') && m.taken.includes('ph:6'));
  assert.equal(m.grades['MATH 1210'], 'B+'); // account had no grade, device did
  assert.equal(m.grades['ECE 3300'], 'A');   // only the account had it
  assert.equal(m.grades['ECE 2250'], 'B');   // both: the account's
  assert.ok('ENGL 2010' in m.grades);        // an imported class stays marked imported
  assert.deepEqual(m.settings, remote.settings);
  assert.equal(m.catalogYear, '2026-2027');
  assert.equal(m.program, 'ee-bs');
  assert.ok(!('updatedAt' in m));
});

test('mergeDocs: no account doc yet = the device data; empty device = the account', () => {
  const local = toDoc(localState(), 'ee-bs');
  assert.deepEqual(mergeDocs(local, null), local);
  const empty = toDoc({ settings: { max: 16, summers: false, start: null, grades: true }, done: {}, grades: {} }, 'ee-bs');
  const remote = { taken: ['MATH 1210'], grades: {}, settings: { max: 12, summers: false, start: null, grades: true }, program: 'ee-bs', catalogYear: null };
  const m = mergeDocs(empty, remote);
  assert.deepEqual(m.taken, ['MATH 1210']);
  assert.equal(m.settings.max, 12);
});

test('mergeDocs: an account doc without settings keeps the device settings', () => {
  const local = toDoc(localState(), 'ee-bs');
  const m = mergeDocs(local, { taken: ['ECE 3300'] });
  assert.deepEqual(m.settings, local.settings);
  assert.equal(m.catalogYear, '2025-2026');
});

test('decide: guest data merges; this account\'s own cached copy pulls, or pushes if it has unsent edits', () => {
  assert.equal(decide(null, 'u1'), 'merge');
  assert.equal(decide({ uid: 'u2', dirty: false }, 'u1'), 'merge');
  assert.equal(decide({ uid: 'u1', dirty: false }, 'u1'), 'pull');
  assert.equal(decide({ uid: 'u1', dirty: true }, 'u1'), 'push');
});

test('sameDoc ignores updatedAt and key order, sees real changes', () => {
  const a = toDoc(localState(), 'ee-bs');
  const b = JSON.parse(JSON.stringify(a));
  b.updatedAt = { seconds: 3 };
  b.settings = { grades: true, start: 'Spring 2027', summers: true, max: 15 };
  assert.ok(sameDoc(a, b));
  b.taken = b.taken.slice(1);
  assert.ok(!sameDoc(a, b));
});

// ---------- chosen programs (major + minor) and catalog year ----------
const PLAN = { programs: ['electrical-engineering-bs', 'environmental-science-management-minor'], catalogYear: '2025-2026' };

test('toDoc: the chosen programs (major first) and the chosen catalog year', () => {
  const s = { ...localState(), plan: { ...PLAN } };
  s.done = { 'electrical-engineering-bs': ['MATH 1210', 'environmental-science-management-minor/choice:4'] };
  const d = toDoc(s, 'electrical-engineering-bs');
  assert.equal(d.program, 'electrical-engineering-bs');
  assert.deepEqual(d.programs, PLAN.programs);
  assert.equal(d.catalogYear, '2025-2026');
  assert.deepEqual(d.taken, ['MATH 1210', 'environmental-science-management-minor/choice:4']);
});

test('applyDoc: programs + catalog year come back; taken goes under the doc\'s major', () => {
  const s = { settings: { max: 16, summers: false, start: null, grades: true }, done: {}, grades: {}, plan: { programs: ['nursing-bs'], catalogYear: null } };
  applyDoc(s, { taken: ['ENVT 1110'], grades: {}, program: PLAN.programs[0], programs: PLAN.programs, catalogYear: '2025-2026' }, 'nursing-bs');
  assert.deepEqual(s.plan, PLAN);
  assert.deepEqual(s.done['electrical-engineering-bs'], ['ENVT 1110']);
  assert.ok(sameDoc(toDoc(s, 'electrical-engineering-bs'), { taken: ['ENVT 1110'], grades: {}, settings: s.settings, program: PLAN.programs[0], programs: PLAN.programs, catalogYear: '2025-2026' }));
});

test('applyDoc: an older doc (program only, no programs list) keeps working', () => {
  const s = { settings: {}, done: {}, grades: {} };
  applyDoc(s, { taken: ['MATH 1210'], program: 'ee-bs', catalogYear: '2025-2026' }, 'ee-bs');
  assert.deepEqual(s.plan.programs, ['ee-bs']);
  assert.equal(s.plan.catalogYear, '2025-2026');
  assert.deepEqual(s.done['ee-bs'], ['MATH 1210']);
});

test('mergeDocs: the account\'s programs win; a device-only choice is kept when the account has none', () => {
  const local = toDoc({ ...localState(), plan: { ...PLAN } }, 'electrical-engineering-bs');
  assert.deepEqual(mergeDocs(local, { taken: [], program: 'nursing-bs', programs: ['nursing-bs'] }).programs, ['nursing-bs']);
  const m = mergeDocs(local, { taken: ['MATH 1210'] });
  assert.deepEqual(m.programs, PLAN.programs);
  assert.equal(m.program, 'electrical-engineering-bs');
});

test('schedule preferences + chosen sections (settings.sched) go to the account and come back', () => {
  const sched = { prefs: { days: 'MTWR', after: '0900', before: null, gaps: true, rmp: true, mode: 'any', main: true, wait: false },
    terms: { 202720: { add: ['ENGL 2010'], drop: ['ECE 2260'], pin: { 'ECE 2250': '14874' }, crns: ['14874', '14869', '10355'] } } };
  const d = toDoc({ ...localState(), settings: { ...localState().settings, sched } }, 'ee-bs');
  assert.deepEqual(d.settings.sched, sched);
  const s = { settings: {}, done: {}, grades: {} };
  applyDoc(s, d, 'ee-bs');
  assert.deepEqual(s.settings.sched, sched);
});

test('semColors (Settings › Semester colors) syncs both ways, off included', () => {
  const d = toDoc({ settings: { max: 16, summers: false, start: null, grades: true, semColors: false }, done: {}, grades: {} }, 'ee-bs');
  assert.equal(d.settings.semColors, false);
  const s = { settings: { semColors: true }, done: {}, grades: {} };
  applyDoc(s, d, 'ee-bs');
  assert.equal(s.settings.semColors, false);
});

test('Profile name and flowchart box labels sync both ways', () => {
  const d = toDoc({ settings: { name: 'Tim Hadfield', labels: 'code' }, done: {}, grades: {} }, 'ee-bs');
  assert.equal(d.settings.name, 'Tim Hadfield');
  assert.equal(d.settings.labels, 'code');
  const s = { settings: { labels: 'both' }, done: {}, grades: {} };
  applyDoc(s, d, 'ee-bs');
  assert.equal(s.settings.name, 'Tim Hadfield');
  assert.equal(s.settings.labels, 'code');
});

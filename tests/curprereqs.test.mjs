// Prerequisites always come from the current catalog (js/curprereqs.js); the catalog year only decides
// the requirements. Tim (EE BS, catalog 2025-2026): "4900 literally says on wolverine track that 4730 is a
// prereq ... Make sure this mistake isn't happening anywhere else."
// Real shipped data: data/2025-2026/programs/electrical-engineering-bs.json + data/courses.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildModel, makePlan, flowEdges } from '../js/planner.js';
import { forCatalogYear, currentPrereqsOf, mergePrereqCourses, prereqSig } from '../js/curprereqs.js';
import { checkAll } from '../scripts/check-prereqs.mjs';

const read = (p) => JSON.parse(readFileSync(new URL('../data/' + p, import.meta.url), 'utf8'));
const current = read('courses.json');
const currentPC = read('prereq-courses.json');
const yearPC = read('2025-2026/prereq-courses.json');
const raw = read('2025-2026/programs/electrical-engineering-bs.json');
const opts = { gened: read('2025-2026/gened.json'), seasons: read('seasons.json') };

test('EE BS 2025-26: ECE 4900 needs ECE 4730 (current catalog), keeps its 2025-26 title and credits', () => {
  assert.equal(raw.courses['ECE 4900'].prereqs, null, 'the 2025-26 catalog printed no course prereq');
  const { program } = forCatalogYear(raw, { current, currentPC, yearPC });
  const c = program.courses['ECE 4900'];
  assert.equal(c.prereqs, 'ECE 4730');
  assert.equal(c.prereqText, 'ECE 4730 and University Advanced Standing');
  assert.equal(c.title, raw.courses['ECE 4900'].title);
  assert.equal(c.credits, raw.courses['ECE 4900'].credits);
  assert.deepEqual(program.requirements, raw.requirements, 'requirements stay from the catalog year');
  assert.equal(program.totalCredits, raw.totalCredits);
});

test('EE BS 2025-26: the chart draws ECE 4730 -> ECE 4900 and the plan puts 4900 after 4730', () => {
  const { program, extraCourses } = forCatalogYear(raw, { current, currentPC, yearPC });
  const model = buildModel(program, { ...opts, extraCourses });
  assert.ok(flowEdges(model).some((e) => e.from === 'ECE 4730' && e.to === 'ECE 4900'));
  const plan = makePlan(model, new Set(), { start: { season: 'Spring', year: 2027 }, maxCredits: 16 });
  const sem = (code) => plan.semesters.findIndex((s) => s.items.some((it) => (it.codes || [it.code]).includes(code)));
  assert.ok(sem('ECE 4730') >= 0 && sem('ECE 4900') > sem('ECE 4730'), `4730 in ${sem('ECE 4730')}, 4900 in ${sem('ECE 4900')}`);
});

test('a course not in the current catalog keeps its old year\'s prereqs; fields the current one lacks are dropped', () => {
  const old = { title: 'Old', credits: 3, prereqs: 'X 1000', prereqText: 'X 1000', gate: 'admission', gateText: 'Admission' };
  assert.equal(currentPrereqsOf(old, undefined), old);
  const now = currentPrereqsOf(old, { title: 'New', credits: 4, prereqs: null, prereqText: 'Recommended: X 1000' });
  assert.deepEqual(now, { title: 'Old', credits: 3, prereqs: null, prereqText: 'Recommended: X 1000', prereqsCurrent: true });
});

test('"Needed first" list: current entries win, old-only codes stay, newly named outside prereqs are added', () => {
  const cur = { 'A 1000': { title: 'A', credits: 3, prereqs: 'B 1000' }, 'B 1000': { title: 'B', credits: 3, prereqs: null }, 'C 1000': { title: 'C', credits: 3, prereqs: null } };
  const prog = { courses: { 'A 1000': cur['A 1000'] } };
  const out = mergePrereqCourses(prog, { 'C 1000': { title: 'C', credits: 3, prereqs: 'Z 1' }, 'D 1000': { title: 'D', credits: 1, prereqs: null } }, {}, cur);
  assert.deepEqual(Object.keys(out).sort(), ['B 1000', 'C 1000', 'D 1000']);
  assert.equal(out['C 1000'].prereqs, null, 'still offered: current prereqs');
  assert.equal(out['D 1000'].title, 'D', 'no longer offered: kept');
});

test('prereqSig ignores formatting only (key order, null vs missing)', () => {
  assert.equal(prereqSig({ prereqs: { or: ['A', 'B'] }, coreqs: [] }), prereqSig({ prereqs: { or: ['A', 'B'] }, prereqText: null }));
  assert.notEqual(prereqSig({ prereqs: null }), prereqSig({ prereqs: 'ECE 4730' }));
});

test('check-prereqs over every program in every catalog year: 0 older-year mismatches, 0 beginner-looking boxes', () => {
  const r = checkAll();
  assert.ok(r.programs > 800, `${r.programs} programs`);
  assert.deepEqual(r.a, [], '(a) older-year course entries with prereqs that differ from the current catalog');
  assert.ok(r.aBefore > 0, 'the raw 2025-26 files do differ (else this check checks nothing)');
  // (b) MUSC 1110 is the one known case: MUSC 1105 is needed only after a diagnostic score under 80%
  assert.deepEqual(r.b.map((x) => x.split(':')[0]), ['MUSC 1110']);
  assert.deepEqual(r.c, [], '(c) boxes with no line in whose current prereq text names a class of the same chart');
});

test('without the fix the same check finds the EE symptom (guards against a vacuous check)', () => {
  const r = checkAll({ raw: true });
  assert.ok(r.a.includes('2025-2026/electrical-engineering-bs: ECE 4900'));
  assert.ok(r.c.some((x) => x.startsWith('2025-2026/electrical-engineering-bs: ECE 4900 names ECE 4730')));
});

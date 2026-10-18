// Run: node --test tests/wave2.test.mjs
// Accuracy wave 2 (docs/accuracy-plan.md): seasons + summer cap, prerequisites from outside the program,
// grade minimums, classes from outside the major filling free electives, a class shared by a major and a
// minor counted once, and the bachelor's 120 / 40 totals.
// Imports only planner.js / audit.js / programs.js so the same file runs (and fails) on the code before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as P from '../js/planner.js';
import { matchAudit } from '../js/audit.js';
import { combinePrograms } from '../js/programs.js';

const ROOT = fileURLToPath(new URL('../data/', import.meta.url));
const json = (p) => JSON.parse(readFileSync(ROOT + p, 'utf8'));
const EXTRA = (year = '') => ({ extraCourses: json(`${year}prereq-courses.json`), gened: json(`${year}gened.json`), seasons: json('seasons.json') });
const semOf = (plan, code) => plan.semesters.findIndex((s) => s.items.some((x) => x.code === code || (x.codes || []).includes(code)));
const items = (plan) => plan.semesters.flatMap((s) => s.items);

// a season history with the real file's shape: two of each main season (a class seen once has no pattern)
const SEASONS = {
  terms: [{ term: '202540', name: '2025 Fall', season: 'Fall' }, { term: '202620', name: '2026 Spring', season: 'Spring' },
    { term: '202630', name: '2026 Summer', season: 'Summer' }, { term: '202640', name: '2026 Fall', season: 'Fall' },
    { term: '202720', name: '2027 Spring', season: 'Spring' }],
  courses: { 'X 1000': [0, 3], 'X 2000': [0, 1, 2, 3, 4] },
};

test('seasons: a Fall-only class waits for Fall instead of landing in Spring', () => {
  const prog = { requirements: [{ type: 'course', code: 'X 1000', alts: [], credits: 3 }], courses: { 'X 1000': { title: 'Fall class', credits: 3 } }, gradPlan: [] };
  const m = P.buildModel(prog, { seasons: SEASONS });
  const plan = P.makePlan(m, new Set(), { start: { season: 'Spring', year: 2027 }, seasons: SEASONS });
  assert.equal(plan.semesters[0]?.term, 'Fall 2027');
  assert.equal(plan.semesters[0].items[0].offered, 'Usually Fall only');
});

for (const id of ['electrical-engineering-bs', 'applied-artificial-intelligence-ms']) test(`seasons: real ${id} plan puts no class in a semester UVU never runs it in`, () => {
  const ex = EXTRA();
  const m = P.buildModel(json(`programs/${id}.json`), ex);
  const plan = P.makePlan(m, new Set(), { start: { season: 'Fall', year: 2026 }, maxCredits: 16, seasons: ex.seasons });
  const seen = (c) => new Set((ex.seasons.courses[c] || []).map((i) => ex.seasons.terms[i].season));
  const off = [];
  for (const s of plan.semesters) for (const it of s.items) {
    if (it.kind !== 'course') continue;
    const k = seen(it.code);
    if (ex.seasons.courses[it.code]?.length >= 2 && !k.has(s.term.split(' ')[0]) && (k.has('Fall') || k.has('Spring'))) off.push(`${it.code} in ${s.term}`);
  }
  assert.deepEqual(off, []);
});

test('summer: at most 9 credits in a summer semester', () => {
  const req = ['A 1000', 'A 1010', 'A 1020', 'A 1030', 'A 1040', 'A 1050'];
  const prog = { requirements: req.map((code) => ({ type: 'course', code, alts: [], credits: 3 })), courses: Object.fromEntries(req.map((c) => [c, { credits: 3 }])), gradPlan: [] };
  const plan = P.makePlan(P.buildModel(prog), new Set(), { start: { season: 'Summer', year: 2027 }, summers: true, maxCredits: 18 });
  const summer = plan.semesters.filter((s) => /^Summer/.test(s.term));
  assert.ok(summer.length >= 1);
  for (const s of summer) assert.ok(s.credits <= 9, `${s.term}: ${s.credits} credits`);
});

test('outside prerequisite: EE gets a "Needed first" MATH 1080 box, planned before MATH 1210', () => {
  const m = P.buildModel(json('programs/electrical-engineering-bs.json'), EXTRA());
  const box = m.units.find((u) => u.outside && u.codes.includes('MATH 1080'));
  assert.ok(box, 'a MATH 1080 box');
  assert.deepEqual(box.neededFor, ['MATH 1210']);
  const plan = P.makePlan(m, new Set(), { start: { season: 'Fall', year: 2026 }, maxCredits: 16 });
  assert.ok(semOf(plan, 'MATH 1080') >= 0 && semOf(plan, 'MATH 1080') < semOf(plan, 'MATH 1210'), `1080 at ${semOf(plan, 'MATH 1080')}, 1210 at ${semOf(plan, 'MATH 1210')}`);
  assert.deepEqual(items(plan).find((x) => x.code === 'MATH 1080').neededFor, ['MATH 1210']);
  // a student who has MATH 1210 (or placed out of 1080) has no box left
  const done = P.makePlan(m, new Set(['MATH 1210']), { start: { season: 'Fall', year: 2026 } });
  assert.equal(semOf(done, 'MATH 1080'), -1);
  assert.match(P.requirementFor(m, 'MATH 1080').why || JSON.stringify(P.requirementFor(m, 'MATH 1080')), /Needed before MATH 1210/);
});

test('outside prerequisite in a Gen Ed list: the Gen Ed box comes first and names the class', () => {
  const m = P.buildModel(json('programs/physical-education-teacher-bs.json'), EXTRA());
  const ge = m.units.find((u) => u.kind === 'placeholder' && u.label === 'Biology');
  assert.deepEqual(ge.suggest, ['BIOL 1010']);
  const plan = P.makePlan(m, new Set(), { start: { season: 'Fall', year: 2026 }, maxCredits: 16 });
  const at = plan.semesters.findIndex((s) => s.items.some((x) => x.unitId === ge.id));
  assert.ok(at >= 0 && at < semOf(plan, 'ZOOL 1090'), `Biology box at ${at}, ZOOL 1090 at ${semOf(plan, 'ZOOL 1090')}`);
  assert.match(items(plan).find((x) => x.unitId === ge.id).title, /BIOL 1010 \(needed for ZOOL 1090\)/);
});

const GRADED = {
  requirements: [{ type: 'course', code: 'G 1000', alts: [], credits: 3, minGrade: 'C-' }, { type: 'course', code: 'G 2000', alts: [], credits: 3 }],
  courses: { 'G 1000': { title: 'Needs C-', credits: 3 }, 'G 2000': { title: 'After', credits: 3, prereqs: 'G 1000' } },
  gradPlan: [],
};
test('grade minimum: a D+ where C- is needed is planned again, with the reason', () => {
  const m = P.buildModel(GRADED);
  const plan = P.makePlan(m, new Set(['G 1000']), { start: { season: 'Fall', year: 2026 }, grades: { 'G 1000': 'D+' } });
  assert.equal(semOf(plan, 'G 1000'), 0);
  assert.ok(semOf(plan, 'G 2000') > 0, 'G 2000 waits for the retake');
  assert.deepEqual(items(plan).find((x) => x.code === 'G 1000').retake, { code: 'G 1000', grade: 'D+', min: 'C-' });
  assert.ok(plan.warnings.some((w) => /G 1000: a D\+ is below the C- this requirement needs/.test(w)));
  // a C- (or a transfer TCR) is enough
  for (const g of ['C-', 'TCR']) assert.equal(semOf(P.makePlan(m, new Set(['G 1000']), { start: { season: 'Fall', year: 2026 }, grades: { 'G 1000': g } }), 'G 1000'), -1, g);
});

test('grade minimum: the audit import marks the low row', () => {
  const m = P.buildModel(GRADED);
  const found = matchAudit({ taken: [{ code: 'G 1000', grade: 'D+', req: '' }, { code: 'G 2000', grade: 'B', req: '' }], inProgress: [] }, m);
  const low = found.rows.find((r) => r.code === 'G 1000');
  assert.equal(low.low, true);
  assert.equal(low.min, 'C-');
  assert.ok(!found.rows.find((r) => r.code === 'G 2000').low);
});

test('classes from outside the major fill free elective credits', () => {
  const prog = {
    requirements: [{ type: 'course', code: 'X 1000', alts: [], credits: 3 },
      { type: 'placeholder', area: 'Elective Requirements', label: 'Elective', credits: 6 }],
    courses: { 'X 1000': { credits: 3 } }, gradPlan: [],
  };
  const m = P.buildModel(prog);
  const before = items(P.makePlan(m, new Set(), { start: { season: 'Fall', year: 2026 } })).filter((x) => x.kind === 'placeholder').reduce((a, x) => a + x.credits, 0);
  const after = items(P.makePlan(m, new Set(['HIST 2700']), { start: { season: 'Fall', year: 2026 } })).filter((x) => x.kind === 'placeholder').reduce((a, x) => a + x.credits, 0);
  assert.equal(before, 6);
  assert.equal(after, 3);
  // a subject elective ("Elective (any ENGL course)") is not a free one
  const subj = P.buildModel({ ...prog, requirements: [prog.requirements[0], { type: 'placeholder', area: 'Elective Requirements', label: 'Elective (Complete any ENGL course)', credits: 6 }] });
  assert.equal(items(P.makePlan(subj, new Set(['HIST 2700']), { start: { season: 'Fall', year: 2026 } })).filter((x) => x.kind === 'placeholder').reduce((a, x) => a + x.credits, 0), 6);
});

test('major + minor: a minor class that is an option of the major list is taken once and counts for both', () => {
  const major = {
    name: 'Test Major, B.S.',
    requirements: [{ type: 'course', code: 'M 1000', alts: [], credits: 3 },
      { type: 'choice', area: 'Major', label: 'Choose one', pick: { count: 1 }, credits: 3, options: [{ codes: ['Y 1000'], credits: 3 }, { codes: ['Y 2000'], credits: 3 }] }],
    courses: { 'M 1000': { credits: 3 }, 'Y 1000': { credits: 3 }, 'Y 2000': { credits: 3 } }, gradPlan: [],
  };
  const minor = { name: 'Test Minor', requirements: [{ type: 'course', code: 'Y 1000', alts: [], credits: 3 }, { type: 'course', code: 'N 1000', alts: [], credits: 3 }], courses: { 'Y 1000': { credits: 3 }, 'N 1000': { credits: 3 } }, gradPlan: [] };
  const m = P.buildModel(combinePrograms([{ id: 'test-bs', program: major }, { id: 'test-minor', program: minor }]));
  const plan = P.makePlan(m, new Set(), { start: { season: 'Fall', year: 2026 } });
  assert.equal(plan.creditsLeft, 9, 'M 1000 + Y 1000 + N 1000');
  assert.ok(!items(plan).some((x) => x.kind === 'choice'), 'the major list is filled by Y 1000');
  assert.equal(items(plan).find((x) => x.code === 'Y 1000').shared, true);
  assert.match(P.requirementFor(m, 'Y 1000').why, /Counts once for both/);
});

test('bachelor totals: a plan under 120 credits or 40 upper-division credits says so', () => {
  const req = Array.from({ length: 10 }, (_, k) => `B ${1000 + k * 10}`);
  const prog = { name: 'Short, B.S.', requirements: req.map((code) => ({ type: 'course', code, alts: [], credits: 3 })), courses: Object.fromEntries(req.map((c) => [c, { credits: 3 }])), gradPlan: [] };
  const plan = P.makePlan(P.buildModel(prog), new Set(), { start: { season: 'Fall', year: 2026 } });
  assert.equal(plan.checks?.length, 2);
  assert.match(plan.checks[0], /adds up to 30 credits; a bachelor's degree needs 120\. Add 90 elective credits/);
  assert.match(plan.checks[1], /Upper-division \(3000\+\) credits: at most 0 of the 40/);
  // not a bachelor's: no checks
  assert.deepEqual(P.makePlan(P.buildModel({ ...prog, name: 'Short, Minor' }), new Set(), { start: { season: 'Fall', year: 2026 } }).checks, []);
  // the real EE B.S. meets both
  const ee = P.makePlan(P.buildModel(json('programs/electrical-engineering-bs.json'), EXTRA()), new Set(), { start: { season: 'Fall', year: 2026 }, maxCredits: 16 });
  assert.deepEqual(ee.checks, []);
  assert.ok(ee.totals.credits >= 120 && ee.totals.upper >= 40, JSON.stringify(ee.totals));
});

for (const id of ['nursing-bs', 'nursing-asn']) {
  test(`${id} with the full data: no NURS class before Apply, no outside box added`, () => {
    const m = P.buildModel(json(`programs/${id}.json`), EXTRA());
    const plan = P.makePlan(m, new Set(), { start: { season: 'Fall', year: 2026 }, maxCredits: 16 });
    const apply = P.planPhases(plan).find((x) => x.kind === 'milestone' && x.gate === 'admission');
    assert.ok(apply && apply.at >= 2, 'apply after the prerequisite semesters');
    const nurs = plan.semesters.findIndex((s) => s.items.some((x) => /^NURS /.test(x.code || '')));
    assert.ok(nurs >= apply.at, `first NURS at ${nurs}, apply at ${apply.at}`);
  });
}

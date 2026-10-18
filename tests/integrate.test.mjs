// Run: node --test tests/integrate.test.mjs
// Wave-1 integration (2026-10-17): the planner reads the parser's new fields (admissionInfo, course gate +
// prereq text, track subs/sub/recommended/shared). Real catalog files; one small fixture in real shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as P from '../js/planner.js';
import { gatesOf } from '../js/phases.js';

const ROOT = fileURLToPath(new URL('../data/', import.meta.url));
const load = (id, dir = 'programs') => JSON.parse(readFileSync(`${ROOT}${dir}/${id}.json`, 'utf8'));
const START = { season: 'Spring', year: 2027 };
const planOf = (p, done = new Set(), opts = {}) => {
  const m = P.buildModel(p);
  return { m, plan: P.makePlan(m, done, { start: START, maxCredits: 16, ...opts }) };
};
const semOf = (plan, code) => plan.semesters.findIndex((s) => s.items.some((x) => x.code === code || (x.codes || []).includes(code)));
const itemOf = (plan, code) => plan.semesters.flatMap((s) => s.items).find((x) => x.code === code || (x.codes || []).includes(code));

test('ECE 4900 (2025-26) needs program acceptance AND University Advanced Standing (parser keeps one gate)', () => {
  const p = load('electrical-engineering-bs', '2025-2026/programs');
  assert.deepEqual(gatesOf(p.courses['ECE 4900']).sort(), ['admission', 'advanced-standing']);
  assert.deepEqual(gatesOf(p.courses['ECE 3740']).sort(), ['admission', 'advanced-standing']);
  assert.deepEqual(gatesOf({ ...p.courses['ECE 4900'], gate: null }), [], 'an explicit null gate means none');
});

test('admissionInfo.gated: a class the program page lists as needing admission waits for Apply', () => {
  const prog = {
    id: 'fx', name: 'Fixture BS', requirements: [
      { type: 'course', area: 'Core', code: 'FX 1010', credits: 3 },
      { type: 'course', area: 'Core', code: 'FX 1020', credits: 3 },
      { type: 'course', area: 'Core', code: 'FX 3010', credits: 3 },
    ],
    courses: {
      'FX 1010': { title: 'One', credits: 3 },
      'FX 1020': { title: 'Two', credits: 3, prereqText: 'FX 1010', prereqs: 'FX 1010' },
      'FX 3010': { title: 'Three', credits: 3 }, // no prereq text at all: only the page's list gates it
    },
    admissionInfo: { before: ['FX 1010', 'FX 1020'], beforeFrom: 'matriculation section', gated: ['FX 3010'] },
    gradPlan: [],
  };
  const { plan } = planOf(prog, new Set(), { maxCredits: 6 });
  const apply = P.planPhases(plan).find((x) => x.kind === 'milestone' && x.gate === 'admission');
  assert.ok(apply, 'an Apply milestone');
  assert.ok(semOf(plan, 'FX 3010') >= apply.at, `FX 3010 in ${semOf(plan, 'FX 3010')}, Apply at ${apply.at}`);
  assert.ok(semOf(plan, 'FX 1020') < apply.at, 'the listed before-you-apply classes come first');
  assert.equal(itemOf(plan, 'FX 3010').gate, 'admission');
});

test('electrical-engineering-bs: the Apply milestone comes after the matriculation list (ECE 2250 + lab) is done', () => {
  for (const dir of ['programs', '2025-2026/programs']) {
    const { plan } = planOf(load('electrical-engineering-bs', dir));
    const apply = P.planPhases(plan).find((x) => x.kind === 'milestone' && x.gate === 'admission');
    assert.ok(apply, `${dir}: Apply milestone`);
    for (const c of ['ECE 2250', 'ECE 2700', 'PHYS 2220', 'MATH 1220']) assert.ok(semOf(plan, c) < apply.at, `${dir}: ${c} (${semOf(plan, c)}) before Apply (${apply.at})`);
    assert.ok(semOf(plan, 'ECE 3740') > semOf(plan, 'ECE 2250'), `${dir}: ECE 3740 after ECE 2250`);
    // ECE 3710 needs only MATH 1210 + Advanced Standing; the catalog's sample plan pairs it with ECE 2250
    assert.ok(semOf(plan, 'ECE 3710') >= semOf(plan, 'ECE 2250'), `${dir}: ECE 3710 not before ECE 2250`);
  }
  const cur = planOf(load('electrical-engineering-bs')).plan;
  assert.ok(semOf(cur, 'ECE 4730') < semOf(cur, 'ECE 4900'), '2026-27: ECE 4730 before ECE 4900');
  const old = planOf(load('electrical-engineering-bs', '2025-2026/programs')).plan;
  assert.equal(itemOf(old, 'ECE 4900').gate, 'admission', '2025-26: ECE 4900 is an admission class');
});

test('computer-science-bs CS Track: the track\'s pick lists are choices, not required classes', () => {
  const p = load('computer-science-bs');
  const { m, plan } = planOf(p, new Set(), { tracks: { [P.buildModel(p).units.find((u) => u.tracks)?.id]: 'CS Track' } });
  const g = m.units.find((u) => u.tracks);
  const items = plan.semesters.flatMap((s) => s.items).filter((x) => x.unitId === g.id || x.id.startsWith(g.id));
  const courses = items.filter((x) => x.kind === 'option').flatMap((x) => x.codes);
  // required in the CS Track: CS 3450, 4380, 4450, 4470; CS 2700 / ECE 4850 are only examples of the 18-credit list
  for (const c of ['CS 3450', 'CS 4380', 'CS 4450', 'CS 4470']) assert.ok(courses.includes(c), `${c} planned`);
  for (const c of ['CS 2700', 'ECE 4850']) assert.ok(!courses.includes(c), `${c} is a pick-list choice, not required`);
  const picks = items.filter((x) => x.kind === 'choice').reduce((a, x) => a + x.credits, 0);
  assert.equal(picks, 21, '18 + 3 credits of pick lists');
  assert.equal(items.reduce((a, x) => a + x.credits, 0), 33, 'the track totals 33 credits');
});

test('dance-bs: "recommended" classes inside a track are not planned as required', () => {
  const p = load('dance-bs');
  const m = P.buildModel(p);
  const g = m.units.find((u) => u.tracks);
  const rec = g.options.filter((o) => o.recommended);
  assert.ok(rec.length, 'the data marks some as recommended');
  for (const t of g.tracks) {
    const plan = P.makePlan(m, new Set(), { start: START, maxCredits: 16, tracks: { [g.id]: t } });
    const req = plan.semesters.flatMap((s) => s.items).filter((x) => x.kind === 'option' && x.unitId === g.id || x.id?.startsWith?.(g.id + '/'));
    for (const o of rec.filter((x) => x.section === t)) {
      assert.ok(!req.some((x) => x.id === o.id), `${t}: recommended ${o.label} not required`);
    }
  }
});

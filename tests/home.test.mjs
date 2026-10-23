// Run: node --test tests/home.test.mjs
// Home screen (js/home.js): which screen the app opens on, the credits bar, the admission fact, the name.
// Plans come from the real EE B.S. data through the real planner, like the site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as P from '../js/planner.js';
import { startTab, creditBar, admissionFact, nextFact, displayName, catalogLabel } from '../js/home.js';

const ROOT = fileURLToPath(new URL('../data/', import.meta.url));
const json = (p) => JSON.parse(readFileSync(ROOT + p, 'utf8'));
const EE = 'electrical-engineering-bs';
const ex = { extraCourses: json('prereq-courses.json'), gened: json('gened.json'), seasons: json('seasons.json') };
const model = P.buildModel(json(`programs/${EE}.json`), ex);
const OPTS = { start: { season: 'Fall', year: 2026 }, maxCredits: 16, seasons: ex.seasons };
const DONE = new Set(['ENGL 1010', 'MATH 1210', 'MATH 1220', 'PHYS 2210', 'PHYS 2215', 'ECE 1000', 'CHEM 1210', 'CHEM 1215']);

test('opens on Home; a link to another program opens its flowchart; a reload keeps the screen', () => {
  assert.equal(startTab(null, [EE], null), 'home', 'typed address');
  assert.equal(startTab(null, [], null), 'home', 'first visit');
  assert.equal(startTab(null, [EE], [EE]), 'home', 'a link naming the saved major (bookmark, home-screen icon)');
  assert.equal(startTab(null, [EE, 'mathematics-minor'], [EE]), 'home', 'older bookmark of the same major');
  assert.equal(startTab(null, [EE], ['nursing-bs']), 'flow', 'a shared link to another program');
  assert.equal(startTab(null, [], [EE]), 'flow', 'first visit from a link');
  assert.equal(startTab(null, [EE], [EE, 'mathematics-minor']), 'flow', 'a link adding a minor');
  assert.equal(startTab({ sa: 1, tab: 'sched' }, [EE], null), 'sched', 'reload on Schedule');
  assert.equal(startTab({ sa: 1, tab: 'nope' }, [EE], null), 'home');
  assert.equal(startTab({ tab: 'plan' }, [EE], null), 'home', 'only our own history entries');
});

test('credits bar: taken + current + each planned semester add up to the plan total', () => {
  const plan = P.makePlan(model, DONE, OPTS);
  const b = creditBar(plan, 4);
  assert.ok(b.total >= 120, `bachelor total ${b.total}`);
  assert.equal(b.left, plan.creditsLeft);
  const sum = Math.round(b.segs.reduce((s, x) => s + x.cr, 0) * 10) / 10;
  assert.equal(sum, b.total, 'parts add up');
  assert.equal(b.ip, 4);
  assert.equal(Math.round((b.taken + b.ip + b.left) * 10) / 10, b.total);
  assert.equal(b.pct, Math.floor((b.taken / b.total) * 100));
  assert.ok(b.taken + b.ip >= 20 && b.taken + b.ip < 35, `first-year classes ≈ 20-30 cr, got ${b.taken + b.ip}`);
  assert.deepEqual(b.segs.filter((s) => s.k === 'sem').map((s) => s.term), plan.semesters.map((s) => s.term));
});

test('credits bar: nothing taken = 0%; all done = 100%', () => {
  const none = creditBar(P.makePlan(model, new Set(), OPTS));
  assert.equal(none.taken, 0);
  assert.equal(none.pct, 0);
  assert.equal(none.segs[0].k, 'sem');
  assert.deepEqual(creditBar({ semesters: [], creditsLeft: 0, totals: { credits: 124 } }), { taken: 124, ip: 0, left: 0, total: 124, pct: 100, segs: [{ k: 'done', cr: 124 }] });
  assert.equal(creditBar(null).pct, 0);
});

test('admission: apply after the semester before the Apply row; admitted; none', () => {
  const plan = { semesters: [{ term: 'Fall 2026' }, { term: 'Spring 2027' }, { term: 'Fall 2027' }], admission: { at: 2, admitted: false } };
  assert.equal(admissionFact(plan, {}, 2), 'Apply after Spring 2027');
  assert.equal(admissionFact(plan, {}, 0), 'Apply now');
  assert.equal(admissionFact({ ...plan, admission: { admitted: true } }, {}, 1), 'Admitted');
  assert.equal(admissionFact({ semesters: [] }, { admission: true }, -1), 'Required');
  assert.equal(admissionFact({ semesters: [] }, {}, -1), null);
});

test('next semester, name, catalog year', () => {
  assert.equal(nextFact({ semesters: [{ term: 'Fall 2026', credits: 15 }] }), 'Fall 2026 · 15 cr');
  assert.equal(nextFact({ semesters: [] }), '');
  assert.equal(displayName({ name: ' Alex Student ', email: 'a@x.com' }), 'Alex Student');
  assert.equal(displayName({ name: '', email: 'alex.s@x.com' }), 'alex.s');
  assert.equal(displayName(null), null);
  assert.equal(catalogLabel('2025-2026'), 'Catalog 2025-26');
  assert.equal(catalogLabel(null), '');
});

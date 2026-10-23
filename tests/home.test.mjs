// Run: node --test tests/home.test.mjs
// Home screen (js/home.js): which screen the app opens on, each program's progress, graduation month, the name.
// Plans come from the real EE B.S. (+ Mathematics minor) data through the real planner, like the site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as P from '../js/planner.js';
import { combinePrograms } from '../js/programs.js';
import { startTab, programProgress, gradMonth, capName, displayName, catalogLabel, catalogShort } from '../js/home.js';

const ROOT = fileURLToPath(new URL('../data/', import.meta.url));
const json = (p) => JSON.parse(readFileSync(ROOT + p, 'utf8'));
const EE = 'electrical-engineering-bs';
const MINOR = 'mathematics-minor';
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
  assert.equal(startTab({ sa: 1, tab: 'profile' }, [EE], null), 'profile', 'reload on Profile');
  assert.equal(startTab({ sa: 1, tab: 'settings' }, [EE], null), 'settings', 'reload on Settings');
  assert.equal(startTab({ sa: 1, tab: 'nope' }, [EE], null), 'home');
  assert.equal(startTab({ tab: 'plan' }, [EE], null), 'home', 'only our own history entries');
});

test('progress, major only: finished + in progress + planned = the plan total', () => {
  const plan = P.makePlan(model, DONE, OPTS);
  const finished = new Set([...DONE].filter((k) => k !== 'ECE 1000')); // ECE 1000 in progress
  const [m] = programProgress(model, DONE, finished, plan, [EE]);
  assert.equal(m.id, EE);
  assert.equal(m.total, plan.totals.credits, 'same total as the plan');
  assert.equal(m.left, plan.creditsLeft);
  assert.ok(m.ip > 0 && m.ip <= 4, `ECE 1000 in progress: ${m.ip}`);
  assert.equal(Math.round((m.taken + m.ip + m.left) * 10) / 10, m.total);
  assert.equal(m.pct, Math.floor((m.taken / m.total) * 100));
  assert.ok(m.taken + m.ip >= 20 && m.taken + m.ip < 35, `first-year classes ≈ 20-30 cr, got ${m.taken + m.ip}`);
  const none = programProgress(model, new Set(), new Set(), P.makePlan(model, new Set(), OPTS), [EE])[0];
  assert.equal(none.taken, 0);
  assert.equal(none.pct, 0);
});

test('progress, major + minor: each program its own numbers, together the plan total', () => {
  const parts = [EE, MINOR].map((id) => ({ id, program: json(`programs/${id}.json`) }));
  const both = P.buildModel(combinePrograms(parts), ex);
  const done = new Set([...DONE, 'MATH 2210']);
  const plan = P.makePlan(both, done, OPTS);
  const [m, n] = programProgress(both, done, done, plan, [EE, MINOR]);
  assert.equal(n.id, MINOR);
  assert.ok(n.total >= 6 && n.total < 40, `minor total ${n.total}`);
  assert.ok(m.total > 100, `major total ${m.total}`);
  assert.equal(Math.round((m.total + n.total) * 10) / 10, plan.totals.credits, 'the two add up to the plan');
  assert.equal(Math.round((m.left + n.left) * 10) / 10, plan.creditsLeft);
  assert.ok(n.pct >= 0 && n.pct <= 100);
});

test('graduation month: the month the last semester ends', () => {
  assert.equal(gradMonth('Spring 2028'), 'May 2028');
  assert.equal(gradMonth('Summer 2027'), 'Aug 2027');
  assert.equal(gradMonth('Fall 2029'), 'Dec 2029');
  assert.equal(gradMonth(null), '');
  assert.equal(gradMonth('Winter 2028'), '');
});

test('names: each word capitalized, the student\'s own capitals kept', () => {
  assert.equal(capName('tim hadfield'), 'Tim Hadfield');
  assert.equal(capName('  tim   hadfield '), 'Tim Hadfield');
  assert.equal(capName('McDonald'), 'McDonald');
  assert.equal(capName('ronald mcDonald'), 'Ronald McDonald');
  assert.equal(capName("o'neil"), "O'Neil");
  assert.equal(capName('mary-jane watson'), 'Mary-Jane Watson');
  assert.equal(capName('ÉLODIE émond'), 'ÉLODIE Émond');
  assert.equal(capName(''), '');
  assert.equal(capName(null), '');
});

test('display name: Profile name first, then the Google name (lowercase fixed), then the email', () => {
  assert.equal(displayName({ name: ' Alex Student ', email: 'a@x.com' }), 'Alex Student');
  assert.equal(displayName({ name: 'tim hadfield', email: 'a@x.com' }), 'Tim Hadfield', 'all-lowercase Google name');
  assert.equal(displayName({ name: 'Ludwig van Beethoven' }), 'Ludwig van Beethoven', 'mixed case left as Google has it');
  assert.equal(displayName({ name: 'Alex Student' }, 'al'), 'Al', 'Profile name wins');
  assert.equal(displayName(null, 'sam lee'), 'Sam Lee', 'a guest can set one too');
  assert.equal(displayName({ name: 'Alex' }, '   '), 'Alex', 'blank Profile name = the Google name');
  assert.equal(displayName({ name: '', email: 'alex.s@x.com' }), 'alex.s');
  assert.equal(displayName(null), null);
});

test('catalog year labels', () => {
  assert.equal(catalogLabel('2025-2026'), 'Catalog 2025-26');
  assert.equal(catalogShort('2026-2027'), '2026-27');
  assert.equal(catalogLabel(null), '');
});

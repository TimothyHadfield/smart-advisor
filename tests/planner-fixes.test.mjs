// Run: node --test tests/planner-fixes.test.mjs
// Small fixtures, one per planner fix found by the all-programs check (real catalog shapes, made-up codes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, makePlan, choiceRemaining, unitDone, tapCheck, haveSet } from '../js/planner.js';

const START = { season: 'Fall', year: 2026 };
const prog = (requirements, courses) => ({ id: 't', name: 'T', totalCredits: 0, requirements, gradPlan: [], courses });
const course = (code, credits = 3, extra = {}) => ({ type: 'course', area: 'Core', code, alts: [], credits, ...extra });
const plan = (p, done = new Set(), max = 16) => makePlan(buildModel(p), done, { start: START, maxCredits: max });
const semOf = (pl, code) => pl.semesters.findIndex((s) => s.items.some((x) => x.code === code));

test('a 52-credit elective is split into small boxes spread over semesters, never over the cap', () => {
  const pl = plan(prog([
    course('PSY 1010'), course('PSY 2020'),
    { type: 'placeholder', area: 'Elective Requirements', label: 'Complete 52 credits of electives', credits: 52 },
  ], { 'PSY 1010': { credits: 3 }, 'PSY 2020': { credits: 3 } }));
  for (const s of pl.semesters) assert.ok(s.credits <= 16, `${s.term}: ${s.credits}`);
  const el = pl.semesters.flatMap((s) => s.items).filter((x) => x.unitId === 'ph:2');
  assert.equal(el.reduce((a, x) => a + x.credits, 0), 52);
  assert.ok(el.every((x) => x.credits <= 4));
  assert.equal(pl.semesters.length, 4); // 58 credits / 16
  assert.deepEqual(pl.warnings, []);
});

test('"prerequisite or corequisite" courses that name each other go in the same semester', () => {
  const pl = plan(prog([course('BIOL 1610', 4), course('BIOL 1615', 1), course('NURS 2300', 2), course('NURS 2320', 2)], {
    'BIOL 1610': { credits: 4, precoreqs: 'BIOL 1615' }, 'BIOL 1615': { credits: 1, precoreqs: 'BIOL 1610' },
    'NURS 2300': { credits: 2, precoreqs: 'NURS 2320' }, 'NURS 2320': { credits: 2, precoreqs: 'NURS 2300' },
  }));
  assert.deepEqual(pl.warnings, []);
  assert.equal(pl.semesters.length, 1);
  assert.equal(semOf(pl, 'BIOL 1610'), semOf(pl, 'BIOL 1615'));
});

test('a course listing itself as a prerequisite (MUSC 1110) is not blocked', () => {
  const pl = plan(prog([course('MUSC 1110'), course('MUSC 2110')], {
    'MUSC 1110': { credits: 3, prereqs: { or: ['MUSC 1105', 'MUSC 1110'] } },
    'MUSC 2110': { credits: 3, prereqs: 'MUSC 1110' },
  }));
  assert.deepEqual(pl.warnings, []);
  assert.equal(semOf(pl, 'MUSC 1110'), 0);
  assert.equal(semOf(pl, 'MUSC 2110'), 1);
});

test('an "or" alternative inside a choice option counts (PHIL 2150 for "PHIL 2110 or PHIL 2150")', () => {
  const p = prog([
    { type: 'choice', area: 'Core', label: 'Choose 1', pick: { count: 1 }, credits: 3, options: [{ codes: ['PHIL 2110'], credits: 3, alts: ['PHIL 2150'] }] },
    course('PHIL 3000'),
  ], { 'PHIL 2110': { credits: 3 }, 'PHIL 2150': { credits: 3 }, 'PHIL 3000': { credits: 3, prereqs: 'PHIL 2110' } });
  const m = buildModel(p);
  const done = new Set(['PHIL 2150']);
  assert.equal(choiceRemaining(m.units[0], done), 0);
  assert.ok(unitDone(m.units[0], done));
  assert.ok(unitDone(m.units[0].options[0], done));
  const pl = makePlan(m, done, { start: START });
  assert.deepEqual(pl.semesters.flatMap((s) => s.items.map((x) => x.unitId)), ['PHIL 3000']);
  // the alternative also counts as the listed option for prereqs and taps
  assert.ok(haveSet(m, done).has('PHIL 2110'));
  assert.ok(tapCheck(m, m.byCode['PHIL 3000'], done).ok);
});

test('"NSS 4300 or NSS 3050" where 4300 needs 3050: plans 3050, no forced placement', () => {
  const pl = plan(prog([course('NSS 4300', 3, { alts: ['NSS 3050'] })], {
    'NSS 4300': { credits: 3, prereqs: { and: ['NSS 2010', 'NSS 3050'] } }, 'NSS 3050': { credits: 3, prereqs: null },
  }));
  assert.deepEqual(pl.warnings, []);
  assert.equal(pl.semesters.length, 1);
  assert.equal(pl.semesters[0].items[0].code, 'NSS 3050');
});

test('tracks: one track is planned in full, courses from different tracks are not mixed', () => {
  const opt = (code, section) => ({ codes: [code], credits: 3, section });
  const p = prog([{
    type: 'choice', area: 'Tracks', label: 'Choose 6 credits', pick: { credits: 6 }, credits: 6, tracks: ['Sound Track', 'Game Track'],
    options: [opt('DAPR 2170', 'Sound Track'), opt('DAPR 3170', 'Sound Track'), opt('DAPR 2110', 'Game Track'), opt('DAPR 3110', 'Game Track')],
  }], { 'DAPR 2170': { credits: 3 }, 'DAPR 3170': { credits: 3, prereqs: 'DAPR 2170' }, 'DAPR 2110': { credits: 3 }, 'DAPR 3110': { credits: 3 } });
  const codes = (pl) => pl.semesters.flatMap((s) => s.items.map((x) => x.code)).filter(Boolean).sort();
  const a = plan(p);
  assert.deepEqual(codes(a), ['DAPR 2170', 'DAPR 3170']);
  assert.ok(semOf(a, 'DAPR 2170') < semOf(a, 'DAPR 3170'), 'prereqs inside the track are kept');
  // progress in the other track decides
  assert.deepEqual(codes(plan(p, new Set(['DAPR 3110']))), ['DAPR 2110']);
});

test('repeatable "R" courses: one enrollment per semester (inferred, or the data\'s repeat count)', () => {
  const a = plan(prog([course('MUSC 2500R', 4)], { 'MUSC 2500R': { credits: 1 } }));
  assert.equal(a.semesters.length, 4);
  assert.ok(a.semesters.every((s) => s.items.length === 1 && s.items[0].credits === 1 && s.items[0].code === 'MUSC 2500R'));
  const b = plan(prog([course('DAGV 4900R', 6, { repeat: 2 })], { 'DAGV 4900R': { credits: 3 } }));
  assert.deepEqual(b.semesters.map((s) => s.credits), [3, 3]);
});

test('credit ranges: a 1-8 credit course needed for 10 credits is split; 6 of 1-8 stays one', () => {
  const a = plan(prog([course('SW 4810R', 10)], { 'SW 4810R': { credits: 1, creditsMax: 8 } }), new Set(), 16);
  assert.deepEqual(a.semesters.map((s) => s.credits), [5, 5]);
  const b = plan(prog([course('SUDC 4810R', 6)], { 'SUDC 4810R': { credits: 1, crMax: 8 } }));
  assert.deepEqual(b.semesters.map((s) => s.credits), [6]);
});

test('"SW 4800 or SW 4850" coreqs: one is enough; a repeatable course listed twice is taken twice', () => {
  const pl = plan(prog([course('SW 4800', 1), course('SW 4810R', 5), course('SW 4810R', 5), course('SW 4850', 1)], {
    'SW 4800': { credits: 1, coreqText: 'SW 4810R', coreqs: ['SW 4810R'] },
    'SW 4810R': { credits: 1, creditsMax: 8, coreqText: 'SW 4800 or SW 4850', coreqs: ['SW 4800', 'SW 4850'] },
    'SW 4850': { credits: 1, prereqs: 'SW 4800', coreqText: 'SW 4810R', coreqs: ['SW 4810R'] },
  }));
  assert.deepEqual(pl.warnings, []);
  assert.deepEqual(pl.semesters.map((s) => s.items.map((x) => x.code).sort().join(' + ')), ['SW 4800 + SW 4810R', 'SW 4810R + SW 4850']);
});

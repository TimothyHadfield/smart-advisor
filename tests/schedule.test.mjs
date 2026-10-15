// Run: node tests/schedule.test.mjs
// The schedule builder (js/schedule.js): meetings, conflicts, linked lecture/lab sections, online
// sections and ranking. Fixtures = real rows from data/sections/202720.json (Spring 2027, fetched
// 2026-10-15). The live data has no `link` values yet, so the linked test adds link ids to real rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  toMin, meetingsOf, usable, courseOptions, optionsConflict, buildSchedules, termInfo, defaultTerm,
  currentTermCode, rmpHue, DEFAULT_PREFS, groupSections,
} from '../js/schedule.js';

const base = { campus: 'Main Campus', kind: 'Regular Class without Lab', wait: 0, sd: '2027-01-11', ed: '2027-05-05' };
const R = (o) => ({ ...base, ...o });
// ECE 2250 + its lab ECE 2255, PHYS 2220 + lab 2225, MATH 2250 (real rows, a few trimmed fields)
const ECE2250 = [R({ crn: '14874', subj: 'ECE', num: '2250', sec: '001', title: 'Circuit Theory', cr: 3, days: 'TR', start: '0830', end: '0945', bldg: 'SE', room: '320', mode: 'in person', instr: 'Manzak, Ali', seats: 30, cap: 30 })];
const ECE2255 = [
  R({ crn: '14869', subj: 'ECE', num: '2255', sec: '201', title: 'Circuit Theory Lab', cr: 1, days: 'W', start: '1300', end: '1550', bldg: 'SE', room: '321', mode: 'in person', kind: 'Laboratory', instr: null, seats: 9, cap: 24 }),
  R({ crn: '29308', subj: 'ECE', num: '2255', sec: '202', title: 'Circuit Theory Lab', cr: 1, days: 'F', start: '0800', end: '1050', bldg: 'SE', room: '321', mode: 'in person', kind: 'Laboratory', instr: null, seats: 9, cap: 24 }),
];
const PHYS2220 = [
  R({ crn: '40116', subj: 'PHYS', num: '2220', sec: '001', title: 'Physics for Scientists and Engineers II', cr: 4, days: 'MTWRF', start: '0900', end: '0950', bldg: 'SB', room: '134', mode: 'in person', instr: 'Spencer, Ross L.', seats: 40, cap: 40 }),
  R({ crn: '10355', subj: 'PHYS', num: '2220', sec: '002', title: 'Physics for Scientists and Engineers II', cr: 4, days: 'MTWRF', start: '1100', end: '1150', bldg: 'SB', room: '134', mode: 'in person', instr: 'Young, York E.', seats: 40, cap: 40 }),
  R({ crn: '20740', subj: 'PHYS', num: '2220', sec: '601', title: 'Physics for Scientists and Engineers II', cr: 4, days: 'T', start: '1800', end: '2100', bldg: 'SB', room: '134', mode: 'in person', instr: 'Nielsen, Kim', seats: 28, cap: 28 }),
];
const PHYS2225 = [
  R({ crn: '10358', subj: 'PHYS', num: '2225', sec: '202', title: 'Physics Lab II', cr: 1, days: 'F', start: '1300', end: '1450', bldg: 'SB', room: '140', mode: 'in person', kind: 'Laboratory', instr: 'Miles, James A.', seats: 28, cap: 28 }),
  R({ crn: '30903', subj: 'PHYS', num: '2225', sec: '203', title: 'Physics Lab II', cr: 1, days: 'W', start: '1100', end: '1250', bldg: 'SB', room: '140', mode: 'in person', kind: 'Laboratory', instr: 'Duling, Kristin J.', seats: 28, cap: 28 }),
];
const MATH2250 = [
  R({ crn: '34408', subj: 'MATH', num: '2250', sec: '003', title: 'Differential Equations and Linear Algebra', cr: 4, days: 'MTWR', start: '1200', end: '1250', bldg: 'LA', room: '101', mode: 'in person', instr: 'Simons, Joe M.', seats: 31, cap: 35 }),
  R({ crn: '38835', subj: 'MATH', num: '2250', sec: '004', title: 'Differential Equations and Linear Algebra', cr: 4, days: 'MTWR', start: '1400', end: '1450', bldg: 'LA', room: '101', mode: 'in person', instr: 'Platt, Kenyon J.', seats: 30, cap: 35 }),
];
// hybrid with two meetings: Tue in a room + an online part (real ACC 3020-001)
const ACC3020 = R({ crn: '12535', subj: 'ACC', num: '3020', sec: '001', title: 'Intermediate Accounting II', cr: 3, days: 'T', start: '1130', end: '1245', bldg: 'CS', room: '403',
  meetings: [{ days: 'T', start: '1130', end: '1245', bldg: 'CS', room: '403', sd: '2027-01-11', ed: '2027-05-05' }, { days: '', start: null, end: null, bldg: 'ONLINE', room: 'ONLINE', sd: '2027-01-11', ed: '2027-05-05' }],
  mode: 'hybrid', instr: 'Smith, Kevin R.', seats: 40, cap: 40 });
// an online section with no set time (real MATH 1210 X01 shape)
const MATH1210X = R({ crn: '41001', subj: 'MATH', num: '1210', sec: 'X01', title: 'Calculus I', cr: 4, days: '', start: null, end: null, bldg: 'ONLINE', room: 'ONLINE', mode: 'online', instr: null, seats: 35, cap: 35 });
const RMP = { 'Spencer, Ross L.': { r: 2.6, id: 1 }, 'Young, York E.': { r: 4.8, id: 2 }, 'Nielsen, Kim': { r: 3.0, id: 3 }, 'Simons, Joe M.': { r: 4.0, id: 4 }, 'Platt, Kenyon J.': { r: 3.1, id: 5 } };
const course = (code, sections) => ({ code, sections });

test('times and meetings: one row per day, minutes from midnight; online has none', () => {
  assert.equal(toMin('0830'), 510);
  assert.equal(toMin(null), null);
  const m = meetingsOf(PHYS2220[0]);
  assert.deepEqual(m.map((x) => x.day).join(''), 'MTWRF');
  assert.deepEqual([m[0].s, m[0].e], [540, 590]);
  assert.deepEqual(meetingsOf(MATH1210X), []);
  // multi-meeting hybrid: only the timed meeting counts
  assert.deepEqual(meetingsOf(ACC3020).map((x) => [x.day, x.s, x.e]), [['T', 690, 765]]);
});

test('conflicts: overlapping times on a shared day, but not back-to-back or different dates', () => {
  const opt = (s) => ({ secs: [s] });
  // PHYS 2220-002 MTWRF 11:00 vs ACC 3020 Tue 11:30 -> overlap
  assert.equal(optionsConflict(opt(PHYS2220[1]), opt(ACC3020)), true);
  // PHYS 2220-001 9:00-9:50 vs ECE 2250 TR 8:30-9:45 -> overlap
  assert.equal(optionsConflict(opt(PHYS2220[0]), opt(ECE2250[0])), true);
  // back-to-back: ends 9:50, another starts 9:50 -> fine
  const after = R({ ...PHYS2220[0], crn: 'x', start: '0950', end: '1040' });
  assert.equal(optionsConflict(opt(PHYS2220[0]), opt(after)), false);
  // same time, different days
  assert.equal(optionsConflict(opt(ECE2255[0]), opt(R({ ...ECE2255[0], crn: 'y', days: 'M' }))), false);
  // same slot but the two halves of the term (B1 then B2) never meet at once
  const b1 = R({ ...ECE2250[0], crn: 'b1', ed: '2027-03-02', pt: 'B1' });
  const b2 = R({ ...ECE2250[0], crn: 'b2', sd: '2027-03-08', pt: 'B2' });
  assert.equal(optionsConflict(opt(b1), opt(b2)), false);
  // online with no time never conflicts
  assert.equal(optionsConflict(opt(MATH1210X), opt(PHYS2220[0])), false);
});

test('high-school concurrent enrollment sections are not offered to students', () => {
  assert.equal(usable(R({ ...MATH1210X, pt: 'HSS' })), false);
  assert.equal(usable(R({ ...MATH1210X, pt: 'HSD' })), false);
  assert.equal(usable(R({ ...MATH1210X, pt: 'B1' })), true);
  assert.equal(usable(MATH1210X), true);
});

test('linked sections: a course with link ids needs one lecture + one matching lab', () => {
  const lec = [R({ ...PHYS2220[0], link: 'A1' }), R({ ...PHYS2220[1], link: 'A2' })];
  // lecture 001 (9:00) + Wed 11:00 lab; lecture 002 (11:00) + either Friday lab
  const lab = [R({ ...PHYS2225[1], num: '2220', link: 'A1' }), R({ ...PHYS2225[0], num: '2220', link: 'A2' }), R({ ...PHYS2225[0], crn: '99999', num: '2220', link: 'A2' })];
  const opts = courseOptions([...lec, ...lab]);
  assert.equal(opts.length, 3);
  for (const o of opts) {
    assert.equal(o.secs.length, 2);
    assert.equal(o.secs[0].link, o.secs[1].link);
    assert.equal(o.secs.filter((s) => s.kind === 'Laboratory').length, 1);
  }
  // unlinked course: each section alone
  assert.equal(courseOptions(PHYS2220).length, 3);
  // lecture + lab whose link ids don't pair by value (Banner style A/B): any lab goes with any lecture
  const lec2 = [R({ ...PHYS2220[0], link: 'L' })];
  const lab2 = [R({ ...PHYS2225[0], num: '2220', link: 'B' }), R({ ...PHYS2225[1], num: '2220', link: 'B' })];
  assert.equal(courseOptions([...lec2, ...lab2]).length, 2);
  // a linked lab that conflicts with its own lecture is never offered
  const clash = [R({ ...PHYS2220[1], link: 'C' }), R({ ...PHYS2225[1], num: '2220', link: 'C', start: '1100', end: '1250', days: 'W' })];
  assert.equal(courseOptions(clash).length, 0);
});

test('groupSections: by course code, high-school sections dropped', () => {
  const g = groupSections([...PHYS2220, R({ ...MATH1210X, pt: 'HSS' }), MATH1210X]);
  assert.deepEqual([...g.keys()].sort(), ['MATH 1210', 'PHYS 2220']);
  assert.equal(g.get('MATH 1210').length, 1);
});

test('builder: no schedule it returns has a time conflict; every course placed when possible', () => {
  const courses = [course('ECE 2250', ECE2250), course('ECE 2255', ECE2255), course('PHYS 2220', PHYS2220), course('PHYS 2225', PHYS2225), course('MATH 2250', MATH2250)];
  const { list } = buildSchedules(courses, DEFAULT_PREFS, RMP);
  assert.ok(list.length > 1);
  for (const s of list) {
    const opts = s.picks.filter(Boolean);
    for (let i = 0; i < opts.length; i++) for (let j = i + 1; j < opts.length; j++) assert.equal(optionsConflict(opts[i], opts[j]), false, s.crns.join(' '));
  }
  assert.equal(list[0].picks.filter(Boolean).length, 5);
  // ECE 2250 is TR 8:30-9:45, so PHYS 2220-001 (MTWRF 9:00) can never be in it
  assert.ok(list.every((s) => !s.crns.includes('40116')));
  // sorted best first
  for (let i = 1; i < list.length; i++) assert.ok(list[i].cost >= list[i - 1].cost);
});

test('builder: better-rated professor wins when everything else is equal', () => {
  const { list } = buildSchedules([course('MATH 2250', MATH2250)], { ...DEFAULT_PREFS, gaps: false }, RMP);
  assert.equal(list[0].crns[0], '34408'); // Simons 4.0 over Platt 3.1
  const off = buildSchedules([course('MATH 2250', MATH2250)], { ...DEFAULT_PREFS, rmp: false, before: '1300' }, RMP);
  assert.equal(off.list[0].crns[0], '34408'); // also ends before 1 pm
  const late = buildSchedules([course('MATH 2250', MATH2250)], { ...DEFAULT_PREFS, rmp: false, after: '1300' }, RMP);
  assert.equal(late.list[0].crns[0], '38835'); // the 2 pm one starts after 1 pm
});

test('builder: preferred days and online preference rank the matching section first', () => {
  // no Fridays: PHYS 2225-203 (Wed) over 202 (Fri)
  const { list } = buildSchedules([course('PHYS 2225', PHYS2225)], { ...DEFAULT_PREFS, days: 'MTWR' }, RMP);
  assert.equal(list[0].crns[0], '30903');
  const both = [MATH1210X, R({ ...MATH1210X, crn: '41002', sec: '001', days: 'MTWR', start: '0900', end: '0950', mode: 'in person', bldg: 'LA', room: '1' })];
  assert.equal(buildSchedules([course('MATH 1210', both)], { ...DEFAULT_PREFS, mode: 'online' }, RMP).list[0].crns[0], '41001');
  assert.equal(buildSchedules([course('MATH 1210', both)], { ...DEFAULT_PREFS, mode: 'person' }, RMP).list[0].crns[0], '41002');
});

test('builder: avoid gaps packs classes together', () => {
  // ECE 2250 TR 8:30-9:45 + PHYS 2220 (9:00 conflicts) -> 002 at 11:00 or 601 Tue 18:00; gaps prefers 11:00 (1h15 gap vs 8h)
  const { list } = buildSchedules([course('ECE 2250', ECE2250), course('PHYS 2220', PHYS2220)], { ...DEFAULT_PREFS, rmp: false }, RMP);
  assert.deepEqual(list[0].crns, ['14874', '10355']);
});

test('builder: online sections join any schedule; full sections need the waitlist switch', () => {
  const full = PHYS2225.map((s) => ({ ...s, seats: 0, wait: 3 }));
  const off = buildSchedules([course('MATH 1210', [MATH1210X]), course('PHYS 2225', full)], DEFAULT_PREFS, RMP);
  assert.deepEqual(off.list[0].crns, ['41001']);
  assert.deepEqual(off.list[0].unplaced, ['PHYS 2225']);
  const on = buildSchedules([course('MATH 1210', [MATH1210X]), course('PHYS 2225', full)], { ...DEFAULT_PREFS, wait: true }, RMP);
  assert.equal(on.list[0].crns.length, 2);
  assert.deepEqual(on.list[0].unplaced, []);
});

test('builder: a pinned section is kept; a course that cannot fit is reported, not dropped silently', () => {
  const pinned = buildSchedules([course('PHYS 2220', PHYS2220)], DEFAULT_PREFS, RMP, { pins: { 'PHYS 2220': '20740' } });
  assert.ok(pinned.list.every((s) => s.crns[0] === '20740'));
  // two courses that only meet at the same time
  const a = [ECE2250[0]], b = [R({ ...ECE2250[0], crn: 'z1', subj: 'ECE', num: '3300' })];
  const r = buildSchedules([course('ECE 2250', a), course('ECE 3300', b)], DEFAULT_PREFS, RMP);
  assert.equal(r.list[0].unplaced.length, 1);
});

test('builder: real Spring 2027 data for an EE semester runs fast and finds a full schedule', () => {
  const rows = JSON.parse(readFileSync(new URL('../data/sections/202720.json', import.meta.url), 'utf8')).sections;
  const g = groupSections(rows);
  const codes = ['ECE 2250', 'ECE 2255', 'PHYS 2220', 'PHYS 2225', 'MATH 2250', 'ENGL 2010'];
  const t = Date.now();
  const { list } = buildSchedules(codes.map((c) => course(c, g.get(c) || [])), DEFAULT_PREFS, {});
  assert.ok(Date.now() - t < 1500, `took ${Date.now() - t} ms`);
  assert.ok(list.length >= 5);
  assert.deepEqual(list[0].unplaced, []);
});

test('terms: codes to names, and the default is the next term that has data', () => {
  assert.deepEqual(termInfo('202720'), { code: '202720', season: 'Spring', year: 2027, label: 'Spring 2027', short: 'Sp 27' });
  assert.equal(termInfo('202640').label, 'Fall 2026');
  assert.equal(currentTermCode(new Date(2026, 9, 15)), '202640');
  assert.equal(defaultTerm(['202640', '202720'], new Date(2026, 9, 15)), '202720');
  assert.equal(defaultTerm(['202640'], new Date(2026, 9, 15)), '202640'); // only this term: show it
  assert.equal(defaultTerm(['202720', '202740'], new Date(2027, 1, 1)), '202740');
});

test('rating colour: red at 2.5 or below, green at 4.5 or above', () => {
  assert.equal(rmpHue(2.0), 0);
  assert.equal(rmpHue(4.5), 120);
  assert.equal(rmpHue(3.5), 60);
  assert.equal(rmpHue(null), null);
});

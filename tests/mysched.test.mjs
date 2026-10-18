// Run: node --test tests/mysched.test.mjs
// "My schedule" (js/mysched.js): reading a pasted / saved myUVU (Banner) registration page, the audit
// prefill, and hand-added classes. Section rows = real Fall 2026 rows (tests/fixtures/reg/
// sections-202640.json, copied from data/sections/202640.json on 2026-10-17). The page samples in
// tests/fixtures/reg/ are made up (fake student) but shaped like Banner 9 "View Registration Information"
// (Schedule Details blocks + the summary table), Banner 8 "Concise Student Schedule" and "Student
// Detail Schedule", and a saved HTML page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groupSections } from '../js/schedule.js';
import {
  parseRegistration, entriesFrom, prefillFromAudit, termCode, termOfText, htmlToText,
  normDays, normTime, mineRows, choose, handSection,
} from '../js/mysched.js';
import { meetingsOf } from '../js/schedule.js';

const FIX = new URL('./fixtures/reg/', import.meta.url);
const data = JSON.parse(readFileSync(new URL('sections-202640.json', FIX), 'utf8'));
const groups = groupSections(data.sections);
const subjects = data.subjects;
const read = (f) => readFileSync(new URL(f, FIX), 'utf8');
const crns = (r) => r.matched.map((x) => x.crn).sort();

test('Banner 9 Schedule Details: CRNs read, Web Drop skipped, IDs / zip codes ignored', () => {
  const r = parseRegistration(read('banner9-details.txt'), groups, subjects);
  assert.deepEqual(crns(r), ['14896', '27560', '29851', '42155'].sort());
  assert.ok(!r.matched.some((x) => x.code === 'ECE 2700'), 'dropped class not added');
  assert.deepEqual(r.pick, []);
  assert.deepEqual(r.unmatched, []);
});

test('Banner 9 summary table: matched rows, dropped row skipped, unknown CRN + course listed as unmatched', () => {
  const r = parseRegistration(read('banner9-summary.txt'), groups, subjects);
  assert.deepEqual(crns(r), ['14896', '29851', '30468']);
  assert.ok(!r.matched.some((x) => x.code === 'ECE 2700'));
  assert.deepEqual(r.unmatched, [{ code: 'ECE 3500', sec: '001', crn: '99999' }]);
});

test('Banner 8 Concise Student Schedule rows', () => {
  const r = parseRegistration(read('concise.txt'), groups, subjects);
  assert.deepEqual(crns(r), ['12241', '14896', '36452']);
  assert.deepEqual(r.unmatched, []);
});

test('Banner 8 Student Detail Schedule blocks (Web Drop block skipped)', () => {
  const r = parseRegistration(read('detail.txt'), groups, subjects);
  assert.deepEqual(crns(r), ['14896', '39625']);
});

test('saved HTML page: table cells read, scripts and comments ignored', () => {
  const r = parseRegistration(htmlToText(read('banner9-saved.html')), groups, subjects);
  assert.deepEqual(crns(r), ['14896', '29828', '36451']);
  assert.equal(termOfText(htmlToText(read('banner9-saved.html')), ['202640', '202720']), '202640');
});

test('no CRNs: subject + number + section, then the course code alone', () => {
  const text = 'My classes: ECE 2250-601, MATH 2210 sec 004, HIST 2700, ECE 3990 001';
  const r = parseRegistration(text, groups, subjects);
  assert.deepEqual(crns(r), ['14896', '41919']);
  assert.deepEqual(r.pick, ['HIST 2700']);
  assert.deepEqual(r.unmatched.map((u) => u.code), ['ECE 3990']);
  // a course with one section in the term is filled in; several -> pick
  const e = entriesFrom(r, groups);
  assert.deepEqual(e.find((x) => x.code === 'HIST 2700'), { code: 'HIST 2700', crn: '' });
});

test('"Fall 2026" in plain words is not a course; lowercase subjects ignored', () => {
  const r = parseRegistration('Term: FALL 2026\nmath 2210 is hard', groups, { ...subjects, FALL: 'Fake' });
  assert.deepEqual(r.matched, []);
});

test('term from the page', () => {
  assert.equal(termCode('Fall 2026'), '202640');
  assert.equal(termCode('2027 Spring'), '202720');
  assert.equal(termCode('Summer 2027'), '202730');
  assert.equal(termCode('nope'), null);
  assert.equal(termOfText(read('concise.txt'), ['202640', '202720']), '202640');
  assert.equal(termOfText('Spring 2027 Spring 2027 Fall 2026', ['202640', '202720']), '202720');
  assert.equal(termOfText('Fall 2030', ['202640']), null);
});

test('audit prefill: one section -> filled, several -> pick, not offered -> listed', () => {
  const { entries, none } = prefillFromAudit(['ECE 2250', 'MATH 2210', 'ECE 4900', 'ECE 2250'], groups);
  assert.deepEqual(entries, [{ code: 'ECE 2250', crn: '14896' }, { code: 'MATH 2210', crn: '' }]);
  assert.deepEqual(none, ['ECE 4900']);
});

test('rows: picks, sections, hand-added classes on the grid; choosing a section', () => {
  let e = [{ code: 'ECE 2250', crn: '14896' }, { code: 'MATH 2210', crn: '' }, { code: 'WORK 1000', days: 'TR', start: '0930', end: '1045', hand: 1 }];
  let rows = mineRows(e, groups);
  assert.deepEqual(rows.map((r) => r.pick), [false, true, false]);
  assert.equal(meetingsOf(rows[2].sec).length, 2, 'hand-added class has a Tue + Thu block');
  e = choose(e, 'MATH 2210', '39625');
  rows = mineRows(e, groups);
  assert.equal(rows[1].sec.crn, '39625');
  assert.equal(rows[1].pick, false);
  // a CRN that left the data becomes a pick again
  assert.equal(mineRows([{ code: 'MATH 2210', crn: '00000' }], groups)[0].pick, true);
  assert.equal(handSection({ code: 'Work', days: 'M', start: '0800', end: '0900' }).subj, 'Work');
});

test('hand entry: days and times in the ways people type them', () => {
  assert.equal(normDays('M W F'), 'MWF');
  assert.equal(normDays('Tu Th'), 'TR');
  assert.equal(normDays('TTh'), 'TR');
  assert.equal(normDays('Monday, Wednesday'), 'MW');
  assert.equal(normDays('Saturday'), 'S');
  assert.equal(normTime('09:30'), '0930');
  assert.equal(normTime('1:15 pm'), '1315');
  assert.equal(normTime('12:00 am'), '0000');
  assert.equal(normTime('25:00'), null);
});

test('full Fall 2026 file: a page built from real rows is read back in well under a second', () => {
  const all = JSON.parse(readFileSync(new URL('../data/sections/202640.json', import.meta.url), 'utf8'));
  const g = groupSections(all.sections);
  const pickRows = [...g.values()].filter((rows) => rows.length > 1).slice(0, 5).map((rows) => rows[1]);
  const text = pickRows.map((s) => `${s.title}\t${s.subj} ${s.num}, ${s.sec}\t${s.cr}\t${s.crn}\tLecture\tRegistered`).join('\n');
  const t0 = performance.now();
  const r = parseRegistration(text, g, all.subjects);
  assert.ok(performance.now() - t0 < 1000);
  assert.deepEqual(crns(r), pickRows.map((s) => s.crn).sort());
});

// Run: node --test tests/schedterms.test.mjs
// The Schedule's term bar (Past | Current | Future), the full time range on week blocks, the condensed hours.
// Tim, 2026-10-23: "make past and future semesters be able to be selected at the top based on the user's
// wolverine track they uploaded ... Seperate Past, Current, and Future semesters in the top bar ... (If the next
// semester's courses are open, put that in the current category)". Synthetic audit terms only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitTerms, classesInTerm, timeRange, whenFull, hourWindow, codeOfLabel } from '../js/schedule.js';

test('term labels to Banner codes', () => {
  assert.equal(codeOfLabel('Fall 2025'), '202540');
  assert.equal(codeOfLabel('2026 Spring'), '202620');
  assert.equal(codeOfLabel('Summer 2026'), '202630');
  assert.equal(codeOfLabel(''), null);
});

test('Past = audit terms before now, Current = now + published next terms, Future = plan terms after', () => {
  const g = splitTerms({
    sections: ['202640', '202720'],
    current: '202640',
    past: ['Fall 2025', 'Spring 2026', 'Fall 2025', 'Fall 2026', 'Summer 2025'],
    planned: ['Spring 2027', 'Fall 2027', 'Spring 2028'],
  });
  assert.deepEqual(g.past, ['202530', '202540', '202620'], 'oldest first, no repeats, the current term not past');
  assert.deepEqual(g.current, ['202640', '202720'], 'Spring 2027 has sections: Current');
  assert.deepEqual(g.future, ['202740', '202820'], 'plan terms after Current');
});

test('next term without published sections is Future; no audit = no Past', () => {
  const g = splitTerms({ sections: ['202640'], current: '202640', past: [], planned: ['Spring 2027', 'Fall 2027'] });
  assert.deepEqual(g.past, []);
  assert.deepEqual(g.current, ['202640']);
  assert.deepEqual(g.future, ['202720', '202740']);
});

test('a past term lists the audit classes taken then, with grades', () => {
  const when = { 'MATH 1210': 'Fall 2025', 'ENGL 1010': 'Fall 2025', 'MATH 1220': 'Spring 2026', 'ECE 2250': 'Fall 2026' };
  const grades = { 'MATH 1210': 'B+', 'ENGL 1010': 'A', 'MATH 1220': 'A-' };
  assert.deepEqual(classesInTerm(when, grades, '202540'), [{ code: 'ENGL 1010', grade: 'A' }, { code: 'MATH 1210', grade: 'B+' }]);
  assert.deepEqual(classesInTerm(when, grades, '202620'), [{ code: 'MATH 1220', grade: 'A-' }]);
  assert.deepEqual(classesInTerm({}, {}, '202540'), []);
});

test('full time range on blocks and list rows', () => {
  assert.equal(timeRange(600, 675), '10–11:15');
  assert.equal(timeRange(570, 645), '9:30–10:45');
  assert.equal(timeRange(780, 900), '1–3');
  assert.equal(whenFull({ days: 'MWF', start: '1000', end: '1050' }), 'MWF 10–10:50');
  assert.equal(whenFull({ days: 'TR', start: '1430', end: '1545' }), 'TR 2:30–3:45');
  assert.equal(whenFull({ mode: 'online' }), 'Online');
});

test('week grid shows only the hours used, with a small margin', () => {
  assert.deepEqual(hourWindow([]), { lo: 480, hi: 1020 }, 'no classes: 8 to 5');
  // 9:00-9:50 and 2:30-3:45 -> 8:30 to 4:00
  assert.deepEqual(hourWindow([{ s: 540, e: 590 }, { s: 870, e: 945 }]), { lo: 510, hi: 960 });
  // one short class still gets 3 hours
  const w = hourWindow([{ s: 600, e: 650 }]);
  assert.ok(w.hi - w.lo >= 180 && w.lo <= 600 - 15 && w.hi >= 650 + 15, JSON.stringify(w));
});

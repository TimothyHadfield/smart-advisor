// The plan's first semester is always a future one: never the semester in session, and never one the
// imported audit already shows classes in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../js/planner.js';
import * as A from '../js/audit.js';

const d = (s) => new Date(s + 'T12:00:00');
const lbl = (t) => `${t.season} ${t.year}`;

test('during Fall the plan starts next Spring', () => {
  assert.equal(lbl(P.defaultStartTerm(d('2026-10-15'))), 'Spring 2027');
});
test('during Summer the plan starts that Fall (not next Spring)', () => {
  assert.equal(lbl(P.defaultStartTerm(d('2026-06-10'))), 'Fall 2026');
});
test('during Spring the plan starts Fall, or Summer when summers are on', () => {
  assert.equal(lbl(P.defaultStartTerm(d('2026-02-01'))), 'Fall 2026');
  assert.equal(lbl(P.defaultStartTerm(d('2026-02-01'), true)), 'Summer 2026');
});
test('an audit already registered for next term pushes the start past it', () => {
  const t = P.earliestStart({ date: d('2026-10-15'), lastTerm: { season: 'Spring', year: 2027 } });
  assert.equal(lbl(t), 'Fall 2027');
  const u = P.earliestStart({ date: d('2026-10-15'), lastTerm: { season: 'Fall', year: 2026 } });
  assert.equal(lbl(u), 'Spring 2027');
});
test('the audit reader finds the latest semester on course rows', () => {
  const text = [
    'Physics Sci Engr I PHYS 2210 Physics Sci Engr I A- 4 2026 SPRING',
    'Circuits ECE 2250 Circuit Theory I IP (3) 2026 FALL',
    'Degree Effective Term Spring 2030',
  ].join('\n');
  assert.deepEqual(A.parseAudit(text).lastTerm, { season: 'Fall', year: 2026 });
  assert.deepEqual(A.latestTerm(['ECE-2250 Circuit Theory I B+ 2025FA 3', 'ECE-2700 IP 2026SP 4']), { season: 'Spring', year: 2026 });
});

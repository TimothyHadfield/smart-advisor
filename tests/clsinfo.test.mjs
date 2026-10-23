// Class details panel helpers (js/clsinfo.js) on real catalog data
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { needTree, plainGate, gatePhrases, unlocksOf, statusText, offeredText } from '../js/clsinfo.js';
import { seasonTable } from '../js/rules.js';

const read = (f) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
const EE = read('data/programs/electrical-engineering-bs.json');
const show = (parts) => parts.map((p) => p.code || p.word || (p.open ? '(' : ')')).join(' ');

test('prerequisite chips: all needed / "or" / brackets for groups inside groups', () => {
  assert.equal(show(needTree(EE.courses['ECE 2250'].prereqs)), 'MATH 1210 PHYS 2220 ECE 1000');
  assert.equal(show(needTree(EE.courses['MATH 1210'].prereqs)), '( ( MATH 1050 or MATH 1055 ) and MATH 1060 ) or MATH 1080');
  assert.equal(show(needTree('ECE 4730')), 'ECE 4730');
  assert.deepEqual(needTree(null), []);
  assert.equal(show(needTree({ and: ['A 1', { or: ['A 1'] }, 'B 2'] })), 'A 1 B 2', 'a repeated code shows once');
});

test('catalog gate words -> short plain phrases', () => {
  assert.equal(plainGate('University Advanced Standing'), 'Advanced Standing');
  assert.equal(plainGate('(Formal Acceptance into the Electrical Engineering Program'), 'Program acceptance');
  assert.equal(plainGate('Departmental Approval)'), 'Department OK');
  assert.equal(plainGate('Instructor Approval'), 'Instructor OK');
  assert.equal(plainGate('appropriate placement by math placement test'), 'Placement score');
  assert.equal(plainGate('an ACT mathematics score of 23 (assuming the test has been taken within the last two years)'), 'Placement score');
  assert.equal(plainGate('Portfolio Review Acceptance'), 'Portfolio review');
  assert.equal(plainGate('Within the past two years'), '', 'left to the catalog text');
  assert.deepEqual(gatePhrases(EE.courses['ECE 3250']), ['Program acceptance', 'Advanced Standing', 'Department OK']);
  assert.deepEqual(gatePhrases(EE.courses['ECE 2250']), []);
});

test('unlocks: the program classes that need this one', () => {
  const u = unlocksOf('ECE 2250', EE.courses);
  assert.ok(u.includes('ECE 3250'), JSON.stringify(u));
  assert.ok(!u.includes('ECE 2250'));
  assert.deepEqual(unlocksOf('', EE.courses), []);
  // a take-with partner counts (ECE 2705 is ECE 2700's lab)
  assert.ok(unlocksOf('ECE 2705', EE.courses).includes('ECE 2700'));
});

test('status and offered lines', () => {
  assert.equal(statusText({ done: true, grade: 'A-' }), 'Taken · A-');
  assert.equal(statusText({ done: true, grade: 'IP' }), 'In progress');
  assert.equal(statusText({ done: true }), 'Taken');
  assert.equal(statusText({ done: false, planned: 'Spring 2027' }), 'Planned Spring 2027');
  assert.equal(statusText({ done: false }), 'Not yet');
  const t = seasonTable(read('data/seasons.json'));
  assert.equal(offeredText(t, ['ECE 3780']), 'Spring only');
  assert.match(offeredText(t, ['MATH 1210']), /^Fall \/ Spring/);
  assert.equal(offeredText(t, ['ZZZ 9999']), '');
  assert.equal(offeredText(null, ['MATH 1210']), '');
});

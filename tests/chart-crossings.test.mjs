// Run: node --test tests/chart-crossings.test.mjs
// Tim (2026-10-22): "I would really like it to be as maximally simple and clean as possible. Any turns and
// crossovers should be minimized as much as possible." Every program's flowchart, drawn the way the site
// draws it (scripts/chart-stats.mjs), may cross no more lines than tests/fixtures/chart-crossings.json
// allows. When the layout gets better, lower the numbers there (never raise one; raised once on 2026-10-23
// when merged lines were split into one line per arrow, see the fixture's note).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { programFiles, statsFor } from '../scripts/chart-stats.mjs';

const BASE = JSON.parse(readFileSync(new URL('./fixtures/chart-crossings.json', import.meta.url), 'utf8'));
// every program drawn once, shared by the tests below (a full sweep takes about 10-15 s)
let ALL = null;
const all = () => (ALL ??= programFiles().map((f) => ({ f, s: statsFor(f, { warm: false }) })));

test('no program crosses more lines than its stored number', () => {
  assert.ok(all().length >= 800, `programs ${all().length}`);
  const worse = [];
  let total = 0;
  for (const { f, s: { crossings } } of all()) {
    const max = BASE.crossings[f.key];
    if (max === undefined) continue; // a program added later: no number yet
    total += crossings;
    if (crossings > max) worse.push(`${f.key}: ${crossings} > ${max}`);
  }
  assert.deepEqual(worse, [], 'more crossings than stored');
  assert.ok(total <= BASE.totals.now, `total ${total}`);
});

test('EE BS: no more crossings than the stored number, and no more than Tim\'s hand-drawn chart (10)', () => {
  for (const key of ['current/electrical-engineering-bs', '2025-2026/electrical-engineering-bs']) {
    const { crossings } = all().find((x) => x.f.key === key).s;
    assert.ok(crossings <= BASE.crossings[key], `${key}: ${crossings}`);
    assert.ok(crossings <= 10, `${key}: ${crossings}`);
  }
});

// Tim (2026-10-23): "Class lines are combineing so only one line gose into a class." Every arrow enters its
// class at its own point and leaves its prereq at its own point: no merged lines, in any program.
test('no two arrows share an entry point or an exit point (all programs)', () => {
  const merged = [];
  for (const { f, s } of all()) if (s.sharedIn || s.sharedOut) merged.push(`${f.key}: ${s.sharedIn} in, ${s.sharedOut} out`);
  assert.deepEqual(merged, [], 'arrows merged at a box');
});

// Tim (2026-10-23): "long virtical lines close together". Upright pieces of different lines that share
// height stay at least 8 px apart; no line runs through a box; lines drawn on top of each other stay rare
// (no more than the stored total).
test('upright lines at least 8 px apart, no line through a box, few lines on top of each other (all programs)', () => {
  const close = [], hits = [];
  let stacked = 0;
  for (const { f, s } of all()) {
    if (s.closeV) close.push(`${f.key}: ${s.closeV}`);
    if (s.boxHits) hits.push(`${f.key}: ${s.boxHits}`);
    stacked += s.stacked;
  }
  assert.deepEqual(close, [], 'uprights closer than 8 px');
  assert.deepEqual(hits, [], 'lines through boxes');
  assert.ok(stacked <= BASE.totals.stacked, `lines on top of each other: ${stacked}`);
});

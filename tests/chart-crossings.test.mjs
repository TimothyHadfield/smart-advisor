// Run: node --test tests/chart-crossings.test.mjs
// Tim (2026-10-22): "I would really like it to be as maximally simple and clean as possible. Any turns and
// crossovers should be minimized as much as possible." Every program's flowchart, drawn the way the site
// draws it (scripts/chart-stats.mjs), may cross no more lines than tests/fixtures/chart-crossings.json
// allows. When the layout gets better, lower the numbers there (never raise one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { programFiles, statsFor } from '../scripts/chart-stats.mjs';

const BASE = JSON.parse(readFileSync(new URL('./fixtures/chart-crossings.json', import.meta.url), 'utf8'));

test('no program crosses more lines than its stored number', () => {
  const files = programFiles();
  assert.ok(files.length >= 800, `programs ${files.length}`);
  const worse = [];
  let total = 0;
  for (const f of files) {
    const max = BASE.crossings[f.key];
    if (max === undefined) continue; // a program added later: no number yet
    const { crossings } = statsFor(f, { warm: false });
    total += crossings;
    if (crossings > max) worse.push(`${f.key}: ${crossings} > ${max}`);
  }
  assert.deepEqual(worse, [], 'more crossings than stored');
  assert.ok(total <= BASE.totals.now, `total ${total}`);
});

test('EE BS: no more crossings than the stored number, and well under Tim\'s hand-drawn chart (10)', () => {
  for (const key of ['current/electrical-engineering-bs', '2025-2026/electrical-engineering-bs']) {
    const f = programFiles().find((x) => x.key === key);
    const { crossings } = statsFor(f, { warm: false });
    assert.ok(crossings <= BASE.crossings[key], `${key}: ${crossings}`);
    assert.ok(crossings <= 6, `${key}: ${crossings}`);
  }
});

// data/uvu-flowcharts.json: UVU departments' own flowchart / degree map PDFs, per program and catalog year,
// plus the pure helper that picks the one to show ("UVU's official flowchart (2026-27)").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { officialChart } from '../js/uistate.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const data = read('data/uvu-flowcharts.json');
const charts = data.programs;
const EE26 = 'https://www.uvu.edu/cet/ece/docs/electrical/ee_flowchart_2026-2027-4-29.pdf';
const EE25 = 'https://www.uvu.edu/cet/ece/docs/electrical/ee_flowchart_2025-2026.pdf';
const CE26 = 'https://www.uvu.edu/cet/ece/docs/computer/ce_flowchart_2026.pdf';
const CE25 = 'https://www.uvu.edu/cet/ece/docs/computer/ce_flowchart_2025-2026.pdf';

test('every entry is a UVU PDF for a real program id, with a kind and a source page', () => {
  const ids = new Set([...read('data/programs/_year.json').programs, ...read('data/2025-2026/programs/_year.json').programs].map((p) => p.id));
  assert.ok(Object.keys(charts).length >= 2);
  for (const [id, list] of Object.entries(charts)) {
    assert.ok(ids.has(id), `${id} is a program`);
    assert.ok(Array.isArray(list) && list.length, id);
    for (const c of list) {
      // a PDF, or (programs split into one chart per track) the department page that lists them
      assert.match(c.url, c.page ? /^https:\/\/www\.uvu\.edu\/[\w./-]+\/$/ : /^https:\/\/www\.uvu\.edu\/[\w./-]+\.pdf$/, `${id} url`);
      assert.match(c.source, /^https:\/\/www\.uvu\.edu\//, `${id} source`);
      assert.ok(c.kind === 'flowchart' || c.kind === 'degree map', `${id} kind`);
      assert.ok(c.year === null || /^\d{4}-\d{4}$/.test(c.year), `${id} year ${c.year}`);
    }
  }
  assert.ok(existsSync(new URL('../scripts/build-uvu-flowcharts.mjs', import.meta.url)), 'build script');
});

test('EE BS: 2026-27 flowchart on the current catalog, 2025-26 on the 2025-26 catalog', () => {
  assert.deepEqual(officialChart(charts, 'electrical-engineering-bs', '2026-2027'), { url: EE26, label: "UVU's official flowchart (2026-27)" });
  assert.deepEqual(officialChart(charts, 'electrical-engineering-bs', '2025-2026'), { url: EE25, label: "UVU's official flowchart (2025-26)" });
});

test('CE BS gets the CE flowchart', () => {
  assert.equal(officialChart(charts, 'computer-engineering-bs', '2026-2027').url, CE26);
  assert.equal(officialChart(charts, 'computer-engineering-bs', '2025-2026').url, CE25);
});

test('a year with no edition falls back to the newest one; no chart -> null', () => {
  assert.equal(officialChart(charts, 'electrical-engineering-bs', '2024-2025').url, EE26);
  assert.equal(officialChart(charts, 'electrical-engineering-bs', null).url, EE26);
  assert.equal(officialChart(charts, 'accounting-bs', '2026-2027'), null);
  assert.equal(officialChart(null, 'electrical-engineering-bs', '2026-2027'), null);
  assert.equal(officialChart(charts, null, '2026-2027'), null);
});

test('a program with one chart per track links the department page that lists them', () => {
  assert.deepEqual(officialChart(charts, 'animation-game-development-bs', '2026-2027'), { url: 'https://www.uvu.edu/digitalmedia/game-animation-dev/', label: "UVU's official flowcharts (2026-27)" });
});

test('a degree map without a year is labelled without one', () => {
  const fake = { x: [{ url: 'https://www.uvu.edu/a.pdf', kind: 'degree map', year: null, source: 'https://www.uvu.edu/' }] };
  assert.deepEqual(officialChart(fake, 'x', '2026-2027'), { url: 'https://www.uvu.edu/a.pdf', label: "UVU's official degree map" });
});

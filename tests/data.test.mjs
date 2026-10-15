// Run: node tests/data.test.mjs
// Checks the fetched catalog data (all programs, all catalog years) hangs together.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { programCodes } from '../scripts/fetch-program.mjs';
import { buildModel, makePlan } from '../js/planner.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const catalogs = read('data/catalogs.json');
const index = read('data/programs/index.json');
const report = read('data/programs/_report.json');
const byCollege = read('data/programs/_by-college.json');
const fileFor = (id, year) => `${catalogs.years[year].dir}programs/${id}.json`;
const TYPES = ['BS', 'BA', 'BAS', 'AS', 'AA', 'AAS', 'Minor', 'Certificate', 'Other'];

test('catalog list names the current year and the 2025-2026 archive', () => {
  assert.ok(catalogs.current && catalogs.years[catalogs.current], 'current year listed');
  assert.equal(catalogs.years[catalogs.current].dir, 'data/');
  assert.ok(catalogs.years['2025-2026'], '2025-2026 archive listed');
  assert.deepEqual(index.catalogYears, Object.keys(catalogs.years));
});

test('index follows the picker contract and covers every program of every year', () => {
  assert.ok(index.generated);
  const ids = index.programs.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'ids unique');
  for (const p of index.programs) {
    for (const k of ['id', 'name', 'type', 'college', 'department', 'url', 'credits', 'years']) assert.ok(k in p, `${p.id} lacks ${k}`);
    assert.ok(TYPES.includes(p.type), `${p.id} type ${p.type}`);
    assert.ok(p.url.startsWith('https://catalog.uvu.edu/'));
  }
  const reported = new Set(report.map((r) => `${r.id}@${r.year}`));
  for (const [year, info] of Object.entries(catalogs.years)) {
    const yr = read(info.manifest);
    assert.equal(yr.programs.length, info.count);
    assert.ok(yr.programs.length > 300, `${year}: only ${yr.programs.length} programs`);
    for (const p of yr.programs) {
      const entry = index.programs.find((x) => x.id === p.id);
      assert.ok(entry, `${year} ${p.id} missing from index`);
      const has = existsSync(join(ROOT, fileFor(p.id, year)));
      assert.equal(entry.years.includes(year), has, `${year} ${p.id}: years list vs file`);
      assert.ok(has || reported.has(`${p.id}@${year}`), `${year} ${p.id}: no program file and no _report entry`);
      if (p.status !== 'ok') assert.ok(reported.has(`${p.id}@${year}`), `${year} ${p.id} is ${p.status} but not reported`);
    }
  }
  for (const type of ['BS', 'BA', 'AS', 'AAS', 'Minor', 'Certificate']) assert.ok(index.programs.some((p) => p.type === type), `has a ${type}`);
  for (const r of report) assert.ok(r.id && r.url && r.problem && r.year);
  const grouped = Object.values(byCollege).flat().map((p) => p.id).sort();
  assert.deepEqual(grouped, ids.slice().sort(), '_by-college lists every program once');
});

for (const [year, info] of Object.entries(catalogs.years)) {
  const courses = read(info.courses);
  const withFile = index.programs.filter((p) => p.years.includes(year));

  test(`${year}: every course a program names exists in the shared course data`, () => {
    let checked = 0;
    for (const p of withFile) {
      const prog = read(fileFor(p.id, year));
      assert.equal(prog.id, p.id);
      assert.equal(prog.catalogYear, year);
      const missing = new Set(prog.missingCourses || []);
      for (const code of programCodes(prog.requirements, prog.gradPlan)) {
        assert.ok(code in courses, `${p.id}: ${code} not in ${info.courses}`);
        if (courses[code]) assert.deepEqual(prog.courses[code], courses[code], `${p.id}: ${code} differs from shared copy`);
        else assert.ok(missing.has(code) && report.some((r) => r.id === p.id && r.year === year), `${p.id}: ${code} has no catalog entry and is not reported`);
        checked++;
      }
      for (const it of prog.requirements) {
        assert.ok(['course', 'choice', 'placeholder'].includes(it.type), `${p.id}: unknown item type ${it.type}`);
        if (it.type === 'choice') for (const o of it.options) assert.ok(o.codes.length, `${p.id}: empty option`);
      }
    }
    assert.ok(checked > 5000, `only ${checked} course references checked`);
  });

  test(`${year}: the planner builds a model and a plan for every program`, () => {
    const bad = [];
    for (const p of withFile) {
      try {
        const model = buildModel(read(fileFor(p.id, year)));
        const plan = makePlan(model, new Set(), { start: { season: 'Fall', year: 2026 }, maxCredits: 18, summers: false });
        if (!plan || !Array.isArray(plan.semesters)) bad.push(`${p.id}: no plan`);
      } catch (e) { bad.push(`${p.id}: ${e.message}`); }
    }
    assert.deepEqual(bad, []);
  });
}

test('EE: current catalog is 122 credits without ECE 4950; app alias ee-bs.json matches it', () => {
  const cur = read('data/programs/electrical-engineering-bs.json');
  const alias = read('data/programs/ee-bs.json');
  assert.equal(alias.id, 'ee-bs');
  assert.deepEqual({ ...alias, id: cur.id, fetched: cur.fetched }, cur);
  assert.equal(cur.totalCredits, 122);
  assert.ok(!programCodes(cur.requirements, cur.gradPlan).has('ECE 4950'));
});

test("EE 2025-2026 (Tim's catalog year) is 125 credits and requires ECE 4950", () => {
  const ee = read('data/2025-2026/programs/electrical-engineering-bs.json');
  assert.equal(ee.catalogYear, '2025-2026');
  assert.equal(ee.totalCredits, 125);
  assert.ok(ee.requirements.some((it) => it.type === 'course' && it.code === 'ECE 4950'), 'ECE 4950 required');
  assert.ok(ee.courses['ECE 4950'], 'ECE 4950 course data present');
});

test("Tim's Environmental Science and Management minor is in the index with its elective list", () => {
  const m = index.programs.find((p) => p.id === 'environmental-science-management-minor');
  assert.ok(m && m.type === 'Minor' && m.years.includes(catalogs.current));
  const prog = read('data/programs/environmental-science-management-minor.json');
  assert.equal(prog.totalCredits, 22);
  const electives = prog.requirements.find((it) => it.type === 'choice' && it.pick.credits === 11);
  assert.ok(electives && electives.options.length > 30, '11-credit elective list parsed');
});

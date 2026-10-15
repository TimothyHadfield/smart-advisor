// Run: node tests/programs.test.mjs
// The major/minor picker's pure parts: searching the catalog's program list, reading the programs an
// audit header names, and joining a major + minor into one plan (shared courses counted once).
// Fixtures: tests/fixtures/programs/index.json is a copy of the all-programs scrape's index (413
// programs); the program files are copies of real scraped programs (EE B.S., Env. Sci. & Mgmt minor, Nursing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { filterPrograms, programGroup, auditPrograms, combinePrograms, catalogInfo, programYears, programPath } from '../js/programs.js';
import { buildModel, makePlan, programCredits, evalReq, flowNodes, flowEdges } from '../js/planner.js';
import { parseAudit } from '../js/audit.js';
import { foldLabs, flowChart } from '../js/layout.js';

const read = (p) => JSON.parse(readFileSync(fileURLToPath(new URL(`fixtures/${p}`, import.meta.url)), 'utf8'));
const index = read('programs/index.json');
const ee = read('programs/electrical-engineering-bs.json');
const esm = read('programs/environmental-science-management-minor.json');
const START = { season: 'Fall', year: 2026 };

// ---------- picker search ----------
test('the fixture index is real-sized', () => {
  assert.ok(index.programs.length >= 400);
  const g = { major: 0, minor: 0, cert: 0 };
  for (const p of index.programs) g[programGroup(p)]++;
  assert.ok(g.major > 150 && g.minor > 80 && g.cert > 50, JSON.stringify(g));
});

test('filter: "nurs" in majors finds the nursing degrees, name matches first', () => {
  const r = filterPrograms(index.programs, 'nurs', 'major');
  const ids = r.map((p) => p.id);
  assert.ok(ids.includes('nursing-bs') && ids.includes('nursing-asn'), ids.join());
  assert.ok(r.every((p) => programGroup(p) === 'major'));
  assert.match(r[0].name, /^Nursing/);
});

test('filter: every word must start a word ("env sci" -> Environmental Science...), groups apart', () => {
  const maj = filterPrograms(index.programs, 'env sci', 'major').map((p) => p.id);
  assert.equal(maj[0], 'environmental-science-management-bs');
  assert.ok(!maj.includes('environmental-studies-bs') || maj.indexOf('environmental-studies-bs') > maj.indexOf('environmental-science-management-bs'), 'a department match comes after a name match');
  const min = filterPrograms(index.programs, 'env', 'minor').map((p) => p.id);
  assert.ok(min.includes('environmental-science-management-minor') && min.includes('environmental-studies-minor'));
  assert.ok(!min.includes('environmental-science-management-bs'));
  assert.deepEqual(filterPrograms(index.programs, 'zzqx', null), []);
  assert.deepEqual(filterPrograms(index.programs, 'ngineering', 'major'), [], 'starts of words only');
});

test('filter: no query = the whole group A-Z; "&" types as "and"', () => {
  const all = filterPrograms(index.programs, '', 'minor');
  assert.equal(all.length, index.programs.filter((p) => programGroup(p) === 'minor').length);
  assert.ok(all.every((p, i) => i === 0 || all[i - 1].name.localeCompare(p.name) <= 0));
  assert.ok(filterPrograms(index.programs, 'science & management', 'minor').some((p) => p.id === 'environmental-science-management-minor'));
});

// ---------- catalog years ----------
test('catalog years: index or catalogs.json; current year loads from data/programs, older from data/<year>/', () => {
  const info = catalogInfo(index, read('catalogs.json'));
  assert.equal(info.current, '2026-2027');
  assert.deepEqual(info.years, ['2026-2027', '2025-2026']);
  assert.deepEqual(programYears({ id: 'x', years: ['2024-2025', '2026-2027'] }, info), ['2026-2027', '2024-2025']);
  assert.deepEqual(programYears({ id: 'x' }, info), ['2026-2027', '2025-2026']);
  assert.equal(programPath('nursing-bs', '2026-2027', info), 'data/programs/nursing-bs.json');
  assert.equal(programPath('nursing-bs', null, info), 'data/programs/nursing-bs.json');
  assert.equal(programPath('nursing-bs', '2025-2026', info), 'data/2025-2026/programs/nursing-bs.json');
  // contract shape: catalogYears in the index, no catalogs.json
  const i2 = catalogInfo({ catalogYears: ['2025-2026', '2026-2027'], programs: [] }, null);
  assert.equal(i2.current, '2026-2027');
});

// ---------- audit header ----------
// Anonymized copy of a Degree Works PDF's header: fields 4 spaces apart, wrapping mid-field.
const HEADER = `Utah Valley University Doe, Jane Q - 00000000
Student name Doe, Jane Q
Degree Bachelor of Science
Level Undergraduate    Classification Junior    Major Electrical Engineering    Minor Environmental Science & Management    Program Electrical
Engineering-BS    College College of Engineering & Tech.    Catalog Year 2025-2026 (BS-EE1)    Degree Effective Term 2025 Fall (BS-EE1)    Degree
Priority 1 (BS-EE1)    Academic Standing Good Standing    Transfer Credits 22    Overall GPA 3.50
Completion Rate 100%    Advisor Pat Example (Academic Major)    Advisor Email pat.example@example.edu (Academic Major)
Bachelor of Science INCOMPLETE
Credits required: 125 Credits applied:  81 Catalog year:  2025-2026 GPA: 3.50
Major Core Still needed: See Electrical Engineering Core-BS section
Minor Requirements Still needed: See MINOR: Environmental Science and Management section
MINOR: Environmental Science and Management INCOMPLETE
Fundamentals of Programming CS 1400 Fundamentals of Programming A 3 2026 SPRING`;

test('audit header: major, minor, program and catalog year (a field wrapped onto the next line)', () => {
  const p = parseAudit(HEADER);
  assert.equal(p.catalogYear, '2025-2026');
  assert.deepEqual(p.majors, ['Electrical Engineering']);
  assert.deepEqual(p.minors, ['Environmental Science & Management']);
  assert.deepEqual(p.programs, ['Electrical Engineering-BS']);
  assert.equal(p.taken.length, 1, 'courses still read');
});

test('audit header: no minor, a wrap exactly between two fields, tab-separated paste', () => {
  const a = parseAudit('Level Undergraduate    Major Nursing\nProgram Nursing-BS    Catalog Year 2026-2027\nBachelor of Science INCOMPLETE');
  assert.deepEqual(a.majors, ['Nursing']);
  assert.deepEqual(a.minors, []);
  assert.deepEqual(a.programs, ['Nursing-BS']);
  const b = parseAudit('Major\tAccounting\tMinor\tFinance\tProgram\tAccounting-BS\nCredits required: 120');
  assert.deepEqual([b.majors, b.minors, b.programs], [['Accounting'], ['Finance'], ['Accounting-BS']]);
  assert.deepEqual(parseAudit('ENGL 1010 A 3 Fall 2024').majors, []);
});

test('audit header -> programs in the catalog (degree from "Program ...-BS")', () => {
  const picks = auditPrograms(parseAudit(HEADER), index.programs);
  assert.deepEqual(picks.map((x) => [x.id, x.role]), [['electrical-engineering-bs', 'major'], ['environmental-science-management-minor', 'minor']]);
  const n = auditPrograms({ majors: ['Nursing'], minors: [], programs: ['Nursing-ASN'] }, index.programs);
  assert.deepEqual(n.map((x) => x.id), ['nursing-asn']);
  const n2 = auditPrograms({ majors: ['Nursing'], minors: [], programs: [] }, index.programs);
  assert.deepEqual(n2.map((x) => x.id), ['nursing-bs'], 'no degree known: the bachelor\'s');
  assert.deepEqual(auditPrograms({ majors: ['Underwater Basketry'], minors: [], programs: [] }, index.programs), []);
});

// ---------- major + minor ----------
function planProblems(model, plan) {
  const out = [];
  const inProgram = (c) => !!model.byCode[c];
  const done = new Set();
  const seen = new Set();
  for (const s of plan.semesters) {
    for (const it of s.items) {
      if (seen.has(it.id)) out.push(`${it.id} placed twice`);
      seen.add(it.id);
      if (it.kind === 'course' && !evalReq(model.byCode[it.code].prereqs, done, inProgram)) out.push(`${it.code} before its prereqs`);
    }
    for (const it of s.items) if (it.code) model.byCode[it.code].codes.forEach((c) => done.add(c));
  }
  return out;
}

test('EE + Env. Sci. minor: union planned, credits = both, minor boxes tagged, ids of the major unchanged', () => {
  const u = combinePrograms([{ id: 'electrical-engineering-bs', program: ee }, { id: 'environmental-science-management-minor', program: esm }]);
  const m = buildModel(u);
  const solo = buildModel(ee);
  assert.equal(programCredits(m), programCredits(solo) + programCredits(buildModel(esm)) - 0);
  assert.equal(u.totalCredits, programCredits(m));
  // the major's own box ids are unchanged (saved taps stay valid)
  for (const x of solo.units) assert.ok(m.units.some((y) => y.id === x.id && !y.prog), x.id);
  // the minor's boxes: tagged, ids prefixed
  const mine = m.units.filter((x) => x.prog === 'environmental-science-management-minor');
  assert.deepEqual(mine.map((x) => x.id), ['ENVT 1110', 'ENVT 2560', 'ENVT 2710', 'ENVT 3850', 'environmental-science-management-minor/choice:4']);
  // a 43-course elective list is one box, not 43
  assert.equal(flowNodes(m).length, flowNodes(solo).length + 5);
  const plan = makePlan(m, new Set(), { start: START });
  assert.deepEqual(planProblems(m, plan), []);
  assert.equal(plan.creditsLeft, programCredits(m));
  const codes = plan.semesters.flatMap((s) => s.items.map((x) => x.code)).filter(Boolean);
  assert.equal(new Set(codes).size, codes.length, 'no course twice');
  assert.ok(codes.includes('ENVT 3850') && codes.includes('ECE 4900'));
});

// A minor that shares with EE: CHEM 1210 required by both, MATH 1210 one of its picks, Gen Ed box by name
const SHARE = {
  id: 'test-minor', name: 'Test, Minor', totalCredits: 19,
  requirements: [
    { type: 'course', area: 'Core', code: 'CHEM 1210', alts: [], credits: 4 },
    { type: 'course', area: 'Core', code: 'ENVT 1110', alts: [], credits: 3 },
    { type: 'choice', area: 'Electives', label: 'Pick two', pick: { count: 2 }, credits: 7,
      options: [{ codes: ['MATH 1210'], credits: 4 }, { codes: ['GEO 1010'], credits: 3 }, { codes: ['GEOG 1000'], credits: 3 }] },
    { type: 'choice', area: 'Electives', label: '4 credits of', pick: { credits: 4 }, credits: 4,
      options: [{ codes: ['MATH 1220'], credits: 4 }, { codes: ['GEO 1080'], credits: 3 }] },
    { type: 'placeholder', area: 'General Education Requirements', label: 'Fine Arts Distribution', credits: 3 },
  ],
  courses: { 'ENVT 1110': { title: 'Intro Env', credits: 3, prereqs: 'CHEM 1210' }, 'GEO 1010': { title: 'Geology', credits: 3 } },
};

test('shared courses count once: dropped course, lowered pick, used-up pick and same-name Gen Ed box', () => {
  const u = combinePrograms([{ id: 'electrical-engineering-bs', program: ee }, { id: 'test-minor', program: SHARE }]);
  const m = buildModel(u);
  const mine = m.units.filter((x) => x.prog === 'test-minor');
  assert.deepEqual(mine.map((x) => x.id), ['ENVT 1110', 'test-minor/choice:2']);
  const pick = mine[1];
  assert.equal(pick.pick.count, 1);
  assert.equal(pick.credits, 4); // 7 for two -> 1 left of 2 -> round(3.5)
  assert.deepEqual(pick.options.map((o) => o.code), ['GEO 1010', 'GEOG 1000']);
  assert.equal(programCredits(m), 122 + 3 + 4);
  assert.equal(u.parts[1].shared, 4);
  assert.equal(m.byCode['CHEM 1210'].prog, undefined, 'CHEM 1210 stays the major\'s');
  const plan = makePlan(m, new Set(), { start: START });
  assert.deepEqual(planProblems(m, plan), []);
  assert.equal(plan.creditsLeft, 129);
  const codes = plan.semesters.flatMap((s) => s.items.map((x) => x.code)).filter(Boolean);
  assert.equal(codes.filter((c) => c === 'CHEM 1210').length, 1);
});

test('one program alone is unchanged', () => {
  const u = combinePrograms([{ id: 'electrical-engineering-bs', program: ee }]);
  assert.deepEqual(u.requirements, ee.requirements);
  assert.equal(programCredits(buildModel(u)), 122);
});

test('flowchart: the minor gets its own section (unless an arrow ties a box to the major), the major\'s chart is as before', () => {
  const u = combinePrograms([{ id: 'electrical-engineering-bs', program: ee }, { id: 'environmental-science-management-minor', program: esm }]);
  const m = buildModel(u);
  const { nodes, edges } = foldLabs(flowNodes(m), flowEdges(m));
  const sections = [{ key: 'minor', label: 'Minor', test: (n) => n.prog === 'environmental-science-management-minor' }];
  const ch = flowChart(nodes, edges, {}, sections);
  const head = ch.heads.find((h) => h.key === 'minor');
  assert.ok(head && head.label === 'Minor');
  for (const id of ['ENVT 2560', 'ENVT 2710', 'environmental-science-management-minor/choice:4']) assert.ok(ch.boxes.get(id).y > head.top, `${id} under the minor heading`);
  // ENVT 3850 needs ENGL 2010 (the major's): drawn in the main chart with its arrow
  assert.ok(ch.boxes.get('ENVT 3850').y < head.top);
  assert.ok(ch.edges.some((e) => e.from === 'ENGL 2010' && e.to === 'ENVT 3850'));
  const gen = ch.heads.find((h) => h.key === 'gen');
  assert.ok(gen && gen.top > head.top && ch.genTop === gen.top);
  // no box overlaps another
  const rs = [...ch.boxes.values()];
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i], b = rs[j];
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, 'overlap');
  }
});

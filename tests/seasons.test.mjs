// Run: node --test tests/seasons.test.mjs
// Seasons as a rule (docs/seasons-plan.md). Tim: "could you also fix the cite so it only allows classes that
// are offered those semesters to be taken in the stated semesters?"
// The plan never puts a class in a semester it doesn't run in (data/seasons.json, 3 years of UVU Banner
// schedules); a class with no history is allowed anywhere. Ground truth: UVU's EE flowchart "Offered" labels.
// Imports only planner.js / rules.js so the same file runs (and fails) on the code before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as P from '../js/planner.js';

const ROOT = fileURLToPath(new URL('../data/', import.meta.url));
const json = (p) => JSON.parse(readFileSync(ROOT + p, 'utf8'));
const SEASONS = json('seasons.json');
const EXTRA = (year = '') => ({ extraCourses: json(`${year}prereq-courses.json`), gened: json(`${year}gened.json`), seasons: SEASONS });
const seasonOf = (term) => term.split(' ')[0];

// independent of js/rules.js: the seasons a class ran in, or null when the history doesn't limit it
// (fewer than 2 sampled terms)
function ran(data, code) {
  const idx = data.courses[code];
  if (!idx || idx.length < 2) return null;
  return new Set(idx.map((i) => data.terms[i].season));
}
// every course row of a plan in a season it never ran in ("A or B": fine when either ran then)
function offSeason(plan, data = SEASONS) {
  const out = [];
  for (const s of plan.semesters) for (const it of s.items) {
    const codes = it.kind === 'course' ? [it.code] : it.kind === 'option' ? it.codes || [] : [];
    const known = codes.map((c) => ran(data, c)).filter(Boolean);
    if (known.length && !known.some((k) => k.has(seasonOf(s.term)))) out.push(`${codes.join('/')} in ${s.term}`);
  }
  return out;
}
const semOf = (plan, code) => plan.semesters.findIndex((s) => s.items.some((x) => x.code === code || (x.codes || []).includes(code)));
const termOf = (plan, code) => plan.semesters[semOf(plan, code)]?.term;

// UVU EE flowchart 2026-2027 (uvu.edu/cet/ece/docs/electrical/ee_flowchart_2026-2027.pdf), "Offered" per box
const FLOWCHART = {
  'ECE 1000': 'F Sp', 'ECE 2250': 'F Sp', 'ECE 2255': 'F Sp', 'ECE 2700': 'F Sp', 'ECE 2705': 'F Sp',
  'ECE 2750': 'F Sp', 'ECE 3250': 'Sp', 'ECE 3350': 'Sp', 'ECE 3450': 'Sp', 'ECE 3710': 'F Sp Su',
  'ECE 3730': 'F Sp', 'ECE 3740': 'F Sp', 'ECE 3760': 'F Sp', 'ECE 3765': 'F Sp', 'ECE 3770': 'F Sp',
  'ECE 3780': 'Sp', 'ECE 3785': 'Sp', 'ECE 4700': 'F Sp', 'ECE 4730': 'Sp', 'ECE 4750': 'F Sp',
  'ECE 4755': 'F Sp', 'ECE 4760': 'F', 'ECE 4765': 'F', 'ECE 4900': 'F Sp',
};
const NAME = { F: 'Fall', Sp: 'Spring', Su: 'Summer' };
const flow = (c) => new Set(FLOWCHART[c].split(' ').map((x) => NAME[x]));
const SPRING_ONLY = Object.keys(FLOWCHART).filter((c) => FLOWCHART[c] === 'Sp');

const EE = [['current', 'programs/electrical-engineering-bs.json', ''], ['2025-26', '2025-2026/programs/electrical-engineering-bs.json', '2025-2026/']];
const STARTS = [{ season: 'Fall', year: 2026 }, { season: 'Spring', year: 2027 }, { season: 'Summer', year: 2027 }];

test('data: seasons.json covers 3 years (3+ terms of each season, with section counts)', () => {
  for (const s of ['Fall', 'Spring', 'Summer']) assert.ok(SEASONS.terms.filter((t) => t.season === s).length >= 3, s);
  for (const t of SEASONS.terms) assert.ok(t.sections > 0, `${t.term} has a section count`);
  assert.ok(Object.keys(SEASONS.courses).length > 3000);
  assert.ok(SEASONS.built && SEASONS.rule);
});

test('flowchart: seasons.json agrees with UVU\'s EE flowchart on Fall/Spring for every ECE class', () => {
  let same = 0, full = 0;
  const diff = [];
  for (const c of Object.keys(FLOWCHART)) {
    const k = ran(SEASONS, c), f = flow(c);
    const fs = (set) => ['Fall', 'Spring'].filter((x) => set.has(x)).join('+');
    if (k && fs(k) === fs(f)) same++; else diff.push(`${c}: flowchart ${FLOWCHART[c]}, Banner ${k ? [...k].join('+') : 'unknown'}`);
    if (k && [...k].sort().join() === [...f].sort().join()) full++;
  }
  const n = Object.keys(FLOWCHART).length;
  console.log(`  EE flowchart vs seasons.json: Fall/Spring ${same}/${n} (${Math.round((100 * same) / n)}%), incl. Summer ${full}/${n}`);
  if (diff.length) console.log('  differ: ' + diff.join(' · '));
  assert.ok(same / n >= 0.9, diff.join('; '));
  for (const c of SPRING_ONLY) assert.deepEqual([...(ran(SEASONS, c) || [])].filter((x) => x !== 'Summer'), ['Spring'], c);
  assert.ok(!ran(SEASONS, 'ECE 4760').has('Spring'));
});

for (const [yr, file, dir] of EE) for (const start of STARTS) for (const summers of [false, true]) {
  test(`EE BS ${yr}, start ${P.termLabel(start)}, summers ${summers ? 'on' : 'off'}: ECE 3780 never in Fall, ECE 4760 never in Spring, Spring-only classes in Spring`, () => {
    const m = P.buildModel(json(file), EXTRA(dir));
    const plan = P.makePlan(m, new Set(), { start, maxCredits: 16, summers });
    assert.equal(seasonOf(termOf(plan, 'ECE 3780')), 'Spring');
    assert.equal(seasonOf(termOf(plan, 'ECE 4760')), 'Fall');
    for (const c of SPRING_ONLY) if (semOf(plan, c) >= 0) assert.equal(seasonOf(termOf(plan, c)), 'Spring', c);
    assert.deepEqual(offSeason(plan), []);
  });
}

test('EE BS: prereq order still holds after season moves (every in-program prereq in an earlier semester)', () => {
  for (const [, file, dir] of EE) for (const start of STARTS) {
    const m = P.buildModel(json(file), EXTRA(dir));
    const plan = P.makePlan(m, new Set(), { start, maxCredits: 16 });
    // same check as tests/planner-all.test.mjs: each class's catalog prereqs among the plan's classes
    const courses = m.program.courses || {};
    const planned = plan.semesters.flatMap((s) => s.items);
    const planCodes = new Set([...Object.keys(m.byCode), ...planned.flatMap((x) => x.codes || [])]);
    const inProgram = (c) => planCodes.has(c);
    const finishes = (it) => (it.kind === 'course' && m.byCode[it.code] ? m.byCode[it.code].codes : it.codes || []);
    const done = new Set();
    const bad = [];
    for (const s of plan.semesters) {
      for (const it of s.items) for (const code of it.codes || []) {
        const pre = courses[code]?.prereqs ?? null;
        if (typeof pre === 'string' ? pre !== code && !P.evalReq(pre, done, inProgram) : pre && !P.evalReq(pre, done, inProgram)) bad.push(`${code} in ${s.term}`);
      }
      for (const it of s.items) finishes(it).forEach((c) => done.add(c));
    }
    assert.deepEqual(bad, [], `${file} ${P.termLabel(start)}`);
    assert.deepEqual(plan.warnings.filter((w) => /without its prerequisites|could not be placed/.test(w)), []);
  }
});

test('EE BS with a student part-way through: the rest still lands only in the right seasons', () => {
  const m = P.buildModel(json('programs/electrical-engineering-bs.json'), EXTRA());
  const taken = new Set(['ENGL 1010', 'MATH 1210', 'MATH 1220', 'PHYS 2210', 'PHYS 2215', 'PHYS 2220', 'PHYS 2225', 'ECE 1000', 'ECE 2700', 'ECE 2705', 'ECE 2250', 'ECE 2255', 'CS 1400', 'ECE 2750', 'ECE 3710']);
  const plan = P.makePlan(m, taken, { start: { season: 'Fall', year: 2027 }, maxCredits: 16 });
  assert.deepEqual(offSeason(plan), []);
  assert.equal(seasonOf(termOf(plan, 'ECE 3780')), 'Spring');
});

// synthetic programs on a history shaped like the real file
const HIST = {
  terms: ['202440', '202520', '202530', '202540', '202620', '202630', '202640', '202720', '202430'].sort().map((t) => ({ term: t, name: t, season: { 20: 'Spring', 30: 'Summer', 40: 'Fall' }[t.slice(4)], sections: 3000 })),
  courses: {},
};
const idx = (season) => HIST.terms.map((t, i) => (t.season === season ? i : -1)).filter((i) => i >= 0);
HIST.courses['F 1000'] = idx('Fall');
HIST.courses['S 2000'] = idx('Spring');
HIST.courses['F 3000'] = idx('Fall');
HIST.courses['U 1000'] = idx('Summer');
HIST.courses['FS 1000'] = [...idx('Fall'), ...idx('Spring')].sort((a, b) => a - b);
HIST.courses['A 3000'] = idx('Fall'); // "A 3000 or B 3000": A runs in Fall, B in Spring
HIST.courses['B 3000'] = idx('Spring');
const prog = (reqs, courses) => ({ requirements: reqs.map((r) => ({ type: 'course', alts: [], credits: 3, ...(typeof r === 'string' ? { code: r } : r) })), courses, gradPlan: [] });

test('unknown class (no history) is allowed in any semester, summer included', () => {
  for (const season of ['Fall', 'Spring', 'Summer']) {
    const m = P.buildModel(prog(['Z 9999'], { 'Z 9999': { credits: 3 } }), { seasons: HIST });
    const plan = P.makePlan(m, new Set(), { start: { season, year: 2027 }, summers: true, seasons: HIST });
    assert.equal(plan.semesters[0].term, `${season} 2027`, season);
  }
});

test('a Fall -> Spring -> Fall chain waits for each class\'s season, in prereq order', () => {
  const m = P.buildModel(prog(['F 1000', 'S 2000', 'F 3000'], {
    'F 1000': { credits: 3 }, 'S 2000': { credits: 3, prereqs: 'F 1000' }, 'F 3000': { credits: 3, prereqs: 'S 2000' },
  }), { seasons: HIST });
  const plan = P.makePlan(m, new Set(), { start: { season: 'Spring', year: 2027 }, seasons: HIST });
  assert.deepEqual(['F 1000', 'S 2000', 'F 3000'].map((c) => termOf(plan, c)), ['Fall 2027', 'Spring 2028', 'Fall 2028']);
});

test('summer: a class that never runs in Summer is not planned in one', () => {
  const m = P.buildModel(prog(['FS 1000'], { 'FS 1000': { credits: 3 } }), { seasons: HIST });
  const plan = P.makePlan(m, new Set(), { start: { season: 'Summer', year: 2027 }, summers: true, seasons: HIST });
  assert.equal(termOf(plan, 'FS 1000'), 'Fall 2027');
});

test('summer: a Summer-only class gets its Summer even with Summers off (never a Fall or Spring)', () => {
  const m = P.buildModel(prog(['U 1000', 'FS 1000'], { 'U 1000': { credits: 3 }, 'FS 1000': { credits: 3 } }), { seasons: HIST });
  const plan = P.makePlan(m, new Set(), { start: { season: 'Fall', year: 2026 }, summers: false, seasons: HIST });
  assert.equal(termOf(plan, 'U 1000'), 'Summer 2027');
  assert.equal(termOf(plan, 'FS 1000'), 'Fall 2026');
});

test('"A or B": the plan names the one that runs that semester', () => {
  const m = P.buildModel(prog([{ code: 'A 3000', alts: ['B 3000'] }], { 'A 3000': { credits: 3 }, 'B 3000': { credits: 3 } }), { seasons: HIST });
  const plan = P.makePlan(m, new Set(), { start: { season: 'Spring', year: 2027 }, seasons: HIST });
  assert.equal(plan.semesters[0].term, 'Spring 2027');
  assert.equal(plan.semesters[0].items[0].code, 'B 3000');
});

test('every program, empty start Fall 2026 and Spring 2027: no class in a semester it never runs in', () => {
  const bad = [];
  for (const [dir, ex] of [['programs', EXTRA()], ['2025-2026/programs', EXTRA('2025-2026/')]]) {
    for (const f of readdirSync(ROOT + dir).filter((x) => x.endsWith('.json') && !x.startsWith('_') && x !== 'index.json')) {
      const m = P.buildModel(json(`${dir}/${f}`), ex);
      for (const start of STARTS.slice(0, 2)) {
        const off = offSeason(P.makePlan(m, new Set(), { start, maxCredits: 16 }));
        if (off.length) bad.push(`${dir}/${f} @${P.termLabel(start)}: ${off.join(', ')}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

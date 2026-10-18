// Run: node --test tests/planner-accuracy.test.mjs
// One test per finding of the 2026-10-17 accuracy audit (docs/audit-2026-10-17/, docs/accuracy-plan.md D-A1..A5).
// Real catalog files where the finding is about real data; small fixtures (real shapes) for the rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as P from '../js/planner.js';

const ROOT = fileURLToPath(new URL('../data/', import.meta.url));
const load = (id, dir = 'programs') => JSON.parse(readFileSync(`${ROOT}${dir}/${id}.json`, 'utf8'));
const START = { season: 'Spring', year: 2027 };
const planOf = (p, done = new Set(), opts = {}) => {
  const m = P.buildModel(p);
  return { m, plan: P.makePlan(m, done, { start: START, maxCredits: 16, ...opts }) };
};
// semester index of the first item carrying a code (an option lists its codes; a course its code)
const semOf = (plan, code) => plan.semesters.findIndex((s) => s.items.some((x) => x.code === code || (x.codes || []).includes(code)));
const nursCodes = (plan) => plan.semesters.flatMap((s) => s.items).flatMap((x) => x.codes || (x.code ? [x.code] : [])).filter((c) => /^NURS /.test(c));

// ---------- D-A1: admission programs plan in phases ----------
for (const id of ['nursing-bs', 'nursing-asn']) {
  test(`${id}: no NURS class before the Apply milestone; the apply prerequisites all come first`, () => {
    const { plan } = planOf(load(id));
    assert.equal(typeof P.planPhases, 'function', 'planPhases exported');
    const phases = P.planPhases(plan);
    const apply = phases.find((x) => x.kind === 'milestone' && x.gate === 'admission');
    assert.ok(apply, 'an Apply milestone');
    assert.ok(apply.at >= 2, `apply after at least 2 prerequisite semesters (at ${apply.at})`);
    // (an Advanced Standing milestone may split a phase in two pieces)
    const before = phases.filter((x) => x.kind === 'semesters' && x.phase === 'before');
    assert.deepEqual([Math.min(...before.map((x) => x.from)), Math.max(...before.map((x) => x.to))], [0, apply.at - 1]);
    const prog = phases.filter((x) => x.kind === 'semesters' && x.phase === 'program');
    assert.deepEqual([Math.min(...prog.map((x) => x.from)), Math.max(...prog.map((x) => x.to))], [apply.at, plan.semesters.length - 1]);
    for (const c of nursCodes(plan)) assert.ok(semOf(plan, c) >= apply.at, `${c} in semester ${semOf(plan, c)}, Apply at ${apply.at}`);
    for (const c of ['BIOL 1610', 'CHEM 1110', 'ZOOL 2320', 'ZOOL 2325', 'ZOOL 2420', 'ZOOL 2425', 'ENGL 1010', 'PSY 1100']) {
      const s = semOf(plan, c);
      assert.ok(s >= 0 && s < apply.at, `${c} (semester ${s}) before Apply (${apply.at})`);
    }
    // gated items say so
    const n2300 = plan.semesters.flatMap((s) => s.items).find((x) => x.code === 'NURS 2300' || (x.codes || []).includes('NURS 2300'));
    assert.equal(n2300.gate, 'admission');
  });

  test(`${id}: the nursing cohort runs in the catalog's semester blocks, one block per term, in order`, () => {
    const p = load(id);
    const { plan } = planOf(p);
    const block = {};
    p.gradPlan.forEach((t, s) => t.items.forEach((x) => { if (/^NURS /.test(x.code || '')) block[x.code] ??= s; }));
    const terms = {};
    for (const c of nursCodes(plan)) if (block[c] !== undefined) (terms[block[c]] ??= new Set()).add(semOf(plan, c));
    const ks = Object.keys(terms).map(Number).sort((a, b) => a - b);
    // the 4 ASN cohort blocks (catalog semesters 5-8) each sit in ONE term, consecutive terms
    const first4 = ks.slice(0, 4);
    for (const k of first4) assert.equal(terms[k].size, 1, `catalog block ${k} split over terms ${[...terms[k]]}`);
    const t = first4.map((k) => [...terms[k]][0]);
    for (let i = 1; i < t.length; i++) assert.equal(t[i], t[i - 1] + 1, `blocks ${first4} in terms ${t}`);
    // and no block starts before the previous one ends
    for (let i = 1; i < ks.length; i++) assert.ok(Math.min(...terms[ks[i]]) > Math.max(...terms[ks[i - 1]]) || ks[i] > 7, `block ${ks[i]} overlaps ${ks[i - 1]}`);
    // the clinical NURS 2415 sits with its lecture NURS 2410
    assert.equal(semOf(plan, 'NURS 2415'), semOf(plan, 'NURS 2410'));
  });
}

test('already admitted (a cohort class is taken): no Apply wait, the cohort continues at once', () => {
  const p = load('nursing-bs');
  const done = new Set(['ENGL 1010', 'BIOL 1610', 'CHEM 1110', 'PSY 1100', 'ZOOL 2320', 'ZOOL 2325', 'ZOOL 2420', 'ZOOL 2425', 'MICR 2060', 'MICR 2065',
    'NURS 2300', 'NURS 2305', 'NURS 2310', 'NURS 2320', 'NURS 2325']);
  const { plan } = planOf(p, done);
  assert.equal(semOf(plan, 'NURS 2410'), 0);
});

test('fixture: a gated course with no course prereqs waits for the program\'s earlier sample-plan courses', () => {
  const p = {
    id: 't', name: 'T', admission: true, totalCredits: 12,
    requirements: [{ type: 'course', code: 'BIO 1010', credits: 4 }, { type: 'course', code: 'BIO 2020', credits: 4 }, { type: 'course', code: 'HLTH 3000', credits: 4 }],
    gradPlan: [{ items: [{ code: 'BIO 1010' }] }, { items: [{ code: 'BIO 2020' }] }, { items: [{ code: 'HLTH 3000' }] }],
    courses: { 'BIO 1010': { credits: 4 }, 'BIO 2020': { credits: 4, prereqs: 'BIO 1010' }, 'HLTH 3000': { credits: 4, prereqText: 'Acceptance into the Health program', prereqs: null, prereqNonCourse: true } },
  };
  const { plan } = planOf(p);
  assert.deepEqual(plan.semesters.map((s) => s.items.map((x) => x.code).join('+')), ['BIO 1010', 'BIO 2020', 'HLTH 3000']);
  // the data's own gate field wins over the text
  p.courses['HLTH 3000'] = { credits: 4, gate: null };
  assert.equal(semOf(planOf(p).plan, 'HLTH 3000'), 0);
  p.courses['HLTH 3000'] = { credits: 4, gate: 'admission' };
  assert.equal(semOf(planOf(p).plan, 'HLTH 3000'), 2);
  // "acceptance ... or a course" is an alternative path, not a gate
  p.courses['HLTH 3000'] = { credits: 4, prereqText: 'Admittance into the Health certificate or BIO 1010', prereqs: null };
  assert.equal(semOf(planOf(p).plan, 'HLTH 3000'), 0);
});

test('electrical-engineering-bs: Formal Acceptance courses (ECE 3740, 3730, 3760, 3770) come after ECE 2250; ECE 3710 never before it', () => {
  for (const id of ['electrical-engineering-bs', 'ee-bs']) {
    const { plan } = planOf(load(id));
    const s2250 = semOf(plan, 'ECE 2250');
    assert.ok(s2250 >= 0);
    for (const c of ['ECE 3740', 'ECE 3730', 'ECE 3760', 'ECE 3770', 'ECE 3250']) assert.ok(semOf(plan, c) > s2250, `${id}: ${c} (${semOf(plan, c)}) after ECE 2250 (${s2250})`);
    // the catalog's own sample plan pairs ECE 3710 (MATH 1210 + Advanced Standing only) with ECE 2250
    assert.ok(semOf(plan, 'ECE 3710') >= s2250, `${id}: ECE 3710 (${semOf(plan, 'ECE 3710')}) not before ECE 2250 (${s2250})`);
    assert.ok(semOf(plan, 'ENGL 2010') < semOf(plan, 'ECE 3710'), 'Advanced Standing (ENGL 2010) before ECE 3710');
  }
});

test('University Advanced Standing: never in the first semester of an empty bachelor\'s plan', () => {
  for (const id of ['nursing-bs', 'electrical-engineering-bs', 'accounting-bs', 'biology-bs']) {
    const p = load(id);
    const { plan } = planOf(p);
    for (const it of plan.semesters[0].items) for (const c of it.codes || [it.code]) {
      assert.ok(!/advanced standing/i.test(p.courses[c]?.prereqText || ''), `${id}: ${c} in semester 1`);
    }
  }
});

// ---------- D-A2: catalog sample plan first, prereq chain second ----------
test('all current programs: courses the catalog puts 3+ semesters later are (almost) never planned first', () => {
  const dir = ROOT + 'programs/';
  const bad = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'index.json' || f.startsWith('_')) continue;
    const p = JSON.parse(readFileSync(dir + f, 'utf8'));
    const { plan } = planOf(p);
    const gp = {};
    (p.gradPlan || []).forEach((t, s) => t.items.forEach((x) => { for (const k of [x.code, ...(x.alts || [])]) if (k && gp[k] === undefined) gp[k] = s; }));
    const at = new Map();
    plan.semesters.forEach((s, i) => s.items.forEach((it) => { for (const c of it.codes || (it.code ? [it.code] : [])) if (!at.has(c) && gp[c] !== undefined) at.set(c, i); }));
    const pl = [...at];
    if (pl.some(([a, ia]) => pl.some(([b, ib]) => gp[a] - gp[b] >= 3 && ia < ib))) bad.push(f);
  }
  // before: 123 of 414 programs
  assert.ok(bad.length <= 10, `${bad.length} programs invert the catalog sequence by 3+ semesters: ${bad.join(', ')}`);
});

// ---------- D-A3: a course fills one requirement ----------
test('nursing-bs: STAT 1040 counts once (Quantitative Literacy OR the statistics course, not both)', () => {
  const p = load('nursing-bs');
  const m = P.buildModel(p);
  const base = P.makePlan(m, new Set(), { start: START }).creditsLeft;
  const pl = P.makePlan(m, new Set(['STAT 1040']), { start: START });
  assert.equal(pl.creditsLeft, base - 3);
  const ql = m.units.find((u) => u.label === 'Quantitative Literacy');
  const st = m.units.find((u) => u.label === 'University-level statistics course');
  assert.equal([P.unitDone(ql, new Set(['STAT 1040'])), P.unitDone(st, new Set(['STAT 1040']))].filter(Boolean).length, 1);
  // two stats classes fill both
  assert.ok(P.unitDone(ql, new Set(['STAT 1040', 'MGMT 2340'])) && P.unitDone(st, new Set(['STAT 1040', 'MGMT 2340'])));
});

test('a course required on its own is not an option of an elective group (art-design AAS: ART 1210)', () => {
  const p = load('art-design-aas-design-illustration-emphasis');
  const m = P.buildModel(p);
  const base = P.makePlan(m, new Set(), { start: START }).creditsLeft;
  const pl = P.makePlan(m, new Set(['ART 1210']), { start: START });
  const own = m.units.find((u) => u.kind === 'course' && u.codes.includes('ART 1210')).credits;
  assert.equal(pl.creditsLeft, base - own);
  for (const g of m.units.filter((u) => u.kind === 'choice')) assert.ok(!g.options.some((o) => o.codes.length === 1 && o.codes[0] === 'ART 1210'), g.label);
});

// ---------- D-A4: coreqs two-way, same term ----------
test('fixture: a lab that names no coreq still goes in the same term as the lecture that names it', () => {
  const p = { id: 't', name: 'T', totalCredits: 0, gradPlan: [], requirements: [
    { type: 'course', code: 'CHEM 1210', credits: 4 }, { type: 'course', code: 'CHEM 1215', credits: 1 }, { type: 'course', code: 'CHEM 2310', credits: 4 }],
  courses: { 'CHEM 1210': { credits: 4, prereqs: 'CHEM 2310', coreqs: ['CHEM 1215'], coreqText: 'CHEM 1215' }, 'CHEM 1215': { credits: 1 }, 'CHEM 2310': { credits: 4 } } };
  const { plan } = planOf(p);
  assert.deepEqual(plan.warnings, []);
  assert.equal(semOf(plan, 'CHEM 1215'), semOf(plan, 'CHEM 1210'));
  assert.equal(semOf(plan, 'CHEM 1210'), 1);
});

// ---------- credits from the chosen course ----------
test('"A or B" with different credits: the plan names the sample plan\'s choice and counts its own credits (nursing ZOOL 2600, 3 cr)', () => {
  const { plan } = planOf(load('nursing-bs'));
  const it = plan.semesters.flatMap((s) => s.items).find((x) => x.unitId === 'ZOOL 4400');
  assert.equal(it.code, 'ZOOL 2600');
  assert.equal(it.credits, 3);
  // fixture: a listed course with 4 credits on a 3-credit row counts 4 when that course is the one planned
  const p = { id: 't', name: 'T', totalCredits: 0, gradPlan: [], requirements: [{ type: 'course', code: 'ZOOL 4400', alts: ['ZOOL 2600'], credits: 3 }],
    courses: { 'ZOOL 4400': { credits: 4 }, 'ZOOL 2600': { credits: 3, prereqs: 'XX 1000' } } };
  const q = planOf(p).plan;
  assert.equal(q.semesters[0].items[0].code, 'ZOOL 4400');
  assert.equal(q.semesters[0].items[0].credits, 4);
});

// ---------- D-A5: tracks ----------
test('computer-science-bs: the guessed track is flagged; a chosen track plans that track\'s courses only', () => {
  const p = load('computer-science-bs');
  const m = P.buildModel(p);
  const g = m.units.find((u) => u.tracks);
  const a = P.makePlan(m, new Set(), { start: START });
  const t = (a.tracks || []).find((x) => x.groupId === g.id);
  assert.ok(t, 'plan.tracks lists the group');
  assert.equal(t.guessed, true);
  assert.deepEqual(t.tracks, g.tracks);
  const ai = 'Artificial Intelligence Track';
  const b = P.makePlan(m, new Set(), { start: START, tracks: { [g.id]: ai } });
  const tb = b.tracks.find((x) => x.groupId === g.id);
  assert.deepEqual([tb.track, tb.guessed], [ai, false]);
  const aiCodes = new Set(g.options.filter((o) => o.section === ai).flatMap((o) => o.codes));
  const other = new Set(g.options.filter((o) => o.section !== ai).flatMap((o) => o.codes).filter((c) => !aiCodes.has(c)));
  const planned = b.semesters.flatMap((s) => s.items).filter((x) => x.unitId === g.id || String(x.unitId).startsWith(g.id + '/')).flatMap((x) => x.codes || []);
  assert.ok(planned.length > 0);
  for (const c of planned) assert.ok(aiCodes.has(c) && !other.has(c), c);
  // an unknown track name never blocks the plan: falls back to the guess
  const c = P.makePlan(m, new Set(), { start: START, tracks: { [g.id]: 'No Such Track' } });
  assert.equal(c.tracks.find((x) => x.groupId === g.id).guessed, true);
});

// ---------- requirementFor + minGrade passthrough ----------
test('requirementFor: which requirement a class fills and why', () => {
  const m = P.buildModel(load('nursing-bs'));
  const r = P.requirementFor(m, 'NURS 2300');
  assert.equal(r.unitId, 'NURS 2300');
  assert.equal(r.kind, 'course');
  assert.equal(r.gate, 'admission');
  assert.match(r.why, /required/i);
  const q = P.requirementFor(m, 'STAT 1040');
  assert.equal(q.label, 'Quantitative Literacy');
  assert.match(q.why, /one of/i);
  assert.deepEqual(q.alsoIn, ['University-level statistics course']);
  assert.equal(P.requirementFor(m, 'XYZ 9999'), null);
  const z = P.requirementFor(m, 'ZOOL 2600');
  assert.equal(z.unitId, 'ZOOL 4400');
});

test('minGrade from the data is passed through to units and plan items', () => {
  const p = { id: 't', name: 'T', totalCredits: 0, gradPlan: [], requirements: [{ type: 'course', code: 'ACC 2110', credits: 3, minGrade: 'B-' }, { type: 'course', code: 'ACC 3010', credits: 3 }],
    courses: { 'ACC 2110': { credits: 3 }, 'ACC 3010': { credits: 3, minGrade: 'C', prereqs: 'ACC 2110' } } };
  const { m, plan } = planOf(p);
  assert.equal(m.byCode['ACC 2110'].minGrade, 'B-');
  assert.equal(m.byCode['ACC 3010'].minGrade, 'C');
  const items = plan.semesters.flatMap((s) => s.items);
  assert.equal(items.find((x) => x.code === 'ACC 2110').minGrade, 'B-');
  assert.equal(P.requirementFor(m, 'ACC 2110').minGrade, 'B-');
});

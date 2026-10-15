// Run: node tests/planner.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildModel, makePlan, programCredits, codesOf, evalReq, flowNodes, flowEdges, nextTerm, defaultStartTerm } from '../js/planner.js';
import { parseReqExpr, parseCourseXml } from '../scripts/fetch-program.mjs';

const ee = JSON.parse(readFileSync(fileURLToPath(new URL('../data/programs/ee-bs.json', import.meta.url)), 'utf8'));
const START = { season: 'Fall', year: 2026 };

// Checks every rule a plan must obey; returns the list of problems.
function problems(model, plan, completed, maxCredits) {
  const out = [];
  const inProgram = (c) => !!model.byCode[c];
  const done = new Set(completed);
  for (const u of model.units) if (u.kind === 'course' && u.codes.some((c) => completed.has(c))) u.codes.forEach((c) => done.add(c));
  const seen = new Set();
  plan.semesters.forEach((s, i) => {
    const sum = s.items.reduce((a, x) => a + x.credits, 0);
    if (sum !== s.credits) out.push(`${s.term}: credits ${s.credits} != sum ${sum}`);
    if (s.credits > maxCredits) out.push(`${s.term}: ${s.credits} credits > cap ${maxCredits}`);
    const now = new Set(done);
    for (const it of s.items) if (it.kind === 'course') model.byCode[it.code].codes.forEach((c) => now.add(c));
    for (const it of s.items) {
      if (seen.has(it.id)) out.push(`${it.id} placed twice`);
      seen.add(it.id);
      if (it.kind !== 'course') continue;
      const u = model.byCode[it.code];
      if (completed.has(it.code)) out.push(`${it.code} already completed but planned`);
      if (!evalReq(u.prereqs, done, inProgram)) out.push(`${it.code} in ${s.term} before its prereqs ${JSON.stringify(u.prereqs)}`);
      for (const c of u.coreqs) if (inProgram(c) && !now.has(c)) out.push(`${it.code} coreq ${c} not same/earlier term`);
    }
    for (const it of s.items) if (it.kind === 'course') model.byCode[it.code].codes.forEach((c) => done.add(c));
    void i;
  });
  return out;
}

test('real EE data looks like the catalog', () => {
  assert.equal(ee.totalCredits, 122);
  assert.ok(Object.keys(ee.courses).length >= 45, 'at least 45 courses fetched');
  assert.deepEqual(ee.courses['ECE 2250'].prereqs, { and: ['MATH 1210', 'PHYS 2220', 'ECE 1000'] });
  assert.deepEqual(ee.courses['ECE 2700'].coreqs, ['ECE 2705']);
  assert.equal(ee.courses['ECE 4900'].prereqs, 'ECE 4730');
  assert.equal(ee.gradPlan.length, 8);
});

test('EE plan from scratch: prereqs first, cap kept, all 122 credits, 8 semesters', () => {
  const m = buildModel(ee);
  assert.equal(programCredits(m), 122);
  const plan = makePlan(m, new Set(), { start: START });
  assert.deepEqual(problems(m, plan, new Set(), 16), []);
  assert.equal(plan.creditsLeft, 122);
  assert.equal(plan.semesters.length, 8, 'graduates in 8 semesters like UVU\'s sample plan');
  assert.equal(plan.graduation, 'Spring 2030');
  assert.deepEqual(plan.warnings, []);
  // every required course appears exactly once
  const planned = plan.semesters.flatMap((s) => s.items.map((x) => x.code)).filter(Boolean);
  for (const u of m.units.filter((u) => u.kind === 'course')) assert.equal(planned.filter((c) => c === u.code).length, 1, u.code);
});

test('completed classes drop out and credits go down', () => {
  const m = buildModel(ee);
  const completed = new Set(['MATH 1210', 'ENGL 1010', 'ECE 1000', 'PHYS 2210', 'PHYS 2215', 'CHEM 1210', 'CHEM 1215']);
  const plan = makePlan(m, completed, { start: START });
  assert.deepEqual(problems(m, plan, completed, 16), []);
  const planned = new Set(plan.semesters.flatMap((s) => s.items.map((x) => x.code)));
  for (const c of completed) assert.ok(!planned.has(c), `${c} should not be planned`);
  assert.equal(plan.creditsLeft, 122 - (4 + 3 + 3 + 4 + 1 + 4 + 1));
  // PHYS 2220 only needs PHYS 2210, which is done => first semester
  assert.ok(plan.semesters[0].items.some((x) => x.code === 'PHYS 2220'));
});

test('an "or" alternative counts (ENGL 1005 for ENGL 1010)', () => {
  const m = buildModel(ee);
  const plan = makePlan(m, new Set(['ENGL 1005']), { start: START });
  const planned = plan.semesters.flatMap((s) => s.items.map((x) => x.code));
  assert.ok(!planned.includes('ENGL 1010'));
  assert.equal(plan.creditsLeft, 122 - 3);
  assert.deepEqual(problems(m, plan, new Set(['ENGL 1005']), 16), []);
  // with only English left to unlock, ENGL 2010 can go in term 1
  const tight = makePlan(m, new Set(['ENGL 1005']), { start: START, maxCredits: 30 });
  assert.ok(tight.semesters[0].items.some((x) => x.code === 'ENGL 2010'), 'ENGL 2010 unlocked in term 1');
});

test('choice groups: taking an elective option shrinks the elective credits', () => {
  const m = buildModel(ee);
  const before = makePlan(m, new Set(), { start: START });
  const after = makePlan(m, new Set(['ECE 4780']), { start: START });
  const elec = (p) => p.semesters.flatMap((s) => s.items).filter((x) => x.label === 'EE Elective').reduce((a, x) => a + x.credits, 0);
  assert.equal(elec(before), 6);
  assert.equal(elec(after), 3);
  const g = m.units.find((u) => u.kind === 'choice' && u.label === 'EE Elective');
  assert.ok(g.showOptions, 'EE electives drawn as their own boxes');
  const ai = m.units.find((u) => u.kind === 'choice' && u.label === 'American Institutions');
  assert.ok(!ai.showOptions, 'American Institutions drawn as one box');
  // tapping the group itself or a placeholder marks it done
  const p2 = makePlan(m, new Set([ai.id]), { start: START });
  assert.ok(!p2.semesters.flatMap((s) => s.items).some((x) => x.label === 'American Institutions'));
});

test('credit cap of 12 is respected and still valid', () => {
  const m = buildModel(ee);
  const plan = makePlan(m, new Set(), { start: START, maxCredits: 12 });
  assert.deepEqual(problems(m, plan, new Set(), 12), []);
  assert.equal(plan.creditsLeft, 122);
  assert.ok(plan.semesters.length >= 11);
});

test('summers are skipped unless switched on', () => {
  assert.deepEqual(nextTerm({ season: 'Spring', year: 2027 }), { season: 'Fall', year: 2027 });
  assert.deepEqual(nextTerm({ season: 'Spring', year: 2027 }, true), { season: 'Summer', year: 2027 });
  assert.deepEqual(nextTerm({ season: 'Fall', year: 2027 }), { season: 'Spring', year: 2028 });
  assert.deepEqual(defaultStartTerm(new Date(2026, 9, 15)), { season: 'Spring', year: 2027 });
  const m = buildModel(ee);
  const plan = makePlan(m, new Set(), { start: { season: 'Spring', year: 2027 } });
  assert.ok(plan.semesters.every((s) => !s.term.startsWith('Summer')));
});

test('synthetic chain: A -> B -> C needs three terms even with room', () => {
  const prog = {
    requirements: [
      { type: 'course', code: 'X 3000', alts: [], credits: 3 },
      { type: 'course', code: 'X 2000', alts: [], credits: 3 },
      { type: 'course', code: 'X 1000', alts: [], credits: 3 },
      { type: 'course', code: 'X 1005', alts: [], credits: 1 },
    ],
    courses: {
      'X 1000': { prereqs: null, coreqs: ['X 1005'] },
      'X 1005': { prereqs: null, coreqs: ['X 1000'] },
      'X 2000': { prereqs: { or: ['X 1000', 'Y 9999'] } },
      'X 3000': { prereqs: { and: ['X 2000', 'Z 1111'] } },
    },
    gradPlan: [],
  };
  const m = buildModel(prog);
  const plan = makePlan(m, new Set(), { start: START, maxCredits: 18 });
  assert.deepEqual(plan.semesters.map((s) => s.items.map((x) => x.code).sort()), [['X 1000', 'X 1005'], ['X 2000'], ['X 3000']]);
  assert.deepEqual(problems(m, plan, new Set(), 18), []);
});

test('flowchart: every prereq edge goes left to right', () => {
  const m = buildModel(ee);
  const depth = new Map(flowNodes(m).map((n) => [n.id, n.depth]));
  const edges = flowEdges(m);
  assert.ok(edges.length > 30);
  for (const e of edges) assert.ok(depth.get(e.from) < depth.get(e.to), `${e.from} -> ${e.to}`);
  assert.ok(edges.some((e) => e.from === 'ECE 4730' && e.to === 'ECE 4900'));
});

test('prereq text parsing (real catalog strings)', () => {
  assert.deepEqual(parseReqExpr('MATH 1210, PHYS 2220, ECE 1000').expr, { and: ['MATH 1210', 'PHYS 2220', 'ECE 1000'] });
  assert.deepEqual(parseReqExpr('MATH 1210 or MATH 1210H with a grade of C or higher').expr, { or: ['MATH 1210', 'MATH 1210H'] });
  assert.deepEqual(parseReqExpr('CS 1400, (ECE 3710 or STAT 2050), and University Advanced Standing').expr, { and: ['CS 1400', { or: ['ECE 3710', 'STAT 2050'] }] });
  assert.equal(parseReqExpr('ECE 2250, (Formal Acceptance into the Electrical Engineering Program, or Departmental Approval), and University Advanced Standing').expr, 'ECE 2250');
  assert.deepEqual(parseReqExpr('One of the following within the past two years: (MATH 1050 or MATH 1055) and MATH 1060, each with a grade of C or higher; OR MATH 1080 with a grade of C or higher; OR appropriate placement by math placement test.').expr,
    { or: [{ and: [{ or: ['MATH 1050', 'MATH 1055'] }, 'MATH 1060'] }, 'MATH 1080'] });
  assert.equal(parseReqExpr('Math at least equivalent to high school algebra and trigonometry. CS 1030 recommended.').expr, null);
  const xml = '<courseinfo><course code="ECE 2700"><![CDATA[<div class="courseblock"><span class="text detail-title"><strong>Digital Design I.</strong></span><span class="text detail-hours_html"><strong>(3 Credits)</strong></span><div class="courseblockextra noindent">Prerequisite(s): <a class="bubblelink code">MATH&#160;1210</a> and <a>ECE&#160;1000</a><br/>Corequisite(s): <a>ECE&#160;2705</a><br/>Desc.</div></div>]]></course></courseinfo>';
  const c = parseCourseXml(xml);
  assert.equal(c.title, 'Digital Design I');
  assert.equal(c.credits, 3);
  assert.deepEqual(c.prereqs, { and: ['MATH 1210', 'ECE 1000'] });
  assert.deepEqual(c.coreqs, ['ECE 2705']);
  assert.deepEqual(codesOf(c.prereqs), ['MATH 1210', 'ECE 1000']);
});

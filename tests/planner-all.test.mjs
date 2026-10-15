// Run: node --test tests/planner-all.test.mjs
// Plans EVERY program in both catalog years (empty start, 16-credit cap) and checks each plan:
//   - no semester over the cap (unless it holds one single item bigger than the cap)
//   - no prerequisite placed before its prereqs (pre-or-co and coreqs may share the semester)
//   - every required unit placed (each course once; choices / Gen Ed / electives get their credits)
//   - semesters <= ceil(credits / 12) + 2 (programs whose data is at fault go in ALLOW, with the reason)
// PLAN_REPORT=1 prints the semester-count distribution and the worst plans.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildModel, makePlan, evalReq } from '../js/planner.js';

const ROOT = fileURLToPath(new URL('../data/', import.meta.url));
const DIRS = ['programs', '2025-2026/programs'];
const START = { season: 'Fall', year: 2026 };
const CAP = 16;

// Programs allowed over the semester bound because the catalog data itself forces it: id -> reason.
const ALLOW = {
  'military-science-minor': 'MILS 1200 -> 1210 -> 2200 -> 2210 -> 3200 -> 3210: a six-course chain, one per semester',
  'collaborative-piano-chamber-music-certificate-proficiency': 'MUSC 3730R (accompanying ensemble) is required 6 times, one enrollment per semester',
};

function programFiles() {
  const out = [];
  for (const d of DIRS) for (const f of readdirSync(ROOT + d)) {
    if (!f.endsWith('.json') || f.startsWith('_') || f === 'index.json') continue;
    out.push({ key: `${d.replace('/programs', '').replace('programs', 'current')}/${f.replace('.json', '')}`, id: f.replace('.json', ''), path: ROOT + d + '/' + f });
  }
  return out;
}

// strip a course's own code from its prereq expression (catalog quirk: MUSC 1110 lists MUSC 1110)
function stripCodes(e, codes) {
  if (!e) return null;
  if (typeof e === 'string') return codes.includes(e) ? null : e;
  const k = e.and ? 'and' : 'or';
  const v = e[k].map((x) => stripCodes(x, codes)).filter(Boolean);
  return v.length === 0 ? null : v.length === 1 ? v[0] : { [k]: v };
}

export function checkPlan(model, plan, cap = CAP) {
  const out = [];
  const courses = model.program.courses || {};
  const planned = plan.semesters.flatMap((s) => s.items);
  const planCodes = new Set([...Object.keys(model.byCode), ...planned.flatMap((x) => x.codes || [])]);
  const inProgram = (c) => planCodes.has(c);
  // codes an item finishes: a course unit counts all its alternatives
  const finishes = (it) => {
    const u = model.byCode[it.code];
    if (it.kind === 'course' && u) return u.codes;
    return it.codes || [];
  };
  const done = new Set();
  plan.semesters.forEach((s) => {
    const sum = s.items.reduce((a, x) => a + x.credits, 0);
    if (Math.abs(sum - s.credits) > 1e-9) out.push(`${s.term}: credits ${s.credits} != sum ${sum}`);
    if (s.credits > cap && s.items.length > 1) out.push(`${s.term}: ${s.credits} credits > cap ${cap}`);
    const now = new Set(done);
    for (const it of s.items) finishes(it).forEach((c) => now.add(c));
    for (const it of s.items) {
      const own = it.codes || [];
      for (const code of own) {
        const c = courses[code] || {};
        const pre = stripCodes(c.prereqs ?? null, own);
        if (!evalReq(pre, done, inProgram)) out.push(`${code} in ${s.term} before its prereqs ${JSON.stringify(pre)}`);
        const pc = stripCodes(c.precoreqs ?? null, own);
        if (!evalReq(pc, now, inProgram)) out.push(`${code} in ${s.term} before its prereq-or-coreqs ${JSON.stringify(pc)}`);
        const cq = (c.coreqs || []).filter((k) => !own.includes(k) && inProgram(k));
        // "A or B" coreqs (catalog text with "or", no "and"/brackets): one of them is enough
        const anyOne = cq.length > 1 && /\bor\b/i.test(c.coreqText || '') && !/\band\b|[()]/i.test(c.coreqText || '');
        if (anyOne ? !cq.some((k) => now.has(k)) : cq.some((k) => !now.has(k))) out.push(`${code} coreqs ${cq.join(anyOne ? ' or ' : ', ')} not same/earlier term`);
      }
    }
    for (const it of s.items) finishes(it).forEach((c) => done.add(c));
  });
  // every unit placed with its credits
  const ids = new Map();
  for (const it of planned) ids.set(it.unitId, (ids.get(it.unitId) || 0) + it.credits);
  for (const u of model.units) {
    if (u.kind === 'course') {
      if (!ids.has(u.id)) out.push(`${u.id} never placed`);
      continue;
    }
    const need = u.kind === 'choice' ? (u.pick?.credits ?? u.credits) : u.credits;
    let got = ids.get(u.id) || 0;
    for (const [k, v] of ids) if (k.startsWith(u.id + '/')) got += v;
    if (got + 1e-9 < need) out.push(`${u.id} (${u.label}) placed ${got} of ${need} credits`);
  }
  return out;
}

const results = [];
for (const f of programFiles()) {
  test(`plan: ${f.key}`, () => {
    const program = JSON.parse(readFileSync(f.path, 'utf8'));
    const model = buildModel(program);
    const plan = makePlan(model, new Set(), { start: START, maxCredits: CAP });
    const total = plan.creditsLeft;
    const bound = Math.ceil(total / 12) + 2;
    const n = plan.semesters.length;
    const maxSem = Math.max(0, ...plan.semesters.map((s) => s.credits));
    const probs = checkPlan(model, plan);
    results.push({ key: f.key, n, total, bound, maxSem, probs: probs.length, warnings: plan.warnings.length });
    assert.deepEqual(probs, [], f.key);
    if (n > bound && !ALLOW[f.id]) assert.fail(`${f.key}: ${n} semesters for ${total} credits (bound ${bound})`);
  });
}

test('report', { skip: !process.env.PLAN_REPORT }, () => {
  const dist = {};
  for (const r of results) dist[r.n] = (dist[r.n] || 0) + 1;
  console.log('programs', results.length, 'semester-count distribution', JSON.stringify(dist));
  console.log('over bound', results.filter((r) => r.n > r.bound).length, 'with problems', results.filter((r) => r.probs).length, 'over cap', results.filter((r) => r.maxSem > CAP).length);
  const worst = results.slice().sort((a, b) => (b.n - b.bound) - (a.n - a.bound) || b.n - a.n).slice(0, 10);
  for (const r of worst) console.log(`  ${r.key}: ${r.n} sem, ${r.total} cr (bound ${r.bound}), max ${r.maxSem}/sem, ${r.probs} problems, ${r.warnings} warnings`);
});

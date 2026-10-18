// Smart Advisor planner: pure functions, used by the browser (js/app.js) and Node tests.
// Program JSON comes from scripts/fetch-program.mjs.
import { gatesOf, mainGate, STANDING_RULE } from './phases.js';
export { planPhases } from './phases.js';

// ---------- model ----------
// Units are the things a student has to finish:
//   course      one required course (alts: any one of the codes counts)
//   choice      "complete one of" / "N credits from" a list (options may be shown as their own boxes)
//   option      a course inside a choice group (only built when the group has real prereqs)
//   placeholder a Gen Ed distribution or free elective with no fixed course
const MAX_OPTION_BOXES = 8;
// The plan may run at most this many semesters ahead of the catalog's sample plan (fills a light term
// without pulling a senior class into the first year).
const EARLY_SLACK = 2;
export function buildModel(program) {
  const units = [];
  const byCode = {};
  const courses = program.courses || {};
  const planIndex = gradPlanIndex(program.gradPlan || []);
  const planNamed = new Set((program.gradPlan || []).flatMap((t) => t.items.map((x) => x.code).filter(Boolean)));
  const back = backCoreqs(courses);
  const minPlanSem = (codes) => Math.min(99, ...codes.map((k) => planIndex[k] ?? 99));
  // codes required on their own (a course requirement), which elective lists can't count again
  const reqCodes = new Set(program.requirements.filter((r) => r.type === 'course').flatMap((r) => [r.code, ...(r.alts || [])]));
  // the program page's own "needs admission" list (admissionInfo.gated) adds the admission gate
  const admGated = new Set(program.admissionInfo?.gated || []);
  const gatesFor = (code, row) => {
    const g = gatesOf(courses[code], row);
    return admGated.has(code) && !g.includes('admission') ? ['admission', ...g] : g;
  };
  program.requirements.forEach((r, i) => {
    if (r.type === 'course') {
      const c = courses[r.code] || {};
      const codes = [r.code, ...(r.alts || [])];
      // "A or B" where A needs B: the requirement is met by either, so it needs the easier one's prereqs
      // (codes of the same requirement, and a course naming itself, are not prereqs)
      // (the flowchart and taps keep the listed course's own prereqs)
      const known = codes.filter((k) => courses[k]);
      const prereqs = stripCodes(c.prereqs ?? null, codes);
      const credits = r.credits ?? c.credits ?? 3;
      const repeat = repeatsOf(r, r.code, credits, courses);
      // the code the plan names first: the one the catalog's sample plan uses (ZOOL 2600 for "ZOOL 4400 or ZOOL 2600")
      const planCode = repeat === 1 && !planNamed.has(r.code) ? codes.find((k) => planNamed.has(k) && courses[k]) ?? r.code : r.code;
      const cq = coreqsOf([planCode], codes, courses);
      // two-way coreqs: a lab that names nothing still goes with the lecture that names it
      for (const k of back[planCode] || []) if (!codes.includes(k) && !cq.all.includes(k)) cq.all.push(k);
      // an alternative's own "prereq or concurrent" courses count as prereqs when choosing it (the sample
      // plan's own pick keeps them as "prereq or concurrent")
      const altReq = (k) => k === r.code || k === planCode ? stripCodes(courses[k]?.prereqs ?? null, [k]) : andAll([stripCodes(courses[k]?.prereqs ?? null, [k]), stripCodes(courses[k]?.precoreqs ?? null, [k])]);
      const u = {
        id: r.code, kind: 'course', code: r.code, codes, alts: r.alts || [],
        label: r.code, title: c.title || '', credits, area: r.area, order: i,
        prereqs, precoreqs: stripCodes(c.precoreqs ?? null, codes), coreqs: (c.coreqs || []).filter((k) => !codes.includes(k)),
        // the sample plan's own pick of "A or B" waits for its prereqs (ZOOL 2600 after NURS 2310)
        planPrereqs: planCode !== r.code && repeat === 1 ? stripCodes(courses[planCode]?.prereqs ?? null, codes)
          : known.length > 1 && repeat === 1 ? orAll(known.map((k) => stripCodes(altReq(k), codes))) : prereqs,
        planPrecoreqs: andAll([stripCodes((planCode !== r.code && repeat === 1 ? courses[planCode] : c)?.precoreqs ?? null, codes), cq.any]), planCoreqs: cq.all,
        altPrereqs: Object.fromEntries(codes.map((k) => [k, altReq(k)])),
        repeat, planCode, rowCredits: r.credits ?? null,
        gates: Object.fromEntries(codes.map((k) => [k, gatesFor(k, k === r.code ? r : {})])),
        minGrade: r.minGrade ?? c.minGrade ?? null,
        planSem: minPlanSem(codes), prog: r.prog,
      };
      u.gate = mainGate(u.gates[r.code]);
      units.push(u);
      for (const k of u.codes) byCode[k] ??= u;
    } else if (r.type === 'placeholder') {
      units.push({ id: r.id ?? `ph:${i}`, kind: 'placeholder', label: r.label, title: r.text || '', credits: r.credits || 0, area: r.area, order: i, planSem: planIndex[r.label] ?? 99, prog: r.prog });
    } else if (r.type === 'choice') {
      const g = { id: r.id ?? `choice:${i}`, kind: 'choice', label: r.label, title: r.text || '', credits: r.credits || 0, pick: r.pick, area: r.area, order: i, options: [], planSem: planIndex[r.label] ?? 99, prog: r.prog, minGrade: r.minGrade ?? null };
      // "complete one of the following tracks": option.section names its track
      if (Array.isArray(r.tracks) && r.tracks.length > 1) {
        g.tracks = r.tracks;
        g.subs = r.subs || [];
        g.trackElectives = r.trackElectives || {};
        g.trackGrades = r.trackGrades || null;
      }
      units.push(g);
      g._raw = r.options;
    }
  });
  // Option courses become their own boxes only when they connect to the program's prereq graph, and only
  // for a short list (a 40-course elective list stays one box).
  for (const g of units.filter((u) => u.kind === 'choice')) {
    // a course required on its own is "not otherwise required": drop it from elective lists, unless the list
    // couldn't be finished without it
    const keep = g._raw.filter((o) => !o.codes.every((c) => reqCodes.has(c)));
    const enough = g.pick?.credits ? keep.reduce((a, o) => a + (o.credits ?? courses[o.codes[0]]?.credits ?? 3), 0) >= g.pick.credits : keep.length >= (g.pick?.count ?? 1);
    if (keep.length < g._raw.length && enough) { g.dropped = g._raw.filter((o) => !keep.includes(o)).map((o) => o.codes.join(' + ')); g._raw = keep; }
    const opts = g._raw.map((o, k) => {
      const code = o.codes[0];
      const c = courses[code] || {};
      const own = [...o.codes, ...(o.alts || [])];
      const reqOf = (list) => andAll(list.map((x) => stripCodes(courses[x]?.prereqs ?? null, own)));
      const credits = o.credits ?? c.credits ?? 3;
      const pcq = coreqsOf(o.codes, own, courses);
      for (const x of o.codes) for (const kk of back[x] || []) if (!own.includes(kk) && !pcq.all.includes(kk)) pcq.all.push(kk);
      const gl = [...new Set(o.codes.flatMap((x) => gatesFor(x, o)))];
      return {
        id: `${g.id}/${code}`, kind: 'option', group: g.id, code, codes: o.codes, alts: o.alts || [],
        label: o.codes.join(' + '), title: o.codes.map((x) => courses[x]?.title || '').filter(Boolean).join(' + '),
        credits, area: g.area, order: g.order + (k + 1) / 100,
        // an option "A or B" (alts) can be met by either one's prereqs
        prereqs: reqOf(o.codes), precoreqs: null, coreqs: [],
        planPrereqs: o.alts?.length && o.alts.some((x) => courses[x]) ? orAll([reqOf(o.codes), reqOf(o.alts.filter((x) => courses[x]))]) : reqOf(o.codes),
        // used only by the semester plan (the flowchart keeps options free of coreq links)
        planPrecoreqs: andAll([...o.codes.map((x) => stripCodes(courses[x]?.precoreqs ?? null, own)), pcq.any]),
        planCoreqs: pcq.all,
        section: o.section, repeat: o.codes.length === 1 ? repeatsOf(o, code, credits, courses) : 1,
        gates: Object.fromEntries(o.codes.map((x) => [x, gatesFor(x, o)])), gate: mainGate(gl),
        // inside a track: a pick-list choice (sub), advice only (recommended), or the tracks' shared list
        sub: o.sub ?? null, recommended: !!o.recommended, shared: !!o.shared,
        minGrade: o.minGrade ?? c.minGrade ?? g.minGrade ?? null,
        planSem: minPlanSem(own), prog: g.prog,
      };
    });
    delete g._raw;
    g.options = opts;
    g.showOptions = opts.length <= MAX_OPTION_BOXES && opts.some((o) => codesOf(o.prereqs).some((x) => byCode[x]));
  }
  matchPlanLabels(program.gradPlan || [], units);
  linkWordPrereqs(units, courses);
  const model = { program, units, byCode };
  // choiceRemaining needs the whole program to count each finished class once
  for (const u of units) if (u.kind === 'choice') Object.defineProperty(u, '_model', { value: model, enumerable: false });
  computeDepths(model);
  return model;
}

// Two-way coreqs: back[Y] = courses that name Y as a coreq while Y doesn't name them (the catalog often
// lists the coreq on the lecture only). "A or B" coreq lists (one is enough) are not reversed.
function backCoreqs(courses) {
  const back = {};
  for (const [x, c] of Object.entries(courses)) {
    const cq = c.coreqs || [];
    const t = String(c.coreqText || '');
    if (!cq.length || (cq.length > 1 && /\bor\b/i.test(t) && !/\band\b|[()]/i.test(t))) continue;
    for (const y of cq) {
      const yc = courses[y];
      if (y === x || (yc && ((yc.coreqs || []).includes(x) || String(yc.coreqText || '').includes(x)))) continue;
      (back[y] ??= []).push(x);
    }
  }
  return back;
}
// Sample-plan rows the catalog labels loosely ("Complete one of the following:") go to the choice groups
// no row named, in catalog order.
function matchPlanLabels(terms, units) {
  const labels = new Set(units.map((u) => u.label));
  const free = units.filter((u) => u.kind === 'choice' && u.planSem === 99);
  terms.forEach((t, s) => t.items.forEach((x) => {
    if (x.code || !x.label || labels.has(x.label) || !/^(complete|choose|select)\b/i.test(x.label)) return;
    const g = free.shift();
    if (g) g.planSem = s;
  }));
}
// Prereqs written in words that name a requirement of the program ("completion of a university-level
// statistics course" -> the "University-level statistics course" group): that group is planned first.
function linkWordPrereqs(units, courses) {
  const named = units.filter((u) => (u.kind === 'choice' || u.kind === 'placeholder') && String(u.label || '').length >= 15)
    .map((u) => ({ u, l: String(u.label).toLowerCase().replace(/[:.]+$/, '') }));
  if (!named.length) return;
  const link = (x, codes) => {
    const t = codes.map((c) => String(courses[c]?.prereqText || '').toLowerCase()).join(' ');
    if (!t) return;
    const after = named.filter(({ u, l }) => u.id !== x.id && u.id !== x.group && t.includes(l)).map(({ u }) => u.id);
    if (after.length) x.afterUnits = after;
  };
  for (const u of units) {
    if (u.kind === 'course') link(u, [u.code]);
    if (u.kind === 'choice') for (const o of u.options) link(o, o.codes);
  }
}

function andAll(list) {
  const a = list.filter(Boolean);
  return a.length === 0 ? null : a.length === 1 ? a[0] : { and: a };
}
// any one of the alternatives; one with no prereqs makes the whole thing free
function orAll(list) {
  if (!list.length || list.some((x) => !x)) return null;
  return list.length === 1 ? list[0] : { or: list };
}
// A prereq expression without the given codes (a course naming itself, or another alternative of the
// same requirement). An "and"/"or" left empty means no prereq.
export function stripCodes(e, codes) {
  if (!e) return null;
  if (typeof e === 'string') return codes.includes(e) ? null : e;
  const k = e.and ? 'and' : 'or';
  const v = (e[k] || []).map((x) => stripCodes(x, codes)).filter(Boolean);
  return v.length === 0 ? null : v.length === 1 ? v[0] : { [k]: v };
}
// How many times a repeatable course is taken: the data's repeat count, else (an "R" course) the
// required credits over the most one enrollment can carry (DAGV 4900R: 6 credits of a 3-credit course = 2).
function repeatsOf(r, code, credits, courses) {
  if (Number.isInteger(r.repeat) && r.repeat > 1) return r.repeat;
  const c = courses[code] || {};
  const one = c.crMax ?? c.creditsMax ?? c.credits;
  if (/\dR$/.test(code) && one > 0 && credits > one) return Math.ceil(credits / one - 1e-9);
  return 1;
}
// Coreqs of some courses for the semester plan: all: taken together; any: one of them taken with it.
// The catalog's "SW 4800 or SW 4850" (no "and", no brackets) is a list where one is enough.
export function coreqsOf(list, own, courses) {
  const all = [];
  const any = [];
  for (const x of list) {
    const c = courses[x] || {};
    const cq = (c.coreqs || []).filter((k) => !own.includes(k));
    if (!cq.length) continue;
    const t = String(c.coreqText || '');
    if (cq.length > 1 && /\bor\b/i.test(t) && !/\band\b|[()]/i.test(t)) any.push({ or: cq });
    else all.push(...cq.filter((k) => !all.includes(k)));
  }
  return { all, any: andAll(any) };
}
// Is a choice option finished? All its courses, or (an "A or B" option) its alternative(s).
export function optionDone(o, completed) {
  if (o.codes.every((c) => completed.has(c))) return true;
  const alts = o.alts || [];
  if (!alts.length) return false;
  return o.codes.length === 1 ? alts.some((c) => completed.has(c)) : alts.every((c) => completed.has(c));
}
function gradPlanIndex(terms) {
  const idx = {};
  terms.forEach((t, s) => t.items.forEach((x) => {
    const k = x.code || x.label;
    if (k && idx[k] === undefined) idx[k] = s;
    for (const a of x.alts || []) if (idx[a] === undefined) idx[a] = s;
  }));
  return idx;
}
export function codesOf(expr) {
  if (!expr) return [];
  if (typeof expr === 'string') return [expr];
  return (expr.and || expr.or || []).flatMap(codesOf);
}

// Three-valued check: true / false / null (= course outside this program, assumed handled by placement).
export function evalReq(expr, done, inProgram) {
  if (!expr) return true;
  return ev(expr) !== false;
  function ev(e) {
    if (typeof e === 'string') return done.has(e) ? true : inProgram(e) ? false : null;
    if (e.and) { const v = e.and.map(ev); return v.includes(false) ? false : true; }
    const v = e.or.map(ev);
    if (v.includes(true)) return true;
    if (v.includes(false)) return false;
    return null;
  }
}

// ---------- completion ----------
export function unitDone(u, completed) {
  if (u.kind === 'placeholder') return completed.has(u.id);
  if (u.kind === 'option') return optionDone(u, completed);
  if (u.kind === 'course') return u.codes.some((c) => completed.has(c));
  if (u.kind === 'choice') return choiceRemaining(u, completed) <= 0;
  return false;
}
export function choiceRemaining(g, completed) {
  if (completed.has(g.id)) return 0;
  const doneOpts = countedOptions(g, completed);
  if (g.pick?.credits) return Math.max(0, g.pick.credits - doneOpts.reduce((s, o) => s + o.credits, 0));
  const need = g.pick?.count ?? 1;
  if (doneOpts.length >= need) return 0;
  return Math.round((g.credits / need) * (need - doneOpts.length)) || g.credits;
}

// A finished class fills ONE requirement of a program: required courses take theirs first, then choice
// groups in catalog order, each taking the finished options the later groups can't use first.
// (STAT 1040 fills Quantitative Literacy or the nursing statistics course, not both.)
// Returns the finished options that count for group g.
export function countedOptions(g, completed) {
  const model = g._model;
  const doneHere = (o) => optionDone(o, completed);
  if (!model) return g.options.filter(doneHere);
  const used = new Set();
  for (const u of model.units) if (u.kind === 'course') { const c = u.codes.find((k) => completed.has(k)); if (c) used.add(c); }
  const groups = model.units.filter((u) => u.kind === 'choice');
  const codesOfOpt = (o) => [...o.codes, ...o.alts].filter((c) => completed.has(c));
  for (let gi = 0; gi < groups.length; gi++) {
    const h = groups[gi];
    const cands = completed.has(h.id) ? [] : h.options.filter((o) => doneHere(o) && !codesOfOpt(o).some((c) => used.has(c)));
    const later = (o) => groups.slice(gi + 1).filter((x) => x.options.some((p) => codesOfOpt(p).some((c) => codesOfOpt(o).includes(c)))).length;
    cands.sort((a, b) => later(a) - later(b));
    const take = [];
    let need = h.pick?.credits ? h.pick.credits : (h.pick?.count ?? 1);
    for (const o of cands) {
      if (need <= 0) break;
      if (codesOfOpt(o).some((c) => used.has(c))) continue;
      take.push(o); codesOfOpt(o).forEach((c) => used.add(c));
      need -= h.pick?.credits ? o.credits : 1;
    }
    if (h === g) return take;
  }
  return g.options.filter(doneHere);
}

// ---------- tapping classes taken ----------
// Codes a student has, with every alternative of a finished course counted ("ENGL 1005" covers ENGL 1010).
export function haveSet(model, completed) {
  const have = new Set(completed);
  for (const u of model.units) {
    if (u.kind === 'course' && unitDone(u, completed)) u.codes.forEach((c) => have.add(c));
    // a finished "A or B" option counts as both
    if (u.kind === 'choice') for (const o of u.options) if (o.alts.length && optionDone(o, completed)) [...o.codes, ...o.alts].forEach((c) => have.add(c));
  }
  return have;
}
// Prereqs (inside the program) still missing for an expression, as short labels: "MATH 1210", "A or B".
function missingOf(expr, have, inProgram) {
  if (!expr) return [];
  if (typeof expr === 'string') return have.has(expr) || !inProgram(expr) ? [] : [expr];
  if (expr.and) return expr.and.flatMap((e) => missingOf(e, have, inProgram));
  if (evalReq(expr, have, inProgram)) return [];
  const alts = expr.or.map((e) => missingOf(e, have, inProgram)).filter((m) => m.length);
  return [alts.map((m) => m.join(' + ')).join(' or ')];
}
// Can a flowchart box (a course with its folded labs, an option, a Gen Ed box) be marked taken now?
// Only prereqs block; coreqs and "prereq or concurrent" courses may be taken together.
export function tapCheck(model, node, completed) {
  const have = haveSet(model, completed);
  const inProgram = (c) => !!model.byCode[c];
  const missing = [];
  for (const u of [node, ...(node.labs || [])]) for (const m of missingOf(u.prereqs, have, inProgram)) if (!missing.includes(m)) missing.push(m);
  return { ok: missing.length === 0, missing };
}
// After untaking something: also untake every taken course whose prereqs are no longer met, repeatedly.
// Codes in keep (imported from an audit, which is the truth) always stay.
export function cascadeUntake(model, completed, keep = new Set()) {
  const out = new Set(completed);
  const courses = model.program.courses || {};
  const inProgram = (c) => !!model.byCode[c];
  for (let changed = true; changed;) {
    changed = false;
    const have = haveSet(model, out);
    for (const c of [...out]) {
      if (keep.has(c)) continue;
      const req = stripCodes(courses[c]?.prereqs ?? null, [c]);
      if (req && !evalReq(req, have, inProgram)) { out.delete(c); changed = true; }
    }
  }
  return out;
}

// ---------- flowchart depth ----------
function computeDepths(model) {
  const { units, byCode } = model;
  const nodes = flowNodes(model);
  const inProg = (c) => !!byCode[c];
  const depth = new Map(nodes.map((n) => [n.id, 0]));
  const dOf = (e) => {
    if (!e) return -1;
    if (typeof e === 'string') return byCode[e] ? depth.get(byCode[e].id) ?? 0 : -1;
    if (e.and) return Math.max(-1, ...e.and.map(dOf));
    const v = e.or.map(dOf).filter((x) => x >= 0);
    return v.length ? Math.min(...v) : -1;
  };
  for (let pass = 0; pass < 40; pass++) {
    let changed = false;
    for (const n of nodes) {
      let d = Math.max(dOf(n.prereqs) + 1, 0);
      if (n.precoreqs) d = Math.max(d, dOf(n.precoreqs));
      for (const c of n.coreqs || []) if (inProg(c)) d = Math.max(d, depth.get(byCode[c].id));
      // a lab and its lecture share a column
      for (const m of nodes) if ((m.coreqs || []).includes(n.code) && m !== n) d = Math.max(d, depth.get(m.id));
      if (d !== depth.get(n.id)) { depth.set(n.id, d); changed = true; }
    }
    if (!changed) break;
  }
  for (const n of nodes) n.depth = depth.get(n.id);
  for (const u of units) if (u.kind === 'choice' && u.showOptions) u.depth = Math.min(...u.options.map((o) => o.depth));
}

// Boxes drawn in the flowchart: courses, placeholders, choice groups (or their options).
export function flowNodes(model) {
  const out = [];
  for (const u of model.units) {
    if (u.kind === 'choice' && u.showOptions) out.push(...u.options);
    else out.push(u);
  }
  return out;
}
// Prereq edges between drawn boxes: [{from, to, or}]
export function flowEdges(model) {
  const nodes = flowNodes(model);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = [];
  for (const n of nodes) {
    const walk = (e, isOr) => {
      if (!e) return;
      if (typeof e === 'string') {
        const u = model.byCode[e];
        if (u && ids.has(u.id) && u.id !== n.id) edges.push({ from: u.id, to: n.id, or: isOr });
        return;
      }
      if (e.and) e.and.forEach((x) => walk(x, isOr));
      else { const inp = e.or.filter((x) => codesOf(x).some((c) => model.byCode[c])); inp.forEach((x) => walk(x, isOr || inp.length > 1)); }
    };
    walk(n.prereqs, false);
    walk(n.precoreqs, false);
  }
  return [...new Map(edges.map((e) => [e.from + '>' + e.to, e])).values()];
}

// ---------- terms ----------
const SEASONS = ['Spring', 'Summer', 'Fall'];
export function nextTerm(t, summers = false) {
  let i = SEASONS.indexOf(t.season), y = t.year;
  do { i++; if (i > 2) { i = 0; y++; } } while (!summers && SEASONS[i] === 'Summer');
  return { season: SEASONS[i], year: y };
}
// The semester in session on a date (UVU: Spring Jan-Apr, Summer May to mid-Aug, Fall from Aug 20).
export function currentTerm(date = new Date()) {
  const m = date.getMonth(), y = date.getFullYear(); // m is 0-based
  if (m <= 3) return { season: 'Spring', year: y };
  if (m <= 6 || (m === 7 && date.getDate() < 20)) return { season: 'Summer', year: y };
  return { season: 'Fall', year: y };
}
export const termIndex = (t) => t.year * 3 + SEASONS.indexOf(t.season);
// The plan starts with the first semester after the one in session (never the current one: its classes
// are already in progress).
export function defaultStartTerm(date = new Date(), summers = false) {
  return nextTerm(currentTerm(date), summers);
}
// The first semester a plan may start: after today's semester and after the latest semester an imported
// audit shows classes in (registered for next term already -> start the term after that).
export function earliestStart({ date = new Date(), summers = false, lastTerm = null } = {}) {
  let t = defaultStartTerm(date, summers);
  if (lastTerm && SEASONS.includes(lastTerm.season) && termIndex(lastTerm) >= termIndex(t)) t = nextTerm(lastTerm, summers);
  return t;
}
// The plan's first semester: the saved Start, unless it's earlier than earliestStart; a saved Summer
// start with summers off moves to that Fall (the plan has no summers then).
export function planStart(saved, { date = new Date(), summers = false, lastTerm = null } = {}) {
  const e = earliestStart({ date, summers, lastTerm });
  let s = saved && SEASONS.includes(saved.season) ? saved : null;
  if (s && !summers && s.season === 'Summer') s = nextTerm(s, false);
  return s && termIndex(s) > termIndex(e) ? s : e;
}
export const termLabel = (t) => `${t.season} ${t.year}`;

// ---------- the plan ----------
// completed: Set of course codes and unit ids already finished.
// opts: start, maxCredits, summers, plus
//   tracks     {groupId: track name} chosen tracks (settings.tracks); a missing/unknown one is guessed
//   track      one track name to use wherever a group has it
//   admitted   true: the student is already in the program (no Apply step)
//   creditsDone credits finished in total (all classes, for University Advanced Standing); default: the
//              finished classes of this program
// Order of placement: the catalog's sample-plan semester first, then the longest prereq chain.
// Admission programs: "Before you apply" semesters -> Apply -> program semesters (plan.admission, planPhases).
export function makePlan(model, completed = new Set(), opts = {}) {
  const maxCredits = opts.maxCredits ?? 16;
  const summers = opts.summers ?? false;
  let term = opts.start ?? defaultStartTerm();
  const { units, byCode } = model;
  const courses = model.program.courses || {};
  // completing any alt of a course (or of an "A or B" option) satisfies prereqs naming the others
  const done = haveSet(model, completed);
  const startDone = new Set(done);

  // work items
  const todo = [];
  // N credits as boxes of at most 4 (3s, then the rest), so a 52-credit elective spreads over semesters
  const chunksOf = (n) => { const out = []; let left = n; while (left > 0) { const c = left <= 4 ? left : 3; out.push(c); left -= c; } return out; };
  // a repeatable course taken several times: one enrollment per semester, in order
  const pushRepeats = (it) => {
    const n = it.repeat > 1 ? it.repeat : 1;
    if (n === 1) { todo.push(it); return it.id; }
    const base = Math.floor((it.credits / n) * 2) / 2;
    let prev = it.after ?? null;
    for (let k = 0; k < n; k++) {
      const cr = k === n - 1 ? Math.round((it.credits - base * (n - 1)) * 2) / 2 : base;
      const x = { ...it, id: `${it.id}#r${k + 1}`, credits: cr, after: prev, order: it.order + k / 1000 };
      if (k > 0) { x.coreqs = []; x.precoreqs = null; }
      todo.push(x); prev = x.id;
    }
    return prev;
  };
  const tracks = [];
  const lastTake = new Map(); // a course listed twice (SW 4810R field placement): the second take comes later
  for (const u of units) {
    if (unitDone(u, completed)) continue;
    if (u.kind === 'course') {
      const prev = lastTake.get(u.id);
      if (prev && !/\dR$/.test(u.code)) continue; // listed twice but not repeatable: once is enough
      const id = prev ? `${u.id}#t${units.filter((x) => x.id === u.id).indexOf(u) + 1}` : u.id;
      const code = u.repeat > 1 ? u.code : u.planCode ?? u.code;
      lastTake.set(u.id, pushRepeats({
        ...u, id, code, label: code, title: courses[code]?.title || u.title, credits: courseCredits(u, code, courses),
        after: prev ?? null, prereqs: u.planPrereqs, precoreqs: u.planPrecoreqs, coreqs: prev ? [] : u.planCoreqs, unit: u,
        gateList: u.gates?.[code] || [], gate: mainGate(u.gates?.[code]),
      }));
    }
    else if (u.kind === 'placeholder') {
      const ch = chunksOf(u.credits);
      if (ch.length <= 1) todo.push({ ...u, unit: u });
      else ch.forEach((c, k) => todo.push({ ...u, id: `${u.id}#${k}`, credits: c, unit: u, order: u.order + k / 100 }));
    } else if (u.kind === 'choice') {
      let left = choiceRemaining(u, completed);
      let optsLeft = u.options.filter((o) => !optionDone(o, completed));
      const chosen = trackChoice(u, opts);
      const track = pickTrack(u, completed, left, chosen);
      if (track) {
        tracks.push({ groupId: u.id, label: u.label, tracks: u.tracks, track, guessed: track !== chosen });
        // the chosen track: its required courses become real items (not its pick lists, advice or the shared list)
        const grade = u.trackGrades?.[track] ?? u.minGrade ?? null;
        for (const o of optsLeft.filter((x) => x.section === track && x.sub == null && !x.recommended && !x.shared)) {
          const gl = [...new Set(Object.values(o.gates || {}).flat())];
          pushRepeats({
            ...o, kind: 'option', unit: u, unitId: u.showOptions ? o.id : u.id, prereqs: o.planPrereqs,
            precoreqs: o.planPrecoreqs, coreqs: o.planCoreqs, codes: [...o.codes, ...o.alts], codeList: o.codes,
            gateList: gl, gate: mainGate(gl), minGrade: o.minGrade ?? grade,
          });
          left -= o.credits;
        }
        // the track's own pick lists ("Complete 12 credits from the following"): one choice each
        (u.subs || []).forEach((sb, k) => {
          if (sb.section !== track || left <= 0) return;
          const mine = u.options.filter((o) => o.sub === k && o.section === track);
          const doneCr = mine.filter((o) => optionDone(o, completed)).reduce((a, o) => a + o.credits, 0);
          const need = Math.min(left, Math.max(0, (sb.credits || 0) - doneCr));
          if (!need) return;
          const subOpts = mine.filter((o) => !optionDone(o, completed)).map((o) => ({ ...o, prereqs: o.planPrereqs }));
          chunksOf(need).forEach((c, j) => todo.push({ id: `${u.id}#s${k}.${j}`, kind: 'choice', label: sb.label || u.label, title: u.title, credits: c, unit: u, order: u.order + (k + 1) / 100 + j / 1000, planSem: u.planSem, options: subOpts, minGrade: sb.minGrade ?? grade }));
          left -= need;
        });
        // the rest of the group's credits: the tracks' shared list, plus this track's recommended classes
        optsLeft = optsLeft.filter((x) => !u.tracks.includes(x.section) || (x.section === track && x.recommended));
      }
      const opts2 = optsLeft.map((o) => ({ ...o, prereqs: o.planPrereqs }));
      if (left > 0) chunksOf(left).forEach((c, k) => todo.push({ id: `${u.id}#${k}`, kind: 'choice', label: u.label, title: u.title, credits: c, unit: u, order: u.order + k / 100, planSem: u.planSem, options: opts2, minGrade: u.minGrade }));
    }
  }
  // courses this plan schedules (a track's courses count; other tracks' do not)
  const planCodes = new Set(Object.keys(byCode));
  for (const it of todo) for (const c of it.codes || []) planCodes.add(c);
  const inProgram = (c) => planCodes.has(c);
  const height = heights(model, todo);

  // ----- gates -----
  const gate = gateSetup(model, todo, completed, opts);
  const isAdm = (it) => it.cohort != null || (it.gateList || []).includes('admission');
  const isStd = (it) => (it.gateList || []).includes('advanced-standing');
  const standing = standingSetup(model, todo, completed, opts);
  const admission = gate.items ? { at: null, admitted: gate.admitted } : null;
  const standingOut = standing.needed ? { at: standing.fromStart ? 0 : null, fromStart: standing.fromStart } : null;

  const warnings = [];
  const semesters = [];
  const placed = new Set();
  // cohort blocks first, then (until Apply) the before-you-apply requirements, then the rest
  const rank = (it) => (it.cohort != null ? 0 : !gate.open && gate.applyUnits.has(it.unit.id) ? 1 : 2);
  // the catalog semester the student is at: the earliest sample-plan semester still to do
  // (a student with credits done is at least that many 15-credit semesters along)
  const doneCredits = model.units.filter((u) => unitDone(u, completed)).reduce((a, u) => a + (u.kind === 'choice' ? (u.pick?.credits ?? u.credits) : u.credits), 0);
  const planBase = Math.max(Math.min(99, ...todo.map((x) => x.planSem ?? 99)), Math.floor(doneCredits / 15));
  // (degree-size programs only: a minor's or certificate's sample plan is spread over a whole degree)
  const sequenced = programCredits(model) >= 60;
  let early = sequenced;
  // a page's own matriculation list can name classes its sample plan puts late: those keep the sample-plan
  // order (the Apply step simply waits for them) instead of jumping ahead of earlier classes
  const listedGate = gate.listed;
  const sortKey = listedGate
    ? (a, b) => (rank(b) === 0) - (rank(a) === 0) || (a.planSem - b.planSem) || rank(a) - rank(b) || (height.get(b.id) - height.get(a.id)) || (a.order - b.order)
    : (a, b) => rank(a) - rank(b) || (a.planSem - b.planSem) || (height.get(b.id) - height.get(a.id)) || (a.order - b.order);

  while (todo.length && semesters.length < 40) {
    const before = new Set(done);
    const sem = { term: termLabel(term), items: [], credits: 0 };
    const leftUnits = new Set(todo.map((x) => x.unit.id));
    // Apply milestone: open once every "before you apply" requirement is finished in an earlier term
    const open = gate.open || [...gate.applyUnits].every((id) => !leftUnits.has(id));
    if (open && admission && admission.at == null) admission.at = semesters.length;
    const hasStanding = standing.ok(before, leftUnits, semesters);
    if (hasStanding && standingOut && standingOut.at == null) standingOut.at = semesters.length;
    // the cohort runs block by block (the catalog's semesters), one block per term
    const cohortNow = Math.min(Infinity, ...todo.filter((x) => x.cohort != null).map((x) => x.cohort));
    const avail = (it) => {
      if (it.after && !placed.has(it.after)) return false;
      if (early && it.cohort == null && it.planSem < 99 && it.planSem - planBase > semesters.length + EARLY_SLACK) return false;
      if (isAdm(it) && !open) return false;
      if (isStd(it) && !hasStanding) return false;
      if (it.cohort != null && it.cohort !== cohortNow) return false;
      if (it.afterUnits && it.afterUnits.some((id) => leftUnits.has(id))) return false;
      if (it.kind === 'course' || it.kind === 'option') return evalReq(it.prereqs, before, inProgram);
      if (it.kind === 'choice') return !it.options.length || it.options.some((o) => evalReq(o.prereqs, before, inProgram));
      return true;
    };
    const coreqOk = (it, now) => (it.coreqs || []).every((c) => !inProgram(c) || now.has(c)) && evalReq(it.precoreqs, now, inProgram);
    // a not-yet-planned course that is c (a coreq, or a "prereq or concurrent" course)
    const partnerOf = (c, bundle) => todo.find((x) => (x.kind === 'course' || x.kind === 'option') && !x.after && (x.codes || []).includes(c) && !sem.items.includes(x) && !bundle.includes(x));
    // codes still missing for a "prereq or concurrent" expression, given what is already this semester
    const missing = (e, have) => {
      if (!e) return [];
      if (typeof e === 'string') return have.has(e) || !inProgram(e) ? [] : [e];
      if (e.and) return e.and.flatMap((x) => missing(x, have));
      if (evalReq(e, have, inProgram)) return [];
      for (const x of e.or) { const m = missing(x, have); if (m.length && m.every((c) => partnerOf(c, []))) return m; }
      return [];
    };
    // a course + its coreqs (lecture + lab, two-way) + "prereq or corequisite" courses not yet taken
    const grow = (bundle) => {
      for (let i = 0; i < bundle.length && bundle.length < 16; i++) {
        const x = bundle[i];
        for (const c of x.coreqs || []) { const p = partnerOf(c, bundle); if (p) bundle.push(p); }
        const have = new Set(before);
        for (const y of [...sem.items, ...bundle]) (y.codes || []).forEach((c) => have.add(c));
        for (const c of missing(x.precoreqs, have)) { const p = partnerOf(c, bundle); if (p) bundle.push(p); }
      }
      return bundle;
    };
    const fits = (bundle) => {
      if (!bundle.every(avail)) return false;
      const cr = bundle.reduce((s, x) => s + x.credits, 0);
      if (sem.credits + cr > maxCredits) return false;
      const now = new Set(before);
      for (const x of [...sem.items, ...bundle]) (x.codes || []).forEach((c) => now.add(c));
      return bundle.every((x) => coreqOk(x, now));
    };
    const fill = () => {
      let added = true;
      while (added) {
        added = false;
        const cands = todo.filter((it) => !sem.items.includes(it) && avail(it)).sort(sortKey);
        for (const it of cands) {
          // a cohort block goes in whole when it fits
          const tries = [];
          if (it.cohort != null) tries.push(grow(todo.filter((x) => x.cohort === it.cohort && !sem.items.includes(x))));
          tries.push(grow([it]));
          const bundle = tries.find(fits);
          if (!bundle) continue;
          sem.items.push(...bundle); sem.credits += bundle.reduce((s, x) => s + x.credits, 0); added = true;
          break; // re-sort after each pick
        }
      }
    };
    // first: nothing more than EARLY_SLACK semesters ahead of the catalog's sample plan; a term left empty
    // that way takes anything that can go
    early = sequenced; fill();
    if (!sem.items.length && early) { early = false; fill(); }
    if (!sem.items.length) {
      // nothing fits (credit cap smaller than a bundle, or a prereq loop): force the best one in (never a gated one
      // while something else is left)
      const free = todo.filter((x) => !x.after || placed.has(x.after));
      const it = free.filter((x) => !isAdm(x) && !isStd(x)).sort(sortKey)[0] || free.sort(sortKey)[0] || todo[0];
      warnings.push(`${it.label}: placed without its prerequisites or over the credit limit`);
      sem.items.push(it); sem.credits += it.credits;
    }
    for (const it of sem.items) {
      // "A or B" where A needs B: name the one that can be taken now
      if (it.kind === 'course' && it.altPrereqs && it.codes.length > 1 && !it.after && !(it.repeat > 1) && !evalReq(it.altPrereqs[it.code], before, inProgram)) {
        const ok = it.codes.find((c) => evalReq(it.altPrereqs[c], before, inProgram));
        if (ok) {
          sem.credits -= it.credits;
          it.code = ok; it.label = ok; it.title = courses[ok]?.title || it.title;
          it.credits = courseCredits(it.unit, ok, courses);
          it.gateList = it.unit.gates?.[ok] || []; it.gate = mainGate(it.gateList);
          sem.credits += it.credits;
        }
      }
    }
    for (const it of sem.items) { todo.splice(todo.indexOf(it), 1); placed.add(it.id); (it.codes || []).forEach((c) => done.add(c)); }
    sem.items.sort((a, b) => (a.kind === 'course' ? 0 : 1) - (b.kind === 'course' ? 0 : 1) || String(a.label).localeCompare(String(b.label)));
    semesters.push(sem);
    term = nextTerm(term, summers);
  }
  if (todo.length) warnings.push(`${todo.length} requirement(s) could not be placed within 40 semesters`);
  if (admission && admission.at == null) admission.at = semesters.length;
  if (standingOut && standingOut.at == null) standingOut.at = semesters.length;
  void startDone;
  const totalLeft = semesters.reduce((s, x) => s + x.credits, 0);
  return {
    semesters: semesters.map((s) => ({ term: s.term, credits: s.credits, items: s.items.map((it) => ({
      id: it.id, unitId: it.unitId ?? it.unit.id, kind: it.kind, code: it.code || null,
      codes: it.kind === 'option' ? it.codeList : it.kind === 'course' ? [it.code] : undefined,
      label: it.label, title: it.title, credits: it.credits,
      gate: isAdm(it) ? 'admission' : it.gate || null, minGrade: it.minGrade ?? null,
    })) })),
    creditsLeft: totalLeft,
    graduation: semesters.length ? semesters[semesters.length - 1].term : null,
    warnings,
    admission, standing: standingOut, tracks,
  };
}

// Credits of a course requirement when the plan names `code`: the row's credits, except when the named
// course is another one of the "A or B" codes (or the row's number is plainly the other code's): then its own.
function courseCredits(u, code, courses) {
  const row = u.rowCredits ?? u.credits;
  if (u.repeat > 1 || !u.codes || u.codes.length < 2) return u.credits;
  const own = courses[code]?.credits;
  if (typeof own !== 'number' || courses[code]?.creditsMax || courses[code]?.crMax) return u.credits;
  if (code !== u.code) return own;
  const others = u.codes.filter((k) => k !== code).map((k) => courses[k]?.credits);
  return row !== own && others.includes(row) ? own : u.credits;
}

// The track a student chose for a group (opts.tracks[groupId], or opts.track when the group has that name).
function trackChoice(g, opts) {
  if (!g.tracks) return null;
  const t = opts.tracks?.[g.id] ?? (typeof opts.track === 'string' ? opts.track : opts.track?.[g.id]);
  return t && g.tracks.includes(t) ? t : null;
}

// Admission gate: which requirements come before "Apply", and the cohort blocks.
// Before-you-apply set: the program's own list when the data has one (applyPrereqs / gate.codes), else every
// lower-division requirement the catalog's sample plan puts before the first gated course, else every
// lower-division required course; never one that itself waits on a gated course.
function gateSetup(model, todo, completed, opts) {
  const { program, units } = model;
  const adm = (it) => (it.gateList || []).includes('admission');
  const gatedUnits = units.filter((u) => u.kind === 'course' ? (u.gates?.[u.code] || []).includes('admission') : u.kind === 'choice' && u.options.some((o) => (o.gates && Object.values(o.gates).flat().includes('admission'))));
  const gatedCodes = new Set();
  for (const u of units) {
    if (u.kind === 'course' && (u.gates?.[u.code] || []).includes('admission')) u.codes.forEach((c) => gatedCodes.add(c));
    if (u.kind === 'choice') for (const o of u.options) if (Object.values(o.gates || {}).flat().includes('admission')) o.codes.forEach((c) => gatedCodes.add(c));
  }
  const out = { open: true, admitted: false, items: false, applyUnits: new Set() };
  if (!gatedCodes.size) return out;
  // cohort programs (admission: true): the program's own subject courses from the first gated sample-plan
  // semester on run as the catalog's semester blocks
  const gateSems = [];
  for (const u of units) {
    if (u.kind === 'course' && (u.gates?.[u.code] || []).includes('admission') && u.planSem < 99) gateSems.push(u.planSem);
    if (u.kind === 'choice') for (const o of u.options) if (Object.values(o.gates || {}).flat().includes('admission') && o.planSem < 99) gateSems.push(o.planSem);
  }
  const firstGate = Math.min(99, ...gateSems);
  if (program.admission === true && firstGate < 99) {
    const subj = new Set([...gatedCodes].map((c) => c.split(' ')[0]));
    const cand = todo.filter((it) => {
      if (!(it.kind === 'course' || it.kind === 'option') || it.after) return false;
      const code = it.kind === 'course' ? it.code : it.codeList?.[0];
      return code && subj.has(code.split(' ')[0]) && it.planSem >= firstGate && it.planSem < 99;
    });
    // only when the catalog's blocks agree with the prereqs (each prereq in an earlier block, coreqs in the
    // same one); otherwise the gate alone orders the program (graduate plans, loose sample plans)
    const blockOf = (c) => cand.find((y) => (y.codes || []).includes(c))?.planSem;
    const clean = cand.every((x) => codesOf(x.prereqs).every((c) => !(blockOf(c) >= x.planSem))
      && codesOf(x.precoreqs).every((c) => !(blockOf(c) > x.planSem))
      && (x.coreqs || []).every((c) => blockOf(c) === undefined || blockOf(c) === x.planSem));
    if (clean) for (const it of cand) it.cohort = it.planSem;
  }
  if (!todo.some((it) => adm(it) || it.cohort != null)) return out;
  out.items = true;
  // already in the program: a gated class is finished
  if (opts.admitted || [...gatedCodes].some((c) => completed.has(c))) { out.admitted = true; return out; }
  out.open = false;
  // requirements that (through prereqs/coreqs) wait on a gated or cohort course can't be "before you apply"
  const waits = new Set([...gatedCodes]);
  for (const it of todo) if (it.cohort != null) (it.codes || []).forEach((c) => waits.add(c));
  const codesIn = (u) => u.kind === 'course' ? u.codes : u.kind === 'choice' ? u.options.flatMap((o) => o.codes) : [];
  const reqOf = (u) => u.kind === 'course' ? [u.planPrereqs, u.planPrecoreqs, ...(u.planCoreqs || [])] : u.kind === 'choice' ? u.options.flatMap((o) => [o.planPrereqs]) : [];
  let grew = true;
  const blocked = new Set();
  while (grew) {
    grew = false;
    for (const u of units) {
      if (blocked.has(u.id)) continue;
      if (codesIn(u).some((c) => waits.has(c)) && (u.kind !== 'choice' || u.options.every((o) => o.codes.some((c) => waits.has(c))))) { blocked.add(u.id); grew = true; continue; }
      const req = reqOf(u).flatMap(codesOf);
      if (req.some((c) => waits.has(c))) { blocked.add(u.id); codesIn(u).forEach((c) => waits.add(c)); grew = true; }
    }
  }
  const lower = (u) => u.kind !== 'course' || Number((u.code.match(/\d{4}/) || ['0'])[0]) < 3000;
  // the page's own matriculation list (admissionInfo.before when it came from that section; a list read off
  // the sample plan is no better than the sample-plan rule below)
  const info = program.admissionInfo;
  const listed = program.applyPrereqs || program.gate?.codes || (info?.beforeFrom === 'matriculation section' ? info.before : null);
  let set;
  if (Array.isArray(listed) && listed.length) { set = units.filter((u) => codesIn(u).some((c) => listed.includes(c))); out.listed = true; }
  else if (firstGate < 99) set = units.filter((u) => (u.kind === 'course' || u.kind === 'choice') && u.planSem < firstGate && lower(u));
  else set = units.filter((u) => u.kind === 'course' && lower(u));
  void gatedUnits;
  for (const u of set) if (!blocked.has(u.id) && !unitDone(u, completed)) out.applyUnits.add(u.id);
  return out;
}

// University Advanced Standing (STANDING_RULE): needed by Advanced Standing courses still to plan.
function standingSetup(model, todo, completed, opts) {
  const std = (it) => (it.gateList || []).includes('advanced-standing');
  const out = { needed: todo.some(std), fromStart: false, ok: () => true };
  if (!out.needed) return out;
  const stdCodes = model.units.flatMap((u) => u.kind === 'course' ? u.codes.filter((c) => (u.gates?.[c] || []).includes('advanced-standing'))
    : u.kind === 'choice' ? u.options.flatMap((o) => o.codes.filter((c) => (o.gates?.[c] || []).includes('advanced-standing'))) : []);
  if (opts.standing || stdCodes.some((c) => completed.has(c))) { out.fromStart = true; return out; }
  const total = programCredits(model);
  const english = model.byCode[STANDING_RULE.english] ? STANDING_RULE.english : null;
  const ql = model.units.filter((u) => STANDING_RULE.ql.test(String(u.label || '')) && u.kind !== 'course').map((u) => u.id);
  const doneCr = opts.creditsDone ?? model.units.filter((u) => unitDone(u, completed)).reduce((s, u) => s + (u.kind === 'choice' ? (u.pick?.credits ?? u.credits) : u.credits), 0);
  out.ok = (before, leftUnits, semesters) => {
    if (english && !before.has(english)) return false;
    if (ql.some((id) => leftUnits.has(id))) return false;
    if (total < STANDING_RULE.minProgramCredits) return true;
    return doneCr + semesters.reduce((s, x) => s + x.credits, 0) >= STANDING_RULE.credits;
  };
  if (out.ok(haveSet(model, completed), new Set(todo.map((x) => x.unit.id)), [])) out.fromStart = true;
  return out;
}

// "Complete one of the following tracks": the track to plan. The one the student chose, else the one they
// have the most credits in, then the cheapest (fewest credits to finish the group with it), then catalog
// order. null = no tracks.
export function pickTrack(g, completed, need = choiceRemaining(g, completed), chosen = null) {
  if (!g.tracks) return null;
  const cands = g.tracks.map((t, k) => {
    const opts = g.options.filter((o) => o.section === t);
    const doneCr = opts.filter((o) => optionDone(o, completed)).reduce((s, o) => s + o.credits, 0);
    // credits still to do: the track's required courses + its pick lists (advice and shared lists aren't required)
    const req = opts.filter((o) => o.sub == null && !o.recommended && !o.shared);
    const subCr = (g.subs || []).filter((sb) => sb.section === t).reduce((s, sb) => s + (sb.credits || 0), 0);
    const leftCr = req.filter((o) => !optionDone(o, completed)).reduce((s, o) => s + o.credits, 0) + subCr;
    return { t, k, n: opts.length, doneCr, cost: Math.max(need, leftCr) };
  }).filter((x) => x.n);
  if (cands.length < 2) return null;
  if (chosen && cands.some((x) => x.t === chosen)) return chosen;
  cands.sort((a, b) => b.doneCr - a.doneCr || a.cost - b.cost || a.k - b.k);
  return cands[0].t;
}

// Which requirement a class fills, and why it is in the plan (for the class sheet).
// -> {unitId, kind, label, area, credits, why, alsoIn: [labels], gate, minGrade, track} | null
export function requirementFor(model, code, completed = new Set()) {
  void completed;
  const hits = [];
  for (const u of model.units) {
    if (u.kind === 'course' && u.codes.includes(code)) hits.push({ u, o: null });
    if (u.kind === 'choice') { const o = u.options.find((x) => x.codes.includes(code) || x.alts.includes(code)); if (o) hits.push({ u, o }); }
  }
  if (!hits.length) return null;
  const { u, o } = hits[0];
  const gl = (o ? o.gates?.[code] : u.gates?.[code]) || [];
  const gate = mainGate(gl);
  const area = u.area || '';
  let why;
  if (u.kind === 'course') {
    why = u.codes.length > 1 ? `Required (${area}): ${u.codes.join(' or ')}; any one counts` : `Required course (${area})`;
  } else if (o?.section && u.tracks) {
    why = `Part of the "${o.section}" track; ${u.label} (one track is required, ${area})`;
  } else {
    const pick = u.pick?.credits ? `${u.pick.credits} credits from the list` : `${u.pick?.count ?? 1} from the list`;
    why = `One of the options for "${u.label}" (${pick}, ${area})`;
  }
  if (gate === 'admission') why += '. Needs acceptance into the program first';
  else if (gate === 'advanced-standing') why += '. Needs University Advanced Standing';
  const alsoIn = [...new Set(hits.slice(1).map((h) => h.u.label))].filter((l) => l !== u.label);
  return {
    unitId: u.id, kind: u.kind, label: u.label, area, credits: o ? o.credits : u.credits, why, alsoIn,
    gate, minGrade: (o ? o.minGrade : u.minGrade) ?? null, track: o?.section && u.tracks ? o.section : null,
  };
}

// Longest chain of later courses that depend on each item (so long chains start first).
function heights(model, todo) {
  const h = new Map();
  const dependents = (it) => todo.filter((x) => x !== it && (codesOf(x.prereqs).some((c) => (it.codes || []).includes(c)) || (x.options || []).some((o) => codesOf(o.prereqs).some((c) => (it.codes || []).includes(c)))));
  const memo = new Map();
  const visit = (it, stack = new Set()) => {
    if (memo.has(it.id)) return memo.get(it.id);
    if (stack.has(it.id)) return 0;
    stack.add(it.id);
    const d = dependents(it);
    const v = d.length ? 1 + Math.max(...d.map((x) => visit(x, stack))) : 0;
    stack.delete(it.id);
    memo.set(it.id, v);
    return v;
  };
  for (const it of todo) h.set(it.id, visit(it));
  return h;
}

// Credits a program needs in total, counted from its units.
export function programCredits(model) {
  return model.units.reduce((s, u) => s + (u.kind === 'choice' ? (u.pick?.credits ?? u.credits) : u.credits), 0);
}

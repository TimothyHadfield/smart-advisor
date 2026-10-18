// Smart Advisor planner: pure functions, used by the browser (js/app.js) and Node tests.
// Program JSON comes from scripts/fetch-program.mjs.
import { gatesOf, mainGate, STANDING_RULE } from './phases.js';
import { seasonTable, offeredIn, offeredLabel, gradeMeets, electiveKind, courseLevel, isUpper, isBachelor, BACHELOR } from './rules.js';
import { areasFor } from './gened.js';
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
// The most credits planned in a summer semester (summers are shorter; UVU runs fewer classes then).
const SUMMER_MAX = 9;
// opts (all optional):
//   extraCourses  catalog entries for prereqs outside the program (data/prereq-courses.json): those become
//                 "Needed first" boxes instead of being assumed done
//   gened         data/gened.json: an outside prereq on a Gen Ed list the program has a box for (MATH 1050 ->
//                 Quantitative Literacy) is planned in that box instead of as an extra class
//   seasons       data/seasons.json: which semesters each course is usually offered (a plan preference)
export function buildModel(program, opts = {}) {
  const units = [];
  const byCode = {};
  if (opts.extraCourses) program = { ...program, courses: { ...opts.extraCourses, ...(program.courses || {}) } };
  const courses = program.courses || {};
  const planIndex = gradPlanIndex(program.gradPlan || []);
  const planNamed = new Set((program.gradPlan || []).flatMap((t) => t.items.map((x) => x.code).filter(Boolean)));
  const back = backCoreqs(courses);
  const minPlanSem = (codes) => Math.min(99, ...codes.map((k) => planIndex[k] ?? 99));
  // codes required on their own (a course requirement), which elective lists of the same program can't count
  // again (a minor's required class may still fill a major's list: taken once, it counts for both)
  const reqCodes = new Set(program.requirements.filter((r) => r.type === 'course').flatMap((r) => [r.code, ...(r.alts || [])].map((c) => `${r.prog || ''}|${c}`)));
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
      const free = /general\s+education/i.test(r.area || '') ? null : electiveKind(r.label, r.area);
      units.push({ id: r.id ?? `ph:${i}`, kind: 'placeholder', label: r.label, title: r.text || '', credits: r.credits || 0, area: r.area, order: i, planSem: planIndex[r.label] ?? 99, prog: r.prog, ...(free ? { free, upperCr: upperOf(r.label, r.credits || 0, free) } : {}) });
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
    const keep = g._raw.filter((o) => !o.codes.every((c) => reqCodes.has(`${g.prog || ''}|${c}`)));
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
  addOutsidePrereqs(units, byCode, courses, opts.gened);
  const model = { program, units, byCode, seasons: opts.seasons ? (opts.seasons.of ? opts.seasons : seasonTable(opts.seasons)) : null };
  // choiceRemaining needs the whole program to count each finished class once; a free elective box counts
  // classes from outside the program
  for (const u of units) if (u.kind === 'choice' || u.free) Object.defineProperty(u, '_model', { value: model, enumerable: false });
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

// Upper-division credits a box stands for: an "upper" elective box all of it; "Any course 1000 or higher
// (9 credit hours must be upper division)" 9; anything else 0.
function upperOf(label, credits, kind) {
  if (kind === 'upper') return credits;
  const m = String(label || '').match(/(\d+)\s*(?:credits?|credit hours|hours)?\s*(?:must be|of which must be)\s*upper|(\d+) of which must be upper|including (\d+) (?:credits of )?upper/i);
  const n = m ? +(m[1] || m[2] || m[3]) : 0;
  return Math.min(credits, n);
}

// Prerequisites from outside the program (MATH 1050 before EE's MATH 1210) used to be assumed done. Now each
// becomes a "Needed first" course box (kind 'course', outside: true, neededFor: the classes that need it),
// unless the program has a Gen Ed box whose list holds it: then that box is planned first instead
// (afterUnits) and remembers the class (suggest). Only direct prerequisites of required courses, and only
// ones the catalog has an entry for; the new box's own prerequisites are not added (placement tests and
// earlier schooling usually cover them; the box can be tapped as "already have it").
function addOutsidePrereqs(units, byCode, courses, gened) {
  const all = new Set();
  for (const u of units) {
    for (const c of u.codes || []) all.add(c);
    for (const o of u.options || []) for (const c of [...o.codes, ...(o.alts || [])]) all.add(c);
  }
  const geBoxes = gened?.areas ? units.filter((u) => u.kind === 'placeholder' && /general\s+education/i.test(u.area || ''))
    .map((u) => ({ u, codes: new Set(areasFor(u.label).flatMap((k) => gened.areas.filter((a) => a.key === k).flatMap((a) => (a.courses || []).map((c) => c.code)))) }))
    .filter((b) => b.codes.size) : [];
  // "or higher": a class the program already covers with a higher course of the same subject that builds on
  // it (EE's MATH 1210 needs MATH 1050 + 1060 or MATH 1080), so "ECE 1000 needs MATH 1060" adds no box.
  // (Only through classes outside the program: MATH 1220 -> MATH 1210 -> MATH 1080 doesn't count, MATH
  // 1210's own box covers that.)
  const under = new Map(); // program course -> outside classes beneath it
  // (an honors twin, MATH 1210H, counts as the program's MATH 1210)
  const inAll = (k) => all.has(k) || all.has(k.replace(/(\d{4})[A-Z]+$/, '$1'));
  const beneathOf = (c) => {
    if (under.has(c)) return under.get(c);
    const seen = new Set();
    let front = [c];
    for (let d = 0; d < 4 && front.length; d++) {
      const next = [];
      for (const x of front) for (const k of [...codesOf(courses[x]?.prereqs), ...codesOf(courses[x]?.precoreqs)]) if (!inAll(k) && !seen.has(k)) { seen.add(k); next.push(k); }
      front = next;
    }
    under.set(c, seen);
    return seen;
  };
  const progCourses = units.filter((u) => u.kind === 'course').flatMap((u) => u.codes);
  const covered = (x, dep) => {
    const [subj, num] = [x.split(' ')[0], courseLevel(x)];
    return progCourses.some((c) => !dep.codes.includes(c) && c.split(' ')[0] === subj && courseLevel(c) > num && beneathOf(c).has(x));
  };
  const added = new Map();
  // codes: the alternatives (any one will do); group: every outside code of that "or" (MATH 1050 + 1060 or
  // MATH 1080): the box stands for all of them, so a missing one is no longer assumed done
  const need = (codes, dep, group = codes) => {
    if (codes.some((c) => covered(c, dep))) return;
    // (developmental classes below 1000, MAT 0920, are left to placement)
    const known = codes.filter((c) => courses[c] && courseLevel(c) >= 1000);
    if (!known.length) return;
    const ge = geBoxes.find((b) => known.some((c) => b.codes.has(c)));
    if (ge) {
      (dep.afterUnits ??= []).includes(ge.u.id) || dep.afterUnits.push(ge.u.id);
      const pick = known.find((c) => ge.codes.has(c));
      (ge.u.suggest ??= []).includes(pick) || ge.u.suggest.push(pick);
      (ge.u.suggestFor ??= []).includes(dep.code) || ge.u.suggestFor.push(dep.code);
      if (dep.planSem < 99) ge.u.planSem = Math.min(ge.u.planSem, Math.max(0, dep.planSem - 1));
      return;
    }
    let x = known.map((c) => added.get(c)).find(Boolean);
    if (!x) {
      const key = known[0];
      const c = courses[key];
      const codesAll = [...new Set([...known, ...group])];
      x = {
        id: key, kind: 'course', code: key, codes: codesAll, alts: known.slice(1), shown: known, label: key, title: c.title || '',
        credits: c.credits ?? 3, area: 'Needed first', order: dep.order - 0.5, outside: true, neededFor: [], neededCodes: [],
        prereqs: null, precoreqs: null, coreqs: [], planPrereqs: null, planPrecoreqs: null, planCoreqs: [], altPrereqs: {},
        repeat: 1, planCode: key, rowCredits: null, gates: Object.fromEntries(codesAll.map((k) => [k, []])), gate: null,
        minGrade: null, planSem: 99, prog: dep.prog,
      };
      for (const k of codesAll) added.set(k, x);
    }
    if (!x.neededFor.includes(dep.code)) x.neededFor.push(dep.code);
    for (const k of dep.codes) if (!x.neededCodes.includes(k)) x.neededCodes.push(k);
    if (dep.planSem < 99) x.planSem = Math.min(x.planSem, Math.max(0, dep.planSem - 1));
    x.order = Math.min(x.order, dep.order - 0.5);
  };
  const walk = (e, dep) => {
    if (!e) return;
    if (typeof e === 'string') { if (!all.has(e)) need([e], dep); return; }
    if (e.and) { e.and.forEach((x) => walk(x, dep)); return; }
    // "A or B" with one of them in the program: it waits for that one (as before)
    if (e.or.some((x) => codesOf(x).some((c) => all.has(c)))) return;
    const plain = e.or.filter((x) => typeof x === 'string');
    if (plain.length) need(plain, dep, codesOf(e)); else walk(e.or[0], dep);
  };
  for (const u of units.filter((x) => x.kind === 'course')) walk(u.prereqs, u);
  const extra = [...new Set(added.values())];
  // a lecture and its lab both from outside (CHEM 1210 + CHEM 1215) still go together, both ways
  for (const x of extra) {
    const cq = (courses[x.code]?.coreqs || []).filter((k) => added.has(k) && !x.codes.includes(k));
    for (const y of extra) if (y !== x && (courses[y.code]?.coreqs || []).some((k) => x.codes.includes(k)) && !cq.includes(y.code)) cq.push(y.code);
    x.coreqs = cq; x.planCoreqs = cq;
    // a box's own prerequisites order it after other boxes / program classes (MATH 1050 -> 1060 -> 1210);
    // ones outside everything stay assumed done
    const pre = (k) => stripCodes(courses[k]?.prereqs ?? null, x.codes);
    x.prereqs = x.planPrereqs = x.shown.length > 1 ? orAll(x.shown.map(pre)) : pre(x.code);
    x.altPrereqs = Object.fromEntries(x.shown.map((k) => [k, pre(k)]));
  }
  for (const x of extra) {
    units.push(x);
    for (const k of x.codes) byCode[k] ??= x;
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
  if (u.kind === 'placeholder') return completed.has(u.id) || (!!u.free && !!u._model && (electiveCover(u._model, completed).get(u.id) || 0) >= u.credits);
  if (u.kind === 'option') return optionDone(u, completed);
  // a "needed first" box is done once a class that needs it is (the student had it, or placed out)
  if (u.kind === 'course') return u.codes.some((c) => completed.has(c)) || (!!u.outside && u.neededCodes.some((c) => completed.has(c)));
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
  // one class, one requirement inside each program; a major and a minor may share it (combinePrograms)
  const used = new Set();
  const key = (prog, c) => `${prog || ''}|${c}`;
  for (const u of model.units) if (u.kind === 'course') { const c = u.codes.find((k) => completed.has(k)); if (c) used.add(key(u.prog, c)); }
  const groups = model.units.filter((u) => u.kind === 'choice');
  const codesOfOpt = (o) => [...o.codes, ...o.alts].filter((c) => completed.has(c));
  for (let gi = 0; gi < groups.length; gi++) {
    const h = groups[gi];
    const isUsed = (c) => used.has(key(h.prog, c));
    const cands = completed.has(h.id) ? [] : h.options.filter((o) => doneHere(o) && !codesOfOpt(o).some(isUsed));
    const later = (o) => groups.slice(gi + 1).filter((x) => x.options.some((p) => codesOfOpt(p).some((c) => codesOfOpt(o).includes(c)))).length;
    cands.sort((a, b) => later(a) - later(b));
    const take = [];
    let need = h.pick?.credits ? h.pick.credits : (h.pick?.count ?? 1);
    for (const o of cands) {
      if (need <= 0) break;
      if (codesOfOpt(o).some(isUsed)) continue;
      take.push(o); codesOfOpt(o).forEach((c) => used.add(key(h.prog, c)));
      need -= h.pick?.credits ? o.credits : 1;
    }
    if (h === g) return take;
  }
  return g.options.filter(doneHere);
}

// ---------- classes from outside the program -> free electives ----------
// Taken classes that no requirement of the program uses (an audit's other classes, a class from a major the
// student left) count toward the program's free elective boxes ("Elective", "Any course 1000 or higher"):
// upper-division boxes take 3000+ classes first, then the rest fill the others in catalog order.
// Credits: the catalog entry, else 3. Classes below 1000 don't count toward a degree.
// planned: extra classes the plan will add (its "Needed first" boxes), [{code, credits}].
// -> Map(box id -> credits covered); .outside = [{code, credits}] the classes counted (all of them).
export function outsideClasses(model, completed) {
  const used = new Set();
  for (const u of model.units) {
    if (u.kind === 'course') { if (!u.outside) u.codes.forEach((c) => used.add(c)); }
    else if (u.kind === 'choice') for (const o of u.options) [...o.codes, ...o.alts].forEach((c) => used.add(c));
  }
  const courses = model.program.courses || {};
  const out = [];
  for (const k of completed) {
    if (typeof k !== 'string' || used.has(k) || !/^[A-Z]{2,5} \d{4}[A-Z]{0,2}$/.test(k) || courseLevel(k) < 1000) continue;
    const c = courses[k];
    out.push({ code: k, credits: typeof c?.credits === 'number' && c.credits > 0 ? c.credits : 3 });
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}
export function electiveCover(model, completed, planned = []) {
  const pool = [...outsideClasses(model, completed), ...planned].map((x) => ({ ...x }));
  const boxes = model.units.filter((u) => u.kind === 'placeholder' && u.free && !completed.has(u.id));
  const map = new Map();
  const fill = (box, ok) => {
    let got = map.get(box.id) || 0;
    for (const x of pool) {
      if (got >= box.credits) break;
      if (x.credits <= 0 || !ok(x)) continue;
      const take = Math.min(x.credits, box.credits - got);
      got += take; x.credits -= take;
    }
    map.set(box.id, got);
  };
  for (const b of boxes.filter((x) => x.free === 'upper')) fill(b, (x) => isUpper(x.code));
  for (const b of boxes.filter((x) => x.free !== 'upper')) fill(b, () => true);
  map.outside = outsideClasses(model, completed);
  return map;
}

// ---------- grade minimums ----------
// The lowest grade a class may have to fill its requirement here (the requirement row, its list, or the
// track's "with a minimum C-"), or null.
export function minGradeFor(model, code) {
  for (const u of model.units) {
    if (u.kind === 'course' && u.codes.includes(code) && u.minGrade) return u.minGrade;
    if (u.kind === 'choice') {
      const o = u.options.find((x) => x.codes.includes(code) || x.alts.includes(code));
      if (o) { const g = o.minGrade ?? (o.section && u.trackGrades?.[o.section]) ?? u.minGrade; if (g) return g; }
    }
  }
  return null;
}
// Taken classes whose grade is below what their requirement needs: [{code, grade, min}]
export function belowMinimum(model, completed, grades = {}) {
  const out = [];
  for (const [code, grade] of Object.entries(grades || {})) {
    if (!completed.has(code)) continue;
    const min = minGradeFor(model, code);
    if (min && !gradeMeets(grade, min)) out.push({ code, grade, min });
  }
  return out;
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
//   grades     {code: grade} from an audit: a class below its requirement's minimum grade is planned again
//   seasons    data/seasons.json (default: the model's): a class is kept out of a semester it is never
//              offered in (when the history has that season); a preference, never a reason to leave a class out
//   summerMax  credits in a summer semester (default min(maxCredits, 9))
// Order of placement: the catalog's sample-plan semester first, then the longest prereq chain.
// Admission programs: "Before you apply" semesters -> Apply -> program semesters (plan.admission, planPhases).
export function makePlan(model, completed = new Set(), opts = {}) {
  const maxCredits = opts.maxCredits ?? 16;
  const summers = opts.summers ?? false;
  let term = opts.start ?? defaultStartTerm();
  const { units, byCode } = model;
  const courses = model.program.courses || {};
  // grade minimums: a class taken with too low a grade doesn't fill its requirement (taken again)
  const low = opts.grades ? belowMinimum(model, completed, opts.grades) : [];
  if (low.length) { completed = new Set(completed); for (const x of low) completed.delete(x.code); }
  const lowOf = new Map(low.map((x) => [x.code, x]));
  const seasons = opts.seasons ? (opts.seasons.of ? opts.seasons : seasonTable(opts.seasons)) : model.seasons;
  const summerMax = opts.summerMax ?? Math.min(maxCredits, SUMMER_MAX);
  // free elective boxes: classes from outside the program (taken, or "Needed first" boxes still to take) count
  const plannedOutside = units.filter((u) => u.outside && !unitDone(u, completed)).map((u) => ({ code: u.code, credits: u.credits }));
  const cover = electiveCover(model, completed, plannedOutside);
  // a minor's required class that is also an option of the major's list (or the other way): taken once, it
  // fills both (combinePrograms already drops what the major requires outright)
  const sharedCodes = new Set();
  for (const u of units) if (u.kind === 'course' && !u.outside && !unitDone(u, completed)) {
    if (units.some((g) => g.kind === 'choice' && !g.tracks && (g.prog || null) !== (u.prog || null) && g.options.some((o) => o.codes.length === 1 && u.codes.includes(o.codes[0])))) sharedCodes.add(u.planCode ?? u.code);
  }
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
      const cr = u.free ? Math.max(0, u.credits - (cover.get(u.id) || 0)) : u.credits;
      if (cr <= 0) continue;
      const ph = { ...u, credits: cr, unit: u, ...(u.suggest ? { title: `${u.suggest.join(' or ')} (needed for ${u.suggestFor.join(', ')})` } : {}) };
      const ch = chunksOf(cr);
      if (ch.length <= 1) todo.push(ph);
      else ch.forEach((c, k) => todo.push({ ...ph, id: `${u.id}#${k}`, credits: c, order: u.order + k / 100 }));
    } else if (u.kind === 'choice') {
      const mine = !u.tracks && sharedCodes.size ? u.options.filter((o) => o.codes.every((c) => sharedCodes.has(c))) : [];
      let left = choiceRemaining(u, mine.length ? new Set([...completed, ...mine.flatMap((o) => o.codes)]) : completed);
      if (left <= 0) continue;
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
  // seasons: a course/option is kept out of a term it was never offered in, unless it is never offered in any
  // season this plan uses (then the history can't help)
  let inSeason = false, skipped = 0;
  const planSeasons = summers ? ['Fall', 'Spring', 'Summer'] : ['Fall', 'Spring'];
  const seasonMemo = new Map();
  const seasonOk = (it, season) => {
    if (!(it.kind === 'course' || it.kind === 'option')) return true;
    const codes = it.kind === 'course' ? it.codes : it.codeList || it.codes;
    const k = `${codes.join('|')}@${season}`;
    if (!seasonMemo.has(k)) seasonMemo.set(k, offeredIn(seasons, codes, season) || !planSeasons.some((x) => offeredIn(seasons, codes, x)));
    return seasonMemo.get(k);
  };
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
    const cap = term.season === 'Summer' ? summerMax : maxCredits;
    const avail = (it) => {
      if (it.after && !placed.has(it.after)) return false;
      if (inSeason && !seasonOk(it, term.season)) return false;
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
      if (sem.credits + cr > cap) return false;
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
    early = sequenced; inSeason = !!seasons; fill();
    if (!sem.items.length && early) { early = false; fill(); }
    // nothing that is left is offered this term: skip it (the plan waits for the term the class runs in), at
    // most twice in a row; after that a class goes in anyway (the history is a preference, not a rule)
    if (!sem.items.length && inSeason && term.season !== 'Summer') {
      inSeason = false; fill();
      if (sem.items.length && skipped < 2 && sem.items.every((it) => !seasonOk(it, term.season))) {
        sem.items.length = 0; sem.credits = 0; skipped++;
        term = nextTerm(term, summers);
        continue;
      }
    }
    if (sem.items.length) skipped = 0;
    // a summer with nothing to take (nothing offered then, or nothing left that can go) is skipped
    if (!sem.items.length && term.season === 'Summer') { term = nextTerm(term, summers); continue; }
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
  for (const x of low) warnings.push(`${x.code}: a ${x.grade} is below the ${x.min} this requirement needs, so the plan takes it again`);
  const totals = degreeTotals(model, completed, semesters);
  const itemCodes = (it) => (it.kind === 'option' ? it.codeList : it.kind === 'course' ? [it.code] : []) || [];
  return {
    semesters: semesters.map((s) => ({ term: s.term, credits: s.credits, items: s.items.map((it) => {
      const out = {
        id: it.id, unitId: it.unitId ?? it.unit.id, kind: it.kind, code: it.code || null,
        codes: it.kind === 'option' ? it.codeList : it.kind === 'course' ? [it.code] : undefined,
        label: it.label, title: it.title, credits: it.credits,
        gate: isAdm(it) ? 'admission' : it.gate || null, minGrade: it.minGrade ?? null,
      };
      const off = itemCodes(it).length ? offeredLabel(seasons, itemCodes(it)) : null;
      if (off) out.offered = off;
      if (it.outside) out.neededFor = it.neededFor;
      if (it.kind === 'course' && lowOf.has(it.code)) out.retake = lowOf.get(it.code);
      if (it.kind === 'course' && sharedCodes.has(it.code)) out.shared = true;
      return out;
    }) })),
    creditsLeft: totalLeft,
    graduation: semesters.length ? semesters[semesters.length - 1].term : null,
    warnings,
    admission, standing: standingOut, tracks,
    totals, checks: totals.checks,
    // free elective credits filled by classes from outside the program (taken, or "Needed first" boxes)
    electiveCover: Object.fromEntries(cover),
  };
}

// A bachelor's degree needs 120 credits, 40 of them upper division (3000+). Counts what the student has
// finished (this program's classes + classes from outside it) and what the plan adds.
// -> { bachelor, credits, upper, checks: [short warning lines] }
export function degreeTotals(model, completed, semesters) {
  const bachelor = isBachelor(model.program);
  let credits = 0, upper = 0;
  const allUpper = (opts) => opts.length > 0 && opts.every((o) => o.codes.every(isUpper));
  // finished
  for (const u of model.units) {
    if (u.kind === 'course' && !u.outside) {
      const c = u.codes.find((k) => completed.has(k));
      if (c) { credits += u.credits; if (isUpper(c)) upper += u.credits; }
    } else if (u.kind === 'choice') {
      for (const o of countedOptions(u, completed)) { credits += o.credits; if (o.codes.every(isUpper)) upper += o.credits; }
      if (completed.has(u.id)) { const cr = u.pick?.credits ?? u.credits; credits += cr; if (allUpper(u.options)) upper += cr; }
    } else if (u.kind === 'placeholder' && completed.has(u.id)) {
      credits += u.credits; upper += u.upperCr || 0;
    }
  }
  for (const x of outsideClasses(model, completed)) { credits += x.credits; if (isUpper(x.code)) upper += x.credits; }
  // planned. upper = the least the plan gives (only what must be 3000+); upperMax = the most, when every
  // list / free elective with a 3000+ choice is filled with one
  let upperMax = upper;
  for (const s of semesters) for (const it of s.items) {
    credits += it.credits;
    if (it.kind === 'course' || it.kind === 'option') { if ((it.kind === 'option' ? it.codeList : [it.code]).every(isUpper)) { upper += it.credits; upperMax += it.credits; } }
    else if (it.kind === 'choice') {
      if (allUpper(it.options || [])) upper += it.credits;
      if ((it.options || []).some((o) => o.codes.every(isUpper))) upperMax += it.credits;
    } else if (it.kind === 'placeholder') {
      upper += Math.min(it.credits, it.unit?.upperCr ? it.unit.upperCr * it.credits / it.unit.credits : 0);
      if (it.unit?.free) upperMax += it.credits;
    }
  }
  credits = Math.round(credits * 10) / 10; upper = Math.round(upper); upperMax = Math.round(upperMax);
  const checks = [];
  if (bachelor && credits < BACHELOR.credits) checks.push(`This plan adds up to ${credits} credits; a bachelor's degree needs ${BACHELOR.credits}. Add ${Math.ceil(BACHELOR.credits - credits)} elective credits.`);
  if (bachelor && upperMax < BACHELOR.upper) checks.push(`Upper-division (3000+) credits: at most ${upperMax} of the ${BACHELOR.upper} a bachelor's degree needs. ${BACHELOR.upper - upperMax} more must be upper-division (electives count).`);
  else if (bachelor && upper < BACHELOR.upper) checks.push(`Upper-division (3000+) credits: ${upper} of ${BACHELOR.upper} are set. Pick 3000+ classes for at least ${BACHELOR.upper - upper} of your elective credits.`);
  return { bachelor, credits, upper, upperMax, checks };
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
  if (u.kind === 'course' && u.outside) {
    why = `Needed before ${u.neededFor.join(', ')}: a prerequisite from outside this program${u.shown.length > 1 ? ` (${u.shown.join(' or ')})` : ''}. Already have it or placed out? Mark it taken`;
  } else if (u.kind === 'course') {
    why = u.codes.length > 1 ? `Required (${area}): ${u.codes.join(' or ')}; any one counts` : `Required course (${area})`;
  } else if (o?.section && u.tracks) {
    why = `Part of the "${o.section}" track; ${u.label} (one track is required, ${area})`;
  } else {
    const pick = u.pick?.credits ? `${u.pick.credits} credits from the list` : `${u.pick?.count ?? 1} from the list`;
    why = `One of the options for "${u.label}" (${pick}, ${area})`;
  }
  if (gate === 'admission') why += '. Needs acceptance into the program first';
  else if (gate === 'advanced-standing') why += '. Needs University Advanced Standing';
  // a major + minor sharing the class: it counts once and fills both
  const shared = (model.program.shared || []).filter((x) => x.code === code).map((x) => x.name);
  const crossList = model.units.filter((g) => g !== u && (g.prog || null) !== (u.prog || null)
    && (g.kind === 'choice' ? g.options.some((o) => o.codes.length === 1 && o.codes[0] === code) : g.kind === 'course' && !g.outside && g.codes.includes(code)));
  const partName = (id) => (model.program.parts || []).find((p) => p.id === id)?.name;
  for (const g of crossList) { const n = partName(g.prog) || (g.prog ? null : partName((model.program.parts || [])[0]?.id)); if (n && !shared.includes(n)) shared.push(n); }
  if (shared.length) why += `. Counts once for both: also fills ${shared.join(', ')}`;
  const offered = offeredLabel(model.seasons, [code]);
  if (offered) why += `. ${offered} (UVU's class schedules, ${model.seasons.covered.size === 3 ? 'recent Fall, Spring and Summer terms' : 'recent terms'})`;
  const alsoIn = [...new Set(hits.slice(1).map((h) => h.u.label))].filter((l) => l !== u.label);
  return {
    unitId: u.id, kind: u.kind, label: u.label, area, credits: o ? o.credits : u.credits, why, alsoIn,
    gate, minGrade: (o ? o.minGrade : u.minGrade) ?? null, track: o?.section && u.tracks ? o.section : null,
    offered, shared, neededFor: u.outside ? u.neededFor : null,
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

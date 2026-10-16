// Smart Advisor planner: pure functions, used by the browser (js/app.js) and Node tests.
// Program JSON comes from scripts/fetch-program.mjs.

// ---------- model ----------
// Units are the things a student has to finish:
//   course      one required course (alts: any one of the codes counts)
//   choice      "complete one of" / "N credits from" a list (options may be shown as their own boxes)
//   option      a course inside a choice group (only built when the group has real prereqs)
//   placeholder a Gen Ed distribution or free elective with no fixed course
const MAX_OPTION_BOXES = 8;
export function buildModel(program) {
  const units = [];
  const byCode = {};
  const courses = program.courses || {};
  const planIndex = gradPlanIndex(program.gradPlan || []);
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
      const cq = coreqsOf([r.code], codes, courses);
      // an alternative's own "prereq or concurrent" courses count as prereqs when choosing it
      const altReq = (k) => k === r.code ? stripCodes(c.prereqs ?? null, [k]) : andAll([stripCodes(courses[k]?.prereqs ?? null, [k]), stripCodes(courses[k]?.precoreqs ?? null, [k])]);
      const u = {
        id: r.code, kind: 'course', code: r.code, codes, alts: r.alts || [],
        label: r.code, title: c.title || '', credits, area: r.area, order: i,
        prereqs, precoreqs: stripCodes(c.precoreqs ?? null, codes), coreqs: (c.coreqs || []).filter((k) => !codes.includes(k)),
        planPrereqs: known.length > 1 && repeat === 1 ? orAll(known.map((k) => stripCodes(altReq(k), codes))) : prereqs,
        planPrecoreqs: andAll([stripCodes(c.precoreqs ?? null, codes), cq.any]), planCoreqs: cq.all,
        altPrereqs: Object.fromEntries(codes.map((k) => [k, altReq(k)])),
        repeat,
        planSem: planIndex[r.code] ?? 99, prog: r.prog,
      };
      units.push(u);
      for (const k of u.codes) byCode[k] ??= u;
    } else if (r.type === 'placeholder') {
      units.push({ id: r.id ?? `ph:${i}`, kind: 'placeholder', label: r.label, title: r.text || '', credits: r.credits || 0, area: r.area, order: i, planSem: planIndex[r.label] ?? 99, prog: r.prog });
    } else if (r.type === 'choice') {
      const g = { id: r.id ?? `choice:${i}`, kind: 'choice', label: r.label, title: r.text || '', credits: r.credits || 0, pick: r.pick, area: r.area, order: i, options: [], planSem: planIndex[r.label] ?? 99, prog: r.prog };
      // "complete one of the following tracks": option.section names its track
      if (Array.isArray(r.tracks) && r.tracks.length > 1) g.tracks = r.tracks;
      units.push(g);
      g._raw = r.options;
    }
  });
  // Option courses become their own boxes only when they connect to the program's prereq graph, and only
  // for a short list (a 40-course elective list stays one box).
  for (const g of units.filter((u) => u.kind === 'choice')) {
    const opts = g._raw.map((o, k) => {
      const code = o.codes[0];
      const c = courses[code] || {};
      const own = [...o.codes, ...(o.alts || [])];
      const reqOf = (list) => andAll(list.map((x) => stripCodes(courses[x]?.prereqs ?? null, own)));
      const credits = o.credits ?? c.credits ?? 3;
      return {
        id: `${g.id}/${code}`, kind: 'option', group: g.id, code, codes: o.codes, alts: o.alts || [],
        label: o.codes.join(' + '), title: o.codes.map((x) => courses[x]?.title || '').filter(Boolean).join(' + '),
        credits, area: g.area, order: g.order + (k + 1) / 100,
        // an option "A or B" (alts) can be met by either one's prereqs
        prereqs: reqOf(o.codes), precoreqs: null, coreqs: [],
        planPrereqs: o.alts?.length && o.alts.some((x) => courses[x]) ? orAll([reqOf(o.codes), reqOf(o.alts.filter((x) => courses[x]))]) : reqOf(o.codes),
        // used only by the semester plan (the flowchart keeps options free of coreq links)
        planPrecoreqs: andAll([...o.codes.map((x) => stripCodes(courses[x]?.precoreqs ?? null, own)), coreqsOf(o.codes, own, courses).any]),
        planCoreqs: coreqsOf(o.codes, own, courses).all,
        section: o.section, repeat: o.codes.length === 1 ? repeatsOf(o, code, credits, courses) : 1,
        planSem: 99, prog: g.prog,
      };
    });
    delete g._raw;
    g.options = opts;
    g.showOptions = opts.length <= MAX_OPTION_BOXES && opts.some((o) => codesOf(o.prereqs).some((x) => byCode[x]));
  }
  const model = { program, units, byCode };
  computeDepths(model);
  return model;
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
  const doneOpts = g.options.filter((o) => optionDone(o, completed));
  if (g.pick?.credits) return Math.max(0, g.pick.credits - doneOpts.reduce((s, o) => s + o.credits, 0));
  const need = g.pick?.count ?? 1;
  if (doneOpts.length >= need) return 0;
  return Math.round((g.credits / need) * (need - doneOpts.length)) || g.credits;
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
export function makePlan(model, completed = new Set(), opts = {}) {
  const maxCredits = opts.maxCredits ?? 16;
  const summers = opts.summers ?? false;
  let term = opts.start ?? defaultStartTerm();
  const { units, byCode } = model;
  // completing any alt of a course (or of an "A or B" option) satisfies prereqs naming the others
  const done = haveSet(model, completed);

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
  const lastTake = new Map(); // a course listed twice (SW 4810R field placement): the second take comes later
  for (const u of units) {
    if (unitDone(u, completed)) continue;
    if (u.kind === 'course') {
      const prev = lastTake.get(u.id);
      if (prev && !/\dR$/.test(u.code)) continue; // listed twice but not repeatable: once is enough
      const id = prev ? `${u.id}#t${units.filter((x) => x.id === u.id).indexOf(u) + 1}` : u.id;
      lastTake.set(u.id, pushRepeats({ ...u, id, after: prev ?? null, prereqs: u.planPrereqs, precoreqs: u.planPrecoreqs, coreqs: prev ? [] : u.planCoreqs, unit: u }));
    }
    else if (u.kind === 'placeholder') {
      const ch = chunksOf(u.credits);
      if (ch.length <= 1) todo.push({ ...u, unit: u });
      else ch.forEach((c, k) => todo.push({ ...u, id: `${u.id}#${k}`, credits: c, unit: u, order: u.order + k / 100 }));
    } else if (u.kind === 'choice') {
      let left = choiceRemaining(u, completed);
      let optsLeft = u.options.filter((o) => !optionDone(o, completed));
      const track = pickTrack(u, completed, left);
      if (track) {
        // one track, required in full: its courses become real items (up to what the group needs)
        for (const o of optsLeft.filter((x) => x.section === track)) {
          if (left <= 0) break;
          pushRepeats({
            ...o, kind: 'option', unit: u, unitId: u.showOptions ? o.id : u.id, prereqs: o.planPrereqs,
            precoreqs: o.planPrecoreqs, coreqs: o.planCoreqs, codes: [...o.codes, ...o.alts], codeList: o.codes,
          });
          left -= o.credits;
        }
        optsLeft = optsLeft.filter((x) => !u.tracks.includes(x.section));
      }
      const opts2 = optsLeft.map((o) => ({ ...o, prereqs: o.planPrereqs }));
      if (left > 0) chunksOf(left).forEach((c, k) => todo.push({ id: `${u.id}#${k}`, kind: 'choice', label: u.label, title: u.title, credits: c, unit: u, order: u.order + k / 100, planSem: u.planSem, options: opts2 }));
    }
  }
  // courses this plan schedules (a track's courses count; other tracks' do not)
  const planCodes = new Set(Object.keys(byCode));
  for (const it of todo) for (const c of it.codes || []) planCodes.add(c);
  const inProgram = (c) => planCodes.has(c);
  const height = heights(model, todo);
  const warnings = [];
  const semesters = [];
  const placed = new Set();
  const sortKey = (a, b) => (height.get(b.id) - height.get(a.id)) || (a.planSem - b.planSem) || (a.order - b.order);

  while (todo.length && semesters.length < 40) {
    const before = new Set(done);
    const sem = { term: termLabel(term), items: [], credits: 0 };
    const avail = (it) => {
      if (it.after && !placed.has(it.after)) return false;
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
    let added = true;
    while (added) {
      added = false;
      const cands = todo.filter((it) => !sem.items.includes(it) && avail(it)).sort(sortKey);
      for (const it of cands) {
        // bundle a course with its not-yet-taken coreqs (lecture + lab) and with "prereq or corequisite"
        // courses not yet taken (BIOL 1610 + BIOL 1615 name each other: same semester)
        const bundle = [it];
        for (let i = 0; i < bundle.length && bundle.length < 8; i++) {
          const x = bundle[i];
          for (const c of x.coreqs || []) { const p = partnerOf(c, bundle); if (p) bundle.push(p); }
          const have = new Set(before);
          for (const y of [...sem.items, ...bundle]) (y.codes || []).forEach((c) => have.add(c));
          for (const c of missing(x.precoreqs, have)) { const p = partnerOf(c, bundle); if (p) bundle.push(p); }
        }
        if (!bundle.every(avail)) continue;
        const cr = bundle.reduce((s, x) => s + x.credits, 0);
        if (sem.credits + cr > maxCredits) continue;
        const now = new Set(before);
        for (const x of [...sem.items, ...bundle]) (x.codes || []).forEach((c) => now.add(c));
        if (!bundle.every((x) => coreqOk(x, now))) continue;
        sem.items.push(...bundle); sem.credits += cr; added = true;
        break; // re-sort after each pick
      }
    }
    if (!sem.items.length) {
      // nothing fits (credit cap smaller than a bundle, or a prereq loop): force the best one in
      const it = todo.filter((x) => !x.after || placed.has(x.after)).sort(sortKey)[0] || todo[0];
      warnings.push(`${it.label}: placed without its prerequisites or over the credit limit`);
      sem.items.push(it); sem.credits += it.credits;
    }
    for (const it of sem.items) {
      // "A or B" where A needs B: name the one that can be taken now
      if (it.kind === 'course' && it.altPrereqs && it.codes.length > 1 && !it.after && !(it.repeat > 1) && !evalReq(it.altPrereqs[it.code], before, inProgram)) {
        const ok = it.codes.find((c) => evalReq(it.altPrereqs[c], before, inProgram));
        if (ok) { it.code = ok; it.label = ok; it.title = model.program.courses?.[ok]?.title || it.title; }
      }
    }
    for (const it of sem.items) { todo.splice(todo.indexOf(it), 1); placed.add(it.id); (it.codes || []).forEach((c) => done.add(c)); }
    sem.items.sort((a, b) => (a.kind === 'course' ? 0 : 1) - (b.kind === 'course' ? 0 : 1) || String(a.label).localeCompare(String(b.label)));
    semesters.push(sem);
    term = nextTerm(term, summers);
  }
  const totalLeft = semesters.reduce((s, x) => s + x.credits, 0);
  return {
    semesters: semesters.map((s) => ({ term: s.term, credits: s.credits, items: s.items.map((it) => ({
      id: it.id, unitId: it.unitId ?? it.unit.id, kind: it.kind, code: it.code || null,
      codes: it.kind === 'option' ? it.codeList : it.kind === 'course' ? [it.code] : undefined,
      label: it.label, title: it.title, credits: it.credits,
    })) })),
    creditsLeft: totalLeft,
    graduation: semesters.length ? semesters[semesters.length - 1].term : null,
    warnings,
  };
}

// "Complete one of the following tracks": the track to plan. The one the student has the most credits in,
// then the cheapest (fewest credits to finish the group with it), then catalog order. null = no tracks.
export function pickTrack(g, completed, need = choiceRemaining(g, completed)) {
  if (!g.tracks) return null;
  const cands = g.tracks.map((t, k) => {
    const opts = g.options.filter((o) => o.section === t);
    const doneCr = opts.filter((o) => optionDone(o, completed)).reduce((s, o) => s + o.credits, 0);
    const leftCr = opts.filter((o) => !optionDone(o, completed)).reduce((s, o) => s + o.credits, 0);
    return { t, k, n: opts.length, doneCr, cost: Math.max(need, leftCr) };
  }).filter((x) => x.n);
  if (cands.length < 2) return null;
  cands.sort((a, b) => b.doneCr - a.doneCr || a.cost - b.cost || a.k - b.k);
  return cands[0].t;
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

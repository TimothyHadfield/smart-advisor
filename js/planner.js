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
      const u = {
        id: r.code, kind: 'course', code: r.code, codes: [r.code, ...(r.alts || [])], alts: r.alts || [],
        label: r.code, title: c.title || '', credits: r.credits ?? c.credits ?? 3, area: r.area, order: i,
        prereqs: c.prereqs ?? null, precoreqs: c.precoreqs ?? null, coreqs: c.coreqs || [],
        planSem: planIndex[r.code] ?? 99, prog: r.prog,
      };
      units.push(u);
      for (const k of u.codes) byCode[k] ??= u;
    } else if (r.type === 'placeholder') {
      units.push({ id: r.id ?? `ph:${i}`, kind: 'placeholder', label: r.label, title: r.text || '', credits: r.credits || 0, area: r.area, order: i, planSem: planIndex[r.label] ?? 99, prog: r.prog });
    } else if (r.type === 'choice') {
      const g = { id: r.id ?? `choice:${i}`, kind: 'choice', label: r.label, title: r.text || '', credits: r.credits || 0, pick: r.pick, area: r.area, order: i, options: [], planSem: planIndex[r.label] ?? 99, prog: r.prog };
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
      return {
        id: `${g.id}/${code}`, kind: 'option', group: g.id, code, codes: o.codes, alts: o.alts || [],
        label: o.codes.join(' + '), title: o.codes.map((x) => courses[x]?.title || '').filter(Boolean).join(' + '),
        credits: o.credits ?? c.credits ?? 3, area: g.area, order: g.order + (k + 1) / 100,
        prereqs: andAll(o.codes.map((x) => courses[x]?.prereqs ?? null)), precoreqs: null, coreqs: [],
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
  if (u.kind === 'course' || u.kind === 'option') return u.kind === 'option' ? u.codes.every((c) => completed.has(c)) : u.codes.some((c) => completed.has(c));
  if (u.kind === 'choice') return choiceRemaining(u, completed) <= 0;
  return false;
}
export function choiceRemaining(g, completed) {
  if (completed.has(g.id)) return 0;
  const doneOpts = g.options.filter((o) => o.codes.every((c) => completed.has(c)));
  if (g.pick?.credits) return Math.max(0, g.pick.credits - doneOpts.reduce((s, o) => s + o.credits, 0));
  const need = g.pick?.count ?? 1;
  if (doneOpts.length >= need) return 0;
  return Math.round((g.credits / need) * (need - doneOpts.length)) || g.credits;
}

// ---------- tapping classes taken ----------
// Codes a student has, with every alternative of a finished course counted ("ENGL 1005" covers ENGL 1010).
export function haveSet(model, completed) {
  const have = new Set(completed);
  for (const u of model.units) if (u.kind === 'course' && unitDone(u, completed)) u.codes.forEach((c) => have.add(c));
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
      const req = courses[c]?.prereqs ?? null;
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
export function defaultStartTerm(date = new Date()) {
  const m = date.getMonth(); // 0-based
  if (m <= 3) return { season: 'Fall', year: date.getFullYear() };
  return { season: 'Spring', year: date.getFullYear() + 1 };
}
export const termLabel = (t) => `${t.season} ${t.year}`;

// ---------- the plan ----------
// completed: Set of course codes and unit ids already finished.
export function makePlan(model, completed = new Set(), opts = {}) {
  const maxCredits = opts.maxCredits ?? 16;
  const summers = opts.summers ?? false;
  let term = opts.start ?? defaultStartTerm();
  const { units, byCode } = model;
  const inProgram = (c) => !!byCode[c];
  const done = new Set(completed);
  // completing any alt of a course satisfies prereqs naming the others
  for (const u of units) if ((u.kind === 'course') && unitDone(u, completed)) u.codes.forEach((c) => done.add(c));

  // work items
  const todo = [];
  for (const u of units) {
    if (unitDone(u, completed)) continue;
    if (u.kind === 'course') todo.push({ ...u, unit: u });
    else if (u.kind === 'placeholder') todo.push({ ...u, unit: u });
    else if (u.kind === 'choice') {
      let left = choiceRemaining(u, completed);
      const chunks = [];
      while (left > 0) { const c = left <= 4 ? left : 3; chunks.push(c); left -= c; }
      const optsLeft = u.options.filter((o) => !o.codes.every((c) => completed.has(c)));
      chunks.forEach((c, k) => todo.push({ id: `${u.id}#${k}`, kind: 'choice', label: u.label, title: u.title, credits: c, unit: u, order: u.order + k / 100, planSem: u.planSem, options: optsLeft }));
    }
  }
  const height = heights(model, todo);
  const warnings = [];
  const semesters = [];
  const sortKey = (a, b) => (height.get(b.id) - height.get(a.id)) || (a.planSem - b.planSem) || (a.order - b.order);

  while (todo.length && semesters.length < 30) {
    const before = new Set(done);
    const sem = { term: termLabel(term), items: [], credits: 0 };
    const avail = (it) => {
      if (it.kind === 'course') return evalReq(it.prereqs, before, inProgram);
      if (it.kind === 'choice') return !it.options.length || it.options.some((o) => evalReq(o.prereqs, before, inProgram));
      return true;
    };
    const coreqOk = (it, now) => (it.coreqs || []).every((c) => !inProgram(c) || now.has(c)) && evalReq(it.precoreqs, now, inProgram);
    let added = true;
    while (added) {
      added = false;
      const cands = todo.filter((it) => !sem.items.includes(it) && avail(it)).sort(sortKey);
      for (const it of cands) {
        // bundle a course with its not-yet-taken coreqs (lecture + lab)
        const bundle = [it];
        for (const c of it.coreqs || []) {
          const partner = todo.find((x) => x.kind === 'course' && x.codes.includes(c));
          if (partner && !sem.items.includes(partner) && !bundle.includes(partner)) bundle.push(partner);
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
      const it = todo.slice().sort(sortKey)[0];
      warnings.push(`${it.label}: placed without its prerequisites or over the credit limit`);
      sem.items.push(it); sem.credits += it.credits;
    }
    for (const it of sem.items) { todo.splice(todo.indexOf(it), 1); (it.codes || []).forEach((c) => done.add(c)); }
    sem.items.sort((a, b) => (a.kind === 'course' ? 0 : 1) - (b.kind === 'course' ? 0 : 1) || String(a.label).localeCompare(String(b.label)));
    semesters.push(sem);
    term = nextTerm(term, summers);
  }
  const totalLeft = semesters.reduce((s, x) => s + x.credits, 0);
  return {
    semesters: semesters.map((s) => ({ term: s.term, credits: s.credits, items: s.items.map((it) => ({ id: it.id, unitId: it.unit.id, kind: it.kind, code: it.code || null, label: it.label, title: it.title, credits: it.credits })) })),
    creditsLeft: totalLeft,
    graduation: semesters.length ? semesters[semesters.length - 1].term : null,
    warnings,
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

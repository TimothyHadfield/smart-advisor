// Smart Advisor schedule builder: pure functions, used by the browser (js/app.js) and Node tests.
// Section rows come from data/sections/<term>.json (scripts/fetch-sections.mjs documents the row keys);
// professor ratings from data/rmp.json profs, keyed by a section's `instr`.
//
// A course's "option" is what a student registers for to take it: one section, or a lecture + its
// linked lab ({ secs: [lecture, lab] }). A schedule picks one option (or none) per course.

// ---------- terms ----------
// Banner term codes: yyyy20 = Spring, yyyy30 = Summer, yyyy40 = Fall
const SEASON = { 20: 'Spring', 30: 'Summer', 40: 'Fall' };
export function termInfo(code) {
  const year = +String(code).slice(0, 4), season = SEASON[+String(code).slice(4)] || '?';
  return { code: String(code), season, year, label: `${season} ${year}`, short: `${season.slice(0, 2)} ${String(year).slice(2)}` };
}
/** The term in session (or about to start) on a date: Jan-Apr Spring, May-Jul Summer, Aug-Dec Fall. */
export function currentTermCode(date = new Date()) {
  const m = date.getMonth();
  return `${date.getFullYear()}${m <= 3 ? 20 : m <= 6 ? 30 : 40}`;
}
/** The next term after the current one that has data; else the newest one there is. */
export function defaultTerm(codes, date = new Date()) {
  const sorted = [...codes].map(String).sort();
  const cur = currentTermCode(date);
  return sorted.find((c) => c > cur) ?? sorted[sorted.length - 1] ?? null;
}

// ---------- sections ----------
export const toMin = (t) => (t && /^\d{4}$/.test(t) ? +t.slice(0, 2) * 60 + +t.slice(2) : null);
export function fmtTime(min, short = false) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${((h + 11) % 12) + 1}${short && !m ? '' : `:${String(m).padStart(2, '0')}`}`;
}
const DAYS = 'MTWRFSU';
/** Timed meetings, one per day: [{ day: 'T', s: 510, e: 585, sd, ed }]. Online / TBA parts have none. */
export function meetingsOf(sec) {
  const list = sec.meetings?.length ? sec.meetings : [sec];
  const out = [];
  for (const m of list) {
    const s = toMin(m.start), e = toMin(m.end);
    if (s == null || e == null || !m.days) continue;
    for (const day of m.days) if (DAYS.includes(day)) out.push({ day, s, e, sd: m.sd || sec.sd || '', ed: m.ed || sec.ed || '' });
  }
  return out;
}
/** High-school concurrent enrollment sections (part of term HSS / HSD / HSF ...) aren't open to UVU students. */
export const usable = (sec) => !/^HS/.test(sec.pt || '');
export const codeOf = (sec) => `${sec.subj} ${sec.num}`;
/** Usable sections by course code ("ECE 2250"). */
export function groupSections(rows) {
  const g = new Map();
  for (const r of rows || []) if (usable(r)) { const k = codeOf(r); if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
  return g;
}
/** "TR 8:30-9:45", "MWF 1-1:50" (first timed meeting; "+" when another meeting differs), or "Online" / "TBA". */
export function whenOf(sec) {
  const parts = (sec.meetings?.length ? sec.meetings : [sec]).filter((m) => m.days && m.start && m.end);
  if (!parts.length) return sec.mode === 'online' ? 'Online' : 'TBA';
  const p = parts[0];
  const extra = parts.slice(1).filter((m) => m.start !== p.start || m.end !== p.end).length ? '+' : '';
  const days = [...new Set(parts.filter((m) => m.start === p.start && m.end === p.end).map((m) => m.days).join(''))].join('');
  return `${days} ${fmtTime(toMin(p.start), true)}-${fmtTime(toMin(p.end))}${extra}`;
}

const overlap = (a, b) => a.day === b.day && a.s < b.e && b.s < a.e && (!a.sd || !b.ed || a.sd <= b.ed) && (!b.sd || !a.ed || b.sd <= a.ed);
function meetsConflict(ma, mb) {
  for (const a of ma) for (const b of mb) if (overlap(a, b)) return true;
  return false;
}
const optMeetings = (o) => (o._m ??= o.secs.flatMap(meetingsOf));
export const optionsConflict = (a, b) => meetsConflict(optMeetings(a), optMeetings(b));

const isLab = (s) => s.kind === 'Laboratory';
/**
 * A course's options. Sections with a Banner `link` id need one lecture + one lab: paired by equal link id
 * when the ids pair up that way, else any lab with any lecture. A pair that clashes with itself is dropped.
 */
export function courseOptions(sections) {
  const linked = sections.filter((s) => s.link);
  const solo = sections.filter((s) => !s.link).map((s) => ({ secs: [s] }));
  const lecs = linked.filter((s) => !isLab(s)), labs = linked.filter(isLab);
  if (!lecs.length || !labs.length) return [...solo, ...linked.map((s) => ({ secs: [s] }))];
  const byValue = lecs.some((a) => labs.some((b) => a.link === b.link));
  const pairs = [];
  for (const a of lecs) for (const b of labs) {
    if (byValue && a.link !== b.link) continue;
    const o = { secs: [a, b] };
    if (!meetsConflict(meetingsOf(a), meetingsOf(b))) pairs.push(o);
  }
  return [...solo, ...pairs];
}

// ---------- preferences + ranking ----------
// days: allowed meeting days · after / before: "0900" start no earlier / end no later (null = any)
// gaps: pack classes together (fewer days, short gaps) · rmp: prefer higher-rated professors
// mode: 'any' | 'person' | 'online' · main: Main Campus · wait: allow full sections (wait list)
// (mode starts at in person: with "any", sections with no meeting times always look best for gaps and days)
export const DEFAULT_PREFS = { days: 'MTWRF', after: null, before: null, gaps: true, rmp: true, mode: 'person', main: true, wait: false };
const SKIP = 10000;        // a course left out of the schedule
const UNRATED = 3.2;       // professors with no rating count as about average

export function rmpHue(r) {
  if (r == null || Number.isNaN(+r)) return null;
  return Math.round(Math.min(1, Math.max(0, (r - 2.5) / 2)) * 120);
}
const remote = (s) => s.mode === 'online' || s.mode === 'livestream';
function optionCost(o, p, rmp) {
  let c = 0;
  const after = toMin(p.after), before = toMin(p.before);
  for (const s of o.secs) {
    for (const m of meetingsOf(s)) {
      if (!(p.days ?? DEFAULT_PREFS.days).includes(m.day)) c += 60;
      if (after != null && m.s < after) c += (after - m.s) * 0.5;
      if (before != null && m.e > before) c += (m.e - before) * 0.5;
    }
    if (p.mode === 'person') c += remote(s) ? 40 : s.mode === 'hybrid' ? 15 : 0;
    if (p.mode === 'online') c += s.mode === 'in person' ? 40 : s.mode === 'hybrid' ? 15 : 0;
    if (p.main !== false && s.campus && s.campus !== 'Main Campus') c += 30;
    if (p.rmp !== false) c += (5 - (rmp?.[s.instr]?.r ?? UNRATED)) * 8;
    if (s.seats <= 0) c += 25 + (s.wait || 0);
  }
  return c;
}
// "avoid gaps": each day on campus costs 3, each gap between classes (past 15 minutes) 0.15 a minute.
// Read from a week's slot mask, fast enough to run at every finished schedule in the search.
function packCostMask(m) {
  let c = 0;
  for (let d = 0; d < 7; d++) {
    let first = -1, gapCost = 0, run = 0;
    for (let b = d * 288; b < d * 288 + 288; b++) {
      if (m[b >> 5] & (1 << (b & 31))) {
        if (first < 0) first = b;
        else if (run) { const mins = run * 5; if (mins > 15) gapCost += (mins - 15) * 0.15; }
        run = 0;
      } else if (first >= 0) run++;
    }
    if (first >= 0) c += 3 + gapCost;
  }
  return c;
}
// a week in 5-minute slots (7 x 288 bits): a quick test before the exact (date-aware) one
const WORDS = 63;
function optMask(o) {
  if (o._mask) return o._mask;
  const m = new Uint32Array(WORDS);
  for (const x of optMeetings(o)) {
    const base = DAYS.indexOf(x.day) * 288;
    for (let b = base + Math.floor(x.s / 5); b < base + Math.ceil(x.e / 5); b++) m[b >> 5] |= 1 << (b & 31);
  }
  return (o._mask = m);
}
const sig = (o) => o.secs.map((s) => `${s.mode}|${s.campus}|${s.seats > 0}|` + meetingsOf(s).map((m) => `${m.day}${m.s}-${m.e}@${m.sd}`).join(',')).join('/');

/**
 * Best schedules for courses [{ code, sections }], best first:
 *   [{ picks: [option | null per course], cost, crns: [...], unplaced: [codes] }]
 * opts.pins = { code: crn } keeps that section; opts.limit = how many to keep (20).
 * Full sections only with prefs.wait. Options at the same times keep only their best (e.g. top-rated) one.
 */
export function buildSchedules(courses, prefs = DEFAULT_PREFS, rmp = {}, opts = {}) {
  const p = { ...DEFAULT_PREFS, ...prefs };
  const limit = opts.limit ?? 20, pins = opts.pins || {};
  const prepared = courses.map((c, idx) => {
    let list = courseOptions(c.sections || []);
    if (pins[c.code]) list = list.filter((o) => o.secs.some((s) => s.crn === pins[c.code]));
    if (!p.wait && !pins[c.code]) list = list.filter((o) => o.secs.every((s) => s.seats > 0));
    const best = new Map();
    for (const o of list) {
      const x = { secs: o.secs, cost: optionCost(o, p, rmp) };
      const k = sig(o), cur = best.get(k);
      if (!cur || x.cost < cur.cost || (x.cost === cur.cost && x.secs[0].crn < cur.secs[0].crn)) best.set(k, x);
    }
    const sorted = [...best.values()].sort((a, b) => a.cost - b.cost || (a.secs[0].crn < b.secs[0].crn ? -1 : 1));
    return { idx, code: c.code, opts: sorted, min: sorted.length ? sorted[0].cost : SKIP };
  });
  // fewest options first: small branching near the root
  const order = prepared.slice().sort((a, b) => a.opts.length - b.opts.length);
  const restMin = order.map((_, i) => order.slice(i).reduce((s, c) => s + c.min, 0));
  const kept = [];
  const seen = new Set();
  const worst = () => (kept.length >= limit ? kept[kept.length - 1].cost : Infinity);
  // a finished schedule's full cost: its options + left-out courses + days/gaps
  const total = (picks) => {
    let c = 0;
    const m = new Uint32Array(WORDS);
    for (const o of picks) {
      if (!o) { c += SKIP; continue; }
      c += o.cost;
      const om = optMask(o);
      for (let w = 0; w < WORDS; w++) m[w] |= om[w];
    }
    return Math.round((c + (p.gaps ? packCostMask(m) : 0)) * 10) / 10;
  };
  const keep = (picks, cost) => {
    if (cost >= worst()) return;
    const crns = picks.filter(Boolean).flatMap((o) => o.secs.map((s) => s.crn));
    const key = crns.join(' ');
    if (seen.has(key)) return;
    seen.add(key);
    const unplaced = picks.map((o, k) => (o ? null : courses[k].code)).filter(Boolean);
    kept.push({ picks, cost, crns, unplaced });
    kept.sort((a, b) => a.cost - b.cost);
    if (kept.length > limit) seen.delete(kept.pop().crns.join(' '));
  };
  let nodes = 0;
  const chosen = new Array(order.length).fill(null);
  const NODE_LIMIT = opts.nodes ?? 12000; // search steps; keeps a phone responsive with many big courses
  // occ[i] = the slots used by the options chosen before course i
  const occ = Array.from({ length: order.length + 1 }, () => new Uint32Array(WORDS));
  const fitsAt = (i, o) => {
    const m = optMask(o), u = occ[i];
    let hit = false;
    for (let w = 0; w < WORDS; w++) if (m[w] & u[w]) { hit = true; break; }
    if (!hit) return true;
    for (let k = 0; k < i; k++) if (chosen[k] && optionsConflict(chosen[k], o)) return false;
    return true;
  };
  const walk = (i, cost) => {
    if (++nodes > NODE_LIMIT) return;
    if (cost + (restMin[i] ?? 0) >= worst()) return;
    if (i === order.length) {
      const picks = new Array(courses.length).fill(null);
      order.forEach((c, k) => { picks[c.idx] = chosen[k]; });
      keep(picks, Math.round((cost + (p.gaps ? packCostMask(occ[i]) : 0)) * 10) / 10);
      return;
    }
    const c = order[i];
    let fits = 0;
    for (const o of c.opts) {
      if (!fitsAt(i, o)) continue;
      fits++;
      chosen[i] = o;
      const m = optMask(o), u = occ[i], v = occ[i + 1];
      for (let w = 0; w < WORDS; w++) v[w] = u[w] | m[w];
      walk(i + 1, cost + o.cost);
      chosen[i] = null;
      if (nodes > NODE_LIMIT) return;
    }
    // left out only when none of its options fit around the courses already placed
    if (!fits) { occ[i + 1].set(occ[i]); walk(i + 1, cost + SKIP); }
  };
  walk(0, 0);
  // The search stops early on big course lists, and days/gaps only count once a schedule is finished,
  // so polish each one found: swap one course's option at a time while that lowers the cost.
  const fitsWith = (picks, j, o) => picks.every((q, k) => k === j || !q || !optionsConflict(q, o));
  for (const start of kept.slice()) {
    const picks = start.picks.slice();
    let cost = start.cost, better = true, rounds = 0;
    while (better && rounds++ < 6) {
      better = false;
      for (let j = 0; j < picks.length; j++) {
        for (const o of prepared[j].opts) {
          if (o === picks[j] || !fitsWith(picks, j, o)) continue;
          const was = picks[j];
          picks[j] = o;
          const c = total(picks);
          if (c < cost) { cost = c; better = true; } else picks[j] = was;
        }
      }
    }
    if (cost < start.cost) keep(picks.slice(), cost);
  }
  return { list: kept, options: prepared.map((c) => c.opts.length) };
}

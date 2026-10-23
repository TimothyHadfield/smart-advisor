// Classes section, Hypothetical | Actual, grades and GPA. Pure: no DOM (js/app.js draws it; tests/classes.test.mjs).
//
// Saved state (js/app.js; per program like done/grades):
//   done[major]            ACTUAL classes: what the audit import found and what the student added in Classes
//                          (course codes, also ones outside the program; Gen Ed box ids + "<box>=<code>" picks)
//   grades[major]          { key: grade } for any class ("A-", "TCR", "IP" = in progress, "" = none). Grades are
//                          facts about a class: a tap never deletes one.
//   settings.src[major]    { key: 'audit' | 'added' } where an actual class came from (missing = 'added': the
//                          student marked it, as taps did before Hypothetical existed)
//   settings.hypo[major]   { add: [keys], del: [keys] } flowchart taps on top of the actual classes:
//                          add = tapped on, del = an actual class tapped off (hidden, never deleted)
// Both settings keys sync through js/sync.js SETTINGS (no new doc fields, so firestore.rules stay the same).

import { unitDone, optionDone, choiceRemaining } from './planner.js';
import { pickedOf } from './gened.js';
import { pickLabel } from './uistate.js';

// grades the class sheet / Classes offer (IP is a status, not a grade). TR = transfer, AP or test credit.
export const GRADES = ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'E', 'P', 'TR'];
// UVU's 4.0 scale (catalog "Grading"); E (and F, UW from older records) count 0
export const POINTS = { A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7, 'C+': 2.3, C: 2, 'C-': 1.7, 'D+': 1.3, D: 1, 'D-': 0.7, E: 0, F: 0, UW: 0 };

// ---------- Hypothetical | Actual ----------
const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
/** hypo without entries that no longer change anything (a tap that is now actual, a hidden class now gone). */
export function normHypo(actual, hypo) {
  return { add: [...new Set(list(hypo?.add))].filter((k) => !actual.has(k)), del: [...new Set(list(hypo?.del))].filter((k) => actual.has(k)) };
}
export const hasHypo = (hypo) => !!hypo && (list(hypo.add).length > 0 || list(hypo.del).length > 0);
/**
 * The Hypothetical | Actual toggle shows once a tap changed something, or once the student tapped this visit
 * (so re-selecting a class, which leaves no change, stays in Hypothetical). On Hypothetical the chart is a
 * sandbox (Tim, 2026-10-22: "if it's hypothetical, none of your personal info should be shown"): no
 * in-progress look, grades, audit dates, GPA or audit nags; every selected class is plain Taken.
 */
export const hypoShown = (hypo, tapped) => hasHypo(hypo) || !!tapped;
export const sandboxOn = (hypo, tapped, view) => view !== 'actual' && hypoShown(hypo, tapped);
/** The classes counted in a view: 'actual' = actual only; 'hypo' = actual minus hidden plus tapped. */
export function viewSet(actual, hypo, view) {
  if (view === 'actual') return new Set(actual);
  const h = normHypo(actual, hypo);
  const out = new Set([...actual].filter((k) => !h.del.includes(k)));
  for (const k of h.add) out.add(k);
  return out;
}
/** The taps that turn the actual classes into `effective` (what the flowchart shows after a tap). */
export function hypoFrom(actual, effective) {
  return { add: [...effective].filter((k) => !actual.has(k)), del: [...actual].filter((k) => !effective.has(k)) };
}
/** Where a class in the view came from. */
export const srcOf = (key, actual, src) => (actual.has(key) ? (src?.[key] === 'audit' ? 'audit' : 'added') : 'tap');

// ---------- grades ----------
const up = (g) => String(g ?? '').toUpperCase();
const isTransfer = (g) => /^T/.test(up(g)) || up(g) === 'CR';
/** 'ip' (in progress), 'apce' (transfer / AP / concurrent / test credit) or 'taken'. */
export function statusOf(grade) {
  if (up(grade) === 'IP') return 'ip';
  return isTransfer(grade) ? 'apce' : 'taken';
}
// one grade for several classes: IP if any is in progress; else the LOWEST letter; else the first mark
function combine(gs) {
  const have = gs.filter((g) => g);
  if (!have.length) return '';
  if (have.some((g) => up(g) === 'IP')) return 'IP';
  const letters = have.filter((g) => up(g) in POINTS);
  if (letters.length) return letters.reduce((a, b) => (POINTS[up(b)] < POINTS[up(a)] ? b : a));
  return have[0];
}
/**
 * The grade a flowchart box shows ('' none). A folded lecture + lab box: the lower of the two grades
 * (one graded part: that one). A pick-one box: the option taken. A Gen Ed box: the class picked from its list.
 * Boxes tapped as a whole fall back to the box's own grade (older audit imports put it there).
 */
export function boxGrade(n, completed, grades) {
  const g = (k) => grades?.[k] ?? '';
  if (n.kind === 'course' || n.kind === 'option') {
    const parts = [n, ...(n.labs || [])].map((u) => {
      const took = (u.codes || [u.code]).filter((c) => completed.has(c));
      return combine((took.length ? took : u.codes || []).map(g));
    });
    return combine(parts);
  }
  if (n.kind === 'choice') {
    const o = (n.options || []).find((x) => optionDone(x, completed));
    const own = o ? combine([...o.codes, ...(o.alts || [])].filter((c) => completed.has(c)).map(g)) : '';
    return own || g(n.id);
  }
  const code = pickedOf(completed, n.id);
  return (code && g(code)) || g(n.id);
}
/** GPA of graded rows ({grade, credits}), credit weighted, 2 decimals; null when nothing is graded. */
export function gpa(rows) {
  let pts = 0, cr = 0;
  for (const r of rows) {
    const g = up(r.grade);
    if (!(g in POINTS) || !(r.credits > 0)) continue;
    pts += POINTS[g] * r.credits;
    cr += r.credits;
  }
  return { gpa: cr ? Math.round((pts / cr) * 100) / 100 : null, credits: Math.round(cr * 10) / 10 };
}

// ---------- the Classes section ----------
export const GROUPS = [['taken', 'Taken'], ['apce', 'AP/CE'], ['ip', 'Current'], ['need', 'Still need'], ['other', 'Not used by your plan']];
const byCode = (a, b) => String(a.code || a.label).localeCompare(String(b.code || b.label), 'en', { numeric: true });
/**
 * The classes for the chosen program(s), grouped. Each row: { key, code, label, title, credits, grade, status,
 * src: 'audit'|'added'|'tap', unit } (unit = the requirement it fills; Still need rows: { unit, label, title,
 * credits, when }). catalog: { code: {title, credits} } for classes outside the program.
 * order: Map unit id -> planned semester index (Still need sorted by it); when: index -> "Sp 27".
 */
export function classGroups({ model, completed, actual, grades = {}, src = {}, catalog = {}, order = null, when = null }) {
  const courses = model.program.courses || {};
  const units = model.units;
  const unitById = new Map(units.map((u) => [u.id, u]));
  const optUnit = new Map();
  for (const u of units) if (u.kind === 'choice') for (const o of u.options) for (const c of [...o.codes, ...(o.alts || [])]) if (!optUnit.has(c)) optUnit.set(c, u);
  const info = (c) => courses[c] || catalog[c] || {};
  const out = Object.fromEntries(GROUPS.map(([k]) => [k, []]));
  // a class picked for a box shows once, as the box's row
  const seen = new Set([...completed].filter((k) => typeof k === 'string' && k.includes('=') && completed.has(k.split('=')[0])).map((k) => k.slice(k.indexOf('=') + 1)));
  const put = (row, used) => {
    const st = statusOf(row.grade);
    out[st === 'taken' && !used ? 'other' : st].push(row);
  };
  for (const key of completed) {
    if (typeof key !== 'string' || key.includes('=')) continue;
    const u = unitById.get(key);
    if (u && (u.kind === 'placeholder' || u.kind === 'choice')) {
      // a Gen Ed / elective box marked as a whole: the class picked from its list, else the box
      const code = pickedOf(completed, key);
      const c = code ? info(code) : {};
      put({ key, code, label: code || u.label, title: code ? c.title || u.label : u.title || '', credits: c.credits ?? u.pick?.credits ?? u.credits ?? null, grade: (code && grades[code]) || grades[key] || '', src: srcOf(key, actual, src), unit: key }, true);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const cu = model.byCode[key] || optUnit.get(key);
    const c = info(key);
    put({ key, code: key, label: key, title: c.title || '', credits: c.credits ?? null, grade: grades[key] || '', src: srcOf(key, actual, src), unit: cu ? (model.byCode[key] ? cu.id : key) : null }, !!cu);
  }
  // still needed: requirements not finished in this view (a pick-N list: one row with what's left)
  for (const u of units) {
    if (unitDone(u, completed)) continue;
    const row = u.kind === 'course'
      ? { unit: u.id, code: u.code, label: u.code, title: u.title || info(u.code).title || '', credits: u.credits }
      : u.kind === 'choice'
        ? { unit: u.id, code: null, label: u.label, title: pickLabel(u.pick), credits: choiceRemaining(u, completed) }
        : { unit: u.id, code: null, label: u.label, title: u.title || '', credits: u.credits || null };
    const i = order?.get(u.id);
    row.sem = i ?? 99;
    row.when = i != null && when ? when(i) : '';
    row.order = u.order ?? 0;
    out.need.push(row);
  }
  for (const k of ['taken', 'apce', 'ip', 'other']) out[k].sort(byCode);
  out.need.sort((a, b) => a.sem - b.sem || a.order - b.order);
  return GROUPS.map(([key, label]) => ({ key, label, rows: out[key] }));
}

/** An open Gen Ed box (placeholder) whose class list has `code`, or null. listOf(box) -> genEdList result. */
export function geBoxFor(code, boxes, listOf, completed) {
  for (const b of boxes) {
    if (b.kind !== 'placeholder' || completed.has(b.id)) continue;
    const l = listOf(b);
    if (l?.groups?.some((g) => g.courses.some((c) => c.code === code || (c.alts || []).includes(code)))) return b.id;
  }
  return null;
}

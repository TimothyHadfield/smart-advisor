// "Fill my application": an answer sheet for a program's matriculation application, built from the
// student's Wolverine Track audit, in the real form's order (data/applications.json). Pure: no DOM.
// Used by js/app.js (the Matriculation sheet's "Fill my application") and tests/application.test.mjs.
// Tim, 2026-10-23: "what if the Cite automatically filled in your applicatoin based on the wolverine track that
// the student uploaded and then gave them links to where to submit it and whatnot?"
// The site never fills or sends the real form (UVU's Adobe Sign form starts on UVU's page): it only shows the
// answers to copy. Everything here stays on the device.

import { gradeMeets } from './rules.js';
import { uvuEmail } from './sources.js';

// ---------- extra audit facts (read at import, kept on this device only: never synced) ----------
// -> { first, last, uvid, gpa, sources: { 'MATH 1210': { course: 'AP Calculus BC', inst: 'College Board' } } }
//   name   "Student name Doe, Jane Q"            -> first 'Jane', last 'Doe'
//   uvid   "Student ID 10012345"                 (8 digits; absent = the student types it)
//   gpa    "Overall GPA 3.50"
//   source the "Satisfied by" line under a transfer / test-credit row:
//          "Satisfied by: AP MCBC0000 - Calculus BC - Adv Pl - Calculus BC (4)"  -> AP Calculus BC · College Board
//          "Satisfied by MATH 1220 - Calculus II - Salt Lake Community College"  -> MATH 1220 Calculus II · Salt Lake ...
const TEST_INST = { AP: 'College Board', CLEP: 'College Board', IB: 'International Baccalaureate', DSST: 'Prometric (DSST)' };
const ROW_CODE = /(?<![A-Za-z])([A-Z]{2,5}) ?-?(\d{4}[A-Z]?)(?![\d:@])/g;
export function auditExtras(text) {
  const src = String(text || '').replace(/ /g, ' ').replace(/\r/g, '');
  const out = { sources: {} };
  const nm = src.match(/Student\s+name:?\s+([^,\n]+?),\s*([^\n]+?)(?:\s{2,}|\s+Student\s+ID|\n|$)/i);
  if (nm) { out.last = nm[1].trim(); out.first = nm[2].trim().split(/\s+/)[0]; }
  const id = src.match(/Student\s+ID:?\s+(\d{8})\b/i) || src.match(/\bUVID:?\s+(\d{8})\b/i);
  if (id) out.uvid = id[1];
  const g = src.match(/Overall\s+GPA:?\s+(\d\.\d{1,3})/i);
  if (g) out.gpa = g[1];
  let row = null; // the code of the course row right above
  for (const line of src.split('\n')) {
    const sat = line.match(/^\s*Satisfied\s+by:?\s+(.+)$/i);
    if (sat && row) {
      const s = sourceOf(sat[1]);
      if (s && !out.sources[row]) out.sources[row] = s;
      continue;
    }
    if (sat) continue;
    const codes = [...line.matchAll(ROW_CODE)].filter((m) => !/^(FALL|SPRING|SUMMER|GPA|ID|UVID)$/.test(m[1]));
    // a course row has a grade after its code; header lines repeat the student's name, not a code
    if (codes.length && /(?:^|\s)(?:T[A-Z]{0,2}[+-]?|[A-E][+-]?|P|CR|IP)\s+\(?\d/.test(line)) row = `${codes[codes.length - 1][1]} ${codes[codes.length - 1][2]}`;
    else if (codes.length) row = null;
  }
  return out;
}
function sourceOf(s) {
  const parts = s.split(/\s+-\s+/).map((x) => x.replace(/\s*\(\d+(?:\.\d+)?\)\s*$/, '').trim());
  const test = parts[0].match(/^(AP|CLEP|IB|DSST)\b/i);
  if (test) {
    const kind = test[1].toUpperCase();
    return parts[1] ? { course: `${kind} ${parts[1]}`, inst: TEST_INST[kind] } : null;
  }
  // "MATH 1220 - Calculus II - Salt Lake Community College"
  if (parts.length >= 3) return { course: `${parts[0]} ${parts[1]}`.trim(), inst: parts[parts.length - 1] };
  if (parts.length === 2) return { course: parts[0], inst: parts[1] };
  return null;
}

// "Jane Q Doe" -> { first: 'Jane', last: 'Doe' }
export function splitName(name) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return { first: '', last: '' };
  if (w.length === 1) return { first: w[0], last: '' };
  return { first: w[0], last: w[w.length - 1] };
}

// the page's advisor / mentor for a last name's first letter: [{from, to, name}] -> { band: 'A–H', name } | null
export function byLetter(bands, last) {
  const c = String(last || '').trim().charAt(0).toUpperCase();
  if (!c || !Array.isArray(bands)) return null;
  const b = bands.find((x) => c >= x.from && c <= x.to);
  return b ? { band: `${b.from}–${b.to}`, name: b.name || null } : null;
}

// ---------- deadline: N weeks before the next semester starts ----------
// terms = { '202720': '2027-01-11' } (first class day, data/applications.json) -> { date, term, start } | null
const SEASON = { 20: 'Spring', 30: 'Summer', 40: 'Fall' };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function nextDeadline(terms, weeksBefore, today = new Date()) {
  if (!weeksBefore || !terms) return null;
  const now = ymd(today);
  for (const [code, start] of Object.entries(terms).sort((a, b) => a[1].localeCompare(b[1]))) {
    const [y, m, d] = start.split('-').map(Number);
    const due = ymd(new Date(y, m - 1, d - 7 * weeksBefore));
    if (due >= now) return { date: due, start, term: `${SEASON[code.slice(4)] || ''} ${code.slice(0, 4)}`.trim() };
  }
  return null;
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const niceDate = (s) => { const [y, m, d] = String(s).split('-').map(Number); return y ? `${MON[m - 1]} ${d}, ${y}` : ''; };
const usDate = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;

// ---------- one class's state on the form ----------
// 'ok' (C or better, or transfer/pass credit), 'ip' (in progress), 'low' (below the minimum), 'missing'
export function courseStatus(code, { done = new Set(), grades = {}, minGrade = 'C' } = {}) {
  const g = grades[code] || '';
  if (g === 'IP') return 'ip';
  if (!done.has(code) && !g) return 'missing';
  if (/^(F|E|W|UW|WF|NC|U|I)$/.test(g)) return 'low';
  return gradeMeets(g, minGrade || 'C') ? 'ok' : 'low';
}

// ---------- the answer sheet ----------
// app = data/applications.json programs[id] · typical = its `fields` (forms nobody has read yet)
// before = the catalog's matriculation classes (js/matric.js) · student = { first, last, uvid, gpa,
// sources } · done / grades / when = the student's classes, grades ('IP' = in progress) and terms
// -> { known, fields: [{label, value, own}], columns, rows: [{code, term, grade, course, inst, status}],
//      also: [{code, status}], rowNote, ready: { courses, gpa, minGpa, gpaOk, deadline }, advisor, mentor }
//   own = the student types it (phone, address; UVID when the audit has none): never guessed
export function answerSheet({ app = {}, typical = [], before = [], student = {}, done = new Set(), grades = {}, when = {},
  catalogYear = '', gpa = null, minGrade = null, minGpa = null, terms = null, today = new Date() } = {}) {
  const known = !!app.known;
  const min = app.minGrade || minGrade || 'C';
  const advisor = byLetter(app.advisorByLetter, student.last);
  const mentor = byLetter(app.mentorByLetter, student.last);
  const gpaNow = student.gpa || (gpa == null ? '' : Number(gpa).toFixed(2));
  const value = {
    'Last Name': student.last || '',
    'First Name': student.first || '',
    Date: usDate(today),
    UVID: student.uvid || '',
    Email: student.uvid ? uvuEmail(student.uvid) : '',
    Phone: '',
    Address: '',
    'Cumulative GPA': gpaNow,
    'Catalog Year': catalogYear || '',
    'Advisor Name': advisor?.name || '',
  };
  const labels = known && app.fields?.length ? app.fields : typical.length ? typical : Object.keys(value).filter((k) => k !== 'Address' && k !== 'Advisor Name');
  const fields = labels.map((label) => ({ label, value: value[label] ?? '', own: !(value[label] ?? '') }));
  const codes = known && app.rows?.length ? app.rows : before.length ? before : app.pageCourses || [];
  const st = (code) => courseStatus(code, { done, grades, minGrade: min });
  const rows = codes.map((code) => {
    const status = st(code);
    const g = grades[code] || '';
    const s = student.sources?.[code];
    const transfer = !!s || /^T/.test(g);
    return {
      code, status,
      term: status === 'missing' ? '' : when[code] || '',
      grade: status === 'ip' ? 'IP' : status === 'missing' ? '' : g,
      course: transfer && s ? s.course : '',
      inst: transfer && s ? s.inst : '',
    };
  });
  // classes the program's page also asks for that the form has no row for (EE: MATH 2210)
  const inRows = new Set(codes);
  const also = known ? (app.pageCourses || []).filter((c) => !inRows.has(c)).map((code) => ({ code, status: st(code) })) : [];
  const need = app.minGpa || minGpa || null;
  const deadline = nextDeadline(terms, app.weeksBefore, today);
  return {
    known, fields, rows, also, advisor, mentor,
    columns: known && app.columns?.length ? app.columns : ['Completed Sem/YR', 'Grade', 'Transfer Course & Number', 'Transfer Institution'],
    rowNote: known ? app.rowNote || '' : '',
    ready: {
      courses: [...rows.map((r) => ({ code: r.code, status: r.status })), ...also],
      gpa: gpaNow || null, minGpa: need, gpaOk: need && gpaNow ? +gpaNow + 1e-9 >= +need : null,
      deadline, deadlineText: app.deadlineText || null, weeksBefore: app.weeksBefore || null,
    },
  };
}

// the whole sheet as plain text (Copy all): "Label: value" lines, then one line per class
export function sheetText(sheet, title = '') {
  const lines = title ? [title, ''] : [];
  for (const f of sheet.fields) lines.push(`${f.label}: ${f.value}`);
  if (sheet.rows.length) {
    lines.push('', ['Course', ...sheet.columns].join(' | '));
    for (const r of sheet.rows) lines.push([r.code, r.term, r.grade, r.course, r.inst].join(' | '));
  }
  return lines.join('\n');
}

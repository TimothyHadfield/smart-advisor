// Reads a Wolverine Track degree audit (Ellucian Degree Works: pasted text, or text pulled from its
// "Save as PDF" file), an Ellucian Colleague "My Progress" page, or an unofficial transcript, and finds
// the courses the student has COMPLETED or has IN PROGRESS. Pure: no DOM.
// Used by js/app.js (Settings -> Import audit) and tests/audit.test.mjs.
//
// Conservative on purpose: a course is only marked when its own row shows it was taken.
//   completed    row with a passing grade (A..D-, P, CR, S), transfer credit (TCR, T, TA, TB+, TP) or
//                a "Completed" status
//   in progress  row with IP / "In progress" / "Registered", a row under an In-progress header, or a
//                row with a term but no grade yet
//   ignored      "Still needed: 1 Class in ECE 3250", the lines that continue it ("or 3290 or ..."),
//                "Matriculation Courses: MATH 1210, MATH 1220, ..." lists, "Satisfied by: AP MCBC0000"
//                (that's the outside course, not the UVU one), Planned / Not started rows, the
//                Insufficient and Not counted blocks, failing grades (F, W, ...)
//
// parseAudit(text) -> { catalogYear, majors, minors, programs, taken: [{code, grade, req, credits?, term?}], inProgress: [{code, req, term?}] }
//   term = the semester on the row ("Fall 2025"), or the transcript heading above it
//   codes look like "ECE 2250", "ECE 4810R", "SLSS 101R"; req = the requirement label printed before
//   the course on its row (used to fill Gen Ed boxes like "Fine Arts Distribution").

import { minGradeFor } from './planner.js';
import { gradeMeets } from './rules.js';

const PASS = /^(A|A-|B\+|B|B-|C\+|C|C-|D\+|D|D-|P|CR|S|T|TR|TP|TCR|TS|T[ABCD][+-]?)$/;
const FAIL = /^(F|W|UW|WF|WD|NC|U|E|AU|NG|FN)$/;
const IPTOK = /^(IP|INP|REG|CURR)$/;
const CREDIT = /^\(?\d{1,2}(\.\d{1,3})?\)?$/;
const TERM = /\b(?:(?:Fall|Spring|Summer|Winter|Spr|Sum)(?:\s+Semester)?,?\s+\d{4}|\d{4}\s+(?:Fall|Spring|Summer|Winter)|\d{4}\s?(?:FA|SP|SU|SM|WI)|(?:FA|SP|SU|SM)\s?\d{2,4}|(?:19|20)\d{2}(?:20|30|40))\b/i;
// "ECE 2250", "ECE2250", "ECE-2250", "ECE 4810R", "SLSS 101R". Not "ECE 3000:4999" (range), "ECE 3@".
const CODE = /(?<![A-Za-z])([A-Z]{2,5})[ \t]?-?[ \t]?(\d{3,4})([A-Z]{1,2}(?![A-Za-z]))?(?![\d:@])/g;
const NOT_SUBJECT = new Set(['FALL', 'FA', 'SP', 'SU', 'SM', 'WI', 'SPR', 'SUMR', 'SUM', 'WIN', 'TERM', 'YEAR', 'PAGE', 'GPA', 'HRS', 'CRED', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUNE', 'JULY', 'AUG', 'SEPT', 'SEP', 'OCT', 'NOV', 'DEC', 'ID', 'UVID', 'ZIP', 'AM', 'PM']);

// a line that states a requirement rather than a taken course
const NEEDED = /still\s+needed|\bneeds?\s*:|\bnot\s+complete\b|\bincomplete\b|\byou\s+need|\bnot\s+started\b|\bplanned\b|\bchoose\s+from|\bselect\s+from|\b\d+\s+(?:class(?:es)?|courses?|credits?|hours?)\s+(?:in|from)\b|\bexcept\b|\bminimum\s+grade|\bor\s+(?:better|higher)\b|\bmatriculation\b/i;
const STILL = /still\s+needed|\bneeds?\s*:|\bnot\s+complete\b|\bnot\s+started\b|\bplanned\b/i;
// block headers (a header line has no course code of its own)
const H_IP = /^\s*(?:in[\s-]?progress|courses\s+in\s+progress|current\s+(?:term|courses|registration)|registered(?:\s+courses)?)\b/i;
const H_IGNORE = /^\s*(?:insufficient|not\s+counted|planned|plans?\b|planner|not\s+started|exceptions?)\b/i;
const H_NORMAL = /^\s*(?:not\s+applied|fallthrough|electives?|over\s+the\s+limit|transfer|term\s*:|institution\s+credit|course\s+history|courses?\s+taken|course\s+title|major|minor|degree|new\s+general|general\s+education|bachelor|associate|core|emphasis|concentration|requirements?|total|unofficial|academic|student|completed\s+courses|legend|global|writing)\b/i;

export function codesIn(line) {
  const out = [];
  CODE.lastIndex = 0;
  let m;
  while ((m = CODE.exec(line))) {
    if (NOT_SUBJECT.has(m[1]) || /^0+$/.test(m[2])) continue;
    out.push({ code: `${m[1]} ${m[2]}${m[3] || ''}`, at: m.index });
  }
  return out;
}

export function parseAudit(text) {
  const src = String(text || '').replace(/ /g, ' ').replace(/\r/g, '');
  const cy = src.match(/catalog\s+year:?\s*(\d{4}\s*-\s*\d{4})/i);
  const lines = src.split('\n').map((l) => l.replace(/\s+$/, ''));
  const taken = new Map(), ip = new Map();
  const rowLines = []; // the rows read as taken / in progress (their terms decide lastTerm)
  let mode = 'normal';     // block mode from the last header: normal | ip | ignore
  let neededTail = false;  // the lines that continue a "Still needed" line
  let context = [];        // code-less lines just above a row (a requirement label split over lines)
  let headTerm = null;     // a transcript's "Term: Fall 2024" / "Fall 2023: Salt Lake ..." heading
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { neededTail = false; context = []; continue; }
    const codes = codesIn(line);
    if (!codes.length) {
      const ht = line.match(/^\s*(?:term\s*:\s*)?((?:Fall|Spring|Summer)\s+\d{4})\b/i);
      if (ht) headTerm = latestTerm([ht[1]]);
      if (H_IP.test(line)) mode = 'ip';
      else if (H_IGNORE.test(line)) mode = 'ignore';
      else if (H_NORMAL.test(line)) mode = 'normal';
      if (NEEDED.test(line)) neededTail = true;
      else if (!/^\s*(?:or|and)\b/i.test(line)) neededTail = false;
      context = [...context, line.trim()].slice(-2);
      continue;
    }
    const ctx = context; context = [];
    if (/satisfied\s+by/i.test(line)) continue;
    // a requirement line, unless it is clearly a graded row ("Complete any 1000-level or higher courses
    // SLSS 101R ... A 3 2024 SPRING")
    if (STILL.test(line) || (NEEDED.test(line) && !gradeOf(line.split(/\s+/))?.strong)) { neededTail = true; continue; }
    if (neededTail && (/^\s*(?:or|and|,)/i.test(line) || !hasEvidence(line))) continue;
    neededTail = false;
    if (mode === 'ignore') continue;
    if (codes.length >= 3 && !gradeOf(line.split(/\s+/))) continue; // a list of courses, not a row
    // a row split over several lines (one cell per line): pull in the following code-less lines
    let rec = line;
    if (!hasEvidence(line)) {
      for (let k = i + 1; k < lines.length && k <= i + 5; k++) {
        const nx = lines[k];
        if (!nx.trim() || codesIn(nx).length || NEEDED.test(nx) || H_IP.test(nx) || H_IGNORE.test(nx)) break;
        rec += ' ' + nx.trim();
        if (hasEvidence(rec)) { i = k; break; }
      }
      if (!hasEvidence(rec)) rec = line;
    }
    const r = readRow(rec, mode);
    if (!r) continue;
    rowLines.push(rec);
    // the row's own term; a PDF may wrap it onto the next line ("... B+ 3" / "2025 FALL"); else the heading's
    let tm = latestTerm([rec]);
    const nx = lines[i + 1] || '';
    if (!tm && !codesIn(nx).length && latestTerm([nx]) && !nx.replace(TERM_ANY, '').trim()) { tm = latestTerm([nx]); rowLines.push(nx); i++; }
    tm ||= headTerm;
    const term = tm ? { term: `${tm.season} ${tm.year}` } : {};
    const pre = rec.slice(0, codes.find((c) => c.code === r.code)?.at ?? 0).trim();
    const req = (pre && !/^(completed?|in[\s-]?progress|registered)$/i.test(pre) ? pre : ctx.join(' ')).replace(/\s+/g, ' ');
    if (r.status === 'taken') { if (!taken.has(r.code)) taken.set(r.code, { code: r.code, grade: r.grade, req, ...(r.credits ? { credits: r.credits } : {}), ...term }); }
    else if (!ip.has(r.code)) ip.set(r.code, { code: r.code, req, ...term });
  }
  for (const c of taken.keys()) ip.delete(c);
  return { catalogYear: cy ? cy[1].replace(/\s/g, '') : null, ...auditHeader(src), taken: [...taken.values()], inProgress: [...ip.values()], lastTerm: latestTerm(rowLines) };
}

// The latest semester named on any course row -> {season, year} | null. Reads "2026 FALL", "Fall 2026",
// "FALL 2026", "Fall Semester 2026", "Spring, 2026", "2026FA", "FA26", "FA 2026", "SP 2024", "Spr 2024",
// "Sum 2024", and Banner term codes ("202640": yyyy20 Spring, yyyy30 Summer, yyyy40 Fall).
const SEASON_OF = { FALL: 'Fall', FA: 'Fall', SPRING: 'Spring', SP: 'Spring', SPR: 'Spring', SUMMER: 'Summer', SU: 'Summer', SM: 'Summer', SUM: 'Summer', 20: 'Spring', 30: 'Summer', 40: 'Fall' };
const TERM_ANY = /\b(?:(Fall|Spring|Summer|Spr|Sum)(?:\s+Semester)?,?\s+(\d{4})|(\d{4})\s+(Fall|Spring|Summer)|(\d{4})\s?(FA|SP|SU|SM)|(FA|SP|SU|SM)\s?(\d{2}(?:\d{2})?)|((?:19|20)\d{2})(20|30|40))\b/gi;
export function latestTerm(lines) {
  let best = null;
  for (const l of lines) {
    for (const m of l.matchAll(TERM_ANY)) {
      const s = SEASON_OF[(m[1] || m[4] || m[6] || m[7] || m[10]).toUpperCase()];
      let y = +(m[2] || m[3] || m[5] || m[8] || m[9]);
      if (y < 100) y += 2000;
      const i = y * 3 + ['Spring', 'Summer', 'Fall'].indexOf(s);
      if (!best || i > best.i) best = { season: s, year: y, i };
    }
  }
  return best && { season: best.season, year: best.year };
}

// The audit's header names the student's programs:
//   "Level Undergraduate    Classification Junior    Major Electrical Engineering    Minor Environmental
//    Science & Management    Program Electrical Engineering-BS    College ...    Catalog Year 2025-2026 (BS-EE1)"
// Fields are 3+ spaces (or tabs) apart and wrap onto the next line anywhere. Only the lines before the
// first requirement block are read ("Minor Requirements Still needed: See MINOR: ..." further down is not
// a header). -> { majors: [...], minors: [...], programs: ["Electrical Engineering-BS"] }
const HEAD_KEY = /(?:Level|Classification|Majors?|Minors?|Programs?|College|Catalog\s+Year|Degree(?:\s+Effective\s+Term)?|Concentrations?|Emphasis|Advisor(?:\s+Email)?|Student(?:\s+(?:name|ID))?|Completion\s+Rate|Academic\s+Standing|Transfer\s+Credits|Overall\s+GPA|Priority|Audit\s+date)/;
export function auditHeader(text) {
  const lines = String(text || '').replace(/ /g, ' ').replace(/\r/g, '').split('\n');
  const head = [];
  for (const l of lines.slice(0, 80)) {
    if (/credits\s+required|\b(?:IN)?COMPLETE\s*$|still\s+needed/i.test(l)) break;
    head.push(l.replace(/\s+$/, ''));
  }
  // a wrapped field: "Program Electrical" + "Engineering-BS" (joined with two spaces, so a real 3+ space
  // gap still separates fields); a new key after two spaces also starts a field
  const flat = head.join('  ').replace(/\t/g, '    ');
  const keyAhead = new RegExp('\\s{2}(?=' + HEAD_KEY.source + '\\s)');
  const chunks = flat.split(/\s{3,}/).flatMap((c) => c.split(keyAhead));
  const out = { majors: [], minors: [], programs: [] };
  for (let i = 0; i < chunks.length; i++) {
    // "Major Electrical Engineering", or the key and its value in cells of their own (a pasted table)
    const lone = chunks[i].trim().match(/^(Majors?|Minors?|Programs?)\s*:?$/);
    const m = lone && chunks[i + 1] ? [null, lone[1], chunks[++i].trim()] : chunks[i].trim().match(/^(Majors?|Minors?|Programs?)\s*:?\s+(.+)$/);
    if (!m) continue;
    const key = m[1].replace(/s$/, '').toLowerCase();
    for (const v of m[2].split(/\s*;\s*/)) {
      const val = v.replace(/\s+/g, ' ').replace(/\s*-\s*/g, '-').trim();
      if (!val || /^requirements?\b/i.test(val)) continue;
      const list = out[key === 'major' ? 'majors' : key === 'minor' ? 'minors' : 'programs'];
      if (!list.includes(val)) list.push(val);
    }
  }
  return out;
}

function hasEvidence(s) {
  return /^\s*completed?\b|in[\s-]?progress|\bregistered\b/i.test(s) || TERM.test(s) || gradeOf(s.split(/\s+/)) !== null;
}

// The grade is the grade-looking token followed by a credit count or a term ("B+ 3", "TCR 4", "IP (3)",
// "A 4.000"), or else the last grade-looking token. Title words like "I"/"II" are never grades.
function gradeOf(tokens) {
  let last = null;
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k].replace(/[,;]$/, '').toUpperCase();
    if (!(PASS.test(t) || FAIL.test(t) || IPTOK.test(t))) continue;
    if (CREDIT.test(tokens[k + 1] || '') || TERM.test(tokens.slice(k + 1, k + 3).join(' '))) return { t, k, strong: true };
    last = { t, k };
  }
  // a lone capital letter inside a title ("Physics A") is only a grade at the end or next to credits
  if (last && last.t.length === 1 && last.k < tokens.length - 1) return null;
  return last;
}

function readRow(rec, mode) {
  const codes = codesIn(rec);
  if (/\bnot\s+started\b|\bplan(?:ned)?\b|\bwithdrawn\b|\bdropped\b/i.test(rec)) return null;
  const first = codes[0];
  const tail = rec.slice(first.at);
  const g = gradeOf(tail.split(/\s+/).slice(1));
  // the course is the last code before the grade (a requirement label may list alternatives first)
  const pick = (cut) => { const before = codes.filter((c) => c.at < cut); return (before.length ? before[before.length - 1] : codes[codes.length - 1]).code; };
  if (/^\s*completed?\b/i.test(rec)) { // Colleague: "Completed ECE-2250 Circuit Theory I B+ 2025FA 3"
    if (g && FAIL.test(g.t)) return null;
    return { code: pick(Infinity), status: 'taken', grade: g && PASS.test(g.t) ? g.t : '' };
  }
  if (/^\s*in[\s-]?progress\b|^\s*registered\b/i.test(rec)) return { code: pick(Infinity), status: 'ip' };
  if (g) {
    const cut = first.at + tokenOffset(tail, g.k + 1);
    if (FAIL.test(g.t)) return null;
    if (IPTOK.test(g.t)) return { code: pick(cut), status: 'ip' };
    const cr = CREDIT.test(tail.split(/\s+/).slice(1)[g.k + 1] || '') ? parseFloat(tail.split(/\s+/).slice(1)[g.k + 1].replace(/[()]/g, '')) : null;
    return { code: pick(cut), status: mode === 'ip' ? 'ip' : 'taken', grade: g.t, ...(cr > 0 && cr <= 12 ? { credits: cr } : {}) };
  }
  if (/in[\s-]?progress|\bregistered\b/i.test(rec)) return { code: pick(Infinity), status: 'ip' };
  // no grade: in progress when under an In-progress header or when the row names a term
  if (mode === 'ip' || TERM.test(rec)) return { code: pick(Infinity), status: 'ip' };
  return null;
}
function tokenOffset(s, k) {
  const re = /\S+/g;
  let m, n = 0;
  while ((m = re.exec(s))) { if (n++ === k) return m.index; }
  return s.length;
}

const gradeText = (r, status) => (status === 'ip' ? 'IP' : r.grade || '');

// How a grade is shown: { kind: 'letter'|'mark'|'none', text, hue }. Letter grades get a hue on a tight
// red -> green scale (A 135 green, B 95, C 55 yellow, D 10, E/F 0 red); transfer / pass / in-progress
// marks get a short tag and no hue.
const POINTS = { A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7, 'C+': 2.3, C: 2, 'C-': 1.7, 'D+': 1.3, D: 1, 'D-': 0.7, E: 0, F: 0 };
export function gradeInfo(g) {
  const t = String(g || '').toUpperCase();
  if (t in POINTS) {
    const p = POINTS[t];
    const hue = p >= 3 ? 95 + (p - 3) * 40 : p >= 2 ? 55 + (p - 2) * 40 : p >= 1 ? 10 + (p - 1) * 45 : p * 10;
    return { kind: 'letter', text: t, hue: Math.round(hue) };
  }
  if (!t) return { kind: 'none', text: '' };
  if (t === 'IP') return { kind: 'mark', text: 'IP' };
  if (/^T/.test(t)) return { kind: 'mark', text: 'TR' }; // transfer / AP credit (TCR, T, TA, TB+ ...)
  return { kind: 'mark', text: t === 'S' || t === 'CR' ? 'P' : t.slice(0, 2) };
}

// Match parsed courses to a program model (planner.js buildModel).
// Returns { rows: [{key, code, status: 'taken'|'ip', grade, label, title, term?, min?, low?}], others, other } where
// key is what goes in the taken set: a course code, or a Gen Ed box id (e.g. "ph:7") when the audit row's
// requirement label names that box ("FINE ARTS THEA 1023 ..." -> "Fine Arts Distribution").
// min = the requirement's minimum grade; low = the grade is below it (the class doesn't count, retaken).
// others = the courses not in this major ([{code, status, grade, credits}]: transfer/AP credit and classes
// the plan doesn't use; they can fill free electives); other = how many.
export function matchAudit(parsed, model) {
  const courses = model.program.courses || {};
  const optionCodes = new Set(model.units.filter((u) => u.kind === 'choice').flatMap((u) => u.options.flatMap((o) => o.codes)));
  const inProgram = (c) => !!model.byCode[c] || optionCodes.has(c);
  const words = (s) => String(s).toLowerCase().match(/[a-z]+/g) || [];
  const STOP = new Set(['and', 'the', 'of', 'distribution', 'requirement', 'requirements']);
  const boxes = model.units.filter((u) => u.kind === 'placeholder').map((u) => ({ u, need: words(u.label).filter((w) => !STOP.has(w)) })).filter((b) => b.need.length);
  const rows = [], usedBox = new Set(), others = [];
  for (const [list, status] of [[parsed.taken, 'taken'], [parsed.inProgress, 'ip']]) {
    for (const r of list) {
      if (inProgram(r.code)) {
        const row = { key: r.code, code: r.code, status, grade: gradeText(r, status), label: r.code, title: courses[r.code]?.title || '', ...(r.term ? { term: r.term } : {}) };
        const min = status === 'taken' ? minGradeFor(model, r.code) : null;
        if (min) { row.min = min; if (!gradeMeets(row.grade, min)) row.low = true; }
        rows.push(row);
        continue;
      }
      const have = new Set(words(r.req));
      // all the label's words; a long label may miss one (a PDF can print its last word on the next line)
      const hits = (b) => b.need.filter((w) => have.has(w)).length;
      const box = boxes.find((b) => !usedBox.has(b.u.id) && hits(b) >= (b.need.length >= 3 ? b.need.length - 1 : b.need.length));
      if (box) { usedBox.add(box.u.id); rows.push({ key: box.u.id, code: r.code, status, grade: gradeText(r, status), label: box.u.label, title: r.code, ...(r.term ? { term: r.term } : {}) }); continue; }
      others.push({ code: r.code, status, grade: gradeText(r, status), credits: r.credits ?? courses[r.code]?.credits ?? null, ...(r.term ? { term: r.term } : {}) });
    }
  }
  rows.sort((a, b) => (a.status === b.status ? 0 : a.status === 'taken' ? -1 : 1) || a.label.localeCompare(b.label));
  return { rows, others, other: others.length };
}

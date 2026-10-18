// "My schedule": the classes a student is already registered for, as week-grid rows. Pure (no DOM), used
// by js/app.js (Schedule tab) and tests/mysched.test.mjs.
//
// Two sources:
//   1. the audit's in-progress classes (prefill): a course with one section that term is filled in; one
//      with several waits for "Pick your section".
//   2. a pasted / uploaded save of the myUVU (Banner) registration page. Formats read:
//      - Banner 9 "View Registration Information" → Schedule Details: "Circuit Theory | Electrical Comp
//        Engineering 2250 Section 601 | Class Begin: ..." blocks with "CRN: 14896"
//      - Banner 9 summary table (Title, Details "ECE 2250, 601", Hours, CRN, Schedule Type, ..., Status)
//      - Banner 8 "Concise Student Schedule" rows (CRN, Course "ECE 2250 601", Title, ..., Days, Time)
//      - Banner 8 "Student Detail Schedule" blocks ("Circuit Theory - ECE 2250 - 601", "CRN: 14896")
//      - anything else that lists CRNs, or "ECE 2250-601" / "ECE 2250" codes
//   CRNs are matched against the term's section file first, then subject+number+section, then the
//   course code alone. Dropped / withdrawn rows are skipped.
//
// Saved entries (settings.sched.terms[term].mine, synced):
//   { code: 'ECE 2250', crn: '14896' }            a section from the term's file
//   { code: 'MATH 2210', crn: '' }                 "Pick your section"
//   { code: 'WORK 1000', days: 'MW', start: '0930', end: '1045', hand: 1 }   added by hand

const SEASON_CODE = { spring: 20, summer: 30, fall: 40 };
const DROP = /\b(?:dropped|withdr[ae]wn?|web\s+drop|drop(?:ped)?\s*-\s*web|deleted|cancell?ed)\b/i;

/** "Fall 2026" / "2026 Fall" / "FA26" → "202640"; null when it isn't a term. */
export function termCode(label) {
  const s = String(label || '').trim();
  let m = s.match(/\b(spring|summer|fall)\s+(\d{4})\b/i) || s.match(/\b(\d{4})\s+(spring|summer|fall)\b/i);
  if (!m) return null;
  const [season, year] = /^\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]];
  return `${year}${SEASON_CODE[season.toLowerCase()]}`;
}

/** The term the text names most often, among the terms that have data (null if none named). */
export function termOfText(text, codes = []) {
  const want = new Set(codes.map(String));
  const n = new Map();
  for (const m of String(text || '').matchAll(/\b(?:(?:spring|summer|fall)\s+\d{4}|\d{4}\s+(?:spring|summer|fall))\b/gi)) {
    const c = termCode(m[0]);
    if (c && (!want.size || want.has(c))) n.set(c, (n.get(c) || 0) + 1);
  }
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** Visible text of a saved web page: one line per block / table row, cells split by tabs. */
export function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style|head|template|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(td|th)>/gi, '\t')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/?(p|div|tr|li|h[1-6]|table|tbody|thead|section|article|header|footer|ul|ol|dl|dt|dd|caption|form|fieldset|legend|label|h\d)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/[ \t]*\n[ \t\n]*/g, '\n');
}

// subject code or its Banner description ("Electrical Comp Engineering") + number (+ section)
function codeFinder(subjects) {
  const subj = Object.keys(subjects || {}).filter((k) => /^[A-Z]{2,5}$/.test(k));
  const byDesc = new Map();
  for (const k of subj) if (subjects[k]) byDesc.set(subjects[k].toLowerCase().replace(/\s+/g, ' '), k);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const descs = [...byDesc.keys()].sort((a, b) => b.length - a.length).map((d) => esc(d).replace(/ /g, '\\s+'));
  const SEC = String.raw`(?:\s*(?:,|-|–|\||/)?\s*(?:section|sec\.?)?\s*([A-Z]?\d{2,3}|[A-Z]\d{2}))?(?![\w])`;
  const NUM = String.raw`(\d{4}[A-Z]?)`;
  const parts = [`(?<![A-Za-z])(${subj.map(esc).join('|') || 'ZZZZZ'})\\s?-?\\s?${NUM}`];
  if (descs.length) parts.push(`(?<![A-Za-z])(${descs.join('|')})\\s+${NUM}`);
  const re = new RegExp(`(?:${parts.join('|')})${SEC}`, 'gi');
  return (line) => {
    const out = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line))) {
      const s = m[1] ? m[1].toUpperCase() : byDesc.get(m[3].toLowerCase().replace(/\s+/g, ' '));
      const num = (m[2] || m[4]).toUpperCase();
      // a code's own subject must be written in capitals ("Fall 2026" isn't a course)
      if (m[1] && m[1] !== m[1].toUpperCase()) continue;
      out.push({ code: `${s} ${num}`, sec: m[5] ? m[5].toUpperCase().padStart(3, '0') : '', at: m.index });
    }
    return out;
  };
}

/**
 * Read a registration page. groups = Map(course code → section rows) for the term (js/schedule.js
 * groupSections); subjects = { ECE: 'Electrical Comp Engineering', ... }.
 * → { matched: [{code, crn, sec}], pick: [code], unmatched: [{code, sec, crn}] }
 */
export function parseRegistration(text, groups, subjects = {}) {
  const src = String(text || '').replace(/ /g, ' ').replace(/\r/g, '');
  const lines = src.split('\n');
  const byCrn = new Map(), bySec = new Map();
  const subj = { ...subjects };
  for (const [code, rows] of groups || []) {
    for (const r of rows) {
      byCrn.set(String(r.crn), r);
      bySec.set(`${code}|${r.sec}`, r);
      if (!subj[r.subj]) subj[r.subj] = '';
    }
  }
  const find = codeFinder(subj);
  const codesOn = lines.map(find);
  const matched = new Map(), pick = new Set(), unmatched = new Map(), dropped = new Set();
  const status = (i) => {
    // this row, or a "Status:" / "Registration Status:" line just below a block's CRN line
    if (DROP.test(lines[i])) return true;
    for (let k = i + 1; k <= i + 3 && k < lines.length; k++) {
      if (codesOn[k].length) break; // the next block
      if (/status\s*:/i.test(lines[k]) && DROP.test(lines[k])) return true;
    }
    // back up to this block's title line ("Circuit Theory | Electrical Comp Engineering 2250 Section 601")
    for (let k = i - 1; k >= i - 8 && k >= 0; k--) {
      if (/status\s*:/i.test(lines[k])) return DROP.test(lines[k]);
      if (codesOn[k].length || (/\bCRN\b/.test(lines[k]) && /\d{5}/.test(lines[k]))) break;
    }
    return false;
  };
  const near = (i, code) => {
    for (let k = Math.max(0, i - 8); k <= Math.min(lines.length - 1, i + 4); k++) if (codesOn[k].some((c) => c.code === code)) return true;
    return false;
  };
  // 1. CRNs: a 5-digit number that is a CRN in the term's file, labelled "CRN" or near its course code
  const crnLines = new Set();
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/(?<![\d.,$/-])(\d{5})(?![\d,/-]|\.\d)/g)) {
      const labelled = /\bCRN\b/i.test(line) || (i > 0 && /\bCRN\s*:?\s*$/i.test(lines[i - 1]));
      const r = byCrn.get(m[1]);
      if (!r) { if (labelled) unmatched.set(`crn:${m[1]}`, { code: '', sec: '', crn: m[1] }); continue; }
      const code = `${r.subj} ${r.num}`;
      if (!labelled && !near(i, code)) continue;
      crnLines.add(i);
      if (status(i)) { dropped.add(code); continue; }
      matched.set(r.crn, { code, crn: r.crn, sec: r.sec });
    }
  });
  const haveCode = (code) => [...matched.values()].some((x) => x.code === code);
  // 2. subject + number + section, 3. the course code alone
  lines.forEach((line, i) => {
    for (const c of codesOn[i]) {
      if (haveCode(c.code) || dropped.has(c.code)) continue;
      if (DROP.test(line)) { dropped.add(c.code); continue; }
      const r = c.sec && bySec.get(`${c.code}|${c.sec}`);
      if (r) { matched.set(r.crn, { code: c.code, crn: r.crn, sec: r.sec }); continue; }
      if (groups?.has(c.code)) pick.add(c.code);
      else if (!unmatched.has(c.code)) {
        // a CRN on the same row that isn't in the term's file goes with the course
        const crn = (line.match(/(?<![\d.,$/-])(\d{5})(?![\d,/-]|\.\d)/) || [])[1] || '';
        if (crn) unmatched.delete(`crn:${crn}`);
        unmatched.set(c.code, { code: c.code, sec: c.sec, crn });
      }
    }
  });
  for (const x of matched.values()) { pick.delete(x.code); unmatched.delete(x.code); }
  for (const c of dropped) { pick.delete(c); unmatched.delete(c); }
  return { matched: [...matched.values()], pick: [...pick], unmatched: [...unmatched.values()] };
}

/** Saved entries from a parse: matched sections, then "Pick your section" courses (a course with one section: that one). */
export function entriesFrom(found, groups) {
  const out = found.matched.map((x) => ({ code: x.code, crn: x.crn }));
  for (const code of found.pick) out.push(prefillOne(code, groups));
  return out;
}
function prefillOne(code, groups) {
  const rows = groups?.get(code) || [];
  return { code, crn: rows.length === 1 ? rows[0].crn : '' };
}

/**
 * The audit's in-progress course codes → entries for the term: one section → it, several → pick.
 * → { entries, none: [codes not offered that term] }
 */
export function prefillFromAudit(codes, groups) {
  const entries = [], none = [];
  for (const code of [...new Set(codes || [])]) {
    if (groups?.has(code)) entries.push(prefillOne(code, groups));
    else none.push(code);
  }
  return { entries, none };
}

/** "M W F", "Tu Th", "mwf", "TTh" → "MWF" / "TR" (Mon..Sun = M T W R F S U). */
export function normDays(s) {
  const t = String(s || '').toLowerCase()
    .replace(/monday/g, 'm').replace(/tuesday/g, 't').replace(/wednesday/g, 'w').replace(/thursday/g, 'r')
    .replace(/friday/g, 'f').replace(/saturday/g, 's').replace(/sunday/g, 'u')
    .replace(/thurs|thur|thu|th/g, 'r').replace(/tues|tue|tu/g, 't').replace(/mon/g, 'm').replace(/wed/g, 'w')
    .replace(/fri/g, 'f').replace(/sat|sa/g, 's').replace(/sun|su/g, 'u');
  const out = new Set(t.toUpperCase().replace(/[^MTWRFSU]/g, ''));
  return 'MTWRFSU'.split('').filter((d) => out.has(d)).join('');
}
/** "09:30" (time input) / "9:30 am" / "0930" → "0930"; null when unreadable. */
export function normTime(s) {
  const m = String(s || '').trim().toLowerCase().match(/^(\d{1,2}):?(\d{2})?\s*(am|pm|a|p)?$/);
  if (!m) return null;
  let h = +m[1];
  const min = +(m[2] || 0);
  if (m[3]?.startsWith('p') && h < 12) h += 12;
  if (m[3]?.startsWith('a') && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return String(h).padStart(2, '0') + String(min).padStart(2, '0');
}

/** A hand-added class as a section row the week grid can draw. */
export function handSection(e) {
  const [subj, ...rest] = String(e.code || 'Class').split(' ');
  return { crn: '', subj, num: rest.join(' '), sec: '', title: e.title || '', days: e.days || '', start: e.start || null, end: e.end || null, mode: 'in person', hand: true, instr: '' };
}

/**
 * Entries → rows to show, in saved order:
 *   [{ code, entry, sec (a section row or null), pick: true when a section is still to be picked }]
 * A CRN no longer in the file (data refresh) becomes a pick again.
 */
export function mineRows(entries, groups) {
  return (entries || []).map((e) => {
    if (e.hand) return { code: e.code, entry: e, sec: handSection(e), pick: false };
    const sec = e.crn ? (groups?.get(e.code) || []).find((r) => r.crn === e.crn) || null : null;
    return { code: e.code, entry: e, sec, pick: !sec };
  });
}

/** Replace a pick (or a section) of that course with this section. */
export function choose(entries, code, crn) {
  const out = (entries || []).map((e) => ({ ...e }));
  const i = out.findIndex((e) => e.code === code && !e.hand);
  if (i >= 0) out[i] = { code, crn };
  else out.push({ code, crn });
  return out;
}

/** "Fall 2026" (settings.lastTerm) → "202640". */
export const labelToCode = termCode;

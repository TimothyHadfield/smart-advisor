// Smart Advisor: small degree rules used by the planner (pure; browser + Node tests).
//   seasons      which semesters a course is usually offered (data/seasons.json, from Banner)
//   grades       does a grade meet a requirement's minimum
//   electives    which Gen Ed / elective boxes any class can fill (free electives)
//   degree       bachelor's totals: 120 credits, 40 upper-division credits

// ---------- seasons ----------
// data/seasons.json: { terms: [{ term, name, season }], courses: { code: [term indexes] } }
// -> { covered: Set of seasons the history has, of(code): Set of seasons | null (no history, or one offering) }
export function seasonTable(data) {
  const terms = data?.terms || [];
  const covered = new Set(terms.map((t) => t.season).filter(Boolean));
  const cache = new Map();
  const of = (code) => {
    if (cache.has(code)) return cache.get(code);
    const idx = data?.courses?.[code];
    // a class seen only once in the history shows no pattern (new, or run when there was demand): unknown
    const v = Array.isArray(idx) && idx.length >= 2 ? new Set(idx.map((i) => terms[i]?.season).filter(Boolean)) : null;
    cache.set(code, v);
    return v;
  };
  return { covered, of };
}
// Is a course (any of codes) offered in a season, as far as the history shows? true when unknown.
export function offeredIn(table, codes, season) {
  if (!table || !table.covered.has(season)) return true;
  let known = false;
  for (const c of codes || []) {
    const s = table.of(c);
    if (!s) continue;
    known = true;
    if (s.has(season)) return true;
  }
  return !known;
}
// "Usually Fall only" / "Usually Spring only" / "Usually Fall and Summer" (no Spring), or null when the
// course runs both Fall and Spring (or the history doesn't know it).
export function offeredLabel(table, codes) {
  if (!table) return null;
  const all = new Set();
  for (const c of codes || []) for (const s of table.of(c) || []) all.add(s);
  if (!all.size) return null;
  const main = ['Fall', 'Spring'].filter((s) => table.covered.has(s));
  if (main.every((s) => all.has(s))) return null;
  const list = ['Fall', 'Spring', 'Summer'].filter((s) => all.has(s));
  return `Usually ${list.join(' and ')}${list.length === 1 ? ' only' : ''}`;
}

// ---------- grades ----------
const POINTS = { A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7, 'C+': 2.3, C: 2, 'C-': 1.7, 'D+': 1.3, D: 1, 'D-': 0.7, E: 0, F: 0 };
// The letter inside a grade ("B+", transfer "TB+" -> "B+"), or null (TCR, P, CR, IP, blank: no letter).
export function letterOf(g) {
  const t = String(g || '').trim().toUpperCase();
  if (t in POINTS) return t;
  const m = /^T([A-DF][+-]?)$/.exec(t);
  return m && m[1] in POINTS ? m[1] : null;
}
// Does a grade meet a minimum ("C-")? A grade with no letter (transfer credit, pass, in progress) counts.
export function gradeMeets(grade, min) {
  const g = letterOf(grade), m = letterOf(min);
  if (!g || !m) return true;
  return POINTS[g] + 1e-9 >= POINTS[m];
}

// ---------- electives ----------
// A box any class can fill (credits from classes outside the program count toward it):
//   'any'   "Elective" (in an elective area), "Any course numbered 1000 or higher", "Free Electives",
//           "Complete 10 credits of upper or lower division electives", "All other non-discipline electives"
//   'upper' "Any course numbered 3000 or higher", "Complete 9 credits of upper division electives"
//   null    anything naming a subject or a list ("Elective (Complete any ENGL course ...)", "Political
//           Science" electives, a foreign language, "Any ART course")
export function electiveKind(label, area = '') {
  const l = String(label || '').replace(/\s+/g, ' ').trim();
  const a = String(area || '').replace(/:.*$/, '').trim();
  // a subject code ("CJ", "ART/ARTH", "ENGL") or a named field: a discipline elective, not a free one
  if (/\b[A-Z]{2,5}\b/.test(l.replace(/\b(?:GE|UVU|US|AND|OR)\b/g, ''))) return null;
  if (/foreign|language|anthropolog|criminal|\bart\b|music|theat|danc|not already|not previously|discipline course/i.test(l)) return null;
  // "Elective" / "Electives" alone: free only in an elective area (not a department's own "Elective" row)
  if (/^(?:free )?electives?$/i.test(l)) return /^free/i.test(l) || /^(?:elective requirements|free elective requirement|electives)$/i.test(a) ? 'any' : null;
  const upperOnly = /\b(?:3000|upper[- ]division)\b/i.test(l) && !/\b1000\b|upper or lower|lower[- ]division|must be upper|total of 40|of which/i.test(l);
  if (/1000 (?:or|and|to) 2000|2000[- ]level course|chemistry|history|advis[eo]r approved|approved list/i.test(l)) return null;
  const free = /any (?:\d{4}[- ]level )?(?:elective )?courses?(?:\(s\))?,? (?:at any level|numbered|level|\d{4})|courses at any level|\b\d{4}\+|\b1000(?:[- ]level)? (?:or|and) (?:higher|above|greater)|free elective|general electives?|non-discipline electives|additional credits to meet|students may complete any courses|upper or lower division electives|credits of (?:upper[- ]division )?electives|hours of electives|upper division elective credits/i.test(l);
  if (!free) return null;
  return upperOnly ? 'upper' : 'any';
}
export const courseLevel = (code) => Number((String(code || '').match(/\d{4}/) || ['0'])[0]);
export const isUpper = (code) => courseLevel(code) >= 3000;

// ---------- degree totals ----------
export const BACHELOR = { credits: 120, upper: 40 };
// A bachelor's degree program (combined program: its major, the first part).
export function isBachelor(program) {
  const id = String(program?.parts?.[0]?.id || program?.id || '').split('+')[0];
  if (/-(bs|ba|bas|bfa|bsw|bm|bes|bis|bsn)$/i.test(id)) return true;
  const name = String(program?.parts?.[0]?.name || program?.name || '').split(' + ')[0];
  return /\bB\.(?:S|A|F\.A|S\.W|M|A\.S)\.|\bBachelor\b/.test(name);
}

// Class details panel helpers (pure: js/app.js + Node tests). Tim, 2026-10-23: "Clean up the class descriptions
// on the right side bar when a class is clicked. It's extreamly wordy and unorganized and hard to understand."
// The panel shows short rows; the catalog's own words stay behind "Catalog text".

// A prerequisite tree from the data ("ECE 1000", { and: [...] }, { or: [...] }) -> display parts:
//   [{ code } | { word: 'or' | 'and' } | { open: true } | { close: true }]
// Top level "and" = every chip is needed (no words between); "or" puts a small "or" between; a group inside
// another gets brackets. Codes repeated in the tree show once.
export function needTree(tree) {
  const seen = new Set();
  const walk = (t, depth) => {
    if (!t) return [];
    if (typeof t === 'string') { if (seen.has(t)) return []; seen.add(t); return [{ code: t }]; }
    const op = t.and ? 'and' : t.or ? 'or' : null;
    if (!op) return [];
    const kids = t[op].map((x) => walk(x, depth + 1)).filter((p) => p.length);
    if (kids.length <= 1) return kids[0] || [];
    const out = [];
    kids.forEach((k, i) => {
      if (i && (op === 'or' || depth > 0)) out.push({ word: op });
      out.push(...k);
    });
    return depth > 0 ? [{ open: true }, ...out, { close: true }] : out;
  };
  return walk(tree, 0);
}

// The codes a prerequisite tree names
export function treeCodes(tree) {
  if (!tree) return [];
  if (typeof tree === 'string') return [tree];
  return (tree.and || tree.or || []).flatMap(treeCodes);
}

// Catalog wording for a non-class requirement -> a short plain phrase ('' = leave it to the catalog text).
// "University Advanced Standing" -> "Advanced Standing", "(Formal Acceptance into the Electrical Engineering
// Program" -> "Program acceptance", "Instructor Approval" -> "Instructor OK", placement scores, auditions...
export function plainGate(word) {
  const w = String(word || '').replace(/[()]/g, '').trim();
  if (!w) return '';
  if (/advanced standing/i.test(w)) return 'Advanced Standing';
  if (/placement|test scores?|\bACT\b|accuplacer/i.test(w)) return 'Placement score';
  if (/portfolio/i.test(w)) return 'Portfolio review';
  if (/audition/i.test(w)) return 'Audition';
  if (/senior (standing|status)/i.test(w)) return 'Senior standing';
  if (/junior (standing|status)/i.test(w)) return 'Junior standing';
  if (/sophomore review/i.test(w)) return 'Sophomore review';
  if (/graduate program|master|M\.A\b|graduate certificate/i.test(w)) return 'Graduate program admission';
  if (/accept|admi(ssion|tted)|matricul/i.test(w)) return 'Program acceptance';
  if (/instructor/i.test(w) && /approv|permission|consent/i.test(w)) return 'Instructor OK';
  if (/(department|chair|director|advisor)/i.test(w) && /approv|permission|consent/i.test(w)) return 'Department OK';
  if (/^(major|minor) in\b/i.test(w)) return w.replace(/\s+or\s+/g, ' / ');
  return '';
}

// The plain "needs" phrases for a course: its gates (program acceptance, Advanced Standing) and non-class
// prerequisites, each said once, most important first. gates = the box's own gate words (program acceptance).
const ORDER = ['Program acceptance', 'Graduate program admission', 'Advanced Standing', 'Senior standing', 'Junior standing', 'Portfolio review', 'Audition', 'Sophomore review', 'Placement score', 'Department OK', 'Instructor OK'];
export function gatePhrases(course = {}, gates = []) {
  const words = [...(gates || []), course.gateText, ...(course.prereqWords || [])].filter(Boolean);
  const set = new Set(words.map(plainGate).filter(Boolean));
  const rank = (p) => { const i = ORDER.indexOf(p); return i < 0 ? ORDER.length : i; };
  return [...set].sort((a, b) => rank(a) - rank(b));
}
// A placement score / department OK usually stands in for the classes ("...; OR appropriate placement")
export const isAlternative = (phrase) => /^(Placement score|Department OK|Instructor OK)$/.test(phrase);

// The classes in the program that need this one (prerequisite, take-with or take-before-or-with), sorted
export function unlocksOf(code, courses = {}) {
  if (!code) return [];
  const out = [];
  for (const [k, c] of Object.entries(courses)) {
    if (k === code || !c) continue;
    const names = [...treeCodes(c.prereqs), ...treeCodes(c.precoreqs), ...(Array.isArray(c.coreqs) ? c.coreqs : [])];
    if (names.includes(code)) out.push(k);
  }
  return out.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

// "Taken · A" / "In progress" / "Planned Spring 2027" / "Not yet"
//   done = counts as taken, grade = its grade ('' when grades are hidden), planned = plan term or ''
export function statusText({ done, grade = '', planned = '' }) {
  if (done && /^IP$/i.test(grade)) return 'In progress';
  if (done) return grade && !/^IP$/i.test(grade) ? `Taken · ${grade}` : 'Taken';
  if (planned) return `Planned ${planned}`;
  return 'Not yet';
}

// The seasons a class runs in (rules.js seasonTable), "Fall / Spring", "Spring only"; '' when unknown
export function offeredText(table, codes) {
  if (!table) return '';
  const all = new Set();
  for (const c of codes || []) for (const s of table.of(c) || []) all.add(s);
  const list = ['Fall', 'Spring', 'Summer'].filter((s) => all.has(s));
  if (!list.length) return '';
  return list.length === 1 ? `${list[0]} only` : list.join(' / ');
}

// Matriculation (program admission): which flowchart boxes need it, and what the catalog says about it.
// Pure: no DOM. Used by js/app.js (the dotted line + its "Matriculation" sheet) and Node tests.

const admits = (gates) => Object.values(gates || {}).flat().includes('admission');

// A box the catalog says needs program admission: its class (or its folded lab) carries the admission
// gate (planner `gates`, from the course's prerequisite line or the page's own "needs admission" list); a
// pick-one box when every one of its options does.
export function gatedBox(n) {
  if ([n, ...(n.labs || [])].some((u) => admits(u.gates))) return true;
  return n.kind === 'choice' && !!n.options?.length && n.options.every((o) => admits(o.gates));
}

// The boxes right of the line: the gated ones plus every box with an arrow from one of those (it can't
// be taken before a class that needs matriculation). -> { after: Set(ids), gated: Set(ids) }, or null when
// no box needs it.
export function matricSides(nodes, edges) {
  const gated = new Set(nodes.filter(gatedBox).map((n) => n.id));
  if (!gated.size) return null;
  const after = new Set(gated);
  for (let grew = true; grew;) {
    grew = false;
    for (const e of edges) if (after.has(e.from) && !after.has(e.to)) { after.add(e.to); grew = true; }
  }
  return { after, gated };
}

// The catalog's matriculation facts for one program, for the sheet. Only what the data holds; null = the
// catalog doesn't say. -> { text, minGrade, gpa, deadline, before, beforeFrom, gated, url }
const CODE = /\b[A-Z]{2,4} \d{4}[A-Z]?\b/;
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The section's own words, tidied: the catalog's table headings dropped, and a listed class's title, Gen Ed
// tag and credits after its code dropped, so a list reads "MATH 1210, MATH 1220, PHYS 2210" (every code and
// every word around the list stays).
export function sectionText(text, before = [], courses = {}) {
  let t = String(text || '').replace(/\s+/g, ' ')
    .replace(/\bCourse List Code Title Credit Hours\b/gi, ' ')
    .replace(/\bTotal Credit Hours\s*\d+(?:\.\d+)?/gi, ' ');
  const one = (code) => {
    const title = courses[code]?.title;
    return `${reEsc(code)}${title ? `(?:\\s+${reEsc(title)})?` : ''}(?:\\s+[A-Z]{2}\\b(?!\\s*\\d))*(?:\\s+\\d+(?:\\.\\d+)?(?:-\\d+)?\\b(?!\\s*\\d))?`;
  };
  const codes = [...new Set([...before, ...Object.keys(courses)])].filter((c) => courses[c]?.title && t.includes(c)).sort((a, b) => b.length - a.length);
  if (codes.length) {
    const item = `(?:${codes.map(one).join('|')})`;
    // only a run of 2+ classes back to back is a list (a class named inside a sentence keeps its title)
    t = t.replace(new RegExp(`${item}(?:\\s+${item})+`, 'g'), (run) => run.match(new RegExp(CODE.source, 'g')).filter((c) => codes.includes(c)).join(', ') + ' ');
  }
  return t.replace(/\s+/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
}
export function matricFacts(program = {}) {
  const info = program.admissionInfo || {};
  const full = String(info.text || '').replace(/\s+/g, ' ').trim();
  let text = sectionText(full, info.before || [], program.courses || {});
  if (!text) text = info.note || (typeof program.admissionNote === 'string' ? program.admissionNote : '') || '';
  const gpaM = full.match(/(?:GPA|grade point average)[^.]{0,60}?(\d\.\d{1,2})/i) || full.match(/(\d\.\d{1,2})[^.]{0,30}?(?:GPA|grade point average)/i);
  const sentences = full.split(/(?<=[.!?])\s+/);
  const deadline = sentences.filter((s) => /\bdeadlines?\b|\bdue (?:by|on)\b|\bapply by\b|\bapplications? (?:are|is) (?:due|accepted)\b/i.test(s)).join(' ') || null;
  return {
    text: text || null,
    minGrade: info.minGrade || null,
    gpa: gpaM ? gpaM[1] : null,
    deadline,
    before: info.before || [],
    beforeFrom: info.beforeFrom || null,
    gated: info.gated || [],
    url: catalogLink(program.url, info.text ? text : ''),
  };
}

// the program's catalog page, scrolled to the matriculation section where the browser supports text
// fragments (Safari 16.1+, Chrome): its first words
export function catalogLink(url, text) {
  if (!url) return null;
  const words = String(text || '').split(/\s+/).filter(Boolean).slice(0, 5);
  if (words.length < 3 || CODE.test(words.join(' '))) return url;
  return `${url.replace(/#.*$/, '')}#:~:text=${encodeURIComponent(words.join(' '))}`;
}

// A class's status for the sheet: 'done' (taken), 'ip' (in progress), a planned term, or ''.
export function codeStatus(code, { done, grades = {}, planned = new Map() } = {}) {
  if (done?.has(code)) return grades[code] === 'IP' ? 'ip' : 'done';
  return planned.get(code) || '';
}

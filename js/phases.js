// Smart Advisor: non-course gates (program admission, University Advanced Standing) and plan phases.
// Pure functions, used by js/planner.js (browser + Node tests).

// Words that mean "you must be accepted into a program first" in a catalog prerequisite.
const ADMIT = /\b(acceptance|accepted|admission|admitted|admittance|matriculat\w*)\b/i;
const STANDING = /\badvanced standing\b/i;
const CODE = /\b[A-Z]{2,4} ?\d{4}[A-Z]?\b/;

// The prerequisite text an undergraduate sees ("Undergraduate course: X. Graduate course: Admission to ...").
function undergradText(t) {
  let s = String(t || '');
  s = s.replace(/^\s*Undergraduate course:\s*/i, '');
  return s.replace(/\bGraduate course:.*$/is, '');
}

// Gates a course needs, from the data's own `gate` field when it has one (sa-data parser), else from the
// prerequisite text. Returns a list: [] | ['admission'] | ['advanced-standing'] | both.
// An acceptance clause written as an alternative to a course ("Admittance into X or MUSC 2500R") is not a gate.
export function gatesOf(course = {}, row = {}) {
  const own = row && 'gate' in row ? row.gate : course && 'gate' in course ? course.gate : undefined;
  if (own !== undefined) return own ? (Array.isArray(own) ? own : [own]) : [];
  const t = undergradText(course?.prereqText);
  if (!t) return [];
  const out = [];
  const clauses = t.split(/[;,]|\band\b/i);
  if (clauses.some((c) => ADMIT.test(c) && !(CODE.test(c) && /\bor\b/i.test(c)))) out.push('admission');
  if (clauses.some((c) => STANDING.test(c) && !(CODE.test(c) && /\bor\b/i.test(c)))) out.push('advanced-standing');
  return out;
}

// The main gate of a list (admission outranks Advanced Standing), or null.
export const mainGate = (gates) => (gates?.includes('admission') ? 'admission' : gates?.includes('advanced-standing') ? 'advanced-standing' : null);

// University Advanced Standing, as the planner models it (NOT verified against UVU policy text):
// ENGL 2010 and the Quantitative Literacy requirement done earlier, and at least this many credits
// done before the term (bachelor's-size programs only; a minor or certificate assumes the student has it).
export const STANDING_RULE = { credits: 24, minProgramCredits: 60, english: 'ENGL 2010', ql: /quantitative literacy/i };

// The plan split into phases for the screen:
//   [{kind:'semesters', phase:'before', label, from, to}, {kind:'milestone', gate:'admission', label, at},
//    {kind:'semesters', phase:'program', label, from, to}]
// from/to/at are semester indexes (a milestone sits just before semester `at`). A program with no admission
// step (or a student already admitted) is one 'all' phase. Advanced Standing is a milestone inside it.
export function planPhases(plan) {
  const n = plan?.semesters?.length || 0;
  const out = [];
  const adm = plan?.admission;
  const st = plan?.standing;
  const stone = (at) => (st && !st.fromStart && st.at === at && st.at > 0 ? [{ kind: 'milestone', gate: 'advanced-standing', label: 'University Advanced Standing', at }] : []);
  const seg = (phase, label, from, to) => {
    if (to < from) return;
    // an Advanced Standing milestone splits the segment it falls in
    if (st && !st.fromStart && st.at > from && st.at <= to) {
      out.push({ kind: 'semesters', phase, label, from, to: st.at - 1 }, ...stone(st.at), { kind: 'semesters', phase, label, from: st.at, to });
    } else out.push({ kind: 'semesters', phase, label, from, to });
  };
  if (adm && !adm.admitted && adm.at != null) {
    const at = Math.min(adm.at, n);
    seg('before', 'Before you apply', 0, at - 1);
    out.push({ kind: 'milestone', gate: 'admission', label: 'Apply to the program', at });
    seg('program', 'Program', at, n - 1);
  } else seg('all', '', 0, n - 1);
  return out;
}

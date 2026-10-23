// Prerequisites always come from the CURRENT catalog (pure; browser + Node).
//
// The catalog year decides which requirements a student must finish (requirements, credits, groups,
// Gen Ed lists). Prerequisites are what the course requires at registration time, which is the current
// catalog: Wolverine Track and Banner enforce today's prereqs, not the ones printed in the student's
// catalog year (ECE 4900: 2025-26 printed only "Advanced Standing", 2026-27 and Banner need ECE 4730).
//
// So when a program loads from an older catalog year, every course that is still in the current catalog
// (data/courses.json) takes its prerequisite fields from there; a course no longer offered keeps its
// old year's fields. Title, credits and everything else stay from the student's catalog year.

// every field the parser writes about what must come before / alongside a course
export const PREREQ_FIELDS = ['prereqs', 'prereqText', 'prereqNonCourse', 'prereqWords', 'prereqMinGrade',
  'precoreqs', 'precoreqText', 'preco', 'coreqs', 'coreqText', 'gate', 'gateText', 'uncertain'];

// one course entry with its prerequisite fields replaced by the current catalog's (cur = current entry);
// `prereqsCurrent: true` marks it, so the class sheet links its prerequisites to the current catalog
export function currentPrereqsOf(old, cur) {
  if (!cur || !old) return old;
  const out = { ...old };
  for (const f of PREREQ_FIELDS) {
    if (cur[f] !== undefined) out[f] = cur[f];
    else delete out[f];
  }
  out.prereqsCurrent = true;
  return out;
}

// a { code: entry } map with every code found in `current` re-based on it (others unchanged)
export function withCurrentPrereqs(courses, current) {
  if (!courses || !current) return courses;
  const out = {};
  for (const [k, c] of Object.entries(courses)) out[k] = currentPrereqsOf(c, current[k]);
  return out;
}

// a program file from an older catalog year -> the same program with current prereqs (no copy when
// there is nothing to apply)
export function programWithCurrentPrereqs(program, current) {
  if (!program?.courses || !current) return program;
  return { ...program, courses: withCurrentPrereqs(program.courses, current) };
}

// a "Needed first" entry cut from a full catalog entry (same shape as scripts/build-prereq-courses.mjs)
export function neededEntry(c) {
  const out = { title: c.title || '', credits: c.credits ?? null };
  if (c.creditsMax != null) out.creditsMax = c.creditsMax;
  out.prereqs = c.prereqs ?? null;
  if (c.prereqText) out.prereqText = c.prereqText;
  return out;
}
const codesIn = (e) => (!e ? [] : typeof e === 'string' ? [e] : (e.and || e.or || []).flatMap(codesIn));

// the "Needed first" catalog (prereq-courses.json) for a program re-based on current prereqs:
// the current file's entries; the old year's entries for codes it lacks (current prereqs when the course
// is still offered); and any outside prereq the current prereqs now name that neither file holds
export function mergePrereqCourses(program, oldYear, currentFile, current) {
  const out = {};
  for (const [k, c] of Object.entries(oldYear || {})) out[k] = current?.[k] ? neededEntry(current[k]) : c;
  Object.assign(out, currentFile || {});
  const own = program?.courses || {};
  if (current) for (const c of Object.values(own)) {
    for (const k of [...codesIn(c.prereqs), ...codesIn(c.precoreqs)]) if (!own[k] && !out[k] && current[k]) out[k] = neededEntry(current[k]);
  }
  return out;
}

// a program from an older catalog year as the planner should see it: { program, extraCourses }.
// current = data/courses.json (null: not loaded -> the old year's data unchanged)
export function forCatalogYear(program, { current, currentPC, yearPC }) {
  if (!current) return { program, extraCourses: yearPC || currentPC };
  const p = programWithCurrentPrereqs(program, current);
  return { program: p, extraCourses: mergePrereqCourses(p, yearPC, currentPC, current) };
}

// the fields compared: same content, ignoring key order and formatting-only differences
export function prereqSig(c) {
  const norm = (v) => (v === undefined || v === null || v === false || (Array.isArray(v) && !v.length) ? null : v);
  const sort = (v) => (Array.isArray(v) ? v.map(sort) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
  return JSON.stringify(PREREQ_FIELDS.map((f) => sort(norm(c?.[f]))));
}

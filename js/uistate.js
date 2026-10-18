// Smart Advisor UI helpers: pure functions used by js/app.js and Node tests (no DOM).

export const REPO = 'TimothyHadfield/smart-advisor';

// ---------- programs in the URL (?p=major,minor) ----------
// ids from ?p= (comma separated), or null when there is none
export function urlPrograms(search) {
  const v = new URLSearchParams(search || '').get('p');
  const ids = String(v || '').split(',').map((s) => s.trim()).filter((s) => /^[\w-]+$/.test(s));
  return ids.length ? [...new Set(ids)] : null;
}

// What a ?p= link does to the saved programs. It never wipes them:
//   - the same major (or a subset of what's saved): the saved plan stays as it is (a bookmark of an
//     older URL keeps the minor added since)
//   - one other program: like tapping it in the picker (a major replaces the major, minors stay;
//     a minor is added)
//   - several programs: that exact combination (a shared link)
// groupOf(id) -> 'major' | 'minor' | 'cert' | ''
export function programsFromLink(saved, ids, groupOf = () => 'major') {
  const have = Array.isArray(saved) ? saved.filter((x) => typeof x === 'string') : [];
  if (!ids?.length) return have;
  if (!have.length) return [...ids];
  if (ids[0] === have[0] && ids.every((x) => have.includes(x))) return have;
  if (ids.length > 1) return [...ids];
  const id = ids[0];
  if (groupOf(id) === 'major' || !groupOf(id)) return [id, ...have.slice(1).filter((x) => x !== id)];
  return have.includes(id) ? have : [...have, id];
}

// the page's URL with ?p= naming the chosen programs (other parameters kept; commas left readable)
export function urlWithPrograms(href, ids) {
  const u = new URL(href);
  const rest = [...u.searchParams].filter(([k]) => k !== 'p').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  const p = ids?.length ? [`p=${ids.map(encodeURIComponent).join(',')}`] : [];
  const q = [...p, ...rest].join('&');
  return `${u.origin}${u.pathname}${q ? `?${q}` : ''}${u.hash}`;
}

// A first visit: nothing chosen, nothing taken or imported, and no ?p= link
export function isFirstVisit(state, ids) {
  if (ids?.length) return false;
  if (state?.plan?.programs?.length) return false;
  const any = (o) => !!o && Object.values(o).some((v) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : !!v));
  return !any(state?.done) && !any(state?.grades) && !any(state?.audit);
}

// ---------- Clear taken (with undo) ----------
// clears the major's taken classes, grades, imported term, hypothetical taps and sources (js/classes.js);
// returns what Undo needs
export function clearTaken(state, major) {
  const snap = { major, done: [...(state.done?.[major] || [])], grades: { ...(state.grades?.[major] || {}) }, lastTerm: state.settings?.lastTerm ?? null,
    hypo: state.settings?.hypo?.[major] ?? null, src: state.settings?.src?.[major] ?? null };
  state.done ??= {}; state.grades ??= {}; state.settings ??= {};
  state.done[major] = [];
  state.grades[major] = {};
  state.settings.lastTerm = null; // null, not deleted, so other devices clear it too
  if (state.settings.hypo?.[major]) state.settings.hypo = { ...state.settings.hypo, [major]: { add: [], del: [] } };
  if (state.settings.src?.[major]) state.settings.src = { ...state.settings.src, [major]: {} };
  return snap;
}
export function undoClear(state, snap) {
  if (!snap) return state;
  state.done ??= {}; state.grades ??= {}; state.settings ??= {};
  state.done[snap.major] = [...snap.done];
  state.grades[snap.major] = { ...snap.grades };
  state.settings.lastTerm = snap.lastTerm;
  if (snap.hypo) state.settings.hypo = { ...(state.settings.hypo || {}), [snap.major]: snap.hypo };
  if (snap.src) state.settings.src = { ...(state.settings.src || {}), [snap.major]: snap.src };
  return state;
}

// ---------- labels + links ----------
// "Pick 1", "Pick 2", "Pick 6 cr"
export function pickLabel(pick) {
  if (!pick) return 'Pick 1';
  if (pick.credits != null) return `Pick ${pick.credits} cr`;
  return `Pick ${pick.count ?? 1}`;
}

export const courseURL = (code) => `https://catalog.uvu.edu/search/?P=${encodeURIComponent(code)}`;

// a prefilled GitHub issue on the public repo (no email shown anywhere)
export function issueURL({ program = '', programId = '', year = '', code = '', title = '' } = {}) {
  const what = [code, title].filter(Boolean).join(' ');
  const t = `Mistake: ${[program || programId, code].filter(Boolean).join(' · ')}`;
  const body = [
    `Program: ${program}${programId ? ` (${programId}${year ? `, catalog ${year}` : ''})` : ''}`,
    what ? `Class: ${what}` : '',
    '',
    'What is wrong:',
    '',
  ].filter((l, i) => l || i > 1).join('\n');
  return `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(t)}&body=${encodeURIComponent(body)}`;
}

// ---------- plan phases (admission programs) ----------
// The semester index the "Apply" row goes before, or -1. Reads whichever the planner provides:
//   phases = [{ name|key|phase, start|from|semesters|terms }] (from planPhases(plan) or plan.phases)
//   or each semester's own `phase`
const isPre = (v) => /before|pre|prereq/i.test(String(v || ''));
export function applyIndex(plan, phases) {
  const sems = plan?.semesters || [];
  if (!sems.length) return -1;
  const list = Array.isArray(phases) ? phases : Array.isArray(plan?.phases) ? plan.phases : null;
  // js/phases.js planPhases: { kind: 'milestone', gate: 'admission', at } sits just before semester `at`
  const stone = list?.find((ph) => ph?.kind === 'milestone' && ph.gate === 'admission');
  if (stone) return Number.isInteger(stone.at) && stone.at >= 0 && stone.at < sems.length ? stone.at : -1;
  if (list?.some((ph) => ph?.kind === 'milestone' || ph?.kind === 'semesters')) return -1;
  if (list?.length) {
    const prog = list.find((ph) => !isPre(ph?.name ?? ph?.key ?? ph?.phase ?? ph?.id) && !/apply/i.test(String(ph?.name ?? ph?.key ?? ph?.phase ?? '')));
    const hasPre = list.some((ph) => isPre(ph?.name ?? ph?.key ?? ph?.phase ?? ph?.id));
    if (!prog || !hasPre) return -1;
    let i = -1;
    const at = prog.start ?? prog.from ?? prog.index;
    if (Number.isInteger(at)) i = at;
    else if (Array.isArray(prog.semesters) && prog.semesters.length) {
      const s = prog.semesters[0];
      i = Number.isInteger(s) ? s : sems.findIndex((x) => x.term === (s?.term ?? s));
    } else if (Array.isArray(prog.terms) && prog.terms.length) i = sems.findIndex((x) => x.term === prog.terms[0]);
    return i >= 0 && i <= sems.length ? i : -1;
  }
  const k = sems.findIndex((s, j) => j > 0 && s.phase && !isPre(s.phase) && isPre(sems[j - 1].phase));
  return k;
}

// ---------- tracks ----------
// a group's real tracks (ones that have courses), in catalog order
export function tracksOf(g) {
  if (!g?.tracks) return [];
  return g.tracks.filter((t) => (g.options || []).some((o) => o.section === t));
}

// Every milestone row the plan screen shows, as [{ at, gate }] sorted by semester index: program admission
// ("Apply") and University Advanced Standing. A milestone at the very start or past the end is not shown.
export function milestonesOf(plan, phases) {
  const n = plan?.semesters?.length || 0;
  const list = Array.isArray(phases) ? phases : [];
  const out = list.filter((ph) => ph?.kind === 'milestone' && Number.isInteger(ph.at) && ph.at > 0 && ph.at < n)
    .map((ph) => ({ at: ph.at, gate: ph.gate }));
  if (!out.some((m) => m.gate === 'admission')) { const at = applyIndex(plan, phases); if (at > 0) out.push({ at, gate: 'admission' }); }
  // admission first when both fall before the same semester
  return out.sort((a, b) => a.at - b.at || (a.gate === 'admission' ? -1 : 1));
}

// What a class needs besides other classes, for the class sheet: the catalog's own words (gate text, then
// any other prerequisite words), else plain names of the gates. ["Formal Acceptance into ...", "University Advanced Standing"]
const GATE_NAME = { admission: 'Acceptance into the program', 'advanced-standing': 'University Advanced Standing' };
const tidy = (w) => String(w || '').replace(/^[\s(,;]+|[\s),;.]+$/g, '').replace(/\s+/g, ' ').trim();
export function needsOf(course = {}, gates = []) {
  const out = [];
  const has = (w) => out.some((x) => x.toLowerCase().includes(w.toLowerCase()));
  const add = (w) => { const t = tidy(w); if (t && !has(t)) out.push(t); };
  if (course.gateText) add(course.gateText);
  for (const w of course.prereqWords || []) add(w);
  for (const g of gates || []) {
    const name = GATE_NAME[g];
    if (!name) continue;
    const covered = g === 'admission' ? out.some((x) => /accept|admi|matricul/i.test(x)) : out.some((x) => /advanced standing/i.test(x));
    if (!covered) out.push(name);
  }
  return out;
}

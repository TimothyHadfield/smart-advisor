// Programs: the catalog's list of majors / minors / certificates, the picker's search, matching the
// programs named in an audit header, and joining a major + minor into one program for the planner.
// Pure: no DOM, no fetch (js/app.js loads the files). Used by js/app.js and tests/programs.test.mjs.
//
// data/programs/index.json  { catalogYear | catalogYears, programs: [{ id, name, type, ... , years? }] }
// data/programs/<id>.json   the current catalog's program (same shape as ee-bs.json)
// data/<year>/programs/<id>.json   an archived catalog year's program

// ---------- groups ----------
// type in the index varies ("BS", "minor", "certificate", "graduate-certificate", "AAS", ...): three groups
export function programGroup(p) {
  const t = String(p?.type || '').toLowerCase();
  if (/minor/.test(t)) return 'minor';
  if (/cert|licensure|endorsement/.test(t)) return 'cert';
  return 'major';
}

// ---------- search ----------
export const norm = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const words = (s) => norm(s).split(' ').filter(Boolean);

/**
 * Programs matching a typed query, in one group (or all when group is falsy).
 * Every typed word must start a word of the name (or of its department / major): "nurs" -> Nursing,
 * "env sci" -> Environmental Science and Management. Names that start with the query come first,
 * then A-Z.
 */
// opts.year: only programs offered in that catalog year (entries without years always pass);
// opts.graduate: include graduate programs (hidden by default)
export function filterPrograms(list, query = '', group = null, opts = {}) {
  const q = words(query);
  const out = [];
  for (const p of list || []) {
    if (group && programGroup(p) !== group) continue;
    if (!opts.graduate && /grad/i.test(p.level || '') && !/under/i.test(p.level || '')) continue;
    if (opts.year && Array.isArray(p.years) && p.years.length && !p.years.includes(opts.year)) continue;
    if (!q.length) { out.push({ p, rank: 1 }); continue; }
    const name = words(p.name);
    const extra = [...words(p.department), ...words(p.major)];
    let ok = true, rank = 1;
    for (const w of q) {
      if (name.some((x) => x.startsWith(w))) continue;
      if (extra.some((x) => x.startsWith(w))) { rank = 2; continue; }
      ok = false; break;
    }
    if (!ok) continue;
    if (rank === 1 && norm(p.name).startsWith(q.join(' '))) rank = 0;
    out.push({ p, rank });
  }
  return out.sort((a, b) => a.rank - b.rank || String(a.p.name).localeCompare(String(b.p.name))).map((x) => x.p);
}

// ---------- catalog years ----------
// Years a program can be loaded for, newest first, and the current one.
export function catalogInfo(index, catalogs) {
  const cur = index?.current || index?.catalogYear || catalogs?.current || null;
  const all = new Set([...(index?.catalogYears || []), ...Object.keys(catalogs?.years || {}), ...(cur ? [cur] : [])]);
  const years = [...all].sort().reverse();
  return { current: cur || years[0] || null, years };
}
export function programYears(entry, info) {
  const ys = entry?.years?.length ? [...entry.years] : info.years;
  return [...new Set(ys)].sort().reverse();
}
/** The catalog year to load a program for: the wanted one if the program has it, else its newest. */
export function yearFor(entry, want, info) {
  const ys = Array.isArray(entry?.years) && entry.years.length ? [...entry.years].sort().reverse() : null;
  const w = want || info.current;
  if (!ys || ys.includes(w)) return w;
  return ys[0];
}
/** Where a program's JSON lives for a catalog year (the current year, or no year: data/programs/). */
export function programPath(id, year, info, base = 'data') {
  if (!year || year === info.current) return `${base}/programs/${id}.json`;
  return `${base}/${year}/programs/${id}.json`;
}

// ---------- audit header -> programs ----------
// parsed = parseAudit(text): { majors: ["Electrical Engineering"], minors: [...], programs: ["Electrical Engineering-BS"] }
// Returns [{ id, role: 'major'|'minor', label }] (majors first), each a program in the list.
const DEG = { bs: ['bs'], ba: ['ba'], bas: ['bas'], as: ['as'], aa: ['aa'], aas: ['aas'], bfa: ['bfa'], bm: ['bm'], bsw: ['bsw'], asn: ['asn'], ape: ['ape'] };
const nameOnly = (s) => norm(String(s).replace(/,\s*(minor|[A-Z]\.[A-Z.]*\.?)\s*$/i, ''));
export function auditPrograms(parsed, list) {
  const out = [];
  const used = new Set();
  const pick = (want, group, deg) => {
    const n = norm(want);
    const cands = (list || []).filter((p) => programGroup(p) === group && !used.has(p.id));
    // same name; a major: the degree from "Program ...-BS" decides between B.S. / B.A. / A.S.
    let hits = cands.filter((p) => nameOnly(p.name) === n || norm(p.major) === n);
    if (!hits.length) hits = cands.filter((p) => nameOnly(p.name).startsWith(n + ' ') || n.startsWith(nameOnly(p.name) + ' '));
    if (deg && hits.length > 1) {
      const d = hits.filter((p) => norm(p.type).replace(/ /g, '') === deg || norm(p.degree).replace(/ /g, '') === deg);
      if (d.length) hits = d;
    }
    // no degree known: a bachelor's before an associate's
    hits.sort((a, b) => (/^b/i.test(b.type) ? 1 : 0) - (/^b/i.test(a.type) ? 1 : 0) || String(a.name).localeCompare(String(b.name)));
    return hits[0] || null;
  };
  const progs = (parsed?.programs || []).map((s) => {
    const m = String(s).match(/^(.*?)[-\s]+([A-Za-z]{2,4})$/);
    return m ? { name: m[1], deg: m[2].toLowerCase() } : { name: s, deg: null };
  });
  for (const major of parsed?.majors || []) {
    const pr = progs.find((x) => norm(x.name) === norm(major)) || progs[0];
    const p = pick(major, 'major', pr && DEG[pr.deg] ? pr.deg : null);
    if (p) { used.add(p.id); out.push({ id: p.id, role: 'major', label: p.name }); }
  }
  if (!out.length) for (const pr of progs) {
    const p = pick(pr.name, 'major', pr.deg);
    if (p) { used.add(p.id); out.push({ id: p.id, role: 'major', label: p.name }); }
  }
  for (const minor of parsed?.minors || []) {
    const p = pick(minor, 'minor');
    if (p) { used.add(p.id); out.push({ id: p.id, role: 'minor', label: p.name }); }
  }
  return out;
}

// ---------- major + minor -> one program ----------
/**
 * parts = [{ id, name, program }] (the major first). Returns one program for buildModel:
 *   - the first program's requirements unchanged (so its box ids, "ph:6" / "choice:3", stay the same)
 *   - later programs' requirements tagged prog = their id, with ids "<id>/ph:3", "<id>/choice:4"
 *   - shared courses counted once: a later course already required is dropped; a later "pick" group
 *     loses the options already required (count / credits lowered by them; gone when nothing is left);
 *     a Gen Ed box with the same name as one already there is dropped
 *   - courses merged; totalCredits = the union's
 * parts of the result: [{ id, name, shared }] (shared = requirements dropped as already counted).
 * shared of the result: [{ code, name }] each class counted once for both (name = the later program).
 */
export function combinePrograms(parts) {
  if (!parts?.length) return null;
  if (parts.length === 1) return { ...parts[0].program, parts: [{ id: parts[0].id, name: parts[0].program.name, shared: 0 }] };
  const requirements = [];
  const courses = {};
  const required = new Set();
  const phLabels = new Set();
  const choiceLabels = new Set();
  const info = [];
  const sharedList = []; // [{ code, name }]: a class one program requires that a later one counts too
  const share = (codes, name) => { for (const c of codes) if (required.has(c) && !sharedList.some((x) => x.code === c && x.name === name)) sharedList.push({ code: c, name }); };
  parts.forEach((part, k) => {
    const prog = part.program;
    let shared = 0;
    for (const [c, v] of Object.entries(prog.courses || {})) courses[c] ??= v;
    prog.requirements.forEach((r, i) => {
      if (k === 0) { requirements.push(r); remember(r); return; }
      const tag = { prog: part.id };
      if (r.type === 'course') {
        if ([r.code, ...(r.alts || [])].some((c) => required.has(c))) { shared++; share([r.code, ...(r.alts || [])], prog.name); return; }
        requirements.push({ ...r, ...tag });
      } else if (r.type === 'placeholder') {
        if (phLabels.has(norm(r.label))) { shared++; return; }
        requirements.push({ ...r, ...tag, id: `${part.id}/ph:${i}` });
      } else if (r.type === 'choice') {
        if (choiceLabels.has(norm(r.label)) && /general\s+education/i.test(r.area || '')) { shared++; return; }
        const covered = (r.options || []).filter((o) => o.codes.every((c) => required.has(c)));
        let { pick, credits } = r;
        if (covered.length) {
          shared++;
          share(covered.flatMap((o) => o.codes), prog.name);
          if (pick?.credits) {
            const less = covered.reduce((s, o) => s + (o.credits || 0), 0);
            pick = { ...pick, credits: Math.max(0, pick.credits - less) };
            credits = pick.credits;
          } else {
            const need = pick?.count ?? 1;
            const left = Math.max(0, need - covered.length);
            pick = { ...(pick || {}), count: left };
            credits = Math.round(((r.credits || 0) * left) / need);
          }
          if ((pick.credits ?? pick.count) <= 0) return;
        }
        requirements.push({ ...r, ...tag, id: `${part.id}/choice:${i}`, pick, credits, options: (r.options || []).filter((o) => !covered.includes(o)) });
      }
      remember(requirements[requirements.length - 1]);
    });
    info.push({ id: part.id, name: prog.name, shared });
  });
  function remember(r) {
    if (r.type === 'course') [r.code, ...(r.alts || [])].forEach((c) => required.add(c));
    else if (r.type === 'placeholder') phLabels.add(norm(r.label));
    else if (r.type === 'choice') choiceLabels.add(norm(r.label));
  }
  const first = parts[0].program;
  const totalCredits = requirements.reduce((s, r) => s + (r.type === 'choice' ? (r.pick?.credits ?? r.credits ?? 0) : (r.credits ?? courses[r.code]?.credits ?? 0)), 0);
  return {
    id: parts.map((p) => p.id).join('+'),
    name: parts.map((p) => p.program.name).join(' + '),
    totalCredits,
    requirements,
    gradPlan: first.gradPlan || [],
    courses,
    parts: info,
    shared: sharedList,
  };
}

// A short name for a minor's section heading: "Environmental Science and Management, Minor" -> as is,
// a long one cut to ~40 characters at a word.
export function shortName(name, max = 40) {
  const s = String(name || '');
  if (s.length <= max) return s;
  return s.slice(0, s.lastIndexOf(' ', max)).replace(/[,\s]+$/, '') + '…';
}

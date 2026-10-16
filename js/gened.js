// Gen Ed class lists (pure; data from data/gened.json, built by scripts/fetch-gened.mjs).
//
// A program's Gen Ed box ("Fine Arts Distribution", "Biology or Physical Science", "American Institutions")
// is matched to the catalog's Gen Ed areas by words. Picking a class from the list marks the box taken and
// remembers the class in the same taken list: "<box id>=<code>" (e.g. "ph:7=DANC 1010"), so it syncs
// with the account like any other taken key (no new fields).

// area key -> words in a program's box label (typos seen in the catalog included)
export const GE_WORDS = [
  ['wc', /\benglish\b|\bwriting\b|composition/],
  ['ql', /quantitativ|\bmath|\bql\b|statistic/],
  ['ai', /american institution|\bus institution|\bamerican\b.*\binstitution|institutions?\b/],
  ['pg', /personal|civic/],
  ['arts', /fine art|\barts?\b/],
  ['hum', /\bhuman[it]|foreign language/],
  ['life', /biolog|life science/],
  ['phys', /physical science/],
  ['soc', /social|behavi?or|political science/],
];

/** A box label -> the Gen Ed area keys it names, in the order above ([] when none). */
export function areasFor(label) {
  const s = String(label || '')
    .toLowerCase()
    .replace(/\([^)]*\)?/g, ' ') // "(COMM 1020 recommended)", "(Choose from list: https://…)"
    .replace(/https?:\S+/g, ' ');
  return GE_WORDS.filter(([, re]) => re.test(s)).map(([k]) => k);
}

/**
 * The class list for a flowchart box, or null when it has none.
 *   node   : a planner unit (placeholder / choice) with label, area, options
 *   gened  : data/gened.json ({ areas })
 *   opts.aas    : the program is an Associate of Applied Science (its own English / math lists)
 *   opts.courses: catalog courses ({ code: {title, credits} }) for a choice box's own options
 * A choice box with options lists those (they are what the program accepts); anything else lists the
 * catalog areas its label names. Returns { name, groups: [{ key, name, courses: [{code, title, credits}] }] }.
 */
export function genEdList(node, gened, { aas = false, courses = {} } = {}) {
  if (!node || (node.kind !== 'placeholder' && node.kind !== 'choice')) return null;
  if (!/general\s+education/i.test(node.area || '')) return null;
  if (node.kind === 'choice' && node.options?.length) {
    const list = node.options.map((o) => {
      const code = o.codes.join(' + ');
      const title = o.codes.map((c) => courses[c]?.title || '').filter(Boolean).join(' + ');
      return { code, codes: [...o.codes], title, credits: o.credits ?? null };
    });
    return { name: node.label, groups: [{ key: 'opts', name: '', courses: list }] };
  }
  const keys = areasFor(node.label);
  const areas = gened?.areas || [];
  const groups = keys.map((k) => areas.find((a) => a.key === k && !!a.aas === aas) || areas.find((a) => a.key === k && !a.aas)).filter(Boolean)
    .map((a) => ({ key: a.key, name: a.name, courses: a.courses }));
  if (!groups.length) return null;
  return { name: node.label, groups };
}

/** Search a list's classes by code or title words ("danc", "dance", "DANC1010"). */
export function filterList(list, q) {
  const words = String(q || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return list.groups;
  const hit = (c) => {
    const hay = `${c.code} ${c.code.replace(/\s+/g, '')} ${(c.alts || []).join(' ')} ${c.title}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  };
  return list.groups.map((g) => ({ ...g, courses: g.courses.filter(hit) })).filter((g) => g.courses.length);
}

// ---------- the chosen class, kept in the taken list ----------
export const pickKey = (id, code) => `${id}=${code}`;
/** The class picked for a box (from the taken list), or null. */
export function pickedOf(taken, id) {
  const pre = `${id}=`;
  for (const k of taken) if (typeof k === 'string' && k.startsWith(pre)) return k.slice(pre.length);
  return null;
}
/** Taken list with the box taken by a class (any earlier pick replaced). codes: course codes to add too. */
export function withPick(taken, id, code, codes = []) {
  const out = new Set([...taken].filter((k) => !(typeof k === 'string' && k.startsWith(`${id}=`))));
  out.add(id);
  out.add(pickKey(id, code));
  for (const c of codes) out.add(c);
  return out;
}
/** The pick keys of a box (to remove when it's untaken). */
export const pickKeysOf = (taken, id) => [...taken].filter((k) => typeof k === 'string' && k.startsWith(`${id}=`));

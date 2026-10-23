// Short class names on the flowchart boxes (Tim, 2026-10-22: "Calculus 3 -> Calc 3", "Physics for Scientists
// and Engineers II --> Phys 2"). data/short-titles.json maps a full catalog title to its short name
// (scripts/build-short-titles.mjs); a title it doesn't list is already short and shows as it is.
// The full title stays on the class sheet and is read out by screen readers. Pure, no DOM.

export const shortTitle = (map, title) => (title && map?.[title]) || title || '';

// a pick-one option of several classes: "Chem 1 + Lab" (a part that repeats the first one's name drops it)
export function shortJoin(names) {
  const [first, ...rest] = names.filter(Boolean);
  if (!first) return '';
  // a series: "US History 1" + "US History 2" -> "US History 1 + 2"
  const stem = (n) => n.replace(/\s+\S+$/, '');
  if (rest.length && first.includes(' ') && rest.every((n) => stem(n) === stem(first))) {
    return [first, ...rest.map((n) => n.slice(stem(first).length + 1))].join(' + ');
  }
  return [first, ...rest.map((n) => (n.startsWith(first + ' ') ? n.slice(first.length + 1) : n))].join(' + ');
}

// an option box's code line: "ACC 1110 + ACC 1120" -> "ACC 1110 + 1120" (a repeated subject is dropped)
export function shortCodes(label) {
  const parts = String(label || '').split(' + ');
  const subj = (c) => /^([A-Z]{2,5}) /.exec(c)?.[1];
  return parts.map((c, i) => (i && subj(c) && subj(c) === subj(parts[i - 1]) ? c.slice(subj(c).length + 1) : c)).join(' + ');
}

// an option box's code line as { code, more }: a lecture + its lab -> "BIOL 1610" + "+Lab" (the small tag a
// folded lab box already shows); 3+ classes -> the first + "+2"; else "ACC 1110 + 1120"
export function optionCode(node, courses = {}) {
  const codes = node?.codes || [];
  if (codes.length === 2 && /\blab(oratory)?\b/i.test(courses[codes[1]]?.title || '') && codes[1].split(' ')[0] === codes[0].split(' ')[0]) return { code: codes[0], more: '+Lab' };
  if (codes.length > 2) return { code: codes[0], more: `+${codes.length - 1}` };
  return { code: shortCodes(node?.label || codes.join(' + ')), more: '' };
}

// a requirement row's short label (its box and its plan row): data.labels maps the catalog wording
// ("Complete 24 credits from any ART/ARTH courses ...") to "ART/ARTH elective"; '' there means the wording
// only says "pick from the list", so the requirement group's name shows instead (data.names shortens it)
export const NO_NAME = 'Pick from list';
export function reqName(data, label, groupName = '') {
  const s = data?.labels?.[label];
  if (s === '') return groupName ? (data?.names?.[groupName] ?? groupName) : NO_NAME;
  return s ?? label ?? '';
}

// the short name a box shows: course box = its title's; option box = a hand name for the whole option
// ("Statics & Strength"), else its classes' names joined
export function boxName(map, node, courses = {}) {
  if (node?.kind === 'option' && (node.codes || []).length > 1) {
    return map?.[node.title] || shortJoin(node.codes.map((c) => shortTitle(map, courses[c]?.title)));
  }
  return shortTitle(map, node?.title);
}

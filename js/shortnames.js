// Short class names on the flowchart boxes (Tim, 2026-10-22: "Calculus 3 -> Calc 3", "Physics for Scientists
// and Engineers II --> Phys 2"). data/short-titles.json maps a full catalog title to its short name
// (scripts/build-short-titles.mjs); a title it doesn't list is already short and shows as it is.
// The full title stays on the class sheet and is read out by screen readers. Pure, no DOM.

export const shortTitle = (map, title) => (title && map?.[title]) || title || '';

// a pick-one option of several classes: "Chem 1 + Lab" (a part that repeats the first one's name drops it)
export function shortJoin(names) {
  const [first, ...rest] = names.filter(Boolean);
  if (!first) return '';
  return [first, ...rest.map((n) => (n.startsWith(first + ' ') ? n.slice(first.length + 1) : n))].join(' + ');
}

// the short name a box shows: course box = its title's; option box = a hand name for the whole option
// ("Statics & Strength"), else its classes' names joined
export function boxName(map, node, courses = {}) {
  if (node?.kind === 'option' && (node.codes || []).length > 1) {
    return map?.[node.title] || shortJoin(node.codes.map((c) => shortTitle(map, courses[c]?.title)));
  }
  return shortTitle(map, node?.title);
}

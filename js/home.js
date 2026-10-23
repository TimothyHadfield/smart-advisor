// Home screen helpers: pure functions used by js/app.js and Node tests (no DOM).
// Tim, 2026-10-22: "make a home page with the user's name and major and any core details about them in
// the home page and then allow them to go into their flowchart or class schedule seperately."
// Tim, 2026-10-23: "the home page shouldn't have any top bar and all the info should be in a list ... The
// homepage should have the user's name, their major/minor with graduation progress, catelog year, and current
// GPA ... Put their graduation month/year and then the schedule and flowchart boxes"
import { countedOptions, outsideClasses } from './planner.js';

// the screens: Home, and the sections it opens (each a screen of its own with a back arrow)
export const TABS = ['home', 'flow', 'plan', 'sched', 'profile', 'settings'];

// The screen the app opens on:
//   - a reload / Back-Forward into the page: the screen it was on (history.state)
//   - a ?p= link that opens a program the student doesn't already have (a shared link, an old bookmark
//     of another program, a first visit from a link): that program's flowchart, like before Home existed
//   - otherwise (typed address, home-screen icon, a link naming the saved programs): Home
export function startTab(navState, saved, link) {
  if (navState?.sa && TABS.includes(navState.tab)) return navState.tab;
  const have = Array.isArray(saved) ? saved : [];
  if (link?.length && !(have.length && link[0] === have[0] && link.every((x) => have.includes(x)))) return 'flow';
  return 'home';
}

// Progress toward each chosen program, from the plan: [{ id, taken, ip, left, total, pct }], major first.
//   completed = the classes counted (finished + in progress), finished = the same without the in-progress ones
//   (both Sets of the taken keys, like the planner's), plan = makePlan's result, ids = [major, ...minors].
// A minor's classes are the units tagged with its id (js/programs.js combinePrograms); everything else is the
// major's, including classes from outside the program and "Needed first" boxes, so with no minor the major's
// total is exactly the plan's total (plan.totals.credits). A class a major and minor share counts once, for
// the major. pct = finished classes only, like the credits line before it (in progress shown apart).
export function programProgress(model, completed, finished, plan, ids) {
  const byId = new Map();
  for (const u of model?.units || []) { byId.set(u.id, u); for (const o of u.options || []) byId.set(o.id, o); }
  const progOf = (u) => (u?.prog && ids.includes(u.prog) && u.prog !== ids[0] ? u.prog : ids[0]);
  const doneBy = (set) => {
    const out = new Map(ids.map((id) => [id, 0]));
    const add = (u, cr) => out.set(progOf(u), out.get(progOf(u)) + (Number(cr) || 0));
    for (const u of model?.units || []) {
      if (u.kind === 'course' && !u.outside) { if (u.codes.some((k) => set.has(k))) add(u, u.credits); }
      else if (u.kind === 'choice') {
        for (const o of countedOptions(u, set)) add(u, o.credits);
        if (set.has(u.id)) add(u, u.pick?.credits ?? u.credits);
      } else if (u.kind === 'placeholder' && set.has(u.id)) add(u, u.credits);
    }
    for (const x of model ? outsideClasses(model, set) : []) out.set(ids[0], out.get(ids[0]) + x.credits);
    return out;
  };
  const all = doneBy(completed), fin = doneBy(finished);
  const left = new Map(ids.map((id) => [id, 0]));
  for (const s of plan?.semesters || []) for (const it of s.items) {
    const u = byId.get(it.unitId);
    const g = u?.kind === 'option' ? byId.get(u.group) || u : u;
    const id = progOf(g);
    left.set(id, left.get(id) + (Number(it.credits) || 0));
  }
  return ids.map((id) => {
    const taken = round(fin.get(id)), ip = round(Math.max(0, all.get(id) - fin.get(id))), l = round(left.get(id));
    const total = round(taken + ip + l);
    return { id, taken, ip, left: l, total, pct: total ? Math.floor((taken / total) * 100) : 0 };
  });
}
const round = (x) => Math.round(x * 10) / 10;

// "May 2028" for a plan ending Spring 2028 (classes end in May; Summer in August, Fall in December)
const END = { Spring: 'May', Summer: 'Aug', Fall: 'Dec' };
export function gradMonth(term) {
  const [season, year] = String(term || '').split(' ');
  return END[season] && /^\d{4}$/.test(year || '') ? `${END[season]} ${year}` : '';
}

// A typed name with each word's first letter capitalized ("tim hadfield" -> "Tim Hadfield"); letters the
// student typed in capitals stay ("McDonald"), and parts after an apostrophe or hyphen count as words
// ("o'neil" -> "O'Neil", "mary-jane" -> "Mary-Jane"). Extra spaces go.
export function capName(s) {
  return String(s ?? '').trim().replace(/\s+/g, ' ')
    .replace(/(^|[\s'’-])(\p{Ll})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

// The greeting's name: the one the student set in Profile, else the account's (capitalized when Google
// gives it all in lowercase), else the email's first part; null when there is none
export function displayName(user, own) {
  const mine = capName(own);
  if (mine) return mine;
  if (!user) return null;
  const n = String(user.name || '').trim();
  if (n) return n === n.toLowerCase() ? capName(n) : n.replace(/\s+/g, ' ');
  const e = String(user.email || '').split('@')[0].trim();
  return e || null;
}

// "2025-26" from "2025-2026"
export const catalogShort = (y) => (y && /^\d{4}-\d{4}$/.test(y) ? `${y.slice(0, 5)}${y.slice(7)}` : y || '');
// "Catalog 2025-26" from "2025-2026"
export const catalogLabel = (y) => (y ? `Catalog ${catalogShort(y)}` : '');

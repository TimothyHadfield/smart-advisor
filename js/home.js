// Home screen helpers: pure functions used by js/app.js and Node tests (no DOM).
// Tim, 2026-10-22: "make a home page with the user's name and major and any core details about them in
// the home page and then allow them to go into their flowchart or class schedule seperately."

export const TABS = ['home', 'flow', 'plan', 'sched'];

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

// Credits toward the degree, from the plan: finished + in progress + what the plan still adds.
// total = what this plan adds up to (plan.totals.credits: finished, current and planned classes), so the
// bar's parts always add up to it. -> { taken, ip, left, total, pct, segs: [{ k: 'done'|'ip'|'sem', cr, i?, term? }] }
export function creditBar(plan, ipCredits = 0) {
  const left = Math.max(0, Number(plan?.creditsLeft) || 0);
  const total = Math.max(left, Number(plan?.totals?.credits) || 0);
  const doneAll = Math.max(0, total - left);
  const ip = Math.min(Math.max(0, ipCredits || 0), doneAll);
  const taken = round(doneAll - ip);
  const segs = [{ k: 'done', cr: taken }, { k: 'ip', cr: round(ip) }]
    .concat((plan?.semesters || []).map((s, i) => ({ k: 'sem', i, cr: s.credits, term: s.term })))
    .filter((s) => s.cr > 0);
  return { taken, ip: round(ip), left: round(left), total: round(total), pct: total ? Math.floor((taken / total) * 100) : 0, segs };
}
const round = (x) => Math.round(x * 10) / 10;

// Program admission (matriculation) as one short fact, or null when the program has none.
//   admitted -> 'Admitted'; the plan's Apply row before semester `at` -> 'Apply after <term before it>'
//   (at 0: 'Apply now'); an admission-only program the plan has no row for -> 'Required'
export function admissionFact(plan, program, applyAt) {
  if (plan?.admission) {
    if (plan.admission.admitted) return 'Admitted';
    const sems = plan.semesters || [];
    if (Number.isInteger(applyAt) && applyAt > 0 && sems[applyAt - 1]) return `Apply after ${sems[applyAt - 1].term}`;
    return applyAt === 0 ? 'Apply now' : 'Required';
  }
  return program?.admission ? 'Required' : null;
}

// "Fall 2026 · 15 cr" for the next planned semester ('' when none)
export function nextFact(plan) {
  const s = plan?.semesters?.[0];
  if (!s) return '';
  return `${s.term} · ${s.credits} cr`;
}

// The greeting's name: the account's name, else its email's first part; null when signed out
export function displayName(user) {
  if (!user) return null;
  const n = String(user.name || '').trim();
  if (n) return n;
  const e = String(user.email || '').split('@')[0].trim();
  return e || null;
}

// "Catalog 2025-26" from "2025-2026"
export const catalogLabel = (y) => (y && /^\d{4}-\d{4}$/.test(y) ? `Catalog ${y.slice(0, 5)}${y.slice(7)}` : y ? `Catalog ${y}` : '');

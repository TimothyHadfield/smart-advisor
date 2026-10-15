// Post-processing of a parsed UVU catalog program (after the course catalog is known).
// Pure functions; used by scripts/fetch-program.mjs and scripts/fetch-all.mjs, tested in tests/parser.test.mjs.

// ---------- Gen Ed categories ----------
// A choice in a Gen Ed area is recognised by the subjects of its options; its name then comes from the
// sample plan label of the same category, or the plain category name.
const AI_CODES = new Set(['HIST 1700', 'HIST 1740', 'HIST 2700', 'HIST 2710', 'POLS 1000', 'POLS 1100', 'ECON 1740']);
export const GE_CATS = [
  { key: 'ai', name: 'American Institutions', label: /american|institution/i, subj: (c) => AI_CODES.has(c) || /^(?:HIST|POLS) /.test(c) },
  { key: 'math', name: 'Quantitative Literacy', label: /\bmath|quantitative|\bQL\b|statistic/i, subj: (c) => /^(?:MATH|MAT|STAT) /.test(c) },
  { key: 'eng', name: 'English', label: /english|writing|composition/i, subj: (c) => /^ENGL /.test(c) },
  { key: 'bio', name: 'Biology', label: /biolog|life science/i, subj: (c) => /^(?:BIOL|BOT|ZOOL|MICR) /.test(c) },
  { key: 'phys', name: 'Physical Science', label: /physical science/i, subj: (c) => /^(?:CHEM|PHYS|GEO|ASTR|PHSC|METO) /.test(c) },
  { key: 'fine', name: 'Fine Arts', label: /fine art/i, subj: (c) => /^(?:ART|ARTH|MUSC|THEA|DANC) /.test(c) },
  { key: 'soc', name: 'Social/Behavioral Science', label: /social|behavio/i, subj: (c) => /^(?:PSY|SOC|ANTH|ECON|GEOG|FAMS|SOSC) /.test(c) },
  { key: 'comm', name: 'Communication', label: /communicat/i, subj: (c) => /^COMM /.test(c) },
];
const isGenArea = (area) => !area || /general\s+education/i.test(area);
const catOfLabel = (label) => GE_CATS.find((c) => c.label.test(label)) || null;
function catOfChoice(it) {
  const codes = it.options.flatMap((o) => o.codes);
  if (!codes.length) return null;
  // the American Institutions list is recognised anywhere; other categories only in a Gen Ed area
  if (codes.every((c) => AI_CODES.has(c))) return GE_CATS[0];
  if (!isGenArea(it.area)) return null;
  return GE_CATS.find((cat) => it.options.every((o) => o.codes.every(cat.subj))) || null;
}

// ---------- loose label matching ----------
const STOP = new Set(['distribution', 'distributions', 'course', 'courses', 'ge', 'general', 'education', 'requirement', 'requirements', 'choose', 'from', 'the', 'approved', 'list', 'any', 'a', 'an', 'of', 'and', 'or', 'credit', 'credits', 'class', 'classes', 'one', 'see', 'to', 'in', 'for', 'area', 'select', 'complete', 'take', 'hours', 'hour']);
export const coreWords = (s) => s.replace(/\([^)]*\)/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w));
const wordIn = (w, list) => list.some((x) => x === w || (w.length >= 4 && x.startsWith(w)) || (x.length >= 4 && w.startsWith(x)));
// 0 = no match; higher = closer
export function labelMatch(a, b) {
  if (a.trim().toLowerCase() === b.trim().toLowerCase()) return 3;
  const ca = catOfLabel(a), cb = catOfLabel(b);
  if (ca && cb && ca !== cb) return 0;
  const wa = coreWords(a), wb = coreWords(b);
  if (!wa.length || !wb.length) return 0;
  if (wa.every((w) => wordIn(w, wb)) || wb.every((w) => wordIn(w, wa))) return ca && ca === cb ? 2 : 1.5;
  if (ca && ca === cb) return 1;
  return 0;
}

// ---------- naming choice groups ----------
// Choice groups whose only label is "Complete one of the following:" get a name. Never by credits alone:
//  1. a Gen Ed list (all options American Institutions courses, or all MATH/MAT/STAT in a Gen Ed area, ...)
//     takes the sample plan's label of that category ("American Institution (Choose from ...)"), else
//     the category's plain name;
//  2. a plan label that names a subject of the options ("CS Elective" over CS courses);
//  3. a plan label adding up to the group's credits whose words appear in the options' course titles
//     ("Large Ensemble" over "Wind Ensemble", ...) or that is an "<X> Elective" label for a credit pick
//     ("EE Elective" x2 = 6 credits);
//  otherwise "Choose N" / "Choose N credits" / "Choose 1 track".
export function nameChoices(items, gradPlan, courses = {}) {
  const known = new Set(items.filter((i) => i.type !== 'course').map((i) => i.label));
  const pool = new Map(); // label -> credits on the plan
  for (const t of gradPlan) for (const x of t.items) if (x.label && !known.has(x.label)) pool.set(x.label, (pool.get(x.label) || 0) + (x.credits || 0));
  const take = (l) => { pool.delete(l); return l; };
  const done = new Set();
  // a requirement label the plan uses word for word already links the two: keep it (unless it is a Gen Ed
  // list, which takes its category name: two "Complete one of the following:" lists can't share one label)
  const planLabels = new Set(gradPlan.flatMap((t) => t.items.map((x) => x.label)).filter(Boolean));
  const generic = (it) => it.type === 'choice' && !done.has(it) && /^complete /i.test(it.label) && (!planLabels.has(it.label) || catOfChoice(it));
  // pass 0: a plan label with the same courses listed under it ("Complete a minimum of 5 credits from the
  // following courses:" + indented PHYS rows) is that list's name: it shares most of the options' codes
  const listed = [];
  for (const t of gradPlan) for (const x of t.items) if (x.label && x.options?.length) listed.push(x);
  for (const it of items) {
    if (!generic(it)) continue;
    const mine = new Set(it.options.flatMap((o) => [...o.codes, ...(o.alts || [])]));
    const hits = [...new Set(listed.filter((x) => {
      const theirs = x.options.flat();
      return theirs.filter((c) => mine.has(c)).length >= Math.max(1, Math.ceil(theirs.length / 2));
    }).map((x) => x.label))];
    if (hits.length !== 1) continue;
    if (hits[0] === it.label) done.add(it); // the plan already calls this list by its own words
    else if (pool.has(hits[0])) { it.label = take(hits[0]); done.add(it); }
  }
  // pass 1: Gen Ed categories (most certain), so later passes can't steal their labels
  for (const it of items) {
    if (done.has(it) && catOfChoice(it)) it.ge = catOfChoice(it).key;
    if (!generic(it)) continue;
    const cat = catOfChoice(it);
    if (!cat) continue;
    const hit = [...pool.keys()].find((l) => cat.label.test(l) && catOfLabel(l) === cat);
    it.label = hit ? take(hit) : cat.name;
    it.ge = cat.key;
  }
  for (const it of items) {
    if (!generic(it)) continue;
    const subjects = new Set(it.options.flatMap((o) => o.codes.map((c) => c.split(' ')[0])));
    const labels = [...pool.keys()].filter((l) => !catOfLabel(l) || catOfChoice(it));
    let hit = labels.find((l) => l.split(/[^A-Za-z]+/).some((w) => w.length >= 2 && w === w.toUpperCase() && subjects.has(w)));
    if (!hit) {
      const titleWords = new Set(it.options.flatMap((o) => o.codes.flatMap((c) => coreWords(courses[c]?.title || ''))).filter((w) => w.length >= 5));
      hit = labels.find((l) => pool.get(l) === it.credits && coreWords(l).some((w) => w.length >= 5 && !/^electives?$/.test(w) && titleWords.has(w)));
    }
    if (!hit) {
      // the plan repeats the instruction in other words ("Complete three hours from the following courses:"
      // vs "Choose three hours from the following recommended courses:") with the same credits
      const own = coreWords(it.label).filter((w) => w !== 'following');
      if (own.length) {
        const same = labels.filter((l) => pool.get(l) === it.credits && own.every((w) => wordIn(w, coreWords(l))));
        if (same.length === 1) hit = same[0];
      }
    }
    if (!hit && !it.tracks) {
      // (a bare "Elective" only for a list under an "Electives" area header)
      const el = labels.filter((l) => /\belectives?\b/i.test(l) && (!/^electives?$/i.test(l.trim()) || /elective/i.test(it.area || '')) && pool.get(l) === it.credits && !catOfLabel(l));
      if (el.length === 1) hit = el[0];
    }
    if (hit) { it.label = take(hit); continue; }
    it.label = it.tracks ? `Choose ${it.pick.tracks || 1} track${(it.pick.tracks || 1) > 1 ? 's' : ''}` : it.pick.credits ? `Choose ${it.pick.credits} credits` : `Choose ${it.pick.count}`;
  }
}

// Plan labels that name a requirement loosely ("HUMANITIES" for "Humanities Distribution") take the
// requirement's label, so the planner can order the box by the plan; the plan's own words stay in `text`.
export function linkPlan(items, gradPlan) {
  const reqLabels = [...new Set(items.filter((i) => i.type !== 'course').map((i) => i.label))];
  for (const t of gradPlan) for (const x of t.items) {
    if (!x.label || reqLabels.includes(x.label)) continue;
    // a bare "Elective" requirement only takes a plan label that says no more than that
    // ("American Institutions Elective" is not the free "Elective")
    const bare = (l) => coreWords(l).every((w) => /^electives?$/.test(w));
    const scored = reqLabels.filter((l) => !bare(l) || bare(x.label)).map((l) => [l, labelMatch(x.label, l)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
    if (!scored.length || (scored[1] && scored[1][1] === scored[0][1])) continue; // none, or a tie
    x.text = x.label;
    x.label = scored[0][0];
  }
}

// ---------- emphasis pages without their core ----------
// "Complete the requirements | 44" points at a core that is not on the page (pre-engineering emphases,
// mechatronics AAS emphases). The sample plan holds it: the plan courses not named by the page, plus
// plan labels (Gen Ed first), when they add up to exactly the missing credits. Returns 'graduation plan' or null.
const UNRESOLVED = /^complete (?:the )?(?:core )?requi?re?m?e?n?ts?$/i;
export function spliceCore(items, gradPlan) {
  const at = items.findIndex((it) => it.type === 'placeholder' && UNRESOLVED.test(it.label) && it.credits);
  if (at < 0) return null;
  const ph = items[at];
  const named = new Set();
  for (const it of items) {
    if (it.type === 'course') [it.code, ...it.alts].forEach((c) => named.add(c));
    if (it.type === 'choice') it.options.forEach((o) => [...o.codes, ...(o.alts || [])].forEach((c) => named.add(c)));
  }
  const plan = gradPlan.flatMap((t) => t.items);
  const codeItems = plan.filter((x) => x.code && ![x.code, ...(x.alts || [])].some((c) => named.has(c)));
  let sum = codeItems.reduce((a, x) => a + (x.credits || 0), 0);
  const otherLabels = items.filter((it) => it !== ph && it.type !== 'course').map((it) => it.label);
  const labels = plan.filter((x) => x.label && x.credits && !otherLabels.some((l) => labelMatch(x.label, l) >= 1.5));
  const chosen = [];
  for (const pass of [(x) => catOfLabel(x.label), (x) => !catOfLabel(x.label)]) {
    for (const x of labels.filter(pass)) if (sum + x.credits <= ph.credits && sum < ph.credits) { chosen.push(x); sum += x.credits; }
  }
  if (sum !== ph.credits) return null;
  const core = plan.filter((x) => codeItems.includes(x) || chosen.includes(x)).map((x) => x.code
    ? { type: 'course', area: ph.area, code: x.code, alts: x.alts || [], credits: x.credits, fromPlan: true }
    : { type: 'placeholder', area: catOfLabel(x.label) ? 'General Education Requirements' : ph.area, label: x.label, credits: x.credits, fromPlan: true });
  items.splice(at, 1, ...core);
  return 'graduation plan';
}

// ---------- credits ----------
// Credits the program table left blank ("A & B" rows, "(undefined)" in option titles, choice headers with
// no hours) come from the course catalog: option = sum of its courses, count-choice = count x cheapest option.
// Also: an "A & B | 4" pair splits the row's hours (catalog credits for B, the rest for A); a repeatable
// course ("Must be taken 2 times") holds the credits of all its repeats (credits = total, creditsEach = one).
export function fillCredits(items, courses) {
  const cr = (code) => courses[code]?.credits ?? null;
  const crMax = (code) => courses[code]?.creditsMax ?? null;
  const repeatFix = (x, code) => {
    if (!x.repeat || x.credits == null) return;
    const c = cr(code);
    if (c && x.credits === c && c * x.repeat !== x.credits) x.credits = c * x.repeat;
    x.creditsEach = Math.round((x.credits / x.repeat) * 100) / 100;
  };
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.type === 'course') {
      if (it.pairHours != null) {
        const pair = it.pair, n = pair.length;
        const crs = pair.map(cr);
        const H = it.pairHours;
        const sum = (xs) => xs.reduce((a, b) => a + b, 0);
        let out = null;
        const unknown = crs.filter((x) => x == null).length;
        if (!unknown && sum(crs) === H) out = crs;
        // one code with no catalog entry (a lab): it takes what the row's hours leave
        else if (unknown === 1 && H - sum(crs.filter((x) => x != null)) > 0) out = crs.map((x) => x ?? H - sum(crs.filter((y) => y != null)));
        // catalog numbers that don't add up to the row: the first (main) course keeps its own credits, the
        // other code of a pair gets the rest ("DCPR 1010 & 1010L | 3" = 2 + 1)
        else if (!unknown && n === 2 && H - crs[0] > 0) out = [crs[0], H - crs[0]];
        else if (!unknown) { const rest = sum(crs.slice(1)); out = [H - rest > 0 ? H - rest : crs[0], ...crs.slice(1)]; }
        if (out) for (let k = 0; k < n && items[i + k]?.code === pair[k]; k++) items[i + k].credits = out[k];
        delete it.pairHours; delete it.pair;
      }
      if (it.credits == null) it.credits = cr(it.code);
      if (!it.crMax && crMax(it.code) && it.credits === cr(it.code)) it.crMax = crMax(it.code);
      repeatFix(it, it.code);
    }
    if (it.type !== 'choice') continue;
    for (const o of it.options) {
      if (o.credits == null) {
        const parts = o.codes.map(cr);
        if (parts.every((x) => x != null)) o.credits = parts.reduce((a, b) => a + b, 0);
        if (o.codes.length === 1 && crMax(o.codes[0]) && !o.crMax) o.crMax = crMax(o.codes[0]);
      }
      repeatFix(o, o.codes[0]);
    }
    if (it.credits == null) {
      if (it.pick.credits) it.credits = it.pick.credits;
      else {
        const known = it.options.map((o) => o.credits).filter((x) => x != null).sort((a, b) => a - b);
        if (known.length) it.credits = known.slice(0, it.pick.count || 1).reduce((a, b) => a + b, 0);
      }
    }
    // a list with a few named courses plus "any CS 3000+ course" can be finished with an unlisted course
    if (it.open == null && (it.notes || []).some((n) => /\b(?:any|other)\b[^.]*(?:\d{4}|courses?|electives?|approved)|\bapproved\b|\d{4}\s*\+/i.test(n))) it.open = true;
  }
}

// Sample plan "A & B | 5" items: B becomes its own item; credits split by catalog credits.
export function splitPlanPairs(gradPlan, courses) {
  const cr = (c) => courses[c]?.credits ?? null;
  for (const t of gradPlan) {
    const out = [];
    for (const x of t.items) {
      if (!x.with) { out.push(x); continue; }
      const codes = [x.code, ...x.with];
      const crs = codes.map(cr);
      const { with: w, ...first } = x;
      if (crs.every((c) => c != null) && x.credits != null) {
        const rest = crs.slice(1).reduce((a, b) => a + b, 0);
        first.credits = x.credits - rest > 0 ? x.credits - rest : crs[0];
        out.push(first, ...w.map((c, k) => ({ code: c, credits: crs[k + 1] })));
      } else out.push(first, ...w.map((c) => ({ code: c, credits: cr(c) })));
    }
    t.items = out;
  }
}

// ---------- admission ----------
// Programs a student must be formally accepted into (cohorts: nursing, dental hygiene, respiratory
// therapy, PA, auditions ...). The planner may use it later; the note is the catalog's own sentence.
const ADM = /formally (?:accepted|admitted)|formal (?:acceptance|admission)|accepted into the (?:[A-Z][\w/-]* )+program|acceptance into the [A-Z]|competitive,? (?:point-based |merit-based )?(?:application|admission)|merit-based,? competitive admission|admission is competitive|matriculation into a cohort|must be accepted into (?:the )?program|admission to the [A-Z][\w-]* program/i;
export function admissionInfo(html, items, courses) {
  const main = html.slice(Math.max(0, html.indexOf('<main')), html.indexOf('</main>') > 0 ? html.indexOf('</main>') : undefined).replace(/<script[\s\S]*?<\/script>/g, '');
  const t = main.replace(/<(?:br|p|li|tr|div|h\d)[^>]*>/gi, '. ').replace(/<[^>]+>/g, ' ').replace(/&#160;|&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ');
  const sent = t.split(/(?<=[.!?])\s+/).map((s) => s.replace(/^[.\s]+/, '').trim()).find((s) => s.length < 300 && ADM.test(s));
  return sent ? { admission: true, admissionNote: sent } : {};
}

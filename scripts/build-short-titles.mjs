// Builds data/short-titles.json: the short class names the flowchart boxes show ("Calculus III" -> "Calc 3").
// Run after every program data refresh (fetch-all / build-prereq-courses):  node scripts/build-short-titles.mjs
//   - collects every class title a flowchart box can show (course + option boxes of every program, both
//     catalog years, "Needed first" boxes and requirement groups' classes included) exactly as the site
//     builds them; and every requirement row's wording (Gen Ed / elective / "Complete one of the following:")
//   - hand names in scripts/short-titles-hand.json win; every other title gets the rule-based name
//     (scripts/lib/short-titles.mjs)
//   - stores only titles whose short name differs (the box shows the full title otherwise)
//   - exits 1 and lists any title whose short name doesn't fit the box: write a hand name for it
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildModel, flowNodes, flowEdges } from '../js/planner.js';
import { foldLabs } from '../js/layout.js';
import { groupNodes, shortName as groupName } from '../js/groups.js';
import { ruleShort, fitsBox, reqShort, fitsReq } from './lib/short-titles.mjs';
import { forCatalogYear } from '../js/curprereqs.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => { try { return JSON.parse(readFileSync(ROOT + p, 'utf8')); } catch { return null; } };
// a program as the site loads it: an older catalog year takes its prereqs from the current catalog
let CUR = null;
function loadProgram(dir, y, f, extra) {
  const program = read(`${dir}/${f}`);
  if (!program || y === 'data/') return { program, extraCourses: extra.extraCourses };
  CUR ??= { current: read('data/courses.json'), currentPC: read('data/prereq-courses.json') };
  return forCatalogYear(program, { ...CUR, yearPC: extra.extraCourses });
}

// every single-course title a box can show, per program (the uniqueness test reads the same list)
export function boxTitles() {
  const seasons = read('data/seasons.json');
  const out = new Map(); // program key -> [{ code, title }]
  for (const [dir, y] of [['data/programs', 'data/'], ['data/2025-2026/programs', 'data/2025-2026/']]) {
    const extra = { extraCourses: read(y + 'prereq-courses.json'), gened: read(y + 'gened.json'), seasons };
    for (const f of readdirSync(ROOT + dir)) {
      if (!f.endsWith('.json') || f.startsWith('_') || f === 'index.json') continue;
      const { program, extraCourses } = loadProgram(dir, y, f, extra);
      if (!program) continue;
      const model = buildModel(program, { ...extra, extraCourses });
      const courses = { ...(extraCourses || {}), ...(program.courses || {}) };
      const folded = foldLabs(flowNodes(model), flowEdges(model));
      // the boxes the page draws: chart boxes + the option classes a requirement group shows (js/groups.js)
      const nodes = groupNodes(model, folded.nodes, folded.edges, []).boxes;
      const list = [];
      for (const n of nodes) {
        if (n.kind === 'course') list.push({ code: n.code, title: n.title || '' });
        else if (n.kind === 'option') {
          for (const c of n.codes || []) list.push({ code: c, title: courses[c]?.title || '' });
          // an option of several classes: its joined title can have a hand name of its own
          if ((n.codes || []).length > 1) list.push({ code: n.codes.join(' + '), title: n.title || '', joined: true });
        }
      }
      out.set(`${y.replace('data/', '') || 'current/'}${f.replace('.json', '')}`, list.filter((x) => x.title));
    }
  }
  return out;
}

// every requirement wording a box or plan row can show (Gen Ed / elective / "Complete one of the following:"
// rows, a track's own pick lists, a wide group box's catalog line), per program, with the requirement
// group's name the app shows for a generic one
export function reqLabels() {
  const seasons = read('data/seasons.json');
  const out = new Map(); // program key -> [{ label, name }]
  for (const [dir, y] of [['data/programs', 'data/'], ['data/2025-2026/programs', 'data/2025-2026/']]) {
    const extra = { extraCourses: read(y + 'prereq-courses.json'), gened: read(y + 'gened.json'), seasons };
    for (const f of readdirSync(ROOT + dir)) {
      if (!f.endsWith('.json') || f.startsWith('_') || f === 'index.json') continue;
      const { program, extraCourses } = loadProgram(dir, y, f, extra);
      if (!program) continue;
      const model = buildModel(program, { ...extra, extraCourses });
      const { nodes, edges } = foldLabs(flowNodes(model), flowEdges(model));
      const grp = groupNodes(model, nodes, edges, []);
      const nameOf = new Map(grp.groups.filter((g) => g.unit).map((g) => [g.unit.id, g.name]));
      const list = [];
      for (const u of model.units) {
        if (u.kind === 'course') continue;
        const name = nameOf.get(u.id) ?? groupName(u, program.requirements?.[u.order]?.src);
        if (u.label) list.push({ label: u.label, name });
        for (const sb of u.subs || []) if (sb.label) list.push({ label: sb.label, name });
      }
      for (const g of grp.groups) if (g.kind === 'wide' && g.text) list.push({ label: g.text, name: g.name });
      out.set(`${y.replace('data/', '') || 'current/'}${f.replace('.json', '')}`, list);
    }
  }
  return out;
}

// requirement wording -> short label ('' = the app shows the group's name, itself shortened by names{});
// hand labels / names win
export function buildReqLabels(perProgram = reqLabels(), handAll = read('scripts/short-titles-hand.json') || {}) {
  const hand = handAll.labels || {}, handNames = handAll.names || {};
  const labels = {}, names = {}, bad = [];
  let nHand = 0;
  const flat = [...perProgram.values()].flat();
  const all = new Set(flat.map((x) => x.label));
  for (const l of [...all].sort()) {
    const s = hand[l] ?? reqShort(l);
    if (hand[l] !== undefined) nHand++;
    if (s === null || (s !== '' && !fitsReq(s))) { bad.push(`label: ${l} -> ${s}`); continue; }
    if (s !== l) labels[l] = s;
  }
  // the group names a generic label shows
  const shown = new Set(flat.filter((x) => labels[x.label] === '' && x.name).map((x) => x.name));
  for (const n of [...shown].sort()) {
    let s = handNames[n];
    if (s === undefined) { const r = reqShort(n); s = r || n; }
    if (!fitsReq(s)) { bad.push(`name: ${n} -> ${s}`); continue; }
    if (s !== n) names[n] = s;
  }
  return { labels, names, bad, counts: { labels: all.size, labelHand: nHand } };
}

export function buildShortTitles(perProgram = boxTitles(), hand = read('scripts/short-titles-hand.json')?.titles || {}) {
  const titles = {}, bad = [];
  let nHand = 0, nRule = 0, same = 0;
  const flat = [...perProgram.values()].flat();
  // joined option titles ("A + B") only when a hand name covers them; otherwise the box joins the parts
  const all = new Set(flat.filter((x) => !x.joined || hand[x.title] !== undefined).map((x) => x.title));
  for (const t of [...all].sort()) {
    const s = hand[t] ?? ruleShort(t).short;
    if (hand[t] !== undefined) nHand++; else nRule++;
    if (!fitsBox(s)) bad.push(`${t} -> ${s}`);
    if (s !== t) titles[t] = s; else same++;
  }
  return { titles, bad, counts: { titles: all.size, hand: nHand, rule: nRule, unchanged: same } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { titles, bad, counts } = buildShortTitles();
  const req = buildReqLabels();
  const doc = {
    generated: new Date().toISOString().slice(0, 10),
    about: 'Short names. titles: full catalog class title -> the short name its flowchart box shows. labels: a requirement row\'s catalog wording -> the short label its box and plan row show ("" = the requirement group\'s name). Anything not listed is shown as it is. The class sheet keeps the full wording. Built by scripts/build-short-titles.mjs from data/; hand names in scripts/short-titles-hand.json.',
    ...counts,
    ...req.counts,
    titles,
    labels: req.labels,
    names: req.names,
  };
  writeFileSync(ROOT + 'data/short-titles.json', JSON.stringify(doc, null, 1) + '\n');
  console.log(`data/short-titles.json: ${counts.titles} box titles (${counts.hand} hand, ${counts.rule} rule, ${counts.unchanged} already short); ${req.counts.labels} requirement labels (${req.counts.labelHand} hand)`);
  const all = [...bad, ...req.bad];
  if (all.length) { console.error(`${all.length} short names don't fit; add hand names in scripts/short-titles-hand.json:\n` + all.join('\n')); process.exit(1); }
}

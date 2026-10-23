// Builds data/short-titles.json: the short class names the flowchart boxes show ("Calculus III" -> "Calc 3").
// Run after every program data refresh (fetch-all / build-prereq-courses):  node scripts/build-short-titles.mjs
//   - collects every class title a flowchart box can show (course + option boxes of every program, both
//     catalog years, "Needed first" boxes included) exactly as the site builds them
//   - hand names in scripts/short-titles-hand.json win; every other title gets the rule-based name
//     (scripts/lib/short-titles.mjs)
//   - stores only titles whose short name differs (the box shows the full title otherwise)
//   - exits 1 and lists any title whose short name doesn't fit the box: write a hand name for it
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildModel, flowNodes, flowEdges } from '../js/planner.js';
import { foldLabs } from '../js/layout.js';
import { ruleShort, fitsBox } from './lib/short-titles.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => { try { return JSON.parse(readFileSync(ROOT + p, 'utf8')); } catch { return null; } };

// every single-course title a box can show, per program (the uniqueness test reads the same list)
export function boxTitles() {
  const seasons = read('data/seasons.json');
  const out = new Map(); // program key -> [{ code, title }]
  for (const [dir, y] of [['data/programs', 'data/'], ['data/2025-2026/programs', 'data/2025-2026/']]) {
    const extra = { extraCourses: read(y + 'prereq-courses.json'), gened: read(y + 'gened.json'), seasons };
    for (const f of readdirSync(ROOT + dir)) {
      if (!f.endsWith('.json') || f.startsWith('_') || f === 'index.json') continue;
      const program = read(`${dir}/${f}`);
      if (!program) continue;
      const model = buildModel(program, extra);
      const courses = { ...(extra.extraCourses || {}), ...(program.courses || {}) };
      const { nodes } = foldLabs(flowNodes(model), flowEdges(model));
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
  const doc = {
    generated: new Date().toISOString().slice(0, 10),
    about: 'Short class names for the flowchart boxes: full catalog title -> short name (titles not listed are shown in full). Built by scripts/build-short-titles.mjs from the catalog course titles in data/; hand names in scripts/short-titles-hand.json.',
    ...counts,
    titles,
  };
  writeFileSync(ROOT + 'data/short-titles.json', JSON.stringify(doc, null, 1) + '\n');
  console.log(`data/short-titles.json: ${counts.titles} box titles (${counts.hand} hand, ${counts.rule} rule, ${counts.unchanged} already short)`);
  if (bad.length) { console.error(`${bad.length} short names don't fit the box; add hand names:\n` + bad.join('\n')); process.exit(1); }
}

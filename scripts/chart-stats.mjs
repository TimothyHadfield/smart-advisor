// Flowchart line stats for every program, drawn the way the site draws them (labs folded, laptop box size).
// The site's own pipeline: older catalog years with current prereqs (D28), buildModel with the extra data, foldLabs, matriculation split, flowChart.
// Run: node scripts/chart-stats.mjs [--no-split] [--out stats.json] [--only ee-bs,ce-bs] [--top 10]
// Per program: crossings (drawn lines), bends (corners), overlaps (lines on top of each other or < 7 px apart;
// foreign = of lines that share no box; stacked = drawn on top of each other), boxHits,
// vrows (upright line length in rows), closeV (upright pieces of different lines < 8 px apart sharing height; closeV12 < 12 px),
// sharedIn / sharedOut (boxes where 2+ arrows end / start at one point),
// length (px of line), width / height (px), ms (layout time, no cache); with the matriculation line:
// matric (1 if drawn), strays (boxes it can't put on their side), sepBox (its pieces through a box),
// sepCross (edge pieces it crosses); empty = % of the phone's first screen of the chart (393 x 508 px, top left)
// with no box or line within 24 px; floor = crossings of the box order itself (what one line per arrow can't avoid).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildModel, flowNodes, flowEdges } from '../js/planner.js';
import { flowChart, foldLabs, chartStats, viewEmpty } from '../js/layout.js';
import { matricSides } from '../js/matric.js';
import { forCatalogYear } from '../js/curprereqs.js';

const ROOT = fileURLToPath(new URL('../data/', import.meta.url));
const SIZES = { boxH: 48, rowH: 66, near: 8, pad: 12, boxW: 92, gapMin: 88, track: 12 }; // js/app.js BASE + FITS[0]
const NO_SPLIT = process.argv.includes('--no-split'); // the chart without the matriculation line
const readJSON = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const SEASONS = readJSON(ROOT + 'seasons.json');
const EXTRA = {
  current: { extraCourses: readJSON(ROOT + 'prereq-courses.json'), gened: readJSON(ROOT + 'gened.json'), seasons: SEASONS },
  '2025-2026': { extraCourses: readJSON(ROOT + '2025-2026/prereq-courses.json'), gened: readJSON(ROOT + '2025-2026/gened.json'), seasons: SEASONS },
};

// an older catalog year loads the way the site loads it (D28, js/app.js buildFor): prereqs from the current catalog
let CUR = null;
function loadProgram(file) {
  const program = readJSON(file.path);
  if (file.year === 'current') return { program, extraCourses: EXTRA.current.extraCourses };
  CUR ??= { current: readJSON(ROOT + 'courses.json'), currentPC: EXTRA.current.extraCourses };
  return forCatalogYear(program, { ...CUR, yearPC: EXTRA[file.year].extraCourses });
}

export function programFiles() {
  const out = [];
  for (const [d, year] of [['programs', 'current'], ['2025-2026/programs', '2025-2026']]) for (const f of readdirSync(ROOT + d)) {
    if (!f.endsWith('.json') || f.startsWith('_') || f === 'index.json') continue;
    out.push({ key: `${year}/${f.replace('.json', '')}`, year, path: ROOT + d + '/' + f });
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : 1));
}

export function statsFor(file, { warm = true } = {}) {
  const { program, extraCourses } = loadProgram(file);
  const model = buildModel(program, { ...EXTRA[file.year], extraCourses });
  const F = foldLabs(flowNodes(model), flowEdges(model));
  const sz = { ...SIZES, split: NO_SPLIT ? null : matricSides(F.nodes, F.edges)?.after }; // the dotted matriculation line, as js/app.js
  let t0 = performance.now();
  let C = flowChart(F.nodes, F.edges, sz);
  const msCold = performance.now() - t0;
  t0 = performance.now();
  if (warm) C = flowChart(F.nodes, F.edges, sz); // warm (the number reported; warm: false lays out once)
  const ms = warm ? performance.now() - t0 : msCold;
  const st = chartStats(C);
  let length = 0;
  for (const e of C.edges) for (let k = 1; k < e.pts.length; k++) length += Math.abs(e.pts[k][0] - e.pts[k - 1][0]) + Math.abs(e.pts[k][1] - e.pts[k - 1][1]);
  const sp = C.split?.pts || [], sg = [];
  for (let k = 1; k < sp.length; k++) sg.push([sp[k - 1], sp[k]]);
  let sepBox = 0, sepCross = 0;
  for (const [[x1, y1], [x2, y2]] of sg) {
    const [ax, bx, ay, by] = [Math.min(x1, x2), Math.max(x1, x2), Math.min(y1, y2), Math.max(y1, y2)];
    for (const r of C.boxes.values()) if (ax < r.x + r.w - 0.5 && bx > r.x + 0.5 && ay < r.y + r.h - 0.5 && by > r.y + 0.5) sepBox++;
    for (const e of C.edges) for (let k = 1; k < e.pts.length; k++) {
      const [[u1, v1], [u2, v2]] = [e.pts[k - 1], e.pts[k]];
      const [cx, dx, cy, dy] = [Math.min(u1, u2), Math.max(u1, u2), Math.min(v1, v2), Math.max(v1, v2)];
      if (ax === bx && cy === dy && ax > cx && ax < dx && cy > ay && cy < by) sepCross++;
      if (ay === by && cx === dx && cx > ax && cx < bx && ay > cy && ay < dy) sepCross++;
    }
  }
  return { crossings: st.crossings, bends: st.bends, edges: st.edges, straight: st.straight, overlaps: st.overlaps.length, foreign: st.foreign, stacked: st.stacked, boxHits: st.boxHits.length,
    vrows: +(st.vlen / SIZES.rowH).toFixed(2), closeV: st.closeV, closeV12: st.closeV12, sharedIn: st.sharedIn, sharedOut: st.sharedOut,
    length: Math.round(length), width: Math.round(C.width), height: Math.round(C.height), ms: +ms.toFixed(1), msCold: +msCold.toFixed(1),
    empty: Math.round(viewEmpty(C) * 100), floor: C.layout.crossings,
    matric: C.split ? 1 : 0, strays: C.split?.strays?.length ?? 0, sepBox, sepCross };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const only = arg('--only')?.split(',');
  const files = programFiles().filter((f) => !only || only.some((o) => f.key.endsWith('/' + o) || f.key === o));
  const per = {};
  const tot = { crossings: 0, bends: 0, edges: 0, straight: 0, overlaps: 0, foreign: 0, stacked: 0, boxHits: 0, vrows: 0, closeV: 0, closeV12: 0, sharedIn: 0, sharedOut: 0, length: 0, ms: 0, empty: 0, floor: 0, matric: 0, strays: 0, sepBox: 0, sepCross: 0 };
  let maxMs = 0, maxMsKey = '';
  for (const f of files) {
    const s = statsFor(f);
    per[f.key] = s;
    for (const k of Object.keys(tot)) tot[k] += s[k];
    if (s.ms > maxMs) { maxMs = s.ms; maxMsKey = f.key; }
  }
  tot.ms = Math.round(tot.ms); tot.empty = Math.round(tot.empty / files.length); tot.vrows = Math.round(tot.vrows);
  const out = { sizes: SIZES, programs: files.length, totals: tot, maxMs: { key: maxMsKey, ms: maxMs }, per };
  if (arg('--out')) writeFileSync(arg('--out'), JSON.stringify(out, null, 1));
  console.log(`programs ${files.length}`, JSON.stringify(tot), `slowest ${maxMsKey} ${maxMs} ms`);
  for (const k of ['electrical-engineering-bs', 'computer-engineering-bs', 'nursing-bs', 'mechanical-engineering-bs', 'computer-science-bs', 'software-engineering-bs', 'exercise-science-bs']) {
    for (const y of ['current', '2025-2026']) if (per[`${y}/${k}`]) console.log(`${y}/${k}`, JSON.stringify(per[`${y}/${k}`]));
  }
  const top = +(arg('--top') ?? 10);
  const worst = Object.entries(per).sort((a, b) => b[1].crossings - a[1].crossings || b[1].bends - a[1].bends).slice(0, top);
  console.log('worst:'); for (const [k, s] of worst) console.log(' ', k, `x${s.crossings} b${s.bends} e${s.edges} ov${s.overlaps} hit${s.boxHits} close${s.closeV} shared${s.sharedIn} ${s.ms}ms`);
}

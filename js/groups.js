// Requirement groups under the flowchart. Pure: no DOM. Used by js/app.js and Node tests.
//
// Boxes with no prerequisite lines in or out (a "pick 3" elective list, "Complete 24 credits of ...",
// required classes nothing builds on) used to sit in one loose row under the chart. They now go in
// labelled group frames, one per catalog requirement, under the section they belong to:
//   pick  "Pick 2 · Math electives"  the requirement's option classes as boxes (a long list shows the
//         first few + "+N more", which opens the searchable list sheet)
//   all   "Also required"            required classes with no lines, in a grid
//   wide  "Pick 6 cr · Electives"    a requirement with no class list: one wide box with its full wording
// Classes joined by prerequisite lines stay in the chart; a pick group then says how many are "in chart".
// Gen Ed boxes keep their own row (js/layout.js flowChart).
//
// groupNodes(model, nodes, edges, sections) -> { chart, boxes, groups, grouped }
//   chart  nodes the flowchart lays out (everything not in a group)
//   boxes  every box drawn: chart nodes + the boxes inside groups (option classes of a long list too)
//   groups [{ id, sec, kind, unit, items: [node ids], more: [hidden option ids], inChart, title, name, text }]
// placeGroups(chart, groups, sizes, sections) -> the chart with group frames placed (pixels):
//   chart.boxes gets each group box, chart.frames = Map(group id -> {x, y, w, h}), chart.more = Map(group id
//   -> {x, y, w, h}) for the "+N more" button, chart.inChart likewise; boxes under a band move down.
// groupProgress(group, completed, doneOf) -> { text: '1 of 3', met }

import { unitDone, choiceRemaining, countedOptions } from './planner.js';

const SHOW_MAX = 8;   // a list this long or shorter shows every class
const SHOW_SOME = 5;  // a longer list: this many + "+N more"
const GEN = /general\s+education/i;

export function groupNodes(model, nodes, edges, sections = []) {
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  const secOf = (n) => sections.find((s) => s.test(n))?.key ?? (GEN.test(n.area || '') ? 'gen' : '');
  const unitOf = (id) => model.units.find((u) => u.id === id);
  const groups = [], byKey = new Map(), grouped = new Set(), extra = [];
  const add = (key, make) => byKey.get(key) ?? (groups.push(byKey.set(key, make()).get(key)), byKey.get(key));
  for (const n of nodes) {
    if (linked.has(n.id)) continue;
    const sec = secOf(n);
    if (sec === 'gen') continue;
    if (n.kind === 'course') {
      add(`all|${sec}`, () => ({ id: `g:all:${sec}`, sec, kind: 'all', unit: null, items: [], more: [], inChart: 0, order: n.order })).items.push(n.id);
      grouped.add(n.id);
    } else if (n.kind === 'option') {
      const g = unitOf(n.group);
      if (!g) continue;
      const grp = add(`pick|${g.id}`, () => ({ id: `g:${g.id}`, sec, kind: 'pick', unit: g, items: [], more: [], inChart: 0, order: g.order }));
      grp.items.push(n.id);
      grouped.add(n.id);
    } else if (n.kind === 'choice' && !(n.tracks?.length > 1) && n.options?.length) {
      // a long or unconnected list: its option classes become boxes in the group
      const opts = n.options.slice().sort((a, b) => (a.planSem ?? 99) - (b.planSem ?? 99) || a.order - b.order);
      const show = opts.length <= SHOW_MAX ? opts : opts.slice(0, SHOW_SOME);
      const keep = new Set(show.map((o) => o.id));
      const shown = n.options.filter((o) => keep.has(o.id)); // catalog order
      groups.push({ id: `g:${n.id}`, sec, kind: 'pick', unit: n, items: shown.map((o) => o.id), more: n.options.filter((o) => !keep.has(o.id)).map((o) => o.id), inChart: 0, order: n.order });
      extra.push(...shown);
      grouped.add(n.id);
      shown.forEach((o) => grouped.add(o.id));
    } else {
      groups.push({ id: `g:${n.id}`, sec, kind: 'wide', unit: n, items: [n.id], more: [], inChart: 0, order: n.order });
      grouped.add(n.id);
    }
  }
  // a pick group whose other options are joined by lines: say how many sit in the chart
  for (const g of groups) if (g.kind === 'pick' && g.unit.showOptions) g.inChart = g.unit.options.filter((o) => linked.has(o.id)).length;
  // "Also required" first in its section, then the catalog's order
  groups.sort((a, b) => (a.kind === 'all' ? 0 : 1) - (b.kind === 'all' ? 0 : 1) || a.order - b.order);
  // the catalog line a requirement came from (requirements[order].src) gives a stub label its meaning
  const srcOf = (u) => (u && Number.isInteger(u.order) ? model.program.requirements?.[u.order]?.src : '') || '';
  for (const g of groups) Object.assign(g, labelOf(g, srcOf(g.unit)));
  const chart = nodes.filter((n) => !grouped.has(n.id));
  const asFrame = new Set(groups.filter((g) => g.kind === 'pick' && g.unit.kind === 'choice' && !g.unit.showOptions).map((g) => g.unit.id));
  const boxes = [...nodes.filter((n) => !asFrame.has(n.id)), ...extra];
  return { chart, boxes, groups, grouped };
}

// ---------- words ----------
const GENERIC = /^(complete|choose|select|take|pick|students?|any|one|two|three|four|five|six)\b|following|^electives?$|^elective requirements?$|^\s*$/i;
// "Upper Division Core (24 credits)" -> "Upper Division Core"; "Major Requirements" -> "" (says nothing)
export function areaName(area) {
  const s = String(area || '').split(':').pop().replace(/\(.*?\)/g, '').replace(/\brequirements?\b/ig, '').replace(/\s+/g, ' ').trim().replace(/[:\-–—,]+$/, '').trim();
  if (!s || /^(major|program|degree|core|required|courses?|other|additional|minor|emphasis|certificate)$/i.test(s)) return '';
  return /^electives?$/i.test(s) ? 'Electives' : s;
}
// the requirement's own name when it is short and says something, else its catalog area's name
// ("Complete 12 credits from the following social science and humanities classes" -> "Social science and humanities")
export function shortName(u, src = '') {
  if (!u) return '';
  const label = String(u.label || '').replace(/[:.]+$/, '').trim();
  if (label.length <= 24 && !GENERIC.test(label) && !/\d+\s*(credits?|cr)\b/i.test(label)) return label;
  const line = String(src || '').replace(/\(Note:.*$/i, '').split('›').map((s) => s.trim()).filter(Boolean).pop() || '';
  for (const t of [label, line]) {
    const m = /\bfollowing\s+(?:list\s+of\s+)?(.+?)\s+(?:courses|classes|electives|options)\b/i.exec(t);
    if (m && m[1].length <= 30 && !/\d/.test(m[1])) return m[1][0].toUpperCase() + m[1].slice(1);
  }
  const a = areaName(u.area);
  if (a.length <= 24) return a || (/^electives?$/i.test(label) ? 'Electives' : '');
  return /^electives?$/i.test(label) ? 'Electives' : '';
}
// the wording a box with no class list shows in full: the catalog line when the label is a stub ("Elective")
export function fullText(u) {
  const label = String(u?.label || '').trim();
  if (label.length > 12 && !/^electives?$/i.test(label)) return label;
  const parts = String(u?.src || u?.title || '').replace(/\(Note:.*$/i, '').split('›').map((s) => s.replace(/\s*\|\s*[\d.\-–]+\s*$/, '').trim()).filter(Boolean);
  const line = parts.length > 1 ? parts[parts.length - 1] : '';
  return line && line.toLowerCase() !== label.toLowerCase() ? line : label;
}
const pickWords = (pick) => (pick?.credits != null ? `Pick ${pick.credits} cr` : `Pick ${pick?.count ?? 1}`);
function labelOf(g, src) {
  if (g.kind === 'all') return { title: 'Also required', name: '', text: '' };
  const u = g.unit;
  const name = shortName(u, src);
  let head;
  if (g.kind === 'pick') head = pickWords(u.pick);
  else if (u.kind === 'choice' && u.tracks?.length > 1) head = 'Pick 1 track';
  else head = u.credits ? `Pick ${u.credits} cr` : 'Pick';
  return { title: name ? `${head} · ${name}` : head, name, text: g.kind === 'wide' ? fullText({ label: u.label, src, title: u.title }) : '' };
}

// a pick group's class list for the list sheet (the shape js/gened.js genEdList returns)
export function groupList(u, courses = {}) {
  if (!u || u.kind !== 'choice' || !u.options?.length) return null;
  const list = u.options.map((o) => ({ code: o.codes.join(' + '), codes: [...o.codes], title: o.codes.map((c) => courses[c]?.title || '').filter(Boolean).join(' + '), credits: o.credits ?? null }));
  return { name: u.label, groups: [{ key: 'opts', name: '', courses: list }] };
}

// ---------- progress ----------
// doneOf(id) -> is that box taken (the app's nodeDone)
export function groupProgress(g, completed, doneOf = () => false) {
  if (g.kind === 'all') {
    const k = g.items.filter((id) => doneOf(id)).length;
    return { text: `${k} of ${g.items.length}`, met: k === g.items.length };
  }
  const u = g.unit;
  if (g.kind === 'wide') return { text: '', met: doneOf(u.id) };
  const met = unitDone(u, completed);
  if (u.pick?.credits != null) {
    const need = u.pick.credits;
    const have = Math.min(need, Math.max(0, need - choiceRemaining(u, completed)));
    return { text: `${met ? need : have} of ${need} cr`, met };
  }
  const need = u.pick?.count ?? 1;
  const have = Math.min(need, completed.has(u.id) ? need : countedOptions(u, completed).length);
  return { text: `${met ? need : have} of ${need}`, met };
}

// ---------- pixels ----------
// sizes: the chart's { boxW, boxH, pad, gapMin, head, fitW? }. Group boxes keep the chart's box size, 8 px apart.
export const GROUP = { gap: 8, inset: 8, title: 22, between: 10, top: 6 };
export function placeGroups(chart, groups, sizes = {}, sections = []) {
  const out = { ...chart, boxes: new Map(chart.boxes), edges: chart.edges.map((e) => ({ ...e, pts: e.pts.map((p) => p.slice()) })), heads: chart.heads.map((h) => ({ ...h })), frames: new Map(), more: new Map(), inChart: new Map() };
  if (!groups.length) return out;
  if (!out.boxes.size && !out.heads.length) out.height = 0; // nothing but groups
  if (!Number.isFinite(out.width)) out.width = Math.max(0, ...[...out.boxes.values()].map((r) => r.x + r.w + (sizes.pad ?? 12))); // an empty main chart (routeChart of no columns)
  const boxW = sizes.boxW ?? 120, boxH = sizes.boxH ?? 48, pad = sizes.pad ?? 12, gapMin = sizes.gapMin ?? 30, head = sizes.head ?? 28;
  const { gap, inset, title, between, top } = GROUP;
  // the band is as wide as the chart, and never narrower than 4 boxes (like the Gen Ed row)
  // (sizes.fitW: the screen's chart width, so a laptop's groups use the free width beside a narrow chart)
  const W = Math.max(out.width, 2 * pad + 4 * boxW + 3 * gapMin, sizes.fitW ?? 0);
  const inner = W - 2 * pad;
  const maxCols = Math.max(1, Math.floor((inner - 2 * inset + gap) / (boxW + gap)));
  // sections in drawing order: the major, then each minor; Gen Ed is never grouped
  const keys = ['', ...sections.map((s) => s.key)].filter((k) => groups.some((g) => g.sec === k));
  for (const key of keys.reverse()) {
    const list = groups.filter((g) => g.sec === key);
    const order = ['', ...sections.map((s) => s.key), 'gen'];
    const after = out.heads.filter((h) => order.indexOf(h.key) > order.indexOf(key)).sort((a, b) => a.top - b.top)[0];
    const hasHead = !key || out.heads.some((h) => h.key === key);
    const ownBoxes = [...out.boxes.values()].some((r) => (after ? r.y < after.top : true));
    const Y = after ? after.top - 6 : out.height;
    // lay the frames out on shelves, left to right
    const placed = [], shelves = []; // first shelf with room (keeps the catalog order, fills gaps)
    for (const g of list) {
      const cells = g.kind === 'wide' ? Math.min(2, maxCols) : g.items.length + (g.more.length ? 1 : 0) + (g.inChart ? 1 : 0);
      // rows as even as they can be: "all" fills the width, a pick list at most 4 across (2 rows when it can)
      const cap = g.kind === 'all' ? maxCols : g.kind === 'wide' ? cells : Math.min(maxCols, cells <= 4 ? 4 : Math.max(3, Math.ceil(cells / 2)), 4);
      const cols0 = Math.max(1, Math.min(cells, cap));
      const cols = g.kind === 'wide' ? cols0 : Math.ceil(cells / Math.ceil(cells / cols0));
      const rows = g.kind === 'wide' ? 1 : Math.ceil(cells / cols);
      const wc = Math.max(cols, Math.min(2, maxCols)); // at least 2 boxes wide, so the title fits
      const w = 2 * inset + wc * boxW + (wc - 1) * gap;
      const h = title + rows * boxH + (rows - 1) * gap + inset;
      let s = shelves.find((q) => q.x + w <= inner + 1e-6);
      if (!s) shelves.push((s = { x: 0, h: 0, items: [] }));
      s.items.push({ g, x: s.x, w, h, cols });
      s.x += w + between; s.h = Math.max(s.h, h);
    }
    let bandH = 0;
    for (const s of shelves) { for (const p of s.items) placed.push({ ...p, y: bandH }); bandH += s.h + between; }
    bandH -= between;
    const lead = !hasHead ? head : 0;               // a minor whose boxes all went into groups: its heading
    const gapTop = key === '' && !ownBoxes ? pad : top;
    const H = lead + gapTop + bandH + (after ? 0 : pad);
    // make room: everything below the band's top moves down
    for (const [id, r] of out.boxes) if (r.y >= Y - 0.5) out.boxes.set(id, { ...r, y: r.y + H });
    for (const e of out.edges) for (const p of e.pts) if (p[1] >= Y - 0.5) p[1] += H;
    for (const h of out.heads) if (h.top >= Y - 0.5) h.top += H;
    if (out.genTop != null && out.genTop >= Y - 0.5) out.genTop += H;
    if (lead) { const s = sections.find((q) => q.key === key); out.heads.push({ key, label: s?.label ?? '', top: Y + 6 }); }
    const y0 = Y + lead + gapTop;
    for (const p of placed) {
      const fx = pad + p.x, fy = y0 + p.y;
      out.frames.set(p.g.id, { x: fx, y: fy, w: p.w, h: p.h });
      const cell = (i) => ({ x: fx + inset + (i % p.cols) * (boxW + gap), y: fy + title + Math.floor(i / p.cols) * (boxH + gap), w: boxW, h: boxH });
      if (p.g.kind === 'wide') { out.boxes.set(p.g.items[0], { x: fx + inset, y: fy + title, w: p.w - 2 * inset, h: boxH }); continue; }
      p.g.items.forEach((id, i) => out.boxes.set(id, cell(i)));
      let i = p.g.items.length;
      if (p.g.more.length) out.more.set(p.g.id, cell(i++));
      if (p.g.inChart) out.inChart.set(p.g.id, cell(i++));
    }
    out.height += H;
  }
  out.heads.sort((a, b) => a.top - b.top);
  out.width = Math.max(out.width, ...[...out.frames.values()].map((f) => f.x + f.w + pad));
  return out;
}

// Layered flowchart layout (Sugiyama style). Pure: no DOM, no deps. Used by js/app.js and Node tests.
//
//   1. layers   longest path from the sources (a course sits one column right of its latest prereq);
//               a lab shares its lecture's column.
//   2. dummies  an arrow spanning several columns gets an invisible point in every column it passes,
//               so it can route around boxes instead of through them.
//   3. order    repeated median/barycenter sweeps down and up + adjacent swaps (transpose); keep the
//               order with the fewest crossings. Labs are then pulled next to their lecture when that
//               adds no crossings.
//   4. heights  each box moves toward the weighted average of its neighbours (long arrows weigh most,
//               so they straighten), solved exactly per column with a no-overlap constraint.
//   Separate clusters (e.g. MATH 1220 -> 2210 on its own) are laid out on their own and packed above or
//   below the main graph. Boxes with no arrows at all (Gen Ed) go in their own row under everything.
//
// layoutGraph(nodes, edges, { pairs }) ->
//   { columns, height, pos: Map(id -> {col, y}), paths: [{from, to, or, pts: [{col, y}]}], crossings,
//     isolated, clusters }
//   y is a box centre in row units (a box is 1 row tall incl. its gap); height is the total in rows.

const SEP_REAL = 1;      // box to box
const SEP_MIXED = 0.62;  // box to a passing arrow
const SEP_DUMMY = 0.34;  // arrow to arrow

const GAP = 0.7;      // rows between separate clusters
const GAP_ROW = 0.9;  // rows between the graph and the row of boxes with no arrows

export function layoutGraph(nodes, edges, opts = {}) {
  const known = new Set(nodes.map((n) => n.id));
  edges = edges.filter((e) => known.has(e.from) && known.has(e.to) && e.from !== e.to);
  const pairs = (opts.pairs || []).filter(([a, b]) => known.has(a) && known.has(b) && a !== b);
  // clusters = connected groups of boxes (arrows and lab pairs join them)
  const root = new Map(nodes.map((n) => [n.id, n.id]));
  const find = (x) => { while (root.get(x) !== x) { root.set(x, root.get(root.get(x))); x = root.get(x); } return x; };
  const join = (a, b) => root.set(find(a), find(b));
  edges.forEach((e) => join(e.from, e.to));
  pairs.forEach(([a, b]) => join(a, b));
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  const groups = new Map();
  for (const n of nodes) { const r = find(n.id); (groups.get(r) ?? groups.set(r, []).get(r)).push(n); }
  const isolated = [], comps = [];
  for (const g of groups.values()) {
    if (!g.some((n) => linked.has(n.id))) isolated.push(...g.map((n) => n.id));
    else comps.push(g);
  }
  isolated.sort((a, b) => nodes.findIndex((n) => n.id === a) - nodes.findIndex((n) => n.id === b));
  comps.sort((a, b) => b.length - a.length);
  const parts = comps.map((g) => {
    const ids = new Set(g.map((n) => n.id));
    return layered(g, edges.filter((e) => ids.has(e.from)), { ...opts, pairs: pairs.filter(([a]) => ids.has(a)) });
  });

  // Pack: the biggest cluster first; each smaller one goes just above or below what's already in its
  // columns, whichever keeps the chart shortest (it can tuck under a short column).
  const pos = new Map(), paths = [];
  const span = new Map(); // col -> [top, bottom] in rows
  let top = 0, bottom = 0, columns = 0, crossings = 0;
  parts.forEach((p, k) => {
    const occ = new Map();
    const mark = (q) => { const o = occ.get(q.col) || [Infinity, -Infinity]; occ.set(q.col, [Math.min(o[0], q.y - 0.5), Math.max(o[1], q.y + 0.5)]); };
    p.pos.forEach(mark); p.paths.forEach((e) => e.pts.forEach(mark));
    let off = 0;
    if (k > 0) {
      let below = -Infinity, above = Infinity;
      for (const [c, [t, b]] of occ) {
        const s = span.get(c);
        if (s) { below = Math.max(below, s[1] + GAP - t); above = Math.min(above, s[0] - GAP - b); }
      }
      if (below === -Infinity) below = top; // its columns are empty: top-align with the chart
      if (above === Infinity) above = top;
      const ext = (o) => Math.max(bottom, o + p.height) - Math.min(top, o);
      off = ext(above) < ext(below) ? above : below;
    }
    for (const [c, [t, b]] of occ) { const s = span.get(c); span.set(c, s ? [Math.min(s[0], t + off), Math.max(s[1], b + off)] : [t + off, b + off]); }
    top = Math.min(top, off); bottom = Math.max(bottom, off + p.height);
    columns = Math.max(columns, p.columns);
    crossings += p.crossings;
    for (const [id, q] of p.pos) pos.set(id, { col: q.col, y: q.y + off });
    for (const e of p.paths) paths.push({ ...e, pts: e.pts.map((q) => ({ col: q.col, y: q.y + off })) });
  });
  for (const q of [...pos.values(), ...paths.flatMap((e) => e.pts)]) q.y -= top;
  let height = bottom - top;
  // boxes with no arrows: their own row(s) under the graph
  if (isolated.length) {
    const perRow = Math.max(columns, Math.ceil(isolated.length / 2));
    const y0 = parts.length ? height + GAP_ROW : 0;
    isolated.forEach((id, i) => pos.set(id, { col: i % perRow, y: y0 + 0.5 + Math.floor(i / perRow) }));
    columns = Math.max(columns, Math.min(isolated.length, perRow));
    height = y0 + Math.ceil(isolated.length / perRow);
  }
  return { columns, height, pos, paths, crossings, isolated, clusters: parts.length };
}

// One connected cluster -> { columns, height, pos, paths, crossings }, y from 0.5 at the top.
function layered(nodes, edges, opts = {}) {
  const ids = nodes.map((n) => n.id);
  const known = new Set(ids);
  edges = edges.filter((e) => known.has(e.from) && known.has(e.to) && e.from !== e.to);
  const pairs = (opts.pairs || []).filter(([a, b]) => known.has(a) && known.has(b) && a !== b);
  const partnerOf = new Map();
  for (const [lec, lab] of pairs) { if (!partnerOf.has(lab)) partnerOf.set(lab, lec); if (!partnerOf.has(lec)) partnerOf.set(lec, lab); }

  // ---- isolated boxes ----
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  const isIso = (id) => !linked.has(id) && !(partnerOf.has(id) && linked.has(partnerOf.get(id)));
  const isolated = ids.filter(isIso);
  const graphIds = ids.filter((id) => !isIso(id));

  // ---- 1. layers (longest path, labs share their lecture's layer) ----
  const layer = new Map(graphIds.map((id) => [id, 0]));
  for (let pass = 0; pass <= graphIds.length + 2; pass++) {
    let changed = false;
    for (const e of edges) if (layer.get(e.to) < layer.get(e.from) + 1) { layer.set(e.to, layer.get(e.from) + 1); changed = true; }
    for (const [a, b] of pairs) {
      if (!layer.has(a) || !layer.has(b)) continue;
      const m = Math.max(layer.get(a), layer.get(b));
      if (layer.get(a) !== m || layer.get(b) !== m) { layer.set(a, m); layer.set(b, m); changed = true; }
    }
    if (!changed) break; // (a prereq loop would keep changing; the pass limit stops it)
  }
  const fwd = edges.filter((e) => layer.get(e.to) > layer.get(e.from)); // drop anything a loop left backwards
  const nLayers = graphIds.length ? Math.max(...graphIds.map((id) => layer.get(id))) + 1 : 0;

  // ---- 2. dummy points for long arrows ----
  const isDummy = new Set();
  const chains = fwd.map((e, i) => {
    const chain = [e.from];
    for (let l = layer.get(e.from) + 1; l < layer.get(e.to); l++) {
      const d = `\u0000d${i}:${l}`;
      isDummy.add(d); layer.set(d, l); chain.push(d);
    }
    chain.push(e.to);
    return chain;
  });
  const up = new Map(), down = new Map(); // neighbours in the layer above / below, with weights
  const all = [...graphIds, ...isDummy];
  for (const v of all) { up.set(v, []); down.set(v, []); }
  for (const ch of chains) for (let k = 0; k + 1 < ch.length; k++) {
    const a = ch[k], b = ch[k + 1];
    const w = isDummy.has(a) && isDummy.has(b) ? 8 : isDummy.has(a) || isDummy.has(b) ? 2 : 1;
    down.get(a).push({ v: b, w }); up.get(b).push({ v: a, w });
  }

  // ---- 3. order within layers ----
  // Work on integer ids for speed. Several starting orders (the catalog order, a depth-first walk, then
  // seeded shuffles so the result is identical on every load); keep the one with the fewest crossings,
  // then the most labs in place.
  const vid = new Map(all.map((v, i) => [v, i]));
  const U = all.map((v) => up.get(v).map((n) => vid.get(n.v)));
  const D = all.map((v) => down.get(v).map((n) => vid.get(n.v)));
  const ctx = { U, D, pos: new Int32Array(all.length) };
  const chainsI = chains.map((ch) => ch.map((v) => vid.get(v)));
  const pairsI = pairs.filter(([a, b]) => layer.has(a) && layer.get(a) === layer.get(b)).map(([a, b]) => [vid.get(a), vid.get(b)]);
  const layerI = all.map((v) => layer.get(v));
  const rand = mulberry32(opts.seed ?? 7);
  const starts = [graphIds, dfsOrder(graphIds, fwd)];
  for (let k = 0; k < (opts.restarts ?? 40); k++) starts.push(shuffle(graphIds, rand));
  let best = null;
  for (const start of starts) {
    const r = orderFrom(start.map((v) => vid.get(v)));
    if (!best || r.x < best.x || (r.x === best.x && r.apart < best.apart)) best = r;
  }
  const layers = best ? best.layers.map((row) => row.map((i) => all[i])) : [];
  const crossings = best ? best.x : 0;

  function orderFrom(start) {
    const cur = Array.from({ length: nLayers }, () => []);
    const seen = new Uint8Array(all.length);
    const place = (v) => { if (!seen[v]) { seen[v] = 1; cur[layerI[v]].push(v); } };
    for (const v of start) { place(v); for (const ch of chainsI) if (ch[0] === v) for (let k = 1; k + 1 < ch.length; k++) place(ch[k]); }
    for (let v = 0; v < all.length; v++) place(v);
    setPos(cur, ctx.pos);
    let top = cur.map((l) => l.slice()), topX = totalCrossings(cur, ctx);
    for (let it = 0; it < 12 && topX > 0; it++) {
      if (it % 2 === 0) for (let l = 1; l < nLayers; l++) reorder(cur, l, U, ctx.pos);
      else for (let l = nLayers - 2; l >= 0; l--) reorder(cur, l, D, ctx.pos);
      transpose(cur, ctx);
      const x = totalCrossings(cur, ctx);
      if (x < topX) { top = cur.map((l) => l.slice()); topX = x; }
    }
    setPos(top, ctx.pos);
    // labs next to their lecture (just below it) when that adds no crossings
    let apart = 0;
    for (const [lec, lab] of pairsI) {
      const l = layerI[lec];
      const row = top[l];
      if (row.indexOf(lab) === row.indexOf(lec) + 1) continue;
      let pick = null;
      for (const after of [true, false]) {
        const trial = row.filter((x) => x !== lab);
        trial.splice(trial.indexOf(lec) + (after ? 1 : 0), 0, lab);
        top[l] = trial; setPos([trial], ctx.pos);
        const x = totalCrossings(top, ctx);
        if (x <= topX && (!pick || x < pick.x || (x === pick.x && after && !pick.after))) pick = { x, trial, after };
      }
      top[l] = pick ? pick.trial : row;
      setPos([top[l]], ctx.pos);
      if (pick) { topX = pick.x; if (!pick.after) apart += 0.5; } else apart++;
    }
    return { layers: top, x: topX, apart };
  }

  // ---- 4. vertical positions ----
  const y = new Map();
  for (const row of layers) {
    let t = 0;
    row.forEach((v, i) => { if (i) t += sep(row[i - 1], row[i]); y.set(v, t); });
    for (const v of row) y.set(v, y.get(v) - t / 2);
  }
  for (let it = 0; it < 60; it++) {
    const order = it % 2 ? [...layers.keys()].reverse() : [...layers.keys()];
    for (const l of order) {
      const row = layers[l];
      const want = row.map((v) => {
        let s = 0, w = 0;
        for (const n of [...up.get(v), ...down.get(v)]) { s += n.w * y.get(n.v); w += n.w; }
        return w ? { d: s / w, w } : { d: y.get(v), w: 0.01 };
      });
      const off = [0];
      for (let i = 1; i < row.length; i++) off.push(off[i - 1] + sep(row[i - 1], row[i]));
      const z = isotonic(want.map((x, i) => x.d - off[i]), want.map((x) => x.w));
      row.forEach((v, i) => y.set(v, z[i] + off[i]));
    }
  }
  let minY = Infinity, maxY = -Infinity;
  for (const row of layers) for (const v of row) { minY = Math.min(minY, y.get(v)); maxY = Math.max(maxY, y.get(v)); }
  if (!isFinite(minY)) { minY = 0; maxY = -1; }
  const graphH = maxY - minY + 1;
  const height = Math.max(graphH, isolated.length);
  const shift = 0.5 - minY + (height - graphH) / 2;
  const isoCol = isolated.length ? 1 : 0;
  const pos = new Map();
  for (const v of all) pos.set(v, { col: layer.get(v) + isoCol, y: y.get(v) + shift });
  const isoTop = (height - isolated.length) / 2 + 0.5;
  isolated.forEach((id, i) => pos.set(id, { col: 0, y: isoTop + i }));

  const paths = fwd.map((e, i) => ({ from: e.from, to: e.to, or: !!e.or, pts: chains[i].map((v) => pos.get(v)) }));
  for (const v of isDummy) pos.delete(v);
  return { columns: nLayers + isoCol, height, pos, paths, crossings, isolated, layers: layers.map((r) => r.filter((v) => !isDummy.has(v))) };

  function sep(a, b) {
    const da = isDummy.has(a), db = isDummy.has(b);
    return da && db ? SEP_DUMMY : da || db ? SEP_MIXED : SEP_REAL;
  }
}

// [lecture, lab] pairs from flowchart nodes: coreqs that are both drawn; the lab is the one with fewer
// credits (or the later one in the catalog list when credits tie).
// Also "XXX nnn5" worth 1-2 credits next to a bigger "XXX nnn0" (ECE 4755 DSP Lab -> ECE 4750), since
// the catalog doesn't always list the coreq.
export function labPairs(nodes) {
  const byCode = new Map(nodes.filter((n) => n.code && n.kind !== 'option').map((n) => [n.code, n]));
  const out = new Map();
  for (const n of byCode.values()) for (const c of n.coreqs || []) {
    const m = byCode.get(c);
    if (!m || m === n) continue;
    const labFirst = n.credits < m.credits || (n.credits === m.credits && n.order > m.order);
    const [lec, lab] = labFirst ? [m, n] : [n, m];
    out.set(lab.id, [lec.id, lab.id]);
  }
  for (const n of byCode.values()) {
    const k = /^([A-Z]+) (\d{3})5$/.exec(n.code);
    const m = k && byCode.get(`${k[1]} ${k[2]}0`);
    if (m && n.credits <= 2 && m.credits > n.credits && !out.has(n.id) && !out.has(m.id)) out.set(n.id, [m.id, n.id]);
  }
  return [...out.values()];
}

// Labs folded into their lecture's box: returns { nodes, edges } where each lecture node is a copy with
// labs: [lab nodes], lab boxes are gone, and the labs' arrows start/end at the lecture box instead.
export function foldLabs(nodes, edges) {
  const into = new Map(labPairs(nodes).map(([lec, lab]) => [lab, lec]));
  const shown = nodes.filter((n) => !into.has(n.id)).map((n) => ({ ...n, labs: nodes.filter((m) => into.get(m.id) === n.id) }));
  const map = (id) => into.get(id) ?? id;
  const out = new Map();
  for (const e of edges) {
    const f = { ...e, from: map(e.from), to: map(e.to) };
    if (f.from === f.to) continue;
    const key = f.from + '>' + f.to, had = out.get(key);
    if (!had) out.set(key, f); else if (had.or && !f.or) had.or = false;
  }
  return { nodes: shown, edges: [...out.values()] };
}

// ---- ordering helpers (integer node ids; pos[v] = v's index in its layer, kept current) ----
function setPos(rows, pos) {
  for (const row of rows) for (let i = 0; i < row.length; i++) pos[row[i]] = i;
}

// Sort one layer by the weighted median of its neighbours in the next layer up (nb = U) or down
// (nb = D); nodes with no neighbours there keep their slot.
function reorder(layers, l, nb, pos) {
  const row = layers[l];
  const key = row.map((v, i) => {
    const p = nb[v].map((n) => pos[n]).sort((a, b) => a - b);
    return { v, i, m: median(p), b: p.length ? p.reduce((s, x) => s + x, 0) / p.length : -1 };
  });
  const movable = key.filter((k) => k.m >= 0).sort((a, b) => a.m - b.m || a.b - b.b || a.i - b.i);
  let j = 0;
  layers[l] = key.map((k) => (k.m >= 0 ? movable[j++].v : k.v));
  setPos([layers[l]], pos);
}
function median(p) {
  const n = p.length;
  if (!n) return -1;
  const m = n >> 1;
  if (n % 2) return p[m];
  if (n === 2) return (p[0] + p[1]) / 2;
  const left = p[m - 1] - p[0], right = p[n - 1] - p[m];
  return left + right ? (p[m - 1] * right + p[m] * left) / (left + right) : (p[m - 1] + p[m]) / 2;
}

// Swap neighbours in a layer while that lowers crossings with the layers above and below.
function transpose(layers, { U, D, pos }) {
  // crossings between a's and b's edges when a sits directly above b
  const pairX = (a, b) => {
    let x = 0;
    for (const p of U[a]) for (const q of U[b]) if (pos[p] > pos[q]) x++;
    for (const p of D[a]) for (const q of D[b]) if (pos[p] > pos[q]) x++;
    return x;
  };
  for (let round = 0; round < 20; round++) {
    let improved = false;
    for (const row of layers) {
      for (let i = 0; i + 1 < row.length; i++) {
        const a = row[i], b = row[i + 1];
        if (pairX(b, a) < pairX(a, b)) { row[i] = b; row[i + 1] = a; pos[b] = i; pos[a] = i + 1; improved = true; }
      }
    }
    if (!improved) break;
  }
}

function totalCrossings(layers, { D, pos }) {
  let x = 0;
  const a = [], b = [];
  for (let l = 0; l + 1 < layers.length; l++) {
    a.length = 0; b.length = 0;
    for (const v of layers[l]) for (const n of D[v]) { a.push(pos[v]); b.push(pos[n]); }
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) if ((a[i] - a[j]) * (b[i] - b[j]) < 0) x++;
  }
  return x;
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(list, rand) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function dfsOrder(ids, edges) {
  const out = [], seen = new Set();
  const kids = new Map(ids.map((id) => [id, []]));
  const hasIn = new Set(edges.map((e) => e.to));
  for (const e of edges) kids.get(e.from).push(e.to);
  const visit = (v) => { if (seen.has(v)) return; seen.add(v); out.push(v); kids.get(v).forEach(visit); };
  ids.filter((id) => !hasIn.has(id)).forEach(visit);
  ids.forEach(visit);
  return out;
}

// Weighted isotonic regression (pool adjacent violators): z non-decreasing, minimising sum w*(z-d)^2.
function isotonic(d, w) {
  const blocks = [];
  d.forEach((v, i) => {
    blocks.push({ s: v * w[i], w: w[i], n: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
      if (a.s / a.w <= b.s / b.w) break;
      a.s += b.s; a.w += b.w; a.n += b.n; blocks.pop();
    }
  });
  const z = [];
  for (const b of blocks) for (let k = 0; k < b.n; k++) z.push(b.s / b.w);
  return z;
}

// Geometric crossings between arrows. Each path is a list of points {col, y} (or [col, y]) with rising
// col; between listed points an arrow is a straight line. Two arrows cross in a column gap when their
// order flips across it. Arrows that share an end box don't count there (they touch, not cross).
export function countCrossings(paths) {
  const at = paths.map((p) => {
    const pts = p.map((q) => (Array.isArray(q) ? { col: q[0], y: q[1] } : q));
    const m = new Map();
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k], b = pts[k + 1];
      for (let c = a.col; c <= b.col; c++) m.set(c, a.y + ((b.y - a.y) * (c - a.col)) / (b.col - a.col || 1));
    }
    return m;
  });
  let x = 0;
  for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) {
    for (const [c, yi] of at[i]) {
      if (!at[i].has(c + 1) || !at[j].has(c) || !at[j].has(c + 1)) continue;
      const s1 = yi - at[j].get(c), s2 = at[i].get(c + 1) - at[j].get(c + 1);
      if (Math.abs(s1) < 1e-9 || Math.abs(s2) < 1e-9) continue;
      if (s1 * s2 < 0) x++;
    }
  }
  return x;
}

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
    const perRow = opts.perRow ?? Math.max(columns, Math.ceil(isolated.length / 2));
    if (opts.inline && height <= 1 + 1e-9 && columns < perRow) {
      // a one-row graph: carry on along its row, then wrap
      const cells = [];
      for (let c = columns; c < perRow; c++) cells.push({ col: c, y: 0.5 });
      for (let r = 1; cells.length < isolated.length; r++) for (let c = 0; c < perRow; c++) cells.push({ col: c, y: 0.5 + r });
      isolated.forEach((id, i) => pos.set(id, cells[i]));
      height = Math.max(...cells.slice(0, isolated.length).map((q) => q.y)) + 0.5;
      columns = Math.max(columns, Math.min(perRow, Math.max(...cells.slice(0, isolated.length).map((q) => q.col)) + 1));
    } else {
      const y0 = parts.length ? height + GAP_ROW : 0;
      isolated.forEach((id, i) => pos.set(id, { col: i % perRow, y: y0 + 0.5 + Math.floor(i / perRow) }));
      columns = Math.max(columns, Math.min(isolated.length, perRow));
      height = y0 + Math.ceil(isolated.length / perRow);
    }
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

  // ---- 0. break prereq loops ----
  // Mutual "prereq or coreq" pairs (NURS 2300 <-> 2320) and catalog slips make loops; longest-path
  // layering would push a loop right on every pass (nursing ended up 63 columns wide). Drop each edge
  // that closes a loop (depth-first, in box order) so the earlier course stays left of its partner.
  {
    const out = new Map(graphIds.map((id) => [id, []]));
    edges.forEach((e) => out.get(e.from)?.push(e));
    const state = new Map(), back = new Set();
    const visit = (id) => {
      state.set(id, 1);
      for (const e of out.get(id) || []) { const s = state.get(e.to); if (s === 1) back.add(e); else if (!s) visit(e.to); }
      state.set(id, 2);
    };
    graphIds.forEach((id) => { if (!state.get(id)) visit(id); });
    if (back.size) edges = edges.filter((e) => !back.has(e));
  }

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
  // a course with no prereqs here whose arrows would all cross 3+ columns (CIVE 3310 -> 3335) moves
  // right to sit just before its first course, so its arrows stay short
  for (const id of graphIds) {
    if (partnerOf.has(id) || edges.some((e) => e.to === id)) continue;
    const kids = edges.filter((e) => e.from === id).map((e) => layer.get(e.to));
    if (!kids.length) continue;
    const t = Math.min(...kids) - 1;
    if (t - layer.get(id) >= 2) layer.set(id, t);
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
  // Each start gives an order; each order gets heights (step 4), and the simplest picture wins: fewest
  // crossings and bends (a bent arrow costs about as much as a crossing), labs in place, then shortest.
  let best = null;
  const tried = new Set();
  for (const start of starts) {
    const r = orderFrom(start.map((v) => vid.get(v)));
    const key = r.layers.map((row) => row.join(',')).join('|');
    if (tried.has(key)) continue;
    tried.add(key);
    r.layers = r.layers.map((row) => row.map((i) => all[i]));
    r.y = placeY(r.layers);
    let jogs = 0, multi = 0, lo = Infinity, hi = -Infinity;
    for (const ch of chains) {
      let j = 0;
      for (let k = 1; k < ch.length; k++) if (Math.abs(r.y.get(ch[k]) - r.y.get(ch[k - 1])) > 1e-6) j++;
      jogs += j; if (j > 1) multi++;
    }
    for (const v of all) { lo = Math.min(lo, r.y.get(v)); hi = Math.max(hi, r.y.get(v)); }
    r.cost = r.x * 4 + jogs * 3 + multi * 3 + r.apart * 3 + (hi - lo) * 0.5;
    if (!best || r.cost < best.cost - 1e-9) best = r;
  }
  const layers = best ? best.layers : [];
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
  function placeY(layers) {
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
    if (opts.straighten !== false) straighten(layers, up, down, y, sep, isDummy);
    return y;
  }
  const y = best ? best.y : new Map();
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

// ---- the whole flowchart: the major's chart, then a "Gen Ed" section under it ----
// Gen Ed boxes (area "General Education ...") go in their own section unless an arrow ties them to a
// box outside Gen Ed (MATH 1210 -> the physics and ECE classes stays in the major's chart).
export function splitGenEd(nodes, edges) {
  const isGen = new Set(nodes.filter((n) => /general\s+education/i.test(n.area || '')).map((n) => n.id));
  for (let changed = true; changed;) {
    changed = false;
    for (const e of edges) if (isGen.has(e.from) !== isGen.has(e.to)) for (const id of [e.from, e.to]) if (isGen.delete(id)) changed = true;
  }
  const part = (keep) => ({ nodes: nodes.filter((n) => keep(n.id)), edges: edges.filter((e) => keep(e.from) && keep(e.to)) });
  return { main: part((id) => !isGen.has(id)), gen: part((id) => isGen.has(id)) };
}

// flowChart(nodes, edges, sizes) -> routeChart's result for both sections in one picture, plus
// genTop (y of the Gen Ed heading, or null) and the main chart's layout (for its crossing count).
// sections = more sections drawn the same way, before Gen Ed: [{ key, label, test(node) }] (a minor's
// boxes). A box goes in the first section whose test it passes, unless an arrow ties it to a box in
// another section (then it stays in the main chart). heads = [{ key, label, top }] for each section drawn.
export function flowChart(nodes, edges, sizes = {}, sections = []) {
  const all = [...sections, { key: 'gen', label: 'Gen Ed', test: (n) => /general\s+education/i.test(n.area || '') }];
  const sec = new Map(nodes.map((n) => [n.id, all.find((s) => s.test(n))?.key ?? '']));
  for (let changed = true; changed;) {
    changed = false;
    for (const e of edges) if (sec.get(e.from) !== sec.get(e.to)) for (const id of [e.from, e.to]) if (sec.get(id)) { sec.set(id, ''); changed = true; }
  }
  const part = (key) => ({ nodes: nodes.filter((n) => sec.get(n.id) === key), edges: edges.filter((e) => sec.get(e.from) === key && sec.get(e.to) === key) });
  const main = part('');
  const LM = layoutGraph(main.nodes, main.edges);
  const C = routeChart(LM, sizes);
  const out = { ...C, boxes: new Map(C.boxes), edges: C.edges.slice(), genTop: null, heads: [], layout: LM };
  const head = sizes.head ?? 28;
  for (const s of all) {
    const p = part(s.key);
    if (!p.nodes.length) continue;
    const LG = layoutGraph(p.nodes, p.edges, { perRow: Math.max(4, LM.columns), inline: true });
    const G = routeChart(LG, sizes);
    const dy = out.boxes.size ? out.height + head : head;
    const top = dy - head + 6;
    out.heads.push({ key: s.key, label: s.label, top });
    if (s.key === 'gen') out.genTop = top;
    for (const [id, r] of G.boxes) out.boxes.set(id, { ...r, y: r.y + dy });
    for (const e of G.edges) out.edges.push({ ...e, pts: e.pts.map(([x, y]) => [x, y + dy]) });
    out.width = Math.max(out.width, G.width);
    out.height = dy + G.height;
  }
  return out;
}

// ---- drawing the arrows (pixels) ----
// routeChart(L, sizes) turns a layoutGraph result into pixels:
//   { width, height, boxes: Map(id -> {x, y, w, h}), edges: [{from, to, or, pts: [[x, y], ...]}] }
// Every arrow leaves its box's right side from its own exit point and enters the target's left side at
// its own entry point (several arrows on one side are spread along it, ordered by where they go, so
// they don't cross at the box). An arrow is one level line when it can be; otherwise it makes ONE
// upright jog in a gap between columns; only when no single jog fits does it follow the layout's points.
// Each jog gets its own track in its gap (gaps widen to fit them, `track` px apart), ordered to cross
// as little as possible. Level pieces of different arrows never run closer than `track` px.
export function routeChart(L, o = {}) {
  const boxW = o.boxW ?? 120, boxH = o.boxH ?? 48, rowH = o.rowH ?? 58, pad = o.pad ?? 12;
  const gapMin = o.gapMin ?? 30, track = o.track ?? 10, port = o.port ?? 10, margin = o.margin ?? 6, near = o.near ?? 8;
  const R = boxH / 2 - 4; // exit/entry points stay this close to the box middle
  const Y = (y) => pad + y * rowH;
  const nCols = L.columns;
  const colBoxes = Array.from({ length: nCols }, () => []);
  for (const [id, p] of L.pos) colBoxes[p.col].push({ id, cy: Y(p.y) });
  const center = (id) => Y(L.pos.get(id).y);
  const clear = (c, yy) => colBoxes[c].every((b) => Math.abs(yy - b.cy) >= boxH / 2 + margin);

  // ---- exit/entry points ----
  const E = L.paths.map((p, i) => {
    const ys = p.pts.map((q) => Y(q.y));
    return { i, from: p.from, to: p.to, or: p.or, a: p.pts[0].col, b: p.pts[p.pts.length - 1].col, ys, cs: ys[0], ct: ys[ys.length - 1] };
  });
  // an arrow "wants" to be level when its layout points are (nearly) level and every column it passes is clear
  for (const e of E) {
    const lo = Math.max(...e.ys) - R, hi = Math.min(...e.ys) + R;
    e.want = null;
    if (lo <= hi + 1e-9) {
      const mid = e.ys.slice(1, -1);
      const t = mid.length ? mid.reduce((s, v) => s + v, 0) / mid.length : (e.cs + e.ct) / 2;
      const yy = Math.min(hi, Math.max(lo, t));
      let ok = true;
      for (let c = e.a + 1; c < e.b; c++) if (!clear(c, yy)) ok = false;
      if (ok) e.want = yy;
    }
  }
  const sides = new Map(); // `${id}>` (exit side) / `>${id}` (entry side) -> edges
  const add = (k, e) => (sides.get(k) ?? sides.set(k, []).get(k)).push(e);
  for (const e of E) { add(e.from + '>', e); add('>' + e.to, e); }
  const portY = new Map(); // `${i}s` / `${i}t` -> y
  const solveSide = (k, list, round) => {
    const out = k.endsWith('>');
    const cy = out ? center(list[0].from) : center(list[0].to);
    // order along the side by where each arrow heads next (then by its far end)
    const dir = (e) => (out ? e.ys[1] : e.ys[e.ys.length - 2]);
    const far = (e) => (out ? e.ct : e.cs);
    const key = (e) => (e.want !== null ? e.want : dir(e));
    list.sort((p, q) => key(p) - key(q) || far(p) - far(q) || p.i - q.i);
    const n = list.length, sp = n > 1 ? Math.min(port, (2 * R) / (n - 1)) : port;
    const targets = list.map((e, j) => {
      const other = portY.get(e.i + (out ? 't' : 's'));
      const t = e.want !== null ? (round && other !== undefined ? other : e.want) : Math.min(cy + R, Math.max(cy - R, dir(e)));
      return [{ t: t - j * sp, w: e.want !== null ? 10 : 1 }, { t: cy - ((n - 1) / 2) * sp, w: 0.5 }];
    });
    const z = isoL1(targets).map((v, j) => v + j * sp);
    // keep inside the box: shift up/down as needed
    for (let j = 0; j < n; j++) z[j] = Math.max(z[j], cy - R + j * sp);
    for (let j = n - 1; j >= 0; j--) z[j] = Math.min(z[j], cy + R - (n - 1 - j) * sp);
    list.forEach((e, j) => portY.set(e.i + (out ? 's' : 't'), Math.round(z[j] * 2) / 2));
  };
  for (let round = 0; round < 4; round++) for (const [k, list] of sides) solveSide(k, list, round);
  for (const e of E) { e.ps = portY.get(e.i + 's'); e.pt = portY.get(e.i + 't'); }
  // An exit point level with a different arrow's entry point across the same gap would make two lines
  // meet end to end there. Nudge one of them (within its box side, keeping the order) until none do.
  const level = (e) => Math.abs(e.ps - e.pt) < 0.5;
  const clashes = () => {
    let n = 0;
    for (const p of E) for (const q of E) if (p !== q && q.b === p.a + 1 && Math.abs(p.ps - q.pt) < near) n++;
    return n;
  };
  // A move pushes its neighbours along the side to keep the spacing, and a level arrow moves both ends
  // together so it stays level.
  const sideAt = (e, out) => {
    const list = sides.get(out ? e.from + '>' : '>' + e.to);
    const n = list.length;
    return { list, cy: out ? center(e.from) : center(e.to), sp: n > 1 ? Math.min(port, (2 * R) / (n - 1)) : port };
  };
  const get = (e, out) => (out ? e.ps : e.pt);
  const put = (e, out, v) => { if (out) e.ps = v; else e.pt = v; };
  const tryMove = (e0, out0, v0) => {
    const snap = E.map((x) => [x.ps, x.pt]);
    const undo = () => E.forEach((x, i) => { [x.ps, x.pt] = snap[i]; });
    const wasLevel = new Set(E.filter(level));
    const queue = [[e0, out0, v0]];
    for (let steps = 0; queue.length; steps++) {
      const [x, o, v] = queue.shift();
      const s = sideAt(x, o), j = s.list.indexOf(x);
      if (steps > 300 || v < s.cy - R - 1e-9 || v > s.cy + R + 1e-9) { undo(); return false; }
      if (Math.abs(get(x, o) - v) < 1e-9) continue;
      put(x, o, v);
      if (wasLevel.has(x)) queue.push([x, !o, v]);
      if (j > 0 && get(s.list[j - 1], o) > v - s.sp + 1e-9) queue.push([s.list[j - 1], o, v - s.sp]);
      if (j < s.list.length - 1 && get(s.list[j + 1], o) < v + s.sp - 1e-9) queue.push([s.list[j + 1], o, v + s.sp]);
    }
    for (const x of wasLevel) for (let c = x.a + 1; c < x.b; c++) if (!clear(c, x.ps)) { undo(); return false; }
    return true;
  };
  let bad = clashes();
  for (let pass = 0; pass < 60 && bad; pass++) {
    let best = null;
    const base = E.map((x) => [x.ps, x.pt]);
    const reset = () => E.forEach((x, i) => { [x.ps, x.pt] = base[i]; });
    for (const p of E) for (const q of E) {
      if (p === q || q.b !== p.a + 1 || Math.abs(p.ps - q.pt) >= near) continue;
      for (const [e, out] of [[p, true], [q, false]]) {
        const from = get(e, out);
        for (let d = 1; d <= 2 * R; d++) for (const v of [from + d, from - d]) {
          if (!tryMove(e, out, v)) continue;
          const c = clashes();
          if (c < bad && (!best || c < best.c || (c === best.c && d < best.d))) best = { c, d, after: E.map((x) => [x.ps, x.pt]) };
          reset();
        }
      }
    }
    if (!best) break;
    E.forEach((x, i) => { [x.ps, x.pt] = best.after[i]; });
    bad = best.c;
  }

  // ---- routes ----
  // A route is level runs between jogs. Runs live on a half-column grid: column c's boxes span [2c, 2c+1],
  // the gap after it [2c+1, 2c+2]; a jog in gap k sits at 2k+1.5.
  const runs = []; // {e, y, x1, x2}
  const jogs = []; // {e, k, y1, y2}
  const runsClash = (y, x1, x2, ei) => runs.some((r) => r.e !== ei && Math.abs(r.y - y) < near && Math.min(r.x2, x2) >= Math.max(r.x1, x1));
  const plan = (e) => {
    const options = [];
    const levelOk = (yy, c1, c2) => { for (let c = c1; c <= c2; c++) if (!clear(c, yy)) return false; return true; };
    if (Math.abs(e.ps - e.pt) < 0.5 && levelOk(e.ps, e.a + 1, e.b - 1)) options.push({ cost: 0, runs: [[e.ps, 2 * e.a + 1, 2 * e.b]], jogs: [] });
    for (let k = e.a; k < e.b; k++) {
      if (!levelOk(e.ps, e.a + 1, k) || !levelOk(e.pt, k + 1, e.b - 1)) continue;
      // prefer the jog next to the target for a long arrow (then it reads "comes in from the side")
      options.push({ cost: 10 + (e.b - 1 - k) * 0.1, runs: [[e.ps, 2 * e.a + 1, 2 * k + 1.5], [e.pt, 2 * k + 1.5, 2 * e.b]], jogs: [[k, e.ps, e.pt]] });
    }
    // two jogs through a clear level line (the layout's own one first, then any clear one nearby)
    if (e.b - e.a > 1) {
      const cands = [...new Set([...e.ys.slice(1, -1)])];
      for (let d = 0; d <= 40; d++) for (const s of [1, -1]) cands.push(e.ys[1] + s * d * (track / 2));
      for (const yd of cands) {
        if (!levelOk(yd, e.a + 1, e.b - 1)) continue;
        options.push({ cost: 20 + Math.abs(yd - e.ys[1]) * 0.01, runs: [[e.ps, 2 * e.a + 1, 2 * e.a + 1.5], [yd, 2 * e.a + 1.5, 2 * e.b - 0.5], [e.pt, 2 * e.b - 0.5, 2 * e.b]], jogs: [[e.a, e.ps, yd], [e.b - 1, yd, e.pt]] });
      }
    }
    // crossings with what's already drawn: a level run through a gap with someone's jog there
    const xCost = (op) => {
      let x = 0;
      for (const [y, x1, x2] of op.runs) for (const j of jogs) {
        const g = 2 * j.k + 1.5;
        if (x1 <= g && g <= x2 && y > Math.min(j.y1, j.y2) && y < Math.max(j.y1, j.y2)) x += x1 === g || x2 === g ? 0.5 : 1;
      }
      for (const [k, y1, y2] of op.jogs) for (const r of runs) {
        const g = 2 * k + 1.5;
        if (r.x1 <= g && g <= r.x2 && r.y > Math.min(y1, y2) && r.y < Math.max(y1, y2)) x += r.x1 === g || r.x2 === g ? 0.5 : 1;
      }
      return x;
    };
    let pick = null;
    for (const op of options) {
      if (op.runs.some(([y, x1, x2]) => runsClash(y, x1, x2, e.i))) continue;
      const c = op.cost + xCost(op) * 4;
      if (!pick || c < pick.c) pick = { ...op, c };
    }
    if (!pick) { // nothing clean: follow the layout's points (a jog per change)
      const r = [], j = [];
      let x0 = 2 * e.a + 1, yy = e.ps;
      const ys = [e.ps, ...e.ys.slice(1, -1), e.pt];
      for (let k = 1; k < ys.length; k++) {
        if (Math.abs(ys[k] - yy) < 0.5) continue;
        const g = 2 * (e.a + k - 1) + 1.5;
        r.push([yy, x0, g]); j.push([e.a + k - 1, yy, ys[k]]); x0 = g; yy = ys[k];
      }
      r.push([yy, x0, 2 * e.b]);
      pick = { runs: r, jogs: j };
    }
    for (const [y, x1, x2] of pick.runs) runs.push({ e: e.i, y, x1, x2 });
    for (const [k, y1, y2] of pick.jogs) jogs.push({ e: e.i, k, y1, y2 });
    e.route = pick;
  };
  // straight-looking ones first, then short ones (they have no choice), then long ones
  const order = E.slice().sort((p, q) => (Math.abs(p.ps - p.pt) < 0.5 ? 0 : 1) - (Math.abs(q.ps - q.pt) < 0.5 ? 0 : 1) || (p.b - p.a) - (q.b - q.a) || p.i - q.i);
  order.forEach(plan);

  // ---- tracks: order the jogs in each gap to cross least (exact for up to 12, else greedy) ----
  const byGap = new Map();
  for (const j of jogs) (byGap.get(j.k) ?? byGap.set(j.k, []).get(j.k)).push(j);
  const gapW = Array.from({ length: Math.max(0, nCols - 1) }, (_, k) => Math.max(gapMin, ((byGap.get(k)?.length ?? 0) + 1) * track));
  for (const [, list] of byGap) {
    const n = list.length;
    const inside = (v, j) => v > Math.min(j.y1, j.y2) && v < Math.max(j.y1, j.y2);
    // cost[i][j]: crossings when i's track is left of j's
    const cost = list.map((p) => list.map((q) => (p === q ? 0 : (inside(q.y1, p) ? 1 : 0) + (inside(p.y2, q) ? 1 : 0))));
    let perm;
    if (n <= 12) {
      const full = (1 << n) - 1, dp = new Float64Array(1 << n).fill(Infinity), from = new Int32Array(1 << n);
      dp[0] = 0;
      for (let S = 0; S < full; S++) {
        if (dp[S] === Infinity) continue;
        for (let v = 0; v < n; v++) {
          if (S & (1 << v)) continue;
          let c = dp[S];
          for (let u = 0; u < n; u++) if (S & (1 << u)) c += cost[u][v];
          const T = S | (1 << v);
          if (c < dp[T]) { dp[T] = c; from[T] = v; }
        }
      }
      perm = [];
      for (let S = full; S; S &= ~(1 << from[S])) perm.unshift(from[S]);
    } else {
      perm = list.map((_, i) => i).sort((a, b) => cost[a][b] - cost[b][a]);
    }
    perm.forEach((v, slot) => { list[v].slot = slot; list[v].of = n; });
  }
  const colX = [pad];
  for (let c = 1; c < nCols; c++) colX.push(colX[c - 1] + boxW + gapW[c - 1]);
  const gx = (k, slot, of) => colX[k] + boxW + (gapW[k] * (slot + 1)) / (of + 1);

  const edges = E.map((e) => {
    const pts = [[colX[e.a] + boxW, e.ps]];
    const js = jogs.filter((j) => j.e === e.i).sort((p, q) => p.k - q.k);
    for (const j of js) { const x = gx(j.k, j.slot, j.of); pts.push([x, j.y1], [x, j.y2]); }
    pts.push([colX[e.b], e.pt]);
    return { from: e.from, to: e.to, or: e.or, pts };
  });
  const boxes = new Map();
  for (const [id, p] of L.pos) boxes.set(id, { x: colX[p.col], y: Y(p.y) - boxH / 2, w: boxW, h: boxH });
  const width = colX[nCols - 1] + boxW + pad;
  const height = Y(L.height) + pad;
  return { width, height, boxes, edges };
}

// z non-decreasing minimising sum w*|z_i - t| over each element's targets [[{t, w}], ...] (pooled blocks
// sit at the weighted median of their targets).
function isoL1(targets) {
  const med = (list) => {
    const s = list.slice().sort((a, b) => a.t - b.t);
    const half = s.reduce((a, x) => a + x.w, 0) / 2;
    let acc = 0;
    for (const x of s) { acc += x.w; if (acc >= half - 1e-9) return x.t; }
    return s[s.length - 1].t;
  };
  const blocks = [];
  for (const list of targets) {
    blocks.push({ list, n: 1, v: med(list) });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
      if (a.v <= b.v) break;
      a.list = a.list.concat(b.list); a.n += b.n; a.v = med(a.list); blocks.pop();
    }
  }
  const z = [];
  for (const b of blocks) for (let k = 0; k < b.n; k++) z.push(b.v);
  return z;
}

// ---- drawn-chart checks (pixels) ----
// chart = { boxes: Map(id -> {x, y, w, h}) (top-left corner), edges: [{from, to, pts: [[x, y], ...]}] } with
// level/upright segments. Returns counts plus every problem found:
//   bends     corners summed over all arrows; straight = arrows with no corner
//   crossings an upright piece of one arrow crossing a level piece of another
//   overlaps  two arrows running on top of (or closer than `near` px alongside) each other
//   boxHits   an arrow running through a box
export function chartStats(chart, near = 7) {
  const segsOf = (pts) => {
    const out = [];
    for (let k = 0; k + 1 < pts.length; k++) {
      const [x1, y1] = pts[k], [x2, y2] = pts[k + 1];
      if (Math.abs(x1 - x2) < 0.01 && Math.abs(y1 - y2) < 0.01) continue;
      const h = Math.abs(y1 - y2) < 0.01;
      const s = h ? { h, c: y1, a: Math.min(x1, x2), b: Math.max(x1, x2) } : { h, c: x1, a: Math.min(y1, y2), b: Math.max(y1, y2) };
      const last = out[out.length - 1];
      if (last && last.h === s.h && Math.abs(last.c - s.c) < 0.01) { last.a = Math.min(last.a, s.a); last.b = Math.max(last.b, s.b); } else out.push(s);
    }
    return out;
  };
  const segs = chart.edges.map((e) => segsOf(e.pts));
  let bends = 0, straight = 0, crossings = 0;
  const overlaps = [], boxHits = [];
  segs.forEach((s) => { bends += Math.max(0, s.length - 1); if (s.length === 1) straight++; });
  const name = (i) => `${chart.edges[i].from}>${chart.edges[i].to}`;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    for (const p of segs[i]) for (const q of segs[j]) {
      if (p.h === q.h) {
        if (Math.abs(p.c - q.c) < near && Math.min(p.b, q.b) - Math.max(p.a, q.a) > 1) overlaps.push(`${name(i)} / ${name(j)} at ${p.h ? 'y' : 'x'}=${Math.round(p.c)}`);
      } else {
        const [hz, vt] = p.h ? [p, q] : [q, p];
        if (vt.c > hz.a + 0.5 && vt.c < hz.b - 0.5 && hz.c > vt.a + 0.5 && hz.c < vt.b - 0.5) crossings++;
      }
    }
  }
  segs.forEach((list, i) => {
    for (const s of list) for (const [id, r] of chart.boxes) {
      const [lo, hi, a, b] = s.h ? [r.y, r.y + r.h, r.x, r.x + r.w] : [r.x, r.x + r.w, r.y, r.y + r.h];
      if (s.c > lo + 1 && s.c < hi - 1 && Math.min(s.b, b - 1) > Math.max(s.a, a + 1)) boxHits.push(`${name(i)} through ${id}`);
    }
  });
  return { edges: segs.length, bends, straight, crossings, overlaps, boxHits };
}

// Straight arrows (Brandes-Koepf style). Between each pair of neighbouring columns pick the largest set of
// arrows that can all be level at once (they must not cross each other, and a box can be level with only
// one box on each side): an exact dynamic program per column pair. Pieces of one long arrow weigh most,
// so a long arrow runs straight through the columns it passes. Boxes linked this way form "blocks" that
// move as one. Blocks are stacked with the usual gaps, then each block slides toward the weighted median
// of the boxes it links to (as far as its neighbours allow), which levels more arrows by luck and keeps
// the bent ones short.
function straighten(layers, up, down, y, sep, isDummy) {
  const w = (a, b) => (isDummy.has(a) && isDummy.has(b) ? 50 : 1);
  const alignUp = new Map(); // v -> its partner in the column to the left
  for (let l = 0; l + 1 < layers.length; l++) {
    const A = layers[l], B = layers[l + 1];
    const ia = new Map(A.map((v, i) => [v, i]));
    const n = A.length, m = B.length;
    const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
    const has = (i, j) => up.get(B[j]).some((x) => x.v === A[i]);
    for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
      let best = Math.max(dp[i - 1][j], dp[i][j - 1]);
      if (has(i - 1, j - 1)) best = Math.max(best, dp[i - 1][j - 1] + w(A[i - 1], B[j - 1]) + 1e-3 * -Math.abs(y.get(A[i - 1]) - y.get(B[j - 1])));
      dp[i][j] = best;
    }
    for (let i = n, j = m; i > 0 && j > 0;) {
      if (dp[i][j] === dp[i - 1][j]) i--;
      else if (dp[i][j] === dp[i][j - 1]) j--;
      else { alignUp.set(B[j - 1], A[i - 1]); i--; j--; }
    }
    void ia;
  }
  // blocks
  const blockOf = new Map(), blocks = [];
  for (const row of layers) for (const v of row) {
    const p = alignUp.get(v);
    if (p !== undefined) { blockOf.set(v, blockOf.get(p)); blocks[blockOf.get(p)].push(v); } else { blockOf.set(v, blocks.length); blocks.push([v]); }
  }
  // constraints: a above b in some column -> y(b) - y(a) >= s
  const above = blocks.map(() => new Map()), below = blocks.map(() => new Map());
  for (const row of layers) for (let i = 1; i < row.length; i++) {
    const a = blockOf.get(row[i - 1]), b = blockOf.get(row[i]), s = sep(row[i - 1], row[i]);
    if (a === b) return; // can't happen with level links that don't cross; keep the old heights if it does
    below[a].set(b, Math.max(below[a].get(b) ?? 0, s));
    above[b].set(a, Math.max(above[b].get(a) ?? 0, s));
  }
  // stack: longest path from the top (Kahn order); a loop would leave blocks unplaced -> give up
  const indeg = blocks.map((_, b) => above[b].size), queue = [], by = new Float64Array(blocks.length), order = [];
  indeg.forEach((d, b) => { if (!d) queue.push(b); });
  while (queue.length) {
    const b = queue.shift(); order.push(b);
    for (const [c, s] of below[b]) { by[c] = Math.max(by[c], by[b] + s); if (--indeg[c] === 0) queue.push(c); }
  }
  if (order.length !== blocks.length) return;
  // slide toward neighbours (median), within the room the blocks above and below leave
  const links = blocks.map((list, b) => {
    const out = [];
    for (const v of list) for (const nb of [...up.get(v), ...down.get(v)]) { const c = blockOf.get(nb.v); if (c !== b) out.push({ c, w: nb.w }); }
    return out;
  });
  for (let it = 0; it < 60; it++) {
    let moved = 0;
    const seq = it % 2 ? order.slice().reverse() : order;
    for (const b of seq) {
      let lo = -Infinity, hi = Infinity;
      for (const [a, s] of above[b]) lo = Math.max(lo, by[a] + s);
      for (const [c, s] of below[b]) hi = Math.min(hi, by[c] - s);
      if (!links[b].length) continue;
      const t = links[b].map((x) => ({ t: by[x.c], w: x.w })).sort((p, q) => p.t - q.t);
      const half = t.reduce((s, x) => s + x.w, 0) / 2;
      let acc = 0, med = t[t.length - 1].t;
      for (const x of t) { acc += x.w; if (acc >= half - 1e-9) { med = x.t; break; } }
      const nv = Math.min(hi, Math.max(lo, med));
      if (Math.abs(nv - by[b]) > 1e-9) { moved++; by[b] = nv; }
    }
    if (!moved) break;
  }
  blocks.forEach((list, b) => list.forEach((v) => y.set(v, by[b])));
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

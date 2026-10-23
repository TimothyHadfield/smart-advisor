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
//     isolated, clusters, bundles: [{id, from: [ids], to: [ids], or, col, y}] }
//   A path in a bundle carries `bundle` (its id); its pts end at the bundle's target.
//   y is a box centre in row units (a box is 1 row tall incl. its gap); height is the total in rows.

const SEP_REAL = 1;      // box to box
const SEP_MIXED = 0.62;  // box to a passing arrow
const SEP_DUMMY = 0.34;  // arrow to arrow

// The drawn check: the laptop box size (js/app.js BASE + FITS[0]) and what a drawing costs. A crossing
// is the worst thing, then lines on top of each other, then corners, then total line length.
const EVAL = { boxW: 116, boxH: 48, rowH: 58, gapMin: 26, port: 10, near: 8, pad: 12, track: 9 };
const drawnScore = (st, L) => st.crossings * 100 + st.foreign * 30 + st.overlaps.length * 3 + st.boxHits.length * 50 + st.bends * 2 + (st.length ?? 0) / EVAL.rowH * 0.3 + L.height * 0.1;

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
  // Each cluster: the best few orders with bundles and the best few without, each drawn (routeChart at
  // the laptop box size) and scored as the eye sees it; the simplest drawing wins (opts.bundle true/false
  // forces one kind, opts.alts: false skips the drawn check).
  const parts = comps.map((g) => {
    const ids = new Set(g.map((n) => n.id));
    const es = edges.filter((e) => ids.has(e.from)), o = { ...opts, pairs: pairs.filter(([a]) => ids.has(a)) };
    if (opts.alts === false) return layered(g, es, o);
    const alts = [];
    if (opts.bundle !== false) alts.push(...layered(g, es, { ...o, bundle: true, alts: opts.altsB ?? 3 }));
    if (opts.bundle !== true) alts.push(...layered(g, es, { ...o, bundle: false, alts: opts.altsP ?? 3 }));
    let best = null;
    const seen = new Set();
    for (const L of alts) {
      const sig = [...L.pos].map(([id, q]) => `${id}@${q.col},${q.y}`).sort().join('|') + '#' + (L.bundles || []).map((B) => B.id).sort().join('|');
      if (seen.has(sig)) continue;
      seen.add(sig);
      const st = chartStats(routeChart(L, EVAL));
      const score = drawnScore(st, L);
      if (!best || score < best.score - 1e-9) best = { L, score };
    }
    return best.L;
  });

  // Pack: the biggest cluster first; each smaller one goes just above or below what's already in its
  // columns, whichever keeps the chart shortest (it can tuck under a short column).
  const pos = new Map(), paths = [], bundles = [];
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
    for (const b of p.bundles) bundles.push({ ...b, y: b.y + off });
  });
  for (const q of [...pos.values(), ...paths.flatMap((e) => e.pts), ...bundles]) q.y -= top;
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
  return { columns, height, pos, paths, bundles, crossings, isolated, clusters: parts.length };
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

  // ---- 0 + 1. loops broken, layers (layerAll) ----
  const LA = layerAll(graphIds, edges, pairs, partnerOf);
  edges = LA.edges;
  const layer = LA.layer;
  const fwd = edges.filter((e) => layer.get(e.to) > layer.get(e.from)); // drop anything a loop left backwards
  const nLayers = graphIds.length ? Math.max(...graphIds.map((id) => layer.get(id))) + 1 : 0;

  // ---- 2. bundles, then dummy points for long arrows ----
  // A bundle = every class in S needs every class in T (T all in one column): drawn as one shared line
  // (a bar just before T's column; S's lines join it, T's lines leave it). In the ordering it is one
  // "joint" point in a half column right before T's column, so its lines count as few crossings as drawn.
  const bundles = opts.bundle === false ? [] : findBundles(fwd, layer);
  const bundleOf = new Map();
  bundles.forEach((b) => b.edges.forEach((e) => bundleOf.set(e, b)));
  // slots: column L = key 2L; a joint before column L = key 2L-1 (only where a bundle needs one)
  const keySet = new Set();
  for (let l = 0; l < nLayers; l++) keySet.add(2 * l);
  for (const b of bundles) keySet.add(2 * b.col - 1);
  const keyList = [...keySet].sort((p, q) => p - q);
  const slotOf = new Map(keyList.map((k, i) => [k, i]));
  const nSlots = keyList.length;
  const slot = new Map(graphIds.map((id) => [id, slotOf.get(2 * layer.get(id))]));
  const isDummy = new Set(), isJoint = new Set();
  let nd = 0;
  const chainTo = (from, to) => {
    const ch = [from];
    for (let s = slot.get(from) + 1; s < slot.get(to); s++) { const d = `\u0000d${nd++}`; isDummy.add(d); slot.set(d, s); ch.push(d); }
    ch.push(to);
    return ch;
  };
  bundles.forEach((b, k) => { b.joint = `\u0000j${k}`; isJoint.add(b.joint); slot.set(b.joint, slotOf.get(2 * b.col - 1)); });
  const chains = [];
  const edgeChain = new Map();
  for (const e of fwd) if (!bundleOf.has(e)) { const ch = chainTo(e.from, e.to); chains.push(ch); edgeChain.set(e, ch); }
  for (const b of bundles) {
    b.legs = new Map();
    for (const s of b.S) { const ch = chainTo(s, b.joint); chains.push(ch); b.legs.set(s, ch); }
    for (const t of b.T) chains.push([b.joint, t]);
  }
  const virt = (v) => isDummy.has(v) || isJoint.has(v);
  const up = new Map(), down = new Map(); // neighbours in the slot above / below, with weights
  const all = [...graphIds, ...isDummy, ...isJoint];
  for (const v of all) { up.set(v, []); down.set(v, []); }
  for (const ch of chains) for (let k = 0; k + 1 < ch.length; k++) {
    const a = ch[k], b = ch[k + 1];
    const w = virt(a) && virt(b) ? 8 : virt(a) || virt(b) ? 2 : 1;
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
  const chainsFrom = all.map(() => []);
  for (const ch of chainsI) chainsFrom[ch[0]].push(ch);
  const pairsI = pairs.filter(([a, b]) => layer.has(a) && layer.get(a) === layer.get(b)).map(([a, b]) => [vid.get(a), vid.get(b)]);
  const layerI = all.map((v) => slot.get(v));
  const rand = mulberry32(opts.seed ?? 7);
  const starts = [graphIds, dfsOrder(graphIds, fwd)];
  for (let k = 0; k < (opts.restarts ?? 40); k++) starts.push(shuffle(graphIds, rand));
  // Each start gives an order; each order gets heights (step 4), and the simplest picture wins: fewest
  // crossings and bends (a bent arrow costs about as much as a crossing), labs in place, then shortest.
  // Orders with the fewest crossings (within a few of the best) then get heights; their cost adds bends.
  const found = [];
  const tried = new Set();
  for (const start of starts) {
    const r = orderFrom(start.map((v) => vid.get(v)));
    const key = r.layers.map((row) => row.join(',')).join('|');
    if (tried.has(key)) continue;
    tried.add(key);
    found.push(r);
  }
  const minX = Math.min(...found.map((r) => r.x));
  const short = found.filter((r) => r.x <= minX + (opts.slack ?? 3)).sort((p, q) => p.x - q.x || p.apart - q.apart).slice(0, opts.keep ?? 12);
  for (const r of short) {
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
  }
  short.sort((p, q) => p.cost - q.cost);

  function orderFrom(start) {
    const cur = Array.from({ length: nSlots }, () => []);
    const seen = new Uint8Array(all.length);
    const place = (v) => { if (!seen[v]) { seen[v] = 1; cur[layerI[v]].push(v); } };
    for (const v of start) { place(v); for (const ch of chainsFrom[v]) for (let k = 1; k + 1 < ch.length; k++) place(ch[k]); }
    for (let v = 0; v < all.length; v++) place(v);
    setPos(cur, ctx.pos);
    let top = cur.map((l) => l.slice()), topX = totalCrossings(cur, ctx);
    for (let it = 0, idle = 0; it < 12 && topX > 0 && idle < 4; it++) {
      if (it % 2 === 0) for (let l = 1; l < nSlots; l++) reorder(cur, l, U, ctx.pos);
      else for (let l = nSlots - 2; l >= 0; l--) reorder(cur, l, D, ctx.pos);
      transpose(cur, ctx);
      const x = totalCrossings(cur, ctx);
      if (x < topX) { top = cur.map((l) => l.slice()); topX = x; idle = 0; } else idle++;
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
    // index arrays (this runs for every candidate order, so it is kept tight)
    const rows = layers.map((row) => row.map((v) => vid.get(v)));
    const nb = all.map((v) => [...up.get(v), ...down.get(v)].map((n) => vid.get(n.v)));
    const nw = all.map((v) => [...up.get(v), ...down.get(v)].map((n) => n.w));
    const sepI = rows.map((row) => row.map((v, i) => (i ? sep(all[row[i - 1]], all[v]) : 0)));
    const yy = new Float64Array(all.length);
    for (const [l, row] of rows.entries()) {
      let t = 0;
      row.forEach((v, i) => { t += sepI[l][i]; yy[v] = t; });
      for (const v of row) yy[v] -= t / 2;
    }
    for (let it = 0; it < 60; it++) {
      let moved = 0;
      for (let q = 0; q < rows.length; q++) {
        const l = it % 2 ? rows.length - 1 - q : q;
        const row = rows[l], n = row.length;
        const d = new Array(n), w = new Array(n), off = new Array(n);
        let o = 0;
        for (let i = 0; i < n; i++) {
          const v = row[i];
          o += sepI[l][i]; off[i] = o;
          let s = 0, ws = 0;
          const L = nb[v], W = nw[v];
          for (let k = 0; k < L.length; k++) { s += W[k] * yy[L[k]]; ws += W[k]; }
          if (ws) { d[i] = s / ws - o; w[i] = ws; } else { d[i] = yy[v] - o; w[i] = 0.01; }
        }
        const z = isotonic(d, w);
        for (let i = 0; i < n; i++) { const nv = z[i] + off[i]; if (Math.abs(nv - yy[row[i]]) > 1e-9) moved++; yy[row[i]] = nv; }
      }
      if (!moved) break;
    }
    const y = new Map(all.map((v, i) => [v, yy[i]]));
    if (opts.straighten !== false) straighten(layers, up, down, y, sep, isDummy);
    return y;
  }
  // the chosen candidates as results (opts.alts: how many, best first)
  const outs = (short.length ? short.slice(0, opts.alts || 1) : [null]).map(build);
  return opts.alts ? outs : outs[0];

  function build(best) {
    const layers = best ? best.layers : [];
    const crossings = best ? best.x : 0;
    const y = best ? best.y : new Map();
    let minY = Infinity, maxY = -Infinity;
    for (const row of layers) for (const v of row) { minY = Math.min(minY, y.get(v)); maxY = Math.max(maxY, y.get(v)); }
    if (!isFinite(minY)) { minY = 0; maxY = -1; }
    const graphH = maxY - minY + 1;
    const height = Math.max(graphH, isolated.length);
    const shift = 0.5 - minY + (height - graphH) / 2;
    const isoCol = isolated.length ? 1 : 0;
    const pos = new Map();
    const colOf = (v) => keyList[slot.get(v)] / 2; // a joint's half column: x.5
    for (const v of all) pos.set(v, { col: colOf(v) + isoCol, y: y.get(v) + shift });
    const isoTop = (height - isolated.length) / 2 + 0.5;
    isolated.forEach((id, i) => pos.set(id, { col: 0, y: isoTop + i }));

    const whole = (ch) => ch.filter((v) => !isJoint.has(v) && Number.isInteger(colOf(v))).map((v) => pos.get(v));
    const paths = fwd.map((e) => {
      const b = bundleOf.get(e);
      if (!b) return { from: e.from, to: e.to, or: !!e.or, pts: whole(edgeChain.get(e)) };
      return { from: e.from, to: e.to, or: !!e.or, bundle: b.id, pts: [...whole(b.legs.get(e.from)), pos.get(e.to)] };
    });
    const bundlesOut = bundles.map((b) => ({ id: b.id, from: b.S, to: b.T, or: b.or, col: b.col + isoCol, y: y.get(b.joint) + shift }));
    for (const v of [...isDummy, ...isJoint]) pos.delete(v);
    return { columns: nLayers + isoCol, height, pos, paths, bundles: bundlesOut, crossings, isolated, layers: layers.map((r) => r.filter((v) => !virt(v))) };
  }

  function sep(a, b) {
    const da = isDummy.has(a), db = isDummy.has(b);
    if (isJoint.has(a) || isJoint.has(b)) return SEP_MIXED;
    return da && db ? SEP_DUMMY : da || db ? SEP_MIXED : SEP_REAL;
  }
}

// Steps 0 and 1 of one cluster: prereq loops broken, then each box's column (layer).
function layerAll(graphIds, edges, pairs, partnerOf) {
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
  return { layer, edges };
}

// Bundles (edge concentration, Newbery 1989): a group of arrows where every class in S needs every class
// in T, all of T in one column, so they can be drawn as one shared line without saying anything untrue.
// Greedy: repeatedly take the group that saves the most lines (|S|·|T| arrows drawn as |S|+|T| pieces),
// at least 2 arrows. A fan-out (one class needed by several in one column) or fan-in counts too: a
// trunk that splits right before its targets. "Or" arrows (dashed) bundle only as a fan-out (one source),
// so their dashes stay in step. -> [{ id, S, T, or, col, edges }]
export function findBundles(edges, layer) {
  const out = [];
  const left = new Set(edges);
  const groups = new Map();
  for (const e of edges) { const k = `${layer.get(e.to)}${e.or ? 'o' : ''}`; (groups.get(k) ?? groups.set(k, []).get(k)).push(e); }
  for (const [k, list] of groups) {
    const or = k.endsWith('o');
    for (;;) {
      const tOf = new Map();
      for (const e of list) if (left.has(e)) (tOf.get(e.from) ?? tOf.set(e.from, new Set()).get(e.from)).add(e.to);
      const srcs = [...tOf.keys()];
      const cands = srcs.map((s) => tOf.get(s));
      if (!or) for (let i = 0; i < srcs.length; i++) for (let j = i + 1; j < srcs.length; j++) {
        const both = new Set([...tOf.get(srcs[i])].filter((t) => tOf.get(srcs[j]).has(t)));
        if (both.size) cands.push(both);
      }
      let best = null;
      cands.forEach((T, ci) => {
        const S = or ? [srcs[ci]] : srcs.filter((s) => [...T].every((t) => tOf.get(s).has(t)));
        if (!S.length) return;
        const n = S.length * T.size;
        if (n < 2) return;
        const score = n - S.length - T.size;
        if (!best || score > best.score || (score === best.score && n > best.n)) best = { S, T: [...T], n, score };
      });
      if (!best) break;
      const T = new Set(best.T), S = new Set(best.S);
      const mine = list.filter((e) => left.has(e) && S.has(e.from) && T.has(e.to));
      mine.forEach((e) => left.delete(e));
      out.push({ id: `B:${best.S[0]}>${best.T[0]}`, S: best.S, T: best.T, or, col: layer.get(best.T[0]), edges: mine });
    }
  }
  return out;
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
// cache (optional Map, section key -> layoutGraph result): the layout doesn't depend on sizes, so calls for
// the same nodes at other box sizes reuse it (only the pixel routing is redone).
export function flowChart(nodes, edges, sizes = {}, sections = [], cache = null) {
  const lay = (key, ...a) => {
    if (!cache) return layoutGraph(...a);
    if (!cache.has(key)) cache.set(key, layoutGraph(...a));
    return cache.get(key);
  };
  const all = [...sections, { key: 'gen', label: 'Gen Ed', test: (n) => /general\s+education/i.test(n.area || '') }];
  const sec = new Map(nodes.map((n) => [n.id, all.find((s) => s.test(n))?.key ?? '']));
  for (let changed = true; changed;) {
    changed = false;
    for (const e of edges) if (sec.get(e.from) !== sec.get(e.to)) for (const id of [e.from, e.to]) if (sec.get(id)) { sec.set(id, ''); changed = true; }
  }
  const part = (key) => ({ nodes: nodes.filter((n) => sec.get(n.id) === key), edges: edges.filter((e) => sec.get(e.from) === key && sec.get(e.to) === key) });
  const main = part('');
  // sizes.split (Set of ids): the main chart's boxes that need matriculation, right of a dotted line that
  // bends around the boxes (the layout ignores it: the boxes sit exactly where they would without it)
  const LM = lay('', main.nodes, main.edges);
  const C = routeChart(LM, sizes);
  const out = { ...C, boxes: new Map(C.boxes), edges: C.edges.slice(), genTop: null, heads: [], layout: LM };
  const head = sizes.head ?? 28;
  for (const s of all) {
    const p = part(s.key);
    if (!p.nodes.length) continue;
    const LG = lay(s.key, p.nodes, p.edges, { perRow: Math.max(4, LM.columns), inline: true });
    const G = routeChart(LG, { ...sizes, split: null });
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
//   { width, height, boxes: Map(id -> {x, y, w, h}), edges: [{from, to, or, pts: [[x, y], ...], bundle?}], split }
// Every arrow leaves its box's right side from its own exit point and enters the target's left side at
// its own entry point (several arrows on one side are spread along it, ordered by where they go, so
// they don't cross at the box). An arrow is one level line when it can be; otherwise it makes ONE
// upright jog in a gap between columns; only when no single jog fits does it follow the layout's points.
// Each jog gets its own track in its gap (gaps widen to fit them, `track` px apart), ordered to cross
// as little as possible. Level pieces of different arrows never run closer than `track` px.
// A bundle (L.bundles) is drawn as one upright bar in the gap right before its targets: each source's
// line runs to the bar, each target's line leaves it. Its arrows' pts share those pieces (bundle = id).
// sizes.split (Set of ids, matriculation): a dotted line from top to bottom through the gaps, with every
// box in the set right of it and every other box left of it (see sepPlan); the boxes don't move for it.
export function routeChart(L, o = {}) {
  const boxW = o.boxW ?? 120, boxH = o.boxH ?? 48, rowH = o.rowH ?? 58, pad = o.pad ?? 12;
  const gapMin = o.gapMin ?? 30, track = o.track ?? 10, port = o.port ?? 10, margin = o.margin ?? 6, near = o.near ?? 8;
  const R = boxH / 2 - 4; // exit/entry points stay this close to the box middle
  const nCols = L.columns;
  // the matriculation line's course (which gap, row band by row band); a band above the chart for its label
  const SEP = o.split?.size ? sepPlan(L, o.split, (boxH / 2 + 2) / rowH) : null; // it may pass 2 px from a box
  const band = SEP ? (o.splitBand ?? 34) : 0;
  const Y = (y) => pad + band + y * rowH;
  const colBoxes = Array.from({ length: nCols }, () => []);
  for (const [id, p] of L.pos) colBoxes[p.col].push({ id, cy: Y(p.y) });
  const center = (id) => Y(L.pos.get(id).y);
  const clear = (c, yy) => colBoxes[c].every((b) => Math.abs(yy - b.cy) >= boxH / 2 + margin);

  // ---- pieces: plain arrows; for a bundle, one piece per source (to the bar) and per target (from it) ----
  const E = [];
  const bundles = new Map((L.bundles || []).map((b) => [b.id, { ...b, ins: [], outs: [] }]));
  L.paths.forEach((p, k) => {
    if (p.bundle) return;
    const ys = p.pts.map((q) => Y(q.y));
    E.push({ i: E.length, k, g: 'e' + k, from: p.from, to: p.to, or: p.or, a: p.pts[0].col, b: p.pts[p.pts.length - 1].col, ys, cs: ys[0], ct: ys[ys.length - 1] });
  });
  for (const B of bundles.values()) {
    const jy = Y(B.y);
    for (const s of B.from) {
      const path = L.paths.find((p) => p.bundle === B.id && p.from === s);
      const ys = [...path.pts.slice(0, -1).map((q) => Y(q.y)), jy];
      const e = { i: E.length, g: B.id, B, kind: 'in', from: s, to: null, or: B.or, a: path.pts[0].col, b: B.col, ys, cs: ys[0], ct: jy };
      E.push(e); B.ins.push(e);
    }
    for (const t of B.to) {
      const ys = [jy, center(t)];
      const e = { i: E.length, g: B.id, B, kind: 'out', from: null, to: t, or: B.or, a: B.col - 1, b: B.col, ys, cs: jy, ct: ys[1] };
      E.push(e); B.outs.push(e);
    }
  }
  // an arrow "wants" to be level when its layout points are (nearly) level and every column it passes is clear
  for (const e of E) {
    e.want = null;
    if (e.B) continue;
    const lo = Math.max(...e.ys) - R, hi = Math.min(...e.ys) + R;
    if (lo <= hi + 1e-9) {
      const mid = e.ys.slice(1, -1);
      const t = mid.length ? mid.reduce((s, v) => s + v, 0) / mid.length : (e.cs + e.ct) / 2;
      const yy = Math.min(hi, Math.max(lo, t));
      let ok = true;
      for (let c = e.a + 1; c < e.b; c++) if (!clear(c, yy)) ok = false;
      if (ok) e.want = yy;
    }
  }
  const sides = new Map(); // `${id}>` (exit side) / `>${id}` (entry side) -> pieces
  const add = (k, e) => (sides.get(k) ?? sides.set(k, []).get(k)).push(e);
  for (const e of E) { if (e.from) add(e.from + '>', e); if (e.to) add('>' + e.to, e); }
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
  for (const e of E) {
    e.ps = portY.get(e.i + 's'); e.pt = portY.get(e.i + 't');
    if (e.kind === 'in') e.pt = e.ps; // the bar end is free: level by default
    if (e.kind === 'out') e.ps = e.pt;
  }
  // An exit point level with a different arrow's entry point across the same gap would make two lines
  // meet end to end there. Nudge one of them (within its box side, keeping the order) until none do.
  // (A fan-out's source line may run straight on into one of its targets: that's the trunk.)
  const level = (e) => Math.abs(e.ps - e.pt) < 0.5;
  const fan = (B) => B.from.length === 1 || B.to.length === 1;
  const meets = (p, q) => p !== q && p.from && q.to && q.b === p.a + 1 && !(p.g === q.g && p.B && fan(p.B));
  const M = []; // the pairs that could meet (fixed: it depends only on columns)
  for (const p of E) for (const q of E) if (meets(p, q)) M.push([p, q]);
  const clashes = () => {
    let n = 0;
    for (const [p, q] of M) if (Math.abs(p.ps - q.pt) < near) n++;
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
  const tryMove = (e0, out0, v0, snap = E.map((x) => [x.ps, x.pt]), wasLevel = new Set(E.filter(level))) => {
    const moved = new Set();
    const undo = () => moved.forEach((x) => { [x.ps, x.pt] = snap[x.i]; });
    const queue = [[e0, out0, v0]];
    for (let steps = 0; queue.length; steps++) {
      const [x, o, v] = queue.shift();
      const s = sideAt(x, o), j = s.list.indexOf(x);
      if (steps > 300 || v < s.cy - R - 1e-9 || v > s.cy + R + 1e-9) { undo(); return false; }
      if (Math.abs(get(x, o) - v) < 1e-9) continue;
      put(x, o, v); moved.add(x);
      if (wasLevel.has(x)) { if (o ? x.to : x.from) queue.push([x, !o, v]); else put(x, !o, v); }
      if (j > 0 && get(s.list[j - 1], o) > v - s.sp + 1e-9) queue.push([s.list[j - 1], o, v - s.sp]);
      if (j < s.list.length - 1 && get(s.list[j + 1], o) < v + s.sp - 1e-9) queue.push([s.list[j + 1], o, v + s.sp]);
    }
    for (const x of moved) if (wasLevel.has(x)) for (let c = x.a + 1; c < x.b; c++) if (!clear(c, x.ps)) { undo(); return false; }
    return moved;
  };
  let bad = clashes();
  for (let pass = 0; pass < 60 && bad; pass++) {
    let best = null;
    const base = E.map((x) => [x.ps, x.pt]), lv = new Set(E.filter(level));

    for (const [p, q] of M) {
      if (Math.abs(p.ps - q.pt) >= near) continue;
      for (const [e, out] of [[p, true], [q, false]]) {
        const from = get(e, out), other = out ? q.pt : p.ps;
        for (let d = 1; d <= 2 * R && !(best && best.c === 0 && d > best.d); d++) for (const v of [from + d, from - d]) {
          if (Math.abs(v - other) < near) continue; // must at least part this pair
          const moved = tryMove(e, out, v, base, lv);
          if (!moved) continue;
          const c = clashes();
          if (c < bad && (!best || c < best.c || (c === best.c && d < best.d))) best = { c, d, after: [...moved].map((x) => [x, x.ps, x.pt]) };
          moved.forEach((x) => { [x.ps, x.pt] = base[x.i]; });
        }
      }
    }
    if (!best) break;
    for (const [x, ps, pt] of best.after) { x.ps = ps; x.pt = pt; }
    bad = best.c;
  }

  // ---- routes ----
  // A route is level runs between jogs. Runs live on a half-column grid: column c's boxes span [2c, 2c+1],
  // the gap after it [2c+1, 2c+2]; a jog in gap k sits at 2k+1.5. A bundle's bar is a jog in gap col-1
  // with several lines joining from the left (ins) and leaving to the right (outs).
  const runs = []; // {g, y, x1, x2}
  const jogs = []; // {g, e, k, y1, y2, ins, outs}
  const runsClash = (y, x1, x2, g) => runs.some((r) => r.g !== g && Math.abs(r.y - y) < near && Math.min(r.x2, x2) >= Math.max(r.x1, x1));
  const lo = (j) => Math.min(j.y1, j.y2), hi = (j) => Math.max(j.y1, j.y2);
  const levelOk = (yy, c1, c2) => { for (let c = c1; c <= c2; c++) if (!clear(c, yy)) return false; return true; };
  const plan = (e) => {
    const options = [];
    const endX = e.kind === 'in' ? 2 * e.b - 0.5 : 2 * e.b; // a source's line ends at its bar
    const lastGap = e.kind === 'in' ? e.b - 2 : e.b - 1;     // (and jogs before the bar's gap)
    if (e.kind === 'out') options.push({ cost: 0, runs: [[e.pt, 2 * e.b - 0.5, 2 * e.b]], jogs: [] });
    else if (e.kind === 'in') {
      if (levelOk(e.ps, e.a + 1, e.b - 1)) options.push({ cost: 0, runs: [[e.ps, 2 * e.a + 1, endX]], jogs: [], end: e.ps });
      const cands = [...new Set([e.ct, ...e.ys.slice(1, -1)])];
      for (let d = 1; d <= 30; d++) for (const s of [1, -1]) cands.push(e.ct + s * d * (track / 2));
      for (let k = e.a; k <= lastGap; k++) {
        if (!levelOk(e.ps, e.a + 1, k)) continue;
        for (const yd of cands) {
          if (!levelOk(yd, k + 1, e.b - 1)) continue;
          options.push({ cost: 10 + Math.abs(yd - e.ct) * 0.01 + (lastGap - k) * 0.1, runs: [[e.ps, 2 * e.a + 1, 2 * k + 1.5], [yd, 2 * k + 1.5, endX]], jogs: [[k, e.ps, yd]], end: yd });
          break;
        }
      }
    } else {
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
    }
    // crossings with what's already drawn: a level run through a gap with someone's jog there
    const xCost = (op) => {
      let x = 0;
      for (const [y, x1, x2] of op.runs) for (const j of jogs) {
        if (j.g === e.g) continue;
        const g = 2 * j.k + 1.5;
        if (x1 <= g && g <= x2 && y > lo(j) && y < hi(j)) x += x1 === g || x2 === g ? 0.5 : 1;
      }
      for (const [k, y1, y2] of op.jogs) for (const r of runs) {
        if (r.g === e.g) continue;
        const g = 2 * k + 1.5;
        if (r.x1 <= g && g <= r.x2 && r.y > Math.min(y1, y2) && r.y < Math.max(y1, y2)) x += r.x1 === g || r.x2 === g ? 0.5 : 1;
      }
      return x;
    };
    let pick = null;
    for (const op of options) {
      if (op.runs.some(([y, x1, x2]) => runsClash(y, x1, x2, e.g))) continue;
      const c = op.cost + xCost(op) * 4;
      if (!pick || c < pick.c) pick = { ...op, c };
    }
    if (!pick) { // nothing clean: follow the layout's points (a jog per change)
      const r = [], j = [];
      let x0 = 2 * e.a + 1, yy = e.ps;
      const ys = e.kind === 'in' ? [e.ps, ...e.ys.slice(1, -1)] : e.kind === 'out' ? [e.pt] : [e.ps, ...e.ys.slice(1, -1), e.pt];
      for (let k = 1; k < ys.length; k++) {
        if (Math.abs(ys[k] - yy) < 0.5) continue;
        const g = 2 * (e.a + k - 1) + 1.5;
        r.push([yy, x0, g]); j.push([e.a + k - 1, yy, ys[k]]); x0 = g; yy = ys[k];
      }
      if (e.kind === 'out') r.push([e.pt, 2 * e.b - 0.5, 2 * e.b]); else r.push([yy, x0, endX]);
      pick = { runs: r, jogs: j, end: yy };
    }
    for (const [y, x1, x2] of pick.runs) runs.push({ g: e.g, y, x1, x2 });
    for (const [k, y1, y2] of pick.jogs) jogs.push({ g: e.g, e: e.i, k, y1, y2, ins: [y1], outs: [y2] });
    e.route = pick;
    if (e.kind === 'in') e.end = pick.end;
    // a bundle's bar, once all its source lines are in
    if (e.B && e.B.ins.every((x) => x.route) && e.B.outs.every((x) => x.route)) {
      const ins = e.B.ins.map((x) => x.end), outs = e.B.outs.map((x) => x.pt), all = [...ins, ...outs];
      e.B.bar = { g: e.g, e: -1, k: e.B.col - 1, y1: Math.min(...all), y2: Math.max(...all), ins, outs };
      jogs.push(e.B.bar);
    }
  };
  // bundles' fixed pieces first, then straight-looking ones, then short ones (they have no choice), long last
  const rank = (p) => (p.kind === 'out' || (p.kind === 'in' && p.b === p.a + 1) ? 0 : !p.B && Math.abs(p.ps - p.pt) < 0.5 ? 1 : 2);
  const order = E.slice().sort((p, q) => rank(p) - rank(q) || (p.b - p.a) - (q.b - q.a) || p.i - q.i);
  order.forEach(plan);

  // ---- tracks: order the jogs in each gap to cross least (exact for up to 12, else greedy) ----
  const byGap = new Map();
  for (const j of jogs) (byGap.get(j.k) ?? byGap.set(j.k, []).get(j.k)).push(j);
  const gapW = Array.from({ length: Math.max(0, nCols - 1) }, (_, k) => Math.max(gapMin, ((byGap.get(k)?.length ?? 0) + 1) * track));
  for (const [, list] of byGap) {
    const n = list.length;
    const inside = (v, j) => v > lo(j) && v < hi(j);
    // cost[i][j]: crossings when i's track is left of j's (j's lines from the left cross i's upright, i's
    // lines to the right cross j's)
    const cost = list.map((p) => list.map((q) => (p === q ? 0 : q.ins.filter((v) => inside(v, p)).length + p.outs.filter((v) => inside(v, q)).length)));
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
  const tidy = (pts) => pts.filter((q, i) => i === 0 || Math.abs(q[0] - pts[i - 1][0]) > 1e-6 || Math.abs(q[1] - pts[i - 1][1]) > 1e-6);
  const ptsOf = (e) => {
    const pts = e.kind === 'out' ? [] : [[colX[e.a] + boxW, e.ps]];
    const js = jogs.filter((j) => j.e === e.i).sort((p, q) => p.k - q.k);
    for (const j of js) { const x = gx(j.k, j.slot, j.of); pts.push([x, j.y1], [x, j.y2]); }
    if (e.kind === 'in') { const x = gx(e.B.bar.k, e.B.bar.slot, e.B.bar.of); pts.push([x, e.end]); }
    if (e.kind === 'out') { const x = gx(e.B.bar.k, e.B.bar.slot, e.B.bar.of); pts.push([x, e.pt]); }
    if (e.kind !== 'in') pts.push([colX[e.b], e.pt]);
    return pts;
  };
  const plain = new Map(E.filter((e) => !e.B).map((e) => [e.k, e]));
  const edges = L.paths.map((p, k) => {
    if (!p.bundle) return { from: p.from, to: p.to, or: p.or, pts: ptsOf(plain.get(k)) };
    const B = bundles.get(p.bundle);
    const a = ptsOf(B.ins.find((e) => e.from === p.from)), b = ptsOf(B.outs.find((e) => e.to === p.to));
    return { from: p.from, to: p.to, or: p.or, bundle: p.bundle, pts: tidy([...a, ...b]) };
  });
  const boxes = new Map();
  for (const [id, p] of L.pos) boxes.set(id, { x: colX[p.col], y: Y(p.y) - boxH / 2, w: boxW, h: boxH });
  const width = colX[nCols - 1] + boxW + pad;
  const height = Y(L.height) + pad;
  // the matriculation line: down the gaps, stepping across between rows. It takes no room of its own (the
  // chart is the same with or without it): in each gap it runs halfway between two neighbouring tracks (or
  // a track and the boxes), where those tracks' uprights share the least height with it.
  let split = null;
  if (SEP) {
    const xAt = new Map();
    const lineX = (g) => {
      if (g < 0) return pad / 2;
      if (g >= nCols - 1) return colX[nCols - 1] + boxW + pad / 2;
      if (xAt.has(g)) return xAt.get(g);
      const list = (byGap.get(g) || []).slice().sort((p, q) => p.slot - q.slot), n = list.length;
      const mine = SEP.runs.filter((r) => r.g === g).map((r) => [Y(r.y0), Y(r.y1)]);
      const shared = (j) => (j ? mine.reduce((a, [y0, y1]) => a + Math.max(0, Math.min(y1, hi(j)) - Math.max(y0, lo(j))), 0) : 0);
      let best = 0, bestC = Infinity;
      for (let q = 0; q <= n; q++) {
        const c = shared(list[q - 1]) + shared(list[q]) + (n && (q === 0 || q === n) ? rowH : 0) + Math.abs(q - n / 2) * 0.01; // (not hugging the boxes)
        if (c < bestC) { bestC = c; best = q; }
      }
      const x = colX[g] + boxW + (gapW[g] * (best + 0.5)) / (n + 1);
      xAt.set(g, x);
      return x;
    };
    const top = pad + band / 2, bottom = Y(L.height);
    const pts = [[lineX(SEP.runs[0].g), top]];
    for (let r = 1; r < SEP.runs.length; r++) {
      const yy = Y(SEP.runs[r].y0);
      pts.push([lineX(SEP.runs[r - 1].g), yy], [lineX(SEP.runs[r].g), yy]);
    }
    pts.push([lineX(SEP.runs[SEP.runs.length - 1].g), bottom]);
    split = { x: pts[0][0], top, bottom, pts, strays: SEP.strays.map((id) => boxes.get(id)) };
  }
  return { width, height, boxes, edges, split };
}

// The matriculation line's course on the layout grid. ids = boxes that need matriculation. The line runs
// top to bottom down column gaps (gap g = between column g and g+1; -1 = left of everything) with every
// box in ids right of it and every other box left of it, stepping to another gap only where no box is in
// the way. Fewest steps wins, then fewest arrows crossed (ties: steps in the roomiest place). half = a box's
// half height + clearance, in rows.
// -> null (nothing to split) or { runs: [{ g, y0, y1 }] top to bottom, strays: [ids on the wrong side] }
// (strays only when no line can separate them; the line then puts as few boxes wrong as it can).
export function sepPlan(L, ids, half) {
  const boxes = [...L.pos].map(([id, p]) => ({ id, c: p.col, t: p.y - half, b: p.y + half, in: ids.has(id) }));
  if (!boxes.some((x) => x.in) || boxes.every((x) => x.in)) return null;
  const nG = L.columns + 1; // gaps -1 .. columns-1, stored as g + 1
  const cuts = [...new Set([0, L.height, ...boxes.flatMap((x) => [x.t, x.b])])].sort((p, q) => p - q);
  const iv = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const y0 = cuts[k], y1 = cuts[k + 1];
    if (y1 - y0 < 1e-6) continue;
    const m = (y0 + y1) / 2;
    iv.push({ y0, y1, here: boxes.filter((x) => x.t < m && x.b > m) });
  }
  const wrong = (I, g) => I.here.filter((x) => (x.c > g) !== x.in).length;
  const xs = []; // where arrows cross gaps: { g, y }
  for (const p of L.paths) for (let k = 1; k < p.pts.length; k++) {
    const a = p.pts[k - 1], b = p.pts[k];
    for (let g = a.col; g < b.col; g++) xs.push({ g, y: g === b.col - 1 ? b.y : a.y });
  }
  const empty = (I, g1, g2) => I.here.every((x) => x.c <= Math.min(g1, g2) || x.c > Math.max(g1, g2));
  // dp over intervals: cost[g] = best cost to be at gap g at the end of the interval
  let cost = new Array(nG).fill(0);
  const back = [];
  for (const I of iv) {
    const next = new Array(nG).fill(Infinity), from = new Array(nG).fill(-1);
    const room = Math.min(1, I.y1 - I.y0);
    const cross = new Array(nG).fill(0);
    for (const x of xs) if (x.y >= I.y0 && x.y < I.y1) cross[x.g + 1]++;
    for (let g2 = 0; g2 < nG; g2++) {
      const w = wrong(I, g2 - 1) * 1000 + cross[g2];
      for (let g1 = 0; g1 < nG; g1++) {
        if (cost[g1] === Infinity) continue;
        if (g1 !== g2 && !empty(I, g1 - 1, g2 - 1)) continue;
        const c = cost[g1] + w + (g1 !== g2 ? 10 - room + Math.abs(g1 - g2) * 0.01 : 0);
        if (c < next[g2] - 1e-9) { next[g2] = c; from[g2] = g1; }
      }
    }
    back.push(from);
    cost = next;
  }
  let g = 0;
  for (let k = 1; k < nG; k++) if (cost[k] < cost[g] - 1e-9) g = k;
  const at = new Array(iv.length);
  for (let k = iv.length - 1; k >= 0; k--) { at[k] = g; g = back[k][g]; }
  const start = g;
  // runs: a step happens in the middle of the interval where the gap changes
  const runs = [{ g: start - 1, y0: 0 }];
  let cur = start;
  iv.forEach((I, k) => { if (at[k] !== cur) { runs[runs.length - 1].y1 = (I.y0 + I.y1) / 2; runs.push({ g: at[k] - 1, y0: (I.y0 + I.y1) / 2 }); cur = at[k]; } });
  runs[runs.length - 1].y1 = L.height;
  const strays = boxes.filter((x) => iv.some((I, k) => I.here.includes(x) && (x.c > at[k] - 1) !== x.in)).map((x) => x.id);
  return { runs, strays };
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
//   bends     corners as drawn (a bundle's shared corner counts once); pathBends = summed per arrow;
//             straight = arrows with no corner; lines = drawn lines (a bundle is one)
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
  // the drawn lines: arrows of one bundle share their pieces, so each group's pieces are merged first
  // (what the eye sees: a shared trunk is one line, its corners are counted once)
  const groups = new Map(); // key -> { name, segs, corners: Set }
  let pathBends = 0, straight = 0;
  chart.edges.forEach((e, i) => {
    const key = e.bundle ?? `#${i}`;
    const G = groups.get(key) ?? groups.set(key, { name: e.bundle ? `${e.bundle}` : `${e.from}>${e.to}`, segs: [], corners: new Set(), ends: new Set() }).get(key);
    G.ends.add('>' + e.from).add(e.to + '>');
    const s = segsOf(e.pts);
    pathBends += Math.max(0, s.length - 1);
    if (s.length === 1) straight++;
    for (let k = 0; k + 1 < s.length; k++) {
      const p = s[k], q = s[k + 1];
      const [x, y] = p.h ? [q.c, p.c] : [p.c, q.c];
      G.corners.add(`${Math.round(x * 2)},${Math.round(y * 2)}`);
    }
    G.segs.push(...s);
  });
  for (const G of groups.values()) { // merge overlapping collinear pieces
    const m = [];
    for (const s of G.segs.slice().sort((p, q) => (p.h === q.h ? 0 : p.h ? -1 : 1) || p.c - q.c || p.a - q.a)) {
      const last = m[m.length - 1];
      if (last && last.h === s.h && Math.abs(last.c - s.c) < 0.01 && s.a <= last.b + 0.01) last.b = Math.max(last.b, s.b); else m.push({ ...s });
    }
    G.segs = m;
  }
  const list = [...groups.values()];
  let bends = 0, crossings = 0;
  const overlaps = [], boxHits = [];
  let length = 0, foreign = 0; // foreign: overlaps of lines that share no box (they could be misread)
  for (const G of list) { bends += G.corners.size; for (const s of G.segs) length += s.b - s.a; }
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const kin = [...list[i].ends].some((x) => list[j].ends.has(x));
    for (const p of list[i].segs) for (const q of list[j].segs) {
      if (p.h === q.h) {
        if (Math.abs(p.c - q.c) < near && Math.min(p.b, q.b) - Math.max(p.a, q.a) > 1) { overlaps.push(`${list[i].name} / ${list[j].name} at ${p.h ? 'y' : 'x'}=${Math.round(p.c)}`); if (!kin) foreign++; }
      } else {
        const [hz, vt] = p.h ? [p, q] : [q, p];
        if (vt.c > hz.a + 0.5 && vt.c < hz.b - 0.5 && hz.c > vt.a + 0.5 && hz.c < vt.b - 0.5) crossings++;
      }
    }
  }
  for (const G of list) for (const s of G.segs) for (const [id, r] of chart.boxes) {
    const [lo, hi, a, b] = s.h ? [r.y, r.y + r.h, r.x, r.x + r.w] : [r.x, r.x + r.w, r.y, r.y + r.h];
    if (s.c > lo + 1 && s.c < hi - 1 && Math.min(s.b, b - 1) > Math.max(s.a, a + 1)) boxHits.push(`${G.name} through ${id}`);
  }
  return { edges: chart.edges.length, lines: list.length, bends, pathBends, straight, crossings, overlaps, foreign, boxHits, length: Math.round(length) };
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

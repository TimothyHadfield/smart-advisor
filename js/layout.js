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

// The drawn check: the laptop box size (js/app.js BASE + FITS[0]) and what a drawing costs. A crossing
// is the worst thing, then lines on top of each other, then corners, then total line length.
const EVAL = { boxW: 108, boxH: 48, rowH: 66, gapMin: 96, near: 8, pad: 12, track: 12 };
// crossings first, then total upright line length, then corners, then uprights that run close together
const drawnScore = (st, L) => st.crossings * 100 + st.boxHits.length * 200 + st.foreign * 30 + st.stacked * 100 + st.overlaps.length * 3 + (st.vlen / EVAL.rowH) * 4 + st.bends * 2 + st.closeV12 * 1 + L.height * 0.1;

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
  // Each cluster: the best few orders, each drawn (routeChart at the laptop box size) and scored as the
  // eye sees it; the simplest drawing wins (opts.alts: false skips the drawn check). Every arrow is its
  // own line (no shared trunks: Tim, 2026-10-23, "Class lines are combineing so only one line gose into a class").
  const parts = comps.map((g) => {
    const ids = new Set(g.map((n) => n.id));
    const es = edges.filter((e) => ids.has(e.from)), o = { ...opts, pairs: pairs.filter(([a]) => ids.has(a)) };
    if (opts.alts === false) return layered(g, es, o);
    const alts = layered(g, es, { ...o, alts: opts.altsP ?? 5 });
    let best = null;
    const seen = new Set();
    for (const L of alts) {
      const sig = [...L.pos].map(([id, q]) => `${id}@${q.col},${q.y}`).sort().join('|');
      if (seen.has(sig)) continue;
      seen.add(sig);
      const st = chartStats(routeChart(L, { ...EVAL, tries: 1 }));
      const score = drawnScore(st, L);
      if (!best || score < best.score - 1e-9) best = { L, score };
    }
    return best.L;
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

  // ---- 0 + 1. loops broken, layers (layerAll) ----
  const LA = layerAll(graphIds, edges, pairs, partnerOf);
  edges = LA.edges;
  const layer = LA.layer;
  const fwd = edges.filter((e) => layer.get(e.to) > layer.get(e.from)); // drop anything a loop left backwards
  const nLayers = graphIds.length ? Math.max(...graphIds.map((id) => layer.get(id))) + 1 : 0;

  // ---- 2. dummy points for long arrows ----
  const nSlots = nLayers;
  const slot = new Map(graphIds.map((id) => [id, layer.get(id)]));
  const isDummy = new Set();
  let nd = 0;
  const chainTo = (from, to) => {
    const ch = [from];
    for (let s = slot.get(from) + 1; s < slot.get(to); s++) { const d = `\u0000d${nd++}`; isDummy.add(d); slot.set(d, s); ch.push(d); }
    ch.push(to);
    return ch;
  };
  const chains = [];
  const edgeChain = new Map();
  for (const e of fwd) { const ch = chainTo(e.from, e.to); chains.push(ch); edgeChain.set(e, ch); }
  const virt = (v) => isDummy.has(v);
  const up = new Map(), down = new Map(); // neighbours in the slot above / below, with weights
  const all = [...graphIds, ...isDummy];
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
  function placeY(layers, straight = opts.straighten !== false) {
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
    if (straight) straighten(layers, up, down, y, sep, isDummy);
    return y;
  }
  // the chosen candidates as results (opts.alts: how many, best first)
  // (for the drawn check, each order also without the straightening step: boxes at the weighted middle
  // of their neighbours, which sometimes draws simpler)
  const picks = short.length ? short.slice(0, opts.alts || 1) : [null];
  if (opts.alts && opts.straighten !== false) for (const r of picks.slice(0, opts.altsFlat ?? 2)) if (r) picks.push({ ...r, y: placeY(r.layers, false) });
  const outs = picks.map(build);
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
    for (const v of all) pos.set(v, { col: slot.get(v) + isoCol, y: y.get(v) + shift });
    const isoTop = (height - isolated.length) / 2 + 0.5;
    isolated.forEach((id, i) => pos.set(id, { col: 0, y: isoTop + i }));

    const paths = fwd.map((e) => ({ from: e.from, to: e.to, or: !!e.or, pts: edgeChain.get(e).map((v) => pos.get(v)) }));
    for (const v of isDummy) pos.delete(v);
    return { columns: nLayers + isoCol, height, pos, paths, crossings, isolated, layers: layers.map((r) => r.filter((v) => !virt(v))) };
  }

  function sep(a, b) {
    const da = isDummy.has(a), db = isDummy.has(b);
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
//   { width, height, boxes: Map(id -> {x, y, w, h}), edges: [{from, to, or, pts: [[x, y], ...]}], split }
// Drawn like Tim's hand-made EE chart (2026-10-23):
//  - every arrow is its own line: it leaves its prereq's right side at its own exit point and enters the
//    class's left side at its own entry point. A side's points are evenly spaced (box height / (n+1)) and
//    ordered so lines don't cross at the box; the whole set may slide up or down a little so a line that
//    can run level does.
//  - a line runs right from its exit, makes ONE upright jog in the column gap just before its class, then
//    runs right into it; when a box is in the way it jogs earlier (or, for a long line, drops into the
//    open channel between rows first and jogs again before its class). Lines never pass through a box.
//  - each upright piece in a gap gets its own lane; lanes are spread evenly across the gap, at least
//    `track` px apart (the gap widens to fit them), ordered to cross as little as possible. Uprights whose
//    heights don't come near each other may share a lane.
// sizes.split (Set of ids, matriculation): a dotted line from top to bottom through the gaps, with every
// box in the set right of it and every other box left of it (see sepPlan); the boxes don't move for it.
export function routeChart(L, o = {}) {
  const boxW = o.boxW ?? 100, boxH = o.boxH ?? 48, rowH = o.rowH ?? 66, pad = o.pad ?? 12;
  const gapMin = o.gapMin ?? 80, track = o.track ?? 12, margin = o.margin ?? 6, near = o.near ?? 8;
  const inset = o.inset ?? 5; // exit/entry points stay this far inside a box's top and bottom
  const nCols = L.columns;
  // the matriculation line's course (which gap, row band by row band); a band above the chart for its label
  const SEP = o.split?.size ? sepPlan(L, o.split, (boxH / 2 + 2) / rowH) : null; // it may pass 2 px from a box
  const band = SEP ? (o.splitBand ?? 34) : 0;
  const Y = (y) => pad + band + y * rowH;
  const colBoxes = Array.from({ length: nCols }, () => []);
  for (const [id, p] of L.pos) colBoxes[p.col].push({ id, cy: Y(p.y) });
  const center = (id) => Y(L.pos.get(id).y);
  const clear = (c, yy) => colBoxes[c].every((b) => Math.abs(yy - b.cy) >= boxH / 2 + margin);
  const levelOk = (yy, c1, c2) => { for (let c = c1; c <= c2; c++) if (!clear(c, yy)) return false; return true; };

  const E = L.paths.map((p, k) => {
    const ys = p.pts.map((q) => Y(q.y));
    return { i: k, from: p.from, to: p.to, or: p.or, a: p.pts[0].col, b: p.pts[p.pts.length - 1].col, ys, cs: ys[0], ct: ys[ys.length - 1] };
  });
  const sides = new Map(); // `${id}>` (exit side) / `>${id}` (entry side) -> arrows
  const add = (k, e) => (sides.get(k) ?? sides.set(k, []).get(k)).push(e);
  for (const e of E) { add(e.from + '>', e); add('>' + e.to, e); }
  const spOf = (n) => boxH / (n + 1);
  const roomOf = (n) => Math.max(0, boxH / 2 - inset - ((n - 1) / 2) * spOf(n));

  // ---- one full drawing for a given idea of where each line runs (first guess, then the routes found) ----
  function draw(guess, swap = false) {
    // exit order (top to bottom): lines going up (the one that jogs first on top), then level lines, then
    // lines going down (the one that jogs last on top); same jog gap -> by where they end
    const exitKey = (e) => {
      const g = guess.get(e.i);
      const d = g.end - g.start;
      return Math.abs(d) < 1 ? [1, 0, g.end] : d < 0 ? [0, g.jog, g.end] : [2, -g.jog, g.end];
    };
    // entry order: by the height each line arrives at before its last jog (then where it started)
    const entryKey = (e) => { const g = guess.get(e.i); return [g.arrive, g.start, 0]; };
    const cmp = (p, q) => { for (let k = 0; k < 3; k++) if (Math.abs(p[k] - q[k]) > 1e-6) return p[k] - q[k]; return 0; };
    const order = new Map();
    for (const [k, list] of sides) {
      const out = k.endsWith('>'), key = out ? exitKey : entryKey;
      order.set(k, list.slice().sort((p, q) => cmp(key(p), key(q)) || p.i - q.i));
    }
    const off = new Map([...sides.keys()].map((k) => [k, 0]));
    const portAt = (k, j) => {
      const list = order.get(k), n = list.length, cy = k.endsWith('>') ? center(list[0].from) : center(list[0].to);
      return cy + off.get(k) + (j - (n - 1) / 2) * spOf(n);
    };
    const portsOf = (e) => {
      const s = e.from + '>', t = '>' + e.to;
      return [portAt(s, order.get(s).indexOf(e)), portAt(t, order.get(t).indexOf(e))];
    };
    // slide a side's points (keeping their even spacing) so as many of its lines as possible run level,
    // without making an exit point face another line's entry point across a gap
    const facing = new Map(); // side -> [[myIndex, otherSide, otherIndex]] pairs of different lines across one gap
    for (const [k, list] of order) {
      if (!k.endsWith('>')) continue;
      const id = list[0].from, c = L.pos.get(id).col;
      for (const [k2, l2] of order) {
        if (k2.endsWith('>') || L.pos.get(l2[0].to).col !== c + 1) continue;
        if (Math.abs(center(l2[0].to) - center(id)) > boxH) continue;
        list.forEach((e, j) => l2.forEach((f, j2) => { if (e !== f) { (facing.get(k) ?? facing.set(k, []).get(k)).push([j, k2, j2]); (facing.get(k2) ?? facing.set(k2, []).get(k2)).push([j2, k, j]); } }));
      }
    }
    const levelScore = (k) => {
      let s = 0;
      for (const e of order.get(k)) {
        const [ps, pt] = portsOf(e);
        if (Math.abs(ps - pt) < 0.5 && levelOk(ps, e.a + 1, e.b - 1)) s += 1;
        else s -= Math.min(Math.abs(ps - pt), rowH) * 0.002 + (Math.abs(ps - pt) < 10 ? 0.5 : 0); // (short jogs over long ones, but no tiny steps)
      }
      for (const [j, k2, j2] of facing.get(k) || []) if (Math.abs(portAt(k, j) - portAt(k2, j2)) < near) s -= 0.75;
      return s - Math.abs(off.get(k)) * 0.001;
    };
    for (let round = 0; round < 4; round++) {
      let changed = false;
      for (const [k, list] of order) {
        const n = list.length, room = roomOf(n);
        if (room <= 0) continue;
        const cands = new Set([0, off.get(k)]);
        const out = k.endsWith('>');
        for (const e of list) {
          const [ps, pt] = portsOf(e);
          const want = out ? pt : ps, mine = out ? ps : pt;
          const d = off.get(k) + want - mine; // (as far as the box allows: the other end may do the rest)
          cands.add(Math.round(Math.max(-room, Math.min(room, d)) * 2) / 2);
        }
        const was = off.get(k);
        let best = was, bestS = levelScore(k);
        for (const c of cands) { off.set(k, c); const sc = levelScore(k); if (sc > bestS + 1e-9) { bestS = sc; best = c; } }
        off.set(k, best);
        if (best !== was) changed = true;
      }
      if (!changed) break;
    }
    for (const e of E) { [e.ps, e.pt] = portsOf(e); e.ps = Math.round(e.ps * 2) / 2; e.pt = Math.round(e.pt * 2) / 2; }

    // ---- routes: level runs between jogs; runs live on a half-column grid (column c's boxes span
    // [2c, 2c+1], the gap after it [2c+1, 2c+2]; a jog in gap k sits at 2k+1.5) ----
    const runs = []; // {g, y, x1, x2}
    const jogs = []; // {g, k, y1, y2}
    const lo = (j) => Math.min(j.y1, j.y2), hi = (j) => Math.max(j.y1, j.y2);
    // (runs that meet in one gap clash too: their jogs' lanes would make them overlap or look joined).
    // Two lines leaving one box (or entering one box) may run closer while both still touch it (a box
    // with many lines spreads them over its height), but never on top of each other.
    const runsClash = (y, x1, x2, g) => {
      const e = E[g], s = x1 === 2 * e.a + 1, t = x2 === 2 * e.b;
      let n = 0;
      for (const r of runs) {
        if (r.g === g || Math.min(r.x2, x2) < Math.max(r.x1, x1)) continue;
        const f = E[r.g], kin = (s && r.x1 === 2 * f.a + 1 && f.from === e.from) || (t && r.x2 === 2 * f.b && f.to === e.to);
        if (Math.abs(r.y - y) < (kin ? 3 : near)) n++;
      }
      return n;
    };
    const xCost = (e, op) => {
      let x = 0;
      for (const [y, x1, x2] of op.runs) for (const j of jogs) {
        const g = 2 * j.k + 1.5;
        if (x1 <= g && g <= x2 && y > lo(j) && y < hi(j)) x += x1 === g || x2 === g ? 0.5 : 1;
      }
      for (const [k, y1, y2] of op.jogs) for (const r of runs) {
        const g = 2 * k + 1.5;
        if (r.x1 <= g && g <= r.x2 && r.y > Math.min(y1, y2) && r.y < Math.max(y1, y2)) x += r.x1 === g || r.x2 === g ? 0.5 : 1;
      }
      return x;
    };
    const plan = (e) => {
      const { ps, pt, a, b } = e;
      const options = [];
      const vcost = (v) => (v / rowH) * 4;
      if (Math.abs(ps - pt) < 0.5 && levelOk(ps, a + 1, b - 1)) options.push({ cost: 0, runs: [[ps, 2 * a + 1, 2 * b]], jogs: [] });
      // one jog, as late as the boxes allow (just before the class)
      for (let k = b - 1; k >= a; k--) {
        if (!levelOk(ps, a + 1, k) || !levelOk(pt, k + 1, b - 1)) continue;
        options.push({ cost: 10 + vcost(Math.abs(ps - pt)) + (b - 1 - k) * 2, runs: [[ps, 2 * a + 1, 2 * k + 1.5], [pt, 2 * k + 1.5, 2 * b]], jogs: [[k, ps, pt]] });
      }
      // two jogs: drop into an open channel between rows as late as the source's row allows, run along
      // it, jog again before the class
      if (b - a > 1) {
        let K1 = a;
        while (K1 + 1 < b && levelOk(ps, a + 1, K1 + 1)) K1++;
        // channel heights: the layout's own points, the middles between boxes near the line, a little either side
        const cands = new Set(e.ys.slice(1, -1).map((v) => Math.round(v * 2) / 2));
        const yLo = Math.min(ps, pt) - 2 * rowH, yHi = Math.max(ps, pt) + 2 * rowH;
        for (let c = a + 1; c < b; c++) {
          const ys = colBoxes[c].map((x) => x.cy).sort((p, q) => p - q);
          const mids = ys.slice(1).map((v, i) => (v + ys[i]) / 2);
          if (ys.length) mids.push(ys[0] - boxH / 2 - margin - track, ys[ys.length - 1] + boxH / 2 + margin + track);
          for (const m of mids) if (m >= yLo && m <= yHi) cands.add(Math.round(m * 2) / 2);
        }
        for (const y0 of [...cands]) for (let d = 1; d <= 2; d++) { cands.add(y0 + d * (near + 1)); cands.add(y0 - d * (near + 1)); }
        for (const yd of cands) {
          if (Math.abs(yd - ps) < 0.5 || Math.abs(yd - pt) < 0.5) continue;
          for (let k2 = b - 1; k2 > a; k2--) {
            if (!levelOk(pt, k2 + 1, b - 1)) break;
            const k1 = Math.min(K1, k2 - 1);
            if (!levelOk(yd, k1 + 1, k2)) continue;
            options.push({ cost: 20 + vcost(Math.abs(ps - yd) + Math.abs(yd - pt)) + (b - 1 - k2) * 2, runs: [[ps, 2 * a + 1, 2 * k1 + 1.5], [yd, 2 * k1 + 1.5, 2 * k2 + 1.5], [pt, 2 * k2 + 1.5, 2 * b]], jogs: [[k1, ps, yd], [k2, yd, pt]] });
            break;
          }
        }
      }
      { // last resort: follow the layout's points (a jog per change)
        const r = [], j = [];
        let x0 = 2 * a + 1, yy = ps, v = 0;
        const ys = [ps, ...e.ys.slice(1, -1), pt];
        for (let k = 1; k < ys.length; k++) {
          if (Math.abs(ys[k] - yy) < 0.5) continue;
          const g = 2 * (a + k - 1) + 1.5;
          r.push([yy, x0, g]); j.push([a + k - 1, yy, ys[k]]); v += Math.abs(ys[k] - yy); x0 = g; yy = ys[k];
        }
        r.push([yy, x0, 2 * b]);
        options.push({ cost: 10 * (j.length + 2) + vcost(v), runs: r, jogs: j });
      }
      // the cheapest: crossings with lines already drawn and lines running too close cost most
      let pick = null;
      options.sort((p, q) => p.cost - q.cost);
      for (const op of options) {
        if (pick && op.cost >= pick.c) break; // (crossings only add to the cost)
        let c = op.cost;
        for (const [y, x1, x2] of op.runs) c += runsClash(y, x1, x2, e.i) * 100;
        if (pick && c >= pick.c) continue;
        c += xCost(e, op) * 30;
        if (!pick || c < pick.c) pick = { ...op, c };
      }
      for (const [y, x1, x2] of pick.runs) runs.push({ g: e.i, y, x1, x2 });
      for (const [k, y1, y2] of pick.jogs) jogs.push({ g: e.i, k, y1, y2 });
      e.route = pick;
    };
    // level lines first, then short ones (they have the least choice), long last
    const rank = (p) => (Math.abs(p.ps - p.pt) < 0.5 ? 0 : 1);
    const seq = E.slice().sort((p, q) => rank(p) - rank(q) || (p.b - p.a) - (q.b - q.a) || p.i - q.i);
    seq.forEach(plan);
    // repair: a line that still runs too close to another is drawn again, now that every line is known
    for (let round = 0; round < 2; round++) {
      let again = 0;
      for (const e of seq) {
        const mine = runs.filter((r) => r.g === e.i);
        if (!mine.some((r) => runsClash(r.y, r.x1, r.x2, e.i))) continue;
        for (let k = runs.length - 1; k >= 0; k--) if (runs[k].g === e.i) runs.splice(k, 1);
        for (let k = jogs.length - 1; k >= 0; k--) if (jogs[k].g === e.i) jogs.splice(k, 1);
        plan(e);
        again++;
      }
      if (!again) break;
    }
    // still too close: swap its point on a box with the next line's there and draw both again (two lines
    // whose points come in the wrong order can only run on top of each other); kept only if it helps
    const clashes = (e) => runs.reduce((n, r) => n + (r.g === e.i ? runsClash(r.y, r.x1, r.x2, e.i) : 0), 0);
    const take = (e) => {
      const r = [], j = [];
      for (let k = runs.length - 1; k >= 0; k--) if (runs[k].g === e.i) r.push(...runs.splice(k, 1));
      for (let k = jogs.length - 1; k >= 0; k--) if (jogs[k].g === e.i) j.push(...jogs.splice(k, 1));
      return { r, j, route: e.route, ps: e.ps, pt: e.pt };
    };
    const give = (e, s) => { runs.push(...s.r); jogs.push(...s.j); e.route = s.route; e.ps = s.ps; e.pt = s.pt; };
    if (swap) for (const e of seq) {
      if (!clashes(e)) continue;
      for (const [k, end] of [['>' + e.to, 'pt'], [e.from + '>', 'ps']]) {
        const list = order.get(k).slice().sort((p, q) => p[end] - q[end]);
        const at = list.indexOf(e);
        let done = false;
        for (const f of [list[at - 1], list[at + 1]]) {
          if (!f) continue;
          const cost = () => clashes(e) * 100 + clashes(f) * 100 + e.route.c + f.route.c; // (clashes counted from both sides)
          const before = cost();
          const se = take(e), sf = take(f);
          [e[end], f[end]] = [f[end], e[end]];
          plan(e); plan(f);
          if (cost() < before - 1e-9) { done = true; break; }
          take(e); take(f); give(e, se); give(f, sf);
        }
        if (done) break;
      }
    }
    return { jogs, lo, hi };
  }

  // first guess: each line jogs just before its class; then again with the routes actually found
  const guess0 = new Map(E.map((e) => [e.i, { start: e.cs, end: e.ct, jog: e.b - 1, arrive: e.cs }]));
  const finish = (R) => {
    // ---- lanes: order the uprights in each gap to cross least, then pack them into lanes ----
    const { jogs, lo, hi } = R;
    const byGap = new Map();
    for (const j of jogs) (byGap.get(j.k) ?? byGap.set(j.k, []).get(j.k)).push(j);
    const lanesIn = new Map(); // gap -> number of lanes
    const gapMinPx = (n) => (n + 1) * track;
    const touch = (p, q) => Math.min(hi(p), hi(q)) + near > Math.max(lo(p), lo(q)); // heights come near each other
    for (const [k, list] of byGap) {
      const n = list.length;
      const inside = (v, j) => v > lo(j) && v < hi(j);
      // cost[i][j]: crossings when i's lane is left of j's (j's line from the left crosses i's upright,
      // i's line to the right crosses j's)
      // (+5 when p's line leaves at the height q's line came in at: left of q, the two would be drawn on top
      // of each other between the lanes)
      const cost = list.map((p) => list.map((q) => (p === q ? 0 : (inside(q.y1, p) ? 1 : 0) + (inside(p.y2, q) ? 1 : 0) + (Math.abs(p.y2 - q.y1) < 1 ? 5 : 0))));
      // groups of uprights whose heights touch (directly or through others): each is ordered on its own
      const comp = new Int32Array(n).fill(-1);
      let nc = 0;
      for (let s = 0; s < n; s++) {
        if (comp[s] >= 0) continue;
        const st = [s]; comp[s] = nc;
        while (st.length) { const u = st.pop(); for (let v = 0; v < n; v++) if (comp[v] < 0 && touch(list[u], list[v])) { comp[v] = nc; st.push(v); } }
        nc++;
      }
      const rank = new Float64Array(n);
      for (let c = 0; c < nc; c++) {
        const ids = [];
        for (let v = 0; v < n; v++) if (comp[v] === c) ids.push(v);
        const m = ids.length;
        let perm;
        if (m <= 12) {
          const full = (1 << m) - 1, dp = new Float64Array(1 << m).fill(Infinity), from = new Int32Array(1 << m);
          dp[0] = 0;
          for (let S = 0; S < full; S++) {
            if (dp[S] === Infinity) continue;
            for (let v = 0; v < m; v++) {
              if (S & (1 << v)) continue;
              let cc = dp[S];
              for (let u = 0; u < m; u++) if (S & (1 << u)) cc += cost[ids[u]][ids[v]];
              // tie-break: a line going down sits right of one going up (fewer near-misses)
              const T = S | (1 << v);
              if (cc < dp[T] - 1e-9) { dp[T] = cc; from[T] = v; }
            }
          }
          perm = [];
          for (let S = full; S; S &= ~(1 << from[S])) perm.unshift(ids[from[S]]);
        } else {
          // insertion, then neighbour swaps while they help
          perm = [];
          for (const v of ids) {
            let bestAt = 0, bestC = Infinity;
            for (let at = 0; at <= perm.length; at++) {
              let cc = 0;
              for (let t = 0; t < perm.length; t++) cc += t < at ? cost[perm[t]][v] : cost[v][perm[t]];
              if (cc < bestC) { bestC = cc; bestAt = at; }
            }
            perm.splice(bestAt, 0, v);
          }
          for (let pass = 0, better = true; better && pass < 50; pass++) {
            better = false;
            for (let t = 0; t + 1 < perm.length; t++) {
              const u = perm[t], v = perm[t + 1];
              if (cost[v][u] < cost[u][v]) { perm[t] = v; perm[t + 1] = u; better = true; }
            }
          }
        }
        perm.forEach((v, r) => { rank[v] = r; });
      }
      // lanes: each upright goes one lane right of every upright before it (in the order) whose height it touches
      const idx = list.map((_, v) => v).sort((p, q) => comp[p] - comp[q] || rank[p] - rank[q]);
      let nl = 0;
      for (let t = 0; t < idx.length; t++) {
        const v = idx[t];
        let lane = 0;
        for (let s = 0; s < t; s++) { const u = idx[s]; if (comp[u] === comp[v] && touch(list[u], list[v])) lane = Math.max(lane, list[u].lane + 1); }
        list[v].lane = lane;
        nl = Math.max(nl, lane + 1);
      }
      lanesIn.set(k, nl);
    }
    const gapW = Array.from({ length: Math.max(0, nCols - 1) }, (_, k) => Math.max(gapMin, gapMinPx(lanesIn.get(k) ?? 0)));
    const colX = [pad];
    for (let c = 1; c < nCols; c++) colX.push(colX[c - 1] + boxW + gapW[c - 1]);
    const laneX = (k, lane) => colX[k] + boxW + (gapW[k] * (lane + 1)) / ((lanesIn.get(k) ?? 0) + 1);
    const tidy = (pts) => pts.filter((q, i) => i === 0 || Math.abs(q[0] - pts[i - 1][0]) > 1e-6 || Math.abs(q[1] - pts[i - 1][1]) > 1e-6);
    const edges = E.map((e) => {
      const pts = [[colX[e.a] + boxW, e.ps]];
      const mine = jogs.filter((j) => j.g === e.i).sort((p, q) => p.k - q.k);
      for (const j of mine) { const x = laneX(j.k, j.lane); pts.push([x, j.y1], [x, j.y2]); }
      pts.push([colX[e.b], e.pt]);
      return { from: e.from, to: e.to, or: e.or, pts: tidy(pts) };
    });
    return { edges, colX, gapW, byGap, lanesIn, lo, hi };
  };
  const snap = (R) => { const F = finish(R); return { R, F, st: chartStats({ boxes: boxesAt(F.colX), edges: F.edges }) }; };
  const boxesAt = (colX) => {
    const m = new Map();
    for (const [id, p] of L.pos) m.set(id, { x: colX[p.col], y: Y(p.y) - boxH / 2, w: boxW, h: boxH });
    return m;
  };
  const score = (s) => s.st.crossings * 100 + s.st.overlaps.length * 60 + s.st.foreign * 60 + s.st.stacked * 400 + s.st.boxHits.length * 200 + (s.st.vlen / rowH) * 4 + s.st.bends * 2 + s.st.closeV12;
  let best = snap(draw(guess0)), bestS = score(best), bestG = guess0;
  // more tries: order the points by the routes the last try found; keep the best drawing
  for (let t = 0; t < (o.tries ?? 3); t++) {
    const guess = new Map(E.map((e) => {
      const js = e.route.jogs;
      const first = js[0], last = js[js.length - 1];
      return [e.i, { start: e.ps, end: last ? last[2] : e.pt, jog: first ? first[0] : e.b - 1, arrive: last ? last[1] : e.ps }];
    }));
    const next = snap(draw(guess)), sc = score(next);
    if (sc < bestS - 1e-9) { best = next; bestS = sc; bestG = guess; }
  }
  { // the best try once more, now swapping points where lines still run on top of each other
    const next = snap(draw(bestG, true)), sc = score(next);
    if (sc < bestS - 1e-9) { best = next; bestS = sc; }
  }
  const { edges, colX, gapW, byGap, lanesIn, lo, hi } = best.F;

  const boxes = boxesAt(colX);
  const width = colX[nCols - 1] + boxW + pad;
  const height = Y(L.height) + pad;
  // the matriculation line: down the gaps, stepping across between rows. It takes no room of its own (the
  // chart is the same with or without it): in each gap it runs halfway between two neighbouring lanes (or
  // a lane and the boxes), where those lanes' uprights share the least height with it.
  let split = null;
  if (SEP) {
    const xAt = new Map();
    const lineX = (g) => {
      if (g < 0) return pad / 2;
      if (g >= nCols - 1) return colX[nCols - 1] + boxW + pad / 2;
      if (xAt.has(g)) return xAt.get(g);
      const n = lanesIn.get(g) ?? 0;
      const lanes = Array.from({ length: n }, () => []);
      for (const j of byGap.get(g) || []) lanes[j.lane].push(j);
      const mine = SEP.runs.filter((r) => r.g === g).map((r) => [Y(r.y0), Y(r.y1)]);
      const shared = (lane) => (lane ? lane.reduce((s, j) => s + mine.reduce((a, [y0, y1]) => a + Math.max(0, Math.min(y1, hi(j)) - Math.max(y0, lo(j))), 0), 0) : 0);
      let bestQ = 0, bestC = Infinity;
      for (let q = 0; q <= n; q++) {
        const c = shared(lanes[q - 1]) + shared(lanes[q]) + (n && (q === 0 || q === n) ? rowH : 0) + Math.abs(q - n / 2) * 0.01; // (not hugging the boxes)
        if (c < bestC) { bestC = c; bestQ = q; }
      }
      const x = colX[g] + boxW + (gapW[g] * (bestQ + 0.5)) / (n + 1);
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
  let length = 0, foreign = 0, stacked = 0; // foreign: overlaps of lines that share no box (they could be misread); stacked: drawn on top of each other (read as one line)
  for (const G of list) { bends += G.corners.size; for (const s of G.segs) length += s.b - s.a; }
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const kin = [...list[i].ends].some((x) => list[j].ends.has(x));
    for (const p of list[i].segs) for (const q of list[j].segs) {
      if (p.h === q.h) {
        if (Math.abs(p.c - q.c) < near && Math.min(p.b, q.b) - Math.max(p.a, q.a) > 1) { overlaps.push(`${list[i].name} / ${list[j].name} at ${p.h ? 'y' : 'x'}=${Math.round(p.c)}`); if (!kin) foreign++; if (Math.abs(p.c - q.c) < 1) stacked++; }
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
  // vlen: total upright line length (a shared trunk once); closeV: pairs of upright pieces of different
  // lines closer than `minGap` px side by side that share some height (hard to tell apart);
  // sharedIn / sharedOut: boxes where two or more arrows end (start) at the same point (lines merged)
  // (closeV12: the same within 12 px)
  let vlen = 0, closeV = 0, closeV12 = 0;
  const vs = list.map((G) => G.segs.filter((s) => !s.h));
  for (const v of vs) for (const s of v) vlen += s.b - s.a;
  for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) for (const p of vs[i]) for (const q of vs[j]) {
    if (Math.min(p.b, q.b) - Math.max(p.a, q.a) <= 1) continue;
    const dx = Math.abs(p.c - q.c);
    if (dx < 8) closeV++;
    if (dx < 12) closeV12++;
  }
  const ends = (pick, key) => {
    const m = new Map();
    for (const e of chart.edges) { if (!e.pts?.length) continue; const [x, y] = pick(e.pts); const k = `${key(e)}@${Math.round(x)},${Math.round(y * 2)}`; m.set(k, (m.get(k) || 0) + 1); }
    return new Set([...m].filter(([, n]) => n > 1).map(([k]) => k.split('@')[0])).size;
  };
  const sharedIn = ends((p) => p[p.length - 1], (e) => e.to), sharedOut = ends((p) => p[0], (e) => e.from);
  return { edges: chart.edges.length, lines: list.length, bends, pathBends, straight, crossings, overlaps, foreign, stacked, boxHits, length: Math.round(length), vlen: Math.round(vlen), closeV, closeV12, sharedIn, sharedOut };
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

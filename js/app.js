import { buildModel, makePlan, flowNodes, flowEdges, evalReq, unitDone, defaultStartTerm, nextTerm, termLabel } from './planner.js';
import { layoutGraph, foldLabs } from './layout.js';
import { parseAudit, matchAudit } from './audit.js';

const $ = (id) => document.getElementById(id);
const PROGRAM = new URLSearchParams(location.search).get('p') || 'ee-bs';
const KEY = 'smart-advisor:v1';

// ---------- saved state (localStorage; accounts come in a later phase) ----------
function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}
const state = load();
state.settings ??= { max: 16, summers: false, start: null };
state.done ??= {};
const doneSet = () => new Set(state.done[PROGRAM] || []);
function setDone(set) { state.done[PROGRAM] = [...set]; save(); }

let model, nodes, edges, graph, layoutCache = null;

// ---------- boot ----------
async function boot() {
  const res = await fetch(`data/programs/${PROGRAM}.json`);
  if (!res.ok) { $('progName').textContent = 'Program not found'; return; }
  const program = await res.json();
  $('progName').textContent = program.name;
  model = buildModel(program);
  // labs are folded into their lecture's box (ECE 2250 + 2255 = one box); the planner still has both
  ({ nodes, edges } = foldLabs(flowNodes(model), flowEdges(model)));
  graph = layoutGraph(nodes, edges);
  buildBoxes();
  layout();
  refresh();
  new ResizeObserver(() => layout()).observe($('chart'));
  wireTabs();
  wireSettings();
  wireImport();
}

// ---------- flowchart ----------
// Box positions come from js/layout.js (layered layout with few crossings), computed once per program;
// layout() only scales them to the chart size.

function buildBoxes() {
  const host = $('boxes');
  host.innerHTML = '';
  for (const n of nodes) {
    const b = document.createElement('button');
    b.className = 'box' + (n.kind === 'placeholder' || n.kind === 'choice' ? ' ph flex' : n.kind === 'option' ? ' flex' : '');
    b.dataset.id = n.id;
    const credits = n.kind === 'choice' ? (n.pick?.credits ?? n.credits) : n.credits;
    const labs = n.labs || [];
    b.title = [n.label, n.title, ...labs.map((l) => `${l.label} ${l.title}`), `${credits + labs.reduce((s, l) => s + l.credits, 0)} cr`].filter(Boolean).join(' · ');
    // course code only, like Tim's chart; the title is in the tooltip
    b.innerHTML = `<b>${esc(n.label)}</b>` + (labs.length ? '<i>+Lab</i>' : '');
    b.addEventListener('click', () => toggle(n));
    host.appendChild(b);
  }
}

function layout() {
  const chart = $('chart');
  const W = chart.clientWidth, H = chart.clientHeight;
  if (!W || !H) return;
  const g = graph;
  const pad = 10;
  const rowH = Math.max(34, Math.min(56, Math.floor((H - pad * 2) / g.height)));
  const boxH = rowH - Math.max(5, Math.round(rowH * 0.18));
  const colW = Math.max(110, Math.min(150, Math.floor((W - pad * 2) / g.columns)));
  const boxW = Math.max(80, Math.min(96, Math.round(colW * 0.64)));
  const totalH = Math.max(H, Math.ceil(g.height * rowH) + pad * 2);
  const totalW = Math.max(W, g.columns * colW + pad * 2 - (colW - boxW));
  const top = Math.round((totalH - g.height * rowH) / 2);
  const X = (col) => pad + col * colW;
  const Y = (y) => Math.round(top + y * rowH); // box centre
  for (const el of $('boxes').children) {
    const p = g.pos.get(el.dataset.id);
    el.style.cssText = `left:${X(p.col)}px;top:${Y(p.y) - boxH / 2}px;width:${boxW}px;height:${boxH}px`;
  }
  const svg = $('edges');
  svg.setAttribute('width', totalW); svg.setAttribute('height', totalH);
  $('boxes').style.cssText = `width:${totalW}px;height:${totalH}px`;
  // Elbow connectors like Tim's chart: an arrow leaves the right side of its box, runs level (through
  // the columns it passes, between boxes), and turns at right angles in the gaps. Each gap gives every
  // bend its own vertical track; arrows from the same box share one. Downward bends from lower boxes go
  // further left (and upward bends from higher boxes), which keeps the tracks from crossing each other.
  const segs = [];
  g.paths.forEach((e, pi) => e.pts.slice(1).forEach((b, k) => {
    const a = e.pts[k];
    segs.push({ pi, k, gap: a.col, y1: Y(a.y), y2: Y(b.y), x1: X(a.col) + boxW, x2: X(b.col) });
  }));
  const byGap = new Map();
  for (const s of segs) if (Math.abs(s.y1 - s.y2) >= 1) (byGap.get(s.gap) ?? byGap.set(s.gap, []).get(s.gap)).push(s);
  for (const list of byGap.values()) {
    const groups = new Map();
    for (const s of list) { const key = `${s.y1}${s.y2 > s.y1 ? 'd' : 'u'}`; (groups.get(key) ?? groups.set(key, []).get(key)).push(s); }
    const keys = [...groups.keys()].sort((a, b) => {
      const da = a.endsWith('d'), db = b.endsWith('d'), ya = parseFloat(a), yb = parseFloat(b);
      return da !== db ? (da ? -1 : 1) : da ? yb - ya : ya - yb;
    });
    const { x1, x2 } = list[0], m = Math.min(8, (x2 - x1) / 4);
    keys.forEach((key, i) => { const tx = Math.round(x1 + m + ((x2 - x1 - 2 * m) * (i + 0.5)) / keys.length); for (const s of groups.get(key)) s.tx = tx; });
  }
  const path = new Map();
  for (const s of segs) {
    let d = path.get(s.pi) ?? `M${s.x1},${s.y1}`;
    if (s.k > 0) d += ` H${s.x1}`; // run level through the column of a passing point
    d += s.tx === undefined ? ` H${s.x2}` : ` H${s.tx} V${s.y2} H${s.x2}`;
    path.set(s.pi, d);
  }
  svg.innerHTML = '<defs><marker id="ah" viewBox="0 0 6 6" refX="6" refY="3" markerWidth="6" markerHeight="6" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0L6,3L0,6z"/></marker></defs>'
    + g.paths.map((e, pi) => `<path data-from="${esc(e.from)}" data-to="${esc(e.to)}"${e.or ? ' class="or"' : ''} marker-end="url(#ah)" d="${path.get(pi)}"/>`).join('');
  layoutCache = { W, H };
}

function nodeDone(n, completed) {
  const labsDone = (n.labs || []).every((l) => unitDone(l, completed));
  if (n.kind === 'option') return labsDone && n.codes.every((c) => completed.has(c));
  return labsDone && unitDone(n, completed);
}
function toggle(n) {
  const s = doneSet();
  const on = nodeDone(n, s);
  if (n.kind === 'course') {
    // one tap marks (or clears) the lecture and its folded lab together
    for (const u of [n, ...(n.labs || [])]) {
      if (on) u.codes.forEach((c) => s.delete(c)); // un-take, including an "or" alternative
      else if (!unitDone(u, s)) s.add(u.code);
    }
  } else if (n.kind === 'option') {
    n.codes.forEach((c) => (on ? s.delete(c) : s.add(c)));
  } else if (on) s.delete(n.id);
  else s.add(n.id);
  setDone(s);
  refresh();
}

// ---------- refresh states + plan ----------
function refresh() {
  const completed = doneSet();
  const have = new Set(completed);
  for (const u of model.units) if (u.kind === 'course' && unitDone(u, completed)) u.codes.forEach((c) => have.add(c));
  const inProgram = (c) => !!model.byCode[c];
  const prereqOk = (n) => n.kind === 'placeholder' || n.kind === 'choice' || evalReq(n.prereqs, have, inProgram);
  // a lab is only ready when its lecture could be taken alongside it
  const coreqOk = (n) => (n.coreqs || []).every((c) => !inProgram(c) || have.has(c) || prereqOk(model.byCode[c]));
  for (const el of $('boxes').children) {
    const n = nodes.find((x) => x.id === el.dataset.id);
    const done = nodeDone(n, completed);
    const ready = !done && prereqOk(n) && coreqOk(n) && (n.labs || []).every(prereqOk);
    el.classList.toggle('done', done);
    el.classList.toggle('ready', ready);
    el.setAttribute('aria-pressed', done);
  }
  renderPlan(completed);
}

function startTerm() {
  const s = state.settings.start;
  if (s) { const [season, year] = s.split(' '); return { season, year: +year }; }
  return defaultStartTerm();
}

function renderPlan(completed) {
  const plan = makePlan(model, completed, { maxCredits: state.settings.max, summers: state.settings.summers, start: startTerm() });
  const n = plan.semesters.length;
  $('sum').innerHTML = plan.graduation
    ? `<b>Graduate ${plan.graduation}</b><span>${plan.creditsLeft} credits · ${n} semester${n === 1 ? '' : 's'}</span>`
    : `<b>All done</b>`;
  $('sems').innerHTML = plan.semesters.map((s) => `
    <div class="sem"><h3>${s.term}<span>${s.credits}</span></h3><ul>${s.items.map((it) =>
      `<li class="${it.kind === 'course' ? '' : 'ph'}" title="${esc([it.label, it.title].filter(Boolean).join(' · '))}"><span>${esc(it.label)}</span><span>${it.credits}</span></li>`).join('')}</ul></div>`).join('')
    + plan.warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join('');
}

// ---------- tabs + settings ----------
function wireTabs() {
  for (const b of $('tabs').children) b.addEventListener('click', () => {
    $('main').dataset.tab = b.dataset.tab;
    for (const x of $('tabs').children) x.classList.toggle('on', x === b);
    if (b.dataset.tab === 'flow') layout();
  });
}
function wireSettings() {
  const dlg = $('settings');
  const fill = () => {
    const def = defaultStartTerm();
    const prev = { season: def.season === 'Spring' ? 'Fall' : 'Spring', year: def.season === 'Spring' ? def.year - 1 : def.year };
    const terms = [prev];
    let t = prev;
    for (let i = 0; i < 8; i++) { t = nextTerm(t, state.settings.summers); terms.push(t); }
    const cur = termLabel(startTerm());
    $('setStart').innerHTML = terms.map(termLabel).map((l) => `<option${l === cur ? ' selected' : ''}>${l}</option>`).join('');
    $('setMax').innerHTML = Array.from({ length: 16 }, (_, i) => i + 6).map((v) => `<option${v === state.settings.max ? ' selected' : ''}>${v}</option>`).join('');
    $('setSummer').checked = !!state.settings.summers;
  };
  $('gear').addEventListener('click', () => { fill(); dlg.showModal(); });
  $('setStart').addEventListener('change', (e) => { state.settings.start = e.target.value; save(); refresh(); });
  $('setMax').addEventListener('change', (e) => { state.settings.max = +e.target.value; save(); refresh(); });
  $('setSummer').addEventListener('change', (e) => { state.settings.summers = e.target.checked; save(); fill(); refresh(); });
  $('clearDone').addEventListener('click', () => { setDone(new Set()); refresh(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
}

// ---------- import a Wolverine Track audit (pasted text or its PDF), read on this device only ----------
function wireImport() {
  const dlg = $('importDlg');
  let found = null;
  const step = (n) => {
    $('impStep1').hidden = n !== 1; $('impStep2').hidden = n !== 2;
    $('impBack').textContent = n === 1 ? 'Cancel' : 'Back';
    $('impGo').textContent = n === 1 ? 'Read' : 'Apply';
    $('impGo').disabled = false;
    dlg.dataset.step = n;
  };
  const read = (text) => {
    const parsed = parseAudit(text);
    found = matchAudit(parsed, model);
    const t = found.rows.filter((r) => r.status === 'taken').length, ip = found.rows.length - t;
    $('impSum').innerHTML = `<b>Found ${t} taken, ${ip} in progress</b>` + (parsed.catalogYear ? `<span>Catalog ${esc(parsed.catalogYear)}</span>` : '');
    const done = doneSet();
    $('impList').innerHTML = found.rows.map((r, i) => `<li><label><input type="checkbox" data-i="${i}" data-ip="${r.status === 'ip' ? 1 : 0}"${done.has(r.key) ? ' disabled' : ''} checked>`
      + `<span>${esc(r.label)}</span><i>${esc(r.title)}</i>${r.status === 'ip' ? '<em>IP</em>' : ''}</label></li>`).join('');
    syncIP();
    if (parsed.catalogYear) { state.audit ??= {}; state.audit[PROGRAM] = { catalogYear: parsed.catalogYear }; save(); }
    $('impGo').disabled = !found.rows.length;
    step(2);
    $('impGo').disabled = !found.rows.length;
  };
  const syncIP = () => {
    const on = $('impIP').checked;
    for (const cb of $('impList').querySelectorAll('input[data-ip="1"]')) { if (!on) cb.checked = false; else if (!cb.disabled) cb.checked = true; cb.closest('li').classList.toggle('off', !on); }
  };
  $('importBtn').addEventListener('click', () => { $('settings').close(); $('impText').value = ''; $('impFile').value = ''; step(1); dlg.showModal(); });
  $('impIP').addEventListener('change', syncIP);
  $('impBack').addEventListener('click', () => (dlg.dataset.step === '2' ? step(1) : dlg.close()));
  $('impGo').addEventListener('click', () => {
    if (dlg.dataset.step === '1') { if ($('impText').value.trim()) read($('impText').value); return; }
    const s = doneSet();
    const ipOn = $('impIP').checked;
    for (const cb of $('impList').querySelectorAll('input:checked:not(:disabled)')) {
      const r = found.rows[+cb.dataset.i];
      if (r.status === 'ip' && !ipOn) continue;
      s.add(r.key);
    }
    setDone(s); refresh(); dlg.close();
  });
  $('impFile').addEventListener('change', async () => {
    const f = $('impFile').files[0];
    if (!f) return;
    $('impGo').disabled = true; $('impGo').textContent = 'Reading…';
    try {
      const { pdfToText } = await import('./pdftext.js');
      const text = await pdfToText(await f.arrayBuffer());
      $('impText').value = text;
      read(text);
    } catch (err) {
      $('impGo').disabled = false; $('impGo').textContent = 'Read';
      $('impText').value = '';
      $('impText').placeholder = 'Could not read that PDF. Paste the text instead.';
    }
  });
  $('impTip').addEventListener('click', () => { $('impTipText').hidden = !$('impTipText').hidden; });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
}

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

boot();

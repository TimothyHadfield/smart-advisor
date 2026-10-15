import { buildModel, makePlan, flowNodes, flowEdges, evalReq, unitDone, defaultStartTerm, nextTerm, termLabel } from './planner.js';

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

let model, nodes, edges, layoutCache = null;

// ---------- boot ----------
async function boot() {
  const res = await fetch(`data/programs/${PROGRAM}.json`);
  if (!res.ok) { $('progName').textContent = 'Program not found'; return; }
  const program = await res.json();
  $('progName').textContent = program.name;
  model = buildModel(program);
  nodes = flowNodes(model);
  edges = flowEdges(model);
  buildBoxes();
  layout();
  refresh();
  new ResizeObserver(() => layout()).observe($('chart'));
  wireTabs();
  wireSettings();
}

// ---------- flowchart ----------
function columns() {
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  const coreqPartner = (n) => nodes.find((m) => m !== n && ((n.coreqs || []).includes(m.code) || (m.coreqs || []).includes(n.code)));
  // a box with no arrows at all goes in the first column ("take any time")
  const isolated = (n) => !linked.has(n.id) && !(coreqPartner(n) && linked.has(coreqPartner(n).id));
  const hasIso = nodes.some(isolated);
  const cols = [];
  for (const n of nodes) {
    const c = isolated(n) ? 0 : n.depth + (hasIso ? 1 : 0);
    (cols[c] ??= []).push(n);
  }
  const pos = new Map();
  const into = (n) => edges.filter((e) => e.to === n.id).map((e) => pos.get(e.from)).filter((v) => v !== undefined);
  cols.forEach((col, ci) => {
    if (!col) { cols[ci] = []; return; }
    if (ci > 0 || !hasIso) {
      const key = new Map(col.map((n) => { const p = into(n); return [n.id, p.length ? p.reduce((a, b) => a + b, 0) / p.length : -1 + n.order / 1000]; }));
      col.sort((a, b) => key.get(a.id) - key.get(b.id) || a.order - b.order);
    }
    // keep a lab (fewer credits) right under its lecture
    for (const n of col.slice()) {
      const p = coreqPartner(n);
      if (!p || !col.includes(p) || n.credits < p.credits || (n.credits === p.credits && n.order > p.order)) continue;
      col.splice(col.indexOf(p), 1);
      col.splice(col.indexOf(n) + 1, 0, p);
    }
    col.forEach((n, i) => pos.set(n.id, i - col.length / 2));
  });
  return cols;
}

function buildBoxes() {
  const host = $('boxes');
  host.innerHTML = '';
  for (const n of nodes) {
    const b = document.createElement('button');
    b.className = 'box' + (n.kind === 'placeholder' || n.kind === 'choice' ? ' ph flex' : n.kind === 'option' ? ' flex' : '');
    b.dataset.id = n.id;
    const credits = n.kind === 'choice' ? (n.pick?.credits ?? n.credits) : n.credits;
    b.title = [n.label, n.title, `${credits} cr`].filter(Boolean).join(' · ');
    if (n.kind === 'placeholder' || n.kind === 'choice') b.innerHTML = `<b>${esc(n.label)}</b>`;
    else b.innerHTML = `<b>${esc(n.label)}</b><i>${esc(n.title)}</i>`;
    b.addEventListener('click', () => toggle(n));
    host.appendChild(b);
  }
}

function layout() {
  const chart = $('chart');
  const W = chart.clientWidth, H = chart.clientHeight;
  if (!W || !H) return;
  const cols = columns();
  const maxRows = Math.max(...cols.map((c) => c.length));
  const pad = 10;
  const rowH = Math.max(34, Math.min(56, Math.floor((H - pad * 2) / maxRows)));
  const boxH = rowH - Math.max(5, Math.round(rowH * 0.18));
  const colW = Math.max(110, Math.min(160, Math.floor((W - pad * 2) / cols.length)));
  const boxW = colW - Math.max(18, Math.round(colW * 0.2));
  const totalH = Math.max(H, maxRows * rowH + pad * 2);
  const totalW = Math.max(W, cols.length * colW + pad * 2 - (colW - boxW));
  const at = new Map();
  cols.forEach((col, ci) => {
    const top = Math.round((totalH - col.length * rowH) / 2);
    col.forEach((n, ri) => at.set(n.id, { x: pad + ci * colW, y: top + ri * rowH }));
  });
  for (const el of $('boxes').children) {
    const p = at.get(el.dataset.id);
    el.style.cssText = `left:${p.x}px;top:${p.y}px;width:${boxW}px;height:${boxH}px`;
  }
  const svg = $('edges');
  svg.setAttribute('width', totalW); svg.setAttribute('height', totalH);
  $('boxes').style.cssText = `width:${totalW}px;height:${totalH}px`;
  svg.innerHTML = edges.map((e) => {
    const a = at.get(e.from), b = at.get(e.to);
    const x1 = a.x + boxW, y1 = a.y + boxH / 2, x2 = b.x, y2 = b.y + boxH / 2;
    const dx = Math.max(12, (x2 - x1) / 2);
    return `<path data-from="${e.from}" data-to="${e.to}"${e.or ? ' class="or"' : ''} d="M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}"/>`;
  }).join('');
  layoutCache = { W, H };
}

function nodeDone(n, completed) {
  if (n.kind === 'option') return n.codes.every((c) => completed.has(c));
  return unitDone(n, completed);
}
function toggle(n) {
  const s = doneSet();
  const on = nodeDone(n, s);
  if (n.kind === 'course') {
    if (on) n.codes.forEach((c) => s.delete(c)); // un-take, including an "or" alternative
    else s.add(n.code);
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
    const ready = !done && prereqOk(n) && coreqOk(n);
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

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

boot();

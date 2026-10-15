import { buildModel, makePlan, flowNodes, flowEdges, unitDone, defaultStartTerm, nextTerm, termLabel, tapCheck, cascadeUntake } from './planner.js';
import { flowChart, foldLabs } from './layout.js';
import { parseAudit, matchAudit, gradeInfo } from './audit.js';
import { toDoc, applyDoc } from './sync.js';
import { initAccount } from './account.js';

const $ = (id) => document.getElementById(id);
const PROGRAM = new URLSearchParams(location.search).get('p') || 'ee-bs';
const KEY = 'smart-advisor:v1';

// ---------- saved state (localStorage; a signed-in student's copy also syncs to their account) ----------
// done[program]   = taken course codes / Gen Ed box ids
// grades[program] = { code or box id: grade } for what came from an audit ("A-", "TCR", "IP", or "")
function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function saveLocal() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}
function save() { saveLocal(); account.changed(); }
const state = load();
function defaults() {
  state.settings ??= { max: 16, summers: false, start: null };
  state.settings.grades ??= true;
  state.done ??= {};
  state.grades ??= {};
}
defaults();
// accounts (js/account.js): the account's copy replaces this device's; signing out clears it
const account = initAccount({
  local: () => toDoc(state, PROGRAM),
  apply: (doc) => { applyDoc(state, doc, PROGRAM); saveLocal(); redraw(); },
  clear: () => {
    for (const k of Object.keys(state)) delete state[k];
    defaults();
    try { localStorage.removeItem(KEY); } catch {}
    redraw();
  },
});
function redraw() {
  if (!model) return;
  $('gradesOn').checked = !!state.settings.grades;
  refresh();
}
const doneSet = () => new Set(state.done[PROGRAM] || []);
function setDone(set) { state.done[PROGRAM] = [...set]; save(); }
const gradeMap = () => (state.grades[PROGRAM] ??= {});

let model, nodes, edges, graph;

// ---------- boot ----------
async function boot() {
  const res = await fetch(`data/programs/${PROGRAM}.json`);
  if (!res.ok) { $('progName').textContent = 'Program not found'; return; }
  const program = await res.json();
  $('progName').textContent = program.name;
  model = buildModel(program);
  // labs are folded into their lecture's box (ECE 2250 + 2255 = one box); the planner still has both
  ({ nodes, edges } = foldLabs(flowNodes(model), flowEdges(model)));
  graph = chartFor(0);
  buildBoxes();
  layout();
  refresh();
  new ResizeObserver(() => layout()).observe($('chart'));
  wireTabs();
  wireSettings();
  wireImport();
  $('gradesOn').checked = !!state.settings.grades;
  $('gradesOn').addEventListener('change', (e) => { state.settings.grades = e.target.checked; save(); refresh(); });
}

// ---------- flowchart ----------
// Box positions and arrow routes come from js/layout.js (flowChart) in pixels. A laptop gets the widest
// boxes that still fit the chart's width; a phone gets the widest and scrolls inside the chart area.
const BASE = { boxH: 48, rowH: 58, gapMin: 26, port: 10, near: 8, pad: 12 };
const FITS = [{ boxW: 116, track: 9 }, { boxW: 112, track: 9 }, { boxW: 108, track: 8 }, { boxW: 104, track: 8 }, { boxW: 100, track: 8 }];
let SIZES = { ...BASE, ...FITS[0] };
const charts = new Map();
const chartFor = (k) => charts.get(k) ?? charts.set(k, flowChart(nodes, edges, { ...BASE, ...FITS[k] })).get(k);
function pickChart(W) {
  let k = FITS.findIndex((_, i) => chartFor(i).width <= W - 16);
  if (k < 0) k = W >= 700 ? FITS.length - 1 : 0;
  SIZES = { ...BASE, ...FITS[k] };
  graph = chartFor(k);
}

function buildBoxes() {
  const host = $('boxes');
  host.innerHTML = '';
  for (const n of nodes) {
    const b = document.createElement('button');
    const flex = n.kind === 'placeholder' || n.kind === 'choice';
    b.className = 'box' + (flex ? ' ph flex' : n.kind === 'option' ? ' flex' : '');
    b.dataset.id = n.id;
    const credits = n.kind === 'choice' ? (n.pick?.credits ?? n.credits) : n.credits;
    const labs = n.labs || [];
    b.title = [n.label, n.title, ...labs.map((l) => `${l.label} ${l.title}`), `${credits + labs.reduce((s, l) => s + l.credits, 0)} cr`].filter(Boolean).join(' · ');
    // course code and its name (Gen Ed / elective boxes: their name only)
    b.innerHTML = flex
      ? `<b>${esc(n.label)}</b>`
      : `<b>${esc(n.label)}${labs.length ? '<small>+Lab</small>' : ''}</b><i>${esc(n.title)}</i>`;
    b.insertAdjacentHTML('beforeend', '<em class="gr"></em>');
    b.addEventListener('click', () => toggle(n, b));
    host.appendChild(b);
  }
  const head = document.createElement('div');
  head.className = 'sec';
  head.id = 'genHead';
  head.textContent = 'Gen Ed';
  head.hidden = graph.genTop === null;
  host.appendChild(head);
  const note = document.createElement('div');
  note.className = 'note';
  note.id = 'note';
  host.appendChild(note);
}

function layout() {
  const chart = $('chart');
  const W = chart.clientWidth, H = chart.clientHeight;
  if (!W || !H) return;
  pickChart(W);
  const g = graph;
  const dx = Math.max(0, Math.round((W - g.width) / 2));
  const totalW = Math.max(W, Math.ceil(g.width)), totalH = Math.max(H, Math.ceil(g.height));
  for (const el of $('boxes').children) {
    if (!el.dataset.id) continue;
    const r = g.boxes.get(el.dataset.id);
    Object.assign(el.style, { left: `${r.x + dx}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }); // (keeps --gh)
  }
  if (g.genTop !== null) $('genHead').style.cssText = `left:${SIZES.pad + dx}px;top:${g.genTop}px;width:${Math.ceil(g.width) - 2 * SIZES.pad}px`;
  const svg = $('edges');
  svg.setAttribute('width', totalW); svg.setAttribute('height', totalH);
  $('boxes').style.cssText = `width:${totalW}px;height:${totalH}px`;
  // first time on a small screen: start scrolled to the first column's boxes, not empty space
  if (!layout.scrolled && g.width > W) {
    layout.scrolled = true;
    const first = [...g.boxes.values()].filter((r) => r.x <= SIZES.pad + 1).map((r) => r.y);
    if (first.length) chart.scrollTop = Math.max(0, Math.min(...first) - 16);
  }
  const d = (pts) => 'M' + pts.map(([x, y]) => `${+(x + dx).toFixed(1)},${+y.toFixed(1)}`).join('L');
  svg.innerHTML = '<defs><marker id="ah" viewBox="0 0 6 6" refX="6" refY="3" markerWidth="6" markerHeight="6" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0L6,3L0,6z"/></marker></defs>'
    + g.edges.map((e) => `<path data-from="${esc(e.from)}" data-to="${esc(e.to)}"${e.or ? ' class="or"' : ''} marker-end="url(#ah)" d="${d(e.pts)}"/>`).join('');
}

function nodeDone(n, completed) {
  const labsDone = (n.labs || []).every((l) => unitDone(l, completed));
  if (n.kind === 'option') return labsDone && n.codes.every((c) => completed.has(c));
  return labsDone && unitDone(n, completed);
}
// the keys a box puts in the taken set
const keysOf = (n) => (n.kind === 'course' || n.kind === 'option' ? [n, ...(n.labs || [])].flatMap((u) => u.codes) : [n.id]);

function toggle(n, el) {
  const s = doneSet();
  const grades = gradeMap();
  if (nodeDone(n, s)) {
    // untake it (and its folded lab, and an "or" alternative), then everything tapped that needed it;
    // classes from an imported audit stay (the audit is the truth)
    for (const k of keysOf(n)) { s.delete(k); delete grades[k]; }
    setDone(cascadeUntake(model, s, new Set(Object.keys(grades))));
  } else {
    const chk = tapCheck(model, n, s);
    if (!chk.ok) { blocked(el, chk.missing); return; }
    if (n.kind === 'course') { for (const u of [n, ...(n.labs || [])]) if (!unitDone(u, s)) s.add(u.code); }
    else if (n.kind === 'option') n.codes.forEach((c) => s.add(c));
    else s.add(n.id);
    setDone(s);
  }
  refresh();
}

// a box that can't be taken yet: a small shake and a note under it saying what it needs
let noteTimer = 0;
function blocked(el, missing) {
  el.classList.remove('shake');
  void el.offsetWidth; // restart the animation
  el.classList.add('shake');
  const note = $('note');
  note.textContent = `Needs ${missing.join(', ')}`;
  const r = el.getBoundingClientRect(), host = $('boxes').getBoundingClientRect();
  const below = r.bottom - host.top + 4;
  note.style.left = `${Math.max(4, r.left - host.left)}px`;
  note.style.top = `${below + 26 > $('boxes').offsetHeight ? r.top - host.top - 26 : below}px`;
  note.classList.add('on');
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => note.classList.remove('on'), 2200);
}

// ---------- refresh states + plan ----------
function gradeOfBox(n, grades) {
  for (const k of keysOf(n)) if (k in grades) return grades[k];
  return grades[n.id];
}
function refresh() {
  const completed = doneSet();
  const grades = gradeMap();
  const showGrades = !!state.settings.grades;
  const plan = makePlan(model, completed, { maxCredits: state.settings.max, summers: state.settings.summers, start: startTerm() });
  // which semester each unit is planned in (a choice group: its first chunk)
  const semOf = new Map();
  plan.semesters.forEach((s, i) => s.items.forEach((it) => { if (!semOf.has(it.unitId)) semOf.set(it.unitId, i); }));
  for (const el of $('boxes').children) {
    if (!el.dataset.id) continue;
    const n = nodes.find((x) => x.id === el.dataset.id);
    const done = nodeDone(n, completed);
    const sem = done ? undefined : semOf.get(n.id) ?? semOf.get(n.labs?.[0]?.id);
    el.className = el.className.replace(/\s?\bs\d+\b/g, '');
    if (sem !== undefined) el.classList.add(`s${sem % 10}`);
    el.classList.toggle('planned', sem !== undefined);
    el.classList.toggle('done', done);
    el.classList.toggle('locked', !done && !tapCheck(model, n, completed).ok);
    const gi = gradeInfo(done && showGrades ? gradeOfBox(n, grades) : '');
    el.classList.toggle('graded', gi.kind === 'letter');
    el.style.setProperty('--gh', gi.hue ?? 0);
    el.querySelector('.gr').textContent = gi.text;
    el.setAttribute('aria-pressed', done);
  }
  renderPlan(plan);
  renderLegend(plan);
}

function startTerm() {
  const s = state.settings.start;
  if (s) { const [season, year] = s.split(' '); return { season, year: +year }; }
  return defaultStartTerm();
}

const shortTerm = (t) => { const [season, year] = t.split(' '); return `${season.slice(0, 2)} ${String(year).slice(2)}`; };
function renderLegend(plan) {
  $('legendItems').innerHTML = '<span class="sw done"></span>Taken'
    + plan.semesters.map((s, i) => `<span class="sw s${i % 10}"></span>${shortTerm(s.term)}`).join('');
}

function renderPlan(plan) {
  const n = plan.semesters.length;
  $('sum').innerHTML = plan.graduation
    ? `<b>Graduate ${plan.graduation}</b><span>${plan.creditsLeft} credits · ${n} semester${n === 1 ? '' : 's'}</span>`
    : `<b>All done</b>`;
  $('sems').innerHTML = plan.semesters.map((s, i) => `
    <div class="sem s${i % 10}"><h3>${s.term}<span>${s.credits}</span></h3><ul>${s.items.map((it) =>
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
  $('clearDone').addEventListener('click', () => { state.grades[PROGRAM] = {}; setDone(new Set()); refresh(); });
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
      gradeMap()[r.key] = r.grade || ''; // imported: kept even if its prereqs look unmet
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

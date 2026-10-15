import { buildModel, makePlan, flowNodes, flowEdges, unitDone, defaultStartTerm, nextTerm, termLabel, tapCheck, cascadeUntake } from './planner.js';
import { flowChart, foldLabs } from './layout.js';
import { parseAudit, matchAudit, gradeInfo } from './audit.js';
import { toDoc, applyDoc } from './sync.js';
import { initAccount } from './account.js';
import { filterPrograms, programGroup, catalogInfo, programYears, programPath, yearFor, combinePrograms, auditPrograms, shortName } from './programs.js';

const $ = (id) => document.getElementById(id);
const PARAMS = new URLSearchParams(location.search);
// local testing against other data (e.g. ?data=tests/fixtures); the live site always reads data/
const DATA = (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /^[\w/-]+$/.test(PARAMS.get('data') || '') && PARAMS.get('data')) || 'data';
// program ids that were renamed when every program was fetched (saved plans still name the old one)
const ALIAS = { 'ee-bs': 'electrical-engineering-bs' };
const KEY = 'smart-advisor:v1';

// ---------- saved state (localStorage; a signed-in student's copy also syncs to their account) ----------
// plan            = { programs: [major, minor...], catalogYear (null = current) }
// done[major]     = taken course codes / Gen Ed box ids (a minor's boxes: "<minor id>/ph:3")
// grades[major]   = { code or box id: grade } for what came from an audit ("A-", "TCR", "IP", or "")
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
  state.plan ??= { programs: [], catalogYear: null };
  state.plan.programs ??= [];
  state.plan.catalogYear ??= null;
}
defaults();
if (PARAMS.get('p')) state.plan.programs = [PARAMS.get('p')];
// accounts (js/account.js): the account's copy replaces this device's; signing out clears it
const account = initAccount({
  local: () => toDoc(state, major()),
  apply: (doc) => {
    const was = planSig();
    applyDoc(state, doc, major());
    tidyPlan();
    saveLocal();
    if (planSig() !== was) loadPlan(); else redraw();
  },
  clear: () => {
    const was = planSig();
    for (const k of Object.keys(state)) delete state[k];
    defaults();
    tidyPlan();
    try { localStorage.removeItem(KEY); } catch {}
    if (planSig() !== was) loadPlan(); else redraw();
  },
});
function redraw() {
  if (!model) return;
  $('gradesOn').checked = !!state.settings.grades;
  refresh();
}
const major = () => state.plan.programs[0];
const planSig = () => JSON.stringify([state.plan.programs, state.plan.catalogYear]);
const doneSet = () => new Set(state.done[major()] || []);
function setDone(set) { state.done[major()] = [...set]; save(); }
const gradeMap = () => (state.grades[major()] ??= {});

let model, nodes, edges, graph, sections = [];

// ---------- the catalog's program list + program files (fetched once each, on demand) ----------
const cache = new Map();
function getJSON(path) {
  if (!cache.has(path)) {
    // a missing file (404) stays missing; a network error is tried again next time
    cache.set(path, fetch(path).then((r) => (r.ok ? r.json() : null)).catch(() => { cache.delete(path); return null; }));
  }
  return cache.get(path);
}
const catalog = { list: [], info: { current: null, years: [] }, ready: null };
function loadCatalog() {
  catalog.ready ??= getJSON(`${DATA}/programs/index.json`).then((index) => {
    catalog.list = Array.isArray(index?.programs) ? index.programs : [];
    catalog.info = catalogInfo(index, null);
  });
  return catalog.ready;
}
const entry = (id) => catalog.list.find((p) => p.id === id);
// a program for a catalog year (one it isn't in: its newest year); a missing file falls back to the current catalog
async function loadProgram(id, year) {
  const y = entry(id) ? yearFor(entry(id), year, catalog.info) : year;
  const want = y && y !== catalog.info.current ? y : null;
  const p = want ? await getJSON(programPath(id, want, catalog.info, DATA)) : null;
  if (p) return { program: p, year: want };
  const cur = await getJSON(programPath(id, null, catalog.info, DATA));
  return cur ? { program: cur, year: catalog.info.current } : null;
}

// renamed ids -> their new id (taken classes come along); no program chosen yet -> EE (the first program)
function tidyPlan() {
  const known = (id) => !catalog.list.length || !!entry(id);
  // saved before programs could be picked: EE, and the catalog year its audit import found
  if (!state.plan.programs.length) {
    state.plan.programs = ['ee-bs'];
    state.plan.catalogYear ??= state.audit?.['ee-bs']?.catalogYear ?? null;
  }
  state.plan.programs = [...new Set(state.plan.programs.filter((id) => typeof id === 'string').map((id) => {
    const to = ALIAS[id];
    if (known(id) || !to || !entry(to)) return id;
    for (const k of ['done', 'grades']) if (state[k][id] && !state[k][to]) state[k][to] = state[k][id];
    return to;
  }))];
}

// ---------- boot ----------
async function boot() {
  wireTabs();
  wireSettings();
  wireImport();
  wirePicker();
  new ResizeObserver(() => layout()).observe($('chart'));
  $('gradesOn').checked = !!state.settings.grades;
  $('gradesOn').addEventListener('change', (e) => { state.settings.grades = e.target.checked; save(); refresh(); });
  await loadCatalog();
  tidyPlan();
  await loadPlan();
}

// load the chosen programs (major + minors) and draw them as one chart and one plan
// programs (major first) + catalog year -> { parts, model }, or null when the major can't be loaded
async function buildFor(ids, year) {
  const got = await Promise.all(ids.map((id) => loadProgram(id, year)));
  const parts = ids.map((id, i) => got[i] && { id, program: got[i].program, year: got[i].year }).filter(Boolean);
  if (!parts.length || parts[0].id !== ids[0]) return null;
  return { parts, model: buildModel(combinePrograms(parts)) };
}
// change the chosen programs / catalog year; a new major brings the classes taken (not its Gen Ed boxes)
function setPlan(ids, year) {
  const from = major(), to = ids[0];
  if (to !== from && !state.done[to]?.length) {
    const course = (k) => !/^(ph|choice):|\//.test(k);
    state.done[to] = (state.done[from] || []).filter(course);
    state.grades[to] = Object.fromEntries(Object.entries(state.grades[from] || {}).filter(([k]) => course(k)));
  }
  state.plan.programs = [...ids];
  state.plan.catalogYear = year ?? null;
  save();
}
let loadGen = 0;
async function loadPlan() {
  const gen = ++loadGen;
  const built = await buildFor([...state.plan.programs], state.plan.catalogYear);
  if (gen !== loadGen) return;
  if (!built) { $('progName').textContent = 'Program not found'; return; }
  const { parts } = built;
  $('progName').textContent = parts.map((p) => p.program.name).join(' + ');
  model = built.model;
  // labs are folded into their lecture's box (ECE 2250 + 2255 = one box); the planner still has both
  ({ nodes, edges } = foldLabs(flowNodes(model), flowEdges(model)));
  // a minor (or second major, certificate) gets its own section under the major's chart
  sections = parts.slice(1).map((p) => ({ key: p.id, label: p.program.name, group: programGroup(entry(p.id) || { type: /minor/i.test(p.program.name) ? 'minor' : '' }), test: (n) => n.prog === p.id }));
  charts.clear();
  layout.scrolled = false;
  graph = chartFor(0);
  buildBoxes();
  layout();
  refresh();
}

// ---------- flowchart ----------
// Box positions and arrow routes come from js/layout.js (flowChart) in pixels. A laptop gets the widest
// boxes that still fit the chart's width; a phone gets the widest and scrolls inside the chart area.
const BASE = { boxH: 48, rowH: 58, gapMin: 26, port: 10, near: 8, pad: 12 };
const FITS = [{ boxW: 116, track: 9 }, { boxW: 112, track: 9 }, { boxW: 108, track: 8 }, { boxW: 104, track: 8 }, { boxW: 100, track: 8 }];
let SIZES = { ...BASE, ...FITS[0] };
const charts = new Map();
const chartFor = (k) => charts.get(k) ?? charts.set(k, flowChart(nodes, edges, { ...BASE, ...FITS[k] }, sections)).get(k);
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
    // a minor's box (also when an arrow keeps it in the major's chart) carries a small tag
    const sec = sections.find((s) => s.key === n.prog);
    if (sec) { b.classList.add('extra'); b.insertAdjacentHTML('beforeend', `<em class="tag">${TAG[sec.group] || 'Minor'}</em>`); }
    b.addEventListener('click', () => toggle(n, b));
    host.appendChild(b);
  }
  // section headings (a minor's name, Gen Ed); placed by layout()
  for (const s of [...sections, { key: 'gen', label: 'Gen Ed' }]) {
    const head = document.createElement('div');
    head.className = 'sec';
    head.dataset.sec = s.key;
    head.textContent = s.label;
    head.hidden = true;
    host.appendChild(head);
  }
  const note = document.createElement('div');
  note.className = 'note';
  note.id = 'note';
  host.appendChild(note);
}

const TAG = { minor: 'Minor', cert: 'Cert', major: 'Major' };

function layout() {
  const chart = $('chart');
  const W = chart.clientWidth, H = chart.clientHeight;
  if (!W || !H || !nodes) return;
  pickChart(W);
  const g = graph;
  const dx = Math.max(0, Math.round((W - g.width) / 2));
  const totalW = Math.max(W, Math.ceil(g.width)), totalH = Math.max(H, Math.ceil(g.height));
  for (const el of $('boxes').children) {
    if (el.dataset.sec) {
      const h = g.heads.find((x) => x.key === el.dataset.sec);
      el.hidden = !h;
      if (h) el.style.cssText = `left:${SIZES.pad + dx}px;top:${h.top}px;width:${Math.ceil(g.width) - 2 * SIZES.pad}px`;
      continue;
    }
    if (!el.dataset.id) continue;
    const r = g.boxes.get(el.dataset.id);
    Object.assign(el.style, { left: `${r.x + dx}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }); // (keeps --gh)
  }
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
  if (!model) return;
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
  $('clearDone').addEventListener('click', () => { state.grades[major()] = {}; setDone(new Set()); refresh(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
}

// ---------- the program picker (tap the program name in the header) ----------
// Major: one (tapping another replaces it). Minors / certificates: tap to add or remove. Kept as
// state.plan.programs = [major, ...others], so a second major can be added the same way later.
function wirePicker() {
  const dlg = $('pick');
  let group = 'major';
  const chosen = () => {
    const ids = state.plan.programs;
    $('pickChosen').innerHTML = ids.map((id, i) => {
      const e = entry(id);
      const name = e?.name || (model?.program.parts?.find((p) => p.id === id)?.name) || id;
      const role = i === 0 ? 'Major' : TAG[programGroup(e || {})] || 'Minor';
      return `<li><em>${role}</em><span>${esc(name)}</span>${i ? `<button type="button" class="x" data-x="${esc(id)}" aria-label="Remove">×</button>` : ''}</li>`;
    }).join('');
    // catalog years: what the catalog has (plus the chosen one, e.g. from an audit)
    const years = [...new Set([...programYears(entry(major()), catalog.info), ...(state.plan.catalogYear ? [state.plan.catalogYear] : [])])].sort().reverse();
    const cur = state.plan.catalogYear ?? catalog.info.current;
    $('pickYear').innerHTML = years.map((y) => `<option${y === cur ? ' selected' : ''}>${y}</option>`).join('');
    $('pickYearRow').hidden = years.length < 2;
  };
  const list = () => {
    // programs in the chosen catalog year; graduate programs hidden
    const rows = filterPrograms(catalog.list, $('pickQ').value, group, { year: state.plan.catalogYear ?? catalog.info.current });
    const on = new Set(state.plan.programs);
    $('pickList').innerHTML = rows.length
      ? rows.map((p) => `<li><button type="button" data-id="${esc(p.id)}"${on.has(p.id) ? ' class="on" aria-pressed="true"' : ''}>${esc(p.name)}</button></li>`).join('')
      : `<li class="none">${catalog.list.length ? 'No match' : 'List not loaded'}</li>`;
  };
  const apply = (ids, year = state.plan.catalogYear) => {
    if (JSON.stringify([ids, year ?? null]) === planSig()) return;
    setPlan(ids, year);
    chosen(); list();
    loadPlan();
  };
  $('progName').addEventListener('click', async () => {
    $('pickQ').value = '';
    dlg.showModal();
    await loadCatalog();
    chosen(); list();
    $('pickList').scrollTop = 0;
    if (matchMedia('(hover: hover)').matches) $('pickQ').focus();
  });
  $('pickQ').addEventListener('input', () => { list(); $('pickList').scrollTop = 0; });
  $('pickSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-g]');
    if (!b) return;
    group = b.dataset.g;
    for (const x of $('pickSeg').children) x.classList.toggle('on', x === b);
    list(); $('pickList').scrollTop = 0;
  });
  $('pickList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (!b) return;
    const id = b.dataset.id, ids = state.plan.programs;
    if (programGroup(entry(id) || {}) === 'major') apply([id, ...ids.slice(1).filter((x) => x !== id)]);
    else if (ids.includes(id)) { if (ids[0] !== id) apply(ids.filter((x) => x !== id)); }
    else apply([...ids, id]);
  });
  $('pickChosen').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-x]');
    if (b) apply(state.plan.programs.filter((x) => x !== b.dataset.x));
  });
  $('pickYear').addEventListener('change', (e) => apply(state.plan.programs, e.target.value === catalog.info.current ? null : e.target.value));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
}

// ---------- import a Wolverine Track audit (pasted text or its PDF), read on this device only ----------
function wireImport() {
  const dlg = $('importDlg');
  let found = null, parsed = null, progRows = [];
  const step = (n) => {
    $('impStep1').hidden = n !== 1; $('impStep2').hidden = n !== 2;
    $('impBack').textContent = n === 1 ? 'Cancel' : 'Back';
    $('impGo').textContent = n === 1 ? 'Read' : 'Apply';
    $('impGo').disabled = false;
    dlg.dataset.step = n;
  };
  // the audit header's programs + catalog year, ticked; one already chosen shows ticked and greyed
  const read = async (text) => {
    parsed = parseAudit(text);
    await loadCatalog();
    const curYear = state.plan.catalogYear ?? catalog.info.current;
    progRows = auditPrograms(parsed, catalog.list).map((p) => ({ ...p, same: p.role === 'major' ? major() === p.id : state.plan.programs.includes(p.id) }));
    if (parsed.catalogYear) progRows.push({ role: 'year', label: `Catalog ${parsed.catalogYear}`, same: parsed.catalogYear === curYear });
    $('impProg').innerHTML = progRows.map((r, i) => `<li><label><input type="checkbox" data-p="${i}"${r.same ? ' disabled' : ''} checked>`
      + `<span>${esc(r.role === 'year' ? r.label : shortName(r.label, 34))}</span>${r.role === 'year' ? '' : `<em>${r.role === 'major' ? 'Major' : 'Minor'}</em>`}</label></li>`).join('');
    $('impProg').hidden = !progRows.length;
    state.audit ??= {};
    if (parsed.catalogYear) { state.audit[major()] = { catalogYear: parsed.catalogYear }; save(); }
    await rematch();
    step(2);
    $('impGo').disabled = !found.rows.length && !progRows.some((r) => !r.same);
  };
  // the programs + year Apply would leave: a ticked major replaces the major, ticked minors are added
  const target = () => {
    const on = (i) => $('impProg').querySelector(`input[data-p="${i}"]`)?.checked;
    let ids = [...state.plan.programs];
    let year = state.plan.catalogYear;
    progRows.forEach((r, i) => {
      if (!on(i) || r.same) return;
      if (r.role === 'major') ids = [r.id, ...ids.slice(1).filter((x) => x !== r.id)];
      else if (r.role === 'minor') ids.push(r.id);
      else year = parsed.catalogYear === catalog.info.current ? null : parsed.catalogYear;
    });
    return { ids: [...new Set(ids)], year };
  };
  // courses are matched against the programs the student will have after Apply
  const rematch = async () => {
    const t = target();
    const m = JSON.stringify([t.ids, t.year]) === planSig() ? model : (await buildFor(t.ids, t.year))?.model || model;
    found = matchAudit(parsed, m);
    const n = found.rows.filter((r) => r.status === 'taken').length, ip = found.rows.length - n;
    $('impSum').innerHTML = `<b>Found ${n} taken, ${ip} in progress</b>`;
    const done = new Set(state.done[t.ids[0]] || []);
    $('impList').innerHTML = found.rows.map((r, i) => `<li><label><input type="checkbox" data-i="${i}" data-ip="${r.status === 'ip' ? 1 : 0}"${done.has(r.key) ? ' disabled' : ''} checked>`
      + `<span>${esc(r.label)}</span><i>${esc(r.title)}</i>${r.status === 'ip' ? '<em>IP</em>' : ''}</label></li>`).join('');
    syncIP();
  };
  $('impProg').addEventListener('change', () => rematch());
  const syncIP = () => {
    const on = $('impIP').checked;
    for (const cb of $('impList').querySelectorAll('input[data-ip="1"]')) { if (!on) cb.checked = false; else if (!cb.disabled) cb.checked = true; cb.closest('li').classList.toggle('off', !on); }
  };
  $('importBtn').addEventListener('click', () => { $('settings').close(); $('impText').value = ''; $('impFile').value = ''; step(1); dlg.showModal(); });
  $('impIP').addEventListener('change', syncIP);
  $('impBack').addEventListener('click', () => (dlg.dataset.step === '2' ? step(1) : dlg.close()));
  $('impGo').addEventListener('click', () => {
    if (dlg.dataset.step === '1') { if ($('impText').value.trim()) read($('impText').value); return; }
    const t = target();
    const switching = JSON.stringify([t.ids, t.year]) !== planSig();
    if (switching) setPlan(t.ids, t.year);
    const s = doneSet();
    const ipOn = $('impIP').checked;
    for (const cb of $('impList').querySelectorAll('input:checked:not(:disabled)')) {
      const r = found.rows[+cb.dataset.i];
      if (r.status === 'ip' && !ipOn) continue;
      s.add(r.key);
      gradeMap()[r.key] = r.grade || ''; // imported: kept even if its prereqs look unmet
    }
    setDone(s);
    if (switching) loadPlan(); else refresh();
    dlg.close();
  });
  $('impFile').addEventListener('change', async () => {
    const f = $('impFile').files[0];
    if (!f) return;
    $('impGo').disabled = true; $('impGo').textContent = 'Reading…';
    try {
      const { pdfToText } = await import('./pdftext.js');
      const text = await pdfToText(await f.arrayBuffer());
      $('impText').value = text;
      await read(text);
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

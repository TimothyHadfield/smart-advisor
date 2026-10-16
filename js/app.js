import { buildModel, makePlan, flowNodes, flowEdges, unitDone, optionDone, earliestStart, termIndex, nextTerm, termLabel, tapCheck, cascadeUntake } from './planner.js';
import { genEdList, filterList, pickedOf, withPick, pickKeysOf } from './gened.js';
import { flowChart, foldLabs } from './layout.js';
import { parseAudit, matchAudit, gradeInfo } from './audit.js';
import { toDoc, applyDoc } from './sync.js';
import { initAccount } from './account.js';
import { filterPrograms, programGroup, catalogInfo, programYears, programPath, yearFor, combinePrograms, auditPrograms, shortName } from './programs.js';
import { termInfo, defaultTerm, groupSections, buildSchedules, courseOptions, optionsConflict, meetingsOf, whenOf, fmtTime, rmpHue, DEFAULT_PREFS } from './schedule.js';

const $ = (id) => document.getElementById(id);
const PARAMS = new URLSearchParams(location.search);
// local testing against other data (e.g. ?data=tests/fixtures); the live site always reads data/
const DATA = (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /^[\w/-]+$/.test(PARAMS.get('data') || '') && PARAMS.get('data')) || 'data';
// program ids that were renamed when every program was fetched (saved plans still name the old one)
const ALIAS = { 'ee-bs': 'electrical-engineering-bs' };
const KEY = 'smart-advisor:v1';

// ---------- saved state (localStorage; a signed-in student's copy also syncs to their account) ----------
// plan            = { programs: [major, minor...], catalogYear (null = current) }
// done[major]     = taken course codes / Gen Ed box ids (a minor's boxes: "<minor id>/ph:3"); a Gen Ed box
//                   filled from its class list also has "<box id>=<code>" ("ph:8=DANC 1010", js/gened.js)
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
  // schedule builder: prefs (js/schedule.js DEFAULT_PREFS) + per term {add, drop, pin: {code: crn}, crns}
  state.settings.sched ??= {};
  state.settings.sched.prefs ??= {};
  state.settings.sched.terms ??= {};
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

let model, nodes, edges, graph, sections = [], lastPlan = null, gened = null;

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
  wireSched();
  wireGenEd();
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
  // Gen Ed class lists of the major's catalog year (missing: the current catalog's)
  const y = parts[0].year;
  gened = (y && y !== catalog.info.current && await getJSON(`${DATA}/${y}/gened.json`)) || await getJSON(`${DATA}/gened.json`);
  if (gen !== loadGen) return;
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
    // a Gen Ed box with a class list: the class taken (line 2) and a small list button on its bottom edge
    if (flex && listOf(n)) {
      b.classList.add('has-list');
      b.insertAdjacentHTML('beforeend', '<i class="pk"></i><span class="gl" role="button" aria-label="Class list" title="Class list"><svg viewBox="0 0 12 10" width="11" height="9" aria-hidden="true"><path d="M1 1.5h10M1 5h10M1 8.5h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span>');
    }
    b.addEventListener('click', (e) => { if (e.target.closest('.gl')) openGenEd(n); else toggle(n, b); });
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
  if (n.kind === 'option') return labsDone && unitDone(n, completed);
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
    // a pick-one box (American Institutions) can be filled by a class code from the audit: clear those too
    const keys = n.kind === 'choice' ? [n.id, ...(n.options || []).flatMap((o) => [...(o.codes || []), ...(o.alts || [])])] : keysOf(n);
    keys.push(...pickKeysOf(s, n.id)); // the class picked from its Gen Ed list
    for (const k of keys) { s.delete(k); delete grades[k]; }
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
    const pk = el.querySelector('.pk');
    if (pk) pk.textContent = done ? classOfBox(n, completed) || '' : '';
    el.setAttribute('aria-pressed', done);
  }
  renderPlan(plan);
  renderLegend(plan);
  lastPlan = plan;
  if ($('main').dataset.tab === 'sched') renderSched();
}

// ---------- Gen Ed class lists (js/gened.js): a sheet with the classes that fill a Gen Ed box ----------
// Placeholder box: tapping a class marks the box taken and remembers the class ("ph:8=DANC 1010").
// Pick-one box with its own options (American Institutions): tapping one takes that option's classes.
const listOf = (n) => genEdList(n, gened, { aas: /-aas$/.test(major() || ''), courses: model?.program.courses || {} });
const shortCode = (codes) => codes.map((c, i) => (i ? c.split(' ').pop() : c)).join(' + '); // "HIST 2700 + 2710"
function classOfBox(n, completed) {
  if (n.kind === 'choice') { const o = (n.options || []).find((x) => optionDone(x, completed)); return o ? shortCode(o.codes) : null; }
  return pickedOf(completed, n.id);
}
let geNode = null;
function openGenEd(n) {
  const list = listOf(n);
  if (!list) return;
  geNode = n;
  $('geName').textContent = n.label;
  const cr = n.kind === 'choice' ? (n.pick?.credits ?? n.credits) : n.credits;
  $('geSub').textContent = [list.groups.filter((g) => g.name).map((g) => g.name).join(' · '), cr ? `${cr} cr` : ''].filter(Boolean).join(' · ');
  $('geQ').value = '';
  drawGenEd();
  $('geDlg').showModal();
  document.activeElement?.blur();
  $('geList').scrollTop = 0;
}
function drawGenEd() {
  const n = geNode, list = listOf(n), s = doneSet();
  const done = nodeDone(n, s);
  const picked = n.kind === 'choice' ? null : pickedOf(s, n.id);
  const groups = filterList(list, $('geQ').value);
  const many = list.groups.length > 1;
  const row = (c) => {
    const on = c.codes ? optionDone({ codes: c.codes, alts: [] }, s) : c.code === picked;
    const code = c.codes ? shortCode(c.codes) : c.and ? shortCode([c.code, ...c.and]) : c.code;
    return `<li><button type="button" data-code="${esc(c.code)}"${on ? ' class="on" aria-pressed="true"' : ''}><b>${esc(code)}</b><span>${esc(c.title)}</span><em>${c.credits ?? ''}</em></button></li>`;
  };
  $('geList').innerHTML = groups.length
    ? groups.map((g) => (many ? `<li class="ge-h">${esc(g.name)}</li>` : '') + g.courses.map(row).join('')).join('')
    : '<li class="none">No match</li>';
  $('geUntake').style.visibility = done ? '' : 'hidden';
}
function wireGenEd() {
  const dlg = $('geDlg');
  $('geQ').addEventListener('input', () => { drawGenEd(); $('geList').scrollTop = 0; });
  $('geList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-code]');
    if (!b || !geNode) return;
    const n = geNode, s = doneSet();
    const c = listOf(n).groups.flatMap((g) => g.courses).find((x) => x.code === b.dataset.code);
    if (!c) return;
    const el = $('boxes').querySelector(`.box[data-id="${CSS.escape(n.id)}"]`);
    if (n.kind === 'choice') {
      const grades = gradeMap();
      if (optionDone({ codes: c.codes, alts: [] }, s)) {
        // tap a taken option again: untake it (and what needed it)
        for (const k of c.codes) { s.delete(k); delete grades[k]; }
        setDone(cascadeUntake(model, s, new Set(Object.keys(grades))));
        refresh(); drawGenEd();
        return;
      }
      const chk = tapCheck(model, n.options.find((o) => o.codes.join(' + ') === c.code) || n, s);
      if (!chk.ok) { dlg.close(); if (el) blocked(el, chk.missing); return; }
      c.codes.forEach((k) => s.add(k));
      setDone(s);
    } else {
      const chk = tapCheck(model, n, s);
      if (!chk.ok) { dlg.close(); if (el) blocked(el, chk.missing); return; }
      setDone(withPick(s, n.id, c.code));
    }
    refresh();
    if (nodeDone(n, doneSet())) dlg.close(); else drawGenEd();
  });
  $('geUntake').addEventListener('click', () => {
    const n = geNode, el = $('boxes').querySelector(`.box[data-id="${CSS.escape(n.id)}"]`);
    if (n && el && nodeDone(n, doneSet())) toggle(n, el);
    dlg.close();
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
}

const parseTerm = (s) => { const [season, year] = String(s || '').split(' '); return year ? { season, year: +year } : null; };
// first planned semester: the chosen Start, but never the semester in session (or one the imported audit
// already shows classes in); a saved Start that has slipped into the past moves up on its own
const earliest = () => earliestStart({ summers: state.settings.summers, lastTerm: parseTerm(state.settings.lastTerm) });
function startTerm() {
  const e = earliest(), s = parseTerm(state.settings.start);
  return s && termIndex(s) > termIndex(e) ? s : e;
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
// phone: bottom tabs Flowchart / Plan / Schedule; laptop: Flowchart / Schedule in the header (the plan stays beside it)
function setTab(tab) {
  $('main').dataset.tab = tab;
  for (const x of $('tabs').children) x.classList.toggle('on', x.dataset.tab === tab);
  for (const x of $('wtabs').children) x.classList.toggle('on', x.dataset.tab === (tab === 'sched' ? 'sched' : 'flow'));
  if (tab === 'flow' || tab === 'plan') layout();
  if (tab === 'sched') renderSched();
}
function wireTabs() {
  for (const b of [...$('tabs').children, ...$('wtabs').children]) b.addEventListener('click', () => setTab(b.dataset.tab));
}
function wireSettings() {
  const dlg = $('settings');
  const fill = () => {
    let t = earliest();
    const terms = [t];
    for (let i = 0; i < 8; i++) { t = nextTerm(t, state.settings.summers); terms.push(t); }
    const cur = termLabel(startTerm());
    $('setStart').innerHTML = terms.map(termLabel).map((l) => `<option${l === cur ? ' selected' : ''}>${l}</option>`).join('');
    $('setMax').innerHTML = Array.from({ length: 16 }, (_, i) => i + 6).map((v) => `<option${v === state.settings.max ? ' selected' : ''}>${v}</option>`).join('');
    $('setSummer').checked = !!state.settings.summers;
    // schedule preferences
    const p = prefs();
    for (const b of $('setDays').children) b.classList.toggle('on', p.days.includes(b.dataset.d));
    const hour = (h) => `${((h + 11) % 12) + 1} ${h < 12 ? 'am' : 'pm'}`;
    const opts = (hours, cur, any) => `<option value="">${any}</option>` + hours.map((h) => { const v = String(h * 100).padStart(4, '0'); return `<option value="${v}"${v === cur ? ' selected' : ''}>${hour(h)}</option>`; }).join('');
    $('setAfter').innerHTML = opts([7, 8, 9, 10, 11, 12, 13], p.after, 'Any');
    $('setBefore').innerHTML = opts([12, 13, 14, 15, 16, 17, 18, 19, 20, 21], p.before, 'Any');
    $('setMode').value = p.mode;
    $('setGaps').checked = !!p.gaps; $('setRmp').checked = !!p.rmp; $('setMain').checked = !!p.main; $('setWait').checked = !!p.wait;
  };
  const setPref = (k, v) => { state.settings.sched.prefs = { ...prefs(), [k]: v }; save(); renderSchedIfOpen(); };
  $('setDays').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-d]');
    if (!b) return;
    b.classList.toggle('on');
    setPref('days', [...$('setDays').children].filter((x) => x.classList.contains('on')).map((x) => x.dataset.d).join(''));
  });
  $('setAfter').addEventListener('change', (e) => setPref('after', e.target.value || null));
  $('setBefore').addEventListener('change', (e) => setPref('before', e.target.value || null));
  $('setMode').addEventListener('change', (e) => setPref('mode', e.target.value));
  for (const [id, k] of [['setGaps', 'gaps'], ['setRmp', 'rmp'], ['setMain', 'main'], ['setWait', 'wait']]) $(id).addEventListener('change', (e) => setPref(k, e.target.checked));
  $('gear').addEventListener('click', () => { fill(); dlg.showModal(); });
  $('setStart').addEventListener('change', (e) => { state.settings.start = e.target.value; save(); refresh(); });
  $('setMax').addEventListener('change', (e) => { state.settings.max = +e.target.value; save(); refresh(); });
  $('setSummer').addEventListener('change', (e) => { state.settings.summers = e.target.checked; save(); fill(); refresh(); });
  $('clearDone').addEventListener('click', () => { state.grades[major()] = {}; delete state.settings.lastTerm; setDone(new Set()); refresh(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
}

// ---------- schedule: a term's sections, the best non-conflicting schedules (js/schedule.js) ----------
// The classes come from the plan's semester for that term; the student can add or remove classes and
// pin a section (tap a class). Preferences live in Settings. Section data + ratings load on first use.
const prefs = () => ({ ...DEFAULT_PREFS, ...(state.settings.sched?.prefs || {}) });
const sched = { terms: [], term: null, groups: new Map(), rmp: {}, list: [], idx: 0, courses: [], ready: null };
const DAY_NAME = { M: 'Mon', T: 'Tue', W: 'Wed', R: 'Thu', F: 'Fri', S: 'Sat', U: 'Sun' };
function loadSchedIndex() {
  sched.ready ??= Promise.all([getJSON(`${DATA}/sections/index.json`), getJSON(`${DATA}/rmp.json`)]).then(([idx, rmp]) => {
    sched.terms = (idx?.terms || []).map((t) => String(t.term)).sort();
    sched.rmp = rmp?.profs || {};
    sched.term ??= defaultTerm(sched.terms);
    if (!sched.terms.length) sched.ready = null; // try again next time
  });
  return sched.ready;
}
async function termGroups(code) {
  if (!sched.groups.has(code)) {
    const d = await getJSON(`${DATA}/sections/${code}.json`);
    if (!d) return new Map();
    sched.groups.set(code, groupSections(d.sections));
  }
  return sched.groups.get(code);
}
function termState(code) {
  const t = (state.settings.sched.terms[code] ??= {});
  t.add ??= []; t.drop ??= []; t.pin ??= {}; t.crns ??= [];
  return t;
}
// the plan's courses for that term (a course with alternatives: the one offered), minus removed, plus added
function termCourses(code, groups) {
  const t = termState(code);
  const sem = lastPlan?.semesters.find((s) => s.term === termInfo(code).label);
  const out = [];
  for (const it of sem?.items || []) {
    if (it.kind !== 'course' || !it.code) continue;
    const codes = model?.units.find((u) => u.id === it.unitId)?.codes || [it.code];
    const c = codes.find((x) => groups.has(x)) || it.code;
    if (!t.drop.includes(c) && !out.includes(c)) out.push(c);
  }
  for (const c of t.add) if (!out.includes(c)) out.push(c);
  return out;
}
const renderSchedIfOpen = () => { if ($('main').dataset.tab === 'sched') renderSched(); };
let schedGen = 0;
async function renderSched() {
  const gen = ++schedGen;
  await loadSchedIndex();
  if (gen !== schedGen) return;
  if (!sched.terms.length) { $('scList').innerHTML = '<li class="none">Class list not loaded</li>'; return; }
  $('scTerms').innerHTML = sched.terms.map((c) => `<button type="button" data-term="${c}"${c === sched.term ? ' class="on"' : ''}>${termInfo(c).short}</button>`).join('');
  if (!sched.groups.has(sched.term)) $('scList').innerHTML = '<li class="none">Loading…</li>';
  const code = sched.term;
  const groups = await termGroups(code);
  if (gen !== schedGen) return;
  const t = termState(code);
  sched.courses = termCourses(code, groups).map((c) => ({ code: c, sections: groups.get(c) || [] }));
  sched.list = buildSchedules(sched.courses, prefs(), sched.rmp, { pins: t.pin }).list;
  const i = sched.list.findIndex((s) => s.crns.join(' ') === t.crns.join(' '));
  sched.idx = i >= 0 ? i : 0;
  drawSched();
}
function drawSched() {
  const s = sched.list[sched.idx];
  const t = termState(sched.term);
  const crns = s ? s.crns : [];
  if (crns.join(' ') !== t.crns.join(' ')) { t.crns = crns; save(); }
  $('scRank').textContent = `${sched.list.length ? sched.idx + 1 : 0}/${sched.list.length}`;
  $('scPrev').disabled = sched.idx <= 0;
  $('scNext').disabled = sched.idx >= sched.list.length - 1;
  $('scCopy').disabled = !crns.length;
  drawWeek(s);
  drawList(s);
}
const lastName = (instr) => (instr ? instr.split(',')[0] : 'Staff');
function ratingBadge(instr, link) {
  const p = sched.rmp[instr];
  if (!p) return '<em class="rt unrated" title="No rating">–</em>';
  const style = `style="--rh:${rmpHue(p.r)}"`;
  return link && p.id
    ? `<a class="rt" ${style} href="https://www.ratemyprofessors.com/professor/${encodeURIComponent(p.id)}" target="_blank" rel="noopener" title="Rate My Professors">${p.r.toFixed(1)}</a>`
    : `<em class="rt" ${style}>${p.r.toFixed(1)}</em>`;
}
const seatText = (sec) => (sec.seats > 0 ? `${sec.seats} open` : `Full${sec.wait ? ` +${sec.wait}` : ''}`);
// Mon-Fri (+Sat when needed), 8 am-5 pm at least; one colour per class (the plan's semester palette)
function drawWeek(s) {
  const blocks = [];
  (s?.picks || []).forEach((o, i) => { if (o) for (const sec of o.secs) for (const m of meetingsOf(sec)) blocks.push({ i, m, sec }); });
  const days = ['M', 'T', 'W', 'R', 'F', ...['S', 'U'].filter((d) => blocks.some((b) => b.m.day === d))];
  let lo = 480, hi = 1020;
  for (const b of blocks) { lo = Math.min(lo, Math.floor(b.m.s / 60) * 60); hi = Math.max(hi, Math.ceil(b.m.e / 60) * 60); }
  const span = hi - lo, pct = (v) => +(v * 100).toFixed(3);
  const hours = [];
  for (let h = lo; h < hi; h += 60) hours.push(`<span style="top:${pct((h - lo) / span)}%">${((h / 60 + 11) % 12) + 1}</span>`);
  $('scWeek').style.setProperty('--n', days.length);
  $('scWeek').innerHTML = `<div class="wk-head"><span></span>${days.map((d) => `<span>${DAY_NAME[d]}</span>`).join('')}</div>`
    + `<div class="wk-body" style="--rows:${span / 60}"><div class="wk-times">${hours.join('')}</div><div class="wk-cols">`
    + blocks.map((b) => `<div class="wk-b s${b.i % 10}" style="left:calc(${days.indexOf(b.m.day)} * 100% / var(--n));top:${pct((b.m.s - lo) / span)}%;height:${pct((b.m.e - b.m.s) / span)}%" title="${esc(`${codeLabel(b.sec)} ${whenOf(b.sec)} ${b.sec.bldg || ''} ${b.sec.room || ''}`)}">`
      + `<b>${esc(codeLabel(b.sec))}</b><span>${fmtTime(b.m.s)}</span></div>`).join('')
    + '</div></div>';
  // a block too short for two lines shows the course only
  for (const el of $('scWeek').querySelectorAll('.wk-b')) el.classList.toggle('short', el.offsetHeight < 25);
}
const codeLabel = (sec) => `${sec.subj} ${sec.num}`;
function whyUnplaced(c) {
  if (!c.sections.length) return 'Not offered';
  if (!prefs().wait && courseOptions(c.sections).every((o) => o.secs.some((x) => x.seats <= 0))) return 'Full';
  return 'Doesn’t fit';
}
function drawList(s) {
  const t = termState(sched.term);
  $('scList').innerHTML = sched.courses.map((c, i) => {
    const o = s?.picks[i];
    const sw = `<span class="sw s${i % 10}"></span>`;
    if (!o) return `<li><button type="button" class="sc-row off" data-i="${i}">${sw}<b>${esc(c.code)}</b><span class="why">${whyUnplaced(c)}</span></button></li>`;
    const sec = o.secs[0];
    return `<li><button type="button" class="sc-row" data-i="${i}">${sw}<b>${esc(c.code)}</b><span class="when">${esc(whenOf(sec))}</span>`
      + `<span class="who">${esc(lastName(sec.instr))}</span>${ratingBadge(sec.instr)}<span class="seat${sec.seats > 0 ? '' : ' full'}">${seatText(sec)}</span>`
      + `<span class="crn${t.pin[c.code] ? ' pin' : ''}">${o.secs.map((x) => x.crn).join('+')}</span></button></li>`;
  }).join('') + '<li><button type="button" class="sc-add" id="scAdd">+ Add class</button></li>';
}
function openCourse(i) {
  const c = sched.courses[i], t = termState(sched.term), s = sched.list[sched.idx];
  const others = (s?.picks || []).filter((o, k) => o && k !== i);
  const cur = new Set((s?.picks[i]?.secs || []).map((x) => x.crn));
  const pin = t.pin[c.code];
  const secs = c.sections.slice().sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999') || a.days.localeCompare(b.days) || a.sec.localeCompare(b.sec));
  $('secCode').textContent = c.code;
  $('secTitle').textContent = c.sections[0]?.title || '';
  $('secDlg').dataset.i = i;
  const MODE = { online: 'Online', hybrid: 'Hybrid', livestream: 'Live' };
  $('secList').innerHTML = `<li><button type="button" data-crn=""${pin ? '' : ' class="on"'}><b>Best fit</b></button></li>`
    + (secs.length ? secs.map((x) => {
      const clash = others.some((o) => optionsConflict(o, { secs: [x] }));
      const tags = [x.mode !== 'in person' && whenOf(x) !== 'Online' ? MODE[x.mode] : '', x.campus && x.campus !== 'Main Campus' ? 'Off campus' : ''].filter(Boolean);
      return `<li class="${clash ? 'clash' : ''}"><button type="button" data-crn="${esc(x.crn)}" class="${[pin === x.crn ? 'on' : '', cur.has(x.crn) ? 'cur' : ''].join(' ')}">`
        + `<span class="sn">${esc(x.sec)}</span><span class="when">${esc(whenOf(x))}${tags.map((g) => `<i>${g}</i>`).join('')}</span>`
        + `<span class="who">${esc(lastName(x.instr))}</span><span class="seat${x.seats > 0 ? '' : ' full'}">${seatText(x)}</span></button>${ratingBadge(x.instr, true)}</li>`;
    }).join('') : '<li class="none">Not offered this term</li>');
  $('secDlg').showModal();
  document.activeElement?.blur(); // no focus ring on "Best fit" when it opens
  $('secList').scrollTop = 0;
}
function wireSched() {
  $('scTerms').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-term]');
    if (!b || b.dataset.term === sched.term) return;
    sched.term = b.dataset.term;
    renderSched();
  });
  $('scPrev').addEventListener('click', () => { if (sched.idx > 0) { sched.idx--; drawSched(); } });
  $('scNext').addEventListener('click', () => { if (sched.idx < sched.list.length - 1) { sched.idx++; drawSched(); } });
  $('scCopy').addEventListener('click', async () => {
    const text = (sched.list[sched.idx]?.crns || []).join(' ');
    if (!text) return;
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch {}
      ta.remove();
    }
    $('scCopy').textContent = 'Copied';
    clearTimeout(wireSched.t);
    wireSched.t = setTimeout(() => { $('scCopy').textContent = 'Copy CRNs'; }, 1500);
  });
  $('scList').addEventListener('click', (e) => {
    if (e.target.closest('#scAdd')) { openAdd(); return; }
    const b = e.target.closest('button[data-i]');
    if (b) openCourse(+b.dataset.i);
  });
  // a section: keep it (tap again or Best fit: let the builder choose)
  $('secList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-crn]');
    if (!b) return;
    const c = sched.courses[+$('secDlg').dataset.i], t = termState(sched.term);
    if (!b.dataset.crn || t.pin[c.code] === b.dataset.crn) delete t.pin[c.code]; else t.pin[c.code] = b.dataset.crn;
    save();
    $('secDlg').close();
    renderSched();
  });
  $('secRemove').addEventListener('click', () => {
    const c = sched.courses[+$('secDlg').dataset.i], t = termState(sched.term);
    if (t.add.includes(c.code)) t.add = t.add.filter((x) => x !== c.code); else t.drop.push(c.code);
    delete t.pin[c.code];
    save();
    $('secDlg').close();
    renderSched();
  });
  $('secDlg').addEventListener('click', (e) => { if (e.target === $('secDlg')) $('secDlg').close(); });
  // add a class: search the term's courses by code or title
  const list = () => {
    const groups = sched.groups.get(sched.term) || new Map();
    const q = $('addQ').value.trim().toLowerCase().replace(/\s+/g, ' ');
    const have = new Set(sched.courses.map((c) => c.code));
    const rows = [];
    for (const [code, secs] of groups) {
      if (have.has(code)) continue;
      const title = secs[0]?.title || '';
      if (q && !code.toLowerCase().includes(q) && !code.toLowerCase().replace(' ', '').includes(q) && !title.toLowerCase().includes(q)) continue;
      rows.push([code, title]);
      if (rows.length >= 80) break;
    }
    rows.sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }));
    $('addList').innerHTML = rows.length
      ? rows.map(([code, title]) => `<li><button type="button" data-code="${esc(code)}"><b>${esc(code)}</b><span>${esc(title)}</span></button></li>`).join('')
      : '<li class="none">No match</li>';
  };
  const openAdd = () => {
    $('addQ').value = '';
    list();
    $('addDlg').showModal();
    $('addList').scrollTop = 0;
    if (matchMedia('(hover: hover)').matches) $('addQ').focus();
  };
  $('addQ').addEventListener('input', () => { list(); $('addList').scrollTop = 0; });
  $('addList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-code]');
    if (!b) return;
    const t = termState(sched.term), code = b.dataset.code;
    if (t.drop.includes(code)) t.drop = t.drop.filter((x) => x !== code); else if (!t.add.includes(code)) t.add.push(code);
    save();
    $('addDlg').close();
    renderSched();
  });
  $('addDlg').addEventListener('click', (e) => { if (e.target === $('addDlg')) $('addDlg').close(); });
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
    // already-taken rows are disabled (can't be unticked) but still bring their grade from the audit
    for (const cb of $('impList').querySelectorAll('input:checked')) {
      const r = found.rows[+cb.dataset.i];
      if (r.status === 'ip' && !ipOn) continue;
      s.add(r.key);
      if (r.grade || !cb.disabled) gradeMap()[r.key] = r.grade || ''; // imported: kept even if its prereqs look unmet
    }
    setDone(s);
    // classes in progress (or already registered for next term): the plan starts after that semester
    if (parsed?.lastTerm) state.settings.lastTerm = termLabel(parsed.lastTerm);
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

import { buildModel, makePlan, flowNodes, flowEdges, unitDone, optionDone, earliestStart, planStart, nextTerm, termLabel, tapCheck, cascadeUntake } from './planner.js';
import { genEdList, filterList, pickedOf, withPick, pickKeysOf } from './gened.js';
import { flowChart, foldLabs } from './layout.js';
import { parseAudit, matchAudit, gradeInfo } from './audit.js';
import { toDoc, applyDoc } from './sync.js';
import { initAccount } from './account.js';
import { filterPrograms, programGroup, catalogInfo, programYears, programPath, yearFor, combinePrograms, auditPrograms, shortName } from './programs.js';
import { termInfo, defaultTerm, currentTermCode, groupSections, buildSchedules, courseOptions, optionsConflict, meetingsOf, whenOf, fmtTime, rmpHue, DEFAULT_PREFS } from './schedule.js';
import * as P from './planner.js'; // optional planner extras (planPhases, requirementFor, pickTrack): used only when present
import { initMine } from './mineui.js';
import { urlPrograms, programsFromLink, urlWithPrograms, isFirstVisit, clearTaken, undoClear, pickLabel, courseURL, issueURL, tracksOf, milestonesOf, needsOf } from './uistate.js';
import { viewSet, hypoFrom, normHypo, hasHypo, boxGrade, gpa, classGroups, geBoxFor, statusOf, GRADES } from './classes.js';

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
// grades[major]   = { code or box id: grade } ("A-", "TCR", "IP" = in progress, or ""), from an audit or the student
// done[major] holds the ACTUAL classes (audit + added in Classes); flowchart taps are hypothetical and live in
// settings.hypo[major] (js/classes.js), shown on top unless the student picks "Actual"
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
// ?p=major,minor opens those programs like picking them; it never wipes the saved plan (js/uistate.js)
const LINK = urlPrograms(location.search);
// a new student (nothing saved, no link) gets the program picker, not EE
const FIRST = isFirstVisit(state, LINK);
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
// view: 'hypo' (actual + taps) or 'actual' (audit + added only); not saved
const ui = { view: 'hypo', sub: 'plan' };
const actualSet = () => new Set(state.done[major()] || []);
const hypoOf = () => normHypo(actualSet(), state.settings.hypo?.[major()]);
// the classes counted on screen (flowchart, plan, Classes, schedule)
const doneSet = () => viewSet(actualSet(), state.settings.hypo?.[major()], ui.view);
function setHypo(h) { state.settings.hypo = { ...(state.settings.hypo || {}), [major()]: h }; }
// a tap (flowchart box, its class sheet's Taken switch, a Gen Ed list): hypothetical, never the actual classes
function setDone(set) { setHypo(hypoFrom(actualSet(), set)); ui.view = 'hypo'; save(); }
// taps start from what Hypothetical shows (a tap while viewing Actual switches back)
function tapSet() { ui.view = 'hypo'; return doneSet(); }
// the actual classes (audit import, Classes); taps that now change nothing drop out
function setActual(set) { state.done[major()] = [...set]; setHypo(normHypo(new Set(set), state.settings.hypo?.[major()])); save(); }
const srcMap = () => { state.settings.src = { ...(state.settings.src || {}) }; return (state.settings.src[major()] = { ...(state.settings.src[major()] || {}) }); };
const gradeMap = () => (state.grades[major()] ??= {});

let model, nodes, edges, graph, sections = [], lastPlan = null, gened = null, progParts = [];

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
  // (a new student has nothing saved: no program until they pick one)
  if (!state.plan.programs.length && !isFirstVisit(state, null)) {
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
  wireNav();
  wireClassSheet();
  wireHypo();
  wireClasses();
  wireNoAudit();
  wireZoom();
  new ResizeObserver(() => layout()).observe($('chart'));
  $('gradesOn').checked = !!state.settings.grades;
  $('gradesOn').addEventListener('change', (e) => { state.settings.grades = e.target.checked; save(); refresh(); });
  await loadCatalog();
  if (LINK) {
    const ids = programsFromLink(state.plan.programs, LINK, (id) => (entry(id) ? programGroup(entry(id)) : ''));
    if (JSON.stringify(ids) !== JSON.stringify(state.plan.programs)) setPlan(ids, state.plan.catalogYear);
  }
  tidyPlan();
  if (FIRST && !state.plan.programs.length) $('progName').click();
  await loadPlan();
}

// load the chosen programs (major + minors) and draw them as one chart and one plan
// programs (major first) + catalog year -> { parts, model }, or null when the major can't be loaded
async function buildFor(ids, year) {
  const got = await Promise.all(ids.map((id) => loadProgram(id, year)));
  const parts = ids.map((id, i) => got[i] && { id, program: got[i].program, year: got[i].year }).filter(Boolean);
  if (!parts.length || parts[0].id !== ids[0]) return null;
  // the planner's extra data for the major's catalog year: prerequisites from outside the program ("Needed
  // first" boxes), Gen Ed lists, and the semesters each class usually runs in (missing: plan without it)
  const y = parts[0].year;
  const ofYear = async (f) => (y && y !== catalog.info.current && await getJSON(`${DATA}/${y}/${f}`)) || getJSON(`${DATA}/${f}`);
  const [extraCourses, ge, seasons] = await Promise.all([ofYear('prereq-courses.json'), ofYear('gened.json'), getJSON(`${DATA}/seasons.json`)]);
  return { parts, model: buildModel(combinePrograms(parts), { extraCourses, gened: ge, seasons }) };
}
// change the chosen programs / catalog year; a new major brings the classes taken (not its Gen Ed boxes)
function setPlan(ids, year) {
  const from = major(), to = ids[0];
  if (to !== from && !state.done[to]?.length) {
    const course = (k) => !/^(ph|choice):|\//.test(k);
    state.done[to] = (state.done[from] || []).filter(course);
    state.grades[to] = Object.fromEntries(Object.entries(state.grades[from] || {}).filter(([k]) => course(k)));
    const src = state.settings.src?.[from];
    if (src) state.settings.src = { ...state.settings.src, [to]: Object.fromEntries(Object.entries(src).filter(([k]) => course(k))) };
  }
  state.plan.programs = [...ids];
  state.plan.catalogYear = year ?? null;
  save();
}
let loadGen = 0;
async function loadPlan() {
  const gen = ++loadGen;
  if (!state.plan.programs.length) { showEmpty(); return; }
  $('main').classList.remove('empty');
  const built = await buildFor([...state.plan.programs], state.plan.catalogYear);
  if (gen !== loadGen) return;
  if (!built) { $('progName').textContent = 'Program not found'; return; }
  const { parts } = built;
  // Gen Ed class lists of the major's catalog year (missing: the current catalog's)
  const y = parts[0].year;
  gened = (y && y !== catalog.info.current && await getJSON(`${DATA}/${y}/gened.json`)) || await getJSON(`${DATA}/gened.json`);
  if (gen !== loadGen) return;
  $('progName').textContent = parts.map((p) => p.program.name).join(' + ');
  progParts = parts;
  syncURL();
  model = built.model;
  // labs are folded into their lecture's box (ECE 2250 + 2255 = one box); the planner still has both
  ({ nodes, edges } = foldLabs(flowNodes(model), flowEdges(model)));
  // a minor (or second major, certificate) gets its own section under the major's chart
  sections = parts.slice(1).map((p) => ({ key: p.id, label: p.program.name, group: programGroup(entry(p.id) || { type: /minor/i.test(p.program.name) ? 'minor' : '' }), test: (n) => n.prog === p.id }));
  charts.clear();
  layouts.clear();
  layout.scrolled = false;
  graph = chartFor(0);
  buildBoxes();
  layout();
  refresh();
}

// no program chosen yet (a first visit, or after signing out): an empty chart and a "Pick your program" button
function showEmpty() {
  model = null; nodes = null; lastPlan = null; progParts = [];
  $('main').classList.add('empty');
  $('progName').textContent = 'Pick your program';
  $('boxes').innerHTML = '';
  $('edges').innerHTML = '';
  $('legendItems').innerHTML = '';
  $('sems').innerHTML = '';
  $('sum').innerHTML = '<button type="button" class="ok" data-pick>Pick your program</button>';
  renderHypo();
  renderNoAudit();
  renderClasses();
  syncURL();
}
// the address bar names the chosen programs (?p=major,minor), so a bookmark or shared link keeps them
function syncURL() {
  try { history.replaceState(history.state, '', urlWithPrograms(location.href, state.plan.programs)); } catch {}
}

// ---------- flowchart ----------
// Box positions and arrow routes come from js/layout.js (flowChart) in pixels. A laptop gets the widest
// boxes that still fit the chart's width; a phone gets the widest and scrolls inside the chart area.
const BASE = { boxH: 48, rowH: 58, gapMin: 26, port: 10, near: 8, pad: 12 };
const FITS = [{ boxW: 116, track: 9 }, { boxW: 112, track: 9 }, { boxW: 108, track: 8 }, { boxW: 104, track: 8 }, { boxW: 100, track: 8 }];
let SIZES = { ...BASE, ...FITS[0] };
const charts = new Map();
const layouts = new Map(); // one layout per program, shared by every box size (js/layout.js flowChart)
const chartFor = (k) => charts.get(k) ?? charts.set(k, flowChart(nodes, edges, { ...BASE, ...FITS[k] }, sections, layouts)).get(k);
function pickChart(W) {
  let k = FITS.findIndex((_, i) => chartFor(i).width <= W - 16);
  if (k < 0) k = W >= 700 ? FITS.length - 1 : 0;
  SIZES = { ...BASE, ...FITS[k] };
  graph = chartFor(k);
}

function buildBoxes() {
  const host = $('boxes');
  host.innerHTML = '';
  // "pick N of these" options: one dashed frame with a "Pick N" label around them (placed by layout(),
  // drawn under the boxes), or a small "Pick N" tag on each box when they aren't next to each other
  for (const g of model.units.filter((u) => u.kind === 'choice' && u.showOptions)) {
    const f = document.createElement('div');
    f.className = 'pickgrp';
    f.dataset.grp = g.id;
    f.hidden = true;
    f.innerHTML = `<em>${esc(pickLabel(g.pick))}</em>`;
    host.appendChild(f);
  }
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
    if (n.kind === 'option') { const g = unitOf(n.group); b.insertAdjacentHTML('beforeend', `<em class="ptag">${esc(pickLabel(g?.pick))}</em>`); }
    // a Gen Ed box with a class list: the class taken (line 2) and a small list button on its bottom edge
    if (flex && listOf(n)) {
      b.classList.add('has-list');
      b.insertAdjacentHTML('beforeend', '<i class="pk"></i><span class="gl" role="button" aria-label="Class list" title="Class list"><svg viewBox="0 0 12 10" width="11" height="9" aria-hidden="true"><path d="M1 1.5h10M1 5h10M1 8.5h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span>');
    }
    b.addEventListener('click', (e) => {
      if (pressed.fired) { pressed.fired = false; return; } // a long press opened the class sheet
      if (e.target.closest('.gl')) openGenEd(n); else toggle(n, b);
    });
    longPress(b, () => openClass({ node: n }));
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
const unitOf = (id) => model?.units.find((u) => u.id === id);

// zoom (phone): the chart can be shrunk to fit the screen (Fit button or pinch); 1 = full size
const zoom = { mode: null, k: 1, fitK: 1 };
function layout() {
  const chart = $('chart');
  const W = chart.clientWidth, H = chart.clientHeight;
  if (!W || !H || !nodes) return;
  pickChart(W);
  const g = graph;
  // whole chart on screen; a phone starts there when that still leaves boxes readable (>= 50%)
  zoom.fitK = Math.min(1, (W - 8) / g.width, (H - 8) / g.height);
  if (zoom.mode === null) zoom.mode = W < 700 && zoom.fitK < 1 && zoom.fitK >= 0.5 ? 'fit' : 'full';
  const k = zoom.mode === 'fit' ? zoom.fitK : zoom.mode === 'free' ? Math.max(zoom.fitK, Math.min(1.5, zoom.k)) : 1;
  zoom.k = k;
  const fitBtn = $('fitBtn');
  fitBtn.hidden = zoom.fitK >= 0.999;
  fitBtn.setAttribute('aria-pressed', k < 0.999);
  const dx = Math.max(0, Math.round((W / k - g.width) / 2));
  const totalW = Math.max(W / k, Math.ceil(g.width)), totalH = Math.max(H / k, Math.ceil(g.height));
  const frames = [];
  for (const el of $('boxes').children) {
    if (el.dataset.sec) {
      const h = g.heads.find((x) => x.key === el.dataset.sec);
      el.hidden = !h;
      if (h) el.style.cssText = `left:${SIZES.pad + dx}px;top:${h.top}px;width:${Math.ceil(g.width) - 2 * SIZES.pad}px`;
      continue;
    }
    if (el.dataset.grp) { frames.push(el); continue; }
    if (!el.dataset.id) continue;
    const r = g.boxes.get(el.dataset.id);
    Object.assign(el.style, { left: `${r.x + dx}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }); // (keeps --gh)
  }
  // a "pick N" group gets one frame when its boxes sit one under another with nothing else between
  const others = [...g.boxes.entries()];
  for (const f of frames) {
    const ids = nodes.filter((n) => n.group === f.dataset.grp).map((n) => n.id);
    const rs = ids.map((id) => g.boxes.get(id)).filter(Boolean).sort((a, b) => a.y - b.y);
    let ok = rs.length > 1 && rs.every((r) => Math.abs(r.x - rs[0].x) < 1);
    for (let i = 1; ok && i < rs.length; i++) ok = rs[i].y - (rs[i - 1].y + rs[i - 1].h) <= SIZES.rowH - SIZES.boxH + 2;
    const box = ok && { x: rs[0].x - 5, y: rs[0].y - 9, w: rs[0].w + 10, h: rs[rs.length - 1].y + rs[rs.length - 1].h - rs[0].y + 14 };
    if (box) ok = !others.some(([id, r]) => !ids.includes(id) && r.x < box.x + box.w && r.x + r.w > box.x && r.y < box.y + box.h && r.y + r.h > box.y);
    f.hidden = !ok;
    if (ok) f.style.cssText = `left:${box.x + dx}px;top:${box.y}px;width:${box.w}px;height:${box.h}px`;
    for (const id of ids) $('boxes').querySelector(`.box[data-id="${CSS.escape(id)}"]`)?.classList.toggle('in-grp', ok);
  }
  const svg = $('edges');
  svg.setAttribute('width', totalW); svg.setAttribute('height', totalH);
  const scale = k === 1 ? '' : `transform:scale(${k});`;
  $('boxes').style.cssText = `width:${totalW}px;height:${totalH}px;${scale}`;
  svg.style.cssText = scale;
  // first time on a small screen: start scrolled to the first column's boxes, not empty space
  if (!layout.scrolled && g.width * k > W) {
    layout.scrolled = true;
    const first = [...g.boxes.values()].filter((r) => r.x <= SIZES.pad + 1).map((r) => r.y);
    if (first.length) chart.scrollTop = Math.max(0, Math.min(...first) - 16) * k;
  }
  const d = (pts) => 'M' + pts.map(([x, y]) => `${+(x + dx).toFixed(1)},${+y.toFixed(1)}`).join('L');
  svg.innerHTML = '<defs><marker id="ah" viewBox="0 0 6 6" refX="6" refY="3" markerWidth="6" markerHeight="6" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0L6,3L0,6z"/></marker></defs>'
    + g.edges.map((e) => `<path data-from="${esc(e.from)}" data-to="${esc(e.to)}"${e.or ? ' class="or"' : ''} marker-end="url(#ah)" d="${d(e.pts)}"/>`).join('');
}

// Fit button (shown when the chart is bigger than the screen) + two-finger pinch on the chart only
function wireZoom() {
  const chart = $('chart');
  $('fitBtn').addEventListener('click', () => {
    const was = zoom.k;
    zoom.mode = zoom.k < 0.999 ? 'full' : 'fit';
    layout();
    // keep the middle of the view in the middle
    chart.scrollLeft = Math.max(0, (chart.scrollLeft + chart.clientWidth / 2) * (zoom.k / was) - chart.clientWidth / 2);
    chart.scrollTop = Math.max(0, (chart.scrollTop + chart.clientHeight / 2) * (zoom.k / was) - chart.clientHeight / 2);
  });
  let pinch = null;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  chart.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return;
    pressed.cancel();
    const r = chart.getBoundingClientRect();
    const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
    pinch = { d0: dist(e.touches), k0: zoom.k, mx, my, cx: (chart.scrollLeft + mx) / zoom.k, cy: (chart.scrollTop + my) / zoom.k };
  }, { passive: true });
  chart.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    zoom.mode = 'free';
    zoom.k = pinch.k0 * dist(e.touches) / pinch.d0;
    layout();
    chart.scrollLeft = pinch.cx * zoom.k - pinch.mx;
    chart.scrollTop = pinch.cy * zoom.k - pinch.my;
  }, { passive: false });
  chart.addEventListener('touchend', (e) => { if (e.touches.length < 2) pinch = null; });
  for (const ev of ['gesturestart', 'gesturechange']) chart.addEventListener(ev, (e) => e.preventDefault()); // iOS: no page zoom from the chart
}

// press and hold (or right-click) a box: its class sheet; the tap that ends a hold doesn't toggle it
const pressed = { timer: 0, fired: false, x: 0, y: 0, cancel() { clearTimeout(pressed.timer); pressed.timer = 0; } };
function longPress(el, fn) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    pressed.cancel();
    pressed.fired = false;
    pressed.x = e.clientX; pressed.y = e.clientY;
    pressed.timer = setTimeout(() => { pressed.timer = 0; pressed.fired = true; fn(); }, 480);
  });
  el.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 8) pressed.cancel(); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, () => pressed.cancel());
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); pressed.cancel(); if (!pressed.fired) fn(); });
}

function nodeDone(n, completed) {
  const labsDone = (n.labs || []).every((l) => unitDone(l, completed));
  if (n.kind === 'option') return labsDone && unitDone(n, completed);
  return labsDone && unitDone(n, completed);
}
// the keys a box puts in the taken set
const keysOf = (n) => (n.kind === 'course' || n.kind === 'option' ? [n, ...(n.labs || [])].flatMap((u) => u.codes) : [n.id]);

function toggle(n, el) {
  const s = tapSet();
  if (nodeDone(n, s)) {
    // untake it (and its folded lab, and an "or" alternative), then everything tapped that needed it.
    // Hypothetical only: an actual class is hidden, not deleted, and keeps its grade; actual classes that
    // needed it stay (the audit is the truth)
    // a pick-one box (American Institutions) can be filled by a class code from the audit: clear those too
    const keys = n.kind === 'choice' ? [n.id, ...(n.options || []).flatMap((o) => [...(o.codes || []), ...(o.alts || [])])] : keysOf(n);
    keys.push(...pickKeysOf(s, n.id)); // the class picked from its Gen Ed list
    for (const k of keys) s.delete(k);
    setDone(cascadeUntake(model, s, actualSet()));
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
  const r = el.getBoundingClientRect(), host = $('boxes').getBoundingClientRect(), k = zoom.k;
  const below = (r.bottom - host.top) / k + 4;
  note.style.left = `${Math.max(4, (r.left - host.left) / k)}px`;
  note.style.top = `${below + 26 / k > $('boxes').offsetHeight ? (r.top - host.top) / k - 26 / k : below}px`;
  note.style.transform = k === 1 ? '' : `scale(${1 / k})`;
  note.classList.add('on');
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => note.classList.remove('on'), 2200);
}

// ---------- refresh states + plan ----------
function refresh() {
  if (!model) return;
  const completed = doneSet();
  const grades = gradeMap();
  const showGrades = !!state.settings.grades;
  const plan = makePlan(model, completed, planOpts());
  // which semester each unit is planned in (a choice group: its first chunk)
  const semOf = new Map();
  plan.semesters.forEach((s, i) => s.items.forEach((it) => { if (!semOf.has(it.unitId)) semOf.set(it.unitId, i); }));
  let anyIP = false;
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
    // in progress: its own look (and an IP tag even with grades off); otherwise the grade, when on
    const g = done ? boxGrade(n, completed, grades) : '';
    const ip = statusOf(g) === 'ip';
    anyIP ||= ip;
    el.classList.toggle('ip', ip);
    const gi = gradeInfo(ip || showGrades ? g : '');
    el.classList.toggle('graded', gi.kind === 'letter');
    el.style.setProperty('--gh', gi.hue ?? 0);
    el.querySelector('.gr').textContent = gi.text;
    const pk = el.querySelector('.pk');
    if (pk) pk.textContent = done ? classOfBox(n, completed) || '' : '';
    el.setAttribute('aria-pressed', done);
  }
  renderPlan(plan);
  renderLegend(plan, anyIP);
  lastPlan = plan;
  renderHypo();
  renderNoAudit();
  if (ui.sub === 'classes') renderClasses();
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
  openDlg($('geDlg'));
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
    const n = geNode, s = tapSet();
    const c = listOf(n).groups.flatMap((g) => g.courses).find((x) => x.code === b.dataset.code);
    if (!c) return;
    const el = $('boxes').querySelector(`.box[data-id="${CSS.escape(n.id)}"]`);
    if (n.kind === 'choice') {
      if (optionDone({ codes: c.codes, alts: [] }, s)) {
        // tap a taken option again: untake it (and what needed it); hypothetical, grades kept
        for (const k of c.codes) s.delete(k);
        setDone(cascadeUntake(model, s, actualSet()));
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

// the student's chosen tracks for this major ({ group id: track }); the planner uses them when it can
const chosenTracks = () => state.settings.tracks?.[major()] || {};
const planOpts = () => ({ maxCredits: state.settings.max, summers: state.settings.summers, start: startTerm(), track: chosenTracks(), tracks: chosenTracks(), grades: gradeMap() });
const parseTerm = (s) => { const [season, year] = String(s || '').split(' '); return year ? { season, year: +year } : null; };
// first planned semester: the chosen Start, but never the semester in session (or one the imported audit
// already shows classes in); a saved Start that has slipped into the past moves up on its own
const earliest = () => earliestStart({ summers: state.settings.summers, lastTerm: parseTerm(state.settings.lastTerm) });
function startTerm() {
  return planStart(parseTerm(state.settings.start), { summers: state.settings.summers, lastTerm: parseTerm(state.settings.lastTerm) });
}

const shortTerm = (t) => { const [season, year] = t.split(' '); return `${season.slice(0, 2)} ${String(year).slice(2)}`; };
function renderLegend(plan, anyIP) {
  $('legendItems').innerHTML = '<span class="sw done"></span>Taken' + (anyIP ? '<span class="sw ip"></span>Current' : '')
    + plan.semesters.map((s, i) => `<span class="sw s${i % 10}"></span>${shortTerm(s.term)}`).join('');
}

function renderPlan(plan) {
  const n = plan.semesters.length;
  const first = progParts[0]?.program || model.program;
  // needs program admission: the planner found an Apply step still ahead (gated classes, the page's
  // admission section), or the program is flagged as admission-only
  const gated = plan.admission ? !plan.admission.admitted : !!first.admission;
  const tracks = model.units.filter((u) => u.kind === 'choice' && tracksOf(u).length > 1);
  const completed = doneSet();
  $('sum').innerHTML = (plan.graduation
    ? `<b>Graduate ${plan.graduation}</b><span>${plan.creditsLeft} credits · ${n} semester${n === 1 ? '' : 's'}</span>`
    : `<b>All done</b>`)
    + `<p class="caveat">Unofficial plan — confirm with your advisor. <a href="${esc(issueURL(progIssue()))}" target="_blank" rel="noopener" id="sumReport">Report a mistake</a></p>`
    + (gated ? '<p class="adm">Requires admission — apply after these classes.</p>' : '')
    // bachelor's totals (120 credits, 40 upper-division) and classes a major and minor share
    + (plan.checks || []).map((c) => `<p class="adm">${esc(c)}</p>`).join('')
    + (() => {
      if (progParts.length < 2) return '';
      const both = [...new Set([...(model.program.shared || []).map((x) => x.code), ...plan.semesters.flatMap((s) => s.items.filter((it) => it.shared).map((it) => it.code))])];
      return both.length ? `<p>Counted once for both: ${esc(both.join(', '))}</p>` : '';
    })()
    + tracks.map((g) => {
      const mine = chosenTracks()[g.id];
      const t = mine && tracksOf(g).includes(mine) ? mine : (P.pickTrack ? P.pickTrack(g, completed) : null) || tracksOf(g)[0];
      return `<button type="button" class="chip" data-track="${esc(g.id)}" title="${esc(g.label)}"><span>${esc(shortName(t, 34))}</span>${mine ? '' : '<em>Guessed — pick yours</em>'}</button>`;
    }).join('');
  // admission programs: an "Apply" row before the program's semesters; an "Advanced Standing" row before the
  // first term the planner counts University Advanced Standing as reached (js/phases.js planPhases)
  let phases = null;
  try { phases = P.planPhases ? P.planPhases(plan) : null; } catch { phases = null; }
  const stones = milestonesOf(plan, phases);
  const milestone = (it) => it.kind === 'apply' || it.kind === 'milestone';
  if (!stones.length) { const at = plan.semesters.findIndex((s, i) => i > 0 && s.items.some(milestone)); if (at > 0) stones.push({ at, gate: 'admission' }); }
  const STONE = { admission: 'Apply', 'advanced-standing': 'Advanced Standing' };
  const rowsAt = (i) => stones.filter((m) => m.at === i).map((m) => `<div class="apply" data-gate="${esc(m.gate)}"><span>${STONE[m.gate] || esc(m.gate)}</span></div>`).join('');
  $('sems').innerHTML = plan.semesters.map((s, i) => rowsAt(i) + `
    <div class="sem s${i % 10}"><h3>${s.term}<span>${s.credits}</span></h3><ul>${s.items.filter((it) => !milestone(it)).map((it) =>
      `<li class="${it.kind === 'course' ? '' : 'ph'}" data-unit="${esc(it.unitId)}" data-sem="${i}" data-item="${esc(it.id)}" title="${esc([it.label, it.title].filter(Boolean).join(' · '))}"><span>${esc(it.label)}</span><span>${it.credits}</span></li>`).join('')}</ul></div>`).join('')
    + plan.warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join('');
}
// the program-level "Report a mistake" issue
function progIssue(extra = {}) {
  const p = progParts[0];
  return { program: progParts.map((x) => x.program.name).join(' + '), programId: progParts.map((x) => x.id).join('+'), year: p?.year || p?.program.catalogYear || '', ...extra };
}

// ---------- Hypothetical | Actual (header): shown once a tap changed anything ----------
function renderHypo() {
  const on = !!model && hasHypo(hypoOf());
  if (!on) ui.view = 'hypo';
  $('hyp').hidden = !on;
  document.querySelector('.top').classList.toggle('hyp-on', on);
  for (const b of $('hypSeg').children) b.classList.toggle('on', b.dataset.v === ui.view);
}
function wireHypo() {
  $('hypSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b || b.dataset.v === ui.view) return;
    ui.view = b.dataset.v;
    refresh();
  });
  // clear every tap (the actual classes stay), with Undo
  $('hypClear').addEventListener('click', () => {
    const snap = hypoOf();
    setHypo({ add: [], del: [] });
    save(); refresh();
    toast('Hypothetical cleared', () => { setHypo(snap); save(); refresh(); });
  });
}

// ---------- "No audit loaded — Upload or Sign in": so missing grades never look like a bug ----------
// An audit counts as loaded when a class came from one (settings.src), the import saved its catalog year,
// or (imported before sources were kept) the major has grades but no sources at all.
function hasAudit() {
  const src = state.settings.src?.[major()];
  if (src && Object.values(src).includes('audit')) return true;
  if (state.audit?.[major()]) return true;
  return !src && Object.keys(state.grades[major()] || {}).length > 0;
}
function renderNoAudit() {
  const show = !!model && !hasAudit();
  const signedIn = $('profile').classList.contains('in');
  for (const el of document.querySelectorAll('[data-noaud]')) {
    el.hidden = !show;
    el.querySelector('[data-signin]').hidden = signedIn;
  }
}
function wireNoAudit() {
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-upload]')) $('importBtn').click();
    else if (e.target.closest('[data-signin-btn]')) $('profile').click();
  });  new MutationObserver(renderNoAudit).observe($('profile'), { attributes: true, attributeFilter: ['class'] }); // signed in / out
}

// ---------- Classes (the Plan panel's second view): every class for the chosen programs, grouped ----------
// Taken / AP/CE / Current / Still need / Not used by your plan (js/classes.js classGroups), a GPA line, and
// "+ Add class" (search the catalog, Taken or Current, a grade). Added classes are actual; they apply to the
// flowchart and plan like the audit's.
const courseCat = { map: {}, list: [], ready: null };
function loadCourses() {
  courseCat.ready ??= getJSON(`${DATA}/courses.json`).then((all) => {
    const map = {};
    for (const [code, c] of Object.entries(all || {})) if (c?.title) map[code] = { title: c.title, credits: c.credits ?? null };
    for (const a of gened?.areas || []) for (const c of a.courses || []) map[c.code] ??= { title: c.title, credits: c.credits ?? null };
    for (const [code, c] of Object.entries(model?.program.courses || {})) map[code] ??= { title: c.title || '', credits: c.credits ?? null };
    courseCat.map = map;
    courseCat.list = Object.entries(map).sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }));
    if (!all) courseCat.ready = null; // try again next time
  });
  return courseCat.ready;
}
function setSub(v, push = true) {
  if (push && v !== ui.sub) pushNav({ sub: v });
  ui.sub = v;
  $('planPanel').dataset.sub = v;
  for (const b of $('planSeg').children) b.classList.toggle('on', b.dataset.v === v);
  if (v === 'classes') renderClasses();
}
let clRows = [];
function gradeBadge(g) {
  const gi = gradeInfo(g);
  if (gi.kind === 'letter') return `<em class="gb" style="--gh:${gi.hue}">${esc(gi.text)}</em>`;
  return `<em class="gb${gi.text ? ' mark' : ''}">${esc(gi.text)}</em>`;
}
function renderClasses() {
  if (!model || !lastPlan) { $('clList').innerHTML = ''; $('clGpa').innerHTML = ''; return; }
  if (!courseCat.ready) loadCourses().then(() => { if (ui.sub === 'classes') renderClasses(); });
  const order = new Map();
  lastPlan.semesters.forEach((s, i) => s.items.forEach((it) => { if (!order.has(it.unitId)) order.set(it.unitId, i); }));
  const groups = classGroups({ model, completed: doneSet(), actual: actualSet(), grades: gradeMap(), src: state.settings.src?.[major()] || {},
    catalog: courseCat.map, order, when: (i) => shortTerm(lastPlan.semesters[i].term) });
  const g = gpa(groups.filter((x) => x.key !== 'need').flatMap((x) => x.rows));
  $('clGpa').innerHTML = g.gpa == null ? '<b>GPA —</b><span>No grades yet</span>' : `<b>GPA ${g.gpa.toFixed(2)}</b><span>${g.credits} graded cr</span>`;
  clRows = [];
  $('clList').innerHTML = groups.filter((x) => x.rows.length).map((x) => `<li class="cl-h">${esc(x.label)}<span>${x.rows.length}</span></li>`
    + x.rows.map((r) => {
      const i = clRows.push({ ...r, group: x.key }) - 1;
      const right = x.key === 'need' ? `<em class="when">${esc(r.when || '')}</em>` : gradeBadge(r.grade);
      return `<li><button type="button" class="cl-row${r.src === 'tap' ? ' tap' : ''}" data-r="${i}"><b>${esc(r.label)}</b><span>${esc(r.title)}</span>`
        + `${r.src === 'tap' ? '<i>Tapped</i>' : ''}<em class="cr">${r.credits ?? ''}</em>${right}</button></li>`;
    }).join('')).join('') || '<li class="none">No classes</li>';
}
// the requirement behind a "Still need" row -> its class sheet (a box on the chart, else the requirement)
function openNeed(r) {
  const n = nodes.find((x) => x.id === r.unit);
  if (n) { openClass({ node: n }); return; }
  const u = unitOf(r.unit);
  if (u) openClass({ item: { unitId: u.id, kind: u.kind, code: u.kind === 'course' ? u.code : null, label: u.label, title: u.title, credits: r.credits } });
}
const inProgram = (code) => !!model.byCode[code] || model.units.some((u) => u.kind === 'choice' && u.options.some((o) => [...o.codes, ...(o.alts || [])].includes(code)));
// add a class to the actual list (an outside Gen Ed class also fills an open Gen Ed box whose list has it)
function addClass(code, status, grade) {
  const s = actualSet(), src = srcMap(), grades = gradeMap();
  if (!s.has(code) && !inProgram(code)) {
    const box = geBoxFor(code, model.units.filter((u) => u.kind === 'placeholder'), listOf, viewSet(s, null, 'hypo'));
    if (box) { s.add(box); s.add(`${box}=${code}`); src[box] = 'added'; }
  }
  if (!s.has(code)) src[code] = 'added';
  s.add(code);
  grades[code] = status === 'ip' ? 'IP' : grade || '';
  setActual(s);
  refresh();
}
// remove a class: a tapped one is untapped (hypothetical); an actual one leaves the list (Undo for a few seconds)
function removeClass(r) {
  const boxOf = (s) => [...s].filter((k) => k.endsWith(`=${r.code}`)).map((k) => k.split('=')[0]);
  if (r.src === 'tap') {
    const s = tapSet();
    for (const k of [r.key, r.code, ...pickKeysOf(s, r.key)].filter(Boolean)) s.delete(k);
    setDone(cascadeUntake(model, s, actualSet()));
    refresh();
    return;
  }
  const snap = { done: [...(state.done[major()] || [])], src: { ...(state.settings.src?.[major()] || {}) } };
  const s = actualSet(), src = srcMap();
  const boxes = r.key !== r.code ? [r.key] : r.code ? boxOf(s) : [];
  for (const k of [r.key, r.code, ...boxes, ...boxes.flatMap((b) => pickKeysOf(s, b))].filter(Boolean)) { s.delete(k); delete src[k]; }
  setActual(s);
  refresh();
  toast(`${r.label} removed`, () => { state.done[major()] = snap.done; state.settings.src = { ...(state.settings.src || {}), [major()]: snap.src }; save(); refresh(); });
}
// the Add / edit sheet: search (add) -> Taken | Current + grade
const ed = { mode: 'add', code: null, row: null, status: 'taken' };
function edStep(step) {
  $('editDlg').dataset.step = step;
  $('edFind').hidden = step !== 'find';
  $('edForm').hidden = step !== 'form';
  $('edRemove').hidden = step === 'find';
  $('edRemove').textContent = ed.mode === 'add' ? 'Back' : 'Remove';
  $('edSave').textContent = step === 'form' && ed.mode === 'add' ? 'Add' : 'Done';
}
function edForm(code, title, status, grade) {
  $('edCode').textContent = code;
  $('edTitle').textContent = title || '';
  ed.status = status;
  for (const b of $('edSeg').children) b.classList.toggle('on', b.dataset.s === status);
  $('edGrade').innerHTML = gradeOptions(status === 'ip' ? '' : grade).replace(/<option value="IP"[^>]*>[^<]*<\/option>/, '');
  $('edGradeRow').hidden = status === 'ip';
}
function edList() {
  const words = $('edQ').value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const have = doneSet();
  const rows = [];
  for (const [code, c] of courseCat.list) {
    if (have.has(code)) continue;
    const hay = `${code} ${code.replace(/\s+/g, '')} ${c.title}`.toLowerCase();
    if (words.length && !words.every((w) => hay.includes(w))) continue;
    rows.push([code, c.title]);
    if (rows.length >= 80) break;
  }
  $('edList').innerHTML = rows.length
    ? rows.map(([code, title]) => `<li><button type="button" data-code="${esc(code)}"><b>${esc(code)}</b><span>${esc(title)}</span></button></li>`).join('')
    : `<li class="none">${courseCat.list.length ? 'No match' : 'Loading…'}</li>`;
}
async function openAddClass() {
  Object.assign(ed, { mode: 'add', code: null, row: null });
  $('edQ').value = '';
  edStep('find');
  openDlg($('editDlg'));
  edList();
  if (matchMedia('(hover: hover)').matches) $('edQ').focus();
  await loadCourses();
  if ($('editDlg').open && $('editDlg').dataset.step === 'find') edList();
}
function openEditClass(r) {
  Object.assign(ed, { mode: 'edit', code: r.code || r.key, row: r });
  edForm(r.code ? r.label : r.label, r.title, statusOf(r.grade) === 'ip' ? 'ip' : 'taken', r.grade);
  edStep('form');
  openDlg($('editDlg'));
}
function wireClasses() {
  $('planSeg').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) setSub(b.dataset.v); });
  $('clAdd').addEventListener('click', openAddClass);
  $('clList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-r]');
    const r = b && clRows[+b.dataset.r];
    if (!r) return;
    if (r.group === 'need') openNeed(r); else openEditClass(r);
  });
  const dlg = $('editDlg');
  $('edQ').addEventListener('input', () => { edList(); $('edList').scrollTop = 0; });
  $('edList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-code]');
    if (!b) return;
    ed.code = b.dataset.code;
    edForm(ed.code, courseCat.map[ed.code]?.title, 'taken', '');
    edStep('form');
  });
  // Taken | Current, and the grade: an edit saves at once; an add waits for Add
  const apply = () => {
    if (ed.mode !== 'edit') return;
    gradeMap()[ed.code] = ed.status === 'ip' ? 'IP' : $('edGrade').value;
    save(); refresh();
  };
  $('edSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-s]');
    if (!b) return;
    edForm($('edCode').textContent, $('edTitle').textContent, b.dataset.s, ed.mode === 'edit' ? gradeMap()[ed.code] : $('edGrade').value);
    apply();
  });
  $('edGrade').addEventListener('change', apply);
  $('edSave').addEventListener('click', () => {
    if (ed.mode === 'add' && dlg.dataset.step === 'form' && ed.code) addClass(ed.code, ed.status, $('edGrade').value);
    dlg.close();
  });
  $('edRemove').addEventListener('click', () => {
    if (ed.mode === 'add') { edStep('find'); return; }
    dlg.close();
    removeClass(ed.row);
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
}

// ---------- tabs + settings ----------
// phone: bottom tabs Flowchart / Plan / Schedule; laptop: Flowchart / Schedule in the header (the plan stays beside it)
function setTab(tab, push = true) {
  if (push && tab !== $('main').dataset.tab) pushNav({ tab });
  $('main').dataset.tab = tab;
  for (const x of $('tabs').children) x.classList.toggle('on', x.dataset.tab === tab);
  for (const x of $('wtabs').children) x.classList.toggle('on', x.dataset.tab === (tab === 'sched' ? 'sched' : 'flow'));
  if (tab === 'flow' || tab === 'plan') layout();
  if (tab === 'sched') renderSched();
}
function wireTabs() {
  for (const b of [...$('tabs').children, ...$('wtabs').children]) b.addEventListener('click', () => setTab(b.dataset.tab));
}

// ---------- back button: tabs and sheets are history entries, so Back goes where you just were ----------
// Each entry is { tab, dlg? }. Opening a sheet pushes one; closing it (Done, Esc, outside tap) steps back
// over it; Back closes the sheet or returns to the previous tab. A sheet opened right as another closes
// (Settings -> Import audit) takes over that one's entry.
const NAV = { pending: 0, queued: null, kbd: false };
function pushNav(st) {
  const entry = { sa: 1, tab: $('main').dataset.tab, sub: ui.sub, ...st };
  if (NAV.pending) NAV.queued = entry; else history.pushState(entry, '', location.href);
}
function openDlg(dlg) {
  if (!dlg.open) dlg.showModal();
  if (!NAV.kbd) document.activeElement?.blur(); // a focus ring only for keyboard users (:focus-visible)
  const cur = history.state?.dlg;
  if (cur === dlg.id) return;
  if (cur && !NAV.pending) history.replaceState({ sa: 1, tab: $('main').dataset.tab, sub: ui.sub, dlg: dlg.id }, '', location.href);
  else pushNav({ dlg: dlg.id });
}
function wireNav() {
  history.replaceState({ sa: 1, tab: $('main').dataset.tab }, '', location.href);
  addEventListener('keydown', () => { NAV.kbd = true; }, true);
  addEventListener('pointerdown', () => { NAV.kbd = false; }, true);
  for (const d of document.querySelectorAll('dialog')) {
    d.addEventListener('close', () => {
      if (history.state?.dlg !== d.id) return;
      NAV.pending++;
      history.back();
    });
  }
  addEventListener('popstate', (e) => {
    if (NAV.pending) {
      NAV.pending--;
      if (!NAV.pending && NAV.queued) { history.pushState(NAV.queued, '', location.href); NAV.queued = null; }
      return;
    }
    const st = e.state || {};
    for (const d of document.querySelectorAll('dialog[open]')) if (d.id !== st.dlg) d.close();
    const tab = st.tab || 'flow';
    if (tab !== $('main').dataset.tab) setTab(tab, false);
    if ((st.sub || 'plan') !== ui.sub) setSub(st.sub || 'plan', false);
    if (st.dlg && !$(st.dlg)?.open) history.replaceState({ sa: 1, tab, sub: ui.sub }, '', location.href); // forward into a closed sheet
    if (model) syncURL();
  });
  // the account sheet (js/account.js opens it): an entry too
  $('profile').addEventListener('click', () => setTimeout(() => { if ($('acct').open) openDlg($('acct')); }));
  // "Pick your program" buttons (first visit)
  document.addEventListener('click', (e) => { if (e.target.closest('[data-pick]')) $('progName').click(); });
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
  $('gear').addEventListener('click', () => { fill(); openDlg(dlg); }); // no focus ring on Start
  $('setStart').addEventListener('change', (e) => { state.settings.start = e.target.value; save(); refresh(); });
  $('setMax').addEventListener('change', (e) => { state.settings.max = +e.target.value; save(); refresh(); });
  $('setSummer').addEventListener('change', (e) => { state.settings.summers = e.target.checked; save(); fill(); refresh(); });
  // Clear taken: a second tap clears (the button asks first), then "Cleared · Undo" for a few seconds.
  // lastTerm becomes null, not deleted, so the account's copy (and other devices) clear it too
  const clr = $('clearDone');
  const arm = (on) => { clr.dataset.armed = on ? '1' : ''; clr.textContent = on ? 'Tap again to clear' : 'Clear taken'; clearTimeout(arm.t); if (on) arm.t = setTimeout(() => arm(false), 4000); };
  clr.addEventListener('click', () => {
    if (!clr.dataset.armed) { arm(true); return; }
    arm(false);
    const snap = clearTaken(state, major());
    save(); refresh();
    dlg.close();
    toast('Taken classes cleared', () => { undoClear(state, snap); save(); refresh(); });
  });
  dlg.addEventListener('close', () => arm(false));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
}

// a short message above the tabs with an optional Undo (gone after 6 s)
function toast(text, undo) {
  const t = $('toast');
  $('toastText').textContent = text;
  $('toastUndo').hidden = !undo;
  $('toastUndo').onclick = () => { hide(); undo?.(); };
  t.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(hide, 6000);
  function hide() { clearTimeout(toast.t); t.classList.remove('on'); }
}

// ---------- class sheet: hold a box or tap a plan row -> what it is, why it's here, how to check it ----------
// Uses whatever the data has: title, credits, prereq text, grade minimum (minGrade), the requirement it
// fills (planner requirementFor, or the requirement's src / name), the catalog page.
let clsNode = null;
const PRE = { prereqText: 'Before', precoreqText: 'Before or with', coreqText: 'With' };
function reqOf(u) {
  if (!u) return null;
  const g = u.kind === 'option' ? unitOf(u.group) : u;
  return model.program.requirements[Math.floor(g?.order ?? -1)] || null;
}
function openClass({ node, item }) {
  if (!model) return;
  const u = node ? (node.kind === 'option' ? node : unitOf(node.id) || node) : unitOf(item.unitId) || model.units.flatMap((x) => x.options || []).find((o) => o.id === item.unitId);
  if (!u && !item) return;
  const kind = item?.kind || u.kind;
  const code = item?.code || (u?.kind === 'course' || u?.kind === 'option' ? u.code : null);
  const c = (code && model.program.courses?.[code]) || {};
  const g = u?.kind === 'option' ? unitOf(u.group) : u?.kind === 'choice' ? u : null;
  const req = reqOf(u);
  const opt = code && req?.options ? req.options.find((o) => o.codes?.includes(code)) : null;
  const part = progParts.find((p) => p.id === (u?.prog || progParts[0]?.id)) || progParts[0];
  $('clsCode').textContent = code || item?.label || u.label;
  $('clsTitle').textContent = code ? (c.title || u?.title || item?.title || '') : (item?.title || u?.title || '');
  const rows = [];
  const credits = item?.credits ?? (u?.kind === 'choice' ? (u.pick?.credits ?? u.credits) : u?.credits);
  if (credits != null) rows.push(['Credits', String(credits)]);
  const labs = (node?.labs || u?.labs || []).map((l) => l.label);
  if (labs.length) rows.push(['Lab', labs.join(', ')]);
  if (code) {
    const pre = Object.entries(PRE).filter(([k]) => c[k]).map(([k, label]) => [label, c[k]]);
    if (!pre.length && c.coreqs?.length) pre.push(['With', c.coreqs.join(', ')]);
    // the grade the prerequisites need, when the catalog line states one somewhere the text doesn't show
    const pb = pre.find(([l]) => l === 'Before');
    if (pb && c.prereqMinGrade && !/grade|or higher|or better/i.test(pb[1])) pb[1] += ` (${c.prereqMinGrade} or higher)`;
    // gates (program acceptance, University Advanced Standing): the catalog's own words
    const gl = u?.gates?.[code] || (item?.gate ? [item.gate] : []);
    const needs = needsOf(c, gl);
    rows.push(...(pre.length ? pre : [['Before', needs.length ? 'No classes listed' : 'None listed']]));
    // (not when the Before line already says exactly that and nothing else)
    const same = pb && needs.length === 1 && pb[1].replace(/[\s.,;()]+/g, ' ').trim() === needs[0].replace(/[\s.,;()]+/g, ' ').trim();
    if (needs.length && !same) rows.push(['Needs', needs.join(' · ')]);
  }
  const min = opt?.minGrade ?? req?.minGrade ?? c.minGrade;
  if (min) rows.push(['Grade', `${min} or higher`]);
  // why it's here: the planner's answer, else the catalog text, else the requirement's name
  let why = null;
  try { why = P.requirementFor ? P.requirementFor(model, code || u?.id) : null; } catch { why = null; }
  const src = opt?.src || req?.src || null;
  const whyText = typeof why === 'string' ? why : why?.why || why?.name || why?.label
    || src
    || [g ? `${g.label} · ${pickLabel(g.pick)}` : kind === 'placeholder' ? u?.label : null, req?.area].filter(Boolean).join(' — ');
  if (whyText) rows.push(['Why', whyText + (part && progParts.length > 1 ? ` (${part.program.name})` : '')]);
  // the catalog lines this requirement came from
  if (src && src !== whyText) rows.push(['Catalog', src]);
  if (kind !== 'course' && kind !== 'option' && g?.options?.length) rows.push(['Options', g.options.slice(0, 12).map((o) => o.label).join(', ') + (g.options.length > 12 ? ` +${g.options.length - 12} more` : '')]);
  else if (kind === 'placeholder' && u?.title) rows.push(['Note', u.title]);
  $('clsFacts').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  $('clsCat').href = code ? courseURL(code) : part?.program.url || 'https://catalog.uvu.edu/';
  $('clsReport').href = issueURL(progIssue({ code: code || u?.label || '', title: code ? c.title || '' : '' }));
  // taken switch: for a class that is a box on the chart
  clsNode = node || nodes.find((x) => x.id === u?.id || x.id === item?.unitId) || null;
  $('clsTakenRow').hidden = !clsNode;
  if (clsNode) $('clsTaken').checked = nodeDone(clsNode, doneSet());
  drawClsGrades();
  openDlg($('clsDlg'));
}
// the classes a taken box stands for, each with its own grade (lecture + its folded lab; a pick-one box's
// option; the class picked for a Gen Ed box, else the box)
function gradeCodes(n, s) {
  if (!n || !nodeDone(n, s)) return [];
  if (n.kind === 'course' || n.kind === 'option') return [n, ...(n.labs || [])].map((u) => (u.codes || [u.code]).find((c) => s.has(c)) || u.code).filter(Boolean);
  if (n.kind === 'choice') { const o = (n.options || []).find((x) => optionDone(x, s)); return o ? [...o.codes, ...(o.alts || [])].filter((c) => s.has(c)) : [n.id]; }
  return [pickedOf(s, n.id) || n.id];
}
const gradeOptions = (cur) => [['', '—'], ['IP', 'In progress'], ...GRADES.map((g) => [g, g])]
  .map(([v, t]) => `<option value="${v}"${v === (cur || '') ? ' selected' : ''}>${t}</option>`).join('');
// the class sheet's grade pickers: one per class the box stands for, only once it counts as taken
function drawClsGrades() {
  const codes = gradeCodes(clsNode, doneSet()), grades = gradeMap();
  $('clsGrades').innerHTML = codes.map((c) => `<label>Grade${codes.length > 1 ? ` <small>${esc(c)}</small>` : ''}<select data-code="${esc(c)}">${gradeOptions(grades[c] ?? (codes.length === 1 && clsNode ? grades[clsNode.id] : ''))}</select></label>`).join('');
}
function wireClassSheet() {
  const dlg = $('clsDlg');
  $('sems').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-item]');
    if (!li || !lastPlan) return;
    const it = lastPlan.semesters[+li.dataset.sem]?.items.find((x) => x.id === li.dataset.item);
    if (it) openClass({ item: it });
  });
  // the Taken switch works like tapping the box (a class that still needs prerequisites stays off)
  $('clsTaken').addEventListener('change', () => {
    const n = clsNode, el = n && $('boxes').querySelector(`.box[data-id="${CSS.escape(n.id)}"]`);
    if (!n || !el) return;
    const want = $('clsTaken').checked;
    if (nodeDone(n, doneSet()) !== want) toggle(n, el);
    $('clsTaken').checked = nodeDone(n, doneSet());
    if ($('clsTaken').checked !== want) { dlg.close(); return; } // blocked: the box shows what it needs
    drawClsGrades();
  });
  // a grade (or In progress): saved for that class whatever view it is taken in; never removed by a tap
  $('clsGrades').addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-code]');
    if (!sel) return;
    gradeMap()[sel.dataset.code] = sel.value;
    save(); refresh();
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  // tracks: the chip under the plan summary -> the program's tracks
  $('sum').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-track]');
    if (b) openTracks(b.dataset.track);
  });
  $('trackList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-t]');
    if (!b) return;
    const id = $('trackDlg').dataset.g;
    state.settings.tracks = { ...(state.settings.tracks || {}), [major()]: { ...chosenTracks(), [id]: b.dataset.t } };
    save(); refresh();
    $('trackDlg').close();
  });
  $('trackDlg').addEventListener('click', (e) => { if (e.target === $('trackDlg')) $('trackDlg').close(); });
}
function openTracks(id) {
  const g = unitOf(id);
  if (!g) return;
  const mine = chosenTracks()[id];
  const cur = mine || (P.pickTrack ? P.pickTrack(g, doneSet()) : null);
  $('trackDlg').dataset.g = id;
  $('trackName').textContent = shortName(g.label, 40);
  $('trackList').innerHTML = tracksOf(g).map((t) => `<li><button type="button" data-t="${esc(t)}"${t === cur ? ' class="on" aria-pressed="true"' : ''}>${esc(t)}</button></li>`).join('');
  openDlg($('trackDlg'));
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
  // the term the student is in (or registered for): their real classes (js/mineui.js)
  const isMine = mine.isMine(code);
  $('schedPanel').classList.toggle('mine', isMine);
  if (isMine) { mine.render(code, groups); return; }
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
  }).join('') + '<li class="sc-adds"><button type="button" class="sc-add" id="scAdd">+ Add class</button><button type="button" class="sc-add" data-mine>Add my schedule</button></li>';
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
  openDlg($('secDlg')); // no focus ring on "Best fit" when it opens
  $('secList').scrollTop = 0;
}
let mine = null;
function wireSched() {
  mine = initMine({
    $, esc, openDlg, save, toast, termState, termGroups, sched, drawWeek, ratingBadge, lastName,
    render: () => renderSched(),
    lastTerm: () => state.settings.lastTerm || null,
    planHas: (code) => !!lastPlan?.semesters.find((s) => s.term === termInfo(code).label)?.items.some((it) => it.kind === 'course'),
    // the imported audit's in-progress classes: course rows marked IP, and Gen Ed boxes filled with a class
    ipCodes: () => {
      const g = state.grades[major()] || {}, out = [];
      // (actual classes only: a grade outlives a removed or untapped class, js/classes.js)
      const have = actualSet();
      for (const [k, v] of Object.entries(g)) if (v === 'IP' && have.has(k) && /^[A-Z]{2,5} \d{4}[A-Z]?$/.test(k)) out.push(k);
      for (const k of have) { const m = k.match(/^(.+)=([A-Z]{2,5} \d{4}[A-Z]?)$/); if (m && g[m[1]] === 'IP') out.push(m[2]); }
      return [...new Set(out)];
    },
    subjects: () => getJSON(`${DATA}/sections/index.json`).then((i) => i?.subjects || {}),
  });
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
    if (e.target.closest('[data-mine]')) { mine.open(); return; }
    if ($('schedPanel').classList.contains('mine')) { mine.click(e); return; }
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
    openDlg($('addDlg'));
    $('addList').scrollTop = 0;
    if (matchMedia('(hover: hover)').matches) $('addQ').focus();
  };
  $('addQ').addEventListener('input', () => { list(); $('addList').scrollTop = 0; });
  $('addList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-code]');
    if (!b) return;
    const t = termState(sched.term), code = b.dataset.code;
    if ($('schedPanel').classList.contains('mine')) { $('addDlg').close(); mine.addCode(code); return; }
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
    openDlg(dlg);
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
      + `<span>${esc(r.label)}</span><i>${esc(r.title)}</i>${r.status === 'ip' ? '<em>IP</em>' : ''}${r.low ? `<em title="Below the requirement's minimum grade: the plan takes it again">${esc(r.grade)} · needs ${esc(r.min)}</em>` : ''}</label></li>`).join('');
    syncIP();
  };
  $('impProg').addEventListener('change', () => rematch());
  const syncIP = () => {
    const on = $('impIP').checked;
    for (const cb of $('impList').querySelectorAll('input[data-ip="1"]')) { if (!on) cb.checked = false; else if (!cb.disabled) cb.checked = true; cb.closest('li').classList.toggle('off', !on); }
  };
  $('importBtn').addEventListener('click', () => { $('settings').close(); $('impText').value = ''; $('impFile').value = ''; step(1); openDlg(dlg); });
  $('impIP').addEventListener('change', syncIP);
  $('impBack').addEventListener('click', () => (dlg.dataset.step === '2' ? step(1) : dlg.close()));
  $('impGo').addEventListener('click', () => {
    if (dlg.dataset.step === '1') { if ($('impText').value.trim()) read($('impText').value); return; }
    const t = target();
    const switching = JSON.stringify([t.ids, t.year]) !== planSig();
    if (switching) setPlan(t.ids, t.year);
    // the audit is actual data (never hypothetical)
    const s = actualSet(), src = srcMap(), grades = gradeMap();
    const ipOn = $('impIP').checked;
    // already-taken rows are disabled (can't be unticked) but still bring their grade from the audit
    for (const cb of $('impList').querySelectorAll('input:checked')) {
      const r = found.rows[+cb.dataset.i];
      if (r.status === 'ip' && !ipOn) continue;
      s.add(r.key);
      src[r.key] ??= 'audit';
      if (r.grade || !cb.disabled) grades[r.key] = r.grade || ''; // imported: kept even if its prereqs look unmet
      // a Gen Ed box filled by an outside class: remember which class (its sheet and Classes show it)
      if (r.key !== r.code && !pickKeysOf(s, r.key).length) {
        s.add(`${r.key}=${r.code}`); s.add(r.code); src[r.code] ??= 'audit';
        if (r.grade) grades[r.code] ??= r.grade;
      }
    }
    // classes outside the program (AP/transfer credit, classes the plan doesn't use): kept for Classes
    for (const r of found.others || []) {
      if (r.status === 'ip' && !ipOn) continue;
      if (!s.has(r.code)) { s.add(r.code); src[r.code] = 'audit'; }
      if (r.grade) grades[r.code] = r.grade;
    }
    // classes in progress (or already registered for next term): the plan starts after that semester
    // (set before setActual, which saves)
    if (parsed?.lastTerm) state.settings.lastTerm = termLabel(parsed.lastTerm);
    // in-progress classes fill this term's "my schedule" (Schedule tab) until the student changes it
    if (ipOn && parsed?.inProgress?.length) termState(currentTermCode()).ip = parsed.inProgress.map((r) => r.code);
    setActual(s);
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

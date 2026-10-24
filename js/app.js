import { buildModel, makePlan, flowNodes, flowEdges, unitDone, optionDone, earliestStart, planStart, nextTerm, termLabel, tapCheck, cascadeUntake, currentTerm } from './planner.js';
import { edgeRoles, hintText, placeHint } from './hover.js';
import { genEdList, filterList, pickedOf, withPick, pickKeysOf } from './gened.js';
import { flowChart, foldLabs } from './layout.js';
import { groupNodes, placeGroups, groupProgress, groupList, shortName as groupName } from './groups.js';
import { boxName, reqName, optionCode, shortTitle } from './shortnames.js';
import { parseAudit, matchAudit, gradeInfo } from './audit.js';
import { toDoc, applyDoc } from './sync.js';
import { initAccount } from './account.js';
import { filterPrograms, programGroup, catalogInfo, programYears, programPath, yearFor, combinePrograms, auditPrograms, shortName } from './programs.js';
import { termInfo, defaultTerm, currentTermCode, groupSections, buildSchedules, courseOptions, optionsConflict, meetingsOf, whenOf, fmtTime, rmpHue, DEFAULT_PREFS, splitTerms, classesInTerm, timeRange, whenFull, hourWindow, codeOfLabel } from './schedule.js';
import * as P from './planner.js'; // optional planner extras (planPhases, requirementFor, pickTrack): used only when present
import { initMine } from './mineui.js';
// every outside fact links to its source (Tim, 2026-10-22): build each link with sourceLink(), never by hand
import { sourceLink, linkHTML, sourceLine, programSources, checked, CATALOG } from './sources.js';
import { urlPrograms, programsFromLink, urlWithPrograms, isFirstVisit, clearTaken, undoClear, pickLabel, issueURL, tracksOf, milestonesOf, needsOf, advisorLink, gatedNeed, officialChart } from './uistate.js';
import { viewSet, hypoFrom, normHypo, boxGrade, gpa, classGroups, geBoxFor, statusOf, GRADES } from './classes.js';
import { matricSides, matricFacts, codeStatus } from './matric.js';
import { auditExtras, answerSheet, sheetText, splitName, niceDate } from './application.js';
import { programWithCurrentPrereqs, forCatalogYear } from './curprereqs.js';
import { startTab, programProgress, gradMonth, capName, displayName, catalogShort } from './home.js';
import { needTree, gatePhrases, isAlternative, unlocksOf, statusText, offeredText } from './clsinfo.js';
import { initGlossary } from './glossary.js';
import { seasonTable } from './rules.js';
import { ZOOM, clamp, pinchStart, pinchStep, widthZoom, dragGuard, sheetDrag } from './touch.js';

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
  state.settings.semColors ??= true; // flowchart's Colors switch (semester colors): off = one neutral look for planned boxes
  // flowchart box labels: 'code' (MATH 2210), 'title' (Calc 3, the default) or 'both'; labelsHand = the student
  // picked it (the old default 'both' was saved for everyone, so a 'both' nobody picked shows as Title)
  state.settings.labels ??= 'title';
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
// the screen to open on (js/home.js): Home, or a ?p= link's flowchart, or (reload) where it was
const NAV0 = history.state;
// the signed-in account ({ name, email }) for Home's greeting; null = signed out
let who = null;
// accounts (js/account.js): the account's copy replaces this device's; signing out clears it
const account = initAccount({
  user: (u) => { who = u; queueMicrotask(() => { renderHome(); fillProfile(); }); },
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
  $('setSemColors').checked = state.settings.semColors !== false;
  renderLabels();
  refresh();
}
const major = () => state.plan.programs[0];
const planSig = () => JSON.stringify([state.plan.programs, state.plan.catalogYear]);
// view: 'actual' (audit + added classes: the student's real progress) or 'hypo' (Explore: actual + the taps
// tried there, a sandbox). Not saved: the site opens on real progress; the Explore taps themselves are saved.
// Tim, 2026-10-23: "put a "explore" right above the flowchart and when you click on it, it tells you to click
// classes to change possibilities. It also switches the button to say "Actual Progress""
const ui = { view: 'actual', sub: 'plan' };
const exploring = () => ui.view === 'hypo';
const actualSet = () => new Set(state.done[major()] || []);
const hypoOf = () => normHypo(actualSet(), state.settings.hypo?.[major()]);
// the classes counted on screen (flowchart, plan, Classes, schedule)
const doneSet = () => viewSet(actualSet(), state.settings.hypo?.[major()], ui.view);
function setHypo(h) { state.settings.hypo = { ...(state.settings.hypo || {}), [major()]: h }; }
// marking a class (Explore tap, the class sheet's Taken switch, a Gen Ed list pick): in Explore it is a
// possibility, never the actual classes; outside Explore it changes the actual classes (as added by hand)
function setDone(set) {
  if (exploring()) { setHypo(hypoFrom(actualSet(), set)); save(); return; }
  const before = actualSet(), src = srcMap();
  for (const k of set) if (!before.has(k)) src[k] = 'added';
  for (const k of before) if (!set.has(k)) delete src[k];
  setActual(set);
}
// Explore = a sandbox: nothing personal shows (D24)
const sandbox = () => !!model && exploring();
// the grades shown and planned with: none in the sandbox (every selected class counts as plain Taken, passed)
const viewGrades = () => (sandbox() ? {} : gradeMap());
// what a mark starts from: what the screen shows
const tapSet = () => doneSet();
// the actual classes (audit import, Classes); taps that now change nothing drop out
function setActual(set) { state.done[major()] = [...set]; setHypo(normHypo(new Set(set), state.settings.hypo?.[major()])); save(); }
const srcMap = () => { state.settings.src = { ...(state.settings.src || {}) }; return (state.settings.src[major()] = { ...(state.settings.src[major()] || {}) }); };
const gradeMap = () => (state.grades[major()] ??= {});
// a grade that came from the imported audit is locked (Tim, 2026-10-23: "If their transcript says they got a grade in
// a class they've taken, make sure it keeps that grade locked for that class so the user can't change it at all").
// '' = not locked: no grade, in progress, or set by the student. A newer audit replaces it (the import sets it).
function lockedGrade(key) {
  const g = key ? state.grades[major()]?.[key] : '';
  return g && g !== 'IP' && state.settings.src?.[major()]?.[key] === 'audit' ? g : '';
}
const LOCK_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="3" y="7" width="10" height="7.5" rx="1.5" fill="currentColor"/></svg>';
const lockHTML = (g) => ` <span class="glock"><b>${esc(g)}</b> ${LOCK_SVG} <small>from audit</small></span>`;

let model, nodes, edges, graph, sections = [], lastPlan = null, gened = null, progParts = [], advisors = null, uvuOfficial = null;
let seasonsData = null; // data/seasons.json as loaded (its build date goes on the class sheet's "Offered" link)
let matric = null; // js/matric.js matricSides: the boxes right of the dotted matriculation line
let grp = { chart: [], boxes: [], groups: [], grouped: new Set() }; // requirement groups (js/groups.js)
let shortData = null; // data/short-titles.json: the short names boxes and plan rows show (js/shortnames.js)

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
  showTab(startTab(NAV0, state.plan.programs, LINK));
  wireHome();
  wireProfile();
  wireSettings();
  wireFlowBar();
  renderLabels();
  wireImport();
  wirePicker();
  wireSched();
  wireGenEd();
  wireNav();
  wireClassSheet();
  wireApply();
  wireClasses();
  wireNoAudit();
  wireZoom();
  new ResizeObserver(() => layout()).observe($('chart'));
  $('gradesOn').checked = !!state.settings.grades;
  $('gradesOn').addEventListener('change', (e) => { state.settings.grades = e.target.checked; save(); refresh(); });
  fillProfile();
  wireGlossary();
  await loadCatalog();
  if (LINK) {
    const ids = programsFromLink(state.plan.programs, LINK, (id) => (entry(id) ? programGroup(entry(id)) : ''));
    if (JSON.stringify(ids) !== JSON.stringify(state.plan.programs)) setPlan(ids, state.plan.catalogYear);
  }
  tidyPlan();
  // a first visit lands on Home, whose "Pick your major" opens the picker (it used to open by itself)
  await loadPlan();
}

// load the chosen programs (major + minors) and draw them as one chart and one plan
// programs (major first) + catalog year -> { parts, model }, or null when the major can't be loaded
async function buildFor(ids, year) {
  const got = await Promise.all(ids.map((id) => loadProgram(id, year)));
  let parts = ids.map((id, i) => got[i] && { id, program: got[i].program, year: got[i].year }).filter(Boolean);
  if (!parts.length || parts[0].id !== ids[0]) return null;
  // the planner's extra data for the major's catalog year: prerequisites from outside the program ("Needed
  // first" boxes), Gen Ed lists, and the semesters each class usually runs in (missing: plan without it)
  const y = parts[0].year;
  const isOld = (yr) => !!yr && yr !== catalog.info.current;
  const ofYear = async (f) => (isOld(y) && await getJSON(`${DATA}/${y}/${f}`)) || getJSON(`${DATA}/${f}`);
  // an older catalog year: its requirements, but every class's prerequisites from the current catalog
  // (what registration enforces; js/curprereqs.js) — needs the full current course list
  const anyOld = parts.some((p) => isOld(p.year));
  const [currentPC, yearPC, ge, seasons, current] = await Promise.all([getJSON(`${DATA}/prereq-courses.json`),
    isOld(y) ? getJSON(`${DATA}/${y}/prereq-courses.json`) : null, ofYear('gened.json'), getJSON(`${DATA}/seasons.json`),
    anyOld ? getJSON(`${DATA}/courses.json`) : null]);
  seasonsData = seasons;
  if (current) parts = parts.map((p) => (isOld(p.year) ? { ...p, program: programWithCurrentPrereqs(p.program, current) } : p));
  const combined = combinePrograms(parts);
  const extraCourses = anyOld ? forCatalogYear(combined, { current, currentPC, yearPC }).extraCourses : currentPC;
  return { parts, model: buildModel(combined, { extraCourses, gened: ge, seasons }) };
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
  if (!built) return;
  const { parts } = built;
  // Gen Ed class lists of the major's catalog year (missing: the current catalog's)
  const y = parts[0].year;
  const adv = getJSON(`${DATA}/advisors.json`);
  const ofc = getJSON(`${DATA}/uvu-flowcharts.json`);
  const sht = shortData ? null : getJSON(`${DATA}/short-titles.json`);
  gened = (y && y !== catalog.info.current && await getJSON(`${DATA}/${y}/gened.json`)) || await getJSON(`${DATA}/gened.json`);
  advisors = (await adv)?.programs || null;
  if (sht) shortData = (await sht) || null;
  const official = officialChart((await ofc)?.programs, parts[0].id, y || catalog.info.current);
  if (gen !== loadGen) return;
  uvuOfficial = official; // Home links it too
  // UVU's own flowchart for this major (opens UVU's PDF in a new tab); hidden when the department has none.
  // Set before the chart is laid out, so the chart never jumps when it appears.
  $('uvuChart').hidden = !official;
  if (official) { const a = $('uvuChart').firstElementChild; a.href = official.url; a.textContent = `${official.label} ↗`; }
  progParts = parts;
  fillProfile();
  syncURL();
  model = built.model;
  // labs are folded into their lecture's box (ECE 2250 + 2255 = one box); the planner still has both
  const folded = foldLabs(flowNodes(model), flowEdges(model));
  edges = folded.edges;
  // classes that need matriculation (catalog admission gate, and what waits on them): right of a dotted line
  matric = matricSides(folded.nodes, edges);
  // a minor (or second major, certificate) gets its own section under the major's chart
  sections = parts.slice(1).map((p) => ({ key: p.id, label: p.program.name, group: programGroup(entry(p.id) || { type: /minor/i.test(p.program.name) ? 'minor' : '' }), test: (n) => n.prog === p.id }));
  // boxes with no prerequisite lines go in labelled requirement groups under their section (js/groups.js)
  grp = groupNodes(model, folded.nodes, edges, sections);
  nodes = grp.boxes;
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
  $('noDates').hidden = true;
  $('uvuChart').hidden = true;
  $('boxes').innerHTML = '';
  $('edges').innerHTML = '';
  $('legendItems').innerHTML = '';
  $('sems').innerHTML = '';
  $('sum').innerHTML = '<button type="button" class="ok" data-pick>Pick your program</button>';
  renderExplore();
  renderNoAudit();
  renderClasses();
  renderHome();
  syncURL();
}
// the address bar names the chosen programs (?p=major,minor), so a bookmark or shared link keeps them
function syncURL() {
  try { history.replaceState(history.state, '', urlWithPrograms(location.href, state.plan.programs)); } catch {}
}

// ---------- flowchart ----------
// Box positions and arrow routes come from js/layout.js (flowChart) in pixels. Every screen gets the widest
// gaps that still fit the chart area's width; when even the narrowest gaps don't fit, the chart is scaled to
// the width (never below 0.7, see layout()). Narrow boxes, wide gaps, more room between rows (Tim,
// 2026-10-23: "Really try to make it so there is no horizontal scrolling in the flowchart area"). A smaller
// fit only narrows the gaps; lanes stay at least 8 px apart.
const BASE = { boxH: 48, rowH: 66, near: 8, pad: 12 };
const FITS = [{ boxW: 92, gapMin: 88, track: 12 }, { boxW: 92, gapMin: 72, track: 12 }, { boxW: 92, gapMin: 60, track: 10 }, { boxW: 92, gapMin: 48, track: 9 }, { boxW: 92, gapMin: 40, track: 8 }, { boxW: 92, gapMin: 32, track: 8 }, { boxW: 92, gapMin: 26, track: 8 }];
const MIN_K = 0.7; // the smallest the chart is scaled to fit the width (smaller is hard to read)
let SIZES = { ...BASE, ...FITS[0] };
const charts = new Map();
const layouts = new Map(); // one layout per program, shared by every box size (js/layout.js flowChart)
// the chart at box size k, then its requirement groups placed under it for a chart area W px wide
const baseFor = (k) => charts.get(k) ?? charts.set(k, flowChart(grp.chart, edges, { ...BASE, ...FITS[k], split: matric?.after }, sections, layouts)).get(k);
const chartFor = (k, W) => {
  const key = `${k}|${Math.round(W || 0)}`;
  return charts.get(key) ?? charts.set(key, placeGroups(baseFor(k), grp.groups, { ...BASE, ...FITS[k], fitW: (W || 0) - 16 }, sections)).get(key);
};
function pickChart(W) {
  let k = FITS.findIndex((_, i) => chartFor(i, W).width <= W - 16);
  if (k < 0) k = FITS.length - 1; // the narrowest: layout() scales it to the width
  SIZES = { ...BASE, ...FITS[k] };
  graph = chartFor(k, W);
}

// a requirement row's short label (its box, its plan row); a generic "Complete one of the following:"
// shows its group's name. The catalog's full wording stays on the class sheet.
function reqLabel(label, u) {
  return reqName(shortData, label, u ? groupName(u, model?.program?.requirements?.[u.order]?.src) : '');
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
  // requirement groups (js/groups.js): a titled frame under its boxes ("Pick 2 · Math electives", progress on
  // the right, light green once met); a long list's "+N more" opens its class list; tapping the frame does too
  const wideText = new Map();
  for (const g of grp.groups) {
    const f = document.createElement('div');
    f.className = 'gframe' + (g.kind === 'pick' && g.unit.kind === 'choice' ? ' listed' : '');
    f.dataset.gf = g.id;
    f.innerHTML = `<b>${esc(g.title)}</b><span class="gp"></span>`;
    const listed = g.kind === 'pick' && g.unit.kind === 'choice';
    if (listed) f.addEventListener('click', (e) => { if (!e.target.closest('.box') && !chartDragged(e)) openGroupList(g); });
    host.appendChild(f);
    if (g.more.length) {
      const m = document.createElement('button');
      m.type = 'button'; m.className = 'gmore'; m.dataset.gm = g.id;
      m.textContent = `+${g.more.length} more`;
      m.addEventListener('click', (e) => { if (!chartDragged(e)) openGroupList(g); });
      host.appendChild(m);
    }
    if (g.inChart) {
      const c = document.createElement('div');
      c.className = 'ginc'; c.dataset.gi = g.id;
      c.textContent = `+${g.inChart} in chart`;
      host.appendChild(c);
    }
    if (g.kind === 'wide') wideText.set(g.items[0], g.text);
  }
  for (const n of nodes) {
    const b = document.createElement('button');
    const flex = n.kind === 'placeholder' || n.kind === 'choice';
    b.className = 'box' + (flex ? ' ph flex' : n.kind === 'option' ? ' flex' : '') + (grp.grouped.has(n.id) ? ' gchip' : '') + (wideText.has(n.id) ? ' gwide' : '');
    b.dataset.id = n.id;
    const labs = n.labs || [];
    // course code and its short name ("Calc 3"); Gen Ed / elective boxes: their short label ("ART/ARTH
    // elective"). The full catalog wording stays on the class sheet and is what a screen reader reads.
    const full = flex ? (wideText.get(n.id) ?? n.label) : n.title;
    const short = flex ? reqLabel(full, n) : boxName(shortData?.titles, n, model.program.courses);
    const hidden = short !== full ? `<span class="vh">${esc(full)}</span>` : '';
    // an option of several classes: "ACC 1110 + 1120", or "BIOL 1610 +Lab" (js/shortnames.js optionCode)
    const oc = n.kind === 'option' && (n.codes || []).length > 1 ? optionCode(n, model.program.courses) : null;
    const shown = (t) => (hidden ? ` aria-hidden="true"` : '') + `>${esc(t)}`;
    b.innerHTML = flex
      ? `<b${shown(short)}</b>${hidden}`
      : `<b${oc && !oc.more ? ' class="oc"' : ''}>${esc(oc ? oc.code : n.label)}${oc?.more ? `<small>${esc(oc.more)}</small>` : labs.length ? '<small>+Lab</small>' : ''}</b><i${shown(short)}</i>${hidden}`;
    b.insertAdjacentHTML('beforeend', '<em class="gr"></em>');
    // a minor's box (also when an arrow keeps it in the major's chart) carries a small tag
    const sec = sections.find((s) => s.key === n.prog);
    if (sec) { b.classList.add('extra'); b.insertAdjacentHTML('beforeend', `<em class="tag">${TAG[sec.group] || 'Minor'}</em>`); }
    if (n.kind === 'option') { const g = unitOf(n.group); b.insertAdjacentHTML('beforeend', `<em class="ptag">${esc(pickLabel(g?.pick))}</em>`); }
    // a Gen Ed box with a class list: the class taken (line 2) and a small list button on its bottom edge
    if (flex && listOf(n)) {
      b.classList.add('has-list');
      b.insertAdjacentHTML('beforeend', '<i class="pk"></i><span class="gl" role="button" aria-label="Class list"><svg viewBox="0 0 12 10" width="11" height="9" aria-hidden="true"><path d="M1 1.5h10M1 5h10M1 8.5h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span>');
    }
    b.addEventListener('click', (e) => {
      if (pressed.fired) { pressed.fired = false; return; } // a long press opened the class sheet
      if (chartDragged(e)) return; // a finger that dragged the chart (or pinched) isn't a tap
      // Explore: a tap tries the class as taken (or not); otherwise a tap opens its details
      // (the class stays picked out, its lines lit, while its details are open: setSel in openClass)
      if (e.target.closest('.gl')) openGenEd(n); else if (exploring()) toggle(n, b); else { setHover(null); openClass({ node: n }); }
    });
    longPress(b, () => { setHover(null); openClass({ node: n }); });
    // hover (mouse) or finger down (phone): its lines light up and a tiny label shows when
    b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { setHover(n.id); peekClass(n); } });
    b.addEventListener('pointerleave', () => { if (hoverId === n.id) setHover(null); unpeek(); });
    b.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') setHover(n.id); });
    for (const ev of ['pointerup', 'pointercancel']) b.addEventListener(ev, (e) => { if (e.pointerType !== 'mouse' && hoverId === n.id) setHover(null); });
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
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.id = 'hint';
  hint.hidden = true;
  host.appendChild(hint);
  // the dotted matriculation line's label (placed by layout()): opens what the catalog says about it
  const mat = document.createElement('button');
  mat.type = 'button';
  mat.className = 'matric-lbl';
  mat.id = 'matricBtn';
  mat.textContent = 'Matriculation';
  mat.hidden = true;
  mat.addEventListener('click', () => openMatric());
  host.appendChild(mat);
  hoverId = null;
  selId = null;
}

// ---------- hover: a box's own lines in two colours (into it = its prerequisites, out of it = the
// classes that need it), the rest dimmed, and a tiny when/grade label right above (or below) the box,
// never wider than it so it covers no lines. js/hover.js has the pure parts.
let hoverId = null;
function setHover(id) { hoverId = id; drawHover(); }
// the class whose details are open (Tim, 2026-10-23: "Make sure it stays highlighted even after clicking on
// it"): drawn like a hover until another class opens, the details close, or a tap lands on empty chart.
// A hover on another box still previews that one; leaving it brings the selection back.
let selId = null;
function setSel(id) {
  selId = id || null;
  for (const b of $('boxes').querySelectorAll('.box.sel')) b.classList.remove('sel');
  if (selId) $('boxes').querySelector(`.box[data-id="${CSS.escape(selId)}"]`)?.classList.add('sel');
  drawHover();
}
function drawHover() {
  const svg = $('edges'), hint = $('hint');
  svg.querySelector('g.hl')?.remove();
  const showId = hoverId || selId;
  const el = showId && $('boxes').querySelector(`.box[data-id="${CSS.escape(showId)}"]`);
  svg.classList.toggle('hov', !!el);
  if (!hint) return;
  if (!el || !graph) { hint.hidden = true; return; }
  const paths = svg.querySelectorAll('path[data-from]');
  const { pre, post } = edgeRoles(graph.edges, showId);
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', 'hl');
  for (const [list, kind] of [[pre, 'pre'], [post, 'post']]) {
    for (const i of list) {
      if (!paths[i]) continue;
      const c = paths[i].cloneNode();
      c.removeAttribute('data-from'); c.removeAttribute('data-to');
      c.setAttribute('class', `${c.getAttribute('class') || ''} ${kind}`.trim());
      c.setAttribute('marker-end', `url(#ah-${kind})`);
      g.appendChild(c);
    }
  }
  svg.appendChild(g);
  const text = el.dataset.hint || '';
  hint.hidden = !text;
  if (!text) return;
  hint.textContent = text;
  const at = placeHint({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }, { h: 14, gap: 2, top: $('chart').scrollTop / zoom.k });
  hint.style.cssText = `left:${at.left}px;top:${at.top}px;width:${at.width}px`;
}
// the semester a taken box's class was taken in (from the imported audit; '' unknown)
function boxTerm(n, completed) {
  const w = state.settings.when || {};
  const codes = n.kind === 'course' || n.kind === 'option' ? [n, ...(n.labs || [])].flatMap((u) => u.codes || [u.code]).filter((c) => completed.has(c))
    : n.kind === 'choice' ? (n.options || []).filter((o) => optionDone(o, completed)).flatMap((o) => [...o.codes, ...(o.alts || [])])
    : [pickedOf(completed, n.id)];
  return codes.map((c) => c && w[c]).find(Boolean) || '';
}

const TAG = { minor: 'Minor', cert: 'Cert', major: 'Major' };
const unitOf = (id) => model?.units.find((u) => u.id === id);

// zoom: the chart can be shrunk to fit the screen (Fit button) or pinched (phone); 1 = full size
const zoom = { mode: null, k: 1, fitK: 1, minK: ZOOM.min };
// a phone or tablet (finger, no mouse): starts with the chart's whole width on screen, pinch zooms
const touchUI = () => matchMedia('(pointer: coarse)').matches;
function layout() {
  const chart = $('chart');
  const W = chart.clientWidth, H = chart.clientHeight;
  if (!W || !H || !nodes) return;
  pickChart(W);
  const g = graph;
  // fitK: the whole chart on screen (Fit button); widthK: the chart's width on screen (the usual view: no
  // sideways scrolling, scroll down only), no smaller than MIN_K on a laptop; a phone shows the whole width
  // down to ZOOM.min and pinches in to read (Tim, 2026-10-23: "2 finger to zoom in/out")
  zoom.fitK = Math.min(1, (W - 8) / g.width, (H - 8) / g.height);
  zoom.widthK = widthZoom(W, g.width, touchUI() ? ZOOM.min : MIN_K);
  zoom.minK = Math.max(ZOOM.floor, Math.min(ZOOM.min, zoom.fitK, zoom.widthK));
  if (zoom.mode === null) zoom.mode = 'width';
  const k = zoom.mode === 'fit' ? zoom.fitK : zoom.mode === 'free' ? clamp(zoom.k, zoom.minK, ZOOM.max) : zoom.widthK;
  zoom.k = k;
  const fitBtn = $('fitBtn');
  // (after a pinch it's the way back to the usual view)
  fitBtn.hidden = zoom.mode !== 'free' && zoom.fitK >= zoom.widthK - 0.001;
  fitBtn.setAttribute('aria-pressed', zoom.mode === 'fit');
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
    const gr = el.dataset.gf ? g.frames : el.dataset.gm ? g.more : el.dataset.gi ? g.inChart : null;
    if (gr) { const r = gr.get(el.dataset.gf || el.dataset.gm || el.dataset.gi); el.hidden = !r; if (r) el.style.cssText = `left:${r.x + dx}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`; continue; }
    if (!el.dataset.id) continue;
    const r = g.boxes.get(el.dataset.id);
    Object.assign(el.style, { left: `${r.x + dx}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }); // (keeps --gh)
  }
  // a "pick N" group gets one frame when its boxes sit one under another with nothing else between
  const others = [...g.boxes.entries()];
  for (const f of frames) {
    const ids = nodes.filter((n) => n.group === f.dataset.grp && !grp.grouped.has(n.id)).map((n) => n.id);
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
    // (never past the matriculation label at the top)
    if (first.length) chart.scrollTop = Math.max(0, Math.min(Math.min(...first) - 16, g.split ? g.split.top - 14 : Infinity)) * k;
  }
  const d = (pts) => 'M' + pts.map(([x, y]) => `${+(x + dx).toFixed(1)},${+y.toFixed(1)}`).join('L');
  svg.innerHTML = '<defs><marker id="ah" viewBox="0 0 6 6" refX="6" refY="3" markerWidth="6" markerHeight="6" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0L6,3L0,6z"/></marker>'
    + ['pre', 'post'].map((k) => `<marker id="ah-${k}" viewBox="0 0 6 6" refX="6" refY="3" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0L6,3L0,6z"/></marker>`).join('') + '</defs>'
    // (one group, so lines that share a trunk fade as one when a box is hovered)
    // the two sides of the matriculation line, tinted only while it's hovered (or tapped on a phone)
    + (g.split ? `<g class="mreg"><path class="mb" d="${d([[-dx, g.split.top], ...g.split.pts, [-dx, g.split.bottom]])}Z"/>`
      + `<path class="ma" d="${d([[totalW - dx, g.split.top], ...g.split.pts, [totalW - dx, g.split.bottom]])}Z"/>`
      + g.split.strays.map((r) => `<path class="ma" d="${d([[r.x - 5, r.y - 5], [r.x + r.w + 5, r.y - 5], [r.x + r.w + 5, r.y + r.h + 5], [r.x - 5, r.y + r.h + 5]])}Z"/>`).join('') + '</g>' : '')
    + '<g class="lines">' + g.edges.map((e) => `<path data-from="${esc(e.from)}" data-to="${esc(e.to)}"${e.or ? ' class="or"' : ''} marker-end="url(#ah)" d="${d(e.pts)}"/>`).join('') + '</g>'
    // the matriculation line: left = classes that don't need it, right = classes that do; it bends through
    // the gaps around the boxes; a box no line can put on its side gets its own dotted outline
    + (g.split ? `<path class="matric" d="${d(g.split.pts)}"/>`
      + g.split.strays.map((r) => `<path class="matric" d="${d([[r.x - 5, r.y - 5], [r.x + r.w + 5, r.y - 5], [r.x + r.w + 5, r.y + r.h + 5], [r.x - 5, r.y + r.h + 5], [r.x - 5, r.y - 5]])}"/>`).join('') : '');
  const mat = $('matricBtn');
  if (mat) {
    mat.hidden = !g.split;
    if (g.split) mat.style.cssText = `left:${(g.split.x + dx).toFixed(1)}px;top:${g.split.top.toFixed(1)}px`;
  }
  // an invisible wide copy of the matriculation line under the boxes: hover (or tap) it to light it up
  let hit = $('matHit');
  if (!hit && g.split) {
    hit = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    hit.id = 'matHit';
    hit.setAttribute('class', 'mhit');
    $('boxes').prepend(hit);
    const on = (v) => $('edges').classList.toggle('mhov', v);
    hit.addEventListener('pointerdown', (e) => { layout.matTouch = e.pointerType !== 'mouse'; });
    // (a laptop hover also shows the matriculation details on the right, like a class's: peekMatric)
    hit.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse') { on(true); peekMatric(); } });
    hit.addEventListener('pointerout', (e) => { if (e.pointerType === 'mouse') { on(false); unpeek(); } });
    hit.addEventListener('click', () => { if (layout.matTouch) on(!$('edges').classList.contains('mhov')); });
    if (!layout.matWired) { // a tap anywhere else in the chart turns it off again
      layout.matWired = true;
      $('chart').addEventListener('click', (e) => { if (!e.target.closest?.('#matHit')) $('edges').classList.remove('mhov'); });
    }
    mat.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse') { on(true); peekMatric(); } });
    mat.addEventListener('pointerout', (e) => { if (e.pointerType === 'mouse') { on(false); unpeek(); } });
  }
  if (hit) {
    hit.hidden = !g.split;
    if (!g.split) $('edges').classList.remove('mhov');
    hit.setAttribute('width', totalW); hit.setAttribute('height', totalH);
    hit.innerHTML = g.split ? `<path d="${d(g.split.pts)}"/>` : '';
  }
  drawHover();
}

// Fit button (shown when the chart is bigger than the screen, or after a pinch) + two-finger pinch on the
// chart only. One finger pans: the chart's own scrolling (momentum included); the page never moves or zooms.
let chartDragged = () => false;
function wireZoom() {
  const chart = $('chart');
  chartDragged = dragGuard(chart);
  $('fitBtn').addEventListener('click', () => {
    const was = zoom.k;
    // whole chart <-> its width; after a pinch: back to the width
    zoom.mode = zoom.mode === 'width' ? 'fit' : 'width';
    layout();
    // keep the middle of the view in the middle
    chart.scrollLeft = Math.max(0, (chart.scrollLeft + chart.clientWidth / 2) * (zoom.k / was) - chart.clientWidth / 2);
    chart.scrollTop = Math.max(0, (chart.scrollTop + chart.clientHeight / 2) * (zoom.k / was) - chart.clientHeight / 2);
  });
  let pinch = null, frame = 0, last = null;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const mid = (t) => { const r = chart.getBoundingClientRect(); return [(t[0].clientX + t[1].clientX) / 2 - r.left, (t[0].clientY + t[1].clientY) / 2 - r.top]; };
  // one redraw per frame, the chart point under the fingers stays under them
  const draw = () => {
    frame = 0;
    if (!pinch || !last) return;
    const s = pinchStep(pinch, last.d, last.mx, last.my, zoom.minK, ZOOM.max);
    zoom.mode = 'free';
    zoom.k = s.k;
    layout();
    chart.scrollLeft = s.left;
    chart.scrollTop = s.top;
  };
  chart.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return;
    pressed.cancel();
    setHover(null);
    const [mx, my] = mid(e.touches);
    pinch = pinchStart(dist(e.touches), zoom.k, mx, my, chart.scrollLeft, chart.scrollTop);
    last = null;
  }, { passive: true });
  chart.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault(); // the page doesn't scroll or zoom; the chart does
    const [mx, my] = mid(e.touches);
    last = { d: dist(e.touches), mx, my };
    if (!frame) frame = requestAnimationFrame(draw);
  }, { passive: false });
  const end = (e) => {
    if (!pinch || e.touches.length >= 2) return;
    if (frame) { cancelAnimationFrame(frame); draw(); }
    pinch = null; last = null;
  };
  chart.addEventListener('touchend', end);
  chart.addEventListener('touchcancel', end);
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) chart.addEventListener(ev, (e) => e.preventDefault()); // iOS: no page zoom from the chart
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
  const own = !sandbox(); // the student's own info (in progress, grades, audit dates): not in Hypothetical
  const grades = viewGrades();
  const showGrades = !!state.settings.grades;
  const plan = makePlan(model, completed, planOpts());
  // which semester each unit is planned in (a choice group: its first chunk)
  const semOf = new Map();
  plan.semesters.forEach((s, i) => s.items.forEach((it) => { if (!semOf.has(it.unitId)) semOf.set(it.unitId, i); }));
  let anyIP = false, undated = false;
  const now = termLabel(currentTerm());
  for (const el of $('boxes').children) {
    if (!el.dataset.id) continue;
    const n = nodes.find((x) => x.id === el.dataset.id);
    const done = nodeDone(n, completed);
    const sem = done ? undefined : semOf.get(n.id) ?? semOf.get(n.labs?.[0]?.id);
    el.className = el.className.replace(/\s?\bs\d+\b/g, '');
    if (sem !== undefined && semCls(sem)) el.classList.add(semCls(sem).trim());
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
    // the hover label: when taken (+ grade, when grades are on) / in progress / planned
    const term = done && own ? boxTerm(n, completed) : '';
    if (done && own && !ip && !term) undated = true;
    el.dataset.hint = hintText({ done, grade: ip || showGrades ? g : '', term, planned: sem !== undefined ? plan.semesters[sem].term : '', now });
  }
  // requirement groups: progress in the title ("1 of 3"), light green once the requirement is met
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const g of grp.groups) {
    const f = $('boxes').querySelector(`.gframe[data-gf="${CSS.escape(g.id)}"]`);
    if (!f) continue;
    const p = groupProgress(g, completed, (id) => byId.has(id) && nodeDone(byId.get(id), completed));
    f.querySelector('.gp').textContent = p.text;
    f.classList.toggle('met', p.met);
  }
  // audits imported before 2026-10-18 kept no semesters (nothing saved holds them): ask for a re-upload.
  // An import since then always leaves settings.when (even {}), so this line never comes back after it.
  $('noDates').hidden = !(undated && !state.settings.when && hasAudit());
  if (hoverId || selId) drawHover();
  renderPlan(plan);
  renderLegend(plan, anyIP);
  lastPlan = plan;
  renderExplore();
  renderNoAudit();
  if (ui.sub === 'classes') renderClasses();
  renderHome();
  if ($('main').dataset.tab === 'sched') renderSched();
}

// ---------- Gen Ed class lists (js/gened.js): a sheet with the classes that fill a Gen Ed box ----------
// Placeholder box: tapping a class marks the box taken and remembers the class ("ph:8=DANC 1010").
// Pick-one box with its own options (American Institutions): tapping one takes that option's classes.
const listOf = (n) => genEdList(n, gened, { aas: /-aas$/.test(major() || ''), courses: model?.program.courses || {} })
  || (n && grp.groups.some((g) => g.kind === 'pick' && g.unit === n) ? groupList(n, model?.program.courses || {}) : null);
// a requirement group's class list: the Gen Ed list sheet, titled like the group ("Pick 2 · Math electives")
function openGroupList(g) {
  openGenEd(g.unit);
  if (geNode === g.unit) $('geName').textContent = g.title;
}
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
  // the lists come from the catalog's General Education page (that catalog year)
  $('geSrc').innerHTML = sourceLine([{ ...sourceLink('gened', { gened }), text: 'Gen Ed lists' }]);
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
    const n = geNode, el = $('boxes').querySelector(`.box[data-id="${CSS.escape(n.id)}"]`) || $('boxes').querySelector(`.gframe[data-gf="${CSS.escape('g:' + n.id)}"]`);
    if (n && el && nodeDone(n, doneSet())) toggle(n, el);
    dlg.close();
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
}

// the student's chosen tracks for this major ({ group id: track }); the planner uses them when it can
const chosenTracks = () => state.settings.tracks?.[major()] || {};
const planOpts = () => ({ maxCredits: state.settings.max, summers: state.settings.summers, start: startTerm(), track: chosenTracks(), tracks: chosenTracks(), grades: viewGrades() });
const parseTerm = (s) => { const [season, year] = String(s || '').split(' '); return year ? { season, year: +year } : null; };
// first planned semester: the chosen Start, but never the semester in session (or one the imported audit
// already shows classes in); a saved Start that has slipped into the past moves up on its own
const earliest = () => earliestStart({ summers: state.settings.summers, lastTerm: parseTerm(state.settings.lastTerm) });
function startTerm() {
  return planStart(parseTerm(state.settings.start), { summers: state.settings.summers, lastTerm: parseTerm(state.settings.lastTerm) });
}

// semester colour class (s0..s9) for semester i, '' when Semester colors is off
const semCls = (i) => (state.settings.semColors === false ? '' : ` s${i % 10}`);
const shortTerm = (t) => { const [season, year] = t.split(' '); return `${season.slice(0, 2)} ${String(year).slice(2)}`; };
function renderLegend(plan, anyIP) {
  // a dotted line = one of several prerequisites is enough (shown when the chart has one)
  const anyOr = !!graph?.edges.some((e) => e.or);
  $('legendItems').innerHTML = '<span class="sw done"></span>Taken' + (anyIP ? '<span class="sw ip"></span>Current' : '')
    + (anyOr ? '<svg class="sw-or" viewBox="0 0 16 4" width="16" height="4" aria-hidden="true"><path d="M0 2H16"/></svg>Any one' : '')
    + (semCls(0) ? plan.semesters.map((s, i) => `<span class="sw${semCls(i)}"></span>${shortTerm(s.term)}`).join('') : '');
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
    + `<p class="caveat">Unofficial plan — confirm with ${advA(progParts[0]?.id, 'your advisor', 'sumAdvisor') || 'your advisor'}. <a href="${esc(issueURL(progIssue()))}" target="_blank" rel="noopener" id="sumReport">Report a mistake</a></p>`
    // where the requirements come from: each program's catalog page (requirements tab), the sample plan, the date read
    + `<p class="src">${programSources(progParts)}</p>`
    // (its source = the catalog link on the line above, and the Matriculation sheet's ↗ links)
    + (gated ? `<p class="adm">Requires admission — apply after these classes. ${advA(progParts[0]?.id)}</p>` : '')
    // the bachelor's 120 / 40 totals and classes a major and minor share (back from Home, 2026-10-23)
    + (plan.checks || []).map((c) => `<p class="adm">${esc(c)}</p>`).join('')
    + (sharedCodes(plan).length ? `<p class="src">Counted once for both: ${esc(sharedCodes(plan).join(', '))}</p>` : '')
    + tracks.map((g) => {
      const mine = chosenTracks()[g.id];
      const t = mine && tracksOf(g).includes(mine) ? mine : (P.pickTrack ? P.pickTrack(g, completed) : null) || tracksOf(g)[0];
      return `<button type="button" class="chip" data-track="${esc(g.id)}" title="${esc(g.label)}"><span>${esc(shortName(t, 34))}</span>${mine ? '' : '<em>Guessed — pick yours</em>'}</button>`;
    }).join('');
  // admission programs: an "Apply" row before the program's semesters; an "Advanced Standing" row before the
  // first term the planner counts University Advanced Standing as reached (js/phases.js planPhases)
  const stones = planStones(plan);
  const STONE = { admission: 'Apply', 'advanced-standing': 'Advanced Standing' };
  const rowsAt = (i) => stones.filter((m) => m.at === i).map((m) => `<div class="apply" data-gate="${esc(m.gate)}"><span>${STONE[m.gate] || esc(m.gate)}</span>${m.gate === 'admission' ? advA(progParts[0]?.id) + aplA(progParts[0]?.id) : ''}</div>`).join('');
  $('sems').innerHTML = plan.semesters.map((s, i) => rowsAt(i) + `
    <div class="sem${semCls(i)}"><h3><button type="button" class="sem-go" data-term="${esc(s.term)}" title="Open in Schedule">${s.term}</button><span>${s.credits}</span></h3><ul>${s.items.filter((it) => !milestone(it)).map((it) =>
      `<li class="${it.kind === 'course' ? '' : 'ph'}" data-unit="${esc(it.unitId)}" data-sem="${i}" data-item="${esc(it.id)}" title="${esc([it.label, it.title, it.offered].filter(Boolean).join(' · '))}"><span>${esc(it.kind === 'course' ? it.label : reqLabel(it.label, unitOf(it.unitId) || it.unit))}</span><span>${it.credits}</span></li>`).join('')}</ul></div>`).join('')
    + plan.warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join('');
}
// the plan's milestone rows [{ at, gate }] (Apply, Advanced Standing): the plan screen draws them, Home
// names the Apply one
const milestone = (it) => it.kind === 'apply' || it.kind === 'milestone';
function planStones(plan) {
  let phases = null;
  try { phases = P.planPhases ? P.planPhases(plan) : null; } catch { phases = null; }
  const stones = milestonesOf(plan, phases);
  if (!stones.length) { const at = plan.semesters.findIndex((s, i) => i > 0 && s.items.some(milestone)); if (at > 0) stones.push({ at, gate: 'admission' }); }
  return stones;
}
// classes a major and its minor share (each counted once)
function sharedCodes(plan) {
  if (progParts.length < 2) return [];
  return [...new Set([...(model.program.shared || []).map((x) => x.code), ...plan.semesters.flatMap((s) => s.items.filter((it) => it.shared).map((it) => it.code))])];
}

// ---------- Home ----------
// Tim, 2026-10-23: "all the info should be in a list, like an ordinary cite ... The homepage should have the
// user's name, their major/minor with graduation progress, catelog year, and current GPA, (no links to UVU or
// anything in homepage) ... Put their graduation month/year and then the schedule and flowchart boxes"
// Home always shows the student's real progress, also while the flowchart is in Explore.
function renderHome() {
  const name = displayName(who, state.settings.name);
  $('hmName').textContent = name || 'Welcome';
  const panel = $('homePanel');
  panel.classList.toggle('named', !!name);
  const none = !state.plan.programs.length;
  panel.classList.toggle('none', none);
  // the profile circle (top right): the name's first letter once signed in
  $('pfInit').textContent = who ? (name || '').trim().charAt(0).toUpperCase() : '';
  if (none || !model || !lastPlan || !progParts.length) {
    $('hmFacts').innerHTML = none ? '<div class="hm-first"><button type="button" class="ok hm-pick" data-pick>Pick your major</button>'
      + (who ? '' : '<p class="hm-or">or <button type="button" data-signin-btn>Sign in</button></p>') + '</div>' : '';
    for (const id of ['hmGoFlow', 'hmGoSched']) $(id).textContent = '';
    return;
  }
  const actual = actualSet();
  const grades = gradeMap();
  const plan = exploring() ? makePlan(model, actual, { ...planOpts(), grades }) : lastPlan;
  const finished = new Set([...actual].filter((k) => statusOf(grades[k]) !== 'ip'));
  const ids = progParts.map((p) => p.id);
  const prog = programProgress(model, actual, finished, plan, ids);
  const [m] = progParts;
  // GPA: the Classes view's own groups (js/classes.js), so both screens show the same number
  const groups = classGroups({ model, completed: actual, actual, grades, src: state.settings.src?.[major()] || {}, catalog: courseCat.map });
  const graded = groups.filter((g) => g.key !== 'need').flatMap((g) => g.rows);
  // a class from outside the program needs the catalog for its credits: load it once, then draw again
  if (!courseCat.ready && graded.some((r) => r.credits == null)) loadCourses().then(renderHome);
  const g = gpa(graded);
  const progRow = (p, i) => {
    const part = progParts[i];
    const kind = i === 0 ? 'Major' : programGroup(entry(part.id) || {}) === 'cert' ? 'Certificate' : /minor/i.test(part.program.name) ? 'Minor' : 'Program';
    const cr = `${p.pct}% · ${p.taken} of ${p.total} cr${p.ip ? ` · ${p.ip} now` : ''}`;
    return `<div class="hm-prog"><dt>${kind}</dt><dd><button type="button" data-pick><b>${esc(part.program.name)}</b><small data-prog="${esc(p.id)}">${cr}</small></button></dd></div>`;
  };
  const rows = [
    ...prog.map(progRow),
    `<div><dt>Catalog</dt><dd>${esc(catalogShort(m.year || m.program.catalogYear) || '—')}</dd></div>`,
    g.gpa != null ? `<div><dt>GPA</dt><dd id="hmGpa">${g.gpa.toFixed(2)}</dd></div>` : '',
    `<div><dt>Graduation</dt><dd id="hmGrad">${esc(plan.graduation ? gradMonth(plan.graduation) || plan.graduation : 'All done')}</dd></div>`,
  ];
  $('hmFacts').innerHTML = rows.join('');
  $('hmGoFlow').textContent = `${nodes.length} classes`;
  $('hmGoSched').textContent = lastPlan.semesters[0]?.term || '';
}
function wireHome() {
  $('hmGo').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) setTab(b.dataset.go); });
}

// "Schedule with an advisor": the program's booking link, else its advising page (data/advisors.json); '' when unknown
function advA(id, text = 'Schedule with an advisor', elId = '') {
  const url = advisorLink(advisors, id);
  return url ? `<a class="adv" href="${esc(url)}" target="_blank" rel="noopener"${elId ? ` id="${elId}"` : ''}>${esc(text)}</a>` : '';
}
// " · How to apply": the program's apply / matriculate page (gated programs that have one); '' otherwise
function aplA(id) {
  const url = advisors && id ? advisors[id]?.admissionUrl : null;
  return url ? ` · <a class="adv apl" href="${esc(url)}" target="_blank" rel="noopener">How to apply</a>` : '';
}
// the program-level "Report a mistake" issue
function progIssue(extra = {}) {
  const p = progParts[0];
  return { program: progParts.map((x) => x.program.name).join(' + '), programId: progParts.map((x) => x.id).join('+'), year: p?.year || p?.program.catalogYear || '', ...extra };
}

// ---------- Explore (right above the flowchart) ----------
// Tim, 2026-10-23: "put a "explore" right above the flowchart and when you click on it, it tells you to click
// classes to change possibilities. It also switches the button to say "Actual Progress"". In Explore a tap
// tries a class as taken (a sandbox, D24: nothing personal shows); outside it a tap opens the class's details.
function renderExplore() {
  const on = exploring();
  const b = $('exploreBtn');
  b.textContent = on ? 'Actual progress' : 'Explore';
  b.setAttribute('aria-pressed', on);
  b.classList.toggle('on', on);
  $('hypClear').hidden = !on;
  $('flowPanel').classList.toggle('exploring', on);
}
// the flowchart's own controls, out in the open next to it: Explore, its clear, the box labels, semester colors
function wireFlowBar() {
  $('exploreBtn').addEventListener('click', () => {
    ui.view = exploring() ? 'actual' : 'hypo';
    refresh();
    renderExplore();
    if (exploring()) toast('Tap classes to try possibilities');
    else if ($('toastUndo').hidden) $('toast').classList.remove('on'); // (its hint goes with it; an Undo stays)
  });
  // clear every try (the actual classes stay), with Undo
  $('hypClear').addEventListener('click', () => {
    const snap = hypoOf();
    setHypo({ add: [], del: [] });
    save(); refresh();
    toast('Explore cleared', () => { setHypo(snap); save(); refresh(); });
  });
  $('lblSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b || b.dataset.v === labelView()) return;
    state.settings.labels = b.dataset.v;
    state.settings.labelsHand = true;
    save();
    renderLabels();
  });
  $('setSemColors').checked = state.settings.semColors !== false;
  $('setSemColors').addEventListener('change', (e) => { state.settings.semColors = e.target.checked; save(); refresh(); });
}
// Code (MATH 2210) / Title (Calc 3) / Both: a look on the boxes only, so nothing moves (Gen Ed boxes keep theirs)
const LABELS = ['code', 'title', 'both'];
const labelView = () => { const s = state.settings; return s.labels === 'both' && !s.labelsHand ? 'title' : LABELS.includes(s.labels) ? s.labels : 'title'; };
function renderLabels() {
  const v = labelView();
  $('boxes').dataset.lbl = v;
  $('scWeek').dataset.lbl = v; // the schedule's week blocks + class list use the same setting
  for (const b of [...$('lblSeg').children, ...$('scLbl').children]) { b.classList.toggle('on', b.dataset.v === v); b.setAttribute('aria-pressed', b.dataset.v === v); }
}
const labelsNow = () => labelView();

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
  const show = !!model && !hasAudit() && !sandbox(); // Hypothetical: no nags about the student's audit
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
  // Hypothetical: no grades, so no GPA line and no Current / AP/CE groups (all selected classes are Taken)
  const groups = classGroups({ model, completed: doneSet(), actual: actualSet(), grades: viewGrades(), src: state.settings.src?.[major()] || {},
    catalog: courseCat.map, order, when: (i) => shortTerm(lastPlan.semesters[i].term) });
  const g = gpa(groups.filter((x) => x.key !== 'need').flatMap((x) => x.rows));
  $('clGpa').style.visibility = sandbox() ? 'hidden' : ''; // (keeps + Add class where it is)
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
  // an audit grade: plain text, and Taken | Current can't change it
  const lock = ed.mode === 'edit' ? lockedGrade(ed.code) : '';
  for (const b of $('edSeg').children) { b.classList.toggle('on', b.dataset.s === status); b.disabled = !!lock; }
  $('edGrade').innerHTML = gradeOptions(status === 'ip' ? '' : grade).replace(/<option value="IP"[^>]*>[^<]*<\/option>/, '');
  $('edGrade').hidden = !!lock;
  $('edLock').innerHTML = lock ? lockHTML(lock) : '';
  $('edLock').hidden = !lock;
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
    // Hypothetical: a class opens its class sheet (Taken switch, no grades), not the grade editor
    if (r.group === 'need' || (sandbox() && r.unit)) openNeed(r); else if (!sandbox()) openEditClass(r);
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
    if (ed.mode !== 'edit' || lockedGrade(ed.code)) return;
    gradeMap()[ed.code] = ed.status === 'ip' ? 'IP' : $('edGrade').value;
    save(); refresh();
  };
  $('edSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-s]');
    if (!b || (ed.mode === 'edit' && lockedGrade(ed.code))) return;
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

// ---------- sections + settings ----------
// Tim, 2026-10-23: "If you click on a sectoin in the list, it brings you into a part of the cite that is
// seperated from anything else and to go back to the home page you click a back arrow in the top left ...
// There should be no "home/flowchart/Schedule", it should be controlled all through the home bars."
// Home opens each section (Flowchart, Schedule, Plan, Profile) full screen; its header is a back arrow and the
// section's name. On a laptop the Flowchart keeps the plan beside it (class details open there).
// (the plan belongs to the Flowchart since 2026-10-23: a laptop shows it beside the chart, a phone switches
// Chart | Plan in the header; Profile became the circle's menu on Home)
const TITLE = { flow: 'Flowchart', plan: 'Flowchart', sched: 'Schedule', settings: 'Settings' };
const tabNow = () => $('main').dataset.tab;
const wide = () => matchMedia('(min-width: 900px)').matches;
function showTab(tab) {
  if (tab === 'settings' || tab === 'profile') tab = 'home'; // (Settings is the gear's sheet, Profile the circle's menu)
  if (tab === 'plan' && wide()) tab = 'flow'; // (a laptop's Flowchart has the plan beside it)
  const main = $('main');
  const was = main.dataset.tab;
  main.dataset.tab = tab;
  document.body.dataset.tab = tab;
  $('ttl').textContent = TITLE[tab] || '';
  for (const b of $('fpSeg').children) { b.classList.toggle('on', b.dataset.v === tab); b.setAttribute('aria-pressed', b.dataset.v === tab); }
  // the class details beside the flowchart belong to it
  if (was === 'flow' && tab !== 'flow') for (const d of [$('clsDlg'), $('matDlg')]) if (panelDlg(d) && d.open) d.close();
  // entering a screen: a short slide-in instead of a jump (css .enter)
  if (was !== tab) { main.classList.remove('enter'); void main.offsetWidth; main.classList.add('enter'); }
  // a hint belongs to the screen it was shown on (an Undo stays until it times out)
  if (was !== tab && $('toastUndo').hidden) $('toast').classList.remove('on');
}
function setTab(tab, push = true) {
  if (push && tab !== tabNow()) pushNav({ tab });
  showTab(tab);
  if (tab === 'flow' || tab === 'plan') layout();
  if (tab === 'sched') renderSched();
}

// ---------- back: sections and sheets are history entries, so Back goes where you just were ----------
// Each entry is { tab, sub, dlg?, depth } (depth = entries above Home). Opening a sheet pushes one; closing it
// (Done, Esc, outside tap) steps back over it; Back closes the sheet or returns to the previous screen. The
// back arrow goes straight to Home. A sheet opened right as another closes (Settings -> Import audit) takes
// over that one's entry.
const NAV = { pending: 0, queued: null, kbd: false };
const depthNow = () => history.state?.depth || 0;
function pushNav(st) {
  const entry = { sa: 1, tab: tabNow(), sub: ui.sub, ...st };
  if (NAV.pending) NAV.queued = entry; else history.pushState({ ...entry, depth: depthNow() + 1 }, '', location.href);
}
// the class details on the Flowchart aren't a modal: beside the chart (laptop) or a bottom sheet under it (phone)
const panelDlg = (d) => d.classList.contains('side') || d.classList.contains('bsheet');
function openDlg(dlg) {
  if (!dlg.open) { if (panelDlg(dlg)) dlg.show(); else dlg.showModal(); }
  if (!NAV.kbd) document.activeElement?.blur(); // a focus ring only for keyboard users (:focus-visible)
  const cur = history.state?.dlg;
  if (cur === dlg.id) return;
  if (cur && !NAV.pending) history.replaceState({ ...history.state, dlg: dlg.id }, '', location.href);
  else pushNav({ dlg: dlg.id });
}
function goHome() {
  const d = depthNow();
  if (d > 0) { history.go(-d); return; }
  for (const dl of document.querySelectorAll('dialog[open]')) dl.close();
  history.replaceState({ sa: 1, tab: 'home', sub: ui.sub, depth: 0 }, '', location.href);
  setTab('home', false);
}
function wireNav() {
  const st0 = history.state;
  if (st0?.sa) history.replaceState({ ...st0, tab: tabNow(), depth: st0.depth || 0 }, '', location.href);
  else if (tabNow() !== 'home') {
    // opened straight into a section (a shared ?p= link): Home sits under it, so Back lands there
    history.replaceState({ sa: 1, tab: 'home', depth: 0 }, '', location.href);
    history.pushState({ sa: 1, tab: tabNow(), depth: 1 }, '', location.href);
  } else history.replaceState({ sa: 1, tab: 'home', depth: 0 }, '', location.href);
  addEventListener('keydown', () => { NAV.kbd = true; }, true);
  addEventListener('pointerdown', () => { NAV.kbd = false; }, true);
  for (const d of document.querySelectorAll('dialog')) {
    d.addEventListener('close', () => {
      if (history.state?.dlg !== d.id) return;
      NAV.pending++;
      history.back();
    });
  }
  // the class details beside the flowchart (not a modal): Esc closes them too
  addEventListener('keydown', (e) => { if (e.key === 'Escape') for (const d of [$('clsDlg'), $('matDlg')]) if (d.open && panelDlg(d)) d.close(); });
  addEventListener('popstate', (e) => {
    if (NAV.pending) {
      NAV.pending--;
      if (!NAV.pending && NAV.queued) { history.pushState({ ...NAV.queued, depth: depthNow() + 1 }, '', location.href); NAV.queued = null; }
      return;
    }
    const st = e.state || {};
    for (const d of document.querySelectorAll('dialog[open]')) if (d.id !== st.dlg) d.close();
    const tab = st.tab || 'home';
    if (tab !== tabNow()) setTab(tab, false);
    if ((st.sub || 'plan') !== ui.sub) setSub(st.sub || 'plan', false);
    if (st.dlg && !$(st.dlg)?.open) history.replaceState({ ...st, dlg: undefined }, '', location.href); // forward into a closed sheet
    if (model) syncURL();
  });
  // the back arrow goes Home, except on a screen opened from another one (a plan semester heading -> Schedule):
  // then it steps back to that screen
  $('back').addEventListener('click', () => {
    if (history.state?.from && !history.state?.dlg && depthNow() > 1) history.back(); else goHome();
  });
  // phone: Chart | Plan switch the Flowchart section's view in place (Back and the arrow still go Home)
  $('fpSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b || b.dataset.v === tabNow()) return;
    history.replaceState({ ...history.state, tab: b.dataset.v }, '', location.href);
    setTab(b.dataset.v, false);
  });
  // the major on Home, "Programs" in Profile, "Pick your program": the program picker
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-pick]')) return;
    if ($('pfDlg').open) $('pfDlg').close(); // (Programs in the account menu: the picker takes its place)
    openPicker();
  });
}

// ---------- the profile circle (Home, top right): its menu = Sign in / Create an account, or (signed in) the
// name shown on Home, the programs, the account ----------
// Tim, 2026-10-23: "Instead of having a profile box, just put a little profile circle in the top right that says
// "sign in" and "create an account"." Earlier (10-23): "allow the user to change their displayed name in the
// Profile section. Also automatically capitalize their first/last name if given." Saved with the settings.
function fillProfile() {
  const own = state.settings.name;
  if (document.activeElement !== $('pfName')) $('pfName').value = own ? capName(own) : displayName(who) || '';
  $('pfProgs').textContent = progParts.length ? progParts.map((p) => p.program.name).join(' + ') : 'Pick your program';
}
function wireProfile() {
  const dlg = $('pfDlg');
  // (account.js resets the menu on the same click)
  $('profile').addEventListener('click', () => { fillProfile(); openDlg(dlg); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  $('pfName').addEventListener('change', (e) => {
    const v = capName(e.target.value);
    state.settings.name = !v || v === displayName(who) ? null : v;
    e.target.value = v || displayName(who) || '';
    save();
    renderHome();
  });
  $('pfName').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
}

// the schedule's own filters, next to it (Tim, 2026-10-23: "Anything that is directly related to the flowchart
// should be right next to the flowchart out in the open, same with the schedule"); a phone folds them away
// behind the Filters button
function fillSchedPrefs() {
  const p = prefs();
  for (const b of $('setDays').children) b.classList.toggle('on', p.days.includes(b.dataset.d));
  const hour = (h) => `${((h + 11) % 12) + 1} ${h < 12 ? 'am' : 'pm'}`;
  const opts = (hours, cur, any) => `<option value="">${any}</option>` + hours.map((h) => { const v = String(h * 100).padStart(4, '0'); return `<option value="${v}"${v === cur ? ' selected' : ''}>${hour(h)}</option>`; }).join('');
  $('setAfter').innerHTML = opts([7, 8, 9, 10, 11, 12, 13], p.after, 'Any');
  $('setBefore').innerHTML = opts([12, 13, 14, 15, 16, 17, 18, 19, 20, 21], p.before, 'Any');
  $('setMode').value = p.mode;
  $('setGaps').checked = !!p.gaps; $('setRmp').checked = !!p.rmp; $('setMain').checked = !!p.main; $('setWait').checked = !!p.wait;
}
function wireSchedPrefs() {
  fillSchedPrefs();
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
  $('scFilt').addEventListener('click', () => {
    const open = $('schedPanel').classList.toggle('filt-open');
    $('scFilt').setAttribute('aria-expanded', open);
  });
}
// the gear (Home's top right): settings for the whole site
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
  };
  wireSchedPrefs();
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
function reqOf(u) {
  if (!u) return null;
  const g = u.kind === 'option' ? unitOf(u.group) : u;
  return model.program.requirements[Math.floor(g?.order ?? -1)] || null;
}
function openClass({ node, item, peek = false }) {
  if (!model) return;
  if (!peek) {
    clearTimeout(peekT); peeking = null;
    lastCls = { node, item };
    const m = $('matDlg'); if (m.open && panelDlg(m)) m.close(); // one panel on the right at a time
  }
  const u = node ? (node.kind === 'option' ? node : unitOf(node.id) || node) : unitOf(item.unitId) || model.units.flatMap((x) => x.options || []).find((o) => o.id === item.unitId);
  if (!u && !item) return;
  const kind = item?.kind || u.kind;
  const code = item?.code || (u?.kind === 'course' || u?.kind === 'option' ? u.code : null);
  const c = (code && model.program.courses?.[code]) || {};
  const g = u?.kind === 'option' ? unitOf(u.group) : u?.kind === 'choice' ? u : null;
  const req = reqOf(u);
  const opt = code && req?.options ? req.options.find((o) => o.codes?.includes(code)) : null;
  const part = progParts.find((p) => p.id === (u?.prog || progParts[0]?.id)) || progParts[0];
  // the box this is (its Taken switch, its selection on the chart)
  clsNode = node || nodes.find((x) => x.id === u?.id || x.id === item?.unitId) || null;
  // head: code + short name big, the full catalog title under it
  const full = code ? (c.title || u?.title || item?.title || '') : (item?.title || u?.title || '');
  const label = code || item?.label || u.label;
  const short = code ? (clsNode ? boxName(shortData?.titles, clsNode, model.program.courses) : '') : reqLabel(label, u);
  $('clsCode').textContent = code || short || label;
  $('clsShort').textContent = code && short && short !== full ? short : '';
  $('clsTitle').textContent = code ? full : (label !== (short || label) ? label : full);
  const rows = []; // [label, html]
  const chip = (k, st) => {
    const n = boxOf(k);
    const tag = st === 'done' ? ' is-done' : '';
    return n || model.program.courses?.[k] ? `<button type="button" class="ck${tag}" data-open="${esc(k)}">${esc(k)}</button>` : `<span class="ck${tag}">${esc(k)}</span>`;
  };
  const done = doneSet(), grades = viewGrades();
  const stOf = (k) => codeStatus(k, { done, grades });
  // 1. credits (+ its folded lab)
  const credits = item?.credits ?? (u?.kind === 'choice' ? (u.pick?.credits ?? u.credits) : u?.credits);
  const labs = (node?.labs || u?.labs || []).map((l) => l.label);
  if (credits != null) rows.push(['Credits', `${esc(String(credits))}${labs.length ? ` <span class="cw">+ lab ${esc(labs.join(', '))}</span>` : ''}`]);
  // 2. status: taken (+ grade), in progress, planned for a term, or not yet
  const isDone = clsNode ? nodeDone(clsNode, done) : !!code && done.has(code);
  const grade = isDone && clsNode && !sandbox() ? boxGrade(clsNode, done, grades) : isDone && code ? grades[code] || '' : '';
  const planned = !isDone ? plannedTerm(clsNode?.id || u?.id || item?.unitId, code) : '';
  const st = statusText({ done: isDone, grade: state.settings.grades || /^IP$/i.test(grade) ? grade : '', planned });
  rows.push(['Status', `<span class="${isDone ? 'st-done' : planned ? 'st-plan' : ''}">${esc(st)}</span>`]);
  // 3. needs: the classes (chips; tap one to open it), a take-with partner, gates as one short phrase each
  if (code) {
    const parts = needTree(c.prereqs);
    const html = parts.map((p) => (p.code ? chip(p.code, stOf(p.code)) : p.word ? `<span class="cw">${p.word}</span>` : `<span class="cw">${p.open ? '(' : ')'}</span>`)).join('');
    const co = (c.coreqs || []).filter((k) => !labs.includes(k));
    const pre = needCodes(c.precoreqs).filter((k) => !co.includes(k));
    const gl = u?.gates?.[code] || (item?.gate ? [item.gate] : []);
    const phrases = gatePhrases(c, gl);
    const alt = phrases.filter(isAlternative), must = phrases.filter((x) => !isAlternative(x));
    const adv = gatedNeed(c, gl) ? advA(part?.id) + aplA(part?.id) : '';
    const bits = [];
    if (html) bits.push(`<span class="chips">${html}</span>`);
    if (pre.length) bits.push(`<span class="chips"><span class="cw">before or with</span>${pre.map((k) => chip(k, stOf(k))).join('')}</span>`);
    if (co.length) bits.push(`<span class="chips"><span class="cw">with</span>${co.map((k) => chip(k, stOf(k))).join('')}</span>`);
    if (must.length) bits.push(`<span class="gate">${esc(must.join(' · '))}</span>`);
    if (alt.length) bits.push(`<span class="sub">${html ? 'or ' : ''}${esc(alt.join(' / '))}</span>`);
    if (c.prereqMinGrade && html) bits.push(`<span class="sub">${esc(c.prereqMinGrade)} or higher</span>`);
    if (adv) bits.push(`<span class="sub">${adv}</span>`);
    rows.push(['Needs', bits.length ? bits.join('') : 'Nothing']);
    // 4. unlocks: the program's classes that need this one
    const un = unlocksOf(code, model.program.courses).filter((k) => boxOf(k));
    if (un.length) rows.push(['Unlocks', `<span class="chips">${un.slice(0, 10).map((k) => chip(k, stOf(k))).join('')}${un.length > 10 ? `<span class="cw">+${un.length - 10}</span>` : ''}</span>`]);
    // 5. the semesters it runs in (data/seasons.json, from UVU's class search over the last 3 years)
    const off = offeredText(seasonTable(seasonsData), [code]);
    if (off) rows.push(['Offered', esc(off)]);
  }
  // what it counts for (the requirement, short) + the grade it needs to count
  const min = opt?.minGrade ?? req?.minGrade ?? c.minGrade;
  if (min) rows.push(['Min grade', `${esc(min)} or higher`]);
  let why = null;
  try { why = P.requirementFor ? P.requirementFor(model, code || u?.id) : null; } catch { why = null; }
  const src = opt?.src || req?.src || null;
  const whyText = typeof why === 'string' ? why : why?.why || why?.name || why?.label
    || src
    || [g ? `${g.label} · ${pickLabel(g.pick)}` : kind === 'placeholder' ? u?.label : null, req?.area].filter(Boolean).join(' — ');
  // the part of the degree it counts toward, short ("Discipline Core Requirements"; a pick-one: its group)
  const countsFor = g ? `${reqLabel(g.label, g)} · ${pickLabel(g.pick)}` : req?.area || '';
  if (countsFor && countsFor.trim() && countsFor !== short) rows.push(['Counts for', esc(countsFor) + (part && progParts.length > 1 ? ` <span class="cw">${esc(shortName(part.program.name, 30))}</span>` : '')]);
  if (kind !== 'course' && kind !== 'option' && g?.options?.length) rows.push(['Options', `<span class="chips">${g.options.slice(0, 12).map((o) => (o.code ? chip(o.code, stOf(o.code)) : `<span class="ck">${esc(o.label)}</span>`)).join('')}${g.options.length > 12 ? `<span class="cw">+${g.options.length - 12} more</span>` : ''}</span>`]);
  // 6. this term's sections and professors (filled in once the class list has loaded)
  if (code) rows.push(['Sections', '<span class="secs" id="clsSecs"><span class="cw">…</span></span>']);
  $('clsFacts').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('');
  // the catalog's own words, kept behind "Catalog text" (nothing is lost)
  const raw = [];
  if (full && code) raw.push(['Title', full]);
  for (const [k, l] of [['prereqText', 'Prerequisites'], ['precoreqText', 'Pre- or corequisites'], ['coreqText', 'Corequisites']]) if (c[k]) raw.push([l, c[k]]);
  if (c.gateText && !raw.some(([, v]) => v.includes(c.gateText))) raw.push(['Gate', c.gateText]);
  const gl = code ? (u?.gates?.[code] || (item?.gate ? [item.gate] : [])) : [];
  const needs = code ? needsOf(c, gl) : [];
  if (needs.length && !raw.some(([, v]) => needs.every((x) => v.includes(x)))) raw.push(['Also needs', needs.join(' · ')]);
  if (whyText) raw.push(['Requirement', whyText]);
  if (src && src !== whyText) raw.push(['Catalog', src]);
  if (why?.offered) raw.push(['Seasons', why.offered]);
  if (kind === 'placeholder' && u?.title && u.title !== label) raw.push(['Note', u.title]);
  $('clsRawList').innerHTML = raw.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  $('clsRaw').hidden = !raw.length;
  $('clsRaw').open = false;
  // where it all comes from, one small line: the class's catalog entry (prerequisites: today's catalog for an
  // older catalog year, js/curprereqs.js), the program's requirements, the class search (seasons, sections)
  const courseSrc = code ? sourceLink('course', { code, year: part?.year, current: catalog.info.current }) : null;
  const preSrc = code && c.prereqsCurrent ? sourceLink('course', { code, year: catalog.info.current, current: catalog.info.current }) : null;
  const progSrc = sourceLink('program', { program: part?.program, tab: 'requirements' });
  const links = [
    courseSrc && { ...courseSrc, text: 'Class' },
    preSrc && { ...preSrc, label: 'Catalog (prerequisites)', text: 'Prerequisites' },
    progSrc && { ...progSrc, text: shortName(part.program.name, 30) },
    code && seasonsData && { ...sourceLink('seasons', { seasons: seasonsData }), text: 'Class search' },
  ].filter(Boolean);
  $('clsSrc').innerHTML = sourceLine(links);
  $('clsCat').href = courseSrc?.url || progSrc?.url || `${CATALOG}/`;
  $('clsReport').href = issueURL(progIssue({ code: code || u?.label || '', title: code ? c.title || '' : '' }));
  $('clsTakenRow').hidden = !clsNode;
  if (clsNode) $('clsTaken').checked = nodeDone(clsNode, doneSet());
  drawClsGrades();
  $('clsDlg').dataset.code = code || '';
  if (code) fillSections(code);
  const d = $('clsDlg');
  // a hover preview (laptop): shown beside the chart without picking the class or adding a Back step
  if (peek) {
    if (peeking && peeking !== d) peeking.close(); // the matriculation preview gives way
    peeking = d; peekNode = clsNode;
    if (!d.open) { d.classList.add('side', 'peek'); d.classList.remove('bsheet'); d.show(); document.activeElement?.blur(); }
    d.scrollTop = 0;
    return;
  }
  d.classList.remove('peek');
  // on the chart: this class stays picked out while its details are open
  setSel(clsNode?.id || null);
  // laptop, on the Flowchart: the details open in the right-side section (over the plan), the chart stays usable
  if (!d.open) { d.classList.toggle('side', wide() && tabNow() === 'flow'); d.classList.toggle('bsheet', !wide() && tabNow() === 'flow'); }
  openDlg(d);
  d.scrollTop = 0;
  if (d.classList.contains('bsheet')) keepAboveSheet(clsNode?.id, d);
}
// hover a box on a laptop's Flowchart (Tim, 2026-10-23: "make it so the class info on the right also is shown
// when a user is hovering over the class, not only when they click on it"): its details show in the right-side
// section after a short pause; leaving the box brings back what was clicked (or closes the preview). Moving
// the mouse into the details keeps them, as if the box was clicked. Not in Explore (taps try classes there).
// The matriculation label and line do the same with the matriculation details (Tim, 2026-10-24: "do the same
// class overview thing on the right side but also with matriculation when you hover over it").
// A preview sits on top of a clicked panel (.peek) and adds no Back step.
let peekT = 0, peeking = null, peekNode = null, lastCls = null;
const pinnedDlg = () => history.state?.dlg;
function peekAt(open) {
  clearTimeout(peekT);
  if (wide() && tabNow() === 'flow') peekT = setTimeout(open, 120);
}
function peekClass(n) {
  if (exploring() || (n.id === selId && $('clsDlg').open && !peeking)) { unpeek(); return; }
  peekAt(() => openClass({ node: n, peek: true }));
}
function peekMatric() {
  if (pinnedDlg() === 'matDlg') { unpeek(); return; }
  peekAt(() => openMatric({ peek: true }));
}
function unpeek() {
  clearTimeout(peekT);
  if (!peeking) return;
  peekT = setTimeout(() => {
    const d = peeking;
    if (!d) return;
    peeking = null;
    if (pinnedDlg() !== d.id) d.close(); // only the hover had it open
    else if (d.id === 'clsDlg' && lastCls) openClass(lastCls); // back to the clicked class
  }, 200);
}
function keepPeek(d) {
  if (peeking !== d) return;
  if (d.id === 'clsDlg') openClass({ node: peekNode }); else openMatric();
}
// phone: the picked box stays in sight above the class details sheet (the chart scrolls, never the page; a
// spacer under the chart gives it room to scroll the last row up)
function keepAboveSheet(id, sheet) {
  const chart = $('chart');
  let pad = $('chartPad');
  if (!pad) { pad = document.createElement('div'); pad.id = 'chartPad'; pad.className = 'chart-pad'; chart.appendChild(pad); }
  // (where the sheet rests: it may still be sliding in)
  const top = document.documentElement.clientHeight - sheet.offsetHeight, cr = chart.getBoundingClientRect();
  pad.style.cssText = `top:${$('boxes').offsetHeight * zoom.k}px;height:${Math.max(0, cr.bottom - top)}px`;
  const el = id && $('boxes').querySelector(`.box[data-id="${CSS.escape(id)}"]`);
  if (!el) return;
  const r = el.getBoundingClientRect();
  const room = top - cr.top; // the chart's part still in sight
  let dy = 0;
  if (r.bottom > top - 10) dy = r.bottom - (top - 10);
  if (r.top - dy < cr.top + 6 || r.height > room) dy = r.top - (cr.top + Math.max(6, (room - r.height) / 2));
  if (Math.abs(dy) > 1) chart.scrollBy({ top: dy, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
// the box on the chart that stands for a class code (its own box, an option, or a folded lab's lecture)
function boxOf(code) {
  return nodes?.find((n) => (n.codes || [n.code]).includes(code) || n.labs?.some((l) => (l.codes || [l.code]).includes(code))) || null;
}
const needCodes = (t) => (!t ? [] : typeof t === 'string' ? [t] : (t.and || t.or || []).flatMap(needCodes));
// the plan's term for a unit (or class code), '' when not planned
function plannedTerm(id, code) {
  for (const s of lastPlan?.semesters || []) if (s.items.some((it) => it.unitId === id || (code && (it.code === code || it.codes?.includes(code))))) return s.term;
  return '';
}
// the class sheet's Sections row: the next term's sections + professors with their ratings (compact)
async function fillSections(code) {
  await loadSchedIndex();
  const term = sched.term;
  const groups = term ? await termGroups(term) : new Map();
  const el = $('clsSecs');
  if (!el || $('clsDlg').dataset.code !== code) return; // another class opened meanwhile
  const secs = groups.get(code) || [];
  const name = term ? termInfo(term).label : '';
  if (!secs.length) { el.innerHTML = `<span class="cw">None in ${esc(name || 'the class list')}</span>`; return; }
  const profs = [...new Set(secs.map((x) => x.instr).filter(Boolean))];
  const list = profs.slice(0, 4).map((p) => `<span class="ck">${esc(lastName(p))}${ratingBadge(p, true)}</span>`).join('');
  el.innerHTML = `<span class="sub" style="display:inline">${esc(name)}: ${secs.length} section${secs.length === 1 ? '' : 's'}</span>`
    + (list ? `<span class="chips" style="margin-top:4px">${list}${profs.length > 4 ? `<span class="cw">+${profs.length - 4}</span>` : ''}</span>` : '');
}
// ---------- glossary: a dotted underline on terms; hover (laptop) or tap (phone) shows what it means ----------
// data/glossary.json (each definition from a UVU page, linked under it). Never inside flowchart boxes.
function wireGlossary() {
  getJSON(`${DATA}/glossary.json`).then((data) => {
    if (!data?.terms?.length) return;
    initGlossary({
      data,
      roots: () => [$('clsDlg')?.querySelector('form'), $('matFacts'), $('sum'), $('homePanel')?.querySelector('.hm'), $('settings')?.querySelector('form'), $('clView'), $('pfDlg')].filter(Boolean),
      sourceHTML: (e) => linkHTML(sourceLink('url', { url: e.url, label: e.label }), e.label),
    });
  }).catch(() => {});
}
// ---------- matriculation sheet: tap the label on the dotted line -> everything the data knows ----------
// Catalog words, GPA / grade minimums (only when the catalog states them), the classes to finish first with
// the student's progress, the classes that need it, the advisor + how-to-apply links, the catalog page.
const NOT_IN = 'Not in the catalog';
function openMatric({ peek = false } = {}) {
  if (!model || !matric) return;
  const dlg = $('matDlg');
  if (!dlg.dataset.wired) {
    dlg.dataset.wired = '1';
    dlg.addEventListener('click', (e) => { if (e.target === dlg && !panelDlg(dlg)) dlg.close(); });
  }
  // the program the gated classes belong to (the major, unless only a minor has a matriculation section)
  const part = progParts.find((p) => p.program.admissionInfo) || progParts[0];
  const f = matricFacts(part?.program || model.program);
  const done = doneSet(), grades = viewGrades(); // Hypothetical: an in-progress class is plain done
  const planned = new Map();
  (lastPlan?.semesters || []).forEach((s) => s.items.forEach((it) => [it.code, ...(it.codes || [])].filter(Boolean).forEach((c) => { if (!planned.has(c)) planned.set(c, shortTerm(s.term)); })));
  const mark = (code) => {
    const st = codeStatus(code, { done, grades, planned });
    const tag = st === 'done' ? ' ✓' : st === 'ip' ? ' · Now' : st ? ` · ${st}` : '';
    return `<span class="mt${st === 'done' ? ' ok' : ''}">${esc(code)}${esc(tag)}</span>`;
  };
  const list = (codes) => `<span class="mts">${codes.map(mark).join('')}</span>`;
  const label = (id) => { const n = nodes.find((x) => x.id === id); return n?.code || n?.label || id; };
  const rows = [];
  rows.push(['Catalog', esc(f.text || NOT_IN)]);
  rows.push(['GPA', esc(f.gpa ? `${f.gpa} or higher` : NOT_IN)]);
  rows.push(['Grade', esc(f.minGrade ? `${f.minGrade} or higher in these classes` : NOT_IN)]);
  if (f.before.length) {
    const n = f.before.filter((c) => codeStatus(c, { done, grades }) === 'done').length;
    rows.push(['Before', `${n} of ${f.before.length} done${f.beforeFrom === 'graduation plan' ? ' (from the sample plan)' : ''}${list(f.before)}`]);
  } else rows.push(['Before', esc(NOT_IN)]);
  // catalog-marked classes (chart boxes, plus listed ones not drawn), then the ones that wait on them
  const gated = [...new Set([...[...matric.gated].map(label), ...f.gated])];
  rows.push(['Needs it', list(gated)]);
  const after = [...matric.after].filter((id) => !matric.gated.has(id)).map(label);
  if (after.length) rows.push(['After it', list(after)]);
  rows.push(['Deadline', esc(f.deadline || NOT_IN)]);
  const adv = advA(part?.id) + aplA(part?.id);
  if (adv) rows.push(['Advisor', adv]);
  $('matProg').textContent = part?.program.name || '';
  // each catalog fact links to the catalog page (its own words highlighted when the browser can); source line below
  const progSrc = sourceLink('program', { program: part?.program, tab: 'requirements' });
  const factSrc = sourceLink('url', { url: f.url || progSrc?.url, label: progSrc?.label || 'Catalog' });
  const fromCat = new Set(['Catalog', 'GPA', 'Grade', 'Before', 'Needs it', 'Deadline']);
  $('matFacts').innerHTML = rows.map(([k, v]) => { const s = fromCat.has(k) ? linkHTML(factSrc, '') : ''; return `<dt>${esc(k)}</dt><dd>${v}${s ? ' ' + s : ''}</dd>`; }).join('');
  $('matSrc').innerHTML = progSrc ? `${linkHTML(progSrc, part.program.name)} · ${esc(progSrc.label)}${progSrc.date ? ` · <span class="src-d">${checked(progSrc.date)}</span>` : ''}` : '';
  $('matCat').href = f.url || progSrc?.url || `${CATALOG}/`;
  $('matReport').href = issueURL(progIssue({ code: 'Matriculation' }));
  // "Fill my application": programs with an application page (data/advisors.json); none in Explore (D24)
  $('matApply').hidden = !(advisors?.[part?.id]?.admissionUrl) || sandbox();
  // laptop, on the Flowchart: in the right-side section like a class's details (a hover previews it there)
  if (!dlg.open) dlg.classList.toggle('side', wide() && tabNow() === 'flow');
  if (peek) {
    // a class preview gives way (a clicked class's panel shows that class again, under this one)
    if (peeking && peeking !== dlg) { if (pinnedDlg() === peeking.id && lastCls) openClass(lastCls); else peeking.close(); }
    peeking = dlg;
    if (!dlg.open) { dlg.classList.add('peek'); dlg.show(); document.activeElement?.blur(); }
    dlg.scrollTop = 0;
    return;
  }
  clearTimeout(peekT); peeking = null;
  dlg.classList.remove('peek');
  const c = $('clsDlg'); if (c.open && panelDlg(c)) c.close(); // one panel on the right at a time
  openDlg(dlg);
  dlg.scrollTop = 0;
  $('matFacts').scrollTop = 0;
}

// ---------- "Fill my application": the answers for the program's matriculation form, from the audit ----------
// Tim, 2026-10-23: "what if the Cite automatically filled in your applicatoin based on the wolverine track that
// the student uploaded and then gave them links to where to submit it and whatnot?" The real form is UVU's
// (Adobe Sign, a PDF, a Qualtrics survey...): the site never fills or sends it, it shows the answers to copy,
// whether the student is ready, and the steps with links. js/application.js builds it; on this device only.
const COPY_ICON = '⧉';
async function openApply() {
  const part = progParts.find((p) => p.program.admissionInfo) || progParts[0];
  if (!part) return;
  const apps = await getJSON(`${DATA}/applications.json`);
  const app = apps?.programs?.[part.id] || { url: advisors?.[part.id]?.admissionUrl, kind: 'none' };
  const f = matricFacts(part.program);
  const info = state.applyInfo || {};
  const prof = splitName(capName(state.settings.name) || (who?.name ? displayName(who) : ''));
  const student = { ...info, first: prof.first || info.first || '', last: prof.last || info.last || '' };
  const grades = gradeMap();
  const groups = classGroups({ model, completed: actualSet(), actual: actualSet(), grades, src: state.settings.src?.[major()] || {}, catalog: courseCat.map });
  const g = gpa(groups.filter((x) => x.key !== 'need').flatMap((x) => x.rows));
  const sheet = answerSheet({
    app, typical: apps?.fields || [], before: f.before, student, done: actualSet(), grades, when: state.settings.when || {},
    catalogYear: state.plan.catalogYear || state.audit?.[major()]?.catalogYear || part.program.catalogYear || '',
    gpa: g.gpa, minGrade: f.minGrade, minGpa: f.gpa, terms: apps?.terms, today: new Date(),
  });
  const dlg = $('appDlg');
  dlg._text = sheetText(sheet, `${part.program.name} application`);
  $('appProg').textContent = part.program.name;
  $('appTypical').hidden = sheet.known;
  // Ready? each class green (done, C or better) / amber (in progress) / red (missing or below the minimum)
  const TAG = { ok: ' ✓', ip: ' · Now', low: (c) => ` · ${grades[c] || 'Low'}`, missing: ' · Needed' };
  const chip = (c) => `<span class="mt ${c.status}">${esc(c.code)}${esc(typeof TAG[c.status] === 'function' ? TAG[c.status](c.code) : TAG[c.status])}</span>`;
  const r = sheet.ready, ready = [];
  const okN = r.courses.filter((c) => c.status === 'ok').length;
  ready.push(['Classes', `${okN} of ${r.courses.length} done<span class="mts">${r.courses.map(chip).join('')}</span>`
    + (sheet.also.length ? `<span class="sub">${esc(sheet.also.map((c) => c.code).join(', '))}: on the program page, not the form</span>` : '')]);
  if (r.minGpa || r.gpa) ready.push(['GPA', r.gpa ? `<span class="${r.gpaOk === false ? 'app-bad' : r.gpaOk ? 'st-done' : ''}">${esc(r.gpa)}${r.minGpa ? ` · needs ${esc(r.minGpa)}${r.gpaOk ? ' ✓' : ''}` : ''}</span>` : `Needs ${esc(r.minGpa)}`]);
  const page = sourceLink('url', { url: app.url, label: app.title || 'Application page', date: apps?.checked });
  const dl = r.deadline ? `${niceDate(r.deadline.date)} (for ${r.deadline.term})` : r.deadlineText || f.deadline || 'See the application page';
  ready.push(['Deadline', `${esc(dl)} ${linkHTML(page, '')}`]);
  $('appReady').innerHTML = ready.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('');
  // Answers: each value is its own copy button; blanks are the student's to type (never guessed)
  const val = (v, label) => (v ? `<button type="button" class="cpv" data-copy="${esc(v)}" aria-label="Copy ${esc(label)}: ${esc(v)}">${esc(v)}<i aria-hidden="true">${COPY_ICON}</i></button>` : '');
  $('appFields').innerHTML = sheet.fields.map((x) => `<dt>${esc(x.label)}</dt><dd>${x.own ? '<span class="cw">Type yourself</span>' : val(x.value, x.label)}</dd>`).join('');
  $('appCols').textContent = sheet.columns.join(' · ');
  $('appRows').innerHTML = sheet.rows.map((x) => {
    const cells = [x.term, x.grade, x.course, x.inst].map((v, i) => val(v, `${x.code} ${sheet.columns[i]}`)).join('');
    return `<li><b>${esc(x.code)}</b><span>${cells || '<span class="cw">Not taken</span>'}</span></li>`;
  }).join('');
  $('appRowNote').textContent = sheet.rowNote;
  $('appRowNote').hidden = !sheet.rowNote;
  // Steps: advisor -> the official page (Start Application) -> paste -> sign -> faculty mentor -> decision
  const form = sourceLink('url', { url: app.link, label: app.kind === 'pdf' ? 'Application PDF' : 'Application form' });
  const adv = sheet.advisor;
  const steps = [
    `Meet your advisor${adv?.name ? `: ${esc(adv.name)} (last names ${esc(adv.band)})` : ''}. ${advA(part.id)}${advA(part.id) ? '. ' : ''}Bring this sheet (Print).`,
    `Open the ${linkHTML(page, 'application page')}${app.kind === 'adobesign' ? ` and press ${esc(app.form?.button || 'Start Application')} with your name and UVID` : form ? ` · ${linkHTML(form)}` : ''}.`,
    `Paste your answers${app.kind === 'adobesign' ? ' into the Adobe Sign form' : ''}.`,
    app.kind === 'adobesign' ? `Sign it. Then ${esc((app.form?.signers || []).slice(1).map((s) => s.toLowerCase()).join(', ') || 'your advisor and the department')} sign.` : 'Submit it.',
  ];
  if ((app.form?.signers || []).some((s) => /mentor/i.test(s))) steps.push(`Meet your faculty mentor${sheet.mentor?.name ? `: ${esc(sheet.mentor.name)}` : ''}.`);
  steps.push('Watch your myUVU email for the decision.');
  $('appSteps').innerHTML = steps.map((s) => `<li>${s}</li>`).join('');
  $('appSrc').innerHTML = page ? `${linkHTML(page)}${apps?.checked ? ` · <span class="src-d">${checked(apps.checked)}</span>` : ''}` : '';
  if ($('matDlg').open) $('matDlg').close();
  openDlg(dlg);
  dlg.querySelector('form').scrollTop = 0;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    return ok;
  }
}
function wireApply() {
  const dlg = $('appDlg');
  $('matApply').addEventListener('click', openApply);
  // a value's copy button: its icon turns into a check for a moment (nothing moves)
  dlg.addEventListener('click', async (e) => {
    if (e.target === dlg) { dlg.close(); return; }
    const b = e.target.closest('button[data-copy]');
    if (!b) return;
    await copyText(b.dataset.copy);
    b.classList.add('copied');
    clearTimeout(b._t);
    b._t = setTimeout(() => b.classList.remove('copied'), 1200);
  });
  $('appAll').addEventListener('click', async () => {
    await copyText(dlg._text || '');
    $('appAll').classList.add('copied');
    clearTimeout(wireApply.t);
    wireApply.t = setTimeout(() => $('appAll').classList.remove('copied'), 1200);
  });
  $('appPrint').addEventListener('click', () => print());
  $('appBack').addEventListener('click', () => { dlg.close(); openMatric(); });
  const h = dlg.querySelector('.grab');
  if (h) sheetDrag(dlg, h, { close: () => dlg.close() });
}

// the classes a taken box stands for, each with its own grade (lecture + its folded lab; a pick-one box's
// option; the class picked for a Gen Ed box, else the box)
function gradeCodes(n, s) {
  if (!n || !nodeDone(n, s)) return [];
  if (n.kind === 'course' || n.kind === 'option') return [n, ...(n.labs || [])].map((u) => (u.codes || [u.code]).find((c) => s.has(c)) || u.code).filter(Boolean);
  if (n.kind === 'choice') { const o = (n.options || []).find((x) => optionDone(x, s)); return o ? [...o.codes, ...(o.alts || [])].filter((c) => s.has(c)) : [n.id]; }
  return [pickedOf(s, n.id) || n.id];
}
const gradeOptions = (cur) => [['', 'No grade'], ['IP', 'In progress'], ...GRADES.map((g) => [g, g])]
  .map(([v, t]) => `<option value="${v}"${v === (cur || '') ? ' selected' : ''}>${t}</option>`).join('');
// the class sheet's grade pickers: one per class the box stands for, only once it counts as taken
function drawClsGrades() {
  // (none in Hypothetical: no personal info there)
  const codes = sandbox() ? [] : gradeCodes(clsNode, doneSet()), grades = gradeMap();
  $('clsGrades').innerHTML = codes.map((c) => {
    const key = grades[c] == null && codes.length === 1 && clsNode ? clsNode.id : c;
    const name = `Grade${codes.length > 1 ? ` <small>${esc(c)}</small>` : ''}`;
    const lock = lockedGrade(key);
    return lock ? `<div class="cls-glock">${name}${lockHTML(lock)}</div>`
      : `<label>${name}<select data-code="${esc(c)}">${gradeOptions(grades[key])}</select></label>`;
  }).join('');
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
    if (!sel || lockedGrade(sel.dataset.code)) return;
    gradeMap()[sel.dataset.code] = sel.value;
    save(); refresh();
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) { dlg.close(); return; }
    // a class chip (Needs, Unlocks, Options): open that class
    const b = e.target.closest('button[data-open]');
    if (!b) return;
    const n = boxOf(b.dataset.open);
    if (n) openClass({ node: n });
  });
  // the details closing: the chart lets go of the class (and the phone's sheet gives back its room)
  for (const d of [dlg, $('matDlg')]) {
    d.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') keepPeek(d); });
    d.addEventListener('close', () => { if (peeking === d) { clearTimeout(peekT); peeking = null; } d.classList.remove('peek'); });
  }
  dlg.addEventListener('close', () => { setSel(null); dlg.classList.remove('tall'); $('chartPad')?.style.setProperty('height', '0px'); });
  // phone: drag the sheet's handle down to close it, up to make it taller; when it grows, the box stays in sight
  new ResizeObserver(() => { if (dlg.open && dlg.classList.contains('bsheet')) keepAboveSheet(selId, dlg); }).observe(dlg);
  for (const d of [dlg, $('matDlg')]) { const h = d.querySelector('.grab'); if (h) sheetDrag(d, h, { close: () => d.close() }); }
  // a tap on empty chart space: let go of the class (and close its side details / sheet)
  $('chart').addEventListener('click', (e) => {
    if (chartDragged(e)) return;
    if (!selId || e.target.closest('.box, .gframe, .gmore, .matric-lbl, .pickgrp em, button, a')) return;
    if (dlg.open) dlg.close(); else setSel(null);
  });
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
    sched.info = Object.fromEntries((idx?.terms || []).map((t) => [String(t.term), t]));
    sched.rmpFile = rmp;
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
  const bar = schedTerms();
  const all = [...bar.past, ...bar.current, ...bar.future];
  if (!all.includes(sched.term)) sched.term = defaultTerm(sched.terms);
  drawTermBar(bar);
  // a term with no section times (past terms, plan terms after the published ones): its classes as a list
  const listOnly = !sched.terms.includes(sched.term);
  $('schedPanel').classList.toggle('list-term', listOnly);
  if (listOnly) { $('schedPanel').classList.remove('mine'); drawTermList(sched.term, bar.past.includes(sched.term)); return; }
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
  const src = link ? sourceLink('rmp', { prof: p }) : null;
  return src
    ? `<a class="rt" ${style} href="${esc(src.url)}" target="_blank" rel="noopener" title="Rate My Professors">${p.r.toFixed(1)}</a>`
    : `<em class="rt" ${style}>${p.r.toFixed(1)}</em>`;
}
// where a term's sections and ratings come from: "UVU class search · 2027 Spring ↗ · Rate My Professors ↗ · checked Oct 19"
function schedSrc(term) {
  const line = sourceLine([sourceLink('sections', { term: sched.info?.[term] }), sourceLink('ratings', { rmp: sched.rmpFile })]);
  return line ? `<li class="src">${line}</li>` : '';
}
// a class's section sheet: its catalog entry + the class search the sections came from
function secSrc(code) {
  const y = progParts[0]?.year;
  return sourceLine([{ ...sourceLink('course', { code, year: y, current: catalog.info.current }), text: 'Catalog' }, sourceLink('sections', { term: sched.info?.[sched.term] })]);
}
const seatText = (sec) => (sec.seats > 0 ? `${sec.seats} open` : `Full${sec.wait ? ` +${sec.wait}` : ''}`);
// Mon-Fri (+Sat when needed), 8 am-5 pm at least; one colour per class (the plan's semester palette)
function drawWeek(s) {
  const blocks = [];
  (s?.picks || []).forEach((o, i) => { if (o) for (const sec of o.secs) for (const m of meetingsOf(sec)) blocks.push({ i, m, sec }); });
  const days = ['M', 'T', 'W', 'R', 'F', ...['S', 'U'].filter((d) => blocks.some((b) => b.m.day === d))];
  // only the hours the classes use, plus a small margin (Tim, 2026-10-23: "condense the timing of the classes part")
  const { lo, hi } = hourWindow(blocks.map((b) => b.m));
  const span = hi - lo, pct = (v) => +(v * 100).toFixed(3);
  const hours = [];
  const lines = [];
  for (let h = Math.ceil(lo / 60) * 60; h < hi; h += 60) {
    hours.push(`<span style="top:${pct((h - lo) / span)}%">${((h / 60 + 11) % 12) + 1}</span>`);
    lines.push(`<i class="wk-hl" style="top:${pct((h - lo) / span)}%"></i>`);
  }
  $('scWeek').style.setProperty('--n', days.length);
  // each block: the class's short title (or code, per Labels), then its full time range in bright numbers
  // (Tim, 2026-10-23: "Show the full time "10 - 11:15" or whatever in bright numbers")
  $('scWeek').innerHTML = `<div class="wk-head"><span></span>${days.map((d) => `<span>${DAY_NAME[d]}</span>`).join('')}</div>`
    + `<div class="wk-body"><div class="wk-times">${hours.join('')}</div><div class="wk-cols">${lines.join('')}`
    + blocks.map((b) => {
      const code = codeLabel(b.sec), name = schedName(code, b.sec.title);
      return `<div class="wk-b s${b.i % 10}" style="left:calc(${days.indexOf(b.m.day)} * 100% / var(--n));top:${pct((b.m.s - lo) / span)}%;height:${pct((b.m.e - b.m.s) / span)}%" title="${esc(`${name} · ${code} ${whenFull(b.sec)} ${b.sec.bldg || ''} ${b.sec.room || ''}`)}">`
        + `<b class="wt">${esc(name || code)}</b><span class="wtm">${timeRange(b.m.s, b.m.e)}</span><b class="wc">${esc(code)}</b></div>`;
    }).join('')
    + '</div></div>';
  fitBlocks();
  // (again whenever the grid changes size: the phone's Filters opening, turning the phone)
  if (!fitBlocks.watch) { fitBlocks.watch = new ResizeObserver(() => fitBlocks()); fitBlocks.watch.observe($('scWeek')); }
}
// a short block keeps one line of title + the time; a tiny one keeps the time only (the time always wins)
function fitBlocks() {
  const cut = (el) => { const t = el.querySelector('.wtm'); return t.offsetTop + t.offsetHeight > el.clientHeight + 1; };
  for (const el of $('scWeek').querySelectorAll('.wk-b')) {
    el.classList.remove('short', 'tiny', 'snug');
    // a long time ("10:30–11:45") in a narrow phone column: slightly smaller digits so it's never cut off
    const t = el.querySelector('.wtm');
    if (t.scrollWidth > t.clientWidth + 0.5) el.classList.add('snug');
    if (cut(el)) el.classList.add('short');
    if (cut(el)) el.classList.add('tiny');
  }
}
// a class's short name ("Calc 3"): from its catalog title (the program's, else the full course list), else the
// section's own title; data/short-titles.json shortens it like the flowchart boxes (js/shortnames.js)
function schedName(code, fallback = '') {
  const full = model?.program.courses?.[code]?.title || courseCat.map[code]?.title || fallback || '';
  return shortTitle(shortData?.titles, full) || shortTitle(shortData?.titles, fallback);
}
const schedCredits = (code, sec) => model?.program.courses?.[code]?.credits ?? courseCat.map[code]?.credits ?? sec?.cr ?? null;
// a class block's first line: the short title big, the code small beside it (Labels "Code": the other way round)
function nameLine(code, title) {
  const big = labelsNow() === 'code' || !title ? code : title;
  const small = big === code ? title : code;
  return `<span class="sc-name"><b>${esc(big)}</b>${small ? `<small>${esc(small)}</small>` : ''}</span>`;
}
const crLine = (cr) => (cr != null && cr !== '' ? `${cr} cr` : '');
const infoLine = (...parts) => { const p = parts.filter(Boolean); return p.length ? `<span class="sc-ln">${p.join(' · ')}</span>` : ''; };
const roomOf = (s) => (s.mode === 'online' ? 'Online' : [s.bldg, s.room].filter((x) => x && !/^(ONLINE|LIVE|STREAM|TBA)$/i.test(x)).join(' ') || (s.mode === 'livestream' ? 'Live stream' : ''));

// ---------- the term bar: Past | Current | Future ----------
// Tim, 2026-10-23: "make past and future semesters be able to be selected at the top based on the user's
// wolverine track they uploaded ... Seperate Past, Current, and Future semesters in the top bar as the left,
// middle, and right sides of the page. (If the next semester's courses are open, put that in the current category)."
function schedTerms() {
  return splitTerms({
    sections: sched.terms,
    current: currentTermCode(),
    past: hasAudit() ? Object.values(state.settings.when || {}) : [],
    planned: (lastPlan?.semesters || []).map((s) => s.term),
  });
}
function drawTermBar(bar) {
  const btn = (c) => `<button type="button" data-term="${c}"${c === sched.term ? ' class="on" aria-pressed="true"' : ''}>${termInfo(c).short}</button>`;
  const group = (k, label) => `<div class="sc-tg tg-${k}"${bar[k].length ? '' : ' hidden'}><span class="sc-tl">${label}</span><div class="seg">${bar[k].map(btn).join('')}</div></div>`;
  $('scTerms').innerHTML = group('past', 'Past') + group('current', 'Current') + group('future', 'Future');
  // a phone scrolls the strip itself (never the page): keep the chosen term in view
  const strip = $('scTerms'), on = strip.querySelector('button.on');
  if (on && strip.scrollWidth > strip.clientWidth) {
    const r = on.getBoundingClientRect(), sr = strip.getBoundingClientRect();
    strip.scrollLeft += r.left + r.width / 2 - (sr.left + sr.width / 2);
  }
}
// a past or later term (no section times): its classes as a list, full width.
// Past = the audit's classes that term with their grades; later = the plan's semester with its status.
function drawTermList(code, past) {
  const label = termInfo(code).label;
  let rows = [];
  if (past) {
    const list = classesInTerm(state.settings.when, gradeMap(), code);
    if (!courseCat.ready && list.some((r) => !model?.program.courses?.[r.code])) loadCourses().then(() => { if (sched.term === code) drawTermList(code, past); });
    rows = list.map((r, i) => `<li><div class="sc-row lt" data-code="${esc(r.code)}"><span class="sw s${i % 10}"></span><span class="sc-main">${nameLine(r.code, schedName(r.code))}`
      + infoLine(r.grade ? `Grade ${gradeBadge(r.grade)}` : 'Taken', crLine(schedCredits(r.code))) + '</span></div></li>');
  } else {
    const sem = lastPlan?.semesters.find((s) => s.term === label);
    rows = (sem?.items || []).filter((it) => !milestone(it)).map((it, i) => {
      const course = it.kind === 'course' && it.code;
      const name = course ? nameLine(it.code, schedName(it.code, it.title)) : `<span class="sc-name"><b>${esc(reqLabel(it.label, unitOf(it.unitId) || it.unit))}</b></span>`;
      return `<li><div class="sc-row lt"${course ? ` data-code="${esc(it.code)}"` : ''}><span class="sw s${i % 10}"></span><span class="sc-main">${name}`
        + infoLine('Planned', crLine(it.credits)) + infoLine(esc(it.offered || '')) + '</span></div></li>';
    });
  }
  $('scWeek').innerHTML = '';
  $('scList').innerHTML = rows.length ? rows.join('') : `<li class="none">${past ? 'No classes from your audit this term' : 'Nothing planned this term'}</li>`;
}
const codeLabel = (sec) => `${sec.subj} ${sec.num}`;
function whyUnplaced(c) {
  if (!c.sections.length) return 'Not offered';
  if (!prefs().wait && courseOptions(c.sections).every((o) => o.secs.some((x) => x.seats <= 0))) return 'Full';
  return 'Doesn’t fit';
}
function drawList(s) {
  const t = termState(sched.term);
  // one block per class: the title first, then each fact on its own readable line, a line between classes
  // (Tim, 2026-10-23: "just put the class title and any relevant info below it and seperate the classes with lines")
  $('scList').innerHTML = sched.courses.map((c, i) => {
    const o = s?.picks[i];
    const sw = `<span class="sw s${i % 10}"></span>`;
    const name = nameLine(c.code, schedName(c.code, c.sections[0]?.title));
    if (!o) return `<li><button type="button" class="sc-row off" data-i="${i}">${sw}<span class="sc-main">${name}<span class="sc-ln why">${whyUnplaced(c)}</span></span></button></li>`;
    const sec = o.secs[0];
    return `<li><button type="button" class="sc-row" data-i="${i}">${sw}<span class="sc-main">${name}`
      + `<span class="sc-ln when">${esc(whenFull(sec))}</span>`
      + `<span class="sc-ln who">${esc(lastName(sec.instr))} ${ratingBadge(sec.instr)}</span>`
      + infoLine(esc(roomOf(sec)))
      + `<span class="sc-ln"><span class="crn${t.pin[c.code] ? ' pin' : ''}">CRN ${o.secs.map((x) => x.crn).join('+')}</span> · <span class="seat${sec.seats > 0 ? '' : ' full'}">${seatText(sec)}</span>${crLine(schedCredits(c.code, sec)) ? ` · ${crLine(schedCredits(c.code, sec))}` : ''}</span>`
      + '</span></button></li>';
  }).join('') + '<li class="sc-adds"><button type="button" class="sc-add" id="scAdd">+ Add class</button><button type="button" class="sc-add" data-mine>Add my schedule</button></li>' + schedSrc(sched.term);
}
function openCourse(i) {
  const c = sched.courses[i], t = termState(sched.term), s = sched.list[sched.idx];
  const others = (s?.picks || []).filter((o, k) => o && k !== i);
  const cur = new Set((s?.picks[i]?.secs || []).map((x) => x.crn));
  const pin = t.pin[c.code];
  const secs = c.sections.slice().sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999') || a.days.localeCompare(b.days) || a.sec.localeCompare(b.sec));
  $('secCode').textContent = c.code;
  $('secTitle').textContent = c.sections[0]?.title || '';
  $('secSrc').innerHTML = secSrc(c.code);
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
    $, esc, openDlg, save, toast, termState, termGroups, sched, drawWeek, ratingBadge, lastName, schedSrc, secSrc,
    nameLine, schedName, schedCredits, crLine, whenFull, roomOf,
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
  // Labels (Code / Title / Both) in the schedule's own controls: the same setting as the flowchart's
  $('scLbl').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b || b.dataset.v === labelsNow()) return;
    state.settings.labels = b.dataset.v;
    state.settings.labelsHand = true;
    save();
    renderLabels();
    renderSched();
  });
  // a semester heading in the plan opens the Schedule on that term (Tim, 2026-10-23: "if you click on the
  // semester title on the right side, bring the user straight to the schedule section with that specific
  // semester selected"). Back (and the back arrow) return to where it was tapped.
  $('sems').addEventListener('click', (e) => {
    const b = e.target.closest('button.sem-go');
    if (!b) return;
    const code = codeOfLabel(b.dataset.term);
    if (!code) return;
    sched.term = code;
    pushNav({ tab: 'sched', from: tabNow() });
    setTab('sched', false);
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

// ---------- the program picker (tap the major on Home, or Programs in Profile) ----------
let openPicker = () => {};
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
  openPicker = async () => {
    $('pickQ').value = '';
    openDlg(dlg);
    await loadCatalog();
    chosen(); list();
    $('pickList').scrollTop = 0;
    if (matchMedia('(hover: hover)').matches) $('pickQ').focus();
  };
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
  let extras = null;
  const read = async (text) => {
    parsed = parseAudit(text);
    // name, UVID, overall GPA, where AP / transfer credit came from: for "Fill my application" (this device only:
    // state.applyInfo is never synced, js/sync.js)
    extras = auditExtras(text);
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
    const when = (state.settings.when = { ...(state.settings.when || {}) }); // class code -> semester taken (hover label)
    // already-taken rows are disabled (can't be unticked) but still bring their grade from the audit
    for (const cb of $('impList').querySelectorAll('input:checked')) {
      const r = found.rows[+cb.dataset.i];
      if (r.status === 'ip' && !ipOn) continue;
      s.add(r.key);
      src[r.key] ??= 'audit';
      if (r.grade || !cb.disabled) grades[r.key] = r.grade || ''; // imported: kept even if its prereqs look unmet
      if (r.grade) src[r.key] = 'audit'; // the audit's grade wins (and is locked), also over one set by hand
      if (r.term) when[r.code] = r.term;
      // a Gen Ed box filled by an outside class: remember which class (its sheet and Classes show it)
      if (r.key !== r.code && !pickKeysOf(s, r.key).length) {
        s.add(`${r.key}=${r.code}`); s.add(r.code); src[r.code] ??= 'audit';
        if (r.grade) { grades[r.code] = r.grade; src[r.code] = 'audit'; }
      }
    }
    // classes outside the program (AP/transfer credit, classes the plan doesn't use): kept for Classes
    for (const r of found.others || []) {
      if (r.status === 'ip' && !ipOn) continue;
      if (!s.has(r.code)) { s.add(r.code); src[r.code] = 'audit'; }
      if (r.grade) { grades[r.code] = r.grade; src[r.code] = 'audit'; }
      if (r.term) when[r.code] = r.term;
    }
    // classes in progress (or already registered for next term): the plan starts after that semester
    // (set before setActual, which saves)
    if (parsed?.lastTerm) state.settings.lastTerm = termLabel(parsed.lastTerm);
    if (extras) state.applyInfo = extras;
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

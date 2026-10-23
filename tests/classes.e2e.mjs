// End-to-end: Classes view, Explore (taps are hypothetical), grades (guest, Firebase blocked, headless WebKit as an
// iPhone 15 via Playwright from ~/.claude/tools). Not part of the plain suite. Made-up classes only.
//   1. serve the repo:   python -m http.server 8137 --bind 127.0.0.1
//   2. run:              node --test tests/classes.e2e.mjs        (APP_URL=... for another address)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

const { webkit, devices } = createRequire(join(homedir(), '.claude/tools/'))('playwright');
const APP = process.env.APP_URL || 'http://localhost:8137/';
const browser = await webkit.launch({ headless: true });
after(() => browser.close());

const KEY = 'smart-advisor:v1';
const EE = 'electrical-engineering-bs';
// a made-up student: an imported audit (one class in progress, transfer credit, a Gen Ed pick, a class
// outside the program)
export const SEED = {
  plan: { programs: [EE], catalogYear: null },
  done: { [EE]: ['ENGL 1010', 'MATH 1210', 'MATH 1220', 'CHEM 1210', 'CHEM 1215', 'ECE 1000', 'ECE 2250', 'ECE 2255', 'ph:7', 'ph:7=DANC 1010', 'DANC 1010', 'PSY 1010', 'ART 2000'] },
  grades: { [EE]: { 'ENGL 1010': 'TCR', 'MATH 1210': 'A', 'MATH 1220': 'B+', 'CHEM 1210': 'B', 'CHEM 1215': 'A-', 'ECE 1000': 'A', 'ECE 2250': 'IP', 'ECE 2255': 'IP', 'DANC 1010': 'B', 'PSY 1010': 'TCR', 'ART 2000': 'C+' } },
  settings: { max: 16, summers: false, start: null, grades: true, src: { [EE]: { 'ENGL 1010': 'audit', 'MATH 1210': 'audit', 'MATH 1220': 'audit', 'ECE 2250': 'audit', 'ECE 2255': 'audit', 'PSY 1010': 'audit' } } },
};
async function page(saved) {
  const ctx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
  await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.abort());
  await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(saved)]);
  const p = await ctx.newPage();
  // the app opens on Home (2026-10-22); these checks start on the flowchart, as they did before Home
  { const go = p.goto.bind(p); p.goto = async (...a) => { const r = await go(...a); await p.evaluate(() => { if (document.querySelector('#main')?.dataset.tab === 'home') document.querySelector('#hmGo [data-go="flow"]')?.click(); }); return r; }; }
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  return p;
}
const stored = (p) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), KEY);
const box = (p, id) => p.$(`.box[data-id="${id}"]`);
const pressed = async (p, id) => (await (await box(p, id)).getAttribute('aria-pressed')) === 'true';

test('an Explore tap is hypothetical: Actual progress shows the real classes, untapping an audit class keeps it and its grade', async () => {
  const p = await page(SEED);
  await p.goto(APP);
  await p.waitForSelector('.box[data-id="MATH 1210"]');
  assert.equal(await p.isVisible('#hypClear'), false, 'no clear outside Explore');
  // in progress: its own look, an IP tag
  assert.match(await (await box(p, 'ECE 2250')).getAttribute('class'), /\bip\b/);
  assert.equal(await p.textContent('.box[data-id="ECE 2250"] .gr'), 'IP');
  assert.doesNotMatch(await (await box(p, 'MATH 1210')).getAttribute('class'), /\bip\b/);
  // folded lab box: the lower of the two grades (B vs A-)
  assert.equal(await p.textContent('.box[data-id="CHEM 1210"] .gr'), 'B');
  // the Gen Ed box shows its class's grade
  assert.equal(await p.textContent('.box[data-id="ph:7"] .gr'), 'B');
  // in Explore, untap an audit class (MATH 1220): hidden in Explore only
  await p.click('#exploreBtn');
  await p.click('.box[data-id="MATH 1220"]');
  assert.equal(await pressed(p, 'MATH 1220'), false);
  assert.equal(await p.isVisible('#hypClear'), true, 'clear next to it while exploring');
  let s = await stored(p);
  assert.ok(s.done[EE].includes('MATH 1220'), 'actual list untouched');
  assert.equal(s.grades[EE]['MATH 1220'], 'B+', 'grade kept');
  assert.deepEqual(s.settings.hypo[EE].del, ['MATH 1220']);
  // tap a new class on
  await p.click('.box[data-id="PHYS 2210"]');
  assert.equal(await pressed(p, 'PHYS 2210'), true);
  // Actual progress: no taps
  await p.click('#exploreBtn');
  assert.equal(await pressed(p, 'MATH 1220'), true, 'Actual shows the audit class');
  assert.equal(await pressed(p, 'PHYS 2210'), false, 'Actual has no taps');
  assert.equal(await p.textContent('.box[data-id="MATH 1220"] .gr'), 'B+');
  await p.click('#exploreBtn');
  assert.equal(await pressed(p, 'PHYS 2210'), true, 'the taps are still there in Explore');
  // clear them, then Undo
  await p.click('#hypClear');
  assert.equal(await pressed(p, 'MATH 1220'), true);
  await p.click('#toastUndo');
  assert.equal(await pressed(p, 'MATH 1220'), false);
  // the taps survive a reload (saved with the account's settings); the site opens on actual progress
  await p.reload();
  await p.waitForSelector('#main[data-tab="flow"] .box[data-id="MATH 1210"]');
  assert.equal(await p.textContent('#exploreBtn'), 'Explore');
  assert.equal(await pressed(p, 'PHYS 2210'), false);
  await p.click('#exploreBtn');
  assert.equal(await pressed(p, 'PHYS 2210'), true);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('Classes: grouped, GPA, add a class (applies to the flowchart), edit its grade, remove with Undo', async () => {
  const p = await page(SEED);
  await p.goto(APP);
  await p.waitForSelector('.box[data-id="MATH 1210"]');
  await goTab(p, 'plan');
  await p.click('#planSeg button[data-v="classes"]');
  await p.waitForSelector('#clList .cl-row');
  const groups = await p.$$eval('#clList .cl-h', (els) => els.map((e) => e.firstChild.textContent));
  assert.deepEqual(groups, ['Taken', 'AP/CE', 'Current', 'Still need', 'Not used by your plan']);
  const rowsOf = (name) => p.$$eval('#clList li', (els, n) => {
    const out = []; let on = false;
    for (const e of els) { if (e.classList.contains('cl-h')) { on = e.firstChild.textContent === n; continue; } if (on) out.push(e.querySelector('b')?.textContent); }
    return out;
  }, name);
  assert.deepEqual(await rowsOf('AP/CE'), ['ENGL 1010', 'PSY 1010']);
  assert.deepEqual(await rowsOf('Current'), ['ECE 2250', 'ECE 2255']);
  assert.deepEqual(await rowsOf('Not used by your plan'), ['ART 2000']);
  assert.ok((await rowsOf('Taken')).includes('DANC 1010'));
  assert.ok((await rowsOf('Still need')).includes('PHYS 2210'));
  // GPA: A 4 cr (MATH 1210), B+ 4 (MATH 1220), B 4 (CHEM 1210), A- 1 (CHEM 1215), A 1 (ECE 1000), B 3 (DANC 1010), C+ 3 (ART 2000)
  assert.match(await p.textContent('#clGpa'), /GPA \d\.\d\d/);
  // add MATH 2210 as Taken with an A-
  await p.click('#clAdd');
  await p.waitForSelector('#editDlg[open]');
  await p.fill('#edQ', 'math 2210');
  await p.click('#edList button[data-code="MATH 2210"]');
  await p.selectOption('#edGrade', 'A-');
  await p.click('#edSave');
  let s = await stored(p);
  assert.ok(s.done[EE].includes('MATH 2210'), 'added to the actual list');
  assert.equal(s.settings.src[EE]['MATH 2210'], 'added');
  assert.equal(s.grades[EE]['MATH 2210'], 'A-');
  assert.equal(await p.textContent('#exploreBtn'), 'Explore', 'adding is not Explore');
  assert.ok((await rowsOf('Taken')).includes('MATH 2210'));
  // edit: make it Current
  const row = await p.$('#clList .cl-row:has(b:text-is("MATH 2210"))');
  await row.click();
  await p.click('#edSeg button[data-s="ip"]');
  await p.click('#edSave');
  assert.equal((await stored(p)).grades[EE]['MATH 2210'], 'IP');
  assert.ok((await rowsOf('Current')).includes('MATH 2210'));
  // remove, then Undo
  await (await p.$('#clList .cl-row:has(b:text-is("MATH 2210"))')).click();
  await p.click('#edRemove');
  assert.ok(!(await stored(p)).done[EE].includes('MATH 2210'));
  await p.click('#toastUndo');
  assert.ok((await stored(p)).done[EE].includes('MATH 2210'));
  // the flowchart shows it
  await goTab(p, 'flow');
  assert.equal(await pressed(p, 'MATH 2210'), true);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('class sheet: pick a grade; outside Explore its Taken switch marks the actual class; Explore hides grades', async () => {
  const p = await page(SEED);
  await p.goto(APP);
  await p.waitForSelector('.box[data-id="ECE 1000"]');
  // no taps: the class sheet of a taken class (right-click = hold) has its grade picker
  await p.click('.box[data-id="ECE 1000"]', { button: 'right' });
  await p.waitForSelector('#clsDlg[open]');
  assert.equal(await p.$$eval('#clsGrades select', (x) => x.length), 1);
  await p.selectOption('#clsGrades select[data-code="ECE 1000"]', 'B-');
  await p.click('#clsDlg button.ok');
  assert.equal(await p.textContent('.box[data-id="ECE 1000"] .gr'), 'B-');
  // a Still need row's sheet, outside Explore: the Taken switch adds the class to the actual ones (grade picker)
  await goTab(p, 'plan');
  await p.click('#planSeg button[data-v="classes"]');
  await p.waitForSelector('#clList .cl-row');
  // (a selector click, not a held element: the list renders again once the course catalog arrives)
  await p.click('#clList .cl-row:has(b:text-is("PHYS 2210"))');
  await p.waitForSelector('#clsDlg[open]');
  assert.equal(await p.$$eval('#clsGrades select', (x) => x.length), 0);
  await p.click('#clsTaken');
  assert.equal(await p.$$eval('#clsGrades select', (x) => x.length), 2, 'an actual class: grade pickers (lecture + its lab)');
  const s = await stored(p);
  assert.ok(s.done[EE].includes('PHYS 2210'));
  assert.equal(s.settings.src[EE]['PHYS 2210'], 'added');
  await p.click('#clsDlg button.ok');
  await goTab(p, 'flow');
  assert.equal(await pressed(p, 'PHYS 2210'), true);
  // Explore: no grades; untap + tap there keeps the grade
  await p.click('#exploreBtn');
  assert.equal(await p.textContent('.box[data-id="ECE 1000"] .gr'), '', 'Explore: no grade');
  await p.click('.box[data-id="ECE 1000"]');
  await p.click('.box[data-id="ECE 1000"]');
  assert.equal((await stored(p)).grades[EE]['ECE 1000'], 'B-', 'grade kept through untap + tap');
  await p.click('#exploreBtn');
  assert.equal(await p.textContent('.box[data-id="ECE 1000"] .gr'), 'B-', 'Actual shows it');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('no audit loaded: one line on the flowchart and in Classes, linked to Upload and Sign in', async () => {
  const p = await page({ plan: { programs: [EE], catalogYear: null }, done: { [EE]: ['ENGL 1010'] } });
  await p.goto(APP);
  await p.waitForSelector('.box[data-id="MATH 1210"]');
  assert.match(await p.textContent('#flowPanel .noaud'), /No audit loaded — Upload or Sign in/);
  assert.equal(await p.isVisible('#flowPanel .noaud'), true);
  await p.click('#flowPanel .noaud [data-upload]');
  await p.waitForSelector('#importDlg[open]');
  assert.deepEqual(p.errors, []);
  await p.context().close();
  // an imported audit: no line
  const q = await page(SEED);
  await q.goto(APP);
  await q.waitForSelector('.box[data-id="MATH 1210"]');
  assert.equal(await q.isVisible('#flowPanel .noaud'), false);
  await q.context().close();
});

// sections open from Home's rows (2026-10-23: no tab bar): back to Home, then the section's row
// (2026-10-23: no Plan or Profile box on Home. The plan is the Flowchart's "Plan" view on a phone (the Chart | Plan
// switch) and sits beside the chart on a laptop; the profile is the circle's menu, top right)
async function goTab(p, tab) {
  if (await p.getAttribute('#main', 'data-tab') !== 'home') { await p.click('#back'); await p.waitForSelector('#main[data-tab="home"]'); }
  if (tab === 'profile') { await p.click('#profile'); await p.waitForSelector('#pfDlg[open]'); return; }
  const go = tab === 'plan' ? 'flow' : tab;
  await p.click(`#hmGo [data-go="${go}"]`);
  await p.waitForSelector(`#main[data-tab="${go}"]`);
  if (tab === 'plan' && await p.isVisible('#fpSeg')) { await p.click('#fpSeg [data-v="plan"]'); await p.waitForSelector('#main[data-tab="plan"]'); }
}
// the gear (site settings) lives on Home
async function openGear(p) {
  if (await p.getAttribute('#main', 'data-tab') !== 'home') { await p.click('#back'); await p.waitForSelector('#main[data-tab="home"]'); }
  await p.click('#gear');
  await p.waitForSelector('#settings[open]');
}

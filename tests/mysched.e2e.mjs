// "My schedule" end to end (guest, Firebase blocked, headless WebKit as an iPhone 15). Not in the plain suite.
//   1. serve the repo:   python -m http.server 8137 --bind 127.0.0.1
//   2. run:              node --test tests/mysched.e2e.mjs        (APP_URL=... for another address)
// Uses the real data/sections/202640.json (Fall 2026); the page's clock is pinned to 2026-10-17.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const { webkit, devices } = createRequire(join(homedir(), '.claude/tools/'))('playwright');
const APP = process.env.APP_URL || 'http://localhost:8137/';
const browser = await webkit.launch({ headless: true });
after(() => browser.close());

const KEY = 'smart-advisor:v1';
const SAVED = {
  plan: { programs: ['electrical-engineering-bs'], catalogYear: null },
  done: { 'electrical-engineering-bs': ['ENGL 1010', 'ECE 2250', 'MATH 2210'] },
  grades: { 'electrical-engineering-bs': { 'ECE 2250': 'IP', 'MATH 2210': 'IP' } },
  settings: { max: 16, summers: false, start: null, grades: true, lastTerm: 'Fall 2026' },
};
const CONCISE = readFileSync(new URL('./fixtures/reg/concise.txt', import.meta.url), 'utf8');

async function page(saved, opts = {}) {
  const ctx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block', ...opts });
  await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.abort());
  await ctx.addInitScript(() => { const T = new Date('2026-10-17T12:00:00').getTime(), D = Date; globalThis.Date = class extends D { constructor(...a) { super(...(a.length ? a : [T])); } static now() { return T; } }; });
  await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(saved)]);
  const p = await ctx.newPage();
  // the app opens on Home (2026-10-22); these checks start on the flowchart, as they did before Home
  { const go = p.goto.bind(p); p.goto = async (...a) => { const r = await go(...a); await p.evaluate(() => { if (document.querySelector('#main')?.dataset.tab === 'home') document.querySelector('#hmGo [data-go="flow"]')?.click(); }); return r; }; }
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  return p;
}
const stored = (p) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), KEY);
const rows = (p) => p.$$eval('#scList .sc-row', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));

test('current term prefills from the audit; pick a section; paste replaces; Undo restores', async () => {
  const p = await page(SAVED);
  await p.goto(APP);
  await p.waitForSelector('.box[data-id="MATH 1210"]');
  await goTab(p, 'sched');
  await p.click('#scTerms button[data-term="202640"]');
  await p.waitForSelector('#schedPanel.mine #scList .sc-row');
  let r = await rows(p);
  assert.equal(r.length, 2);
  assert.match(r[0], /ECE 2250 .*14896/, 'one section: filled in');
  assert.match(r[1], /MATH 2210 Pick your section/, 'several sections: pick');
  assert.ok(await p.isVisible('#scMine'), 'Add my schedule in the bar');
  assert.ok(!(await p.isVisible('.sc-nav')), 'no schedule ranking for the current term');
  // pick a section
  await p.click('#scList .sc-row[data-mi="1"]');
  await p.click('#mySecList button[data-crn="39625"]');
  await p.waitForFunction(() => /39625/.test(document.querySelector('#scList').innerText));
  assert.equal(await p.$$eval('#scWeek .wk-b', (e) => e.length), 2 + 4, 'ECE 2250 MW + MATH 2210 MTWR on the grid');
  assert.deepEqual((await stored(p)).settings.sched.terms['202640'].mine, [{ code: 'ECE 2250', crn: '14896' }, { code: 'MATH 2210', crn: '39625' }]);
  // paste the registration page
  await p.click('#scMine');
  await p.fill('#myText', CONCISE);
  await p.click('#myGo');
  await p.waitForSelector('#myStep2:not([hidden]) #myList li');
  assert.match(await p.textContent('#mySum'), /Fall 2026 · 3 classes/);
  await p.click('#myGo');
  await p.waitForFunction(() => /36452/.test(document.querySelector('#scList').innerText));
  r = await rows(p);
  assert.deepEqual(await p.$$eval('#scList .sc-name small', (els) => els.map((e) => e.textContent)), ['ECE 2250', 'PHYS 2220', 'HIST 2700']);
  assert.match(r[2], /CB 214/, 'room shown');
  // Undo puts the picked schedule back
  await p.click('#toastUndo');
  await p.waitForFunction(() => /39625/.test(document.querySelector('#scList').innerText));
  assert.deepEqual((await stored(p)).settings.sched.terms['202640'].mine.map((e) => e.crn), ['14896', '39625']);
  // no page scroll on the Schedule tab
  assert.ok(await p.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight + 1), 'no page scroll');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('unmatched class added by hand shows on the grid', async () => {
  const p = await page(SAVED);
  await p.goto(APP);
  await p.waitForSelector('.box[data-id="MATH 1210"]');
  await goTab(p, 'sched');
  await p.click('#scTerms button[data-term="202640"]');
  await p.waitForSelector('#schedPanel.mine #scList .sc-row');
  await p.click('#scMine');
  await p.fill('#myText', 'Fall 2026\nECE 2250, 601\t3\t14896\nECE 3990, 001\t3\t55555');
  await p.click('#myGo');
  await p.waitForSelector('#myList li.miss');
  await p.click('#myList button[data-u="0"]');
  assert.equal(await p.inputValue('#handCode'), 'ECE 3990');
  await p.fill('#handDays', 'Tu Th');
  await p.fill('#handStart', '09:30');
  await p.fill('#handEnd', '10:45');
  await p.click('#handSave');
  await p.click('#myGo');
  await p.waitForFunction(() => /ECE 3990/.test(document.querySelector('#scList').innerText));
  assert.equal(await p.$$eval('#scWeek .wk-b', (e) => e.length), 2 + 2);
  assert.deepEqual((await stored(p)).settings.sched.terms['202640'].mine[1], { code: 'ECE 3990', days: 'TR', start: '0930', end: '1045', hand: 1 });
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('the next term still builds schedules from the plan', async () => {
  const p = await page(SAVED);
  await p.goto(APP);
  await p.waitForSelector('.box[data-id="MATH 1210"]');
  await goTab(p, 'sched');
  await p.waitForSelector('#scTerms button.on');
  await p.waitForSelector('#scList [data-mine]');
  assert.equal(await p.getAttribute('#scTerms button.on', 'data-term'), '202720');
  assert.ok(!(await p.$eval('#schedPanel', (e) => e.classList.contains('mine'))));
  assert.ok(await p.isVisible('.sc-nav'));
  assert.ok(await p.$('#scList [data-mine]'), 'Add my schedule at the end of the list');
  assert.deepEqual(p.errors, []);
  await p.context().close();
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

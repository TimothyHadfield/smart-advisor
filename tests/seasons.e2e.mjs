// Seasons on the rendered page (headless WebKit, iPhone 15): a Spring-only class's sheet says so in its own
// "Offered" row, linked to UVU's class search (js/sources.js), and the plan puts it in a Spring.
//   1. serve the repo:   python -m http.server 8137 --bind 127.0.0.1
//   2. run:              node --test tests/seasons.e2e.mjs        (APP_URL=... for another address)
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
async function page(saved) {
  const ctx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
  await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.abort());
  await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(saved)]);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  return p;
}
const EE = { plan: { programs: ['electrical-engineering-bs'], catalogYear: null }, done: { 'electrical-engineering-bs': ['ENGL 1010'] } };

test('ECE 3780: planned in a Spring; its sheet has an "Offered" row linked to UVU class search', async () => {
  const p = await page(EE);
  await p.goto(APP + '?p=electrical-engineering-bs');
  await goTab(p, 'plan');
  const row = await p.waitForSelector('#sems li[data-item="ECE 3780"]');
  assert.match(await row.evaluate((li) => li.closest('.sem').querySelector('h3').textContent), /^Spring \d{4}/);
  await row.click();
  await p.waitForSelector('#clsDlg[open]');
  const facts = await p.$$eval('#clsFacts dt', (dts) => dts.map((dt) => ({ k: dt.textContent, v: dt.nextElementSibling.textContent, a: [...dt.nextElementSibling.querySelectorAll('a')].map((a) => a.getAttribute('href')) })));
  const off = facts.find((f) => f.k === 'Offered');
  assert.ok(off, JSON.stringify(facts));
  assert.match(off.v, /Spring only/);
  // (2026-10-23: the sheet's sources are one small line under the rows; the class search is one of them)
  const src = await p.$$eval('#clsSrc a', (as) => as.map((a) => a.getAttribute('href')));
  assert.ok(src.some((h) => /userve\.uvu\.edu\/StudentRegistrationSsb/.test(h)), JSON.stringify(src));
  assert.doesNotMatch(facts.find((f) => f.k === 'Counts for')?.v || '', /Usually/);
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

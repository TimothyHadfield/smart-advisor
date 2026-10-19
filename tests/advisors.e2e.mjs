// "Schedule with an advisor" links where a class waits on program admission (headless WebKit, iPhone 15).
//   1. serve the repo:   python -m http.server 8137 --bind 127.0.0.1
//   2. run:              node --test tests/advisors.e2e.mjs        (APP_URL=... for another address)
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
const ECE = 'https://www.uvu.edu/cet/advising/ece/index.html';
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

test('EE: admission line, Apply row and a gated class sheet link to the ECE advisors (new tab)', async () => {
  const p = await page(EE);
  await p.goto(APP + '?p=electrical-engineering-bs');
  await p.waitForSelector('.box[data-id="MATH 1210"]');
  await p.waitForSelector('#sum .adm a.adv', { state: 'attached' });
  const links = await p.$$eval('#sum a.adv, #sems .apply a.adv', (as) => as.map((a) => [a.textContent, a.getAttribute('href'), a.target, a.closest('.apply') ? 'apply' : a.closest('.adm') ? 'adm' : 'sum']));
  assert.ok(links.some(([t, h, tg, w]) => w === 'adm' && t === 'Schedule with an advisor' && h === ECE && tg === '_blank'), JSON.stringify(links));
  assert.ok(links.some(([t, h, , w]) => w === 'apply' && t === 'Schedule with an advisor' && h === ECE), JSON.stringify(links));
  assert.equal(await p.getAttribute('#sumAdvisor', 'href'), ECE, 'permanent "your advisor" link');
  // a class gated on acceptance into the program: its sheet's Needs row
  await p.click('.box[data-id="ECE 3250"]', { button: 'right' });
  await p.waitForSelector('#clsDlg[open]');
  const dd = await p.$$eval('#clsFacts dd', (ds) => ds.map((d) => [d.textContent, d.querySelector('a.adv')?.getAttribute('href') || null]));
  assert.ok(dd.some(([t, h]) => /Acceptance/i.test(t) && h === ECE), JSON.stringify(dd));
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('a class with no admission gate has no advisor link in its sheet', async () => {
  const p = await page(EE);
  await p.goto(APP + '?p=electrical-engineering-bs');
  await p.waitForSelector('.box[data-id="MATH 1210"]');
  await p.click('.box[data-id="MATH 1210"]', { button: 'right' });
  await p.waitForSelector('#clsDlg[open]');
  assert.equal(await p.$('#clsFacts a.adv'), null);
  await p.context().close();
});

test('Nursing BS: the permanent advisor link goes to Nursing advising', async () => {
  const p = await page({ plan: { programs: ['nursing-bs'], catalogYear: null }, done: {} });
  await p.goto(APP + '?p=nursing-bs');
  await p.waitForSelector('#sumAdvisor', { state: 'attached' });
  assert.equal(await p.getAttribute('#sumAdvisor', 'href'), 'https://www.uvu.edu/nursing/advising.html');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

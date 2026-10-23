// "Fill my application" (Matriculation sheet -> answer sheet), headless WebKit (iPhone 15 + laptop).
//   1. serve the repo:   python -m http.server 8137 --bind 127.0.0.1
//   2. run:              node --test tests/application.e2e.mjs        (APP_URL=... for another address)
// Uses the made-up audit tests/fixtures/apply-audit.txt (never the real one in .claude/test/).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { webkit, devices } = createRequire(join(homedir(), '.claude/tools/'))('playwright');
const APP = process.env.APP_URL || 'http://localhost:8137/';
const AUDIT = readFileSync(fileURLToPath(new URL('./fixtures/apply-audit.txt', import.meta.url)), 'utf8');
const ADV = JSON.parse(readFileSync(fileURLToPath(new URL('../data/advisors.json', import.meta.url)), 'utf8')).programs;
const browser = await webkit.launch({ headless: true });
after(() => browser.close());

const KEY = 'smart-advisor:v1';
async function page(saved, phone = true) {
  const ctx = await browser.newContext({ ...(phone ? devices['iPhone 15'] : { viewport: { width: 1440, height: 900 } }), serviceWorkers: 'block' });
  await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.abort());
  if (saved) await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(saved)]);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  return p;
}
const toFlow = async (p) => { if (await p.getAttribute('#main', 'data-tab') !== 'flow') { if (await p.getAttribute('#main', 'data-tab') !== 'home') await p.click('#back'); await p.click('#hmGo [data-go="flow"]'); } };
async function openApp(p) {
  await p.waitForSelector('#matricBtn:not([hidden])', { state: 'attached' });
  await p.click('#matricBtn');
  await p.waitForSelector('#matDlg[open]');
  await p.waitForSelector('#matApply:not([hidden])');
  await p.click('#matApply');
  await p.waitForSelector('#appDlg[open]');
}
const fields = (p) => p.$$eval('#appFields dt', (ds) => Object.fromEntries(ds.map((d) => [d.textContent, d.nextElementSibling.querySelector('[data-copy]')?.dataset.copy ?? d.nextElementSibling.textContent])));
const rows = (p) => p.$$eval('#appRows li', (ls) => Object.fromEntries(ls.map((l) => [l.querySelector('b').textContent, [...l.querySelectorAll('[data-copy]')].map((b) => b.dataset.copy).join(' | ') || l.textContent.replace(l.querySelector('b').textContent, '')])));

test('EE (phone): import an audit, Matriculation -> Fill my application shows the answers in the form order with copy buttons', async () => {
  const p = await page({ plan: { programs: ['electrical-engineering-bs'], catalogYear: null }, done: {}, settings: { name: 'Jane Doe' } });
  await p.goto(APP + '?p=electrical-engineering-bs');
  await p.waitForSelector('.box[data-id="MATH 1210"]', { state: 'attached' });
  if (await p.getAttribute('#main', 'data-tab') !== 'home') await p.click('#back');
  await p.click('#gear');
  await p.waitForSelector('#settings[open]');
  await p.click('#importBtn');
  await p.fill('#impText', AUDIT);
  await p.click('#impGo');
  await p.waitForSelector('#impStep2:not([hidden])');
  await p.click('#impGo');
  await p.waitForFunction(() => !document.getElementById('importDlg').open);
  await p.waitForTimeout(500);
  await toFlow(p);
  await openApp(p);
  const f = await fields(p);
  assert.deepEqual(Object.keys(f), ['Last Name', 'First Name', 'Date', 'UVID', 'Email', 'Phone', 'Address', 'Cumulative GPA', 'Catalog Year', 'Advisor Name']);
  assert.equal(f['Last Name'], 'Doe');
  assert.equal(f['First Name'], 'Jane');
  assert.equal(f.UVID, '10000001');
  assert.equal(f.Email, '10000001@uvu.edu');
  assert.equal(f['Cumulative GPA'], '3.21');
  assert.equal(f['Catalog Year'], '2025-2026');
  assert.equal(f['Advisor Name'], 'Emmery Leach');
  assert.equal(f.Phone, 'Type yourself');
  assert.equal(f.Address, 'Type yourself');
  const r = await rows(p);
  assert.equal(r['MATH 1210'], 'Summer 2025 | TCR | AP Calculus BC | College Board');
  assert.equal(r['PHYS 2225'], 'Fall 2026 | IP');
  assert.equal(r['ECE 2700'], 'Not taken');
  assert.equal(await p.$eval('#appTypical', (e) => e.hidden), true, 'the real form: no "Typical fields" line');
  assert.ok((await p.$$('#appDlg button[data-copy]')).length >= 20, 'a copy button per value');
  // readiness: green / amber / red chips, GPA, deadline
  assert.ok(await p.$('#appReady .mt.ok'));
  assert.ok(await p.$('#appReady .mt.ip'));
  assert.ok(await p.$('#appReady .mt.low'));
  assert.ok(await p.$('#appReady .mt.missing'));
  assert.match(await p.$eval('#appReady', (e) => e.textContent), /3\.21 · needs 2\.5 ✓/);
  // steps link the official page (Start Application there)
  const hrefs = await p.$$eval('#appSteps a', (as) => as.map((a) => a.href));
  assert.ok(hrefs.includes(ADV['electrical-engineering-bs'].admissionUrl), hrefs.join(' '));
  assert.match(await p.$eval('#appSteps', (e) => e.textContent), /Start Application/);
  // a copy button: its icon becomes a check; nothing moves
  const b = await p.$('#appFields button[data-copy]');
  const w0 = await b.evaluate((e) => e.getBoundingClientRect().width);
  await b.click();
  await p.waitForSelector('#appFields button.copied');
  assert.ok(Math.abs(await b.evaluate((e) => e.getBoundingClientRect().width) - w0) < 1, 'same size after copying');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal page overflow');
  // Back -> the Matriculation sheet again
  await p.click('#appBack');
  await p.waitForSelector('#matDlg[open]');
  assert.equal(await p.$('#appDlg[open]'), null);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('another gated program (laptop): typical fields from its catalog list, labelled to check against the real form', async () => {
  const p = await page({ plan: { programs: ['civil-engineering-bs'], catalogYear: null }, done: { 'civil-engineering-bs': ['MATH 1210'] } }, false);
  await p.goto(APP + '?p=civil-engineering-bs');
  await toFlow(p);
  await openApp(p);
  assert.equal(await p.$eval('#appTypical', (e) => e.hidden), false);
  assert.match(await p.textContent('#appTypical'), /Typical fields/);
  const f = await fields(p);
  assert.deepEqual(Object.keys(f), ['Last Name', 'First Name', 'Date', 'UVID', 'Email', 'Phone', 'Cumulative GPA', 'Catalog Year']);
  assert.equal(f.UVID, 'Type yourself');
  const r = await rows(p);
  assert.ok(Object.keys(r).includes('MATH 2250'), Object.keys(r).join(','));
  assert.ok((await p.$$eval('#appSteps a', (as) => as.map((a) => a.href))).includes(ADV['civil-engineering-bs'].admissionUrl));
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('a gated program without an application page: no "Fill my application"; none in Explore either', async () => {
  const p = await page({ plan: { programs: ['art-design-bfa-graphic-design-emphasis'], catalogYear: null }, done: {} }, false);
  await p.goto(APP + '?p=art-design-bfa-graphic-design-emphasis');
  await toFlow(p);
  await p.waitForSelector('#matricBtn:not([hidden])', { state: 'attached' });
  await p.click('#matricBtn');
  await p.waitForSelector('#matDlg[open]');
  assert.equal(await p.$eval('#matApply', (b) => b.hidden), true);
  await p.context().close();
  const q = await page({ plan: { programs: ['electrical-engineering-bs'], catalogYear: null }, done: {} }, false);
  await q.goto(APP + '?p=electrical-engineering-bs');
  await toFlow(q);
  await q.click('#exploreBtn');
  await q.waitForSelector('#matricBtn:not([hidden])', { state: 'attached' });
  await q.click('#matricBtn');
  await q.waitForSelector('#matDlg[open]');
  assert.equal(await q.$eval('#matApply', (b) => b.hidden), true, 'Explore shows nothing personal');
  assert.deepEqual(q.errors, []);
  await q.context().close();
});

// The dotted matriculation line and its "Matriculation" label -> sheet (headless WebKit, iPhone 15 + laptop).
//   1. serve the repo:   python -m http.server 8137 --bind 127.0.0.1
//   2. run:              node --test tests/matric.e2e.mjs        (APP_URL=... for another address)
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
async function page(saved, phone = true) {
  const ctx = await browser.newContext({ ...(phone ? devices['iPhone 15'] : { viewport: { width: 1440, height: 900 } }), serviceWorkers: 'block' });
  await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.abort());
  await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(saved)]);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  return p;
}
const EE = { plan: { programs: ['electrical-engineering-bs'], catalogYear: null }, done: { 'electrical-engineering-bs': ['MATH 1210', 'ENGL 1010'] } };

test('EE (laptop): dotted line between MATH 1210 and ECE 3250; the label is a button in view and opens the sheet', async () => {
  const p = await page(EE, false);
  await p.goto(APP + '?p=electrical-engineering-bs');
  await p.waitForSelector('.box[data-id="ECE 3250"]');
  await p.waitForSelector('path.matric', { state: 'attached' });
  const g = await p.evaluate(() => {
    const x = +document.querySelector('path.matric').getAttribute('d').match(/^M([\d.]+)/)[1];
    const box = (id) => { const b = document.querySelector(`.box[data-id="${id}"]`); return { l: b.offsetLeft, r: b.offsetLeft + b.offsetWidth }; };
    const lbl = document.getElementById('matricBtn'), lr = lbl.getBoundingClientRect(), cr = document.getElementById('chart').getBoundingClientRect();
    return { x, math: box('MATH 1210'), ece: box('ECE 3250'), tag: lbl.tagName, type: lbl.type, text: lbl.textContent, h: lr.height, inView: lr.top >= cr.top && lr.bottom <= cr.bottom && lr.left >= cr.left && lr.right <= cr.right,
      dash: getComputedStyle(document.querySelector('path.matric')).strokeDasharray };
  });
  assert.ok(g.math.r < g.x && g.x < g.ece.l, JSON.stringify(g));
  assert.equal(g.tag, 'BUTTON'); assert.equal(g.type, 'button'); assert.equal(g.text, 'Matriculation');
  assert.ok(g.inView, 'label visible without scrolling');
  assert.notEqual(g.dash, 'none', 'dotted');
  // touch target: the label's hit area is at least 44px tall
  const hit = await p.evaluate(() => { const b = document.getElementById('matricBtn').getBoundingClientRect(); const s = getComputedStyle(document.getElementById('matricBtn'), '::before'); return b.height - parseFloat(s.top) - parseFloat(s.bottom); });
  assert.ok(hit >= 44, `hit area ${hit}px`);
  await p.click('#matricBtn');
  await p.waitForSelector('#matDlg[open]');
  const rows = await p.$$eval('#matFacts dt', (ds) => ds.map((d) => [d.textContent, d.nextElementSibling.textContent]));
  const row = (k) => (rows.find(([t]) => t === k)?.[1] || '').replace(/ ↗$/, ''); // ↗ = the catalog source link (js/sources.js)
  assert.match(row('Catalog'), /To be admitted to the BSEE program/);
  assert.equal(row('GPA'), '2.5 or higher');
  assert.equal(row('Grade'), 'C or higher in these classes');
  assert.match(row('Before'), /^1 of 12 done/);
  for (const c of ['MATH 1210 ✓', 'MATH 1220', 'PHYS 2210', 'CS 1400', 'ECE 1000', 'ECE 2700', 'ECE 2250', 'ECE 2255']) assert.ok(row('Before').includes(c), `${c} in ${row('Before')}`);
  for (const c of ['ECE 3250', 'ECE 3350', 'ECE 3450', 'ECE 3730', 'ECE 4250', 'ECE 4810R']) assert.ok(row('Needs it').includes(c), `${c} needs it`);
  assert.ok(row('After it').includes('ECE 4900'), 'a class that waits on gated ones');
  assert.equal(row('Deadline'), 'Not in the catalog');
  assert.ok(await p.$('#matFacts a.adv'), 'advisor link');
  assert.match(await p.getAttribute('#matCat', 'href'), /electrical-engineering-bs\/#:~:text=/);
  // Done closes it
  await p.click('#matDlg button.ok');
  assert.equal(await p.$('#matDlg[open]'), null);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('EE (phone): keyboard / Enter on the label opens the sheet; Back closes it', async () => {
  const p = await page(EE);
  await p.goto(APP + '?p=electrical-engineering-bs');
  await p.waitForSelector('#matricBtn:not([hidden])', { state: 'attached' });
  await p.focus('#matricBtn');
  await p.keyboard.press('Enter');
  await p.waitForSelector('#matDlg[open]');
  await p.goBack();
  await p.waitForFunction(() => !document.getElementById('matDlg').open);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal page overflow');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('a program without matriculation shows no line and no label', async () => {
  const p = await page({ plan: { programs: ['mathematics-emphasis-bs'], catalogYear: null }, done: {} }, false);
  await p.goto(APP + '?p=mathematics-emphasis-bs');
  await p.waitForSelector('.box');
  assert.equal(await p.$('path.matric'), null);
  assert.equal(await p.$eval('#matricBtn', (b) => b.hidden), true);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

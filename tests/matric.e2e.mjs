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
  // the app opens on Home (2026-10-22); these checks start on the flowchart, as they did before Home
  { const go = p.goto.bind(p); p.goto = async (...a) => { const r = await go(...a); await p.evaluate(() => { if (document.querySelector('#main')?.dataset.tab === 'home') document.querySelector('#hmGo [data-go="flow"]')?.click(); }); return r; }; }
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
    // the line bends: read its upright run at each box's height (same coordinates as the boxes)
    const pts = document.querySelector('path.matric').getAttribute('d').slice(1).split('L').map((s) => s.split(',').map(Number));
    const xAt = (y) => { for (let k = 1; k < pts.length; k++) if (pts[k - 1][0] === pts[k][0] && y >= Math.min(pts[k - 1][1], pts[k][1]) && y <= Math.max(pts[k - 1][1], pts[k][1])) return pts[k][0]; return null; };
    const box = (id) => { const b = document.querySelector(`.box[data-id="${id}"]`); return { l: b.offsetLeft, r: b.offsetLeft + b.offsetWidth, x: xAt(b.offsetTop + b.offsetHeight / 2) }; };
    const lbl = document.getElementById('matricBtn'), lr = lbl.getBoundingClientRect(), cr = document.getElementById('chart').getBoundingClientRect();
    return { top: pts[0], lbl: [lbl.offsetLeft, lbl.offsetTop], math: box('MATH 1210'), ece: box('ECE 3250'), tag: lbl.tagName, type: lbl.type, text: lbl.textContent, h: lr.height, inView: lr.top >= cr.top && lr.bottom <= cr.bottom && lr.left >= cr.left && lr.right <= cr.right,
      dash: getComputedStyle(document.querySelector('path.matric')).strokeDasharray };
  });
  assert.ok(g.math.r < g.math.x, `MATH 1210 left of the line: ${JSON.stringify(g)}`);
  assert.ok(g.ece.x < g.ece.l, `ECE 3250 right of the line: ${JSON.stringify(g)}`);
  assert.ok(Math.abs(g.lbl[0] - g.top[0]) < 1.5 && Math.abs(g.lbl[1] - g.top[1]) < 1.5, `label on the line's top end ${JSON.stringify(g)}`);
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

test('EE (laptop): hovering the label shows the matriculation details on the right; leaving puts back what was there', async () => {
  const p = await page(EE, false);
  await p.goto(APP + '?p=electrical-engineering-bs');
  await p.waitForSelector('#matricBtn:not([hidden])');
  await p.waitForTimeout(300);
  const open = () => p.evaluate(() => ['clsDlg', 'matDlg'].filter((id) => document.getElementById(id).open));
  const away = async () => { await p.mouse.move(5, 5); await p.waitForTimeout(400); };
  await p.hover('#matricBtn');
  await p.waitForTimeout(300);
  assert.deepEqual(await open(), ['matDlg'], 'hover opens it');
  assert.ok(await p.$eval('#matDlg', (d) => d.classList.contains('side')), 'in the right-side section');
  assert.match(await p.textContent('#matFacts'), /To be admitted to the BSEE program/);
  await away();
  assert.deepEqual(await open(), [], 'leaving closes the preview');
  // a clicked class stays under the preview and comes back
  await p.click('.box[data-id="ECE 2250"]');
  await p.waitForTimeout(200);
  await p.hover('#matricBtn');
  await p.waitForTimeout(300);
  assert.ok(await p.$eval('#matDlg', (d) => d.open && getComputedStyle(d).zIndex > getComputedStyle(document.getElementById('clsDlg')).zIndex), 'on top of the class');
  await away();
  assert.deepEqual(await open(), ['clsDlg']);
  assert.equal(await p.$eval('#clsDlg', (d) => d.dataset.code), 'ECE 2250');
  // into the details: kept, the class panel gives way
  await p.hover('#matricBtn');
  await p.waitForTimeout(300);
  await p.hover('#matDlg .sec-head');
  await p.waitForTimeout(400);
  assert.deepEqual(await open(), ['matDlg']);
  // a click opens it there too; Esc closes it
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  await p.click('#matricBtn');
  await p.waitForSelector('#matDlg[open].side');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  assert.deepEqual(await open(), []);
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

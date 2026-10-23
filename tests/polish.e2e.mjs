// Class selection, the cleaned-up class panel and the hover glossary, end to end (headless WebKit as an iPhone 15
// and a 1280px laptop; Playwright from ~/.claude/tools).
//   1. serve the repo:   python -m http.server 8137 --bind 127.0.0.1
//   2. run:              node --test tests/polish.e2e.mjs
// Tim, 2026-10-23: "when the user clicks on a box, it stops highlighting it and showing it as a preview with the
// prereq lines highlighted. Make sure it stays highlighted even after clicking on it. Clean up the class
// descriptions on the right side bar ... the font is really small ... Create previews of descriptions of what
// something means when the user hovers over it accross the cite."
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
const SAVED = { plan: { programs: [EE], catalogYear: null }, done: { [EE]: ['ENGL 1010', 'MATH 1210'] } };
async function page({ laptop = false } = {}) {
  const ctx = await browser.newContext(laptop ? { viewport: { width: 1280, height: 800 } } : { ...devices['iPhone 15'], serviceWorkers: 'block' });
  await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.abort());
  await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(SAVED)]);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  await p.goto(APP + `?p=${EE}`);
  await p.waitForSelector('#main[data-tab]');
  await p.evaluate(() => { if (document.querySelector('#main').dataset.tab === 'home') document.querySelector('#hmGo [data-go="flow"]').click(); });
  await p.waitForSelector('.box[data-id="ECE 3250"]');
  return p;
}
const lit = (p) => p.evaluate(() => ({ sel: [...document.querySelectorAll('#boxes .box.sel')].map((b) => b.dataset.id), lines: document.querySelectorAll('#edges g.hl path').length }));

for (const laptop of [false, true]) {
  test(`a clicked class stays highlighted with its prerequisite lines lit while its details are open (${laptop ? 'laptop' : 'iPhone'})`, async () => {
    const p = await page({ laptop });
    await p.click('.box[data-id="ECE 3250"]');
    await p.waitForSelector('#clsDlg[open]');
    await p.waitForTimeout(300); // longer than a hover's fade
    let s = await lit(p);
    assert.deepEqual(s.sel, ['ECE 3250']);
    assert.ok(s.lines > 0, `prerequisite lines lit ${JSON.stringify(s)}`);
    if (laptop) {
      // a hover on another box previews it; leaving brings the selection back
      await p.hover('.box[data-id="MATH 1220"]');
      await p.mouse.move(640, 790);
      await p.waitForTimeout(200);
      s = await lit(p);
      assert.deepEqual(s.sel, ['ECE 3250']);
      assert.ok(s.lines > 0, 'still lit after a hover elsewhere');
      // another class: the selection moves
      await p.click('.box[data-id="ECE 2250"]');
      await p.waitForFunction(() => document.querySelector('#clsCode').textContent === 'ECE 2250');
      assert.deepEqual((await lit(p)).sel, ['ECE 2250']);
      // a tap on empty chart space lets go (and closes the side details)
      const r = await p.$eval('#chart', (c) => c.getBoundingClientRect().toJSON());
      const spot = await p.evaluate(({ x0, y0, x1, y1 }) => {
        for (let y = y0 + 40; y < y1; y += 13) for (let x = x0 + 10; x < x1; x += 17) {
          const el = document.elementFromPoint(x, y);
          if (el && el.closest('#chart') && !el.closest('.box, .gframe, .gmore, .matric-lbl, button, a, .pickgrp')) return { x, y };
        }
        return null;
      }, { x0: r.left, y0: r.top, x1: r.left + 820, y1: r.bottom });
      assert.ok(spot, 'an empty spot on the chart');
      await p.mouse.click(spot.x, spot.y);
      await p.waitForFunction(() => !document.querySelector('#boxes .box.sel'));
      assert.equal(await p.$('#clsDlg[open]'), null, 'details closed');
    } else {
      // closing the details lets go
      await p.click('#clsDlg button.ok');
      await p.waitForFunction(() => !document.querySelector('#boxes .box.sel'));
    }
    assert.equal((await lit(p)).lines, 0, 'no lines lit once let go');
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });
}

test('class panel: big text, short rows in order (credits, status, needs as chips, unlocks, offered), catalog text tucked away', async () => {
  const p = await page({ laptop: true });
  await p.click('.box[data-id="ECE 3250"]');
  await p.waitForSelector('#clsDlg[open]');
  await p.waitForFunction(() => !/…/.test(document.querySelector('#clsFacts').textContent)); // sections loaded
  const dts = await p.$$eval('#clsFacts dt', (ds) => ds.map((d) => d.textContent));
  const order = ['Credits', 'Status', 'Needs', 'Unlocks', 'Offered', 'Counts for', 'Sections'];
  assert.deepEqual(dts.filter((k) => order.includes(k)), order, JSON.stringify(dts));
  const row = async (k) => p.$$eval('#clsFacts dt', (ds, k) => ds.find((d) => d.textContent === k)?.nextElementSibling.textContent || '', k);
  assert.match(await row('Status'), /^Planned (Spring|Summer|Fall) 20\d\d$/);
  assert.match(await row('Needs'), /ECE 2250/);
  assert.match(await row('Needs'), /Program acceptance/);
  assert.match(await row('Offered'), /^(Fall|Spring|Summer)( only| \/ )/);
  // text 14px or more, the code bigger still
  const f = await p.evaluate(() => ({ dd: parseFloat(getComputedStyle(document.querySelector('#clsFacts dd')).fontSize), code: parseFloat(getComputedStyle(document.querySelector('#clsCode')).fontSize) }));
  assert.ok(f.dd >= 14 && f.code >= 20, JSON.stringify(f));
  // the catalog's own words: closed under "Catalog text"; sources: one small line
  assert.equal(await p.$eval('#clsRaw', (d) => d.open), false);
  assert.match(await p.textContent('#clsRaw summary'), /Catalog text/);
  assert.match(await p.textContent('#clsRawList'), /ECE 2250/);
  assert.equal(await p.$$eval('#clsFacts a.src', (as) => as.length), 0, 'no source arrows on the rows');
  assert.match(await p.textContent('#clsSrc'), /checked/);
  // a Needs chip opens that class
  await p.click('#clsFacts button.ck[data-open="ECE 2250"]');
  await p.waitForFunction(() => document.querySelector('#clsCode').textContent === 'ECE 2250');
  assert.deepEqual((await lit(p)).sel, ['ECE 2250']);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

const ADV = /MAT 1030/; // UVU catalog 2026-27: University Advanced Standing = MAT 1030 or higher + ENGL 2010
test('glossary (laptop): hovering a dotted term shows what it means with a source link; Esc closes it; never in boxes', async () => {
  const p = await page({ laptop: true });
  assert.equal(await p.$$eval('#boxes .gt', (x) => x.length), 0, 'no glossary terms inside flowchart boxes');
  await p.click('.box[data-id="ECE 3250"]');
  await p.waitForSelector('#clsDlg[open]');
  const term = await p.waitForSelector('#clsFacts .gt[data-g="advanced-standing"]');
  assert.equal(await term.evaluate((e) => getComputedStyle(e).textDecorationStyle || getComputedStyle(e).borderBottomStyle), 'dotted');
  await term.hover();
  await p.waitForSelector('#gloss:not([hidden])');
  assert.match(await p.textContent('#gloss'), ADV);
  assert.ok(await p.$('#gloss a[href^="https://catalog.uvu.edu"]'), 'source link');
  const r = await p.$eval('#gloss', (g) => { const b = g.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: innerWidth, h: innerHeight }; });
  assert.ok(r.l >= 0 && r.r <= r.w && r.t >= 0 && r.b <= r.h, `inside the screen ${JSON.stringify(r)}`);
  await p.keyboard.press('Escape');
  await p.waitForSelector('#gloss', { state: 'hidden' });
  assert.ok(await p.$('#clsDlg[open]'), 'Esc closed the popover, not the details');
  // keyboard: a term takes focus and Enter opens it
  await term.focus();
  await p.keyboard.press('Enter');
  await p.waitForSelector('#gloss:not([hidden])');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('glossary (iPhone): a tap on a term shows it; a tap outside closes it', async () => {
  const p = await page();
  await p.click('.box[data-id="ECE 3250"]');
  await p.waitForSelector('#clsDlg[open]');
  const term = await p.waitForSelector('#clsFacts .gt[data-g="advanced-standing"]');
  await term.tap();
  await p.waitForSelector('#gloss:not([hidden])');
  assert.match(await p.textContent('#gloss'), ADV);
  assert.ok(await p.$('#clsDlg[open]'), 'the details stay open');
  await p.tap('#clsCode');
  await p.waitForSelector('#gloss', { state: 'hidden' });
  assert.ok(await p.$('#clsDlg[open]'));
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

// Settings › "Semester colors" switch: on = one colour per planned semester (boxes, legend chips, plan headings);
// off = one neutral look, no legend chips. Saved in settings.semColors (headless WebKit, iPhone 15).
//   1. serve the repo:   python -m http.server 8137 --bind 127.0.0.1
//   2. run:              node --test tests/semcolors.e2e.mjs        (APP_URL=... for another address)
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
  // the app opens on Home (2026-10-22); these checks start on the flowchart, as they did before Home
  { const go = p.goto.bind(p); p.goto = async (...a) => { const r = await go(...a); await p.evaluate(() => { if (document.querySelector('#main')?.dataset.tab === 'home') document.querySelector('#tabs button[data-tab="flow"]')?.click(); }); return r; }; }
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  return p;
}
const EE = { plan: { programs: ['electrical-engineering-bs'], catalogYear: null }, done: { 'electrical-engineering-bs': ['ENGL 1010', 'MATH 1210'] } };
const S = /^s\d$/;
const look = (p) => p.evaluate(() => {
  const planned = [...document.querySelectorAll('#boxes .box.planned')];
  const ready = planned.find((b) => !b.classList.contains('locked'));
  return {
    planned: planned.length,
    boxS: planned.filter((b) => [...b.classList].some((c) => /^s\d$/.test(c))).length,
    readyBg: ready && getComputedStyle(ready).backgroundColor,
    bgs: new Set(planned.filter((b) => !b.classList.contains('locked')).map((b) => getComputedStyle(b).backgroundColor)).size,
    chips: document.querySelectorAll('#legendItems .sw').length,
    legend: document.getElementById('legendItems').textContent,
    semS: [...document.querySelectorAll('#sems .sem')].filter((d) => [...d.classList].some((c) => /^s\d$/.test(c))).length,
    sems: document.querySelectorAll('#sems .sem').length,
    taken: document.querySelectorAll('#boxes .box.done').length,
    saved: JSON.parse(localStorage.getItem('smart-advisor:v1') || '{}').settings?.semColors,
  };
});

test('Semester colors: on by default, off removes semester colours, persists across reload', async () => {
  const p = await page(EE);
  await p.goto(APP + '?p=electrical-engineering-bs');
  await p.waitForSelector('#boxes .box.planned');
  await p.waitForTimeout(400); // coming from Home, the boxes' .15s colour fade can still be running
  const on = await look(p);
  assert.ok(on.planned > 10 && on.boxS === on.planned, JSON.stringify(on));
  assert.ok(on.bgs > 2, 'several semester fills ' + JSON.stringify(on));
  assert.ok(on.chips > 3 && /Sp \d\d|Fa \d\d/.test(on.legend), on.legend);
  assert.equal(on.semS, on.sems);

  await p.click('#gear');
  await p.waitForSelector('#settings[open]');
  const sw = p.locator('#setSemColors');
  assert.equal(await sw.isChecked(), true);
  await sw.click();
  await p.click('#settings button.ok');
  const off = await look(p);
  assert.equal(off.saved, false);
  assert.equal(off.planned, on.planned, 'same boxes planned');
  assert.equal(off.boxS, 0, 'no semester class on boxes');
  assert.equal(off.bgs, 1, 'one neutral fill for ready planned boxes');
  assert.equal(off.chips, 1, 'only the Taken chip');
  assert.ok(!/Sp \d\d|Fa \d\d/.test(off.legend), off.legend);
  assert.equal(off.semS, 0, 'plan headings neutral');
  assert.equal(off.taken, on.taken, 'Taken boxes unchanged');

  await p.reload();
  await p.waitForSelector('#boxes .box.planned');
  const again = await look(p);
  assert.equal(again.boxS, 0);
  assert.equal(again.chips, 1);
  await p.click('#gear');
  await p.waitForSelector('#settings[open]');
  assert.equal(await p.locator('#setSemColors').isChecked(), false);
  await p.locator('#setSemColors').click();
  await p.click('#settings button.ok');
  const back = await look(p);
  assert.equal(back.boxS, back.planned);
  assert.equal(back.chips, on.chips);
  assert.equal(back.saved, true);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

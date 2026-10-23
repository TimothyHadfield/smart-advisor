// The iPhone pass, end to end (headless; Playwright from ~/.claude/tools). Every screen at 393x659 in WebKit as an
// iPhone 15; the two-finger pinch and one-finger drag in Chrome with real multi-touch (WebKit can't fake touches).
//   1. serve the repo:   python -m http.server 8137 --bind 127.0.0.1
//   2. run:              node --test tests/iphone.e2e.mjs
// Tim, 2026-10-23: "I haven't check out how the cite looks on the iphone, but could you check it out and make sure
// that the whole layout and everything still works and makes sense? All of the organization and everything has
// been specifically for the laptop use so you might have to change a lot. I figure the 1 finger drage around and
// the 2 finger to zoom in/out should probably be applied somewhere but it's up to you."
// Made-up student only (never a real audit).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

const { webkit, chromium, devices } = createRequire(join(homedir(), '.claude/tools/'))('playwright');
const APP = process.env.APP_URL || 'http://localhost:8137/';
const browser = await webkit.launch({ headless: true });
let chrome = null;
after(async () => { await browser.close(); if (chrome) await chrome.close(); });

const KEY = 'smart-advisor:v1', EE = 'electrical-engineering-bs';
const AUDIT = ['ENGL 1010', 'MATH 1210', 'MATH 1220', 'CHEM 1210', 'ECE 1000', 'PHYS 2210', 'MATH 2210', 'ECE 2250'];
const SAVED = {
  plan: { programs: [EE], catalogYear: null }, done: { [EE]: AUDIT },
  grades: { [EE]: { 'ENGL 1010': 'A', 'MATH 1210': 'B+', 'MATH 1220': 'A-', 'CHEM 1210': 'C+', 'ECE 1000': 'A', 'PHYS 2210': 'B', 'MATH 2210': 'IP', 'ECE 2250': 'IP' } },
  settings: { max: 16, summers: false, start: null, grades: true, lastTerm: 'Fall 2026', name: 'Jordan Testperson',
    src: { [EE]: Object.fromEntries(AUDIT.map((c) => [c, 'audit'])) },
    when: { 'ENGL 1010': 'Fall 2025', 'MATH 1210': 'Fall 2025', 'CHEM 1210': 'Fall 2025', 'ECE 1000': 'Fall 2025', 'MATH 1220': 'Spring 2026', 'PHYS 2210': 'Spring 2026', 'MATH 2210': 'Fall 2026', 'ECE 2250': 'Fall 2026' } },
};
const NURSE = { ...SAVED, plan: { programs: ['nursing-bs'], catalogYear: null }, done: {}, grades: {}, settings: { ...SAVED.settings, src: {} } };
const PHONE = { ...devices['iPhone 15'], viewport: { width: 393, height: 659 }, serviceWorkers: 'block' };

async function setup(ctx, saved) {
  await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.abort());
  // the schedule's terms depend on today: pin it
  await ctx.addInitScript(() => { const T = new Date('2026-10-23T12:00:00').getTime(), D = Date; globalThis.Date = class extends D { constructor(...a) { super(...(a.length ? a : [T])); } static now() { return T; } }; });
  await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(saved)]);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  await p.goto(APP);
  await p.waitForSelector('#main[data-tab]');
  await p.waitForFunction(() => /\d/.test(document.querySelector('#hmGoFlow')?.textContent || '') || document.querySelector('.home.none'));
  return p;
}
const phone = async (saved = SAVED) => setup(await browser.newContext(PHONE), saved);
async function toFlow(p) {
  await p.click('#hmGo [data-go="flow"]');
  await p.waitForSelector('.box[data-id="ECE 3250"]');
  await p.waitForTimeout(300);
}
const zoomOf = (p) => p.$eval('#boxes', (b) => { const m = getComputedStyle(b).transform; return m === 'none' ? 1 : new DOMMatrix(m).a; });

// on screen: page never scrolls sideways (or down, on the main screens); every visible control is at least
// 40 px to a finger (39 allowed for rounding; links inside sentences excepted); every text box is >= 16 px so
// Safari doesn't zoom in on it
function fits(p, { scrollY = true } = {}) {
  return p.evaluate((scrollY) => {
    const W = innerWidth, H = innerHeight, de = document.documentElement;
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && r.bottom > 0 && r.top < H && r.right > 0 && r.left < W; };
    const top = document.querySelector('dialog[open]:modal') || document.body;
    const small = [], inp = [];
    for (const el of top.querySelectorAll('button, a[href], input, select, summary, [role="button"]')) {
      if (!vis(el) || el.closest('#boxes')) continue; // flowchart boxes scale with the zoom
      if (el.matches('.gt, a.src, a.adv, .src a, .uvuchart a, .noaud button, .sum a, a.rt, #gloss a')) continue;
      const own = (x, y) => { const h = document.elementFromPoint(x, y); return h && (h === el || el.contains(h) || (el.closest('label') && el.closest('label').contains(h))); };
      const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (!own(cx, cy)) continue; // covered
      let u = 0, d = 0, l = 0, rt = 0;
      while (u < 30 && own(cx, cy - u - 1)) u++; while (d < 30 && own(cx, cy + d + 1)) d++;
      while (l < 30 && own(cx - l - 1, cy)) l++; while (rt < 30 && own(cx + rt + 1, cy)) rt++;
      if (u + d + 1 < 39 || l + rt + 1 < 39) small.push(`${el.id || el.className || el.tagName} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 14)}" ${l + rt + 1}x${u + d + 1}`);
      if (el.matches('input:not([type=checkbox]):not([type=radio]):not([type=file]), select') && parseFloat(getComputedStyle(el).fontSize) < 16) inp.push(el.id || el.className);
    }
    return { x: de.scrollWidth - de.clientWidth, y: scrollY ? Math.max(de.scrollHeight, document.body.scrollHeight) - H : 0, small, inp };
  }, scrollY);
}
async function assertFits(p, name, opt) {
  const f = await fits(p, opt);
  assert.equal(f.x, 0, `${name}: no sideways page scroll`);
  assert.ok(f.y <= 0, `${name}: no page scroll (${f.y}px)`);
  assert.deepEqual(f.small, [], `${name}: controls under 40px`);
  assert.deepEqual(f.inp, [], `${name}: text boxes under 16px (Safari zooms in)`);
}

test('iPhone: every screen fits 393 px wide, no page scroll, 40 px touch targets, 16 px text boxes', async () => {
  const p = await phone();
  await assertFits(p, 'Home');
  await p.click('#gear'); await p.waitForSelector('dialog[open]'); await p.waitForTimeout(250);
  await assertFits(p, 'Settings');
  await p.click('#importBtn'); await p.waitForTimeout(250);
  await assertFits(p, 'Upload');
  while (await p.$('dialog[open]:modal')) { await p.keyboard.press('Escape'); await p.waitForTimeout(150); }
  await toFlow(p);
  await assertFits(p, 'Flowchart');
  await p.click('#exploreBtn'); await p.waitForTimeout(250);
  await assertFits(p, 'Flowchart, Explore');
  await p.click('#exploreBtn'); await p.waitForTimeout(250);
  await p.click('#fpSeg [data-v="plan"]'); await p.waitForTimeout(300);
  await assertFits(p, 'Plan');
  await p.click('#planSeg [data-v="classes"]'); await p.waitForTimeout(300);
  await assertFits(p, 'Classes');
  await p.click('#back'); await p.waitForTimeout(300);
  await p.click('#hmGo [data-go="sched"]'); await p.waitForSelector('#scWeek .wk-b'); await p.waitForTimeout(300);
  await assertFits(p, 'Schedule');
  await p.click('#scFilt'); await p.waitForTimeout(300);
  await assertFits(p, 'Schedule, Filters');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('iPhone: the flowchart opens with its whole width on screen; the page itself never zooms', async () => {
  const p = await phone();
  await toFlow(p);
  const r = await p.evaluate(() => { const c = document.querySelector('#chart'); return { sw: c.scrollWidth, cw: c.clientWidth, vp: document.querySelector('meta[name=viewport]').content }; });
  assert.ok(r.sw <= r.cw + 1, `chart fits the width: ${r.sw} <= ${r.cw}`);
  assert.match(r.vp, /viewport-fit=cover/);
  assert.ok(await zoomOf(p) >= 0.4 - 1e-6, 'not smaller than 0.4x');
  await p.context().close();
});

test('iPhone: a tapped class opens a bottom sheet that leaves the class in view; drag it down to close; Back goes where you were', async () => {
  const p = await phone();
  await toFlow(p);
  await p.tap('.box[data-id="ECE 3250"]');
  await p.waitForSelector('#clsDlg[open]');
  await p.waitForTimeout(800); // slide-up + the chart scrolling the class above it
  const r = await p.evaluate(() => {
    const d = document.querySelector('#clsDlg'), b = document.querySelector('.box[data-id="ECE 3250"]').getBoundingClientRect(), s = d.getBoundingClientRect();
    const ok = d.querySelector('button.ok').getBoundingClientRect();
    return { modal: d.matches(':modal'), boxTop: b.top, boxBottom: b.bottom, sheetTop: s.top, sheetBottom: s.bottom, H: innerHeight, font: parseFloat(getComputedStyle(document.querySelector('#clsFacts')).fontSize), ok: [ok.top, ok.bottom, ok.height] };
  });
  assert.equal(r.modal, false, 'the chart stays usable behind the sheet');
  assert.ok(r.sheetBottom <= r.H + 1 && r.sheetTop > r.H * 0.3, `sheet sits at the bottom ${JSON.stringify(r)}`);
  assert.ok(r.boxBottom <= r.sheetTop && r.boxTop >= 0, `the class stays visible above the sheet ${JSON.stringify(r)}`);
  assert.ok(r.font >= 14, `readable text ${r.font}px`);
  assert.ok(r.ok[0] >= r.sheetTop && r.ok[1] <= r.H, `Close is on screen ${r.ok}`);
  await assertFits(p, 'Class sheet', { scrollY: false }); // its buttons (Close included) are 40 px to a finger
  assert.deepEqual(await p.$$eval('#boxes .box.sel', (x) => x.map((b) => b.dataset.id)), ['ECE 3250']);
  // drag the handle down: closes
  const g = await p.$eval('#clsDlg .grab', (h) => { const b = h.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await p.mouse.move(g.x, g.y); await p.mouse.down(); await p.mouse.move(g.x, g.y + 60, { steps: 4 }); await p.mouse.move(g.x, g.y + 140, { steps: 4 }); await p.mouse.up();
  await p.waitForSelector('#clsDlg', { state: 'hidden' });
  // Back: first closes an open sheet, then goes Home
  await p.tap('.box[data-id="ECE 2250"]');
  await p.waitForSelector('#clsDlg[open]');
  await p.goBack();
  await p.waitForSelector('#clsDlg', { state: 'hidden' });
  assert.equal(await p.$eval('#main', (m) => m.dataset.tab), 'flow', 'still on the flowchart');
  await p.goBack();
  await p.waitForFunction(() => document.querySelector('#main').dataset.tab === 'home');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('iPhone: a 50-minute class shows its full time, even "10:30–11:45", with Filters open or closed', async () => {
  const p = await phone();
  await p.click('#hmGo [data-go="sched"]'); await p.waitForSelector('#scWeek .wk-b'); await p.waitForTimeout(300);
  const check = () => p.evaluate(() => [...document.querySelectorAll('#scWeek .wk-b')].map((el) => {
    const t = el.querySelector('.wtm'), cs = getComputedStyle(el);
    const need = t.scrollWidth, room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), wide = need <= room + 0.5;
    const tall = t.offsetTop + t.offsetHeight <= el.clientHeight + 1;
    const wt = el.querySelector('.wt'), title = getComputedStyle(wt).display === 'none' || wt.offsetHeight >= 14; // no sliver of a clipped title
    return wide && tall && title ? null : `${t.textContent} ${el.className} wide ${need}/${room} tall ${tall} title ${title} h${el.clientHeight}`;
  }).filter(Boolean));
  const filters = async () => { await p.click('#scFilt'); await p.waitForTimeout(400); };
  assert.deepEqual(await check(), [], 'Filters closed');
  await filters();
  assert.deepEqual(await check(), [], 'Filters open (a shorter grid)');
  // the longest kind of time, in every block (the grid re-fits its blocks whenever it changes size)
  await p.$$eval('#scWeek .wtm', (ts) => ts.forEach((t) => { t.textContent = '10:30–11:45'; }));
  await filters();
  assert.deepEqual(await check(), [], '"10:30–11:45", Filters closed');
  await filters();
  assert.deepEqual(await check(), [], '"10:30–11:45", Filters open');
  await p.context().close();
});

test('iPhone: the matriculation label opens its sheet with a tap, on screen', async () => {
  const p = await phone(NURSE);
  await p.click('#hmGo [data-go="flow"]');
  const mb = await p.waitForSelector('#matricBtn:not([hidden])');
  await mb.evaluate((b) => b.scrollIntoView({ block: 'center', inline: 'center' }));
  await mb.tap();
  await p.waitForSelector('#matDlg[open]');
  await p.waitForTimeout(400);
  const r = await p.$eval('#matDlg', (d) => { const b = d.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right, W: innerWidth, H: innerHeight }; });
  assert.ok(r.t >= 0 && r.b <= r.H + 1 && r.l >= -1 && r.r <= r.W + 1, `sheet on screen ${JSON.stringify(r)}`);
  await assertFits(p, 'Matriculation sheet', { scrollY: false });
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

// Chrome: real multi-touch through the DevTools protocol, phone-sized with touch on
async function chromePhone() {
  chrome ||= await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await chrome.newContext({ viewport: { width: 393, height: 659 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: devices['iPhone 15'].userAgent, serviceWorkers: 'block' });
  const p = await setup(ctx, SAVED);
  await toFlow(p);
  p.cdp = await ctx.newCDPSession(p);
  p.touch = (type, pts) => p.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  return p;
}
const view = (p) => p.evaluate(() => { const c = document.querySelector('#chart'), r = c.getBoundingClientRect(); return { sl: c.scrollLeft, st: c.scrollTop, cl: r.left, ct: r.top, cw: c.clientWidth, ch: c.clientHeight, page: visualViewport.scale, sx: scrollX, sy: scrollY }; });

test('iPhone (Chrome touch): two fingers zoom the flowchart around the point between them; the page itself stays put', async () => {
  const p = await chromePhone();
  const k0 = await zoomOf(p), v0 = await view(p);
  const mx = v0.cl + v0.cw / 2, my = v0.ct + v0.ch / 2;
  const cx = (v0.sl + mx - v0.cl) / k0, cy = (v0.st + my - v0.ct) / k0; // chart point under the fingers
  // spread from 60 px apart to 180 px apart (3x)
  await p.touch('touchStart', [[mx - 30, my], [mx + 30, my]]);
  for (let i = 1; i <= 8; i++) { const h = 30 + i * 7.5; await p.touch('touchMove', [[mx - h, my], [mx + h, my]]); await p.waitForTimeout(30); }
  await p.touch('touchEnd', []);
  await p.waitForTimeout(200);
  const k1 = await zoomOf(p), v1 = await view(p);
  assert.ok(k1 > k0 * 2, `zoomed in: ${k0} -> ${k1}`);
  assert.ok(k1 <= 2.5 + 1e-6, `at most 2.5x: ${k1}`);
  const cx1 = (v1.sl + mx - v1.cl) / k1, cy1 = (v1.st + my - v1.ct) / k1;
  assert.ok(Math.abs(cx1 - cx) < 12 && Math.abs(cy1 - cy) < 12, `the point under the fingers stayed: (${cx},${cy}) -> (${cx1},${cy1})`);
  assert.equal(v1.page, 1, 'the page did not zoom');
  assert.deepEqual([v1.sx, v1.sy], [0, 0], 'the page did not scroll');
  assert.equal(await p.$('#clsDlg[open]'), null, 'a pinch opens no class');
  // two fingers moving together drag the chart with them (the point under them follows)
  const px = (v1.sl + mx - v1.cl) / k1, py = (v1.st + my - v1.ct) / k1;
  await p.touch('touchStart', [[mx - 60, my], [mx + 60, my]]);
  for (let i = 1; i <= 8; i++) { await p.touch('touchMove', [[mx - 60 - i * 10, my - i * 10], [mx + 60 - i * 10, my - i * 10]]); await p.waitForTimeout(30); }
  await p.touch('touchEnd', []);
  await p.waitForTimeout(200);
  const kp = await zoomOf(p), vp = await view(p);
  const qx = (vp.sl + mx - 80 - vp.cl) / kp, qy = (vp.st + my - 80 - vp.ct) / kp;
  assert.ok(Math.abs(qx - px) < 12 && Math.abs(qy - py) < 12, `the chart followed the fingers: (${px},${py}) now under (${qx},${qy})`);
  // and back out: pinch in stops at the smallest zoom (never below the whole-width view's floor)
  await p.touch('touchStart', [[mx - 150, my], [mx + 150, my]]);
  for (let i = 1; i <= 8; i++) { const h = 150 - i * 17; await p.touch('touchMove', [[mx - h, my], [mx + h, my]]); await p.waitForTimeout(30); }
  await p.touch('touchEnd', []);
  await p.waitForTimeout(200);
  const k2 = await zoomOf(p);
  assert.ok(k2 < k1 / 2 && k2 >= 0.15 - 1e-6, `zoomed out: ${k1} -> ${k2}`);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('iPhone (Chrome touch): one finger drags the flowchart around and does not open the class it started on', async () => {
  const p = await chromePhone();
  // zoom in first (the whole-width view may not need sideways panning)
  const v0 = await view(p), mx = v0.cl + v0.cw / 2, my = v0.ct + v0.ch / 2;
  await p.touch('touchStart', [[mx - 30, my], [mx + 30, my]]);
  for (let i = 1; i <= 6; i++) { const h = 30 + i * 10; await p.touch('touchMove', [[mx - h, my], [mx + h, my]]); await p.waitForTimeout(30); }
  await p.touch('touchEnd', []);
  await p.waitForTimeout(300);
  const b = await p.$eval('.box[data-id="ECE 3250"]', (el) => { el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await p.waitForTimeout(200);
  const v1 = await view(p);
  await p.touch('touchStart', [[b.x, b.y]]);
  for (let i = 1; i <= 10; i++) { await p.touch('touchMove', [[b.x - i * 12, b.y - i * 10]]); await p.waitForTimeout(16); }
  await p.touch('touchEnd', []);
  await p.waitForTimeout(500);
  const v2 = await view(p);
  assert.ok(Math.abs(v2.sl - v1.sl) > 40 || Math.abs(v2.st - v1.st) > 40, `the chart moved: ${JSON.stringify([v1, v2])}`);
  assert.equal(await p.$('#clsDlg[open]'), null, 'a drag is not a tap');
  assert.deepEqual([v2.sx, v2.sy, v2.page], [0, 0, 1], 'the page itself stayed put');
  // a plain tap still opens it
  const b2 = await p.$eval('.box[data-id="ECE 3250"]', (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await p.touch('touchStart', [[b2.x, b2.y]]); await p.touch('touchEnd', []);
  await p.waitForSelector('#clsDlg[open]');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

// Requirement groups under the flowchart (js/groups.js) in the real page: headless WebKit, iPhone 15.
//   1. serve the repo:   python -m http.server 8137 --bind 127.0.0.1
//   2. run:              node --test tests/groups.e2e.mjs        (APP_URL=... for another address)
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
async function open(id, opts = {}) {
  const ctx = await browser.newContext({ ...(opts.desktop ? { viewport: { width: 1440, height: 900 } } : devices['iPhone 15']), serviceWorkers: 'block', colorScheme: opts.dark ? 'dark' : 'light' });
  await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.abort());
  const saved = { plan: { programs: [id], catalogYear: null }, done: {} };
  await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(saved)]);
  const p = await ctx.newPage();
  // the app opens on Home (2026-10-22); these checks start on the flowchart, as they did before Home
  { const go = p.goto.bind(p); p.goto = async (...a) => { const r = await go(...a); await p.evaluate(() => { if (document.querySelector('#main')?.dataset.tab === 'home') document.querySelector('#hmGo [data-go="flow"]')?.click(); }); return r; }; }
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  await p.goto(APP + '?p=' + id);
  await p.waitForSelector('.box');
  await p.waitForTimeout(300);
  return p;
}
// a group frame by its title: its progress text, whether it is met, and the boxes drawn inside it
const frame = (p, title) => p.evaluate((title) => {
  const f = [...document.querySelectorAll('.gframe')].find((x) => x.querySelector('b')?.textContent === title);
  if (!f || f.hidden) return null;
  const r = f.getBoundingClientRect();
  const inside = [...document.querySelectorAll('.box')].filter((b) => {
    const q = b.getBoundingClientRect();
    return q.left >= r.left - 1 && q.right <= r.right + 1 && q.top >= r.top - 1 && q.bottom <= r.bottom + 1;
  }).map((b) => b.dataset.id);
  return { progress: f.querySelector('.gp').textContent, met: f.classList.contains('met'), inside, bg: getComputedStyle(f).backgroundColor };
}, title);

test('a "choose N" requirement is a group titled with its count, holding its classes; it turns green once met', async () => {
  const p = await open('art-design-bs');
  const T = 'Pick 9 cr · ART/ARTH Lower Division';
  let f = await frame(p, T);
  assert.ok(f, 'group shown');
  assert.equal(f.progress, '0 of 9 cr');
  assert.equal(f.met, false);
  assert.equal(f.inside.length, 7);
  const before = f.bg;
  // tap three of its classes in Explore (hypothetical taps, like any box)
  await p.click('#exploreBtn');
  for (const id of f.inside.slice(0, 3)) {
    await p.evaluate((id) => { const b = document.querySelector(`.box[data-id="${CSS.escape(id)}"]`); b.scrollIntoView({ block: 'center', inline: 'center' }); }, id);
    await p.click(`.box[data-id="${id}"]`);
    await p.waitForTimeout(120);
  }
  f = await frame(p, T);
  assert.equal(f.progress, '9 of 9 cr');
  assert.equal(f.met, true);
  assert.notEqual(f.bg, before, 'light green fill');
  // no "Choose N credits" placeholder box left for it
  assert.equal(await p.locator('.box', { hasText: 'ART/ARTH Lower Division' }).count(), 0);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('required classes with no lines sit in an "Also required" grid', async () => {
  const p = await open('dental-hygiene-aas');
  const f = await frame(p, 'Also required');
  assert.ok(f);
  assert.ok(f.inside.length >= 12, `${f.inside.length} classes`);
  const xy = await p.evaluate((ids) => ids.map((id) => { const r = document.querySelector(`.box[data-id="${CSS.escape(id)}"]`).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; }), f.inside);
  assert.ok(new Set(xy.map((q) => q[0])).size >= 3 && new Set(xy.map((q) => q[1])).size >= 2, 'a grid');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('a long list shows "+N more", which opens its searchable class list', async () => {
  const p = await open('environmental-studies-bs', { desktop: true });
  const more = p.locator('.gmore').first();
  const label = await more.textContent();
  const n = +label.match(/\+(\d+) more/)[1];
  await more.scrollIntoViewIfNeeded();
  await more.click();
  await p.waitForSelector('#geDlg[open]');
  const rows = await p.locator('#geList li button').count();
  assert.equal(rows, n + 5);
  assert.match(await p.locator('#geName').textContent(), /^Pick \d+ cr/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('dotted lines are explained in the legend ("Any one"); no sideways page scroll', async () => {
  const p = await open('electrical-engineering-bs', { dark: true });
  const leg = await p.locator('#legendItems').textContent();
  assert.match(leg, /Any one/);
  const box = await p.locator('#legendItems .sw-or').boundingBox();
  assert.ok(box && box.y >= 0 && box.y < 300, 'legend item on screen');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

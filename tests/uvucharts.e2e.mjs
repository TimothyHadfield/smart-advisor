// "UVU's official flowchart (2026-27)" line on the flowchart, for majors whose department publishes one
// (headless WebKit, iPhone 15).
//   1. serve the repo:   python -m http.server 8137 --bind 127.0.0.1
//   2. run:              node --test tests/uvucharts.e2e.mjs        (APP_URL=... for another address)
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
async function open(id, year = null) {
  const ctx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
  await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.abort());
  const saved = { plan: { programs: [id], catalogYear: year }, done: {} };
  await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(saved)]);
  const p = await ctx.newPage();
  // the app opens on Home (2026-10-22); these checks start on the flowchart, as they did before Home
  { const go = p.goto.bind(p); p.goto = async (...a) => { const r = await go(...a); await p.evaluate(() => { if (document.querySelector('#main')?.dataset.tab === 'home') document.querySelector('#tabs button[data-tab="flow"]')?.click(); }); return r; }; }
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  await p.goto(APP + '?p=' + id);
  await p.waitForSelector('.box');
  await p.waitForTimeout(300);
  return p;
}
const line = (p) => p.evaluate(() => {
  const el = document.getElementById('uvuChart');
  const a = el?.querySelector('a');
  if (!el || el.hidden || !a) return null;
  const r = a.getBoundingClientRect();
  return { text: a.textContent, href: a.getAttribute('href'), target: a.target, rel: a.rel, inView: r.top >= 0 && r.bottom <= innerHeight && r.width > 0 };
});

test('EE BS shows UVU\'s 2026-27 EE flowchart, in a new tab, without scrolling', async () => {
  const p = await open('electrical-engineering-bs');
  const l = await line(p);
  assert.deepEqual(l, { text: "UVU's official flowchart (2026-27) ↗", href: 'https://www.uvu.edu/cet/ece/docs/electrical/ee_flowchart_2026-2027-4-29.pdf', target: '_blank', rel: 'noopener', inView: true });
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('EE BS on the 2025-26 catalog shows the 2025-26 flowchart', async () => {
  const p = await open('electrical-engineering-bs', '2025-2026');
  const l = await line(p);
  assert.equal(l?.href, 'https://www.uvu.edu/cet/ece/docs/electrical/ee_flowchart_2025-2026.pdf');
  assert.equal(l?.text, "UVU's official flowchart (2025-26) ↗");
  await p.context().close();
});

test('CE BS shows the CE flowchart', async () => {
  const p = await open('computer-engineering-bs');
  const l = await line(p);
  assert.equal(l?.href, 'https://www.uvu.edu/cet/ece/docs/computer/ce_flowchart_2026.pdf');
  assert.equal(l?.inView, true);
  await p.context().close();
});

test('a program without one shows nothing', async () => {
  const p = await open('accounting-bs');
  assert.equal(await line(p), null);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

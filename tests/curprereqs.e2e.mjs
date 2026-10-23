// Prerequisites always come from the current catalog, whatever catalog year the student is on.
// Tim: "also 4900 literally says on wolverine track that 4730 is a prereq ... I'm not sure why it's on
// the far left with nothing before it as if it's a begginner class." (EE BS, catalog year 2025-2026)
// Headless WebKit, iPhone 15.
//   1. serve the repo:   python -m http.server 8137 --bind 127.0.0.1
//   2. run:              node --test tests/curprereqs.e2e.mjs        (APP_URL=... for another address)
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
async function open(id, year = null, device = devices['iPhone 15']) {
  const ctx = await browser.newContext({ ...device, serviceWorkers: 'block' });
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
// where a class sits: its box's left edge on the chart, the plan semester it's in, and the lines into it
const where = (p, code) => p.evaluate((code) => {
  const box = document.querySelector(`#boxes .box[data-id="${CSS.escape(code)}"]`);
  const row = document.querySelector(`li[data-unit="${CSS.escape(code)}"]`);
  return {
    left: box ? parseFloat(box.style.left) : null,
    sem: row ? Number(row.dataset.sem) : null,
    from: [...document.querySelectorAll(`path[data-to="${CSS.escape(code)}"]`)].map((e) => e.dataset.from),
  };
}, code);

for (const year of ['2025-2026', null]) {
  test(`EE BS, catalog ${year || 'current'}: ECE 4900 has a line from ECE 4730 and is planned after it`, async () => {
    const p = await open('electrical-engineering-bs', year);
    const a = await where(p, 'ECE 4730'), b = await where(p, 'ECE 4900');
    assert.ok(b.from.includes('ECE 4730'), `lines into ECE 4900: ${JSON.stringify(b.from)}`);
    assert.ok(a.left != null && b.left > a.left, `ECE 4900 (x ${b.left}) right of ECE 4730 (x ${a.left})`);
    assert.ok(a.sem != null && b.sem > a.sem, `plan: ECE 4730 sem ${a.sem}, ECE 4900 sem ${b.sem}`);
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });
}

test('EE BS 2025-26: the class sheet\'s Before line for ECE 4900 names ECE 4730 and links the current catalog', async () => {
  const p = await open('electrical-engineering-bs', '2025-2026');
  const r = await p.evaluate(async () => {
    const box = document.querySelector('#boxes .box[data-id="ECE 4900"]');
    // the class sheet opens from the plan row (a tap on the box marks it taken)
    document.querySelector('li[data-unit="ECE 4900"]')?.click();
    await new Promise((res) => setTimeout(res, 300));
    const facts = [...document.querySelectorAll('#clsFacts dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent || '', dt.nextElementSibling?.querySelector('a')?.getAttribute('href') || '']);
    return { box: !!box, facts };
  });
  const before = r.facts.find(([k]) => k === 'Before');
  assert.ok(before && /ECE 4730/.test(before[1]), JSON.stringify(r.facts));
  assert.ok(before[2] && !/archives/.test(before[2]), `Before links ${before[2]}`);
  await p.context().close();
});

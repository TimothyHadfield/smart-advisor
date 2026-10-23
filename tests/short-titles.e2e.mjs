// Short class names and requirement labels in the real page: headless WebKit (Safari's engine), iPhone 15
// and a laptop. Tim, 2026-10-22: "it says the full name and then gets interupted and continues with ..."
//   1. serve the repo:   python -m http.server 8137 --bind 127.0.0.1
//   2. run:              node --test tests/short-titles.e2e.mjs        (APP_URL=... for another address)
// Checks, measured with the page's own CSS (not estimated):
//   - no class-name line (.box i) or requirement box (.box.ph b) is cut: each fits its line clamp unclamped,
//     and no word is wider than its box; no code line ("ACC 1110 +1120") is cut
//   - no requirement row in the plan list ends in "…"
//   - every short name in data/short-titles.json fits the box (92 px), and every label one plan row
//   - a screen reader still gets the full name (hidden span), the class sheet shows the full title
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
async function open(id, { desktop = false } = {}) {
  const ctx = await browser.newContext({ ...(desktop ? { viewport: { width: 1440, height: 900 } } : devices['iPhone 15']), serviceWorkers: 'block' });
  await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.abort());
  const saved = { plan: { programs: [id], catalogYear: null }, done: {} };
  await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(saved)]);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  await p.goto(APP + '?p=' + id);
  // start on the flowchart (a saved plan opens on Home)
  await p.evaluate(() => { if (document.querySelector('#main')?.dataset.tab === 'home') document.querySelector('#hmGo [data-go="flow"]')?.click(); });
  await p.waitForSelector('.box');
  await p.waitForTimeout(400);
  return p;
}

// every box name line, measured unclamped: more lines than its clamp, or a word wider than the box = cut
const cutBoxes = (p) => p.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('.box i:not(.pk), .box.ph > b')) {
    if (!el.textContent.trim() || el.closest('.box').hidden) continue;
    const cs = getComputedStyle(el);
    const clamp = parseInt(cs.webkitLineClamp, 10) || 1;
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.15;
    const keep = el.getAttribute('style') || '';
    el.style.webkitLineClamp = 'unset'; el.style.display = 'block'; el.style.overflowWrap = 'normal'; el.style.overflow = 'visible';
    const lines = Math.round(el.getBoundingClientRect().height / lh);
    const wide = el.scrollWidth > el.clientWidth + 0.5;
    el.setAttribute('style', keep);
    if (lines > clamp || wide) out.push(`${el.closest('.box').dataset.id}: "${el.textContent}" (${lines} lines${wide ? ', word too wide' : ''})`);
  }
  // the code line of a class / option box (one line, "…" when cut)
  for (const el of document.querySelectorAll('.box:not(.ph) > b')) {
    if (!el.closest('.box').hidden && el.scrollWidth > el.clientWidth + 0.5) out.push(`${el.closest('.box').dataset.id}: code "${el.textContent}" cut`);
  }
  return out;
});
// requirement rows in the plan list that end in "…"
const cutRows = (p) => p.evaluate(() => [...document.querySelectorAll('.sem li.ph span:first-child')]
  .filter((s) => s.scrollWidth > s.clientWidth + 0.5).map((s) => s.textContent));

const PROGRAMS = ['electrical-engineering-bs', 'computer-engineering-bs', 'mechanical-engineering-bs', 'nursing-bs', 'computer-science-bs', 'accounting-bs', 'marketing-bs', 'art-design-bs'];

for (const desktop of [false, true]) {
  test(`no class name or requirement box is cut (${desktop ? 'laptop' : 'iPhone'}): ${PROGRAMS.join(', ')}`, async () => {
    for (const id of PROGRAMS) {
      const p = await open(id, { desktop });
      assert.deepEqual(await cutBoxes(p), [], id);
      // the box label modes next to the flowchart (Code only, Title only; 2026-10-23): still nothing cut
      for (const mode of ['code', 'title']) {
        await p.click(`#lblSeg button[data-v="${mode}"]`);
        assert.deepEqual(await cutBoxes(p), [], `${id} (${mode})`);
      }
      await p.click('#lblSeg button[data-v="both"]');
      if (!desktop) await goTab(p, 'plan');
      await p.waitForSelector('.sem li');
      assert.deepEqual(await cutRows(p), [], `${id} plan list`);
      assert.deepEqual(p.errors, []);
      await p.context().close();
    }
  });
}

test("Tim's examples on the EE chart; the full name stays for screen readers and on the class sheet", async () => {
  const p = await open('electrical-engineering-bs');
  const box = (id) => p.evaluate((id) => {
    const b = document.querySelector(`.box[data-id="${id}"]`);
    return b && { shown: b.querySelector('i').textContent, hidden: b.querySelector('i').getAttribute('aria-hidden'), full: b.querySelector('.vh')?.textContent };
  }, id);
  assert.deepEqual(await box('MATH 2210'), { shown: 'Calc 3', hidden: 'true', full: 'Calculus III' });
  assert.deepEqual(await box('ECE 1000'), { shown: 'Intro to ECE', hidden: 'true', full: 'Introduction to Electrical and Computer Engineering' });
  // the class sheet keeps the catalog title (long press opens it)
  await p.evaluate(() => document.querySelector('.box[data-id="MATH 2210"]').scrollIntoView({ block: 'center', inline: 'center' }));
  const r = await p.evaluate(() => { const q = document.querySelector('.box[data-id="MATH 2210"]').getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; });
  await p.mouse.move(r.x, r.y); await p.mouse.down(); await p.waitForTimeout(700); await p.mouse.up();
  await p.waitForSelector('#clsTitle');
  assert.equal(await p.textContent('#clsTitle'), 'Calculus III');
  await p.context().close();
});

test('every short name and label in data/short-titles.json fits, measured with the real CSS', async () => {
  const p = await open('electrical-engineering-bs');
  const bad = await p.evaluate(async () => {
    const d = await (await fetch('data/short-titles.json')).json();
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden';
    document.body.appendChild(host);
    const out = [];
    // a box at the chart's box size (92 px wide), as js/app.js builds it
    const fits = (html, sel) => {
      host.innerHTML = `<button class="box" style="position:static;width:92px;height:48px">${html}</button>`;
      const el = host.querySelector(sel);
      el.style.webkitLineClamp = 'unset'; el.style.display = 'block'; el.style.overflowWrap = 'normal';
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 14;
      return Math.round(el.getBoundingClientRect().height / lh) <= 2 && el.scrollWidth <= el.clientWidth + 0.5;
    };
    // in Title mode (the default since 2026-10-23) the name is semibold: the widest it gets
    host.className = 'boxes'; host.dataset.lbl = 'title';
    for (const s of new Set(Object.values(d.titles))) if (!fits(`<b>ABCD 1234</b><i>${s.replace(/</g, '&lt;')}</i>`, 'i')) out.push(`title: ${s}`);
    host.innerHTML = '';
    const rowHost = document.createElement('div');
    rowHost.className = 'sems';
    // the narrowest plan column: a 393 px phone's two columns
    rowHost.style.cssText = 'position:absolute;left:0;top:0;width:393px;visibility:hidden;display:grid';
    document.body.appendChild(rowHost);
    const labels = new Set([...Object.values(d.labels), ...Object.values(d.names), 'Pick from list'].filter(Boolean));
    // requirement box labels as the page draws them (.box.ph b)
    for (const s of labels) {
      host.innerHTML = `<button class="box ph flex" style="position:static;width:92px;height:48px"><b>${s}</b></button>`;
      const el = host.querySelector('b');
      el.style.webkitLineClamp = 'unset'; el.style.display = 'block'; el.style.overflowWrap = 'normal';
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      if (Math.round(el.getBoundingClientRect().height / lh) > 2 || el.scrollWidth > el.clientWidth + 0.5) out.push(`ph box: ${s}`);
      rowHost.innerHTML = `<div class="sem"><ul><li class="ph"><span>${s}</span><span>3</span></li></ul></div><div class="sem"></div>`;
      const sp = rowHost.querySelector('span');
      if (sp.scrollWidth > sp.clientWidth + 0.5) out.push(`plan row: ${s}`);
    }
    return { out, n: Object.keys(d.titles).length, l: labels.size };
  });
  assert.ok(bad.n > 1500 && bad.l > 100, `${bad.n} titles, ${bad.l} labels`);
  assert.deepEqual(bad.out, []);
  await p.context().close();
});

// sections open from Home's rows (2026-10-23: no tab bar): back to Home, then the section's row
async function goTab(p, tab) {
  if (await p.getAttribute('#main', 'data-tab') !== 'home') { await p.click('#back'); await p.waitForSelector('#main[data-tab="home"]'); }
  await p.click(`#hmGo [data-go="${tab}"]`);
  await p.waitForSelector(`#main[data-tab="${tab}"]`);
}
// the gear (site settings) lives on Home
async function openGear(p) {
  if (await p.getAttribute('#main', 'data-tab') !== 'home') { await p.click('#back'); await p.waitForSelector('#main[data-tab="home"]'); }
  await p.click('#gear');
  await p.waitForSelector('#settings[open]');
}

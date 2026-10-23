// The flowchart's own controls and where every setting lives (headless WebKit as an iPhone 15 and a 1280px laptop;
// Playwright from ~/.claude/tools). Made-up classes only.
//   1. serve the repo:   python -m http.server 8137 --bind 127.0.0.1
//   2. run:              node --test tests/flowbar.e2e.mjs        (APP_URL=... for another address)
// Tim, 2026-10-23: "Instead of having the actual/hypothetcial bar in the top right, put a "explore" right above the
// flowchart and when you click on it, it tells you to click classes to change possibilities. It also switches the
// button to say "Actual Progress" or something like that. If the flowchart isn't in explore mode, when you click on
// a class, pull it up in the right-side section with all the necessary details with it."
// "I also want settings to be located right next to the places that they're relevant ... also add a setting where
// the user can choose the course boxes to either show course label (Math 2010), the course title (Calc 3), or both"
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
const SEED = {
  plan: { programs: [EE], catalogYear: null },
  done: { [EE]: ['ENGL 1010', 'MATH 1210', 'MATH 1220', 'ECE 1000'] },
  grades: { [EE]: { 'ENGL 1010': 'A', 'MATH 1210': 'B+', 'MATH 1220': 'A-', 'ECE 1000': 'IP' } },
  settings: { max: 16, summers: false, start: null, grades: true, src: { [EE]: { 'MATH 1210': 'audit' } } },
};
async function page(saved = SEED, { laptop = false } = {}) {
  const ctx = await browser.newContext(laptop ? { viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' } : { ...devices['iPhone 15'], serviceWorkers: 'block' });
  await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.abort());
  await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(saved)]);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  await p.goto(APP);
  await p.click('#hmGo [data-go="flow"]');
  await p.waitForSelector('#main[data-tab="flow"] .box[data-id="MATH 1210"]');
  await p.waitForTimeout(300);
  return p;
}
const stored = (p) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), KEY);
const box = (id) => `.box[data-id="${id}"]`;
const pressed = async (p, id) => (await p.getAttribute(box(id), 'aria-pressed')) === 'true';
const rect = (p, sel) => p.$eval(sel, (e) => e.getBoundingClientRect().toJSON());
const center = async (p, id) => p.$eval(box(id), (b) => b.scrollIntoView({ block: 'center', inline: 'center' }));

test('Explore sits right above the flowchart; it says to tap classes and becomes "Actual progress"; clear only while exploring', async () => {
  const p = await page();
  const [x, c] = await Promise.all([rect(p, '#exploreBtn'), rect(p, '#chart')]);
  assert.ok(x.bottom <= c.top + 1 && c.top - x.bottom < 16, `right above the chart ${JSON.stringify([x, c])}`);
  assert.ok(x.top >= 0 && x.bottom <= 659, 'in view without scrolling');
  assert.equal(await p.textContent('#exploreBtn'), 'Explore');
  assert.equal(await p.getAttribute('#exploreBtn', 'aria-pressed'), 'false');
  assert.equal(await p.isVisible('#hypClear'), false);
  await p.click('#exploreBtn');
  assert.equal(await p.textContent('#toastText'), 'Tap classes to try possibilities');
  assert.ok(await p.isVisible('#toast.on'));
  assert.equal(await p.textContent('#exploreBtn'), 'Actual progress');
  assert.equal(await p.getAttribute('#exploreBtn', 'aria-pressed'), 'true');
  assert.ok(await p.isVisible('#hypClear'), 'clear next to it');
  // a tap in Explore tries the class (no sheet); the actual classes stay as they were
  await center(p, 'PHYS 2210');
  await p.click(box('PHYS 2210'));
  assert.equal(await pressed(p, 'PHYS 2210'), true);
  assert.equal(await p.$('#clsDlg[open]'), null, 'no details in Explore');
  assert.ok(!(await stored(p)).done[EE].includes('PHYS 2210'));
  // back to actual progress: the try is hidden, the button says Explore again
  await p.click('#exploreBtn');
  assert.equal(await p.textContent('#exploreBtn'), 'Explore');
  assert.equal(await pressed(p, 'PHYS 2210'), false);
  assert.equal(await p.isVisible('#hypClear'), false);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

for (const laptop of [false, true]) {
  test(`outside Explore a tap opens the class's details, not Taken (${laptop ? 'laptop: right-side section' : 'iPhone: the class sheet'})`, async () => {
    const p = await page(SEED, { laptop });
    await center(p, 'PHYS 2210');
    await p.click(box('PHYS 2210'));
    await p.waitForSelector('#clsDlg[open]');
    assert.equal(await pressed(p, 'PHYS 2210'), false, 'not marked taken by the tap');
    assert.equal(await p.textContent('#clsCode'), 'PHYS 2210');
    assert.match(await p.textContent('#clsFacts'), /Credits/);
    assert.ok(await p.isVisible('#clsTakenRow'), 'marking taken stays a control in the details');
    if (laptop) {
      // the right-side section (over the plan), the flowchart still usable beside it
      const [d, c] = await Promise.all([rect(p, '#clsDlg'), rect(p, '#chart')]);
      assert.ok(d.right >= 1279 && d.left >= c.right - 1 && d.width <= 401, `right side ${JSON.stringify(d)}`);
      assert.equal(await p.$eval('#clsDlg', (e) => e.matches(':modal')), false, 'not a modal');
      await center(p, 'MATH 2210');
      await p.click(box('MATH 2210'));
      assert.equal(await p.textContent('#clsCode'), 'MATH 2210', 'another tap shows that class');
      await p.keyboard.press('Escape');
      await p.waitForTimeout(150);
      assert.equal(await p.$('#clsDlg[open]'), null, 'Esc closes it');
    } else {
      await p.goBack();
      await p.waitForTimeout(200);
      assert.equal(await p.$('#clsDlg[open]'), null, 'Back closes it');
      assert.equal(await p.getAttribute('#main', 'data-tab'), 'flow');
    }
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });
}

// Code / Title / Both: what MATH 2210 (and a lecture + lab box) shows; nothing moves; saved
const shows = (p) => p.evaluate(() => {
  const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
  const of = (id) => {
    const b = document.querySelector(`.box[data-id="${id}"]`);
    const code = b.querySelector(':scope > b'), title = b.querySelector(':scope > i');
    return { code: vis(code) ? code.textContent : null, title: vis(title) ? title.textContent : null, lab: vis(code?.querySelector('small')) };
  };
  return { m: of('MATH 2210'), lab: of('ECE 2250'), ge: document.querySelector('.box.ph b')?.textContent || '', xy: [...document.querySelectorAll('.box')].slice(0, 30).map((b) => `${b.offsetLeft},${b.offsetTop},${b.offsetWidth},${b.offsetHeight}`).join(' ') };
});
const MODES = {
  code: { m: { code: 'MATH 2210', title: null }, lab: { code: 'ECE 2250+Lab', title: null } },
  title: { m: { code: null, title: 'Calc 3' }, lab: { title: 'Circuits', lab: true } },
  both: { m: { code: 'MATH 2210', title: 'Calc 3' }, lab: { code: 'ECE 2250+Lab', title: 'Circuits' } },
};
for (const [mode, want] of Object.entries(MODES)) {
  test(`box labels: ${mode === 'both' ? 'Both (default)' : mode === 'code' ? 'Code (MATH 2210)' : 'Title (Calc 3)'}: shown instantly, nothing moves, saved`, async () => {
    const p = await page();
    const before = await shows(p);
    assert.equal(await p.getAttribute('#lblSeg button.on', 'data-v'), 'both', 'Both is the default');
    if (mode === 'both') await p.click('#lblSeg button[data-v="title"]'); // (away and back)
    await p.click(`#lblSeg button[data-v="${mode}"]`);
    const now = await shows(p);
    assert.equal(now.m.code, want.m.code);
    assert.equal(now.m.title, want.m.title);
    if (want.lab.code !== undefined) assert.equal(now.lab.code, want.lab.code);
    assert.equal(now.lab.title, want.lab.title);
    if (want.lab.lab) assert.equal(now.lab.lab, true, 'a lecture + lab box keeps "+Lab"');
    assert.equal(now.ge, before.ge, 'requirement boxes keep their label');
    assert.equal(now.xy, before.xy, 'no layout jump');
    assert.equal(await p.getAttribute('#lblSeg button.on', 'data-v'), mode);
    assert.equal((await stored(p)).settings.labels, mode);
    await p.reload();
    await p.waitForSelector('#main[data-tab="flow"] .box[data-id="MATH 1210"]');
    assert.deepEqual((await shows(p)).m, now.m, 'kept after a reload');
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });
}

test('settings live next to what they change: flowchart and schedule controls in the open, the gear only site-wide', async () => {
  const FLOW = ['exploreBtn', 'lblSeg', 'gradesOn', 'setSemColors', 'fitBtn'];
  const SCHED = ['setDays', 'setAfter', 'setBefore', 'setMode', 'setGaps', 'setRmp', 'setMain', 'setWait'];
  const GEAR = ['setStart', 'setMax', 'setSummer', 'importBtn', 'clearDone', 'setVer'];
  for (const laptop of [false, true]) {
    const p = await page(SEED, { laptop });
    const inside = (ids, sel) => p.evaluate(([ids, sel]) => ids.filter((id) => !document.getElementById(id)?.closest(sel)), [ids, sel]);
    assert.deepEqual(await inside(FLOW, '#flowPanel'), [], 'flowchart controls next to the flowchart');
    assert.deepEqual(await inside(SCHED, '#schedPanel'), [], 'schedule controls next to the schedule');
    assert.deepEqual(await inside(GEAR, '#settings'), [], 'site-wide ones in the gear');
    assert.equal(await p.$eval('#settings', (d) => d.querySelectorAll('input, select, button:not(.ok)').length), 5, 'nothing else in the gear');
    // the flowchart's controls: out in the open at the phone's width, at most two short lines, no sideways scroll
    for (const id of ['exploreBtn', 'lblSeg', 'gradesOn', 'setSemColors']) assert.ok(await p.isVisible(`#${id}`), id);
    const rows = await p.evaluate(() => new Set(['#exploreBtn', '#lblSeg', '#gradesOn', '#setSemColors'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top / 20))).size);
    assert.ok(rows <= 2, `${rows} lines`);
    assert.ok(await p.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth), 'no sideways scroll');
    // the schedule's: a laptop shows them; a phone opens them with the Filters button next to the schedule
    await p.click('#back');
    await p.click('#hmGo [data-go="sched"]');
    await p.waitForSelector('#main[data-tab="sched"]');
    if (!laptop) {
      assert.equal(await p.isVisible('#setDays'), false, 'folded on a phone');
      await p.click('#scFilt');
      assert.equal(await p.getAttribute('#scFilt', 'aria-expanded'), 'true');
    }
    for (const id of SCHED) assert.ok(await p.isVisible(`#${id}`), `${id} ${laptop ? 'laptop' : 'phone'}`);
    assert.ok(await p.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth), 'no sideways scroll');
    // a filter still works from there
    const was = await p.isChecked('#setGaps');
    await p.click('#setGaps');
    assert.equal((await stored(p)).settings.sched.prefs.gaps, !was);
    assert.deepEqual(p.errors, []);
    await p.context().close();
  }
});

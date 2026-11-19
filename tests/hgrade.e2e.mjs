// Hypothetical grades + GPA beside Explore (headless WebKit as an iPhone 15 and a 1280px laptop; Playwright from
// ~/.claude/tools). Made-up classes only.
//   1. serve the repo:   python -m http.server 8137 --bind 127.0.0.1
//   2. run:              node --test tests/hgrade.e2e.mjs        (APP_URL=... for another address)
// Tim, 2026-11-19: "Could you show somewhere in the flowchart section the user's current GPA, and also hypothetical GPA
// if they put in hypothetical grades in future classes (which you can if you click on that class and then select a
// specific grade (show the normal % that correlate with each grade aswell, and the GP that corelates with that letter.
// Make a button next to the "explore" where you can reset the hypothetical grades aswell."
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
async function page({ laptop = false } = {}) {
  const ctx = await browser.newContext(laptop ? { viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' } : { ...devices['iPhone 15'], serviceWorkers: 'block' });
  await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.abort());
  await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(SEED)]);
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
const rect = (p, sel) => p.$eval(sel, (e) => e.getBoundingClientRect().toJSON());
const num = (s) => s.match(/\d\.\d\d/g).map(Number);
async function openBox(p, id) {
  await p.$eval(box(id), (b) => b.scrollIntoView({ block: 'center', inline: 'center' }));
  await p.click(box(id));
  await p.waitForSelector('#clsDlg[open]');
}

for (const laptop of [false, true]) {
  test(`${laptop ? 'laptop' : 'iPhone'}: GPA beside Explore; a future class takes a hypothetical grade (letter, %, points); Reset grades`, async () => {
    const p = await page({ laptop });
    // current GPA, right next to Explore and in view without scrolling; no Reset yet
    assert.ok(await p.isVisible('#xGpa'));
    const [now] = num(await p.textContent('#xGpa'));
    assert.ok(now > 3 && now < 4, `GPA ${now}`);
    assert.equal(await p.isVisible('#hgReset'), false);
    const g = await rect(p, '#xGpa'), c = await rect(p, '#chart');
    assert.ok(g.bottom <= c.top + 1 && g.top >= 0, 'above the chart, in view');
    // a class not taken: the picker lists every letter with its usual % and UVU's points (B+ = 3.4)
    await openBox(p, 'PHYS 2210');
    assert.ok(await p.isVisible('#clsHg'));
    assert.equal(await p.$$eval('#clsHg [data-hg]', (b) => b.length), 12);
    assert.equal((await p.textContent('#clsHg [data-hg="B+"]')).replace(/\s+/g, ''), 'B+87–89%3.4');
    assert.equal((await p.textContent('#clsHg [data-hg="A"]')).replace(/\s+/g, ''), 'A93–100%4.0');
    await p.click('#clsHg [data-hg="E"]');
    assert.equal(await p.getAttribute('#clsHg [data-hg="E"]', 'aria-pressed'), 'true');
    assert.equal((await stored(p)).settings.hgrade[EE]['PHYS 2210'], 'E');
    const [n2, h2] = num(await p.textContent('#xGpa'));
    assert.equal(n2, now, 'current GPA unchanged');
    assert.ok(h2 < now, `an E lowers it (${h2} < ${now})`);
    assert.equal(await p.textContent(`${box('PHYS 2210')} .gr`), 'E', 'the box shows the tried grade');
    // tap it again: none
    await p.click('#clsHg [data-hg="E"]');
    assert.equal(await p.isVisible('#hgReset'), false);
    await p.click('#clsHg [data-hg="A"]');
    assert.ok(num(await p.textContent('#xGpa'))[1] > now, 'an A raises it');
    // a class already taken with a grade: no picker; one in progress: has one
    await openBox(p, 'MATH 1220');
    assert.equal(await p.isVisible('#clsHg'), false);
    await openBox(p, 'ECE 1000');
    assert.ok(await p.isVisible('#clsHg'));
    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);
    // Reset grades, next to Explore: back to the current GPA only, with Undo
    assert.ok(await p.isVisible('#hgReset'));
    const [x, r] = await Promise.all([rect(p, '#exploreBtn'), rect(p, '#hgReset')]);
    assert.ok(Math.abs(x.top - r.top) < 4 && r.left > x.left, 'beside Explore');
    await p.click('#hgReset');
    assert.equal(num(await p.textContent('#xGpa')).length, 1);
    assert.equal(await p.isVisible('#hgReset'), false);
    assert.deepEqual((await stored(p)).settings.hgrade[EE], {});
    assert.equal(await p.textContent(`${box('PHYS 2210')} .gr`), '');
    await p.click('#toastUndo');
    assert.equal(num(await p.textContent('#xGpa')).length, 2);
    // Explore = nothing personal: no GPA, no Reset
    await p.click('#exploreBtn');
    assert.equal(await p.isVisible('#xGpa'), false);
    assert.equal(await p.isVisible('#hgReset'), false);
    assert.equal(await p.textContent(`${box('PHYS 2210')} .gr`), '');
    // no page scroll sideways
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });
}

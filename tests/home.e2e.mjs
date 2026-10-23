// Home screen end to end (headless WebKit as an iPhone 15, and a 1280px laptop; Playwright from ~/.claude/tools).
//   1. serve the repo:   python -m http.server 8137 --bind 127.0.0.1
//   2. run:              node --test tests/home.e2e.mjs
// The signed-in test needs the emulators (it skips without them):
//   firebase emulators:exec --only auth,firestore --project smart-advisor-th "node --test tests/home.e2e.mjs"
// It signs in with an emulator-only Google credential (made-up "Alex Student"); never the real project.
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
// a made-up student: EE B.S., first-year classes done (graded), two in progress
const ALEX = {
  plan: { programs: [EE], catalogYear: null },
  done: { [EE]: ['ENGL 1010', 'MATH 1210', 'MATH 1220', 'PHYS 2210', 'PHYS 2215', 'ECE 1000', 'ECE 2700', 'ECE 2705'] },
  grades: { [EE]: { 'ENGL 1010': 'A', 'MATH 1210': 'B+', 'MATH 1220': 'A-', 'PHYS 2210': 'B', 'PHYS 2215': 'A', 'ECE 1000': 'A', 'ECE 2700': 'IP', 'ECE 2705': 'IP' } },
  settings: { max: 16, summers: false, start: null, grades: true, src: { [EE]: { 'ENGL 1010': 'audit', 'MATH 1210': 'audit' } } },
};
async function page(saved, { laptop = false, firebase = false } = {}) {
  const ctx = await browser.newContext(laptop ? { viewport: { width: 1280, height: 800 } } : { ...devices['iPhone 15'], serviceWorkers: 'block' });
  if (!firebase) await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.abort());
  if (saved) await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(saved)]);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  return p;
}
const visible = (p, sel) => p.isVisible(sel);
const tab = (p) => p.getAttribute('#main', 'data-tab');

test('the app opens on Home: major, credits, graduation, Now; flowchart hidden', async () => {
  const p = await page(ALEX);
  await p.goto(APP);
  await p.waitForSelector('#homePanel .hm-bar .seg-done', { timeout: 8000 });
  assert.equal(await tab(p), 'home');
  assert.ok(await visible(p, '#homePanel'));
  assert.equal(await visible(p, '#flowPanel'), false, 'flowchart not shown');
  assert.equal(await p.getAttribute('#tabs button.on', 'data-tab'), 'home');
  const home = await p.textContent('#homePanel');
  assert.match(home, /Electrical Engineering, B\.S\./);
  assert.match(home, /Welcome/, 'signed out: plain greeting');
  assert.match(await p.textContent('#hmCredits'), /\d+ of \d+ cr/);
  assert.match(await p.textContent('#hmFacts'), /Graduate\s*(Spring|Summer|Fall) 20\d\d/);
  assert.match(await p.textContent('#hmFacts'), /Now\s*ECE 2700/);
  assert.match(await p.textContent('#hmFacts'), /GPA\s*3\.\d\d/);
  // every outside fact links to its source: the catalog pages, UVU's own flowchart, the Gen Ed lists
  const src = await p.$$eval('#homePanel a.src', (as) => as.map((a) => a.href));
  assert.ok(src.some((u) => /catalog\.uvu\.edu\/.*#requirementstextcontainer/.test(u)), JSON.stringify(src));
  assert.ok(src.some((u) => /uvu\.edu/.test(u) && /\.pdf|flowchart/i.test(u)), 'UVU flowchart ' + JSON.stringify(src));
  assert.ok(await p.$('#hmFacts a.src'), 'Gen Ed source arrow');
  // fits the phone: no page scroll, nothing wider than the screen
  const m = await p.evaluate(() => ({ sh: document.scrollingElement.scrollHeight, h: innerHeight, sw: document.scrollingElement.scrollWidth, w: innerWidth, ph: document.getElementById('homePanel').scrollHeight, pc: document.getElementById('homePanel').clientHeight }));
  assert.ok(m.sh <= m.h && m.sw <= m.w, JSON.stringify(m));
  assert.ok(m.ph <= m.pc + 1, `Home fits without scrolling ${JSON.stringify(m)}`);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('Home → Flowchart and Schedule; Back returns to Home', async () => {
  const p = await page(ALEX);
  await p.goto(APP);
  await p.waitForSelector('#homePanel [data-go="flow"]');
  await p.click('#homePanel [data-go="flow"]');
  await p.waitForSelector('.box[data-id="MATH 1210"]');
  assert.equal(await tab(p), 'flow');
  assert.equal(await visible(p, '#homePanel'), false);
  await p.goBack();
  await p.waitForTimeout(200);
  assert.equal(await tab(p), 'home');
  assert.ok(await visible(p, '#homePanel'));
  await p.click('#homePanel [data-go="sched"]');
  await p.waitForSelector('#schedPanel', { state: 'visible' });
  assert.equal(await tab(p), 'sched');
  await p.goBack();
  await p.waitForTimeout(200);
  assert.equal(await tab(p), 'home');
  assert.ok(p.url().startsWith(APP), 'still on the site');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('first visit, signed out: greeting + Pick your major, which opens the picker', async () => {
  const p = await page(null);
  await p.goto(APP);
  await p.waitForSelector('#homePanel [data-pick]', { timeout: 8000 });
  assert.equal(await tab(p), 'home');
  assert.match(await p.textContent('#hmName'), /Welcome/);
  assert.equal(await p.$('#pick[open]'), null, 'Home first, not the picker on top of it');
  await p.click('#homePanel [data-pick]');
  await p.waitForSelector('#pick[open]');
  await p.click('#pickList button[data-id="nursing-bs"]');
  await p.click('#pick .ok');
  await p.waitForFunction(() => /Nursing/.test(document.querySelector('#homePanel').textContent));
  assert.equal(await tab(p), 'home');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('an old ?p= link to a program still opens its flowchart', async () => {
  const p = await page(ALEX);
  await p.goto(APP + '?p=nursing-bs');
  await p.waitForFunction(() => /Nursing/.test(document.querySelector('#progName').textContent));
  assert.equal(await tab(p), 'flow');
  assert.ok(await visible(p, '#flowPanel'));
  const q = await page(null);
  await q.goto(APP + `?p=${EE}`);
  await q.waitForSelector('.box[data-id="MATH 1210"]');
  assert.equal(await tab(q), 'flow', 'first visit from a link');
  assert.deepEqual([...p.errors, ...q.errors], []);
  await p.context().close(); await q.context().close();
});

test('laptop: Home in the header switch, details and entries side by side, no page scroll', async () => {
  const p = await page(ALEX, { laptop: true });
  await p.goto(APP);
  await p.waitForSelector('#homePanel .hm-bar .seg-done');
  assert.ok(await visible(p, '#wtabs button[data-tab="home"].on'));
  assert.equal(await visible(p, '#planPanel'), false, 'plan stays with the flowchart');
  const [a, b] = await Promise.all(['.hm-main', '.hm-go'].map((s) => p.$eval(`#homePanel ${s}`, (e) => e.getBoundingClientRect().toJSON())));
  assert.ok(b.left >= a.right - 1, `side by side ${JSON.stringify([a, b])}`);
  const m = await p.evaluate(() => ({ sh: document.scrollingElement.scrollHeight, h: innerHeight, ph: document.getElementById('homePanel').scrollHeight, pc: document.getElementById('homePanel').clientHeight }));
  assert.ok(m.sh <= m.h && m.ph <= m.pc + 1, JSON.stringify(m));
  await p.click('#wtabs button[data-tab="flow"]');
  await p.waitForSelector('.box[data-id="MATH 1210"]');
  assert.ok(await visible(p, '#planPanel'), 'flowchart + plan');
  await p.goBack();
  await p.waitForTimeout(200);
  assert.equal(await tab(p), 'home');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

// signed in (emulator only): the account's name is the big line on Home
const emu = await fetch('http://127.0.0.1:9106/').then(() => true, () => false);
test('signed in: Home shows the account name', { skip: !emu && 'emulators not running' }, async () => {
  const p = await page(ALEX, { firebase: true });
  await p.goto(APP + '?emu');
  await p.waitForFunction(() => typeof window.__saEmuSignIn === 'function', null, { timeout: 15000 });
  await p.evaluate(() => window.__saEmuSignIn('alex-home-test', 'alex.student@example.com', 'Alex Student'));
  await p.waitForFunction(() => /Alex Student/.test(document.querySelector('#hmName').textContent), null, { timeout: 10000 });
  assert.equal(await tab(p), 'home');
  assert.match(await p.textContent('#homePanel'), /Electrical Engineering, B\.S\./);
  assert.doesNotMatch(await p.textContent('#hmName'), /Welcome/);
  await p.context().close();
});

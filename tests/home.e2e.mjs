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
// fits the screen: no page scroll, nothing wider than the screen, Home's own list not scrolling either
const fits = (p) => p.evaluate(() => ({ sh: document.scrollingElement.scrollHeight, h: innerHeight, sw: document.scrollingElement.scrollWidth, w: innerWidth,
  ph: document.querySelector('#homePanel .hm').scrollHeight, pc: document.querySelector('#homePanel .hm').clientHeight }));

// Tim, 2026-10-23: "the home page shouldn't have any top bar and all the info should be in a list ... The homepage
// should have the user's name, their major/minor with graduation progress, catelog year, and current GPA, (no links
// to UVU or anything in homepage) (also remove the long bar seperated by semester and whatnot, keep it simple)"
for (const laptop of [false, true]) {
  test(`Home (${laptop ? 'laptop' : 'iPhone'}): no top bar, a list: major + minor with progress, catalog, GPA, graduation; no links; fits`, async () => {
    const p = await page({ ...ALEX, plan: { programs: [EE, 'mathematics-minor'], catalogYear: null } }, { laptop });
    await p.goto(APP);
    await p.waitForSelector('#hmFacts .hm-prog', { timeout: 8000 });
    assert.equal(await tab(p), 'home');
    assert.equal(await visible(p, '#top'), false, 'no top bar on Home');
    assert.equal(await p.$('#tabs, #wtabs'), null, 'no Home / Flowchart / Schedule switch');
    assert.equal(await visible(p, '#flowPanel'), false, 'flowchart not shown');
    const rows = await p.$$eval('#hmFacts > div', (ds) => ds.map((d) => [d.querySelector('dt').textContent, d.querySelector('dd').textContent]));
    const row = (k) => rows.find((r) => r[0] === k)?.[1] || '';
    assert.match(row('Major'), /^Electrical Engineering, B\.S\.\d+% · \d+(\.\d)? of \d+(\.\d)? cr · \d+(\.\d)? now$/, JSON.stringify(rows));
    assert.match(row('Minor'), /^Mathematics, Minor\d+% · \d+(\.\d)? of \d+(\.\d)? cr/);
    assert.match(row('Catalog'), /^20\d\d-\d\d$/);
    assert.match(row('GPA'), /^3\.\d\d$/);
    assert.match(row('Graduation'), /^(May|Aug|Dec) 20\d\d$/);
    // gone from Home: every link, the semester bar, Next / Now / Gen Ed / Admission, the 120 / 40 notes
    assert.equal(await p.$$eval('#homePanel a', (as) => as.length), 0, 'no links');
    assert.equal(await p.$('#homePanel .hm-bar, #hmCredits, #hmNotes'), null, 'no credits bar');
    for (const k of ['Next', 'Now', 'Gen Ed', 'Admission']) assert.ok(!row(k), `no ${k}`);
    // Tim, 2026-10-23: "Make the actual sections large clickable boxes with big font ... plan is in the flowchart
    // section, so remove that as a section box ... Instead of having a profile box, just put a little profile
    // circle in the top right": two big boxes (Flowchart, Schedule), each in view; the gear and the circle top right
    assert.deepEqual(await p.$$eval('#hmGo [data-go]', (bs) => bs.map((b) => b.dataset.go)), ['flow', 'sched']);
    for (const go of ['flow', 'sched']) assert.ok(await visible(p, `#hmGo [data-go="${go}"]`), go);
    const box = await p.$eval('#hmGo [data-go="flow"]', (b) => ({ h: b.getBoundingClientRect().height, f: parseFloat(getComputedStyle(b.querySelector('b')).fontSize), ta: getComputedStyle(b).textAlign }));
    assert.ok(box.h >= 120 && box.f >= 22 && box.ta === 'center', `large box, big centered text ${JSON.stringify(box)}`);
    // the facts: centered, not boxes
    const fact = await p.$eval('#hmGpa', (d) => { const cs = getComputedStyle(d.parentElement); return { ta: cs.textAlign, bg: cs.backgroundColor, sh: cs.boxShadow }; });
    assert.ok(fact.ta === 'center' && /rgba\(0, 0, 0, 0\)|transparent/.test(fact.bg) && fact.sh === 'none', JSON.stringify(fact));
    assert.equal(await p.$('#hmGo [data-go="settings"]'), null, 'no Settings row (the gear)');
    const g = await p.$eval('#gear', (e) => { const r = e.getBoundingClientRect(); return { x: r.right, y: r.top, w: innerWidth }; });
    assert.ok(g.w - g.x < 24 && g.y < 70, `gear top right ${JSON.stringify(g)}`);
    const c = await p.$eval('#profile', (e) => { const r = e.getBoundingClientRect(); return { x: r.right, y: r.top, w: r.width, W: innerWidth }; });
    assert.ok(c.W - c.x < 80 && c.y < 70 && c.w <= 44, `profile circle top right, small ${JSON.stringify(c)}`);
    // Tim, 2026-10-23: "people don't even know it's for UVU only": what the site is, in view
    assert.match(await p.textContent('#hmBrand'), /Smart Advisor.*Unofficial.*Utah Valley University/);
    assert.ok(await visible(p, '#hmBrand'));
    const m = await fits(p);
    assert.ok(m.sh <= m.h && m.sw <= m.w && m.ph <= m.pc + 1, `Home fits without scrolling ${JSON.stringify(m)}`);
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });
}

test('each section is its own screen: back arrow (top left) returns Home; so does the browser / phone Back', async () => {
  const p = await page(ALEX);
  await p.goto(APP);
  await p.waitForSelector('#hmGo [data-go="flow"]');
  await p.click('#hmGo [data-go="flow"]');
  await p.waitForSelector('.box[data-id="MATH 1210"]');
  assert.equal(await tab(p), 'flow');
  assert.equal(await visible(p, '#homePanel'), false);
  assert.equal(await p.textContent('#ttl'), 'Flowchart');
  const b = await p.$eval('#back', (e) => e.getBoundingClientRect().toJSON());
  assert.ok(b.left < 20 && b.top < 70, `back arrow top left ${JSON.stringify(b)}`);
  await p.click('#back');
  await p.waitForSelector('#main[data-tab="home"]');
  assert.ok(await visible(p, '#homePanel'));
  for (const [go, title] of [['sched', 'Schedule'], ['plan', 'Flowchart']]) {
    // the plan: the Flowchart's Plan view on a phone (Chart | Plan in the header)
    if (go === 'plan') { await p.click('#hmGo [data-go="flow"]'); await p.waitForSelector('#main[data-tab="flow"]'); await p.click('#fpSeg [data-v="plan"]'); }
    else await p.click(`#hmGo [data-go="${go}"]`);
    await p.waitForSelector(`#main[data-tab="${go}"]`);
    assert.equal(await p.textContent('#ttl'), title);
    // steps inside a section (the plan's Classes view): the arrow still goes straight Home
    if (go === 'plan') await p.click('#planSeg button[data-v="classes"]');
    await p.click('#back');
    await p.waitForSelector('#main[data-tab="home"]');
  }
  // browser / phone Back
  await p.click('#hmGo [data-go="sched"]');
  await p.waitForSelector('#main[data-tab="sched"]');
  await p.goBack();
  await p.waitForSelector('#main[data-tab="home"]');
  assert.ok(p.url().startsWith(APP), 'still on the site');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('a shared ?p= link opens its flowchart; Back (arrow or browser) lands on Home', async () => {
  const p = await page(ALEX);
  await p.goto(APP + '?p=nursing-bs');
  await p.waitForSelector('#main[data-tab="flow"]');
  await p.waitForFunction(() => /Nursing/.test(document.querySelector('#hmFacts').textContent));
  await p.goBack();
  await p.waitForSelector('#main[data-tab="home"]');
  assert.ok(p.url().startsWith(APP), 'Back stays on the site');
  const q = await page(null);
  await q.goto(APP + `?p=${EE}`);
  await q.waitForSelector('.box[data-id="MATH 1210"]');
  assert.equal(await tab(q), 'flow', 'first visit from a link');
  await q.click('#back');
  await q.waitForSelector('#main[data-tab="home"]');
  assert.deepEqual([...p.errors, ...q.errors], []);
  await p.context().close(); await q.context().close();
});

test('first visit, signed out: greeting + Pick your major, which opens the picker; the major on Home opens it too', async () => {
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
  await p.click('#hmFacts .hm-prog button');
  await p.waitForSelector('#pick[open]');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

// Tim, 2026-10-23: "just put a little profile circle in the top right that says "sign in" and "create an account""
test('signed out: the profile circle opens a small menu with Sign in and Create an account; outside tap / Esc closes it', async () => {
  for (const laptop of [false, true]) {
    const p = await page(ALEX, { laptop });
    await p.goto(APP);
    await p.waitForSelector('#hmFacts .hm-prog');
    await p.click('#profile');
    await p.waitForSelector('#pfDlg[open]');
    assert.ok(await visible(p, '#acctGoogle') && await visible(p, '#acctCreate'));
    assert.match(await p.textContent('#acctOut'), /Sign[- ]in[\s\S]*Create an account/); // (Firebase is blocked here: "Sign-in unavailable offline")
    assert.equal(await visible(p, '#acctIn'), false);
    // under the circle, inside the screen
    const r = await p.$eval('#pfDlg', (d) => { const b = d.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, w: innerWidth }; });
    assert.ok(r.l >= 0 && r.r <= r.w && r.t < 80, JSON.stringify(r));
    await p.keyboard.press('Escape');
    await p.waitForSelector('#pfDlg:not([open])', { state: 'attached' });
    await p.click('#profile');
    await p.waitForSelector('#pfDlg[open]');
    await p.mouse.click(20, 600);
    await p.waitForSelector('#pfDlg:not([open])', { state: 'attached' });
    assert.equal(await tab(p), 'home');
    assert.deepEqual(p.errors, []);
    await p.context().close();
  }
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
  // the circle shows the initial; its menu changes the displayed name, each word capitalized (own capitals kept)
  // (Tim, 2026-10-23: "allow the user to change their displayed name ... automatically capitalize")
  assert.equal(await p.textContent('#pfInit'), 'A');
  await p.click('#profile');
  await p.waitForSelector('#pfName', { state: 'visible' });
  await p.fill('#pfName', '  ronald  mcDonald-smith ');
  await p.press('#pfName', 'Enter');
  assert.equal(await p.inputValue('#pfName'), 'Ronald McDonald-Smith');
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => document.querySelector('#hmName').textContent === 'Ronald McDonald-Smith');
  assert.equal(await p.textContent('#pfInit'), 'R');
  await p.context().close();
});

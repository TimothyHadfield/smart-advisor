// End-to-end: after a deploy, a phone that still has the old build in its HTTP cache gets the new one
// without a hard refresh (js/fresh.js). Starts its own server that mimics GitHub Pages:
// `Cache-Control: max-age=600`, ONE shared Last-Modified (the deploy time) for every file, ETags, 304s.
// Headless WebKit (Playwright from ~/.claude/tools), iPhone 15. Not part of the plain suite.
//   run: node --test tests/fresh.e2e.mjs        (FRESH_ROOT=<dir> serves another copy of the site)
// No page.route(): Playwright turns the HTTP cache off when routing is on, and the cache is the point.
// Firebase loads from gstatic as a guest (nothing is read or written).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const { webkit, devices } = createRequire(join(homedir(), '.claude/tools/'))('playwright');
const ROOT = resolve(process.env.FRESH_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const OLD = 'Smart Advisor', NEW = 'Smart Advisor NEW';

// the "deploy": a time shared by every file, plus a visible string in index.html
let deploy = new Date(Date.now() - 3600_000);
deploy.setMilliseconds(0);
let brand = OLD;
const log = [];

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = resolve(ROOT, '.' + (path.endsWith('/') ? path + 'index.html' : path));
  log.push(`${req.method} ${path}`);
  if (!file.startsWith(ROOT + sep) || file.slice(ROOT.length).includes(`${sep}.claude${sep}`)) { res.writeHead(404); return res.end(); }
  let body;
  try { body = await readFile(file); } catch { res.writeHead(404); return res.end(); }
  if (file.endsWith('index.html')) body = Buffer.from(body.toString('utf8').replace('<title>Smart Advisor</title>', `<title>${brand}</title>`));
  const etag = `"${deploy.getTime().toString(16)}-${createHash('md5').update(body).digest('hex').slice(0, 12)}"`;
  const head = { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'max-age=600',
    'Last-Modified': deploy.toUTCString(), ETag: etag };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, head); return res.end(); }
  res.writeHead(200, { ...head, 'Content-Length': body.length });
  res.end(req.method === 'HEAD' ? undefined : body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const APP = `http://127.0.0.1:${server.address().port}/?fresh&p=electrical-engineering-bs`;

const browser = await webkit.launch({ headless: true });
after(() => Promise.all([browser.close(), new Promise((r) => server.close(r))]));

test('a new deploy reaches a phone that has the old build cached, with one reload and no loop', async () => {
  const ctx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
  const p = await ctx.newPage();
  // the app opens on Home (2026-10-22); these checks start on the flowchart, as they did before Home
  { const go = p.goto.bind(p); p.goto = async (...a) => { const r = await go(...a); await p.evaluate(() => { if (document.querySelector('#main')?.dataset.tab === 'home') document.querySelector('#hmGo [data-go="flow"]')?.click(); }); return r; }; }
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  let loads = 0;
  p.on('load', () => loads++);
  const brandText = () => p.evaluate(() => document.title);

  await p.goto(APP);
  await p.waitForSelector('.box[data-id="MATH 1210"]');
  assert.equal(await brandText(), OLD);
  await p.waitForTimeout(1500);
  assert.equal(loads, 1, 'no reload when nothing was deployed');

  // deploy: new text, new shared Last-Modified
  deploy = new Date(deploy.getTime() + 600_000);
  brand = NEW;
  log.length = 0;
  await p.goto('about:blank');
  loads = 0;
  await p.goto(APP); // the browser serves the old page from its cache (max-age=600)
  const got = await p.waitForFunction((w) => document.title === w, NEW, { timeout: 8000 })
    .then(() => NEW, async () => brandText());
  assert.equal(got, NEW, `new build shown without a hard refresh (requests: ${log.join(', ')})`);
  // the reload landed on Home (their own saved major): go to the flowchart again
  await p.waitForFunction(() => document.querySelector('#main')?.dataset.tab).catch(() => {});
  await p.evaluate(() => { if (document.querySelector('#main').dataset.tab === 'home') document.querySelector('#hmGo [data-go="flow"]').click(); });
  await p.waitForSelector('.box[data-id="MATH 1210"]');
  await p.waitForTimeout(1500);
  assert.equal(loads, 2, 'exactly one reload (stale copy, then the new one)');

  // the version line in Settings shows the deploy time
  await openGear(p);
  const ver = await p.$eval('#setVer', (v) => v.textContent);
  const want = 'Version ' + await p.evaluate((ms) => new Date(ms).toLocaleString('en-US',
    { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }), deploy.getTime());
  assert.equal(ver, want);
  // WebKit reports a data fetch that the reload itself cuts off as "access control checks": harmless
  assert.deepEqual(errors.filter((e) => !/Fetch API cannot load .*\/data\/[\w/.-]+\.json due to access control checks/.test(e)), []);
  await ctx.close();
});

// sections open from Home's rows (2026-10-23: no tab bar): back to Home, then the section's row
// (2026-10-23: no Plan or Profile box on Home. The plan is the Flowchart's "Plan" view on a phone (the Chart | Plan
// switch) and sits beside the chart on a laptop; the profile is the circle's menu, top right)
async function goTab(p, tab) {
  if (await p.getAttribute('#main', 'data-tab') !== 'home') { await p.click('#back'); await p.waitForSelector('#main[data-tab="home"]'); }
  if (tab === 'profile') { await p.click('#profile'); await p.waitForSelector('#pfDlg[open]'); return; }
  const go = tab === 'plan' ? 'flow' : tab;
  await p.click(`#hmGo [data-go="${go}"]`);
  await p.waitForSelector(`#main[data-tab="${go}"]`);
  if (tab === 'plan' && await p.isVisible('#fpSeg')) { await p.click('#fpSeg [data-v="plan"]'); await p.waitForSelector('#main[data-tab="plan"]'); }
}
// the gear (site settings) lives on Home
async function openGear(p) {
  if (await p.getAttribute('#main', 'data-tab') !== 'home') { await p.click('#back'); await p.waitForSelector('#main[data-tab="home"]'); }
  await p.click('#gear');
  await p.waitForSelector('#settings[open]');
}

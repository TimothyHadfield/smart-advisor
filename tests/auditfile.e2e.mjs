// "View submitted audit" in the account menu opens the exact file last applied from Import audit (kept on this device).
// Headless WebKit as an iPhone 15 (Playwright from ~/.claude/tools; Chromium only prints the made-up PDF). Needs the
// network for pdf.js (cdnjs), like the site.
//   1. serve the repo:   python -m http.server 8137 --bind 127.0.0.1
//   2. run:              node --test tests/auditfile.e2e.mjs        (APP_URL=... for another address)
// Tim, 2026-11-19: "could you also add somewhere in the account menu that says "view submitted audit" and that pulls up
// the exact file that you submitted to it?"
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

const { webkit, chromium, devices } = createRequire(join(homedir(), '.claude/tools/'))('playwright');
const APP = process.env.APP_URL || 'http://localhost:8137/';
const browser = await webkit.launch({ headless: true });
after(() => browser.close());

const AUDIT = ['Catalog Year: 2025-2026', '', 'ENGL 1010 Introduction to Academic Writing A 3 Fall 2025', 'MATH 1210 Calculus I B+ 4 Fall 2025'].join('\n');

async function page() {
  const ctx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
  await ctx.route(/gstatic\.com\/firebasejs/, (r) => r.abort());
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  await p.goto(APP + '?p=electrical-engineering-bs');
  await p.waitForSelector('#main[data-tab]', { state: 'attached' });
  return p;
}
async function importAudit(p, fill) {
  await toHome(p);
  await p.click('#gear');
  await p.waitForSelector('#settings[open]');
  await p.click('#importBtn');
  await fill();
  await p.waitForSelector('#impStep2:not([hidden])', { timeout: 20000 });
  await p.click('#impGo');
  await p.waitForFunction(() => !document.querySelector('#importDlg')?.open);
  await p.waitForFunction(() => !document.querySelector('#pfAudit').hidden, null, { timeout: 5000 });
}
// what the menu's link opens: [type, bytes as text (latin1)]
const opened = (p) => p.evaluate(async () => {
  const b = await (await fetch(document.querySelector('#pfAudit').href)).blob();
  const u8 = new Uint8Array(await b.arrayBuffer());
  return [b.type, String.fromCharCode(...u8.slice(0, 2000)), u8.length];
});
async function toHome(p) {
  if (await p.getAttribute('#main', 'data-tab') !== 'home') { await p.click('#back'); await p.waitForSelector('#main[data-tab="home"]', { state: 'attached' }); }
}
async function openMenu(p) {
  await toHome(p);
  await p.click('#profile');
  await p.waitForSelector('#pfDlg[open]');
}

test('pasted audit: the account menu opens the exact text; nothing before an import; still there after a reload', async () => {
  const p = await page();
  await openMenu(p);
  assert.equal(await p.isVisible('#pfAudit'), false, 'no audit yet');
  await p.keyboard.press('Escape');
  await importAudit(p, () => p.fill('#impText', AUDIT).then(() => p.click('#impGo')));
  await openMenu(p);
  assert.ok(await p.isVisible('#pfAudit'));
  assert.equal((await p.textContent('#pfAudit')).trim(), 'View submitted audit');
  assert.equal(await p.getAttribute('#pfAudit', 'target'), '_blank');
  const [type, text] = await opened(p);
  assert.match(type, /^text\/plain/);
  assert.equal(text, AUDIT);
  await p.reload();
  await p.waitForSelector('#main[data-tab]', { state: 'attached' });
  await p.waitForFunction(() => !document.querySelector('#pfAudit').hidden);
  assert.equal((await opened(p))[1], AUDIT, 'kept on this device');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('PDF audit: the menu opens the same PDF file, byte for byte', async () => {
  const cr = await chromium.launch();
  const cp = await cr.newPage();
  await cp.setContent(`<pre style="font:12px monospace">${AUDIT}</pre>`);
  const pdf = await cp.pdf();
  await cr.close();
  const p = await page();
  await importAudit(p, () => p.setInputFiles('#impFile', { name: 'my-audit.pdf', mimeType: 'application/pdf', buffer: pdf }));
  await openMenu(p);
  const [type, head, len] = await opened(p);
  assert.equal(type, 'application/pdf');
  assert.equal(len, pdf.length);
  assert.equal(head, pdf.subarray(0, 2000).toString('latin1'));
  assert.match(await p.getAttribute('#pfAudit', 'title'), /^my-audit\.pdf · /);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

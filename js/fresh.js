// New builds reach phones without a hard refresh.
//
// GitHub Pages serves every file with `Cache-Control: max-age=600` and one shared Last-Modified (the
// deploy time), so a phone can keep running an old build from its cache for up to 10 minutes after a
// deploy. On load, and when the tab comes back into view (at most once a minute), this asks the server
// for the page's live Last-Modified. "What I'm running" is the oldest Last-Modified among the page and
// the startup code files as the browser cached them. If the live build is newer: refetch those files
// past the cache, then reload once. Any error or missing header = do nothing.
// Loaded by its own <script> tag so a crash in app.js can't stop it. Also shows the version in Settings.

// css + every module loaded at startup (static imports from js/app.js down; pdftext.js and Firebase
// load later and are not needed for the first paint). tests/fresh.test.mjs checks this list.
export const STARTUP = ['css/app.css', 'js/fresh.js', 'js/app.js', 'js/planner.js', 'js/phases.js', 'js/rules.js', 'js/gened.js', 'js/home.js', 'js/layout.js',
  'js/audit.js', 'js/sync.js', 'js/account.js', 'js/programs.js', 'js/schedule.js', 'js/uistate.js',
  'js/mysched.js', 'js/mineui.js', 'js/classes.js', 'js/hover.js', 'js/matric.js', 'js/sources.js',
  'js/groups.js', 'js/shortnames.js', 'js/curprereqs.js'];

const KEY = 'smart-advisor:fresh'; // sessionStorage: the live Last-Modified we already reloaded for
const EVERY_MS = 60_000;

// ms since epoch, or NaN for a missing/unparseable date
export const toMs = (s) => (s ? Date.parse(s) : NaN);

// Reload when the live build is newer than the oldest thing running, unless we already reloaded for
// this live value (loop guard). Anything missing or unparseable = no.
export function shouldReload({ live, running, reloadedFor = null }) {
  const l = toMs(live);
  if (!Number.isFinite(l) || !running?.length) return false;
  const r = running.map(toMs);
  if (r.some((x) => !Number.isFinite(x))) return false;
  if (reloadedFor && reloadedFor === live) return false;
  return l > Math.min(...r);
}

// "Oct 17, 2026, 6:52 PM"
export const versionText = (d) => {
  const t = d instanceof Date ? d : new Date(d);
  return Number.isNaN(t.getTime()) ? '' : 'Version ' + t.toLocaleString('en-US',
    { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const busy = () => {
  if (document.querySelector('dialog[open]')) return true;
  const a = document.activeElement;
  return !!a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
};

let last = 0, inFlight = false;
async function check() {
  if (inFlight || busy()) return;
  inFlight = true;
  last = Date.now();
  try {
    const base = new URL('../', import.meta.url);
    const head = await fetch(location.pathname, { method: 'HEAD', cache: 'no-store' });
    const live = head.ok ? head.headers.get('last-modified') : null;
    if (!live) return;
    const files = STARTUP.map((f) => new URL(f, base).href);
    const mods = await Promise.all(files.map((u) => fetch(u, { cache: 'force-cache' })
      .then((r) => (r.ok ? r.headers.get('last-modified') : null))));
    let reloadedFor = null;
    try { reloadedFor = sessionStorage.getItem(KEY); } catch {}
    if (!shouldReload({ live, running: [document.lastModified, ...mods], reloadedFor })) return;
    // refresh the HTTP cache so the reload gets the new files, then reload once
    const page = location.href.split('#')[0];
    await Promise.all([page, location.pathname, ...files].map((u) => fetch(u, { cache: 'reload' })));
    if (busy()) return;
    try { sessionStorage.setItem(KEY, live); } catch {}
    location.reload();
  } catch {
    // offline or blocked: keep running what we have
  } finally {
    inFlight = false;
  }
}

function start() {
  const v = document.getElementById('setVer');
  if (v) v.textContent = versionText(document.lastModified);
  const on = location.hostname.endsWith('.github.io') || new URLSearchParams(location.search).has('fresh');
  if (!on) return;
  check();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - last >= EVERY_MS) check();
  });
}

if (typeof document !== 'undefined') start();

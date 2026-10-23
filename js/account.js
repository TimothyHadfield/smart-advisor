// Accounts: Google sign-in + one Firestore doc per student (users/{uid}), synced live.
//
// Guest by default: the app saves to localStorage as before and works fully if Firebase never loads.
// Firebase (pinned v10, gstatic) loads after the first paint. Signing in on a device with guest data
// merges it into the account (js/sync.js); later edits are written after a short pause and other
// devices update live (onSnapshot, last write wins). Signing out clears this device's copy.
// Google sign-in uses signInWithPopup, never redirect (redirect breaks on iOS Safari + GitHub Pages).
import { mergeDocs, decide, sameDoc } from './sync.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1';
const CONFIG = {
  apiKey: 'AIzaSyAJ4aWUczMGfJgVyvD0WLdk0HmiEFPVUnY',
  authDomain: 'smart-advisor-th.firebaseapp.com',
  projectId: 'smart-advisor-th',
  storageBucket: 'smart-advisor-th.firebasestorage.app',
  messagingSenderId: '9736275579',
  appId: '1:9736275579:web:ab75635f941892172784de',
};
// local testing against the emulators (firebase.json ports): http://localhost:<port>/?emu
const EMU = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).has('emu');
// whose data the local copy is: {uid, dirty} (dirty = edits not yet on the server). Absent = a guest's.
const OWNER = 'smart-advisor:owner';
const WRITE_MS = 800;

const $ = (id) => document.getElementById(id);
let hooks;          // { local(): doc, apply(doc), clear() } from app.js
let fb = null;      // { auth, db, A: auth module, F: firestore module } once loaded
let failed = false; // Firebase couldn't load (offline, blocked)
let user = null;
let synced = false; // first server copy seen for this sign-in
let unsub = null, timer = 0, slow = 0, gen = 0;
let status = '';    // 'saving' | 'saved' | 'offline' | ''

function owner() { try { return JSON.parse(localStorage.getItem(OWNER)); } catch { return null; } }
function setOwner(o) { try { if (o) localStorage.setItem(OWNER, JSON.stringify(o)); else localStorage.removeItem(OWNER); } catch {} }

export function initAccount(h) {
  hooks = h;
  wireSheet();
  render();
  const go = () => load().catch(() => { failed = true; render(); });
  if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 1500 }); else setTimeout(go, 300);
  addEventListener('pagehide', () => { if (timer) flush(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && timer) flush(); });
  return { changed };
}

async function load() {
  const [appM, A, F] = await Promise.all([
    import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`)]);
  const app = appM.initializeApp(CONFIG);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);
  if (EMU) {
    A.connectAuthEmulator(auth, 'http://127.0.0.1:9106', { disableWarnings: true });
    F.connectFirestoreEmulator(db, '127.0.0.1', 8086);
    // the Google popup can't be scripted; tests sign in with an emulator-only Google credential
    window.__saEmuSignIn = (sub, email, name) => A.signInWithCredential(auth,
      A.GoogleAuthProvider.credential(JSON.stringify({ sub, email, name, email_verified: true })));
  }
  fb = { auth, db, A, F };
  A.onAuthStateChanged(auth, onUser);
}

const ref = (uid) => fb.F.doc(fb.db, 'users', uid);
function provider() {
  const p = new fb.A.GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  return p;
}

// ---------- session ----------
function onUser(u) {
  stopSync();
  user = u;
  if (!u) {
    // signed out somewhere else (or the session ended): don't leave their classes on this device
    if (owner()) { setOwner(null); hooks.clear(); }
    setStatus('');
    render();
    return;
  }
  render();
  listen();
}

function listen() {
  synced = false;
  const uid = user.uid;
  unsub = fb.F.onSnapshot(ref(uid), { includeMetadataChanges: true }, (snap) => {
    if (user?.uid !== uid) return;
    if (!synced) {
      if (snap.metadata.fromCache) { setStatus('offline'); return; } // wait for the server's copy
      synced = true;
      first(snap.exists() ? snap.data() : null);
      return;
    }
    if (snap.metadata.hasPendingWrites || snap.metadata.fromCache) return; // our own write, or offline
    if (timer || owner()?.dirty) return; // this device has newer edits on the way
    const remote = snap.exists() ? snap.data() : null;
    if (remote && !sameDoc(remote, hooks.local())) hooks.apply(remote); // another device changed it
    setStatus('saved');
  }, () => setStatus('offline'));
}

// the first server copy after signing in on this device
function first(remote) {
  const uid = user.uid;
  const mode = decide(owner(), uid);
  if (mode === 'merge') {
    const merged = mergeDocs(hooks.local(), remote);
    hooks.apply(merged);
    setOwner({ uid, dirty: true });
    if (!remote || !sameDoc(merged, remote)) flush(); else { setOwner({ uid, dirty: false }); setStatus('saved'); }
  } else if (mode === 'pull' && remote) {
    if (!sameDoc(remote, hooks.local())) hooks.apply(remote);
    setStatus('saved');
  } else {
    setOwner({ uid, dirty: true });
    flush();
  }
}

function stopSync() {
  if (unsub) unsub();
  unsub = null;
  synced = false;
  clearTimeout(timer); timer = 0;
}

// app.js calls this after every local save
function changed() {
  const o = owner();
  if (!user) {
    // a signed-in student editing before Firebase has loaded: keep the edit for the next sync
    if (!fb && o) setOwner({ ...o, dirty: true });
    return;
  }
  if (!o || o.uid !== user.uid) return; // the first-sign-in merge hasn't run yet; it will include this
  setOwner({ uid: user.uid, dirty: true });
  if (!synced) return;
  clearTimeout(timer);
  timer = setTimeout(flush, WRITE_MS);
  setStatus('saving');
}

async function flush() {
  clearTimeout(timer); timer = 0;
  if (!user || !synced) return;
  const uid = user.uid, mine = ++gen;
  setStatus('saving');
  clearTimeout(slow);
  slow = setTimeout(() => { if (mine === gen && status === 'saving') setStatus('offline'); }, 5000);
  try {
    await fb.F.setDoc(ref(uid), { ...hooks.local(), updatedAt: fb.F.serverTimestamp() });
    if (mine === gen && user?.uid === uid) { setOwner({ uid, dirty: false }); setStatus('saved'); }
  } catch {
    if (mine === gen) setStatus('offline');
  }
}

// ---------- actions ----------
function signIn() {
  if (!fb) return;
  msg('');
  // straight from the tap (no await first), or iOS Safari blocks the popup
  fb.A.signInWithPopup(fb.auth, provider()).catch((e) => {
    if (e?.code === 'auth/popup-blocked') msg('Allow pop-ups to sign in');
    else if (!/popup-closed|cancelled-popup/.test(e?.code || '')) msg('Sign-in failed. Try again.');
  });
}

async function signOut() {
  if (!fb || !user) return;
  if (timer || owner()?.dirty) await Promise.race([flush(), new Promise((r) => setTimeout(r, 4000))]);
  stopSync();
  setOwner(null);
  hooks.clear();
  await fb.A.signOut(fb.auth).catch(() => {});
}

// second tap of "Delete account": deletes the doc, then the sign-in. Google wants a recent sign-in to
// delete an account, so an older session re-confirms in a popup first (opened straight from the tap).
function deleteAccount() {
  const u = user;
  if (!fb || !u) return;
  const recent = Date.now() - Date.parse(u.metadata.lastSignInTime || 0) < 4 * 60e3;
  const ready = recent ? Promise.resolve() : fb.A.reauthenticateWithPopup(u, provider());
  msg('');
  ready.then(async () => {
    const backup = hooks.local();
    stopSync();
    await fb.F.deleteDoc(ref(u.uid));
    try {
      await fb.A.deleteUser(u);
    } catch (e) {
      // not deleted: put their data back
      await fb.F.setDoc(ref(u.uid), { ...backup, updatedAt: fb.F.serverTimestamp() }).catch(() => {});
      if (user?.uid === u.uid) listen();
      throw e;
    }
    setOwner(null);
    hooks.clear();
  }).catch((e) => {
    msg(e?.code === 'auth/user-mismatch' ? 'Pick the same Google account' : /popup-closed|cancelled-popup/.test(e?.code || '') ? '' : 'Not deleted. Try again.');
    armDelete(false);
  });
}

// ---------- the sheet ----------
function msg(t) { $('acctMsg').textContent = t; }
function setStatus(s) {
  status = s;
  render();
}
function armDelete(on) {
  const b = $('acctDelete');
  b.dataset.armed = on ? '1' : '';
  b.textContent = on ? 'Delete forever' : 'Delete account';
}

function render() {
  const signedIn = !!user;
  const p = $('profile');
  p.classList.toggle('in', signedIn);
  p.classList.toggle('warn', signedIn && status === 'offline');
  hooks.user?.(signedIn ? { name: user.displayName || '', email: user.email || '' } : null); // Home's greeting
  $('acctOut').hidden = signedIn;
  $('acctIn').hidden = !signedIn;
  $('acctSignOut').hidden = !signedIn;
  $('acctGoogle').disabled = !fb;
  $('acctGoogle').textContent = fb || !failed ? 'Continue with Google' : 'Sign-in unavailable offline';
  if (signedIn) {
    $('acctName').textContent = user.displayName || '';
    $('acctEmail').textContent = user.email || '';
    const s = !synced && status !== 'offline' ? 'saving' : status || 'saved';
    $('acctSync').dataset.s = s;
    $('acctSyncText').textContent = { saving: 'Saving…', saved: 'Saved', offline: 'Offline, will save' }[s];
  }
}

// the account part of the Profile screen (Home's Profile row opens it): fresh each time it opens
function wireSheet() {
  $('profile').addEventListener('click', () => {
    msg(''); armDelete(false); $('acctMore').setAttribute('aria-expanded', 'false'); $('acctSettings').hidden = true; $('acctTipText').hidden = true;
    render();
  });
  $('acctGoogle').addEventListener('click', signIn);
  $('acctSignOut').addEventListener('click', signOut);
  $('acctMore').addEventListener('click', () => {
    const open = $('acctSettings').hidden;
    $('acctSettings').hidden = !open;
    $('acctMore').setAttribute('aria-expanded', String(open));
    armDelete(false);
  });
  $('acctDelete').addEventListener('click', () => { if ($('acctDelete').dataset.armed) deleteAccount(); else armDelete(true); });
  $('acctTip').addEventListener('click', () => { $('acctTipText').hidden = !$('acctTipText').hidden; });
}

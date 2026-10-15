// Account sync, the pure parts (no Firebase here, so Node tests can run them).
//
// Local state (js/app.js, localStorage 'smart-advisor:v1'):
//   { settings: {max, summers, start, grades}, done: {[program]: [keys]}, grades: {[program]: {key: grade}},
//     audit: {[program]: {catalogYear}} }
// One Firestore doc per student, users/{uid}:
//   { taken: [keys], grades: {key: grade}, settings: {...}, program, catalogYear, updatedAt }
// Taken classes are the student's, so the doc holds the program on screen; there is one major for now.

const SETTINGS = ['max', 'summers', 'start', 'grades'];
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
const strMap = (v) => (isObj(v) ? Object.fromEntries(Object.entries(v).filter(([, g]) => typeof g === 'string')) : {});
function cleanSettings(s) {
  const out = {};
  if (isObj(s)) for (const k of SETTINGS) if (s[k] !== undefined) out[k] = s[k];
  return out;
}

/** The doc for one program, from local state (no updatedAt; the caller adds a server time). */
export function toDoc(state, program) {
  return {
    taken: [...(state.done?.[program] || [])],
    grades: { ...(state.grades?.[program] || {}) },
    settings: { max: 16, summers: false, start: null, grades: true, ...cleanSettings(state.settings) },
    program,
    catalogYear: state.audit?.[program]?.catalogYear ?? null,
  };
}

/** Put an account doc into local state (in place). Missing settings / catalog year keep what's here. */
export function applyDoc(state, doc, program) {
  state.done ??= {};
  state.grades ??= {};
  state.done[program] = strList(doc?.taken);
  state.grades[program] = strMap(doc?.grades);
  state.settings = { max: 16, summers: false, start: null, grades: true, ...cleanSettings(state.settings), ...cleanSettings(doc?.settings) };
  if (doc?.catalogYear) { state.audit ??= {}; state.audit[program] = { ...(state.audit[program] || {}), catalogYear: doc.catalogYear }; }
  return state;
}

/**
 * First sign-in on a device that has guest data: keep both.
 * taken = union · grades = whichever has one (both: the account's) · settings = the account's if it
 * has any, else this device's · catalog year / program = the account's, else this device's.
 */
export function mergeDocs(local, remote) {
  const { updatedAt, ...l } = local || {};
  if (!remote) return { ...l };
  const taken = [...strList(l.taken)];
  for (const k of strList(remote.taken)) if (!taken.includes(k)) taken.push(k);
  const lg = strMap(l.grades), rg = strMap(remote.grades);
  const grades = {};
  for (const k of new Set([...Object.keys(lg), ...Object.keys(rg)])) grades[k] = rg[k] || lg[k] || '';
  const rs = cleanSettings(remote.settings);
  return {
    taken,
    grades,
    settings: Object.keys(rs).length ? { ...(l.settings || {}), ...rs } : { ...(l.settings || {}) },
    program: remote.program || l.program,
    catalogYear: remote.catalogYear || l.catalogYear || null,
  };
}

/**
 * A signed-in session starts on this device. owner = {uid, dirty} saved with the local copy (or null).
 *   'merge' : the local data is a guest's (or someone else's) -> merge it into the account
 *   'pull'  : the local data is this account's cached copy -> the account wins
 *   'push'  : this account's copy has edits that never reached the server -> send them
 */
export function decide(owner, uid) {
  if (!owner || owner.uid !== uid) return 'merge';
  return owner.dirty ? 'push' : 'pull';
}

/** Same content (ignores updatedAt and key order). */
export function sameDoc(a, b) {
  const canon = (v) => (Array.isArray(v) ? v.map(canon) : isObj(v)
    ? Object.fromEntries(Object.keys(v).filter((k) => k !== 'updatedAt').sort().map((k) => [k, canon(v[k])])) : v ?? null);
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

// Firestore rules, against the emulator (needs Java 21):
//   firebase emulators:exec --only firestore --project smart-advisor-th "node tests/rules.emulator.mjs"
// Talks REST with unsigned test tokens (the emulator doesn't check signatures). Named .emulator.mjs so `node --test tests/*.test.mjs` skips it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8086';
const BASE = `http://${HOST}/v1/projects/smart-advisor-th/databases/(default)/documents`;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (uid) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: uid, user_id: uid, aud: 'smart-advisor-th', iss: 'https://securetoken.google.com/smart-advisor-th', iat: 1, exp: 9999999999, firebase: { sign_in_provider: 'google.com' } })}.`;

// Firestore REST value encoding
const enc = (v) => v === null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { integerValue: String(v) }
  : typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } }
  : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
const fields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)]));

async function call(method, uid, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (uid) headers.authorization = `Bearer ${uid === 'owner' ? 'owner' : token(uid)}`;
  const r = await fetch(`${BASE}/${path}`, { method, headers, body: body && JSON.stringify(body) });
  return r.status;
}
const put = (uid, path, doc) => call('PATCH', uid, path, { fields: fields(doc) });

const AUDIT = ['ENGL 1010', 'MATH 1210', 'MATH 1220', 'PHYS 2210', 'ECE 2250', 'ECE 2255', 'ph:6', 'choice:3'];
const GOOD = { taken: AUDIT, grades: { 'MATH 1210': 'A-', 'ECE 2250': 'IP', 'ENGL 1010': '' },
  settings: { max: 16, summers: false, start: null, grades: true }, program: 'ee-bs', catalogYear: '2025-2026' };

test('a student writes, reads and deletes their own doc', async () => {
  assert.equal(await put('alice', 'users/alice', GOOD), 200);
  assert.equal(await call('GET', 'alice', 'users/alice'), 200);
  assert.equal(await call('DELETE', 'alice', 'users/alice'), 200);
});

test('nobody reads or writes someone else\'s doc, signed out included', async () => {
  assert.equal(await put('alice', 'users/alice', GOOD), 200);
  assert.equal(await call('GET', 'bob', 'users/alice'), 403);
  assert.equal(await put('bob', 'users/alice', GOOD), 403);
  assert.equal(await call('DELETE', 'bob', 'users/alice'), 403);
  assert.equal(await call('GET', null, 'users/alice'), 403);
  assert.equal(await put(null, 'users/alice', GOOD), 403);
});

test('only the known fields, and lists stay small', async () => {
  assert.equal(await put('alice', 'users/alice', { ...GOOD, name: 'Jane' }), 403);
  assert.equal(await put('alice', 'users/alice', { ...GOOD, taken: Array.from({ length: 501 }, (_, i) => `X ${i}`) }), 403);
  assert.equal(await put('alice', 'users/alice', { ...GOOD, taken: 'MATH 1210' }), 403);
  assert.equal(await put('alice', 'users/alice', { ...GOOD, taken: Array.from({ length: 120 }, (_, i) => `X ${i}`) }), 200);
});

test('a major + minor list (programs) is allowed, small', async () => {
  const two = ['electrical-engineering-bs', 'environmental-science-management-minor'];
  assert.equal(await put('alice', 'users/alice', { ...GOOD, program: two[0], programs: two }), 200);
  assert.equal(await put('alice', 'users/alice', { ...GOOD, programs: Array.from({ length: 7 }, (_, i) => `p${i}`) }), 403);
  assert.equal(await put('alice', 'users/alice', { ...GOOD, programs: 'electrical-engineering-bs' }), 403);
});

test('nothing outside users/ is readable or writable', async () => {
  assert.equal(await put('alice', 'other/x', { a: 1 }), 403);
  assert.equal(await call('GET', 'alice', 'other/x'), 403);
});

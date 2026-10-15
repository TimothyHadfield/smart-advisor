// Run: node tests/rmp-match.test.mjs
// Banner instructor names → Rate My Professors teachers. Fixture = 33 real UVU teacher records from the RMP
// GraphQL dump of 2026-10-15 (only the aggregate fields the script reads; no reviews). Banner names are real
// "Last, First M." strings from data/sections (Fall 2026 / Spring 2027) unless marked made-up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBannerName, firstNameTier, buildIndex, matchInstructor, matchAll, mergeProfiles, deptFits } from '../scripts/lib/names.mjs';

const RMP = [
  { avgDifficulty: 3.8, avgRating: 4.2, department: 'Biology', firstName: 'Olga', lastName: 'Kopp', legacyId: 270554, numRatings: 151, wouldTakeAgainPercent: 77.2152 },
  { avgDifficulty: 3.7, avgRating: 3.3, department: 'Mathematics', firstName: 'Dallas', lastName: 'Smith', legacyId: 2868471, numRatings: 27, wouldTakeAgainPercent: 57.1429 },
  { avgDifficulty: 3.1, avgRating: 3.6, department: 'Biology', firstName: 'Thomas', lastName: 'Ogden', legacyId: 1340264, numRatings: 89, wouldTakeAgainPercent: 50 },
  { avgDifficulty: 4.2, avgRating: 3.6, department: 'Engineering', firstName: 'Waseem', lastName: 'Sheikh', legacyId: 2615348, numRatings: 40, wouldTakeAgainPercent: 65.8537 },
  { avgDifficulty: 3.1, avgRating: 4.2, department: 'Chemistry', firstName: 'Craig', lastName: 'Moore', legacyId: 2476970, numRatings: 55, wouldTakeAgainPercent: 80.3571 },
  { avgDifficulty: 2.9, avgRating: 3.8, department: 'Biology', firstName: 'Heath', lastName: 'Ogden', legacyId: 2755883, numRatings: 12, wouldTakeAgainPercent: 69.2308 },
  { avgDifficulty: 2.4, avgRating: 4, department: 'Computer Information Systems', firstName: 'Jan', lastName: 'Bentley', legacyId: 306525, numRatings: 48, wouldTakeAgainPercent: 89.4737 },
  { avgDifficulty: 3.2, avgRating: 4, department: 'Biology', firstName: 'T. Heath', lastName: 'Ogden', legacyId: 1972770, numRatings: 64, wouldTakeAgainPercent: 82.4561 },
  { avgDifficulty: 1.7, avgRating: 4.8, department: 'Computer Information Systems', firstName: 'Doreen-Dede', lastName: 'Smith', legacyId: 699347, numRatings: 84, wouldTakeAgainPercent: 94.8718 },
  { avgDifficulty: 2, avgRating: 5, department: 'Business', firstName: 'Dede', lastName: 'Smith', legacyId: 3114187, numRatings: 1, wouldTakeAgainPercent: 100 },
  { avgDifficulty: 3, avgRating: 3.2, department: 'Theater', firstName: 'Kimberly', lastName: 'Abunuwara', legacyId: 1048899, numRatings: 45, wouldTakeAgainPercent: 42.8571 },
  { avgDifficulty: 2.5, avgRating: 4.6, department: 'Psychology', firstName: 'Julie', lastName: 'Nelson', legacyId: 569604, numRatings: 46, wouldTakeAgainPercent: 89.6552 },
  { avgDifficulty: 3.5, avgRating: 3.9, department: 'Mathematics', firstName: 'Erik', lastName: 'Heiny', legacyId: 2207756, numRatings: 24, wouldTakeAgainPercent: 58.3333 },
  { avgDifficulty: 3, avgRating: 1, department: 'Biology', firstName: 'Ogla', lastName: 'Kopp', legacyId: 2829831, numRatings: 1, wouldTakeAgainPercent: 0 },
  { avgDifficulty: 3.1, avgRating: 3.3, department: 'Psychology', firstName: 'Kristopher', lastName: 'Kopp', legacyId: 2437513, numRatings: 34, wouldTakeAgainPercent: 55.8824 },
  { avgDifficulty: 3.4, avgRating: 3.9, department: 'Mathematics', firstName: 'Eric', lastName: 'Heiny', legacyId: 1193865, numRatings: 46, wouldTakeAgainPercent: 66.6667 },
  { avgDifficulty: 3, avgRating: 4.6, department: 'Music', firstName: 'Craig', lastName: 'Moore', legacyId: 2020610, numRatings: 4, wouldTakeAgainPercent: 100 },
  { avgDifficulty: 4.5, avgRating: 4.5, department: 'Biology', firstName: 'Olga', lastName: 'Ruiz Kopp', legacyId: 2769900, numRatings: 2, wouldTakeAgainPercent: 50 },
  { avgDifficulty: 3.6, avgRating: 3.4, department: 'Fire Science', firstName: 'Andrew', lastName: 'Byrnes', legacyId: 1157080, numRatings: 11, wouldTakeAgainPercent: 75 },
  { avgDifficulty: 4, avgRating: 2, department: 'Engineering', firstName: 'Mohammad', lastName: 'Masoum', legacyId: 2483856, numRatings: 1, wouldTakeAgainPercent: 0 },
  { avgDifficulty: 4.1, avgRating: 2.3, department: 'Anthropology', firstName: 'Daymon', lastName: 'Smith', legacyId: 603304, numRatings: 38, wouldTakeAgainPercent: 41.1765 },
  { avgDifficulty: 2.3, avgRating: 4, department: 'Music', firstName: 'Douglas', lastName: 'Smith', legacyId: 1828161, numRatings: 25, wouldTakeAgainPercent: 81.8182 },
  { avgDifficulty: 2.4, avgRating: 5, department: 'Psychology', firstName: 'Lacy', lastName: 'Bentley', legacyId: 2372293, numRatings: 7, wouldTakeAgainPercent: 100 },
  { avgDifficulty: 2.7, avgRating: 4.7, department: 'Theater', firstName: 'Barrett', lastName: 'Ogden', legacyId: 1571082, numRatings: 7, wouldTakeAgainPercent: 100 },
  { avgDifficulty: 2, avgRating: 4.5, department: 'Community Health Sciences', firstName: 'Steve', lastName: 'Morley', legacyId: 1990498, numRatings: 76, wouldTakeAgainPercent: 95.4545 },
  { avgDifficulty: 2.3, avgRating: 5, department: 'Audio Production', firstName: 'Aaron', lastName: 'Kopp', legacyId: 1441561, numRatings: 4, wouldTakeAgainPercent: 100 },
  { avgDifficulty: 1.4, avgRating: 5, department: 'Computer Science', firstName: 'James', lastName: 'Bentley', legacyId: 1664707, numRatings: 8, wouldTakeAgainPercent: -1 },
  { avgDifficulty: 2.1, avgRating: 5, department: 'Mathematics', firstName: 'Deshawn', lastName: 'Smith', legacyId: 1123055, numRatings: 7, wouldTakeAgainPercent: -1 },
  { avgDifficulty: 3.3, avgRating: 3.1, department: 'Music', firstName: 'Matthew', lastName: 'Nelson', legacyId: 1384053, numRatings: 14, wouldTakeAgainPercent: -1 },
  { avgDifficulty: 1.6, avgRating: 4.4, department: 'Business', firstName: 'David', lastName: 'Smith', legacyId: 1511832, numRatings: 11, wouldTakeAgainPercent: -1 },
  { avgDifficulty: 3.5, avgRating: 3.3, department: 'Sociology', firstName: 'Darron', lastName: 'Smith', legacyId: 878564, numRatings: 6, wouldTakeAgainPercent: -1 },
  { avgDifficulty: 0, avgRating: 0, department: 'Information Science', firstName: 'Doreen', lastName: 'Smith', legacyId: 3019157, numRatings: 0, wouldTakeAgainPercent: -1 },
  { avgDifficulty: 0, avgRating: 0, department: 'Mathematics', firstName: 'Diane', lastName: 'Smith', legacyId: 3114768, numRatings: 0, wouldTakeAgainPercent: -1 },
];
// Real subject names from Banner (data/sections/index.json).
const SUBJ = {
  ECE: 'Electrical Comp Engineering', BIOL: 'Biology', BOT: 'Botany', ART: 'Art and Design', HUM: 'Humanities',
  IS: 'Integrated Studies', PAS: 'Physician Assistant Studies', ES: 'Emergency Services', ESFF: 'Emergency Services FireFighter',
  CHEM: 'Chemistry', MATH: 'Mathematics', INFO: 'Information Systems',
};
const idx = buildIndex(RMP);
const hints = Object.fromEntries(Object.entries(SUBJ).map(([k, v]) => [k, { name: v, depts: new Set() }]));
const m = (name, subs) => matchInstructor(name, subs, idx, hints);

test('parseBannerName keeps full first names, drops middle initials', () => {
  assert.deepEqual(parseBannerName('Sherkat Masoum, Mohammad A.'), { last: 'Sherkat Masoum', firsts: ['mohammad'], initial: 'm' });
  assert.deepEqual(parseBannerName('Crisp, KC A.').firsts, ['kc']);
  assert.deepEqual(parseBannerName('Egbert, J Amber A.').firsts, ['amber']);
  assert.equal(parseBannerName('Staff'), null);
  assert.equal(parseBannerName(null), null);
});

test('firstNameTier: exact 3, nickname/prefix/typo 2, initial 1', () => {
  const b = (n) => parseBannerName(n);
  assert.equal(firstNameTier(b('Ogden, Heath H.'), 'T. Heath'), 3);
  assert.equal(firstNameTier(b('Smith, Dede'), 'Doreen-Dede'), 3);
  assert.equal(firstNameTier(b('Abunuwara, Kim'), 'Kimberly'), 2);
  assert.equal(firstNameTier(b('Byrnes, Andy J.'), 'Andrew'), 2);
  assert.equal(firstNameTier(b('Kopp, Olga R.'), 'Ogla'), 2);
  assert.equal(firstNameTier(b('Heiny, Eric'), 'Erik'), 2);
  assert.equal(firstNameTier(b('Morley, Stephanie A.'), 'Steve'), 0, 'Stephanie is not Steve');
  assert.equal(firstNameTier(b('Davis, Anna'), 'Amy'), 0, 'two full first names sharing only an initial');
  assert.equal(firstNameTier(b('Christensen, Christine'), 'Christopher'), 1.5, 'weak: needs a fitting department');
  assert.equal(firstNameTier(b('Jansen, Dusty O.'), 'Dustin'), 1.5);
  assert.equal(firstNameTier(b('Lee, KC'), 'Konchol'), 1);
  assert.equal(firstNameTier(b('Peterson, Nancy L.'), 'N'), 1);
  assert.equal(firstNameTier(b('Nelson, Matt'), 'Julie'), 0);
});

test('exact full name, one profile → hit with the right numbers', () => {
  const r = m('Sheikh, Waseem A.', ['ECE']);
  assert.equal(r.status, 'hit');
  assert.deepEqual(r.prof, { r: 3.6, d: 4.2, n: 40, wta: 66, id: 2615348 });
});

test('multi-word Banner last name falls back to its last word', () => {
  const r = m('Sherkat Masoum, Mohammad A.', ['ECE']);
  assert.equal(r.status, 'hit');
  assert.equal(r.prof.id, 2483856);
});

test('duplicate profiles of one person merge (Heath / T. Heath Ogden)', () => {
  const r = m('Ogden, Heath H.', ['BIOL']);
  assert.equal(r.status, 'hit');
  assert.equal(r.prof.n, 76);
  assert.equal(r.prof.id, 1972770, 'id of the profile with most ratings');
  assert.equal(r.prof.r, 4.0); // (3.8*12 + 4*64) / 76 = 3.97
});

test('duplicate across a multi-word RMP last name (Olga Kopp / Olga Ruiz Kopp), typo profile ignored', () => {
  const r = m('Kopp, Olga R.', ['BIOL', 'BOT']);
  assert.equal(r.status, 'hit');
  assert.equal(r.prof.n, 153);
  assert.equal(r.prof.id, 270554);
});

test('same full name in two departments → pick the one that fits the subject', () => {
  const r = m('Moore, Craig', ['CHEM']); // made-up Banner name, real RMP records
  assert.equal(r.status, 'hit');
  assert.equal(r.prof.id, 2476970);
});

test('nickname with a department that does not fit → no rating shown (conservative)', () => {
  // Probably the same person, but "Mariel"/"Marie Balzotti [Biology]" in Social Work shows why this stays off.
  assert.equal(m('Abunuwara, Kim', ['HUM', 'IS']).status, 'ambiguous');
});

test('same full name but common surname and unrelated department → not matched', () => {
  // 8 rated Smiths in the fixture → common.
  assert.equal(m('Smith, Douglas', ['ECE']).status, 'ambiguous', 'Douglas Smith is in Music');
  assert.equal(m('Smith, Douglas', ['ART']).status, 'ambiguous');
  const r = m('Masoum, Mohammad', ['ART']); // rare surname → exact full name trusted even in another dept
  assert.equal(r.status, 'hit');
  assert.equal(r.how, 'name (dept differs)');
});

test('nickname + department that fits (FireFighter ~ Fire Science) → hit', () => {
  const r = m('Byrnes, Andy J.', ['ES', 'ESFF']);
  assert.equal(r.status, 'hit');
  assert.equal(r.prof.id, 1157080);
});

test('wrong people are not matched', () => {
  assert.notEqual(m('Morley, Stephanie A.', ['ART']).status, 'hit');
  assert.notEqual(m('Nelson, Matt', ['PAS']).status, 'hit', 'common surname, Matthew Nelson is in Music');
  assert.notEqual(m('Smith, Dylan', ['MATH']).status, 'hit', 'D. Smith in Math is ambiguous by initial');
  assert.equal(m('Smith, Diane', ['MATH']).status, 'unrated');
  assert.equal(m('Zzyzx, Pat', ['MATH']).status, 'none');
  assert.equal(m('Staff', ['MATH']).status, 'skip');
});

test('mergeProfiles: wta null when no profile has one; rounded numbers', () => {
  assert.deepEqual(mergeProfiles([RMP.find((t) => t.legacyId === 1664707)]), { r: 5, d: 1.4, n: 8, wta: null, id: 1664707 });
});

test('deptFits uses Banner subject names and learned departments', () => {
  assert.equal(deptFits('Engineering', ['ECE'], hints), true);
  assert.equal(deptFits('Theater', ['ECE'], hints), false);
  assert.equal(deptFits('Theater', ['XYZ'], hints), null);
  assert.equal(deptFits('Fire Science', ['ESFF'], hints), true);
});

test('matchAll counts and keys by the exact Banner string', () => {
  const ins = new Map([['Sheikh, Waseem A.', new Set(['ECE'])], ['Morley, Stephanie A.', new Set(['ART'])], ['Staff', new Set(['ECE'])]]);
  const { profs, stats } = matchAll(ins, RMP, SUBJ);
  assert.deepEqual(Object.keys(profs), ['Sheikh, Waseem A.']);
  assert.equal(stats.hit, 1);
  assert.equal(stats.skip, 1);
});

const RMP_FILE = fileURLToPath(new URL('../data/rmp.json', import.meta.url));
test('committed data/rmp.json has the documented shape', { skip: !existsSync(RMP_FILE) }, () => {
  const j = JSON.parse(readFileSync(RMP_FILE, 'utf8'));
  assert.ok(j.fetched);
  const e = Object.entries(j.profs);
  assert.ok(e.length > 500);
  for (const [k, v] of e) {
    assert.match(k, /^[^,]+, .+/);
    assert.deepEqual(Object.keys(v).sort(), ['d', 'id', 'n', 'r', 'wta']);
    assert.ok(v.r >= 1 && v.r <= 5 && v.n >= 1 && Number.isInteger(v.id));
    assert.ok(v.wta === null || (v.wta >= 0 && v.wta <= 100));
  }
});

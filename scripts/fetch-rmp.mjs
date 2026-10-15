#!/usr/bin/env node
// Rate My Professors overall ratings for the instructors in data/sections/*.json → data/rmp.json.
// Usage: node scripts/fetch-rmp.mjs [--teachers <dump.json>] [--save-dump <file>] [--report <file>]
//   --teachers   use a saved RMP teacher dump instead of the network (testing)
//   --save-dump  keep the raw teacher dump (scratch only; never commit it)
//   --report     write every match decision (name, status, candidates) for manual review
// Source: RMP GraphQL (https://www.ratemyprofessors.com/graphql, the site's own public Basic test:test header),
// UVU school IDs U2Nob29sLTE4NDU4 (legacy 18458) + U2Nob29sLTE3NzUx (Aviation, legacy 17751).
// ~5 requests per run, 1 s apart. Stores only the overall numbers + profile id; never reviews.
//
// Output: { fetched, profs: { "<instr exactly as in sections>": { r, d, n, wta, id } } }
//   r   average rating (1–5, one decimal)      d   average difficulty (1–5)
//   n   number of ratings                      wta would-take-again %, rounded; null when RMP has none
//   id  RMP legacy id → https://www.ratemyprofessors.com/professor/<id>
// Only matched, rated instructors are listed; missing key = no confident match.

import { writeFile, readFile, readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchAll } from './lib/names.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHOOLS = ['U2Nob29sLTE4NDU4', 'U2Nob29sLTE3NzUx'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const Q = `query T($schoolID:ID!,$first:Int,$after:String){newSearch{teachers(query:{text:"",schoolID:$schoolID,fallback:false},first:$first,after:$after){
  resultCount pageInfo{hasNextPage endCursor}
  edges{node{legacyId firstName lastName department avgRating avgDifficulty numRatings wouldTakeAgainPercent}}}}}`;

async function gql(query, variables) {
  const r = await fetch('https://www.ratemyprofessors.com/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Basic dGVzdDp0ZXN0', 'User-Agent': 'Mozilla/5.0 (SmartAdvisor student project)' },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) throw new Error(`RMP HTTP ${r.status}`);
  const j = await r.json();
  if (j.errors) throw new Error('RMP: ' + JSON.stringify(j.errors).slice(0, 300));
  return j.data;
}

async function dumpTeachers() {
  const all = [];
  for (const schoolID of SCHOOLS) {
    let after = null, pages = 0;
    do {
      const t = (await gql(Q, { schoolID, first: 1000, after })).newSearch.teachers;
      all.push(...t.edges.map((e) => e.node));
      after = t.pageInfo.hasNextPage ? t.pageInfo.endCursor : null;
      console.log(`  ${schoolID} page ${++pages}: ${all.length} so far (school total ${t.resultCount})`);
      await sleep(1000);
    } while (after && pages < 20);
  }
  const seen = new Set();
  return all.filter((t) => !seen.has(t.legacyId) && seen.add(t.legacyId));
}

async function sectionInstructors() {
  const dir = join(ROOT, 'data', 'sections');
  const instructors = new Map();
  let subjectNames = {};
  try { subjectNames = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')).subjects || {}; } catch { /* optional */ }
  for (const f of (await readdir(dir)).filter((f) => /^\d{6}\.json$/.test(f))) {
    const j = JSON.parse(await readFile(join(dir, f), 'utf8'));
    Object.assign(subjectNames, j.subjects || {});
    for (const s of j.sections) for (const name of [s.instr, ...(s.instr2 || [])]) {
      if (!name) continue;
      if (!instructors.has(name)) instructors.set(name, new Set());
      instructors.get(name).add(s.subj);
    }
  }
  return { instructors, subjectNames };
}

async function main() {
  const a = process.argv.slice(2);
  const opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const { instructors, subjectNames } = await sectionInstructors();
  if (!instructors.size) throw new Error('no instructors found; run scripts/fetch-sections.mjs first');
  const teachers = opt('--teachers') ? JSON.parse(await readFile(opt('--teachers'), 'utf8')) : await dumpTeachers();
  if (opt('--save-dump')) await writeFile(opt('--save-dump'), JSON.stringify(teachers));
  console.log(`RMP teachers: ${teachers.length} (${teachers.filter((t) => t.numRatings > 0).length} rated); instructors in sections: ${instructors.size}`);
  const { profs, stats, detail } = matchAll(instructors, teachers, subjectNames);
  const sorted = Object.fromEntries(Object.entries(profs).sort(([x], [y]) => x.localeCompare(y)));
  const body = '{"fetched":' + JSON.stringify(new Date().toISOString()) + ',"profs":{\n' +
    Object.entries(sorted).map(([k, v]) => JSON.stringify(k) + ':' + JSON.stringify(v)).join(',\n') + '\n}}\n';
  await writeFile(join(ROOT, 'data', 'rmp.json'), body);
  const real = instructors.size - stats.skip;
  console.log('match:', JSON.stringify(stats), `hit rate ${(100 * stats.hit / real).toFixed(1)}% of ${real} named instructors;`,
    `${(100 * stats.hit / (stats.hit + stats.ambiguous + stats.unrated)).toFixed(1)}% of those with any RMP profile`);
  console.log(`wrote data/rmp.json (${Object.keys(profs).length} profs, ${(Buffer.byteLength(body) / 1024).toFixed(0)} KB)`);
  if (opt('--report')) {
    const line = (d) => [d.status, d.how || '', d.name, d.subjects.join('/'),
      (d.cands || []).map((t) => `${t.firstName} ${t.lastName} [${t.department}] n=${t.numRatings}`).join('; ')].join('\t');
    await writeFile(opt('--report'), detail.map(line).join('\n') + '\n');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

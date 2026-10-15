#!/usr/bin/env node
// Fetch UVU class sections (all subjects) for upcoming terms into data/sections/<term>.json.
// Usage: node scripts/fetch-sections.mjs [term ...] [--delay <ms>] [--raw <dir>]
//   no terms → every regular term from Banner's getTerms that is not past (e.g. 202640, 202720, 202730).
//   --raw <dir> also saves the untrimmed Banner pages (debugging/fixtures; never commit them).
//   --from-raw <dir> rebuilds the files from pages saved by --raw (no network for the sections).
// Source: public Banner 9 class search, https://userve.uvu.edu/StudentRegistrationSsb/ssb/ (no login).
// Polite: one request at a time, ~1 s between pages, 500 rows per page.
//
// Output data/sections/<term>.json:
//   { term: "202720", termName: "2027 Spring", fetched: ISO timestamp, count,
//     subjects: { ECE: "Electrical Comp Engineering", ... }, sections: [row, ...] }
// Row keys (missing/empty values are null; optional keys are left out when not needed):
//   crn    CRN, string              subj  subject, "ECE"            num   course number, "2250" / "4810R"
//   sec    section, "001" / "J05"   title course title              cr    credits (low end)
//   crMax  optional: high end of variable credits
//   days   meeting days of the first meeting, letters M T W R(Thu) F S U(Sun); "" = no set days (online/TBA)
//   start / end  "0830" / "0945" 24-hour, null when no set time
//   bldg / room  "SE" / "320"; "TBA", "LIVE"/"STREAM", "ONLINE" appear as Banner gives them
//   meetings optional: only when a section has 2+ meetings → [{ days, start, end, bldg, room, type?, sd, ed }]
//            (row-level days/start/end/bldg/room/sd/ed = meetings[0])
//   campus "Main Campus" etc.       mode  "in person" | "online" | "hybrid" | "livestream"
//   kind   Banner instructional method, e.g. "Regular Class without Lab", "Laboratory"
//   instr  primary instructor exactly as Banner shows it, "Last, First M." (key into data/rmp.json profs); null = Staff/TBA
//   instr2 optional: other instructors, same format
//   seats / cap / wait   seats available, max enrollment, wait-list count (snapshot at fetch time)
//   sd / ed  first meeting's start/end date, "2027-01-11"
//   pt     optional: part of term when not the full term ("1"), e.g. "HSS", "INT", "2"
//   link   optional: Banner link identifier (lecture/lab pairing)
// Instructor emails and Banner IDs are deliberately never stored.
// Also writes data/sections/index.json: { terms: [{ term, termName, count, fetched }], subjects: {SUBJ: name} }
// for every term file present.

import { writeFile, readFile, readdir, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BannerSession, compactSection, upcomingTerms } from './lib/banner.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'sections');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

function args(argv) {
  const o = { terms: [], delay: 1000, raw: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--delay') o.delay = +argv[++i];
    else if (argv[i] === '--raw') o.raw = argv[++i];
    else if (argv[i] === '--from-raw') o.fromRaw = argv[++i];
    else o.terms.push(argv[i]);
  }
  return o;
}

async function fetchTerm(s, term, opt) {
  const rows = [];
  let total = Infinity;
  if (opt.fromRaw) {
    for (let off = 0; off < total; off += 500) {
      const j = JSON.parse(await readFile(join(opt.fromRaw, `${term}-${off}.json`), 'utf8'));
      total = j.totalCount;
      rows.push(...j.data);
    }
    return finish(term, rows, total);
  }
  await s.bindTerm(term);
  for (let off = 0; off < total; off += 500) {
    if (off) await sleep(opt.delay);
    const j = await s.page(term, off);
    total = j.totalCount;
    if (opt.raw) await writeFile(join(opt.raw, `${term}-${off}.json`), JSON.stringify(j));
    if (!j.data || !j.data.length) break;
    rows.push(...j.data);
    process.stdout.write(`  ${term}: ${rows.length}/${total}\r`);
  }
  process.stdout.write('\n');
  return finish(term, rows, total);
}

function finish(term, rows, total) {
  // De-duplicate by CRN (paging is sorted by subject; ties could shift between pages).
  const byCrn = new Map();
  for (const r of rows) byCrn.set(r.courseReferenceNumber, r);
  const sections = [...byCrn.values()].map(compactSection)
    .sort((a, b) => a.subj.localeCompare(b.subj) || a.num.localeCompare(b.num) || a.sec.localeCompare(b.sec));
  if (sections.length < total) console.warn(`  warning: ${term} got ${sections.length} unique of ${total}`);
  const subjects = {};
  for (const r of byCrn.values()) if (r.subject && r.subjectDescription) subjects[r.subject] = r.subjectDescription;
  return { sections, subjects };
}

async function main() {
  const opt = args(process.argv.slice(2));
  await mkdir(OUT, { recursive: true });
  if (opt.raw) await mkdir(opt.raw, { recursive: true });
  const s = new BannerSession();
  await s.open();
  const all = await s.terms();
  const names = Object.fromEntries(all.map((t) => [t.code, t.description.replace(/\s*\(View Only\)\s*/i, '').trim()]));
  const terms = opt.terms.length ? opt.terms.map((code) => ({ code, name: names[code] || code })) : upcomingTerms(all);
  console.log('terms:', terms.map((t) => `${t.code} ${t.name}`).join(', '));
  for (const t of terms) {
    const { sections, subjects } = await fetchTerm(s, t.code, opt);
    const file = join(OUT, `${t.code}.json`);
    if (!sections.length) { console.log(`  ${t.code}: no sections published yet; skipped (any older file kept)`); continue; }
    // One row per line: small diffs in git when the weekly refresh changes a few seats.
    const head = JSON.stringify({ term: t.code, termName: t.name, fetched: new Date().toISOString(), count: sections.length, subjects: sortKeys(subjects) });
    const body = head.slice(0, -1) + ',"sections":[\n' + sections.map((x) => JSON.stringify(x)).join(',\n') + '\n]}\n';
    await writeFile(file, body);
    console.log(`  wrote ${file} (${sections.length} sections, ${(Buffer.byteLength(body) / 1024).toFixed(0)} KB)`);
    await sleep(opt.delay);
  }
  // index.json lists every term file present.
  const list = [];
  const subj = {};
  for (const f of (await readdir(OUT)).filter((f) => /^\d{6}\.json$/.test(f)).sort()) {
    const j = JSON.parse(await readFile(join(OUT, f), 'utf8'));
    list.push({ term: j.term, termName: j.termName, count: j.count, fetched: j.fetched });
    Object.assign(subj, j.subjects || {});
  }
  await writeFile(join(OUT, 'index.json'), JSON.stringify({ terms: list, subjects: sortKeys(subj) }, null, 1) + '\n');
  console.log('index:', list.map((t) => `${t.term}=${t.count}`).join(' '));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

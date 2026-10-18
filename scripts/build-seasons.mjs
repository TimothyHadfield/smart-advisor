#!/usr/bin/env node
// Which semesters (Fall / Spring / Summer) each UVU course has been offered in -> data/seasons.json.
// Usage: node scripts/build-seasons.mjs [--history N] [--fetch 202530,202540] [--delay ms]
//   Always reads every data/sections/<term>.json present and the terms already in data/seasons.json (the
//   history only grows: a weekly run adds the new terms, older terms are kept).
//   --history N  also fetches the N most recent past regular terms from public Banner 9 that are not
//                known yet (only the course codes are kept, nothing about sections or people).
//   --fetch a,b  fetches exactly these term codes.
// Source: https://userve.uvu.edu/StudentRegistrationSsb/ssb/ (no login). Polite: one request at a time.
//
// data/seasons.json:
//   { built: ISO, terms: [{ term: "202540", name: "2025 Fall", season: "Fall" }, ...] (oldest first),
//     courses: { "ECE 2250": [0, 2, 3], ... } }   (indexes into terms: the terms it had a section in)
// The planner (js/planner.js seasonInfo) treats this as a preference: a course is kept out of a season it
// was never offered in, but only when the history has at least one term of that season.

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BannerSession } from './lib/banner.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SECTIONS = join(ROOT, 'data', 'sections');
const OUT = join(ROOT, 'data', 'seasons.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const seasonOfTerm = (code) => ({ 20: 'Spring', 30: 'Summer', 40: 'Fall' }[String(code).slice(4)] || null);

/**
 * Merge term -> course-code sets into the seasons file shape.
 * known: { term: { name, codes: Set } }
 */
export function buildSeasons(known, built = new Date().toISOString()) {
  const terms = Object.keys(known).filter((t) => seasonOfTerm(t)).sort();
  const courses = {};
  terms.forEach((t, i) => {
    for (const c of known[t].codes) (courses[c] ??= []).push(i);
  });
  const sorted = Object.fromEntries(Object.entries(courses).sort(([a], [b]) => a.localeCompare(b)));
  return { built, terms: terms.map((t) => ({ term: t, name: known[t].name, season: seasonOfTerm(t) })), courses: sorted };
}

/** The seasons file back into term -> codes sets (to add new terms to it). */
export function knownFrom(file) {
  const known = {};
  if (!file?.terms) return known;
  file.terms.forEach((t) => { known[t.term] = { name: t.name, codes: new Set() }; });
  for (const [c, idx] of Object.entries(file.courses || {})) for (const i of idx) known[file.terms[i]?.term]?.codes.add(c);
  return known;
}

const codesOfSections = (sections) => new Set(sections.map((s) => `${s.subj} ${s.num}`));

function args(argv) {
  const o = { history: 0, fetch: [], delay: 1000 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--history') o.history = +argv[++i];
    else if (argv[i] === '--fetch') o.fetch = argv[++i].split(',').filter(Boolean);
    else if (argv[i] === '--delay') o.delay = +argv[++i];
  }
  return o;
}

async function fetchCodes(s, term, delay) {
  await s.bindTerm(term);
  const codes = new Set();
  let total = Infinity, got = 0;
  const take = (j) => { got += j.data.length; for (const r of j.data) if (r.subject && r.courseNumber) codes.add(`${r.subject} ${r.courseNumber}`); };
  for (let off = 0; off < total; off += 500) {
    if (off) await sleep(delay);
    let j = null;
    // Banner sometimes fails a page ("success": false), some old terms always at the same rows: try once
    // more, then read that block 50 rows at a time and skip only the small pages that still fail
    try { j = await s.page(term, off); } catch {
      await sleep(delay * 3);
      await s.bindTerm(term);
      try { j = await s.page(term, off); } catch {}
    }
    if (!j) {
      for (let o = off; o < Math.min(off + 500, total); o += 50) {
        await sleep(delay);
        try { const p = await s.page(term, o, 50); total = p.totalCount ?? total; if (p.data?.length) take(p); } catch { console.warn(`\n  ${term}: rows ${o}-${o + 49} skipped (Banner error)`); await s.bindTerm(term); }
      }
      if (!Number.isFinite(total)) break; // not one row came back
      continue;
    }
    total = j.totalCount;
    if (!j.data || !j.data.length) break;
    take(j);
    process.stdout.write(`  ${term}: ${got}/${total}\r`);
  }
  process.stdout.write('\n');
  return codes;
}

async function main() {
  const opt = args(process.argv.slice(2));
  let old = null;
  try { old = JSON.parse(await readFile(OUT, 'utf8')); } catch {}
  const known = knownFrom(old);
  for (const f of (await readdir(SECTIONS)).filter((f) => /^\d{6}\.json$/.test(f))) {
    const j = JSON.parse(await readFile(join(SECTIONS, f), 'utf8'));
    if (j.sections?.length) known[j.term] = { name: j.termName, codes: codesOfSections(j.sections) };
  }
  let want = [...opt.fetch];
  if (opt.history > 0 || want.length) {
    const s = new BannerSession();
    await s.open();
    const all = await s.terms();
    const names = Object.fromEntries(all.map((t) => [t.code, t.description.replace(/\s*\(View Only\)\s*/i, '').trim()]));
    if (opt.history > 0) {
      const top = Object.keys(known).sort().pop() || '999999';
      const past = all.map((t) => t.code).filter((c) => /^\d{4}[234]0$/.test(c) && c < top && !known[c]).sort().reverse();
      want.push(...past.slice(0, opt.history));
    }
    want = [...new Set(want)];
    console.log('fetching:', want.join(', ') || '(nothing new)');
    for (const t of want) {
      const codes = await fetchCodes(s, t, opt.delay);
      if (codes.size) known[t] = { name: names[t] || t, codes };
      else console.log(`  ${t}: no sections; skipped`);
      await writeFile(OUT, JSON.stringify(buildSeasons(known)) + '\n'); // keep each fetched term
      await sleep(opt.delay);
    }
  }
  const out = buildSeasons(known);
  await writeFile(OUT, JSON.stringify(out) + '\n');
  console.log(`wrote ${OUT}: ${out.terms.map((t) => t.term).join(' ')} · ${Object.keys(out.courses).length} courses`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

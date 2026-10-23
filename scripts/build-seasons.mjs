#!/usr/bin/env node
// Which semesters (Fall / Spring / Summer) each UVU course ran in over the last 3 years -> data/seasons.json.
// Usage: node scripts/build-seasons.mjs [--per 3] [--delay 500] [--cache <dir>] [--only 202640,202720]
//   Run it once a semester (after the next term's schedule is posted). It picks the window itself:
//   the --per (3) most recent terms of each season that have sections, i.e. about the last 3 academic years,
//   including a future term that is already posted (Spring 2027 in Oct 2026). A term that is only partly
//   posted (fewer than 60% of the biggest same-season term's sections) is kept as extra evidence but does
//   not push an older full term out of the window.
//   Every term is fetched subject by subject (the all-subject listing tops out at 8,192 rows), one request at
//   a time, --delay ms apart (500 = 2 requests/s). Only course codes are kept: nothing about sections or people.
//   --cache dir  keeps each fetched term in dir/<term>.json, so a stopped run picks up where it was
//   --only a,b   fetch these terms again (others come from the file / cache)
//   --full       fetch every term again (default: terms that ended before today's term are reused from
//                data/seasons.json, so the weekly GitHub Action only fetches the current + posted future terms)
// Source: https://userve.uvu.edu/StudentRegistrationSsb/ssb/ (public class search, no login).
//
// data/seasons.json:
//   { built: ISO, rule: "...", terms: [{ term: "202540", name: "2025 Fall", season: "Fall", sections: 2911 }, ...]
//     (oldest first), courses: { "ECE 2250": [0, 2, 3], ... } }   (indexes into terms: the terms it had a section in)
// The planner (js/rules.js seasonTable / offeredIn) reads it: a class is planned only in a season it ran in
// (classes seen in fewer than 2 terms, or not at all, may go in any season).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BannerSession } from './lib/banner.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'seasons.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const RULE = 'A class is offered in a season when it had a section in at least one sampled term of that season (3 most recent terms per season). Classes seen in fewer than 2 sampled terms are not limited.';

export const seasonOfTerm = (code) => ({ 20: 'Spring', 30: 'Summer', 40: 'Fall' }[String(code).slice(4)] || null);

/**
 * Which terms make the window. probes: [{ term, sections }] (any order; terms with 0 sections are ignored).
 * Per season: the `per` newest terms with at least 60% of that season's biggest term, plus any newer
 * (partly posted) ones. -> sorted term codes
 */
export function pickWindow(probes, per = 3) {
  const out = [];
  for (const season of ['Spring', 'Summer', 'Fall']) {
    const mine = probes.filter((p) => seasonOfTerm(p.term) === season && p.sections > 0).sort((a, b) => b.term.localeCompare(a.term));
    const big = Math.max(0, ...mine.map((p) => p.sections));
    let full = 0;
    for (const p of mine) {
      if (full >= per) break;
      out.push(p.term);
      if (p.sections >= 0.6 * big) full++;
    }
  }
  return out.sort();
}

/**
 * Term -> course-code sets into the seasons file shape.
 * known: { term: { name, codes: Set|Array, sections } }
 */
export function buildSeasons(known, built = new Date().toISOString()) {
  const terms = Object.keys(known).filter((t) => seasonOfTerm(t)).sort();
  const courses = {};
  terms.forEach((t, i) => {
    for (const c of known[t].codes) (courses[c] ??= []).push(i);
  });
  const sorted = Object.fromEntries(Object.entries(courses).sort(([a], [b]) => a.localeCompare(b)));
  return {
    built, rule: RULE,
    terms: terms.map((t) => ({ term: t, name: known[t].name, season: seasonOfTerm(t), sections: known[t].sections ?? null })),
    courses: sorted,
  };
}

/** The seasons file back into term -> { name, codes, sections } (to reuse finished terms). */
export function knownFrom(file) {
  const known = {};
  if (!file?.terms) return known;
  file.terms.forEach((t) => { known[t.term] = { name: t.name, codes: new Set(), sections: t.sections ?? null }; });
  for (const [c, idx] of Object.entries(file.courses || {})) for (const i of idx) known[file.terms[i]?.term]?.codes.add(c);
  return known;
}

/** The Banner code of the term a date falls in (Spring Jan-Apr, Summer May-Aug 19, Fall Aug 20+; D7). */
export function termOfDate(d = new Date()) {
  const m = d.getMonth() + 1, y = d.getFullYear();
  return `${y}${m <= 4 ? 20 : m < 8 || (m === 8 && d.getDate() < 20) ? 30 : 40}`;
}

function args(argv) {
  const o = { per: 3, delay: 500, cache: null, only: null, full: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--per') o.per = +argv[++i];
    else if (argv[i] === '--delay') o.delay = Math.max(500, +argv[++i]);
    else if (argv[i] === '--cache') o.cache = argv[++i];
    else if (argv[i] === '--only') o.only = argv[++i].split(',').filter(Boolean);
    else if (argv[i] === '--full') o.full = true;
  }
  return o;
}

// one search: reset Banner's form (it otherwise repeats the last search), then read the rows
async function search(s, term, subject, offset, delay, size = 500) {
  await s.req('/classSearch/resetDataForm', { method: 'POST' }).catch(() => {});
  await sleep(delay);
  const q = `txt_subject=${encodeURIComponent(subject)}&txt_term=${term}&uniqueSessionId=${s.sid}&pageOffset=${offset}&pageMaxSize=${size}&sortColumn=courseNumber&sortDirection=asc`;
  const j = await (await s.req(`/searchResults/searchResults?${q}`)).json();
  await sleep(delay);
  if (!j.success) throw new Error(`Banner search failed: ${term} ${subject} @${offset}`);
  return j;
}

async function fetchTerm(s, term, delay) {
  await s.bindTerm(term);
  await sleep(delay);
  const subjects = await (await s.req(`/classSearch/get_subject?searchTerm=&term=${term}&offset=1&max=500`)).json();
  await sleep(delay);
  const codes = new Set(), crns = new Set(), failed = [];
  for (const [k, sub] of subjects.entries()) {
    let total = Infinity;
    for (let off = 0; off < total; off += 500) {
      let j = null;
      for (let tryNo = 0; tryNo < 3 && !j; tryNo++) {
        try { j = await search(s, term, sub.code, off, delay); } catch {
          await sleep(delay * 4);
          await s.bindTerm(term).catch(() => {});
        }
      }
      if (!j) {
        // Banner fails some blocks every time (one bad row): read it 25 rows at a time, skip only what still fails
        let any = false;
        for (let o = off; o < off + 500; o += 25) {
          let p = null;
          try { p = await search(s, term, sub.code, o, delay, 25); } catch { failed.push(`${sub.code}@${o}`); await s.bindTerm(term).catch(() => {}); continue; }
          any = true;
          for (const r of p.data || []) {
            if (r.subject && r.courseNumber) codes.add(`${r.subject} ${r.courseNumber}`);
            if (r.courseReferenceNumber) crns.add(r.courseReferenceNumber);
          }
          if (o + 25 >= (p.totalCount || 0)) break;
        }
        if (!any) failed.push(`${sub.code}@${off}`);
        break;
      }
      total = j.totalCount || 0;
      for (const r of j.data || []) {
        if (r.subject && r.courseNumber) codes.add(`${r.subject} ${r.courseNumber}`);
        if (r.courseReferenceNumber) crns.add(r.courseReferenceNumber);
      }
      if (!j.data?.length) break;
    }
    process.stdout.write(`  ${term}: ${k + 1}/${subjects.length} subjects, ${crns.size} sections\r`);
  }
  process.stdout.write('\n');
  if (failed.length) console.warn(`  ${term}: not read (Banner errors, 3 tries): ${failed.join(' ')}`);
  return { codes: [...codes].sort(), sections: crns.size, subjects: subjects.length, failed };
}

async function main() {
  const opt = args(process.argv.slice(2));
  if (opt.cache) await mkdir(opt.cache, { recursive: true });
  const s = new BannerSession();
  await s.open();
  const all = await (await s.req('/classSearch/getTerms?searchTerm=&offset=1&max=200')).json();
  const names = Object.fromEntries(all.map((t) => [t.code, t.description.replace(/\s*\(View Only\)\s*/i, '').trim()]));
  // newest regular terms first; probe each one's size (one row) until every season has enough
  const regular = all.map((t) => t.code).filter((c) => /^\d{4}[234]0$/.test(c)).sort().reverse();
  const probes = [];
  for (const t of regular) {
    const counts = ['Spring', 'Summer', 'Fall'].map((x) => probes.filter((p) => seasonOfTerm(p.term) === x && p.sections > 0).length);
    if (counts.every((n) => n >= opt.per + 1)) break;
    if (probes.filter((p) => seasonOfTerm(p.term) === seasonOfTerm(t) && p.sections > 0).length >= opt.per + 1) continue;
    await s.bindTerm(t); await sleep(opt.delay);
    const j = await (await s.req(`/searchResults/searchResults?txt_term=${t}&uniqueSessionId=${s.sid}&pageOffset=0&pageMaxSize=1`)).json();
    await sleep(opt.delay);
    probes.push({ term: t, sections: j.totalCount || 0 });
    console.log(`  probe ${t} ${names[t]}: ${j.totalCount || 0} sections listed`);
  }
  const window = pickWindow(probes, opt.per);
  console.log('window:', window.map((t) => `${t} (${names[t]})`).join(', '));
  // terms that ended before today's term don't change any more: reuse them from the current file (fetched
  // subject by subject, so they carry a section count) unless --full
  let old = {};
  try { old = knownFrom(JSON.parse(await readFile(OUT, 'utf8'))); } catch {}
  const now = termOfDate();
  const known = {};
  for (const t of window) {
    const file = opt.cache && join(opt.cache, `${t}.json`);
    let got = null;
    const forced = opt.only && opt.only.includes(t);
    if (!opt.full && !forced && t < now && old[t]?.sections && old[t].codes.size) got = { codes: [...old[t].codes], sections: old[t].sections, failed: [] };
    if (!got && file && !forced) { try { got = JSON.parse(await readFile(file, 'utf8')); } catch {} }
    if (!got || got.failed?.length) {
      got = await fetchTerm(s, t, opt.delay);
      if (file) await writeFile(file, JSON.stringify(got));
    }
    // some subjects failed: keep what the old file knew about this term too (never lose classes to an outage)
    if (got.failed?.length && old[t]) got = { ...got, codes: [...new Set([...got.codes, ...old[t].codes])].sort() };
    const listed = probes.find((p) => p.term === t)?.sections;
    console.log(`  ${t}: ${got.codes.length} courses, ${got.sections} sections (all-subject listing: ${listed})`);
    known[t] = { name: names[t] || t, codes: got.codes, sections: got.sections };
  }
  const out = buildSeasons(known);
  await writeFile(OUT, JSON.stringify(out) + '\n');
  console.log(`wrote ${OUT}: ${out.terms.map((t) => t.term).join(' ')} · ${Object.keys(out.courses).length} courses`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

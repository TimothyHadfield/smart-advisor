#!/usr/bin/env node
// Fetch UVU's General Education course lists (the catalog's general-education page) into data files.
//
// Usage:
//   node scripts/fetch-gened.mjs [--cache <dir>] [--offline]
//
// Output: data/gened.json (current catalog) and data/2025-2026/gened.json (archive), each
//   { catalogYear, url, fetched, areas: [{ key, name, credits, aas?, courses: [{ code, alts?, title, credits }] }] }
// key: wc (Written Communication) · ql (Quantitative Literacy) · ai (American Institutions) ·
//      pg (Personal, Professional, and Civic Growth) · arts · hum · life · phys · soc.
//      The Associate of Applied Science lists come as extra areas with aas: true (same keys).
// Titles and credits come from the page; a missing credit value is filled from that year's courses.json.
// Polite: one request at a time, raw pages cached on disk (--cache) so reruns are free.

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, text } from './fetch-program.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'SmartAdvisor/1.0 (student project; github.com/TimothyHadfield/smart-advisor)';
export const YEARS = [
  { year: null, url: 'https://catalog.uvu.edu/general-education/', out: 'data/gened.json', courses: 'data/courses.json' },
  { year: '2025-2026', url: 'https://catalog.uvu.edu/archives/2025-2026/general-education/', out: 'data/2025-2026/gened.json', courses: 'data/2025-2026/courses.json' },
];

// a page heading / area header -> area key
const KEYS = [
  ['wc', /written|english|composition/i],
  ['ql', /quantitative/i],
  ['ai', /american institution/i],
  ['pg', /institutional|personal|civic/i],
  ['arts', /^arts?\b|fine art/i],
  ['hum', /humanit/i],
  ['life', /life science|biolog/i],
  ['phys', /physical science/i],
  ['soc', /social|behavio/i],
];
const keyOf = (name) => KEYS.find(([, re]) => re.test(name))?.[0] || null;
const NAMES = { pg: 'Personal, Professional, and Civic Growth' };

const num = (s) => { const m = /(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?/.exec(s || ''); return m ? +m[1] : null; };

/**
 * The general-education page -> { areas }. Reads the requirement tables after "General Education Requirements":
 * each table is one area, named by its area-header row, else by the heading above it (h4 under h3).
 * "or" rows and "1040/1040H" codes become alts of the course above. Areas under the Applied Science heading get aas.
 */
export function parseGenEd(html, { courses = {} } = {}) {
  const start = html.indexOf('General Education Requirements</h2>');
  let s = start >= 0 ? html.slice(start) : html;
  const areas = [];
  let h3 = '', h4 = '', aas = false;
  const re = /<h([34])[^>]*>([\s\S]*?)<\/h\1>|<table class="sc_courselist"[\s\S]*?<\/table>|<h2[^>]*>/g;
  for (const m of s.matchAll(re)) {
    if (m[0].startsWith('<h2')) { if (m.index > 0) break; continue; } // the next h2 ends the requirements
    if (m[1] === '3') { h3 = text(m[2]); h4 = ''; aas = /applied science/i.test(h3); continue; }
    if (m[1] === '4') { h4 = text(m[2]); continue; }
    const table = m[0];
    const head = /<span class="courselistcomment areaheader[^"]*">([\s\S]*?)<\/span><\/td><td class="hourscol">([\s\S]*?)<\/td>/.exec(table);
    const label = head ? text(head[1]) : h4 || h3;
    const key = keyOf(label);
    if (!key) continue;
    const list = [];
    for (const row of table.matchAll(/<tr class="([^"]*)">([\s\S]*?)<\/tr>/g)) {
      const link = /<a [^>]*title="([^"]+)"[^>]*class="bubblelink code"[^>]*onclick="return showCourse\(this, '([^']+)'\);"/.exec(row[2]);
      if (!link) continue;
      const shown = decode(link[1]).replace(/\s+/g, ' ');
      const code = decode(link[2]).replace(/\s+/g, ' ');
      const subj = code.split(' ')[0];
      const alts = shown.split('/').slice(1).map((n) => `${subj} ${n.trim()}`);
      if (/\borclass\b/.test(row[1]) && list.length) {
        const prev = list[list.length - 1];
        for (const c of [code, ...alts]) if (c !== prev.code && !prev.alts.includes(c)) prev.alts.push(c);
        continue;
      }
      // "HIST 2700 & HIST 2710" in one row: both are needed
      const and = [...row[2].matchAll(/&amp;\s*<a [^>]*onclick="return showCourse\(this, '([^']+)'\);"/g)].map((x) => decode(x[1]).replace(/\s+/g, ' '));
      const cells = [...row[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].replace(/<sup>[\s\S]*?<\/sup>/g, ''));
      let title = text(cells[1] || '');
      const inTitle = /\s*\((\d+(?:\.\d+)?(?:\s*-\s*\d+)?)\)\s*$/.exec(title);
      if (inTitle) title = title.slice(0, inTitle.index);
      title = title.replace(/\s*\(complete [^)]*\)\s*$/i, '');
      let credits = num(text(cells[2] || '')) ?? (inTitle ? num(inTitle[1]) : null) ?? courses[code]?.credits ?? null;
      if (!title) title = courses[code]?.title || '';
      if (list.some((c) => c.code === code)) continue;
      list.push({ code, alts, and, title, credits });
    }
    if (!list.length) continue;
    const credits = num(head ? text(head[2]) : '') ?? num(/Complete (?:one of the following for )?(\d+)/i.exec(table)?.[1]);
    const tidy = ({ code, alts, and, title, credits: cr }) => ({ code, ...(and.length ? { and } : {}), ...(alts.length ? { alts } : {}), title, credits: cr });
    const area = { key, name: NAMES[key] || label, credits, ...(aas ? { aas: true } : {}), courses: list.map(tidy) };
    const same = areas.find((a) => a.key === key && !!a.aas === aas);
    if (same) { for (const c of area.courses) if (!same.courses.some((x) => x.code === c.code)) same.courses.push(c); }
    else areas.push(area);
  }
  return { areas };
}

// ---------- fetch (polite, cached) ----------
async function getPage(url, cacheFile, offline) {
  if (cacheFile) { try { return await readFile(cacheFile, 'utf8'); } catch {} }
  if (offline) throw new Error(`not cached: ${url}`);
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const html = await r.text();
  if (cacheFile) { await mkdir(dirname(cacheFile), { recursive: true }); await writeFile(cacheFile, html); }
  await new Promise((ok) => setTimeout(ok, 600));
  return html;
}

async function main() {
  const args = process.argv.slice(2);
  const cache = args.includes('--cache') ? args[args.indexOf('--cache') + 1] : null;
  const offline = args.includes('--offline');
  for (const y of YEARS) {
    const html = await getPage(y.url, cache && join(cache, `${y.year || 'current'}.html`), offline);
    let courses = {};
    try { courses = JSON.parse(await readFile(join(ROOT, y.courses), 'utf8')); } catch {}
    const { areas } = parseGenEd(html, { courses });
    const yearOf = y.year || JSON.parse(await readFile(join(ROOT, 'data/programs/_year.json'), 'utf8')).catalogYear || null;
    const out = { catalogYear: yearOf, url: y.url, fetched: new Date().toISOString().slice(0, 10), areas };
    await mkdir(dirname(join(ROOT, y.out)), { recursive: true });
    await writeFile(join(ROOT, y.out), JSON.stringify(out, null, 1) + '\n');
    console.log(`${y.out}: ${areas.map((a) => `${a.key}${a.aas ? '(aas)' : ''} ${a.courses.length}`).join(', ')}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });

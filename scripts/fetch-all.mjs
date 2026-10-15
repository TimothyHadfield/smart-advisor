#!/usr/bin/env node
// Fetch EVERY program in a UVU catalog year into data files.
//
// Usage:
//   node scripts/fetch-all.mjs [--year current|2025-2026|2024-2025] [--cache <dir>] [--delay ms]
//                              [--only slug,slug] [--pages-only]
//
// Output (current year keeps the paths the app already loads):
//   current:  data/programs/<slug>.json, data/programs/_year.json (manifest), data/courses.json
//             + data/programs/ee-bs.json (alias of electrical-engineering-bs, id "ee-bs", for the app)
//   archive:  data/<year>/programs/<slug>.json, data/<year>/programs/_year.json, data/<year>/courses.json
//   merged:   data/programs/index.json, data/programs/_report.json, data/programs/_by-college.json (see buildIndex)
//   always:   data/catalogs.json (which catalog years exist and where their files are)
//   node scripts/fetch-all.mjs --index-only   rebuilds the merged files from the manifests
//
// Each program file has the same shape as before (id, name, url, totalCredits, requirements, gradPlan,
// courses) and stays self-contained: `courses` holds just the courses that program mentions.
// data/courses.json is the shared course store for the whole year; each course is fetched once.
// Polite: one request at a time, >= 400 ms apart, raw pages cached on disk (--cache) so reruns are free.

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get, text, decode, parseRequirements, parseGradPlan, programCodes, programName, fetchCourse, nameChoices } from './fetch-program.mjs';

const CATALOG = 'https://catalog.uvu.edu';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- program list ----------
const TYPE_MAP = {
  'B.S.': 'BS', 'B.S': 'BS', 'BS': 'BS', 'B.A.': 'BA', 'B.F.A.': 'BFA', 'B.M.': 'BM', 'B.A.S.': 'BAS', 'B.A.P.': 'BAP',
  'B.S.W.': 'BSW', 'B.Arch': 'BArch', 'A.S.': 'AS', 'A.A.': 'AA', 'A.A.S.': 'AAS', 'A.A.S': 'AAS', 'A.P.E.': 'APE',
  'A.S.N.': 'ASN', 'SAAS': 'SAAS', 'M.S.': 'MS', 'M.A.': 'MA', 'M.Ed.': 'MEd', 'M.S.W.': 'MSW', 'M.P.A.S.': 'MPAS',
  'M.P.A.': 'MPA', 'M.C.S.': 'MCS', 'M.B.A.': 'MBA', 'M.Acc': 'MAcc', 'M.A.T.': 'MAT', 'M.S.N.': 'MSN',
  'Minor': 'minor', 'Undergraduate Certificate': 'certificate', 'Graduate Certificate': 'graduate-certificate',
  'Certificate of Proficiency': 'certificate-proficiency', 'Certificate of Completion': 'certificate-completion',
  'Licensure': 'licensure', 'Endorsement': 'endorsement',
};
export function splitName(name) {
  const m = name.match(/^(.*),\s*([^,]+)$/);
  const suffix = m ? m[2].trim() : '';
  const kind = TYPE_MAP[suffix] ?? (suffix ? suffix.replace(/\./g, '') : 'other');
  // `type` follows the app contract: BS BA BAS AS AA AAS Minor Certificate Other. `kind` keeps the detail
  // (BFA, BM, MS, certificate-proficiency, graduate-certificate, ...).
  const type = ['BS', 'BA', 'BAS', 'AS', 'AA', 'AAS'].includes(kind) ? kind : kind === 'minor' ? 'Minor' : /certificate/.test(kind) ? 'Certificate' : 'Other';
  const main = m ? m[1] : name;
  const em = main.match(/^(.*?)\s+-\s+(.*?)\s+Emphasis$/);
  return { type, kind, degree: suffix || null, ...(em ? { major: em[1], emphasis: em[2] } : { major: main }) };
}

export function parseProgramList(html, base) {
  const labels = {};
  for (const m of html.matchAll(/<label for="(filter_\d+)">([^<]*)<\/label>/g)) labels[m[1]] = decode(m[2]).trim();
  const out = new Map();
  for (const m of html.matchAll(/<li id="isotope-item\d+" class="item ([^"]*)"><a href="([^"]+)">([\s\S]*?)<\/a><\/li>/g)) {
    const href = m[2];
    const id = href.replace(/\/$/, '').split('/').pop();
    if (out.has(id)) continue; // the page lists each program twice (grid + list view)
    const name = text((m[3].match(/<span class="title">([\s\S]*?)<\/span>/) || [, ''])[1]);
    const tags = m[1].split(/\s+/).map((f) => labels[f]).filter(Boolean);
    const college = tags.find((t) => /College|School/.test(t)) || null;
    const level = tags.includes('Graduate') ? 'graduate' : 'undergraduate';
    const url = new URL(href, base + '/').href.replace(/^http:/, 'https:');
    out.set(id, { id, name, ...splitName(name), level, college, online: tags.includes('Online') || tags.includes('Yes'), url });
  }
  return [...out.values()];
}

const department = (html) => {
  const nav = (html.match(/<nav id="breadcrumb"[\s\S]*?<\/nav>/) || [''])[0];
  const parts = text(nav).split('›').map((s) => s.trim()).filter(Boolean);
  return parts.length >= 4 ? parts[parts.length - 2] : null;
};

// Credits the program table left blank ("A & B" rows, "(undefined)" in option titles, choice headers with
// no hours) come from the course catalog: option = sum of its courses, count-choice = count x cheapest option.
export function fillCredits(items, courses) {
  const cr = (code) => courses[code]?.credits ?? null;
  for (const it of items) {
    if (it.type === 'course' && it.credits == null) it.credits = cr(it.code);
    if (it.type !== 'choice') continue;
    for (const o of it.options) if (o.credits == null) {
      const parts = o.codes.map(cr);
      if (parts.every((x) => x != null)) o.credits = parts.reduce((a, b) => a + b, 0);
    }
    if (it.credits == null) {
      if (it.pick.credits) it.credits = it.pick.credits;
      else {
        const known = it.options.map((o) => o.credits).filter((x) => x != null).sort((a, b) => a - b);
        if (known.length) it.credits = known.slice(0, it.pick.count || 1).reduce((a, b) => a + b, 0);
      }
    }
  }
}

// ---------- sanity checks: anything odd goes to _report.json ----------
export function checkProgram(prog) {
  const warn = [];
  const req = prog.requirements;
  const sum = req.reduce((a, it) => a + (it.credits || 0), 0);
  if (!req.length) warn.push('no requirement rows parsed');
  if (prog.totalCredits == null) warn.push('no total credits on page');
  else if (req.length && Math.abs(sum - prog.totalCredits) > Math.max(3, prog.totalCredits * 0.1)) warn.push(`requirement credits add to ${sum}, page says ${prog.totalCredits}`);
  const nulls = req.filter((it) => it.credits == null).length;
  if (nulls) warn.push(`${nulls} requirement rows with no credits`);
  const emptyChoices = req.filter((it) => it.type === 'choice' && !it.options.length).length;
  if (emptyChoices) warn.push(`${emptyChoices} choice groups with no options`);
  if (!prog.gradPlan.length) warn.push('no graduation plan');
  if (prog.missingCourses) warn.push(`no catalog entry for ${prog.missingCourses.join(', ')}`);
  if (prog.totalFrom) warn.push(`no "Total Credit Hours" row; total taken from ${prog.totalFrom}`);
  for (const t of prog.otherTables || []) warn.push(`extra requirement table "${t.heading}" (${t.total} cr) not linked from the main table; kept in otherTables, not in requirements`);
  const unresolved = req.filter((it) => it.type === 'placeholder' && /^complete (?:the )?(?:core )?requi?re?ments?$/i.test(it.label));
  for (const u of unresolved) warn.push(`"${u.label}" (${u.credits} cr) points to requirements that are not on this page; kept as one placeholder`);
  return warn;
}

// ---------- main ----------
async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d = null) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
  const year = opt('--year', 'current');
  const cacheRoot = opt('--cache');
  const delay = Math.max(400, +opt('--delay', 400));
  const only = opt('--only')?.split(',');
  const pagesOnly = flag('--pages-only');
  if (flag('--index-only')) { await buildIndex(); return; }
  const archive = year !== 'current';
  const base = archive ? `${CATALOG}/archives/${year}` : CATALOG;
  const cacheDir = cacheRoot ? join(cacheRoot, year) : null;
  const dataDir = archive ? join(ROOT, 'data', year) : join(ROOT, 'data');
  const progDir = join(dataDir, 'programs');
  await mkdir(progDir, { recursive: true });

  const listHtml = await get(`${base}/programs/`, cacheDir, 'programs.html', delay);
  let list = parseProgramList(listHtml, CATALOG);
  const homeHtml = archive ? null : await get(`${CATALOG}/`, cacheDir, 'home.html', delay);
  const edition = archive ? year : (homeHtml.match(/(\d{4}-\d{4}) Edition/) || [, 'current'])[1];
  console.log(`${edition}: ${list.length} programs`);
  if (only) list = list.filter((p) => only.includes(p.id));

  const coursesFile = join(dataDir, 'courses.json');
  let store = {};
  try { store = JSON.parse(await readFile(coursesFile, 'utf8')); } catch {}
  const report = [];
  const index = [];
  const used = new Set();
  let n = 0;
  for (const p of list) {
    n++;
    let html;
    try { html = await get(p.url, cacheDir, `program-${p.id}.html`, delay); }
    catch (e) { report.push({ id: p.id, url: p.url, status: 'failed', reason: `fetch: ${e.message}` }); index.push({ ...p, status: 'failed' }); continue; }
    if (pagesOnly) { process.stderr.write(`\r${n}/${list.length}`); continue; }
    try {
      const req = parseRequirements(html);
      const gradPlan = parseGradPlan(html);
      const codes = programCodes(req.items, gradPlan);
      codes.forEach((c) => used.add(c));
      const courses = {}, missing = [];
      for (const code of [...codes].sort()) {
        const c = await fetchCourse(code, { base, cacheDir, delay, store });
        if (c) courses[code] = c; else missing.push(code);
      }
      fillCredits(req.items, courses);
      nameChoices(req.items, gradPlan);
      const prog = {
        id: p.id, name: programName(html, p.name), url: p.url, catalogYear: edition, fetched: new Date().toISOString().slice(0, 10),
        totalCredits: req.total, requirements: req.items, gradPlan, courses,
        ...(missing.length ? { missingCourses: missing } : {}),
        ...(req.totalFrom ? { totalFrom: req.totalFrom } : {}),
        ...(req.extra ? { otherTables: req.extra } : {}),
      };
      const warn = checkProgram(prog);
      const status = !req.items.length ? 'failed' : warn.length ? 'warn' : 'ok';
      if (status !== 'failed') await writeFile(join(progDir, `${p.id}.json`), JSON.stringify(prog, null, 1) + '\n');
      if (warn.length) report.push({ id: p.id, url: p.url, status, reason: warn.join('; ') });
      index.push({ ...p, department: department(html), credits: req.total, status, ...(status !== 'failed' ? { file: `${p.id}.json` } : {}) });
      if (!archive && p.id === 'electrical-engineering-bs') await writeFile(join(progDir, 'ee-bs.json'), JSON.stringify({ ...prog, id: 'ee-bs' }, null, 1) + '\n');
    } catch (e) {
      report.push({ id: p.id, url: p.url, status: 'failed', reason: `parse: ${e.stack.split('\n').slice(0, 2).join(' ')}` });
      index.push({ ...p, department: department(html), status: 'failed' });
    }
    process.stderr.write(`\r${n}/${list.length} ${p.id.padEnd(60)}`);
    if (n % 25 === 0) await writeFile(coursesFile, JSON.stringify(store) + '\n');
  }
  process.stderr.write('\n');
  if (pagesOnly) return;
  // full runs keep only courses some program of this year still names (drops leftovers of older parses)
  const keep = only ? Object.keys(store) : Object.keys(store).filter((k) => used.has(k));
  const sorted = Object.fromEntries(keep.sort().map((k) => [k, store[k]]));
  await writeFile(coursesFile, JSON.stringify(sorted, null, 0).replace(/,"(?=[A-Z]{2,5} \d)/g, ',\n"') + '\n');
  if (!only) {
    // per-year manifest; the app-facing index/report are merged across years by buildIndex()
    await writeFile(join(progDir, '_year.json'), JSON.stringify({ catalogYear: edition, source: `${base}/programs/`, fetched: new Date().toISOString().slice(0, 10), counts: countBy(index), programs: index, problems: report }, null, 1) + '\n');
    await updateCatalogs(edition, archive ? `data/${year}/` : 'data/', index.length);
    await buildIndex();
  }
  const c = countBy(index);
  console.log(`done: ${JSON.stringify(c)}; ${Object.keys(store).length} courses in store`);
}

const countBy = (index) => index.reduce((a, p) => ((a[p.status] = (a[p.status] || 0) + 1), a), {});

// Merge every fetched year into the app-facing files (contract with the picker UI):
//   data/programs/index.json      { generated, catalogYears, programs: [{ id, name, type, college, department, url, credits, years, ...extra }] }
//   data/programs/_report.json    [{ id, year, url, problem }]
//   data/programs/_by-college.json { "<college>": [{ id, name, type }] }
// A program's file for year Y is data/programs/<id>.json when Y is the current year, else data/<Y>/programs/<id>.json.
export async function buildIndex() {
  const cat = JSON.parse(await readFile(join(ROOT, 'data', 'catalogs.json'), 'utf8'));
  const years = Object.keys(cat.years); // newest first
  const byId = new Map();
  const report = [];
  for (const y of years) {
    const yr = JSON.parse(await readFile(join(ROOT, cat.years[y].dir, 'programs', '_year.json'), 'utf8'));
    for (const p of yr.programs) {
      const ok = p.status !== 'failed';
      if (!byId.has(p.id)) {
        const { status, file, ...rest } = p;
        byId.set(p.id, { id: p.id, name: p.name, type: p.type, college: p.college, department: p.department ?? null, url: p.url, credits: p.credits ?? null, years: [], ...rest });
      }
      if (ok) byId.get(p.id).years.push(y);
    }
    for (const r of yr.problems) report.push({ id: r.id, year: y, url: r.url, problem: r.reason, ...(r.status === 'failed' ? { failed: true } : {}) });
  }
  const programs = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  const out = join(ROOT, 'data', 'programs');
  await writeFile(join(out, 'index.json'), JSON.stringify({ generated: new Date().toISOString().slice(0, 10), current: cat.current, catalogYears: years, programs }, null, 1) + '\n');
  await writeFile(join(out, '_report.json'), JSON.stringify(report, null, 1) + '\n');
  const byCollege = {};
  for (const p of programs) (byCollege[p.college || 'Unknown'] ||= []).push({ id: p.id, name: p.name, type: p.type, years: p.years });
  await writeFile(join(out, '_by-college.json'), JSON.stringify(Object.fromEntries(Object.entries(byCollege).sort()), null, 1) + '\n');
}

async function updateCatalogs(edition, dir, count) {
  const f = join(ROOT, 'data', 'catalogs.json');
  let cat = { years: {} };
  try { cat = JSON.parse(await readFile(f, 'utf8')); } catch {}
  if (dir === 'data/') cat.current = edition;
  // What https://catalog.uvu.edu/archives/ offers (checked 2026-10-15): web archives for 2024-2025 and
  // 2025-2026 (same CourseLeaf pages + course API, fetchable with --year), PDFs only for 2023-2024 and older.
  cat.webArchives = ['2025-2026', '2024-2025'];
  cat.pdfOnly = '2023-2024 and older (https://catalog.uvu.edu/archives/)';
  cat.years[edition] = { dir, programs: `${dir}programs/`, manifest: `${dir}programs/_year.json`, courses: `${dir}courses.json`, count };
  cat.years = Object.fromEntries(Object.entries(cat.years).sort((a, b) => b[0].localeCompare(a[0])));
  await writeFile(f, JSON.stringify(cat, null, 1) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

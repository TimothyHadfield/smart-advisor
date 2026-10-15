#!/usr/bin/env node
// Fetch one UVU catalog program (CourseLeaf) into data/programs/<id>.json.
// Usage: node scripts/fetch-program.mjs <catalog-program-url> <id> [--cache <dir>] [--delay <ms>]
// No dependencies. Polite: one request at a time with a delay between them.

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CATALOG = 'https://catalog.uvu.edu';
const UA = 'SmartAdvisor/1.0 (student project; github.com/TimothyHadfield/smart-advisor)';

// ---------- small HTML helpers ----------
export function decode(s) {
  return s
    .replace(/&#160;|&nbsp;| /g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&rsquo;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}
export const text = (html) => decode(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const CODE_RE = /\b([A-Z]{2,5}) (\d{4}[A-Z]{0,2})\b/g;
export const codesIn = (html) => [...text(html).matchAll(CODE_RE)].map((m) => `${m[1]} ${m[2]}`);
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15 };
const num = (w) => (/^\d+$/.test(w) ? +w : NUM[w.toLowerCase()] ?? null);

function container(html, id) {
  const i = html.indexOf(`id="${id}"`);
  if (i < 0) return '';
  // tab containers are siblings; cut at the next tab container
  const rest = html.slice(i + id.length + 5);
  const j = rest.search(/id="[a-z]+textcontainer"/);
  return html.slice(i, j < 0 ? undefined : i + id.length + 5 + j);
}
function rows(tableHtml) {
  return [...tableHtml.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)].map((m) => {
    const cls = (m[1].match(/class="([^"]*)"/) || [, ''])[1];
    const cells = [...m[2].matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/g)].map((c) => ({ attrs: c[1], html: c[2] }));
    return { cls, html: m[2], cells };
  });
}
const hoursOf = (row) => {
  const c = row.cells.find((c) => /hourscol/.test(c.attrs));
  if (!c) return null;
  const t = text(c.html);
  const m = t.match(/(\d+(?:\.\d+)?)(?:\s*-\s*(\d+))?/);
  return m ? +m[1] : null;
};

// ---------- program requirements ----------
export function parseRequirements(html) {
  const box = container(html, 'requirementstextcontainer');
  const items = [];
  let total = null, area = '', group = null, pendingLabel = null;
  for (const tbl of box.match(/<table class="sc_courselist"[\s\S]*?<\/table>/g) || []) {
    for (const r of rows(tbl)) {
      if (/listsum/.test(r.cls)) { total = total ?? hoursOf(r); continue; }
      const comment = r.html.match(/<span class="courselistcomment[^"]*">([\s\S]*?)<\/span>/);
      if (/areaheader/.test(r.cls)) { area = text(comment ? comment[1] : r.html); group = null; pendingLabel = null; continue; }
      if (/orclass/.test(r.cls)) {
        const alt = codesIn(r.cells[0]?.html || '');
        const target = group && group.options.length ? group.options[group.options.length - 1] : items[items.length - 1];
        if (target) {
          if (target.type === 'course') target.alts.push(...alt);
          else if (Array.isArray(target)) target.alts = [...(target.alts || []), ...alt];
        }
        continue;
      }
      if (comment && !codesIn(r.cells[0]?.html || '').length) {
        const label = text(comment[1]);
        const hrs = hoursOf(r);
        let m;
        if ((m = label.match(/complete (?:any )?(\w+) of the following/i))) {
          group = { type: 'choice', area, label: pendingLabel?.label || label, pick: { count: num(m[1]) ?? 1 }, credits: pendingLabel?.credits ?? hrs, options: [], text: label };
          items.push(group); pendingLabel = null; continue;
        }
        if ((m = label.match(/complete (?:a minimum of |at least )?(\w+) (?:credits?|credit hours?|hours?) (?:from|of) the following/i))) {
          const c = num(m[1]) ?? hrs;
          group = { type: 'choice', area, label: pendingLabel?.label || label, pick: { credits: c }, credits: c, options: [], text: label };
          items.push(group); pendingLabel = null; continue;
        }
        group = null;
        if (pendingLabel) { items.push({ type: 'placeholder', area, label: pendingLabel.label, credits: pendingLabel.credits }); pendingLabel = null; }
        if (/:$/.test(label)) {
          if (hrs) pendingLabel = { label: label.replace(/:$/, ''), credits: hrs };
          continue; // sub-header like "Distribution Courses:"
        }
        if (hrs) {
          const short = /^complete any/i.test(label) ? 'Elective' : label;
          items.push({ type: 'placeholder', area, label: short, credits: hrs, ...(short !== label ? { text: label } : {}) });
        }
        continue;
      }
      const codeCell = r.cells[0]?.html || '';
      const codes = codesIn(codeCell);
      if (!codes.length) continue;
      if (pendingLabel) { items.push({ type: 'placeholder', area, label: pendingLabel.label, credits: pendingLabel.credits }); pendingLabel = null; }
      const indented = /blockindent/.test(codeCell);
      const titleCell = r.cells[1]?.html || '';
      const inParen = text(titleCell).match(/\((\d+(?:\.\d+)?)(?:\s*-\s*(\d+))?\)\s*$/);
      const hrs = hoursOf(r) ?? (inParen ? +inParen[1] : null);
      if (group && indented) {
        const opt = codes.slice(); // "A & B" => both needed
        opt.credits = hrs;
        group.options.push(opt);
        continue;
      }
      group = null;
      if (codes.length > 1 && /&amp;|&/.test(codeCell)) {
        for (const c of codes) items.push({ type: 'course', area, code: c, alts: [], credits: null });
        continue;
      }
      items.push({ type: 'course', area, code: codes[0], alts: [], credits: hrs });
    }
  }
  if (pendingLabel) items.push({ type: 'placeholder', area, label: pendingLabel.label, credits: pendingLabel.credits });
  // arrays with extra props don't survive JSON; normalise options to objects
  for (const it of items) if (it.type === 'choice') it.options = it.options.map((o) => ({ codes: [...o], credits: o.credits ?? null, ...(o.alts ? { alts: o.alts } : {}) }));
  return { total, items };
}

// ---------- UVU sample graduation plan ----------
export function parseGradPlan(html) {
  const box = container(html, 'graduationplantextcontainer');
  const tbl = (box.match(/<table[^>]*class="sc_plangrid"[\s\S]*?<\/table>/) || [''])[0];
  const terms = [];
  let cur = null;
  for (const r of rows(tbl)) {
    if (/plangridterm/.test(r.cls)) { cur = { label: text(r.cells[0]?.html || ''), items: [] }; terms.push(cur); continue; }
    if (!cur || /plangridsum|plangridtotal|plangridyear/.test(r.cls)) continue;
    const comment = r.html.match(/<span class="comment">([\s\S]*?)<\/span>/);
    const codes = codesIn(r.cells[0]?.html || '');
    const hrs = hoursOf(r);
    if (codes.length) cur.items.push({ code: codes[0], ...(codes.length > 1 ? { alts: codes.slice(1) } : {}), credits: hrs });
    else if (comment) cur.items.push({ label: text(comment[1]), credits: hrs });
  }
  return terms;
}

// ---------- prerequisite expression parsing ----------
// Returns { expr, uncertain } where expr is null | "CODE" | { and: [...] } | { or: [...] }
export function parseReqExpr(raw) {
  // drop advice sentences ("CS 1030 recommended.", "Also, it is highly recommended ...")
  raw = raw.split(/(?<=\.)\s+/).filter((x) => !/recommend/i.test(x)).join(' ').replace(/\bAlso,[^.]*recommended[^.]*\.?/gi, ' ');
  raw = raw.replace(/\bOR\b/g, 'or').replace(/\bAND\b/g, 'and');
  // "X; or Y; or Z" => top-level alternatives
  if (/;\s*or\b/i.test(raw)) {
    const parts = raw.split(/;\s*or\b/i).map(parseReqExpr);
    const exprs = parts.map((p) => p.expr).filter(Boolean);
    const flat = exprs.flatMap((e) => (e && e.or ? e.or : [e]));
    return { expr: flat.length > 1 ? { or: flat } : flat[0] ?? null, uncertain: parts.some((p) => p.uncertain), nonCourse: parts.some((p) => p.nonCourse) };
  }
  let s = ' ' + raw + ' ';
  let uncertain = false;
  s = s.replace(/\bwith (?:a |an )?(?:minimum |min\.? )?grade of [A-F][+-]?(?: or (?:higher|better))?/gi, ' ')
       .replace(/\b(?:a )?(?:minimum |min\.? )?grade of [A-F][+-]?(?: or (?:higher|better))?/gi, ' ')
       .replace(/\bor (?:higher|better|above)\b/gi, ' ');
  const tokens = [];
  const re = /\(|\)|,|;|\band\b|\bor\b|\b([A-Z]{2,5}) (\d{4}[A-Z]{0,2})\b|[^(),;]+?(?=\(|\)|,|;|\band\b|\bor\b|\b[A-Z]{2,5} \d{4}|$)/g;
  let m;
  while ((m = re.exec(s))) {
    const t = m[0];
    if (!t.trim()) continue;
    if (m[1]) tokens.push({ k: 'code', v: `${m[1]} ${m[2]}` });
    else if (t === '(' || t === ')') tokens.push({ k: t });
    else if (t === ',' ) tokens.push({ k: ',' });
    else if (t === ';') tokens.push({ k: 'and' });
    else if (/^and$/i.test(t)) tokens.push({ k: 'and' });
    else if (/^or$/i.test(t)) tokens.push({ k: 'or' });
    else tokens.push({ k: 'text', v: t.trim() });
  }
  let nonCourse = tokens.some((t) => t.k === 'text' && /[a-z]/i.test(t.v) && !/^(both|either|all|one|of|the|following|completion|completed?|equivalent|and|courses?)$/i.test(t.v));
  let i = 0;
  function level() {
    const terms = [], seps = [];
    while (i < tokens.length) {
      const t = tokens[i];
      if (t.k === ')') { i++; break; }
      if (t.k === '(') { i++; const sub = level(); if (sub) terms.push(sub); continue; }
      if (t.k === 'code') { terms.push(t.v); i++; continue; }
      if (t.k === 'text') { terms.push(null); i++; continue; } // non-course condition
      seps.push({ k: t.k, at: terms.length }); i++;
    }
    return combine(terms, seps);
  }
  function combine(terms, seps) {
    // drop non-course terms; if a non-course term was joined by "or", the requirement is
    // waivable (e.g. "or instructor approval"); we keep the course side for planning.
    const kinds = new Set(seps.filter((x) => x.k !== ',').map((x) => x.k));
    let out;
    if (kinds.size === 2) {
      // "A or B and C": treat "and" as the weaker binding => (A or B) and C
      if (terms.filter(Boolean).length > 1) uncertain = true;
      const groups = [[]];
      const ordered = [];
      for (let k = 0; k < terms.length; k++) { ordered.push(terms[k]); const sp = seps.find((x) => x.at === k + 1); if (sp && k < terms.length - 1) ordered.push(sp.k); }
      for (const o of ordered) { if (o === 'and' || o === ',') groups.push([]); else if (o !== 'or') groups[groups.length - 1].push(o); }
      out = mk('and', groups.map((g) => mk('or', g)));
    } else if (kinds.has('or')) out = mk('or', terms);
    else out = mk('and', terms);
    return out;
  }
  function mk(op, arr) {
    const a = arr.filter((x) => x !== null && x !== undefined);
    const flat = [];
    for (const x of a) if (x && typeof x === 'object' && x[op]) flat.push(...x[op]); else flat.push(x);
    const uniq = [...new Map(flat.map((x) => [JSON.stringify(x), x])).values()];
    if (!uniq.length) return null;
    if (uniq.length === 1) return uniq[0];
    return { [op]: uniq };
  }
  const expr = level();
  return { expr, uncertain, nonCourse };
}

export function parseCourseXml(xml) {
  const html = decode((xml.match(/<!\[CDATA\[([\s\S]*?)\]\]>/) || [, ''])[1]);
  if (!html.trim()) return null;
  const title = text((html.match(/detail-title[^>]*>([\s\S]*?)<\/span>/) || [, ''])[1]).replace(/\.$/, '');
  const hrsT = text((html.match(/detail-hours_html[^>]*>([\s\S]*?)<\/span>/) || [, ''])[1]);
  const hm = hrsT.match(/(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?/);
  const extra = (html.match(/<div class="courseblockextra[^"]*">([\s\S]*?)<\/div>/) || [, ''])[1];
  const lines = extra.split(/<br\s*\/?>/i).map(text).filter(Boolean);
  const out = { title, credits: hm ? +hm[1] : null };
  if (hm && hm[2]) out.creditsMax = +hm[2];
  for (const ln of lines) {
    let m;
    if ((m = ln.match(/^Pre-? ?or Co-?requisites?(?:\(s\))?:\s*(.*)$/i))) {
      out.precoreqText = m[1];
      const p = parseReqExpr(m[1]); out.precoreqs = p.expr; if (p.uncertain) out.uncertain = true;
    } else if ((m = ln.match(/^Prerequisites?(?:\(s\))?:\s*(.*)$/i))) {
      // some lines carry both: "Prerequisite(s): X. Corequisite(s): Y"
      const [pre, co] = m[1].split(/\s*Co-?requisites?(?:\(s\))?:\s*/i);
      out.prereqText = pre;
      const p = parseReqExpr(pre); out.prereqs = p.expr; if (p.uncertain) out.uncertain = true; if (p.nonCourse) out.prereqNonCourse = true;
      if (co) { out.coreqText = co; out.coreqs = codesIn(co); }
    } else if ((m = ln.match(/^Co-?requisites?(?:\(s\))?:\s*(.*)$/i))) {
      out.coreqText = m[1]; out.coreqs = [...new Set(codesIn(m[1]))];
    }
  }
  return out;
}

// Choice groups whose only label is "Complete a minimum of six credits from the following:"
// borrow the name UVU's sample plan uses for them (e.g. "EE Elective" x2 = 6 credits).
export function nameChoices(items, gradPlan) {
  const known = new Set(items.filter((i) => i.type !== 'course').map((i) => i.label));
  const planLabels = {};
  for (const t of gradPlan) for (const x of t.items) if (x.label && !known.has(x.label)) planLabels[x.label] = (planLabels[x.label] || 0) + (x.credits || 0);
  for (const it of items) {
    if (it.type !== 'choice' || !/^complete /i.test(it.label)) continue;
    const hit = Object.entries(planLabels).find(([, c]) => c === it.credits);
    if (hit) { it.label = hit[0]; delete planLabels[hit[0]]; }
    else it.label = it.pick.credits ? `Choose ${it.pick.credits} credits` : `Choose ${it.pick.count}`;
  }
}

// ---------- fetching ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, cacheDir, key, delay) {
  if (cacheDir) {
    try { return await readFile(join(cacheDir, key), 'utf8'); } catch {}
  }
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      const body = await res.text();
      if (cacheDir) { await mkdir(cacheDir, { recursive: true }); await writeFile(join(cacheDir, key), body); }
      await sleep(delay);
      return body;
    } catch (e) { last = e; await sleep(delay * (attempt + 2)); }
  }
  throw last;
}

export async function fetchProgram(url, id, { cacheDir = null, delay = 400 } = {}) {
  const html = await get(url, cacheDir, `program-${id}.html`, delay);
  const name = text((html.match(/<h1[^>]*class="page-title"[^>]*>([\s\S]*?)<\/h1>/) || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [, id])[1]);
  const req = parseRequirements(html);
  const gradPlan = parseGradPlan(html);
  const codes = new Set();
  for (const it of req.items) {
    if (it.type === 'course') { codes.add(it.code); it.alts.forEach((c) => codes.add(c)); }
    if (it.type === 'choice') it.options.forEach((o) => { o.codes.forEach((c) => codes.add(c)); (o.alts || []).forEach((c) => codes.add(c)); });
  }
  for (const t of gradPlan) for (const x of t.items) if (x.code) { codes.add(x.code); (x.alts || []).forEach((c) => codes.add(c)); }
  const courses = {};
  const missing = [];
  for (const code of [...codes].sort()) {
    const xml = await get(`${CATALOG}/ribbit/?page=getcourse.rjs&code=${encodeURIComponent(code)}`, cacheDir, `course-${code.replace(/\s/g, '_')}.xml`, delay);
    const c = parseCourseXml(xml);
    if (c) courses[code] = c; else missing.push(code);
    process.stderr.write('.');
  }
  process.stderr.write('\n');
  // program-table credits win over catalog credits for required courses
  for (const it of req.items) if (it.type === 'course' && it.credits == null && courses[it.code]) it.credits = courses[it.code].credits;
  nameChoices(req.items, gradPlan);
  return {
    id, name, url, fetched: new Date().toISOString().slice(0, 10),
    totalCredits: req.total, requirements: req.items, gradPlan, courses,
    ...(missing.length ? { missingCourses: missing } : {}),
  };
}

// ---------- CLI ----------
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const cacheDir = opt('--cache');
  const delay = +(opt('--delay') ?? 400);
  const [url, id] = args;
  if (!url || !id) { console.error('Usage: node scripts/fetch-program.mjs <catalog-program-url> <id> [--cache dir] [--delay ms]'); process.exit(1); }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const prog = await fetchProgram(url, id, { cacheDir, delay });
  const out = join(root, 'data', 'programs', `${id}.json`);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(prog, null, 1) + '\n');
  const n = Object.keys(prog.courses).length;
  const unc = Object.entries(prog.courses).filter(([, c]) => c.uncertain).map(([k]) => k);
  console.log(`${prog.name}: ${prog.requirements.length} requirement rows, ${n} courses, ${prog.gradPlan.length} plan terms -> ${out}`);
  if (unc.length) console.log('Uncertain prereq logic:', unc.join(', '));
  if (prog.missingCourses) console.log('No catalog entry:', prog.missingCourses.join(', '));
}

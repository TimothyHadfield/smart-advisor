// Builds data/applications.json: for every program with a "how to apply" page (data/advisors.json
// admissionUrl), what kind of application that page uses, so the Matriculation sheet's "Fill my
// application" answer sheet knows what to show (js/application.js).
//
//   { checked, source, terms: { <banner term>: 'YYYY-MM-DD' first class day },
//     programs: { <id>: { url, status, kind, title?, link?, form?, minGpa?, minGrade?, weeksBefore?,
//                          deadlineText?, provisional?, pageCourses?, advisorByLetter?, mentorByLetter?,
//                          known?, fields?, rows?, rowNote? } } }
//
// kind (read from the page's HTML):
//   adobesign  a small start form (form[data-adobesign-ldid]: UVU's script makes an Adobe Acrobat Sign
//              agreement pre-filled with name + UVID, the student types the rest there and signs).
//              form = { name, inputs (visible input names), signers (hidden signer order) }
//   pdf        a PDF application on the page (link = the PDF)
//   qualtrics  a Qualtrics survey (link)
//   other      another online form or portal (link: Microsoft/Google Forms, an apply portal, CAS ...)
//   none       no application form or link found on the page (it explains the steps), or the page failed
// advisorByLetter / mentorByLetter: the page's own script picks the advisor / faculty mentor by the
// first letter of the last name (e.g. cet/ece/lib/js/ee-matriculation.js): [{ from, to, name }]. Names
// come from the e-mail ("Emmery.Leach@" -> "Emmery Leach"); a name the e-mail can't spell is null.
// No e-mail address is stored (public repo).
// known = the answer sheet's field order and course rows are the real form's (FORMS below, read off a
// filled-in form); otherwise the site shows "Typical fields" built from the catalog's matriculation list.
// terms: first class day of each term in data/sections (the most common section start date), for the
// "two weeks before a semester starts" deadline.
//
// Never posts anything: it only GETs public pages (UVU's PHP / Adobe endpoints are not called).
//   node scripts/build-applications.mjs            fetch every page (400 ms apart), write the file
//   node scripts/build-applications.mjs --terms    only refresh `terms` from data/sections (no network)
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data/applications.json');
const UA = { 'user-agent': 'Mozilla/5.0 (smart-advisor application check)' };

// The real form's student fields, in order (EE: read off a filled-in "Electrical Engineering
// Matriculation Form", Adobe Sign, page 1, 2026-10-23; pages 2+ are for the advisor, mentor and chair).
const EE_FIELDS = ['Last Name', 'First Name', 'Date', 'UVID', 'Email', 'Phone', 'Address', 'Cumulative GPA', 'Catalog Year', 'Advisor Name'];
export const FORMS = {
  'electrical-engineering-bs': {
    fields: EE_FIELDS,
    rows: ['MATH 1210', 'MATH 1220', 'PHYS 2210', 'PHYS 2215', 'PHYS 2220', 'PHYS 2225', 'ECE 1000', 'CS 1400', 'ECE 2250', 'ECE 2255', 'ECE 2700', 'ECE 2705'],
    columns: ['Completed Sem/YR', 'Grade', 'Transfer Course & Number', 'Transfer Institution'],
    rowNote: 'For in progress courses, enter the semester you are taking the course for Completed Sem/YR. Enter IP (in progress) for Grade.',
  },
};
// fields shown for a form nobody has read yet ("Typical fields — check against the real form")
export const TYPICAL_FIELDS = ['Last Name', 'First Name', 'Date', 'UVID', 'Email', 'Phone', 'Cumulative GPA', 'Catalog Year'];

const text = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ').trim();
// (tracking parameters dropped: _gl, _ga, utm_*)
const abs = (href, base) => {
  try {
    const u = new URL(href.replace(/&amp;/g, '&'), base);
    for (const k of [...u.searchParams.keys()]) if (/^(_g|utm_)/.test(k)) u.searchParams.delete(k);
    return u.href;
  } catch { return null; }
};
const links = (html, base) => [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
  .map((m) => ({ url: abs(m[1], base), text: text(m[2]) })).filter((l) => l.url && /^https?:/.test(l.url));
const CODE = /\b([A-Z]{2,4}) ?(\d{4})(?:\/(\d{4}))?\b/g;

// "Emmery.Leach@uvu.edu" -> "Emmery Leach"; "ArleneA@..." / "MMasoum@..." -> null (can't be spelled)
export function nameOfEmail(email) {
  const local = String(email || '').split('@')[0];
  if (!/^[A-Za-z]+\.[A-Za-z]+$/.test(local)) return null;
  return local.split('.').map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}
// the page script's "first_letter.match(/^[A-H]*$/)) { setAdvisor("x@y")" bands
export function lettersOf(js, fn) {
  const re = new RegExp(`match\\(\\s*/\\^\\[([A-Z])-([A-Z])\\]\\*\\$/\\s*\\)\\s*\\)\\s*\\{\\s*${fn}\\(\\s*"([^"]+)"`, 'g');
  return [...js.matchAll(re)].map((m) => ({ from: m[1], to: m[2], name: nameOfEmail(m[3]) }));
}

const samePage = (u) => u.split('#')[0].replace(/index.(html|php)$/, '');
// classify one page (pure, for tests): html + its url -> the record's page fields
export function classify(html, url) {
  const t = text(html);
  const out = { kind: 'none' };
  const title = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<title>([\s\S]*?)<\/title>/i))?.[1];
  if (title) out.title = text(title).replace(/\s*\|.*$/, '');
  const ls = links(html, url);
  const form = html.match(/<form\b[^>]*data-adobesign-ldid="[^"]*"[^>]*>([\s\S]*?)<\/form>/i);
  if (form) {
    const tag = form[0].slice(0, form[0].indexOf('>') + 1);
    const inputs = [...form[1].matchAll(/<input\b[^>]*>/gi)].map((m) => m[0]);
    const visible = inputs.filter((i) => !/type="hidden"/i.test(i)).map((i) => {
      const id = (i.match(/\bid="([^"]+)"/) || [])[1];
      const label = id && form[1].match(new RegExp(`<label[^>]*for="${id}"[^>]*>([\\s\\S]*?)</label>`, 'i'));
      return label ? text(label[1]).replace(/:$/, '') : (i.match(/\bname="([^"]+)"/) || [])[1];
    }).filter(Boolean);
    const signers = inputs.filter((i) => /data-adobesign-signer-order/i.test(i))
      .map((i) => ({ n: +(i.match(/data-adobesign-signer-order="(\d+)"/) || [])[1], role: ((i.match(/\bname="([^"]+)"/) || [])[1] || '').replace(/_Email$/, '').replace(/([a-z])([A-Z])/g, '$1 $2') }))
      .sort((a, b) => a.n - b.n).map((s) => s.role);
    out.kind = 'adobesign';
    out.form = { name: (tag.match(/data-adobesign-name="([^"]+)"/) || [])[1] || null, inputs: visible, signers, button: text((form[1].match(/<button[^>]*>([\s\S]*?)<\/button>/i) || [])[1] || '') || null };
  } else {
    const q = ls.find((l) => /^https:\/\/[\w.-]*qualtrics\./i.test(l.url));
    // (not the page itself, not a CMS "*** Broken link ***" placeholder)
    const elsewhere = ls.filter((l) => samePage(l.url) !== samePage(url) && !/\*\*\*|%20/.test(l.url) && !/uvu\.edu\/iss\//i.test(l.url));
    // an "Apply Now" / "Start Application" button to another site (e.g. a graduate apply portal)
    const button = elsewhere.find((l) => /^(apply now|apply online|start (?:your |the )?application|submit (?:an? |your )?application)$/i.test(l.text) && !/uvu\.edu\/(apply|admissions)\b/i.test(l.url));
    const pdf = ls.find((l) => /\.pdf(\?|#|$)/i.test(l.url) && /appl|matric|admission/i.test(l.text + ' ' + l.url) && !/template|resume|checklist/i.test(l.text + ' ' + l.url));
    const other = button && !/\.pdf(\?|#|$)/i.test(button.url) ? button : elsewhere.find((l) => /forms\.office\.com|forms\.gle|docs\.google\.com\/forms|jotform|formstack|cognitoforms|slate|\bcas\b|liaisoncas|apply\.|\/apply\b|acceptd|getacceptd|smartsheet/i.test(l.url)
      && /appl|submit|form|apply|matric/i.test(l.text + ' ' + l.url) && !/uvu\.edu\/(apply|admissions)\/?($|index)/i.test(l.url));
    if (q) { out.kind = 'qualtrics'; out.link = q.url; }
    else if (other && other === button) { out.kind = 'other'; out.link = other.url; }
    else if (pdf) { out.kind = 'pdf'; out.link = pdf.url; }
    else if (other) { out.kind = 'other'; out.link = other.url; }
  }
  const gpa = t.match(/(?:at least|minimum)(?: of)?(?: an?)? (\d\.\d{1,2})(?: cumulative| overall)? GPA/i) || t.match(/GPA (?:of )?(?:at least |minimum |of )?(\d\.\d{1,2})/i);
  if (gpa) out.minGpa = gpa[1];
  const grade = t.match(/\b(?:final )?grade of ([A-D][+-]?) or (?:higher|better)/i);
  if (grade) out.minGrade = grade[1].toUpperCase();
  // a deadline sentence only when it names a date or a rule ("March 16th", "two weeks prior to the start")
  const dl = t.split(/(?<=[.!?])\s+/).find((s) => /accepted until|deadline|due (?:by|on)|apply by|prior to the start/i.test(s) && s.length < 300 && !/scholarship/i.test(s)
    && /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b|(?:prior to|before) the start/i.test(s));
  if (dl) out.deadlineText = dl;
  const wk = t.match(/\b(two|three|one|four|\d) weeks? (?:prior to|before) the start/i);
  if (wk) out.weeksBefore = { one: 1, two: 2, three: 3, four: 4 }[wk[1].toLowerCase()] || +wk[1];
  if (/\bprovisional\b/i.test(t)) out.provisional = true;
  // the foundational / prerequisite courses the page lists ("PHYS 2210/2215" = both)
  // (from the first mention that has a course code soon after it, up to the GPA / advisor steps)
  let sect = '';
  for (const m of t.matchAll(/(?:foundational|prerequisite|pre-requisite|required) course/gi)) {
    const w = t.slice(m.index, m.index + 2500);
    if (/\b[A-Z]{2,4} ?\d{4}\b/.test(w.slice(0, 400))) { sect = w.split(/\bMaintain\b|\bMeet with\b/)[0]; break; }
  }
  const codes = [];
  for (const m of sect.matchAll(CODE)) { codes.push(`${m[1]} ${m[2]}`); if (m[3]) codes.push(`${m[1]} ${m[3]}`); }
  if (codes.length) out.pageCourses = [...new Set(codes)];
  return out;
}

// first class day of a term = the most common section start date in data/sections/<term>.json
export function termStarts(dir = join(ROOT, 'data/sections')) {
  const out = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((x) => /^\d{6}\.json$/.test(x)).sort()) {
    const d = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const n = new Map();
    for (const s of d.sections || []) if (s.sd) n.set(s.sd, (n.get(s.sd) || 0) + 1);
    const best = [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (best) out[f.slice(0, 6)] = best[0];
  }
  return out;
}

async function get(url) {
  try {
    const r = await fetch(url, { headers: UA });
    return { status: r.status, html: r.ok ? await r.text() : '' };
  } catch (e) { return { status: String(e.message || e), html: '' }; }
}
const wait = (ms) => new Promise((s) => setTimeout(s, ms));

async function build() {
  const adv = JSON.parse(readFileSync(join(ROOT, 'data/advisors.json'), 'utf8')).programs;
  const ids = Object.keys(adv).filter((id) => adv[id].admissionUrl).sort();
  const pages = new Map();
  for (const url of new Set(ids.map((id) => adv[id].admissionUrl))) {
    const { status, html } = await get(url);
    const rec = { status, ...(html ? classify(html, url) : { kind: 'none' }) };
    // the page's own scripts that pick the advisor / mentor by last name (e.g. lib/js/ee-matriculation.js)
    if (rec.kind === 'adobesign') {
      for (const src of [...html.matchAll(/<script[^>]*src="([^"]+)"/gi)].map((m) => abs(m[1], url)).filter((u) => u && /matric|applic|adobe|docusign/i.test(u) && !/_common\//.test(u))) {
        await wait(400);
        const js = (await get(src)).html;
        const a = lettersOf(js, 'setAdvisor'), m = lettersOf(js, 'setFacultyMentor');
        if (a.length) rec.advisorByLetter = a;
        if (m.length) rec.mentorByLetter = m;
      }
    }
    pages.set(url, rec);
    console.log(`${rec.kind.padEnd(9)} ${status} ${url}`);
    await wait(400);
  }
  const programs = {};
  for (const id of ids) {
    const url = adv[id].admissionUrl;
    const known = FORMS[id];
    programs[id] = { url, ...pages.get(url), ...(known ? { known: true, ...known } : {}) };
  }
  return programs;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const old = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
  const today = new Date().toISOString().slice(0, 10);
  const programs = process.argv.includes('--terms') && old ? old.programs : await build();
  const out = { checked: process.argv.includes('--terms') && old ? old.checked : today, source: Object.values(programs)[0]?.url || null, terms: termStarts(), fields: TYPICAL_FIELDS, programs };
  writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  const v = Object.values(programs);
  const by = (k) => v.filter((p) => p.kind === k).length;
  console.log(`${v.length} programs · known form ${v.filter((p) => p.known).length} · adobesign ${by('adobesign')} · pdf ${by('pdf')} · qualtrics ${by('qualtrics')} · other ${by('other')} · none ${by('none')} · terms ${Object.keys(out.terms).join(', ')}`);
}

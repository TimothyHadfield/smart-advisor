#!/usr/bin/env node
// Fetch one UVU catalog program (CourseLeaf) into data/programs/<id>.json.
// Usage: node scripts/fetch-program.mjs <catalog-program-url> <id> [--cache <dir>] [--delay <ms>]
// No dependencies. Polite: one request at a time with a delay between them.

import { writeFile, readFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nameChoices, linkPlan, fillCredits, spliceCore, admissionInfo, splitPlanPairs } from './lib/post.mjs';
export { nameChoices, linkPlan, fillCredits, spliceCore, admissionInfo, splitPlanPairs };

const CATALOG = 'https://catalog.uvu.edu';
const UA = 'SmartAdvisor/1.0 (student project; github.com/TimothyHadfield/smart-advisor)';

// ---------- small HTML helpers ----------
export function decode(s) {
  return s
    .replace(/&#160;|&nbsp;| /g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&rsquo;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}
export const text = (html) => decode(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
// Catalog typos that name a course that does not exist (each fix is logged in the program's `typos`).
// Codes the current catalog prints wrong. A code here is only fixed for a catalog year where it has no
// course entry (ENGH 1005 was a real course in 2025-2026): see checkTypos().
export const TYPOS = { 'ENGH 1005': 'ENGL 1005' };
let activeTypos = { ...TYPOS };
let typoLog = null; // set while one program is parsed
const fixCode = (c) => { if (activeTypos[c]) { typoLog?.add(`${c} -> ${activeTypos[c]}`); return activeTypos[c]; } return c; };
// Turn off each typo fix whose "wrong" code is a real course in this catalog year.
export async function checkTypos(opts) {
  activeTypos = {};
  for (const [bad, good] of Object.entries(TYPOS)) {
    let real = null;
    try { real = await fetchCourse(bad, { ...opts, store: null }); } catch {}
    if (!real) activeTypos[bad] = good;
  }
  return activeTypos;
}
// Codes in free text ("ENGL1010" too). A bare number right after a code keeps its subject
// ("DCPR 1010 & 1010L"); numbers followed by "level" are not codes ("any 3000 or 4000 level course").
export const codesIn = (html) => {
  const out = [];
  let subj = null;
  for (const m of text(html).matchAll(/\b(?:([A-Z]{2,5}) ?)?(\d{4}[A-Z]{0,2})\b(?![-\s]*level)/g)) {
    if (m[1]) subj = m[1];
    else if (!subj) continue;
    out.push(fixCode(`${subj} ${m[2]}`));
  }
  return out;
};
export const stripSup = (html) => html.replace(/<sup>[\s\S]*?<\/sup>/g, ' ');
const supText = (html) => [...html.matchAll(/<sup>([\s\S]*?)<\/sup>/g)].map((m) => text(m[1])).join(' ');
// Course codes of one cell, from its course links. Returns { groups: [required set, ...or-alternative sets], cross }.
// "A & B" (an & span) => both in one set; "<div class=blockindent>or C</div>" => an alternative set.
// A link reading just "1010L" takes the subject of the link before it; "BIOL/CHEM 3620" is BIOL 3620
// with CHEM 3620 as its cross-listed alias (cross["BIOL 3620"] = "CHEM 3620").
let crossLog = {}; // every cross-listed pair seen in the current parse
export function cellCodes(html) {
  html = stripSup(html);
  const parts = html.split(/<div[^>]*class="blockindent"[^>]*>\s*or\b/i);
  const cross = {};
  let subj = null;
  const groups = parts.map((p) => {
    const links = [...p.matchAll(/<a [^>]*class="[^"]*\bcode\b[^"]*"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => text(m[1]));
    if (!links.length) return codesIn(p);
    const out = [];
    for (const t of links) {
      let m;
      if ((m = t.match(/^([A-Z]{2,5})\/([A-Z]{2,5}) ?(\d{4}[A-Z]{0,2})$/))) { subj = m[1]; out.push(`${m[1]} ${m[3]}`); cross[`${m[1]} ${m[3]}`] = crossLog[`${m[1]} ${m[3]}`] = `${m[2]} ${m[3]}`; }
      else if ((m = t.match(/^([A-Z]{2,5}) ?(\d{4}[A-Z]{0,2})$/))) { subj = m[1]; out.push(fixCode(`${m[1]} ${m[2]}`)); }
      else if ((m = t.match(/^(\d{4}[A-Z]{0,2})$/)) && subj) out.push(`${subj} ${m[1]}`);
    }
    return out;
  }).filter((g) => g.length);
  return { groups, cross };
}
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, eighteen: 18, twenty: 20 };
const num = (w) => (/^\d+(?:\.0)?$/.test(w) ? Math.round(+w) : NUM[w.toLowerCase()] ?? null);
// "Repeated 4 times", "Must be taken 2 times", "Take twice", "taken twice", "Take a total of two semesters"
export function repeatsIn(s) {
  const m = s.match(/\b(?:repeated|taken?|must be taken|take a total of)\s+(\w+)\s+(?:times|semesters)\b/i) || s.match(/\b(?:taken?|repeated)\s+(twice)\b/i);
  if (!m) return null;
  const n = /^twice$/i.test(m[1]) ? 2 : num(m[1]);
  return n && n > 1 && n < 10 ? n : null;
}

// Tab container id by its visible tab label ("Requirements", "Graduation Plan"). Some pages use other ids
// (e.g. Dance BS: Requirements = newitemtextcontainer, Graduation Plan = requirementstextcontainer).
export function tabId(html, label, fallback) {
  for (const m of html.matchAll(/aria-controls="([a-z]+textcontainer)"[^>]*>([^<]*)</g)) if (text(m[2]).toLowerCase() === label.toLowerCase()) return m[1];
  return fallback;
}
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
// hours column: "3" -> {lo:3}, "1-4" -> {lo:1, hi:4}
const hoursRange = (row) => {
  const c = row.cells.find((c) => /hourscol/.test(c.attrs));
  if (!c) return null;
  const m = text(c.html).match(/(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?/);
  return m ? { lo: +m[1], ...(m[2] ? { hi: +m[2] } : {}) } : null;
};
const hoursOf = (row) => hoursRange(row)?.lo ?? null;
// option credits written in the title cell: "Film History I (3)", "Internship (1-8)", "Practical Design (2) ((1 credit taken twice))"
const titleCredits = (t) => {
  const m = t.match(/\((\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?(?:,[\d,\s]*)?\)(?:\s*\((?:[^()]|\([^()]*\))*\))*\s*$/);
  return m ? { lo: +m[1], ...(m[2] ? { hi: +m[2] } : {}) } : null;
};

// Free-text row kinds inside a course list
const INSTR = /^(?:complete|choose|select|take|also|pick|students (?:must|will) (?:complete|choose|select|take))\b/i;
const NOTE = /^(?:see|note|notes|please|students\b|must\b|these\b|this\b|if\b|for\b|it is|a grade|a minimum grade|minimum grade|grade|courses? (?:may|must|can|taken)|no more than one|only\b|strongly recommended|recommended|\*|\()/i;
const RULE = /\b(?:at most|no more than|a maximum of|maximum of|at least|a minimum of|minimum of|may not|cannot|can not|not both|only one)\b[^.]*\b(?:credits?|courses?|hours?|classes?|upper[- ]division|\d{4}|level)\b/i;
const OPEN = /\b(?:any|other)\b[^.]*(?:\d{4}|courses?|electives?|approved|classes?)|\bapproved\b|\d{4}\s*\+|\d{4}[- ]level|\bor (?:above|higher)\b/i;
const TRACKISH = /\btracks?\b|\bemphas[ie]s\b|\boptions?\b|\bsets\b|\bset of\b|\bdomains?\b|\bfocus\b|\bspeciali[sz]ations?\b|\bcategor(?:y|ies)\b|\bconcentrations?\b|\bpathways?\b/i;
const TRACK_NAME = /\btrack\b|\bfocus\b|\bdomain\b|\bemphasis\b|\bspeciali[sz]ation\b|\bcategory\b|\bconcentration\b|\bpathway\b|\boption\b/i;
const SHARED_LIST = /\belectives?\b|\blist\b/i;
const PREREQ_HEAD = /^(?:program )?prerequisites?(?: courses?)?\s*:?$/i;

// ---------- program requirements ----------
// One sc_courselist table -> { total, items, entry? }.
export function parseTable(tbl) {
  const items = [];
  const entry = []; // "Prerequisites:" rows (entry requirements listed on the page, not program courses)
  let total = null, areaSum = null, area = '', group = null, pendingLabel = null, section = null;
  let joinNext = false, inPrereq = false;
  const flushPending = () => {
    if (!pendingLabel) return;
    items.push({ type: 'placeholder', area, label: pendingLabel.label, credits: pendingLabel.credits, ...(pendingLabel.notes ? { notes: pendingLabel.notes } : {}), ...(pendingLabel.recommended ? { recommended: pendingLabel.recommended } : {}) });
    pendingLabel = null;
  };
  const endGroup = () => { group = null; section = null; joinNext = false; };
  const startSection = (name) => { section = name; (group.sectionList ||= []).includes(name) || group.sectionList.push(name); };
  const addOption = (codes, extra = {}) => {
    const opt = codes.slice(); // "A & B" => both needed
    Object.assign(opt, extra);
    if (section) opt.section = section;
    group.options.push(opt);
    return opt;
  };
  for (const r of rows(tbl)) {
    if (/\bhidden\b/.test(r.cls)) continue;
    if (/listsum/.test(r.cls)) { total = total ?? hoursOf(r); continue; }
    const c0raw = r.cells[0]?.html || '';
    const c0 = stripSup(c0raw);
    const linked = /<a [^>]*class="[^"]*\bcode\b/.test(c0);
    // a course code typed as plain text, no link ("DANC 2560G")
    const plainCode = !linked && r.cells.length > 1 && /^(?:or )?[A-Z]{2,5} ?\d{4}[A-Z]{0,2}(?:\s*(?:&|and)\s*(?:[A-Z]{2,5} ?)?\d{4}[A-Z]{0,2})*$/.test(text(c0));
    // A real course row links its code(s) in the first cell (class "bubblelink code").
    // Comment text may itself link codes ("please note: ART 1110 is required ..."), so a comment span wins.
    const courseRow = (linked || plainCode) && !/class="courselistcomment/.test(c0);
    const commentM = stripSup(r.html).match(/<span class="courselistcomment[^"]*">([\s\S]*?)<\/span>/);
    const comment = commentM ? commentM[1] : (!courseRow && r.cells.length && text(c0) ? c0 : null);
    const indented = /^\s*<div[^>]*class="blockindent"/.test(c0raw) || /^\s*<span[^>]*class="[^"]*commentindent/.test(c0raw);
    const hr = hoursRange(r);
    const hrs = hr?.lo ?? null;

    if (/areaheader/.test(r.cls)) {
      const t = text(stripSup(r.html));
      if (/^total credit hours\b/i.test(t)) { const m = t.match(/(\d+)/); if (m) total = total ?? +m[1]; continue; }
      const last = r.cells.length > 1 ? text(stripSup(r.cells[r.cells.length - 1].html)) : '';
      const ac = last.match(/^(\d+)(?:\s*-\s*\d+)?(?: Credits?| Credit Hours?)?$/i) || t.match(/(\d+)(?:\s*-\s*\d+)? Credits?\s*$/i);
      const name = text(stripSup(commentM ? commentM[1] : r.html)).replace(/\s*\d+(?:\s*-\s*\d+)?(?: Credits?| Credit Hours?)?$/i, '');
      // an indented area header inside a track list is one more track ("Option A | 21 Credits")
      if (indented && group) { startSection(name); continue; }
      // "Electives | 0 Credits" right after a track list: the shared list the tracks' "additional N credits" come from
      if (ac && +ac[1] === 0 && group && (group.sectionList || []).length) { startSection(name); continue; }
      if (ac) areaSum = (areaSum ?? 0) + +ac[1];
      flushPending(); endGroup(); inPrereq = false;
      area = name;
      continue;
    }
    if (/orclass/.test(r.cls)) {
      const alt = cellCodes(c0).groups.flat();
      if (inPrereq) { entry.push(...alt.map((c) => `or ${c}`)); continue; }
      const target = group && group.options.length ? group.options[group.options.length - 1] : items[items.length - 1];
      if (target) {
        if (target.type === 'course') target.alts.push(...alt);
        else if (Array.isArray(target)) target.alts = [...(target.alts || []), ...alt];
      }
      continue;
    }
    // comment rows (free text; may mention course codes, e.g. "Any CS 3000+ course") vs. real course rows
    if (comment != null && !courseRow) {
      const label = text(comment).replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
      const sup = supText(r.html);
      if (!label) continue;
      if (/^total (?:credit )?hours?:?$/i.test(label) && hrs) { total = total ?? hrs; continue; } // a plain "Total hours | 18" row
      if (PREREQ_HEAD.test(label) && !hrs) { flushPending(); endGroup(); inPrereq = true; continue; }
      if (inPrereq) {
        // the block ends at the next plain instruction that is not part of it ("Complete the following:")
        if (indented || /\b(?:one|either)\b/i.test(label)) { if (codesIn(comment).length) entry.push(label); continue; }
        inPrereq = false;
      }
      const instr = INSTR.test(label);
      // Inside a list, rows without credits are sub-headings ("CS Track", "Geography") or notes
      // ("Any other course approved by ..."). They never end the list; a non-indented course row does.
      if (group && (indented || !hrs)) {
        const inTracks = (group.sectionList || []).length > 0;
        // a plain "Complete the following:" (or a new "Complete one of the following:") at the top level
        // ends a list that has no tracks: the rows after it are a new requirement
        // (but right under a labelled credit row with no options yet, "Electives | 30" + "Choose any classes
        // from the following list or ...", it explains that row's list)
        const endsList = !indented && instr && !inTracks && group.options.length > 0;
        if (!endsList) {
          if (/^and$/i.test(label)) { joinNext = true; continue; }
          if (/^or$/i.test(label)) continue;
          (group.notes ||= []).push(section ? `${section}: ${label}` : label);
          // "Complete one of the following:" (no hours) + "MyEducator" / "Oral Proficiency Interview (OPI)":
          // passing the exam is one way through, so the list carries no credits of its own
          if (group.credits == null && indented && !codesIn(comment).length && /my ?educator|\bexam\b|\binterview\b|\bOPI\b/i.test(label)) { group.exam = label; continue; }
          // "Also complete 8 credits from the Pre-Engineering elective list", "Select an additional 11 credits of electives from the list below"
          const extra = label.match(/\b(?:also |an additional |additional )(?:complete |select |choose |take )?(?:an additional |additional )?(\w+) (?:credits?|credit hours?|hours?)\b[^.]*\b(?:from|of)\b/i) ||
            (inTracks && section && label.match(/^(?:complete|select|choose|take) (?:an additional |additional )(\w+) (?:credits?|credit hours?|hours?)\b/i));
          if (extra && num(extra[1]) && section) { (group.trackExtra ||= {})[section] = num(extra[1]); continue; }
          if (RULE.test(label) && !/grade/i.test(label)) { (group.rules ||= []).push(section ? `${section}: ${label}` : label); continue; }
          // free text naming whole courses: "(A and B) or C", "Choose 2 from: X or Y or Z"
          const named = codesIn(comment);
          if (named.length && !OPEN.test(label) && !/recommend|note|prerequisite|required for|must be|to receive|certificate/i.test(label)) {
            for (const part of label.replace(/[()]/g, ' ').split(/\bor\b/i)) { const cs = codesIn(part); if (cs.length) addOption(cs, { credits: null, fromText: true }); }
            continue;
          }
          if (OPEN.test(label)) { group.open = true; continue; }
          if (!indented && !instr && !NOTE.test(label) && !RULE.test(label)) { startSection(label.replace(/:$/, '').replace(/^-+\s*|\s*-+$/g, '').trim()); continue; }
          continue;
        }
      }
      // "Elective Requirements: | 47" followed by indented notes ("15 credits any course 3000 or higher")
      if (pendingLabel && indented && !hrs) { (pendingLabel.notes ||= []).push(label); continue; }
      if (!hrs && !instr) continue; // stray note / sub-heading ("Distribution Courses:")
      section = null;
      joinNext = false;
      let m;
      // "Complete the following:" (with or without hours): every row under it is required
      if (/^(?:complete|take) (?:all )?(?:of )?the following(?: courses?| requirements| \d+ credits?(?: hours?)?)?\s*:?\s*$/i.test(label)) { endGroup(); flushPending(); continue; }
      const labelCr = (label.match(/\((\d+) credit/i) || [])[1];
      if ((m = label.match(/(?:complete|choose|select|take) (?:any )?(\w+) (?:\(\d+\) )?(?:courses? |classes? )?(?:of|from)(?: the)? following/i) || label.match(/(?:complete|choose|select|take) (one|two|three) (?:domain|track|emphasis|option|set|area)/i)) && num(m[1])) {
        group = { type: 'choice', area, label: pendingLabel?.label || label, pick: { count: num(m[1]) }, credits: pendingLabel?.credits ?? hrs ?? (labelCr ? +labelCr : null), options: [], text: label };
        items.push(group); pendingLabel = null; continue;
      }
      if ((m = label.match(/(?:complete|choose|select|take) (?:a minimum of |at least |a total of |any )?([\w.]+) (?:\(\d+\) )?(?:credits?|credit hours?|hours?|semester credits?)\b/i)) && num(m[1])) {
        const c = num(m[1]) ?? hrs;
        group = { type: 'choice', area, label: pendingLabel?.label || label, pick: { credits: c }, credits: hrs ?? c, options: [], text: label, soft: true };
        items.push(group); pendingLabel = null; continue;
      }
      endGroup();
      flushPending();
      if (/:$/.test(label)) {
        if (hrs) pendingLabel = { label: label.replace(/:$/, ''), credits: hrs };
        continue; // sub-header like "Distribution Courses:"
      }
      if (hrs) {
        // a labelled credit row; if indented courses follow it becomes a choice list, else it stays a placeholder
        const short = /^complete any/i.test(label) ? 'Elective' : label;
        const rec = /recommend/i.test(label + ' ' + sup) ? codesIn(comment + ' ' + sup) : [];
        group = { type: 'choice', area, label: short, pick: { credits: hrs }, credits: hrs, options: [], ...(short !== label ? { text: label } : {}), soft: true, ...(rec.length ? { recommended: rec } : {}) };
        items.push(group);
      }
      continue;
    }
    const { groups: cg, cross } = cellCodes(c0);
    if (!cg.length) continue;
    const codes = cg[0];
    if (inPrereq) { entry.push(codes.join(' & ')); continue; }
    const inCellAlts = cg.slice(1).flat();
    const xalts = codes.map((c) => cross[c]).filter(Boolean);
    const title = text(stripSup(r.cells[1]?.html || ''));
    const tc = titleCredits(title);
    const lo = hr?.lo ?? tc?.lo ?? null;
    const hi = hr?.hi ?? (hr ? null : tc?.hi) ?? null;
    const rep = repeatsIn(title);
    const recommended = /\brecommended\b/i.test(title);
    const extra = { credits: lo, ...(hi ? { crMax: hi } : {}), ...(rep ? { repeat: rep } : {}), ...(recommended ? { recommended: true } : {}) };
    if (indented && !group && pendingLabel) {
      group = { type: 'choice', area, label: pendingLabel.label, pick: { credits: pendingLabel.credits }, credits: pendingLabel.credits, options: [], soft: true, fromLabel: true };
      items.push(group); pendingLabel = null;
    }
    if (group && (indented || joinNext)) {
      const last = group.options[group.options.length - 1];
      if (joinNext && last) { last.push(...codes); last.credits = last.credits != null && lo != null ? last.credits + lo : null; joinNext = false; continue; }
      const opt = addOption(codes, extra);
      if (inCellAlts.length || xalts.length) opt.alts = [...inCellAlts, ...xalts];
      continue;
    }
    flushPending();
    endGroup();
    if (codes.length > 1) {
      // "A & B | 4": both required; the row's hours cover the pair (split by catalog credits in fillCredits)
      codes.forEach((c, k) => items.push({ type: 'course', area, code: c, alts: k === 0 ? [...inCellAlts, ...xalts] : [], credits: null, ...(k === 0 && lo != null ? { pairHours: lo, pair: codes } : {}) }));
      continue;
    }
    items.push({ type: 'course', area, code: codes[0], alts: [...inCellAlts, ...xalts], ...extra });
    if (!extra.recommended) delete items[items.length - 1].recommended;
  }
  flushPending();
  const out = [];
  for (const it of items) {
    if (it.type !== 'choice') { out.push(it); continue; }
    finishChoice(it, out);
  }
  // no "Total Credit Hours" row: fall back to the area headers ("Political Science Requirements | 120 Credits")
  return { total: total ?? areaSum, ...(total == null && areaSum != null ? { totalFrom: 'area headers' } : {}), items: out, ...(entry.length ? { entry } : {}) };
}

// Clean up one choice group and push it (or what it turns into) to `out`.
function finishChoice(it, out) {
  // arrays with extra props don't survive JSON; normalise options to objects
  it.options = it.options.map((o) => ({
    codes: [...o], credits: o.credits ?? null,
    ...(o.crMax ? { crMax: o.crMax } : {}), ...(o.alts?.length ? { alts: o.alts } : {}), ...(o.section ? { section: o.section } : {}),
    ...(o.repeat ? { repeat: o.repeat } : {}), ...(o.recommended ? { recommended: true } : {}),
  }));
  const sectionList = it.sectionList || [];
  const trackExtra = it.trackExtra;
  const fromLabel = it.fromLabel;
  delete it.soft; delete it.sectionList; delete it.trackExtra; delete it.fromLabel;
  // A labelled distribution slot ("Biology Distribution | 3") listing only a recommended course
  // ("BIOL 1011 (Recommended)") is still a free choice: keep it a placeholder and note the advice.
  if (it.options.length && it.options.every((o) => o.recommended) && (fromLabel || it.pick.credits)) {
    const { type, pick, options, ...rest } = it;
    out.push({ type: 'placeholder', ...rest, recommended: options.flatMap((o) => o.codes) });
    return;
  }
  // "Choose one of the following Emphasis Tracks:" + sub-headings per track: the student picks a whole
  // track, not one course. The planner understands credit picks, so pick the group's credits from the
  // options and mark it; `section` on each option names its track. A shared list under the tracks
  // ("Pre-Engineering Elective List", "Electives") is not a track: its options get shared: true.
  const sections = sectionList.length ? sectionList : [...new Set(it.options.map((o) => o.section).filter(Boolean))];
  const isTrackName = (s) => TRACK_NAME.test(s) && !/^electives?$/i.test(s);
  const shared = sections.filter((s) => !isTrackName(s) && SHARED_LIST.test(s));
  const trackNames = sections.filter((s) => !shared.includes(s));
  const trackish = TRACKISH.test(it.label + ' ' + (it.text || '')) || trackNames.filter(isTrackName).length >= 2;
  if (trackish && trackNames.length >= 2) {
    it.tracks = trackNames;
    if (it.pick.count && it.credits) it.pick = { credits: it.credits, tracks: it.pick.count };
    else if (it.pick.credits && !it.pick.tracks && /\bone\b/i.test(it.label + ' ' + (it.text || ''))) it.pick = { ...it.pick, tracks: 1 };
    for (const o of it.options) if (shared.includes(o.section)) o.shared = true;
    if (trackExtra) it.trackElectives = trackExtra;
  }
  // "Complete one of the following: | 19" over a 1-credit list: the count can't be met; it's a credit pick
  const maxOpt = Math.max(0, ...it.options.map((o) => o.crMax ?? o.credits ?? 0));
  if (!it.tracks && it.pick.count && it.credits && maxOpt && it.credits > it.pick.count * maxOpt) it.pick = { credits: it.credits };
  // "Complete 4 credits of the following:" with one repeatable course: take it 4 times
  if (it.pick.credits && it.options.length === 1) {
    const o = it.options[0];
    if (/\d{4}R$/.test(o.codes[o.codes.length - 1]) && o.credits && o.credits < it.pick.credits && !o.crMax) o.repeat = Math.round(it.pick.credits / o.credits);
  }
  if (it.exam) it.credits = 0; // "My Educator" exam is one of the ways through; it carries no credits
  if (!it.options.length) {
    // "Complete one of the following:" with no credits, followed by a plain row "CS 1400 or STAT 2040":
    // the or-row already holds the choice, so the empty header is dropped.
    if (it.credits == null) return;
    // "Complete 9 credits from any ART/ARTH courses" with no list: a free-choice slot
    const { type, pick, options, open, ...rest } = it;
    out.push({ type: 'placeholder', ...rest });
    return;
  }
  out.push(it);
}

// Requirements tab -> { total, items, tables, merged, extra }. Emphasis pages put the shared core in a
// second table ("Complete the requirements | 30" in the first); that row is replaced by the second table.
export function parseRequirements(html) {
  const box = container(html, tabId(html, 'Requirements', 'requirementstextcontainer'));
  const tables = [];
  const re = /<table class="sc_courselist"[\s\S]*?<\/table>/g;
  let m, last = 0;
  while ((m = re.exec(box))) {
    const hs = [...box.slice(last, m.index).matchAll(/<h[2-6][^>]*>([\s\S]*?)<\/h[2-6]>/g)];
    tables.push({ heading: hs.length ? text(hs[hs.length - 1][1]) : '', ...parseTable(m[0]) });
    last = re.lastIndex;
  }
  if (!tables.length) return { total: null, items: [], tables: 0 };
  const [main, ...subs] = tables;
  const items = main.items.slice();
  let total = main.total;
  const extra = [];
  const entry = tables.flatMap((t) => t.entry || []);
  for (const sub of subs) {
    const at = items.findIndex((it) => it.type === 'placeholder' && it.credits === sub.total &&
      /requir|\bcore\b/i.test(it.label + ' ' + (it.text || ''))); // "Complete the requirements", "Complete core requirements", "requirments"
    const subItems = sub.items.map((it) => ({ ...it, area: sub.heading && !it.area.includes(sub.heading) ? `${sub.heading}: ${it.area}`.replace(/: $/, '') : it.area }));
    if (at >= 0) items.splice(at, 1, ...subItems);
    else extra.push({ heading: sub.heading, total: sub.total, items: subItems });
  }
  return { total, ...(main.totalFrom ? { totalFrom: main.totalFrom } : {}), items, tables: tables.length, ...(extra.length ? { extra } : {}), ...(entry.length ? { entry } : {}) };
}

// ---------- UVU sample graduation plan ----------
// Items: { code, alts?, credits } or { label, credits, alts?, options?, notes? }.
// "A & B | 5" in one cell keeps B in `with` (split into its own item by splitPlanPairs once course credits
// are known); "A or B" puts B in alts. Indented rows with no hours under a row ("Complete one of the
// following: | 3" then "MATH 1050", "MATH 1055") are that row's alternatives (alts + options), not items.
// A label cell that mentions a course ("Humanities (COMM 1020 recommended)", <sup>Recommend CYBR 1700</sup>)
// stays a label; the course goes to `recommended`.
export function parseGradPlan(html) {
  const box = container(html, tabId(html, 'Graduation Plan', 'graduationplantextcontainer'));
  const tbl = (box.match(/<table[^>]*class="sc_plangrid"[\s\S]*?<\/table>/) || [''])[0];
  const terms = [];
  let cur = null;
  for (const r of rows(tbl)) {
    if (/plangridterm/.test(r.cls)) { cur = { label: text(r.cells[0]?.html || ''), items: [] }; terms.push(cur); continue; }
    if (!cur || /plangridsum|plangridtotal|plangridyear/.test(r.cls)) continue;
    const c0raw = r.cells[0]?.html || '';
    const c0 = stripSup(c0raw);
    const comment = c0.match(/<span class="comment">([\s\S]*?)<\/span>/);
    const indented = /^\s*<div[^>]*class="blockindent"/.test(c0raw);
    const hrs = hoursOf(r);
    const prev = cur.items[cur.items.length - 1];
    const labelRow = comment || (/recommend/i.test(text(c0)) && !/^\s*<a /.test(c0));
    if (labelRow) {
      const label = text(comment ? comment[1] : c0).replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
      const rec = [...codesIn(comment ? comment[1] : c0), ...codesIn(supText(c0raw)).filter(() => /recommend/i.test(supText(c0raw)))];
      if (indented && hrs == null && prev) { (prev.notes ||= []).push(label); continue; }
      cur.items.push({ label, credits: hrs, ...(rec.length ? { recommended: [...new Set(rec)] } : {}) });
      continue;
    }
    const { groups } = cellCodes(c0);
    if (!groups.length) continue;
    const [req, ...alts] = groups;
    if (indented && hrs == null && prev) {
      // one alternative of the row above
      prev.alts = [...new Set([...(prev.alts || []), ...req, ...alts.flat()])];
      (prev.options ||= []).push(req);
      continue;
    }
    cur.items.push({ code: req[0], ...(req.length > 1 ? { with: req.slice(1) } : {}), ...(alts.length ? { alts: alts.flat() } : {}), credits: hrs });
  }
  return terms;
}

// ---------- prerequisite expression parsing ----------
// Returns { expr, uncertain } where expr is null | "CODE" | { and: [...] } | { or: [...] }
export function parseReqExpr(raw) {
  // drop advice sentences ("CS 1030 recommended.", "Also, it is highly recommended ...")
  raw = raw.split(/(?<=\.)\s+/).filter((x) => !/recommend/i.test(x)).join(' ').replace(/\bAlso,[^.]*recommended[^.]*\.?/gi, ' ');
  raw = raw.replace(/\bOR\b/g, 'or').replace(/\bAND\b/g, 'and');
  // "ENGL1010" -> "ENGL 1010"
  raw = raw.replace(/\b([A-Z]{2,5})(\d{4}[A-Z]{0,2})\b/g, '$1 $2');
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
    if (m[1]) tokens.push({ k: 'code', v: fixCode(`${m[1]} ${m[2]}`) });
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

// A course's own code inside its requirement: "or MUSC 1110" (an or-branch that is the course itself)
// is always met, so that whole or-group goes; a bare self-reference is dropped.
export function dropSelf(expr, self) {
  if (!expr) return null;
  if (typeof expr === 'string') return expr === self ? null : expr;
  if (expr.or) {
    if (expr.or.includes(self)) return null;
    const a = expr.or.map((x) => dropSelf(x, self)).filter(Boolean);
    return a.length === 0 ? null : a.length === 1 ? a[0] : { or: a };
  }
  const a = expr.and.map((x) => dropSelf(x, self)).filter(Boolean);
  return a.length === 0 ? null : a.length === 1 ? a[0] : { and: a };
}

export function parseCourseXml(xml, self = null) {
  const html = decode((xml.match(/<!\[CDATA\[([\s\S]*?)\]\]>/) || [, ''])[1]);
  if (!html.trim()) return null;
  self ??= (xml.match(/<course code="([^"]+)"/) || [, null])[1];
  const title = text((html.match(/detail-title[^>]*>([\s\S]*?)<\/span>/) || [, ''])[1]).replace(/\.$/, '');
  const hrsT = text((html.match(/detail-hours_html[^>]*>([\s\S]*?)<\/span>/) || [, ''])[1]);
  const hm = hrsT.match(/(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?/);
  const extra = (html.match(/<div class="courseblockextra[^"]*">([\s\S]*?)<\/div>/) || [, ''])[1];
  const lines = extra.split(/<br\s*\/?>/i).map(text).filter(Boolean);
  const out = { title, credits: hm ? +hm[1] : null };
  if (hm && hm[2]) out.creditsMax = +hm[2];
  const notSelf = (list) => [...new Set(list)].filter((c) => c !== self);
  for (const ln of lines) {
    let m;
    if ((m = ln.match(/^Pre-? ?or Co-?requisites?(?:\(s\))?:\s*(.*)$/i))) {
      out.precoreqText = m[1];
      const p = parseReqExpr(m[1]); out.precoreqs = dropSelf(p.expr, self); if (p.uncertain) out.uncertain = true;
      // the courses that must come before or with this one, at the top level ("BIOL 1615"); the planner can
      // bundle a pair that names each other (THEA 1513 <-> THEA 1514) instead of waiting forever
      const top = out.precoreqs == null ? [] : typeof out.precoreqs === 'string' ? [out.precoreqs] : (out.precoreqs.and || []).filter((x) => typeof x === 'string');
      if (top.length) out.preco = top;
    } else if ((m = ln.match(/^Prerequisites?(?:\(s\))?:\s*(.*)$/i))) {
      // some lines carry both: "Prerequisite(s): X. Corequisite(s): Y"
      const [pre, co] = m[1].split(/\s*Co-?requisites?(?:\(s\))?:\s*/i);
      out.prereqText = pre;
      const p = parseReqExpr(pre); out.prereqs = dropSelf(p.expr, self); if (p.uncertain) out.uncertain = true; if (p.nonCourse) out.prereqNonCourse = true;
      if (co) { out.coreqText = co; out.coreqs = notSelf(codesIn(co)); }
    } else if ((m = ln.match(/^Co-?requisites?(?:\(s\))?:\s*(.*)$/i))) {
      out.coreqText = m[1]; out.coreqs = notSelf(codesIn(m[1]));
    }
  }
  return out;
}

// ---------- fetching ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let OFFLINE = false;
export const setOffline = (v) => { OFFLINE = v; };
export async function get(url, cacheDir, key, delay) {
  if (cacheDir) {
    try { return await readFile(join(cacheDir, key), 'utf8'); } catch {}
  }
  if (OFFLINE) throw new Error(`offline: ${key} not in cache`);
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

// One course from the catalog's course API. `base` is the catalog root for a catalog year
// (archives live at /archives/<year>/ and have their own course API with that year's text).
// `store` (optional) is a shared { code: course|null } map so each course is fetched once.
export async function fetchCourse(code, { base = CATALOG, cacheDir = null, delay = 400, store = null } = {}) {
  if (store && code in store) return store[code];
  const key = `course-${code.replace(/\s/g, '_')}.xml`;
  let xml;
  try { xml = await get(`${base}/ribbit/?page=getcourse.rjs&code=${encodeURIComponent(code)}`, cacheDir, key, delay); }
  catch (e) {
    if (!OFFLINE || !cacheDir) throw e;
    // offline: a code the old parser never asked for may sit in another year's cache; else no entry
    for (const y of await readdir(dirname(cacheDir)).catch(() => [])) {
      try { xml = await readFile(join(dirname(cacheDir), y, key), 'utf8'); break; } catch {}
    }
    if (!xml) { if (store) store[code] = null; return null; }
  }
  const c = parseCourseXml(xml, code);
  if (store) store[code] = c;
  return c;
}

// Every course code a parsed program mentions (requirements + sample plan).
export function programCodes(items, gradPlan) {
  const codes = new Set();
  for (const it of items) {
    if (it.type === 'course') { codes.add(it.code); it.alts.forEach((c) => codes.add(c)); }
    if (it.type === 'choice') it.options.forEach((o) => { o.codes.forEach((c) => codes.add(c)); (o.alts || []).forEach((c) => codes.add(c)); });
  }
  for (const t of gradPlan) for (const x of t.items) {
    if (x.code) codes.add(x.code);
    (x.alts || []).forEach((c) => codes.add(c));
    (x.with || []).forEach((c) => codes.add(c));
  }
  return codes;
}

export function programName(html, fallback = '') {
  return text((html.match(/<h1[^>]*class="page-title"[^>]*>([\s\S]*?)<\/h1>/) || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [, fallback])[1]);
}

// Parse one program page into its JSON (courses fetched through `getCourse(code)`). Shared by
// fetch-program (one page) and fetch-all (every page). Returns { prog, req, missing, typos }.
export async function buildProgram(html, { id, name, url, catalogYear = null, getCourse }) {
  const typos = (typoLog = new Set());
  crossLog = {};
  const req = parseRequirements(html);
  const gradPlan = parseGradPlan(html);
  typoLog = null;
  const coreFrom = spliceCore(req.items, gradPlan);
  const codes = programCodes(req.items, gradPlan);
  const courses = {}, missing = [];
  for (const code of [...codes].sort()) {
    const c = await getCourse(code);
    if (c) courses[code] = c; else missing.push(code);
  }
  // a cross-listed code with no entry of its own ("BIOL/CHEM 3620") borrows its twin's entry
  for (const [a, b] of Object.entries(crossLog)) {
    if (!courses[a] && courses[b]) { courses[a] = { ...courses[b], code: a, crossListed: b }; missing.splice(missing.indexOf(a), 1); }
    if (!courses[b] && courses[a]) { courses[b] = { ...courses[a], code: b, crossListed: a }; if (missing.includes(b)) missing.splice(missing.indexOf(b), 1); }
  }
  fillCredits(req.items, courses);
  splitPlanPairs(gradPlan, courses);
  nameChoices(req.items, gradPlan, courses);
  linkPlan(req.items, gradPlan);
  const adm = admissionInfo(html, req.items, courses);
  const prog = {
    id, name: programName(html, name), url, ...(catalogYear ? { catalogYear } : {}), fetched: new Date().toISOString().slice(0, 10),
    totalCredits: req.total, requirements: req.items, gradPlan, courses,
    ...(missing.length ? { missingCourses: missing } : {}),
    ...(req.totalFrom ? { totalFrom: req.totalFrom } : {}),
    ...(req.extra ? { otherTables: req.extra } : {}),
    ...(req.entry ? { entryRequirements: req.entry } : {}),
    ...(coreFrom ? { coreFrom } : {}),
    ...(typos.size ? { typos: [...typos] } : {}),
    ...adm,
  };
  return { prog, req, missing, typos: [...typos] };
}

export async function fetchProgram(url, id, { cacheDir = null, delay = 400, base = CATALOG, store = null, html = null } = {}) {
  html = html ?? await get(url, cacheDir, `program-${id}.html`, delay);
  await checkTypos({ base, cacheDir, delay });
  const { prog } = await buildProgram(html, {
    id, name: id, url,
    getCourse: async (code) => {
      const fresh = !(store && code in store);
      const c = await fetchCourse(code, { base, cacheDir, delay, store });
      if (fresh) process.stderr.write('.');
      return c;
    },
  });
  return prog;
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

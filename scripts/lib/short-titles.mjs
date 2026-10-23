// Short class names for the flowchart boxes ("Calculus III" -> "Calc 3"). Pure, no DOM.
//   ruleShort(title, fits?) -> the rule-based short name: always-on abbreviations, then (only while the
//                              name still doesn't fit the box) stronger ones, one step at a time
//   fitsBox(text, opts?)   -> true when the text wraps into the box's 2 name lines without cutting a word
// Width is estimated from Helvetica's character widths (the font family of iPhone's San Francisco
// size class) times a safety factor, so the estimate errs wide; tests/short-titles.e2e.mjs measures the
// real box in WebKit.

// Helvetica widths per 1000 em, ASCII 32..126
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
// Helvetica-Bold, the same range (the requirement boxes' names are bold)
const HELV_B = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
export const BOX = { width: 89, fontPx: 12, lines: 2, safety: 1.05 };

export function textWidth(s, fontPx = BOX.fontPx, safety = BOX.safety, bold = false) {
  const t = bold ? HELV_B : HELV;
  let w = 0;
  for (const ch of s) { const c = ch.charCodeAt(0); w += c >= 32 && c <= 126 ? t[c - 32] : 600; }
  return (w / 1000) * fontPx * safety;
}
// greedy word wrap, like the browser: false when it needs more lines or a word alone is wider than a line
export function fitsBox(text, { width = BOX.width, fontPx = BOX.fontPx, lines = BOX.lines, safety = BOX.safety, bold = false } = {}) {
  const words = String(text).split(/\s+/).filter(Boolean);
  let n = 1, line = '';
  for (const w of words) {
    if (textWidth(w, fontPx, safety, bold) > width) return false;
    const next = line ? `${line} ${w}` : w;
    if (textWidth(next, fontPx, safety, bold) <= width) line = next;
    else { n++; line = w; }
  }
  return n <= lines;
}

const ROMAN = { I: '1', II: '2', III: '3', IV: '4', V: '5', VI: '6', VII: '7', VIII: '8' };
// [pattern, replacement]; applied in order, every title
const ALWAYS = [
  [/\s*--\s*/g, ': '],
  [/\s+/g, ' '],
  [/\bPhysics for Scientists (and|&) Engineers\b/gi, 'Phys'],
  [/\b(for|in) Scientists (and|&) Engineers\b/gi, ''],
  [/^(An |The )?Introduction to\b/i, 'Intro to'],
  [/\bIntroduction to\b/gi, 'Intro to'],
  [/\bIntroduction\b/gi, 'Intro'],
  [/\bIntroductory\b/gi, 'Intro'],
  [/^Principles (of|and Practices of|and Practice of) /i, ''],
  [/\bGeographic Information Systems?\b/gi, 'GIS'],
  [/\bPublic Relations (and|&) Strategic Communication\b/gi, 'PR'],
  [/\bPublic Relations\b/gi, 'PR'],
  [/\bArtificial Intelligence\b/gi, 'AI'],
  [/\bAmerican Sign Language\b/g, 'ASL'],
  [/\bC Plus Plus\b/gi, 'C++'],
  [/^Fundamentals of (.+)$/i, '$1 Basics'],
  [/\bFundamentals\b/g, 'Basics'],
  [/\bLecture Series\b/g, 'Lectures'],
  [/\bCapstone Project\b/g, 'Capstone'],
  [/\bDevelopment\b/g, 'Dev'],
  [/\bApplications?\b/g, 'Apps'],
  [/\s(and)\s/g, ' & '],
  [/\bElectrical (and|&) Computer Engineering\b/gi, 'ECE'],
  [/\bElectrical Engineering\b/gi, 'EE'],
  [/\bComputer Engineering\b/gi, 'CE'],
  [/\bMechanical Engineering\b/gi, 'ME'],
  [/\bComputer Science\b/gi, 'CS'],
  [/\bInformation Technology\b/gi, 'IT'],
  [/\bInformation Systems\b/gi, 'IS'],
  [/\bHuman Resources? Management\b/gi, 'HR Mgmt'],
  [/\bHuman Resources?\b/gi, 'HR'],
  [/\b(Human )?Anatomy (and|&) Physiology\b/gi, 'A&P'],
  [/\bPrecalculus\b/gi, 'Precalc'],
  [/\bCalculus\b/gi, 'Calc'],
  [/\bDifferential Equations\b/gi, 'Diff Eq'],
  [/\bMathematics\b/gi, 'Math'],
  [/\bMathematical\b/gi, 'Math'],
  [/\bStatistics\b/gi, 'Stats'],
  [/\bStatistical\b/gi, 'Stats'],
  [/\bPhysics\b/g, 'Phys'],
  [/\bBiochemistry\b/g, 'Biochem'],
  [/\bChemistry\b/g, 'Chem'],
  [/\bChemical\b/g, 'Chem'],
  [/\bMicrobiology\b/g, 'Microbio'],
  [/\bBiology\b/g, 'Bio'],
  [/\bBiological\b/g, 'Bio'],
  [/\bThermodynamics\b/g, 'Thermo'],
  [/\bLaboratory\b/gi, 'Lab'],
  [/\bAdvanced\b/g, 'Adv.'],
  [/\bManagement\b/g, 'Mgmt'],
  [/\bCommunications?\b/g, 'Comm'],
  [/\bTechnology\b/g, 'Tech'],
  [/\bTechnologies\b/g, 'Tech'],
  [/\bEngineering\b/g, 'Engr'],
  [/\bEconomics\b/g, 'Econ'],
  [/\bPsychology\b/g, 'Psych'],
  [/\bPsychological\b/g, 'Psych'],
  [/\bInternational\b/g, 'Intl'],
  [/\bInformation\b/g, 'Info'],
  [/\bAdministration\b/g, 'Admin'],
  [/\b(I|II|III|IV|V|VI|VII|VIII)\b(?!\.)/g, (m) => ROMAN[m]],
  [/\s+([,:;])/g, '$1'],
  [/\s+/g, ' '],
];
// stronger steps, one at a time, only while the name still doesn't fit
const NEEDED = [
  [/\s(and|&)\s/g, ' & '],
  [/:\s.*$/, ''],
  [/\s\([^)]*\)/g, ''],
  [/^(Survey of|Topics in|Studies in|Issues in) /i, ''],
  [/\bFundamentals\b/g, 'Fund.'],
  [/\bDevelopment\b/g, 'Dev.'],
  [/\bOrganizational\b/g, 'Org.'],
  [/\bOrganization\b/g, 'Org.'],
  [/\bEnvironmental\b/g, 'Env.'],
  [/\bProfessional\b/g, 'Prof.'],
  [/\bApplications?\b/g, 'Apps'],
  [/\bApplied\b/g, 'Appl.'],
  [/\bProgramming\b/g, 'Prog.'],
  [/\bLiterature\b/g, 'Lit'],
  [/\bComposition\b/g, 'Comp'],
  [/\bSociology\b/g, 'Soc'],
  [/\bPhilosophy\b/g, 'Phil'],
  [/\bIntermediate\b/g, 'Inter.'],
  [/\bElementary\b/g, 'Elem.'],
  [/\bEducation\b/g, 'Ed.'],
  [/\bEducational\b/g, 'Ed.'],
  [/\bMarketing\b/g, 'Mktg'],
  [/\bAccounting\b/g, 'Acctg'],
  [/\bGovernment\b/g, 'Govt'],
];

function applyAll(s, rules) { for (const [re, to] of rules) s = s.replace(re, to); return s.trim(); }

// ---------- requirement rows (Gen Ed / elective / "Complete one of the following:" boxes and plan rows) ----------
// They show in a placeholder box (.box.ph b: bold 12.5px, 2 lines, the narrowest box) and as one plan-list row
// (12px, one line, PLAN.width px of text at the narrowest plan column measured).
export const PLAN = { width: 150, fontPx: 12 };
export function fitsReq(s) {
  return !!s && fitsBox(s, { fontPx: 12.5, bold: true }) && textWidth(s, PLAN.fontPx) <= PLAN.width;
}
// a label that only says "pick from the list below": the app shows the requirement group's name instead
export const GENERIC_REQ = /^(?:please\s+)?(?:complete|choose|select|take|pick)\s+(?:one|two|three|four|1|2|3|4|\d+\s*(?:semester\s+)?(?:credits?|credit hours|hours)|an additional \d+ credits|at least one)?(?:\s+courses?)?\s*(?:of|from)?\s*(?:the\s+)?(?:following|list below|classes below)?(?:\s+(?:list|courses?|classes|electives?|options|series|methods courses|recommended elective courses))?(?:\s*:)?$/i;
const SUBJ_STOP = new Set(['GE', 'BS', 'BA', 'AS', 'AA', 'AAS', 'ONE', 'TWO', 'THE', 'OR', 'AND', 'US', 'TO', 'ALL', 'ANY', 'OF', 'BFA', 'MBA', 'GPA', 'PLEASE', 'NOTE', 'SECOND', 'FOUR', 'THREE', 'FIVE', 'SIX', 'CIVIC', 'GROWTH', 'SOCIAL', 'BEHAVIORAL', 'SCIENCE', 'HUMANITIES', 'FINE', 'ARTS', 'FOREIGN', 'LANGUAGE', 'PERSONAL', 'PROFESSIONAL']);
const GENED = [
  [/^personal,?\s*(?:professional,?\s*)?(?:(?:and|&|or)\s+)?(?:professional\s+|civic\s+)?growth\b/i, 'Personal & Civic Growth'],
  [/^(?:social|behavioral)\s*(?:\/|&|and|or)?\s*(?:behavio(?:u)?ral|social)?\s*sciences?(?:\s+(?:distribution|ge|elective|course))?$/i, 'Social Science'],
  [/^physical sciences?(?:\s+distribution)?$/i, 'Physical Science'],
  [/^(?:life sciences?|biological sciences?|biology)(?:\s+distribution)?$/i, 'Biology'],
  [/^american institutions?\b(?:\s*-?\s*(?:distribution|ge|general education|course|elec\.?|as))?$/i, 'American Institutions'],
  [/^humanities(?:\s+(?:distribution|elective|ge))?$/i, 'Humanities'],
  [/^fine arts(?:\s+distribution)?$/i, 'Fine Arts'],
  [/^quantitative (?:literacy|requirements?)(?:\s+(?:ge|requirement))?$/i, 'Quantitative Literacy'],
  [/^math(?:ematics)? (?:requirement|general education)$/i, 'Math'],
];
// -> the short label, '' for a generic "pick from the list" label, or null when no rule makes it fit
export function reqShort(label) {
  const raw = String(label || '').replace(/\s+/g, ' ').trim();
  let s = raw.replace(/\s*\*+\s*$/, '').replace(/\s*\((?:[^()]*|[^()]*\([^()]*\)[^()]*)\)?\s*/g, ' ').replace(/[\s:.,]+$/, '').replace(/\s+/g, ' ').trim();
  if (GENERIC_REQ.test(s) || GENERIC_REQ.test(raw)) return '';
  // "Choose 6 credits from the following courses in the College of Science": the group's name says it better
  if (/^(?:please\s+)?(?:choose|select|complete|compete|take|pick)\b[^.]*\b(?:following|list below|listed above|from list)\b/i.test(raw) && !/\b[A-Z]{2,5}\b(?!\s*\d)/.test(raw.replace(/\b(?:ONE|TWO|THREE|FOUR|OR|AND|GE)\b/g, ''))) return '';
  // "Weather - Complete one of the following", "Psychology Foundations-Complete 9 Credits": the name before it
  const head = s.split(/\s*(?:--|\s-\s|-(?=(?:complete|choose|select|take)\b)|\s–\s|:\s*|\.\s+)(?=(?:please\s+)?(?:complete|choose|select|take|pick|students|any)\b)/i)[0];
  if (head && head !== s && head.length >= 3) s = head;
  // "Any approved Humanities Distribution", "Complete one Fine Arts course": the Gen Ed area's name
  const area = s.replace(/^(?:complete one|any approved|any)\s+/i, '').replace(/\s+(?:distribution\s+)?(?:course|class)$/i, '').replace(/\s+distribution$/i, '');
  for (const [re, to] of GENED) if (re.test(s) || re.test(area)) return to;
  // "ART Upper Division" -> "Upper-div ART" (like "Complete 12 Credits of Upper Division ARTH")
  const lvl = /^([A-Z][A-Z/ ]{1,12}?) (upper|lower)[- ]division(?: electives?)?$/i.exec(s);
  if (lvl && /^[A-Z/ ]+$/.test(lvl[1])) return `${lvl[2][0].toUpperCase()}${lvl[2].slice(1).toLowerCase()}-div ${lvl[1]}`;
  // electives named by their subjects / level
  const upper = /\bupper[- ]?division\b|\b[3-4]000\b(?! level courses\))/i.test(raw) && !/\bupper or lower\b|\btotal of \d+ upper/i.test(raw) && !/\b1000 or (?:higher|above)\b/i.test(raw);
  const lower = /\blower[- ]?division\b/i.test(raw) && !/\bupper or lower\b/i.test(raw);
  const subj = [...new Set([...raw.matchAll(/\b[A-Z]{2,5}\b(?!\s*\d{4})/g)].map((m) => m[0]).filter((c) => !SUBJ_STOP.has(c)))];
  const elect = /\belectives?\b|\bcredits?\b|\bcourses?\b|\bclasses\b|\bhours\b|\bdivision\b/i.test(raw);
  if (raw.length > 22 && elect && subj.length && subj.length <= 2 && !/\b[A-Z]{2,5}\s+\d{4}/.test(raw)) {
    const t = upper ? `Upper-div ${subj.join('/')}` : lower ? `Lower-div ${subj.join('/')}` : `${subj.join('/')} elective`;
    if (fitsReq(t)) return t;
  }
  if (/^(?:any|all other|general electives?|select \d+ (?:elective )?credits? of any|students may complete any|successful completion|additional credits|take \w+ elective credits|open elective|complete \d+ (?:hours|credits) of (?:upper or lower division )?electives?|complete any (?:\d{4}|courses?))\b|\b(?:1000|2000)[- ]?(?:level)?,? (?:or (?:higher|above)|\+)|\b(?:1000|2000)\+|free elective/i.test(raw) && !subj.length && !/distribution|humanities|science|literature|anthropology|spanish|history/i.test(raw)) {
    return upper ? 'Upper-div elective' : lower ? 'Lower-div elective' : 'Free elective';
  }
  if (/^(?:complete|select|take) \d+ credits? of (?:upper|lower)[- ]division electives?$/i.test(s) || /^(?:upper|lower)[- ]division electives?(?: credits)?$/i.test(s)) return upper ? 'Upper-div elective' : 'Lower-div elective';
  if (fitsReq(s)) return s;
  // the class-title abbreviations, then the stronger steps
  let t = applyAll(s, ALWAYS).replace(/\s+(?:requirements?|distribution|courses?)$/i, '').trim();
  if (fitsReq(t)) return t;
  for (const [re, to] of NEEDED) { t = t.replace(re, to).replace(/\s+/g, ' ').trim(); if (fitsReq(t)) return t; }
  // the part before the first comma / dash
  const first = t.split(/\s*(?:,|\s-\s|\s–\s|;)\s*/)[0];
  if (fitsReq(first) && first.length >= 4 && !/^(?:complete|choose|select|take|any)\b/i.test(first)) return first;
  return null;
}

// -> { short, fits }: the always-on abbreviations, then stronger steps while it still doesn't fit; when
// even those don't make it fit, the always-on version (a hand name in scripts/short-titles-hand.json
// must cover it: tests/short-titles.test.mjs fails otherwise)
export function ruleShort(title, fits = fitsBox) {
  const base = applyAll(String(title || ''), ALWAYS);
  let s = base;
  for (const [re, to] of NEEDED) {
    if (fits(s)) break;
    s = s.replace(re, to).replace(/\s+/g, ' ').trim();
  }
  return fits(s) ? { short: s, fits: true } : { short: base, fits: false };
}

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
export const BOX = { width: 89, fontPx: 10, lines: 2, safety: 1.08 };

export function textWidth(s, fontPx = BOX.fontPx, safety = BOX.safety) {
  let w = 0;
  for (const ch of s) { const c = ch.charCodeAt(0); w += c >= 32 && c <= 126 ? HELV[c - 32] : 600; }
  return (w / 1000) * fontPx * safety;
}
// greedy word wrap, like the browser: false when it needs more lines or a word alone is wider than a line
export function fitsBox(text, { width = BOX.width, fontPx = BOX.fontPx, lines = BOX.lines, safety = BOX.safety } = {}) {
  const words = String(text).split(/\s+/).filter(Boolean);
  let n = 1, line = '';
  for (const w of words) {
    if (textWidth(w, fontPx, safety) > width) return false;
    const next = line ? `${line} ${w}` : w;
    if (textWidth(next, fontPx, safety) <= width) line = next;
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

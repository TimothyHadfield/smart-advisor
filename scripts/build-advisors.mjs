// Builds data/advisors.json: program id -> where a student books an advisor for that program.
//   { name, advisingUrl, scheduleUrl?, admissionUrl?, level: 'department' | 'college', source }
// advisingUrl = the department's advising page (lists that department's advisors, each with a
// "Schedule an appointment" button, usually split by last name), else the college's advising page.
// scheduleUrl = a booking link only where ONE link serves every student of the program (most UVU
// advisors are split by last name, so most programs have none; the advising page has the buttons).
// admissionUrl = the department's "how to apply / matriculate" page, gated programs only.
// Researched by hand 2026-10-19 from https://www.uvu.edu/advising/advisors/ and the college pages it links.
//   node scripts/build-advisors.mjs           write data/advisors.json
//   node scripts/build-advisors.mjs --check   also fetch every URL once (polite, 300 ms apart)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const U = (p) => `https://www.uvu.edu/${p}`;
const DIRECTORY = U('advising/advisors/');

// college advising pages (listed on the UVU advisor directory)
const COLLEGE = {
  'Smith College of Engineering and Technology': { name: 'Engineering & Technology advising', url: U('cet/advising/') },
  'College of Health and Public Service': { name: 'Health & Public Service advising', url: U('chps/advising/index.html') },
  'College of Humanities and Social Sciences': { name: 'Humanities & Social Sciences advising', url: U('chss/advising.html') },
  'College of Science': { name: 'College of Science advising', url: U('college-of-science/advising/index.html') },
  'School of the Arts': { name: 'School of the Arts advising', url: U('arts/advisors/') },
  'School of Education': { name: 'School of Education advising', url: U('school-of-ed/advising/') },
  'Woodbury School of Business': { name: 'Woodbury Business advising', url: U('woodbury/advising/advisors.html') },
};

// department -> its own advising page (level 'department'), or a college page (level 'college'),
// optionally at that department's section of the college page (#anchor)
const cet = (slug, name) => ({ name: `${name} advising`, url: U(`cet/advising/${slug}/index.html`), level: 'department', source: U('cet/advising/') });
const sci = (anchor, name) => ({ name: `College of Science advising (${name})`, url: U(`college-of-science/advising/index.html#${anchor}`), level: 'college', source: DIRECTORY });
const DEPT = {
  // Smith College of Engineering and Technology: one advising page per department
  'Applied Engineering and Transportation Technologies': cet('transportation-tech', 'Transportation Technologies'),
  'Architecture and Engineering Design': cet('architectural-engineering', 'Architecture & Engineering Design'),
  'Aviation Science': cet('aviation', 'Aviation Science'),
  'Computer Science': cet('computer-science', 'Computer Science'),
  'Construction Technologies': cet('construction-technologies', 'Construction Technologies'),
  'Culinary Arts Institute': cet('culinary-arts', 'Culinary Arts'),
  'Digital Media': cet('digital-media', 'Digital Media'),
  'Electrical and Computer Engineering': cet('ece', 'Electrical & Computer Engineering'),
  'Information Systems and Technology': cet('information-systems-tech', 'Information Systems & Technology'),
  'Mechanical and Civil Engineering': cet('mechanical-civil-engineering', 'Mechanical & Civil Engineering'),
  'Technology Management and Mechatronics': cet('technology-mgmt', 'Technology Management'),
  // College of Health and Public Service
  Nursing: { name: 'Nursing advising', url: U('nursing/advising.html'), level: 'department', source: U('nursing/') },
  // Humanities and Social Sciences: departments with their own advising page
  English: { name: 'English & Literature advising', url: U('english/advising.html'), level: 'department', source: U('english/') },
  Communication: { name: 'Communication advising', url: U('comm/advising.html'), level: 'department', source: U('comm/') },
  'History and Political Science': { name: 'History & Political Science advising', url: U('hps/advising.html'), level: 'department', source: U('hps/') },
  'Philosophy and Humanities': { name: 'Philosophy & Humanities advising', url: U('philhum/advising.html'), level: 'department', source: U('philhum/') },
  'Languages and Cultures': { name: 'Languages & Cultures advising', url: U('lang/advisors.html'), level: 'department', source: DIRECTORY },
  // College of Science: one page, a section per department
  Biology: sci('bio', 'Biology'),
  Chemistry: sci('chem', 'Chemistry'),
  'Earth Science': sci('earth', 'Earth Science'),
  'Exercise Science and Outdoor Recreation': sci('exercise', 'Exercise Science'),
  Mathematics: sci('math', 'Mathematics'),
  Physics: sci('physic', 'Physics'),
  // School of Education
  'Student Leadership and Success Studies': { name: 'Student Leadership & Success advising', url: U('slss/advising/advisors.html'), level: 'department', source: U('slss/') },
  // Woodbury School of Business: ROTC has its own contact page
  'Air Force and Army ROTC': { name: 'ROTC', url: U('rotc/contact.html'), level: 'department', source: U('rotc/') },
};

// program-specific pages that beat the department's (id pattern, first match wins)
const PROGRAM = [
  [/^dental-hygiene/, { name: 'Dental Hygiene advising', url: U('dental/advising.html'), level: 'department', source: U('dental/') }],
  [/^respiratory-therapy/, { name: 'Respiratory Therapy advising', url: U('respiratory/advising.html'), level: 'department', source: U('respiratory/') }],
  [/^clinical-mental-health-counseling/, { name: 'Clinical Mental Health Counseling', url: U('cmhc/index.html'), level: 'department', source: U('chss/advising.html') }],
  // the college's graduate-programs advisor
  [/^(applied-artificial-intelligence-ms|artificial-intelligence-graduate-certificate|cybersecurity-ms|cybersecurity-graduate-certificate|engineering-technology-management-ms|computer-science-mcs)$/,
    { name: 'Engineering & Technology graduate advising', url: U('cet/advising/graduate-programs/index.html'), level: 'college', source: U('cet/advising/') }],
];

// one booking link for every student of the program (UVU's Navigate / appointments pages)
const SCHEDULE = [
  // Woodbury graduate advisor: "MBA, MSF, & MACC"
  [/^(business-administration-mba|finance-ms|master-accountancy-macc)$/, 'https://appointments.uvu.edu/traceywilson'],
  // CHPS advising page: one advisor for all of Emergency Services (paramedic, fire recruit, administration)
  [/^(emergency-management(?!-and-homeland).*|firefighter-recruit.*|paramedic.*|homeland-security-minor|emergency-services.*)$/, 'https://uvu.campus.eab.com/pal/qdSKLrvMcU'],
  // one Forensic Science advisor
  [/^forensic-science/, 'https://uvu.campus.eab.com/pal/VYl0hz7Jfd'],
  // pre-OTA / pre-PTA advisor
  [/^(occupational-therapy-assistant|physical-therapist-assistant)/, 'https://uvu.campus.eab.com/pal/HW9tG5pwXG'],
];

// "how to apply / matriculate" pages (only used for programs that need admission)
const ADMISSION = [
  [/^electrical-engineering-bs$/, U('cet/ece/electrical-engineering/application.html')],
  [/^computer-engineering-bs$/, U('cet/ece/computer-engineering/application.html')],
  [/^mechanical-engineering-bs$/, U('cet/mce/mechanical-engineering/application.html')],
  [/^civil-engineering-bs$/, U('cet/mce/civil-engineering/application.html')],
  [/^architecture-barch$/, U('aed/architecture/admissions.html')],
  [/^computer-science-mcs$/, U('cet/master-of-computer-science/apply/index.html')],
  [/^nursing-(asn|bs)$/, U('nursing/asn_app_info.html')],
  [/^dental-hygiene/, U('dental/how_to_apply.html')],
  [/^respiratory-therapy/, U('respiratory/admissions.html')],
  [/^paramedic/, U('es/paramedic/admissions.html')],
  [/^firefighter-recruit/, U('es/rca/application.html')],
  [/^master-public-administration-mpa$/, U('mpa/application.html')],
  [/^social-work-bsw$/, U('besc/socialwork/')],
  [/^(msw|master-social-work-advanced-standing-msw)$/, U('besc/msw/admissions.html')],
  [/^(music-|collaborative-piano|piano-pedagogy)/, U('music/students/applications.html')],
  [/^dance-/, U('dance/students/application.php')],
  [/^theatre-/, U('theatre/students/applications.html')],
];
// Woodbury bachelor's degrees all matriculate the same way (one page, a section per major)
const WOODBURY_MATRIC = U('woodbury/advising/matriculationbymajor.html');

const first = (rules, id) => rules.find(([re]) => re.test(id))?.[1];

export function advisorFor(p, gated) {
  const college = COLLEGE[p.college] || COLLEGE['Woodbury School of Business'];
  const base = first(PROGRAM, p.id) || DEPT[p.department]
    || { name: college.name, url: college.url, level: 'college', source: DIRECTORY };
  const out = { name: base.name, advisingUrl: base.url };
  const sch = first(SCHEDULE, p.id);
  if (sch) out.scheduleUrl = sch;
  let adm = first(ADMISSION, p.id);
  if (!adm && p.college === 'Woodbury School of Business' && p.level !== 'graduate' && /^(BS|BA)$/.test(p.type)) adm = WOODBURY_MATRIC;
  if (adm && gated) out.admissionUrl = adm;
  out.level = base.level;
  out.source = base.source;
  return out;
}

// a program "needs admission" when its page has an admission section or a gate (any catalog year)
function gatedIds() {
  const ids = new Set();
  for (const dir of ['data/programs', 'data/2025-2026/programs']) {
    const year = JSON.parse(readFileSync(join(ROOT, dir, '_year.json'), 'utf8'));
    for (const p of year.programs) {
      try {
        const f = JSON.parse(readFileSync(join(ROOT, dir, p.file), 'utf8'));
        if (f.admission || f.admissionInfo?.gated || Object.values(f.courses || {}).some((c) => c.gate === 'admission')) ids.add(p.id);
      } catch { /* missing file: not gated */ }
    }
  }
  return ids;
}

export function build() {
  const index = JSON.parse(readFileSync(join(ROOT, 'data/programs/index.json'), 'utf8'));
  const gated = gatedIds();
  const out = {};
  for (const p of [...index.programs].sort((a, b) => a.id.localeCompare(b.id))) out[p.id] = advisorFor(p, gated.has(p.id));
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = build();
  writeFileSync(join(ROOT, 'data/advisors.json'), JSON.stringify({ generated: new Date().toISOString().slice(0, 10), source: DIRECTORY, programs: out }, null, 1) + '\n');
  const vals = Object.values(out);
  console.log(`${vals.length} programs · department ${vals.filter((v) => v.level === 'department').length} · college ${vals.filter((v) => v.level === 'college').length} · schedule ${vals.filter((v) => v.scheduleUrl).length} · admission ${vals.filter((v) => v.admissionUrl).length}`);
  if (process.argv.includes('--check')) {
    const urls = [...new Set(vals.flatMap((v) => [v.advisingUrl, v.scheduleUrl, v.admissionUrl]).filter(Boolean).map((u) => u.split('#')[0]))];
    let bad = 0;
    for (const u of urls) {
      const r = await fetch(u, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (smart-advisor link check)' } }).catch((e) => ({ status: String(e) }));
      const loc = r.headers?.get?.('location') || '';
      const ok = r.status === 200 || (r.status >= 300 && r.status < 400 && /^https:\/\/[\w.-]*(uvu\.edu|eab\.com)\//.test(loc));
      if (!ok) bad++;
      console.log(`${ok ? 'ok ' : 'BAD'} ${r.status} ${u}${loc ? ' -> ' + loc : ''}`);
      await new Promise((s) => setTimeout(s, 300));
    }
    console.log(`${urls.length} URLs, ${bad} bad`);
    if (bad) process.exitCode = 1;
  }
}

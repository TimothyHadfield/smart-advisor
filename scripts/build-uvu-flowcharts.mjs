// Builds data/uvu-flowcharts.json: program id -> UVU's own flowchart / degree map for that program, per
// catalog year, as published by the department (the site links to it; nothing is re-hosted).
//   { programs: { <id>: [{ year: '2026-2027' | null, kind: 'flowchart' | 'degree map', url, title, source }] } }
// year = the catalog year printed on the document or its department link (null when neither says one).
// A program whose department splits it into one flowchart per track (no single chart) links the
// department page that lists them (url = that page, `page: true`; shown as "flowcharts").
//
// Found by hand 2026-10-22: a polite crawl (250 ms apart) of every college and department site
// (uvu.edu/cet, /cs, /ct, /aed, /aviation, /culinary, /digitalmedia, /ist, /tm, /college-of-science,
// /chss + departments, /chps + departments, /arts + departments, /woodbury, /school-of-ed), keeping
// links whose text or file name says flowchart / flow chart / degree map. Web search found none.
// Not included (not a flowchart or degree map): "4 year plan", "advising sheet", "course sequence",
// "advisement sequence", "program sheet" PDFs; the 2026-27 Web Design B.S. chart (a JPG with staff names).
//   node scripts/build-uvu-flowcharts.mjs           write data/uvu-flowcharts.json
//   node scripts/build-uvu-flowcharts.mjs --check   also fetch each source page (link still there) and
//                                                   each PDF (200, application/pdf), 300 ms apart
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const U = (p) => `https://www.uvu.edu/${p}`;
const Y26 = '2026-2027', Y25 = '2025-2026';
const fc = (year, path, title, source) => ({ year, kind: 'flowchart', url: U(path), title, source: U(source) });
const dm = (year, path, title, source) => ({ year, kind: 'degree map', url: U(path), title, source: U(source) });
const tracks = (year, source, title) => ({ year, kind: 'flowchart', url: U(source), title, source: U(source), page: true });

const EE = 'cet/ece/electrical-engineering/', CE = 'cet/ece/computer-engineering/';
const CIV = 'cet/mce/civil-engineering/', ME = 'cet/mce/mechanical-engineering/';
const AUD = 'digitalmedia/audio/', CIN = 'digitalmedia/cinema/', WDD = 'digitalmedia/web-design-dev/', GAD = 'digitalmedia/game-animation-dev/';
const audioAll = fc(Y25, 'digitalmedia/audio/docs/flowcharts-2025-2026/audio-all-flowcharts-25-26.pdf', '2025-2026 All Audio Flowcharts', AUD);
const aud26 = (file, title) => fc(Y26, `digitalmedia/audio/docs/flowcharts-2026-2027/${file}`, title, AUD);

export const CHARTS = {
  // Smith College of Engineering and Technology: Electrical & Computer Engineering
  'electrical-engineering-bs': [
    fc(Y26, 'cet/ece/docs/electrical/ee_flowchart_2026-2027-4-29.pdf', 'B.S. Electrical Engineering 2026-2027 Flow Chart', EE),
    fc(Y25, 'cet/ece/docs/electrical/ee_flowchart_2025-2026.pdf', 'BS Electrical Engineering 2025-2026 Flow Chart', EE),
  ],
  'computer-engineering-bs': [
    fc(Y26, 'cet/ece/docs/computer/ce_flowchart_2026.pdf', 'B.S. Computer Engineering 2026-2027 Flow Chart', CE),
    fc(Y25, 'cet/ece/docs/computer/ce_flowchart_2025-2026.pdf', 'B.S. Computer Engineering 2025-2026 Flow Chart', CE),
  ],
  // Mechanical & Civil Engineering
  'civil-engineering-bs': [
    fc(Y26, 'cet/mce/docs/civil/cive_flowchart_2026-2027.pdf', 'BS Civil Engineering 2026-2027 Flow Chart', CIV),
    fc(Y25, 'cet/mce/docs/civil/cive_flowchart_2025-2026.pdf', 'BS Civil Engineering 2025-2026 Flow Chart', CIV),
  ],
  'mechanical-engineering-bs': [
    fc(Y26, 'cet/mce/docs/mechanical/me_flowchart_2026-27.pdf', 'BS Mechanical Engineering 2026-2027 Flow Chart', ME),
    fc(Y25, 'cet/mce/docs/mechanical/me_flowchart_2025-26.pdf', 'BS Mechanical Engineering 2025-2026 Flow Chart', ME),
  ],
  // Computer Science ("Degree Flow Chart (2026-2027)")
  'computational-data-science-bs': [fc(Y26, 'cs/docs/data-science/cds2026.pdf', 'Data Science Degree Flow Chart (2026-2027)', 'cs/data-science/')],
  'software-development-bas': [fc(Y26, 'cs/docs/software-development/sd.pdf', 'Software Development Degree Flow Chart (2026-2027)', 'cs/software-development/')],
  'software-engineering-bs': [fc(Y26, 'cs/docs/software-engineering/se.pdf', 'Software Engineering Degree Flow Chart (2026-2027)', 'cs/software-engineering/')],
  // Construction Technologies
  'construction-management-bs': [fc(Y26, 'ct/cm/docs/cmgtflowchartfy27.pdf', 'Construction Management Degree Flowchart 2026-2027', 'ct/cm/')],
  // Digital Media
  'digital-audio-aas': [aud26('audio-aas-flowchart-26-27_accessible.pdf', 'Digital Audio A.A.S. (2026-2027)'), audioAll],
  'digital-audio-bs': [tracks(Y26, AUD, 'B.S. Audio Engineering / Game Sound / Sound Design Track flowcharts (2026-2027)'), audioAll],
  'audio-assistant-undergraduate-certificate': [aud26('assistant-audio-certificate-flowchart-26-27_accessible.pdf', 'Assistant Audio Certificate (2026-2027)')],
  'audio-engineering-undergraduate-certificate': [aud26('engineering-certificate-flowchart-26-27_accessible.pdf', 'Audio Engineering Certificate (2026-2027)')],
  'game-sound-undergraduate-certificate': [aud26('game-sound-certificate-flowchart-26-27_accessible.pdf', 'Game Sound Certificate (2026-2027)')],
  'sound-design-undergraduate-certificate': [aud26('sound-design-certificate-flowchart-26-27_accessible.pdf', 'Sound Design Certificate (2026-2027)')],
  'assistant-audio-certificate-of-prof': [audioAll],
  'audio-engineering-certificate-of-prof': [audioAll],
  'game-sound-certificate-of-prof': [audioAll],
  'sound-design-certificate-of-prof': [audioAll],
  'digital-cinema-production-bs': [
    fc(Y26, 'digitalmedia/cinema/docs/flowcharts-2026-2027/cinema-general-bs-flowchart-26-27_accessible.pdf', 'Digital Cinema Production B.S. (2026-2027)', CIN),
    fc(Y25, 'digitalmedia/cinema/docs/flowcharts-2025-2026/cinema-all-flowcharts-25-26.pdf', '2025-2026 All Cinema Flowcharts', CIN),
  ],
  'digital-cinema-production-aas': [fc(Y25, 'digitalmedia/cinema/docs/flowcharts-2025-2026/digital-cinema-aas-flowchart-25-26-accessible.pdf', 'Digital Cinema Production A.A.S. (2025-2026)', CIN)],
  'web-design-development-interaction-user-experience-emphasis-bs': [fc(Y25, 'digitalmedia/web-design-dev/docs/flowcharts-2025-2026/web-id-bs-flowchart-25-26-accessible.pdf', 'B.S., Interaction Design Emphasis (2025-2026)', WDD)],
  'web-design-development-web-app-development-emphasis-bs': [fc(Y25, 'digitalmedia/web-design-dev/docs/flowcharts-2025-2026/web-app-dev-bs-flowchart-25-26-accessible.pdf', 'B.S., Web & App Development Emphasis (2025-26)', WDD)],
  'web-design-development-aas': [fc(Y25, 'digitalmedia/web-design-dev/docs/flowcharts-2025-2026/web-design-dev-aas-flowchart-25-26-accessible.pdf', 'Web Design & Development A.A.S. (2025-2026)', WDD)],
  'animation-game-development-bs': [tracks(Y26, GAD, '2D Animation / 3D Animation & Visual Effects / Game Development flowcharts (2026-2027)')],
  // degree maps (semester-by-semester sample plans the department publishes)
  'culinary-arts-aas': [dm(Y25, 'culinary/docs/degree_map_2026.pdf', 'Culinary Arts A.A.S Degree Map (2025-26)', 'culinary/degrees/')],
  'surveying-technology-aas': [dm(Y26, 'aed/surveying/docs/2026-27_aas_gradplan_surveytech_pt_a.pdf', 'AAS Surveying Technology Part-Time Degree Map 2026-2027', 'aed/surveying/')],
  'surveying-technology-undergraduate-certificate': [dm(Y26, 'aed/surveying/docs/2026-27_cert_gradplan_surveytech.pdf', 'Certificate in Surveying Technology Graduation Map 2026-2027', 'aed/surveying/')],
  'dental-hygiene-aas': [dm(null, 'dental/docs/aas-dental-hygiene-map.pdf', 'Dental Hygiene, A.A.S. Degree Map', 'dental/degrees_and_programs.html')],
  'dental-hygiene-bs': [dm(null, 'dental/docs/bs-dental-hygiene-map.pdf', 'Dental Hygiene, B.S. Degree Map', 'dental/degrees_and_programs.html')],
  'nursing-asn': [dm(null, 'nursing/docs/asn_degree_map_2025.pdf', 'ASN Degree Map', 'nursing/degrees/asn.html')],
  'nursing-bs': [dm(null, 'nursing/docs/bsn_degree_map_2025.pdf', 'BSN Degree Map', 'nursing/degrees/bsn.html')],
  'respiratory-therapy-aas': [dm(null, 'respiratory/docs/aas-resp-therapy2026.pdf', 'Respiratory Therapy A.A.S. Degree Map', 'respiratory/degrees_and_programs.html')],
  'respiratory-therapy-bs': [dm(null, 'respiratory/docs/bs-resp-therapy2026.pdf', 'Respiratory Therapy B.S. Degree Map', 'respiratory/degrees_and_programs.html')],
};

async function check() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pages = new Map();
  let bad = 0, n = 0;
  for (const [id, list] of Object.entries(CHARTS)) {
    for (const c of list) {
      if (!pages.has(c.source)) { const r = await fetch(c.source); pages.set(c.source, r.ok ? await r.text() : ''); await sleep(300); }
      const html = pages.get(c.source);
      const path = new URL(c.url).pathname;
      const linked = c.page ? !!html : html.includes(path);
      let ok = linked;
      if (!c.page) {
        const r = await fetch(c.url, { method: 'HEAD' });
        ok = ok && r.ok && /pdf/.test(r.headers.get('content-type') || '');
        await sleep(300);
      }
      n++;
      if (!ok) { bad++; console.log('BAD', id, c.url, linked ? '' : '(no longer linked from source page)'); }
    }
  }
  console.log(`${n} links checked, ${bad} bad`);
  return bad;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = { source: 'UVU department pages (see scripts/build-uvu-flowcharts.mjs)', checked: new Date().toISOString().slice(0, 10), programs: CHARTS };
  writeFileSync(join(ROOT, 'data/uvu-flowcharts.json'), JSON.stringify(out, null, 1) + '\n');
  console.log('programs', Object.keys(CHARTS).length);
  if (process.argv.includes('--check')) process.exitCode = (await check()) ? 1 : 0;
}

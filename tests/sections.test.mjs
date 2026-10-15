// Run: node tests/sections.test.mjs
// Banner row → compact section row. Fixture = 8 real rows from UVU Banner searchResults, Spring 2027 (202720),
// fetched 2026-10-15, trimmed of Banner internals ("class", "id", "bannerId"). No student data exists in this source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compactSection, dayLetters, isoDate, modeOf, primaryInstructor, upcomingTerms } from '../scripts/lib/banner.mjs';

const ROWS = [
  {"term":"202720","termDesc":"2027 Spring","courseReferenceNumber":"14874","partOfTerm":"1","courseNumber":"2250","courseDisplay":"2250","subject":"ECE","subjectDescription":"Electrical Comp Engineering","sequenceNumber":"001","campusDescription":"Main Campus","scheduleTypeDescription":"Face to Face","courseTitle":"Circuit Theory","creditHours":null,"maximumEnrollment":30,"enrollment":0,"seatsAvailable":30,"waitCapacity":25,"waitCount":0,"waitAvailable":25,"crossList":null,"crossListCapacity":null,"crossListCount":null,"crossListAvailable":null,"creditHourHigh":null,"creditHourLow":3,"creditHourIndicator":null,"openSection":true,"linkIdentifier":null,"isSectionLinked":false,"subjectCourse":"ECE2250","faculty":[{"category":null,"courseReferenceNumber":"14874","displayName":"Manzak, Ali","emailAddress":"AManzak@uvu.edu","primaryIndicator":true,"term":"202720"}],"meetingsFaculty":[{"category":"01","courseReferenceNumber":"14874","faculty":[],"meetingTime":{"beginTime":"0830","building":"SE","buildingDescription":"Smith Engineering Building","campus":"M","campusDescription":"Main Campus","category":"01","courseReferenceNumber":"14874","creditHourSession":3,"endDate":"05/05/2027","endTime":"0945","friday":false,"hoursWeek":2.5,"meetingScheduleType":"F","meetingType":"CLAS","meetingTypeDescription":"Class","monday":false,"room":"320","saturday":false,"startDate":"01/11/2027","sunday":false,"term":"202720","thursday":true,"tuesday":true,"wednesday":false},"term":"202720"}],"sectionAttributes":null,"instructionalMethod":"LEC","instructionalMethodDescription":"Regular Class without Lab"},
  {"term":"202720","termDesc":"2027 Spring","courseReferenceNumber":"12535","partOfTerm":"1","courseNumber":"3020","courseDisplay":"3020","subject":"ACC","subjectDescription":"Accounting","sequenceNumber":"001","campusDescription":"Main Campus","scheduleTypeDescription":"Face to Face and Online","courseTitle":"Intermediate Accounting II","creditHours":null,"maximumEnrollment":40,"enrollment":0,"seatsAvailable":40,"waitCapacity":25,"waitCount":0,"waitAvailable":25,"crossList":null,"crossListCapacity":null,"crossListCount":null,"crossListAvailable":null,"creditHourHigh":null,"creditHourLow":3,"creditHourIndicator":null,"openSection":true,"linkIdentifier":null,"isSectionLinked":false,"subjectCourse":"ACC3020","faculty":[{"category":null,"courseReferenceNumber":"12535","displayName":"Smith, Kevin R.","emailAddress":"ksmith@uvu.edu","primaryIndicator":true,"term":"202720"}],"meetingsFaculty":[{"category":"01","courseReferenceNumber":"12535","faculty":[],"meetingTime":{"beginTime":"1130","building":"CS","buildingDescription":"Computer Science Building","campus":"M","campusDescription":"Main Campus","category":"01","courseReferenceNumber":"12535","creditHourSession":3,"endDate":"05/05/2027","endTime":"1245","friday":false,"hoursWeek":1.25,"meetingScheduleType":"FFO","meetingType":"CLAS","meetingTypeDescription":"Class","monday":false,"room":"403","saturday":false,"startDate":"01/11/2027","sunday":false,"term":"202720","thursday":false,"tuesday":true,"wednesday":false},"term":"202720"},{"category":"01","courseReferenceNumber":"12535","faculty":[],"meetingTime":{"beginTime":null,"building":"ONLINE","buildingDescription":"Online","campus":"M","campusDescription":"Main Campus","category":"01","courseReferenceNumber":"12535","creditHourSession":0,"endDate":"05/05/2027","endTime":null,"friday":false,"hoursWeek":1.25,"meetingScheduleType":"FFO","meetingType":"CLAS","meetingTypeDescription":"Class","monday":false,"room":"ONLINE","saturday":false,"startDate":"01/11/2027","sunday":false,"term":"202720","thursday":false,"tuesday":false,"wednesday":false},"term":"202720"}],"sectionAttributes":null,"instructionalMethod":"LEC","instructionalMethodDescription":"Regular Class without Lab"},
  {"term":"202720","termDesc":"2027 Spring","courseReferenceNumber":"35054","partOfTerm":"1","courseNumber":"2110","courseDisplay":"2110","subject":"ACC","subjectDescription":"Accounting","sequenceNumber":"X01","campusDescription":"Main Campus","scheduleTypeDescription":"Online","courseTitle":"Principles of Accounting I","creditHours":null,"maximumEnrollment":40,"enrollment":0,"seatsAvailable":40,"waitCapacity":25,"waitCount":0,"waitAvailable":25,"crossList":null,"crossListCapacity":null,"crossListCount":null,"crossListAvailable":null,"creditHourHigh":null,"creditHourLow":3,"creditHourIndicator":null,"openSection":true,"linkIdentifier":null,"isSectionLinked":false,"subjectCourse":"ACC2110","faculty":[{"category":null,"courseReferenceNumber":"35054","displayName":"Mattei, RJ","emailAddress":"rmattei@uvu.edu","primaryIndicator":true,"term":"202720"}],"meetingsFaculty":[{"category":"01","courseReferenceNumber":"35054","faculty":[],"meetingTime":{"beginTime":null,"building":"ONLINE","buildingDescription":"Online","campus":"M","campusDescription":"Main Campus","category":"01","courseReferenceNumber":"35054","creditHourSession":3,"endDate":"05/05/2027","endTime":null,"friday":false,"hoursWeek":2.5,"meetingScheduleType":"W","meetingType":"CLAS","meetingTypeDescription":"Class","monday":false,"room":"ONLINE","saturday":false,"startDate":"01/11/2027","sunday":false,"term":"202720","thursday":false,"tuesday":false,"wednesday":false},"term":"202720"}],"sectionAttributes":null,"instructionalMethod":"LEC","instructionalMethodDescription":"Regular Class without Lab"},
  {"term":"202720","termDesc":"2027 Spring","courseReferenceNumber":"30493","partOfTerm":"1","courseNumber":"1020","courseDisplay":"1020","subject":"COMM","subjectDescription":"Communication","sequenceNumber":"V15","campusDescription":"Main Campus","scheduleTypeDescription":"Live Interactive","courseTitle":"Public Speaking","creditHours":null,"maximumEnrollment":13,"enrollment":0,"seatsAvailable":13,"waitCapacity":13,"waitCount":0,"waitAvailable":13,"crossList":"1G","crossListCapacity":131,"crossListCount":0,"crossListAvailable":131,"creditHourHigh":null,"creditHourLow":3,"creditHourIndicator":null,"openSection":true,"linkIdentifier":null,"isSectionLinked":false,"subjectCourse":"COMM1020","faculty":[{"category":null,"courseReferenceNumber":"30493","displayName":"Hardy, Tracie L.","emailAddress":"thardy@uvu.edu","primaryIndicator":true,"term":"202720"}],"meetingsFaculty":[{"category":"01","courseReferenceNumber":"30493","faculty":[],"meetingTime":{"beginTime":"1000","building":"TG","buildingDescription":"Thanksgiving Point Lehi Bldg 1","campus":"M","campusDescription":"Main Campus","category":"01","courseReferenceNumber":"30493","creditHourSession":3,"endDate":"05/05/2027","endTime":"1050","friday":true,"hoursWeek":2.5,"meetingScheduleType":"V","meetingType":"CLAS","meetingTypeDescription":"Class","monday":true,"room":"109","saturday":false,"startDate":"01/11/2027","sunday":false,"term":"202720","thursday":false,"tuesday":false,"wednesday":true},"term":"202720"}],"sectionAttributes":null,"instructionalMethod":"LEC","instructionalMethodDescription":"Regular Class without Lab"},
  {"term":"202720","termDesc":"2027 Spring","courseReferenceNumber":"23964","partOfTerm":"HSS","courseNumber":"1010","courseDisplay":"1010","subject":"ART","subjectDescription":"Art","sequenceNumber":"H01","campusDescription":"Main Campus","scheduleTypeDescription":"Face to Face","courseTitle":"Introduction to Visual Arts","creditHours":null,"maximumEnrollment":100,"enrollment":0,"seatsAvailable":100,"waitCapacity":0,"waitCount":0,"waitAvailable":0,"crossList":null,"crossListCapacity":null,"crossListCount":null,"crossListAvailable":null,"creditHourHigh":null,"creditHourLow":3,"creditHourIndicator":null,"openSection":true,"linkIdentifier":null,"isSectionLinked":false,"subjectCourse":"ART1010","faculty":[],"meetingsFaculty":[{"category":"01","courseReferenceNumber":"23964","faculty":[],"meetingTime":{"beginTime":null,"building":"HSAF","buildingDescription":"American Fork HS","campus":"M","campusDescription":"Main Campus","category":"01","courseReferenceNumber":"23964","creditHourSession":3,"endDate":"06/11/2027","endTime":null,"friday":false,"hoursWeek":2.08,"meetingScheduleType":"F","meetingType":"CLAS","meetingTypeDescription":"Class","monday":false,"room":"TBA","saturday":false,"startDate":"01/04/2027","sunday":false,"term":"202720","thursday":false,"tuesday":false,"wednesday":false},"term":"202720"}],"sectionAttributes":null,"instructionalMethod":"LEC","instructionalMethodDescription":"Regular Class without Lab"},
  {"term":"202720","termDesc":"2027 Spring","courseReferenceNumber":"11928","partOfTerm":"1","courseNumber":"1110","courseDisplay":"1110","subject":"AERO","subjectDescription":"Aerospace Studies","sequenceNumber":"415","campusDescription":"Main Campus","scheduleTypeDescription":"Face to Face","courseTitle":"Department of the Air Force--DAF Professionalism B","creditHours":null,"maximumEnrollment":24,"enrollment":0,"seatsAvailable":24,"waitCapacity":24,"waitCount":0,"waitAvailable":24,"crossList":null,"crossListCapacity":null,"crossListCount":null,"crossListAvailable":null,"creditHourHigh":null,"creditHourLow":1,"creditHourIndicator":null,"openSection":true,"linkIdentifier":null,"isSectionLinked":false,"subjectCourse":"AERO1110","faculty":[{"category":null,"courseReferenceNumber":"11928","displayName":"Bawden, Alison C.","emailAddress":"oopster45@gmail.com","primaryIndicator":false,"term":"202720"},{"category":null,"courseReferenceNumber":"11928","displayName":"Smith, Corban J.","emailAddress":null,"primaryIndicator":true,"term":"202720"}],"meetingsFaculty":[{"category":"01","courseReferenceNumber":"11928","faculty":[],"meetingTime":{"beginTime":"1400","building":"OTBYU","buildingDescription":"BYU ROTC","campus":"M","campusDescription":"Main Campus","category":"01","courseReferenceNumber":"11928","creditHourSession":1,"endDate":"05/05/2027","endTime":"1450","friday":false,"hoursWeek":0.83,"meetingScheduleType":"F","meetingType":"CLAS","meetingTypeDescription":"Class","monday":false,"room":"TBA","saturday":false,"startDate":"01/11/2027","sunday":false,"term":"202720","thursday":false,"tuesday":false,"wednesday":true},"term":"202720"}],"sectionAttributes":null,"instructionalMethod":"LEC","instructionalMethodDescription":"Regular Class without Lab"},
  {"term":"202720","termDesc":"2027 Spring","courseReferenceNumber":"12577","partOfTerm":"INT","courseNumber":"4810R","courseDisplay":"4810R","subject":"ACC","subjectDescription":"Accounting","sequenceNumber":"001","campusDescription":"Main Campus","scheduleTypeDescription":"Face to Face","courseTitle":"Internship","creditHours":3,"maximumEnrollment":60,"enrollment":0,"seatsAvailable":60,"waitCapacity":25,"waitCount":0,"waitAvailable":25,"crossList":null,"crossListCapacity":null,"crossListCount":null,"crossListAvailable":null,"creditHourHigh":6,"creditHourLow":3,"creditHourIndicator":"TO","openSection":true,"linkIdentifier":null,"isSectionLinked":false,"subjectCourse":"ACC4810R","faculty":[{"category":null,"courseReferenceNumber":"12577","displayName":"Smith, Kevin R.","emailAddress":"ksmith@uvu.edu","primaryIndicator":true,"term":"202720"}],"meetingsFaculty":[{"category":"01","courseReferenceNumber":"12577","faculty":[],"meetingTime":{"beginTime":null,"building":"TBA","buildingDescription":"To Be Arranged","campus":"M","campusDescription":"Main Campus","category":"01","courseReferenceNumber":"12577","creditHourSession":3,"endDate":"05/05/2027","endTime":null,"friday":false,"hoursWeek":2.5,"meetingScheduleType":"F","meetingType":"CLAS","meetingTypeDescription":"Class","monday":false,"room":"TBA","saturday":false,"startDate":"01/11/2027","sunday":false,"term":"202720","thursday":false,"tuesday":false,"wednesday":false},"term":"202720"}],"sectionAttributes":null,"instructionalMethod":"SUP","instructionalMethodDescription":"Supervision at Remote Site"},
  {"term":"202720","termDesc":"2027 Spring","courseReferenceNumber":"41623","partOfTerm":"1","courseNumber":"4700","courseDisplay":"4700","subject":"BOT","subjectDescription":"Botany","sequenceNumber":"001","campusDescription":"Main Campus","scheduleTypeDescription":"Face to Face and Online","courseTitle":"Plant Tissue Culture","creditHours":null,"maximumEnrollment":18,"enrollment":0,"seatsAvailable":18,"waitCapacity":18,"waitCount":0,"waitAvailable":18,"crossList":null,"crossListCapacity":null,"crossListCount":null,"crossListAvailable":null,"creditHourHigh":null,"creditHourLow":4,"creditHourIndicator":null,"openSection":true,"linkIdentifier":null,"isSectionLinked":false,"subjectCourse":"BOT4700","faculty":[{"category":null,"courseReferenceNumber":"41623","displayName":"Lavelle, Amanda S.","emailAddress":"ALavelle@uvu.edu","primaryIndicator":true,"term":"202720"}],"meetingsFaculty":[{"category":"01","courseReferenceNumber":"41623","faculty":[],"meetingTime":{"beginTime":"0900","building":"SB","buildingDescription":"Science Building","campus":"M","campusDescription":"Main Campus","category":"01","courseReferenceNumber":"41623","creditHourSession":4,"endDate":"05/05/2027","endTime":"1050","friday":false,"hoursWeek":1.83,"meetingScheduleType":"FFO","meetingType":"CLAS","meetingTypeDescription":"Class","monday":true,"room":"062","saturday":false,"startDate":"01/11/2027","sunday":false,"term":"202720","thursday":false,"tuesday":false,"wednesday":false},"term":"202720"},{"category":"01","courseReferenceNumber":"41623","faculty":[],"meetingTime":{"beginTime":"0900","building":"SB","buildingDescription":"Science Building","campus":"M","campusDescription":"Main Campus","category":"01","courseReferenceNumber":"41623","creditHourSession":0,"endDate":"05/05/2027","endTime":"1250","friday":false,"hoursWeek":3.83,"meetingScheduleType":"FFO","meetingType":"CLAS","meetingTypeDescription":"Class","monday":false,"room":"062","saturday":false,"startDate":"01/11/2027","sunday":false,"term":"202720","thursday":false,"tuesday":false,"wednesday":true},"term":"202720"},{"category":"01","courseReferenceNumber":"41623","faculty":[],"meetingTime":{"beginTime":null,"building":"ONLINE","buildingDescription":"Online","campus":"M","campusDescription":"Main Campus","category":"01","courseReferenceNumber":"41623","creditHourSession":0,"endDate":"05/05/2027","endTime":null,"friday":false,"hoursWeek":1,"meetingScheduleType":"FFO","meetingType":"CLAS","meetingTypeDescription":"Class","monday":false,"room":"ONLINE","saturday":false,"startDate":"01/11/2027","sunday":false,"term":"202720","thursday":false,"tuesday":false,"wednesday":false},"term":"202720"}],"sectionAttributes":null,"instructionalMethod":"LEL","instructionalMethodDescription":"Regular Class with Lab"},
];
const row = (subj, num, sec) => ROWS.find((r) => r.subject === subj && r.courseNumber === num && r.sequenceNumber === sec);

test('fixture is the real 8-row sample', () => {
  assert.equal(ROWS.length, 8);
});

test('ECE 2250-001: single in-person meeting', () => {
  const s = compactSection(row('ECE', '2250', '001'));
  assert.deepEqual(s, {
    crn: '14874', subj: 'ECE', num: '2250', sec: '001', title: 'Circuit Theory', cr: 3,
    days: 'TR', start: '0830', end: '0945', bldg: 'SE', room: '320', campus: 'Main Campus', mode: 'in person',
    kind: 'Regular Class without Lab', instr: 'Manzak, Ali', seats: s.seats, cap: 30, wait: s.wait,
    sd: '2027-01-11', ed: '2027-05-05',
  });
  assert.equal(typeof s.seats, 'number');
});

test('never keeps instructor emails or Banner ids', () => {
  const txt = JSON.stringify(ROWS.map(compactSection));
  assert.ok(JSON.stringify(ROWS).includes('@uvu.edu'), 'fixture has emails to drop');
  assert.ok(!txt.includes('@'), 'no email in output');
  assert.ok(!/bannerId|emailAddress/.test(txt));
});

test('Face to Face and Online with two meetings → hybrid, meetings list kept', () => {
  const s = compactSection(row('ACC', '3020', '001'));
  assert.equal(s.mode, 'hybrid');
  assert.equal(s.meetings.length, 2);
  assert.deepEqual(s.meetings[1], { days: '', start: null, end: null, bldg: 'ONLINE', room: 'ONLINE', sd: '2027-01-11', ed: '2027-05-05' });
  assert.equal(s.days, s.meetings[0].days);
  assert.equal(s.start, s.meetings[0].start);
});

test('three-meeting section keeps all three', () => {
  const s = compactSection(row('BOT', '4700', '001'));
  assert.equal(s.meetings.length, 3);
  assert.equal(s.cr, 4);
});

test('online section: no days, no times', () => {
  const s = compactSection(row('ACC', '2110', 'X01'));
  assert.equal(s.mode, 'online');
  assert.equal(s.days, '');
  assert.equal(s.start, null);
  assert.equal(s.meetings, undefined);
});

test('Live Interactive → livestream', () => {
  assert.equal(compactSection(row('COMM', '1020', 'V15')).mode, 'livestream');
});

test('no instructor → instr null; high-school part of term kept', () => {
  const s = compactSection(row('ART', '1010', 'H01'));
  assert.equal(s.instr, null);
  assert.equal(s.instr2, undefined);
  assert.equal(s.pt, 'HSS');
});

test('primary instructor is the flagged one even when listed second', () => {
  const r = row('AERO', '1110', '415');
  assert.equal(r.faculty[0].primaryIndicator, false);
  const s = compactSection(r);
  assert.equal(s.instr, 'Smith, Corban J.');
  assert.deepEqual(s.instr2, ['Bawden, Alison C.']);
  assert.equal(primaryInstructor({ faculty: [] }), null);
});

test('variable credits keep the range; internship part of term', () => {
  const s = compactSection(row('ACC', '4810R', '001'));
  assert.equal(s.cr, 3);
  assert.equal(s.crMax, 6);
  assert.equal(s.pt, 'INT');
});

test('HTML entities in Banner names and titles are decoded', () => {
  // Real Banner strings: "O&#39;Flynn, Jeffrey E." (MUSC), titles with "&amp;".
  const r = { ...row('ECE', '2250', '001'), courseTitle: 'Theory &amp; Practice', faculty: [{ displayName: 'O&#39;Flynn, Jeffrey E.', primaryIndicator: true }] };
  const s = compactSection(r);
  assert.equal(s.instr, "O'Flynn, Jeffrey E.");
  assert.equal(s.title, 'Theory & Practice');
});

test('small helpers', () => {
  assert.equal(dayLetters({ monday: true, wednesday: true, friday: true }), 'MWF');
  assert.equal(dayLetters({ tuesday: true, thursday: true, saturday: true, sunday: true }), 'TRSU');
  assert.equal(isoDate('08/19/2026'), '2026-08-19');
  assert.equal(isoDate(null), null);
  assert.equal(modeOf({ scheduleTypeDescription: 'Livestream and Online' }), 'hybrid');
  assert.equal(modeOf({ scheduleTypeDescription: 'Face to Face and Livestream' }), 'hybrid');
  assert.equal(modeOf({ scheduleTypeDescription: 'Livestream' }), 'livestream');
  assert.equal(modeOf({ scheduleTypeDescription: 'Face to Face Lab' }), 'in person');
});

test('upcomingTerms: today 2026-10-15 → Fall 2026, Spring 2027, Summer 2027 (no Non-Credit, no past)', () => {
  // Real getTerms response, 2026-10-15.
  const terms = [{ code: '202739', description: '2027 Non-Credit Summer (View Only)' }, { code: '202730', description: '2027 Summer (View Only)' }, { code: '202729', description: '2027 Non-Credit Spring (View Only)' }, { code: '202720', description: '2027 Spring (View Only)' }, { code: '202649', description: '2026 Non-Credit Fall' }, { code: '202640', description: '2026 Fall' }, { code: '202639', description: '2026 Non-Credit Summer (View Only)' }, { code: '202630', description: '2026 Summer (View Only)' }, { code: '202629', description: '2026 Non-Credit Spring (View Only)' }, { code: '202620', description: '2026 Spring (View Only)' }, { code: '202549', description: '2025 Non-Credit Fall (View Only)' }, { code: '202540', description: '2025 Fall (View Only)' }];
  assert.deepEqual(upcomingTerms(terms, new Date('2026-10-15T12:00:00')), [
    { code: '202640', name: '2026 Fall' }, { code: '202720', name: '2027 Spring' }, { code: '202730', name: '2027 Summer' },
  ]);
  assert.deepEqual(upcomingTerms(terms, new Date('2027-01-20T12:00:00')).map((t) => t.code), ['202720', '202730']);
});

// Shape check of the committed data files (skipped when they have not been fetched).
const DIR = fileURLToPath(new URL('../data/sections/', import.meta.url));
test('committed data/sections files have the documented shape', { skip: !existsSync(DIR + 'index.json') }, () => {
  const idx = JSON.parse(readFileSync(DIR + 'index.json', 'utf8'));
  assert.ok(idx.terms.length >= 1);
  for (const t of idx.terms) {
    const j = JSON.parse(readFileSync(DIR + `${t.term}.json`, 'utf8'));
    assert.equal(j.term, t.term);
    assert.equal(j.count, j.sections.length);
    assert.ok(j.count > 1000, `${t.term} has ${j.count} sections`);
    const crns = new Set(j.sections.map((s) => s.crn));
    assert.equal(crns.size, j.count, 'CRNs unique');
    for (const s of j.sections) {
      assert.match(s.crn, /^\d{5}$/);
      assert.match(s.days, /^M?T?W?R?F?S?U?$/);
      if (s.start) assert.match(s.start, /^\d{4}$/);
      assert.ok(['in person', 'online', 'hybrid', 'livestream'].includes(s.mode));
    }
    assert.ok(!JSON.stringify(j).includes('@uvu.edu'));
    assert.ok(!/&(#\d+|[a-z]+);/.test(JSON.stringify(j.sections)), 'no HTML entities left');
  }
  assert.deepEqual(readdirSync(DIR).filter((f) => /^\d{6}\.json$/.test(f)).sort(), idx.terms.map((t) => `${t.term}.json`).sort());
});

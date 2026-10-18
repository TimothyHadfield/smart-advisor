# Smart Advisor — calculations & planning-logic audit (2026-10-17)

Read-only. Code at commit on disk 2026-10-17. All numbers are **measured** with scripts in this folder
(`calc-all.mjs` → `calc-all.txt`, `calc2.mjs` → `calc2.txt`, `scen.mjs <id[+minor]> [taken,...] [cap] [summers]`)
over the 414 current-catalog program files, start Spring 2027, 16-credit cap, unless marked *reasoned*.

UVU rules checked (catalog.uvu.edu/graduation/, /general-education/, EE BS page):
BA/BS ≥120 cr, ≥40 upper-division (3000+); BAS/BAP ≥90 cr, ≥30 UD; residency BA/BS 30 cr (10 in last 45);
GPA 2.0 (programs may require more; EE: 2.5 and **C in all core/electives**); Global/Intercultural + 2 Writing
Enriched for bachelor's; BA 16 cr of one language; double majors same catalog year; catalog valid 7 yrs (bachelor's).
The catalog page does **not** state a general rule on major/minor or major/GE double counting, repeats, or a
per-term credit cap. "University Advanced Standing" (UAS) per an SLCC transfer page (not UVU text — verify):
QL + ENGL 2010 + 24 college credits + GPA 2.0.

Harm key: **[LATE]** graduates later than shown · **[EXTRA]** takes a class they don't need · **[MISS]** misses a needed class / wrong order.

---

## 1. Non-course gates are ignored: admission, formal acceptance, matriculation, Advanced Standing — [LATE][MISS] (highest)
`js/planner.js:148-160` (`evalReq`) only sees course codes; `prereqNonCourse` (8,214 course entries) is never read.
Program-level matriculation lists (e.g. EE's 12-course "To be admitted to the BSEE program…" list, C or better, GPA 2.5)
are not parsed at all (`scripts/fetch-program.mjs`; no `matriculation` field in any program file).

- **Nursing BS, nothing taken** (`node scen.mjs nursing-bs`): Spring 2027 = BIOL 1610, ENGL 1010, **NURS 2300, 2305, 2320, 2325, 2415**.
  NURS 2300/2320 prereq is "Acceptance into ASN/BS Nursing program" → `prereqs: null` → placed in semester 1, before
  ZOOL 2320/2420, MICR 2060, CHEM 1110 (the admission prereqs). Nursing courses are mixed in with prereqs across 8
  semesters; the catalog sample plan is 4 prereq semesters + 5 fixed cohort semesters. Shown: **Graduate Fall 2030**
  (or Spring 2030 at 18 cr). Realistic: cohort can't start before Spring 2029 → ≈ Spring 2031 (*reasoned*).
- **EE BS, nothing taken**: ECE 3710 in semester 2, ECE 3740 / ECE 3770 in semesters 2–4, but ECE 2250 (a matriculation
  course) is in semester 4 and ENGL 2010 (needed for UAS) in semester 4. Every "Formal Acceptance … and University Advanced
  Standing" course before semester 5 is impossible.
- Across all programs: **185** admission-gated courses with no course prereqs land in semester 1; **489** UAS courses land
  in semester 1–2; **563** courses sit ≥3 semesters earlier than the catalog's own sample plan.
- Text-only prereqs too: NURS 4540 needs "a university-level statistics course with C" → planned in the **same** term as
  the statistics box (Fall 2030).

**Fix**: (a) parse program matriculation/admission course lists into `program.gate = {codes, minGrade, gpa}`;
(b) in `buildModel`, mark a course `gated` when its `prereqText` matches /acceptance|admission|admitted|matriculation|formal(ly)? accept/i;
(c) in `makePlan.avail`, a gated item needs every `gate.codes` placed in an **earlier** semester (fallback without a list:
every lower-division required course that the sample `gradPlan` puts before the first gated course);
(d) UAS: available only once ENGL 2010 + the QL unit are placed earlier and ≥24 credits are done/planned before;
(e) cohort programs (`admission: true` + gradPlan blocks of gated courses): place gated courses as the gradPlan's
semester blocks, in order, one block per term (no mixing, no compression by the credit cap).
**Tests**: nursing-bs empty → no NURS course before ZOOL 2320, ZOOL 2420, MICR 2060 and CHEM 1110 are all in earlier terms;
NURS gradPlan blocks appear in 5 consecutive terms. electrical-engineering-bs empty → ECE 3710/3740/3770 term index >
term of ECE 2250, PHYS 2225, ENGL 2010. All-programs: count of UAS courses in terms 1–2 == 0.

## 2. Course offering seasons ignored — [LATE]
`makePlan` never asks which terms a course runs. Banner data already exists for Fall 2026 (`202640`) and Spring 2027 (`202720`).
- **EE BS** (Spring 2027 start): ECE 3350, ECE 3780, ECE 4730 planned **Fall 2029** but only run in Spring;
  ECE 4760 + ECE 4900 (capstone) planned **Spring 2030** but only run in Fall; ECE 3450 planned Fall 2030, Spring-only.
  The last three semesters of the shown plan cannot be taken; ECE 4730 (Spring) → ECE 4900 (Fall) forces a later finish.
- All programs: **716** placements contradict the one-year Banner data (348 Fall-placed Spring-only, 368 the reverse);
  201 planned courses have no section in either term.
**Fix**: build `data/offered.json` {code: {F:n, S:n, U:n}} at fetch time from all Banner terms we can get plus the old
CourseLeaf terms ≤202520 (multi-year evidence); in `avail()` skip a course in a season where it has ≥2 years of other-season
offerings and none in this season; unknown = allowed; show a "usually Fall only" hint. One year of data is weak — use it as a
soft rule (prefer, don't forbid) until ≥2 years exist.
**Test**: EE empty → ECE 4900 lands in a Fall, ECE 4730 in a Spring; synthetic program with a Fall-only course and a
Spring start → course placed in the first Fall.

## 3. Summers are planned as full 16-credit terms with no summer data — [LATE]
`nextTerm(…, summers)` + same `maxCredits` for every term (`planner.js:288-291, 326`). No `2026 30` sections file exists.
- **EE BS, summers on**: Summer 2027 = ECE 2700/2705, ECE 3710, MATH 1220, PHYS 2210/2215 (16 cr); shows **Graduate Summer 2029**
  vs Fall 2030 without summers. 734 summer terms / 9,095 credits planned across programs with zero evidence any of those
  courses run in summer.
**Fix**: fetch the summer term; with summers on, place only courses that have summer sections (unknown → not in summer),
and use a separate summer cap (plainest default: half the term cap — flag as Tim's call).
**Test**: EE with summers → no ECE 3xxx/4xxx course in a Summer unless the offered map says so.

## 4. Out-of-program prerequisites "assumed met" hide real classes — [LATE][MISS]
`planner.js:148-160` returns `null` (= met) for any code outside the program; `CLAUDE.md` documents it as a rule.
- **184 of 414 programs** (65 bachelor's) have required courses whose prereqs stay unmet even after **every** course in
  the program is done: **309 hidden courses, ≈1,072 credits** (`calc-all.txt` → "hidden").
- **EE BS**: MATH 1210 needs (MATH 1050|1055) + MATH 1060 or MATH 1080 or placement; ECE 1000 needs MATH 1060. Adding
  MATH 1050 + MATH 1060 moves the plan from **Fall 2030 / 122 cr** to **Spring 2031 / 129 cr** (measured).
- Others: computer-science-bs / software-engineering-bs / computer-engineering-bs ≈15 cr each; exercise-science-minor 7 courses
  24 cr; applied-communication-ba MAT 1010 → STAT 1040; 164 choice groups (e.g. every "Quantitative Literacy" option) where
  every option needs an outside course.
**Fix**: per program, list the outside prereqs that gate in-program courses (min branch); ask once "Have you taken or placed
out of: MATH 1050, MATH 1060?" (default **no** for an empty plan); unchecked ones become plan items before their dependents,
added to the credit total. Treat placement/"or instructor permission" as the yes-box, never silently.
**Test**: EE empty with no placement → MATH 1050/1060 appear in the plan before MATH 1210 and ECE 1000; with placement checked
→ today's plan.

## 5. Grade minimums ignored; audit import counts D/D- as passed — [MISS]
`js/audit.js:20` PASS includes D+, D, D-; `matchAudit` marks them taken; the planner treats any taken code as satisfying prereqs.
- **619** required-course instances have a grade minimum on an in-program prereq (e.g. ACC 3010 needs ACC 2110/2120 **B-**;
  ANTH 1010G needs ENGL 1010 **C+**; ZOOL 4400 needs C-). EE requires **C in all discipline core and electives**.
- Scenario: audit row "ECE 2250 Circuit Theory D 3 Fall 2026" → box green, ECE 3250 planned next term; reality: ECE 2250
  must be retaken (and the student can't register for ECE 3250).
**Fix**: keep grades (already stored in `state.grades`); parse `minGrade` per prereq edge from `prereqText` and program-level
"minimum grade of C in all …" into the program; a taken course below the needed grade = "retake" item placed back in the plan
(and shown red on the box). Never treat F/W as taken (already correct).
**Test**: EE + grades {ECE 2250: 'D'} → plan contains ECE 2250 again before ECE 3250; ACC 2110 'C' → ACC 3010 not available.

## 6. Major + minor: shared course counted twice until tapped — [EXTRA]
`js/programs.js:147-172` drops a minor course only if the major **requires** it; if the course is merely an **option** in a
major choice group, both stay (minor course + full major choice chunk). After the student takes it, `choiceRemaining`
credits it to the major group too, so the total drops by double its credits.
- **231 major×minor pairs**. Examples (`calc2.txt`): accounting-bs + business-management-minor (ACC 2110): plan **126 → 120**
  after tapping one 3-credit class; biology-bs + statistics-minor (STAT 2040): 142 → 134; biomedical-science-bs +
  exercise-science-minor (EXSC 2700G): 136 → 127. Before tapping, the plan schedules an extra ~3–4 cr class the student doesn't need.
- 734 pairs have overlapping choice lists (both chunks planned separately). UVU's catalog doesn't state whether one course
  may count for a major and a minor; departments differ → *policy unknown, flag*.
**Fix**: in `combinePrograms`, when a later required course is an option of an earlier choice group, lower that group's
`pick` by it (the mirror of the existing `covered` logic) and record it in `parts[].shared`; same when a later choice
overlaps: plan the overlap once. Show "counts for both" on the box.
**Test**: accounting-bs + business-management-minor → `makePlan(empty).creditsLeft` equals `creditsLeft` after tapping
ACC 2110 + 3.

## 7. A required course also listed in an elective group is credited twice — [MISS]
`choiceRemaining` (`planner.js:170-177`) counts any done option, even one that is separately required.
- **27 groups** (e.g. art-design-aas-design-illustration-emphasis "ART/ARTH Elective — 9 credits" lists required ART 1210):
  tap ART 1210 → plan **62 → 56** (should be 59). The student is shown 3 fewer credits than they need.
**Fix**: in `buildModel`, drop from each choice's options any code that is a required `course` unit elsewhere in the same
program (catalog wording is "not otherwise required"); combined programs handled by #6.
**Test**: that program, taken {ART 1210} → creditsLeft 59.

## 8. Coreqs only need "same or earlier", so a lab/clinical can land semesters before its lecture — [MISS]
`coreqOk` (`planner.js:403`) and the bundle only follow the coreq from the course that lists it; a lab with no coreq
data of its own is free and goes first.
- Nursing: **NURS 2415** (clinical) in Spring 2027, its lecture NURS 2410 in Fall 2028. 21 such cases (dance BFA, culinary
  CA 1170 → CA 1310, CRT 1210/1215, ARC 4510/4230…). `tests/planner-all.test.mjs:70-73` encodes "same/earlier" so it passes.
**Fix**: make coreqs symmetric in `buildModel` (if X lists Y, Y gets X); bundle both directions; test asserts same term.
**Test**: nursing-bs empty → NURS 2410 and NURS 2415 in the same term; change planner-all check to "same term".

## 9. Courses taken outside the program never reduce elective credits — [EXTRA][shows LATE]
`js/audit.js:245` just counts them (`other++`); placeholders are done only when their own id is in the taken set.
- Scenario: statistics-bs, audit with 20+ credits of transfer/other classes → "Complete 20 credits of upper or lower
  division electives" stays fully in the plan (+≈1.5 semesters shown, and the student is nudged to take 20 cr more).
**Fix**: keep imported non-program rows with credits (audit row credit column, else `courses.json`) and apply them to open
elective placeholders (UD ones only by 3000+ courses), largest first; show "filled by HIST 1100".
**Test**: statistics-bs + imported others {6×3 cr lower-div, 2×3 cr upper-div} → generic 20-cr box shows 2 left, UD 10-cr box 4 left.

## 10. 120 total / 40 upper-division never checked — [MISS] (rare)
Plan total = sum of units; nothing checks 120 or 40 UD. Data mostly carries both, but 5 bachelor's can be finished per plan
with <40 UD if generic electives are taken lower-division: integrated-studies-ba/bs (30 UD fixed, 81 generic), spanish-ba (39),
mechatronics-engineering-technology-bs (39), software-engineering-bs (36 + "CS Elective" list).
**Fix**: after planning, compute fixed UD credits; if <40 (30 for BAS/BAP), relabel that many generic elective credits
"Upper-division elective (3000+)"; if total <120 (90 BAS/BAP) add "Elective" to reach it.
**Test**: integrated-studies-ba → plan has ≥10 cr labelled upper-division elective.

## 11. Choice "rules" parsed but not enforced — [MISS]
8 groups carry `rules` (`calc-all.txt` → rules): mathematics-emphasis-bs "At least one course must be from MATH 3400, 4320 or 4510";
environmental-science-management-minor "At most 4 credits of Geology"; geography-minor "At most one of…";
computational-data-science-bs "at least 6 hours 3000+". `choiceRemaining` says "done" when any 12 credits are tapped.
**Fix**: structured rules {atLeast:{codes,n}}, {atMost:{codes,credits}}, {minLevel} checked in `choiceRemaining`; remaining
credits stay until satisfied. **Test**: mathematics-emphasis-bs, 12 cr tapped without MATH 3400/4320/4510 → group not done.

## 12. Track auto-picked with no way to choose — [EXTRA]
`pickTrack` (`planner.js:473-484`) picks most-progress, then **cheapest**; there's no selector in `js/app.js`. 16 track groups:
computer-science-bs auto-plans "CS Track" (a Full Stack / Secure Computing / AI student sees the wrong courses until they tap one);
digital-cinema-production-bs "Post-production"; animation-game-development-bs "2D Animation"; dance-bs "Ballroom".
Also track header rows ("Includes 36 credits of upper-division") appear as track names (data).
**Fix**: a track picker on the group box, saved in settings (synced); pickTrack only as default. (UI → Tim decides look; build plainest.)
**Test**: computer-science-bs with track = "Artificial Intelligence Track" → plan contains that track's courses only.

## 13. Gen Ed box that a required major course already fills — [EXTRA] (policy-dependent)
77 boxes, e.g. accounting-bs "Social Science 3 cr" while ECON 2010 is required; digital-audio-bs "Physical Science" ← PHYS 1700
and "Fine Arts" ← MUSC 1100; computer-engineering-bs "Physical Science" ← PHYS 2210. UVU degree audits normally let the major
course satisfy the GE area; the freed credits then become free electives (total unchanged at 120), but the plan steers the
student to an extra GE-list class. **Fix**: mark such boxes "likely filled by ECON 2010" and auto-fill when that course is
taken, keeping the credits as an elective box only if the program total needs them. **Test**: accounting-bs taken {ECON 2010}
→ Social Science box done, +3 cr elective box.

## 14. Smaller calculation issues
- **Count-pick choice credits assume equal options** (`choiceRemaining` `planner.js:176`; `makePlan` chunks): American
  Institutions = 3 cr, but HIST 2700+2710 option is 6 cr → plan understates by 3 if that pair is chosen. Use the chosen
  option's credits once picked; show "3–6 cr".
- **40-semester cap silently drops leftover items** (`planner.js:394`): add a warning when `todo.length` remains.
- **Term boundary mismatch**: planner says Aug 1–19 = Summer (`planner.js:297`), schedule says Aug = Fall
  (`schedule.js:16-19`) → Aug 1–19 the plan starts Fall but the Schedule tab defaults to Spring. Share one `currentTerm`.
- **IP rows unchecked but `lastTerm` still set** (`app.js:880-886`): with "in progress" unticked the plan still starts after
  that term. Only set lastTerm from rows actually imported.
- **Catalog year**: `yearFor` (`programs.js:66-71`) silently falls back to the newest year when a program lacks the asked year,
  so a major + minor can mix years (UVU: double majors must share a catalog year). Show which year each part uses.
- **Not modelled** (*reasoned*, low): Global/Intercultural + two Writing Enriched courses, residency (30 UVU cr, 10 in last 45;
  EE: 32 + 12 in CS/ECE), program GPA (EE 2.5). A one-line "also required" note per bachelor's would cover them.

## 15. Schedule builder (js/schedule.js) — sound, two notes
Ranking is sensible: per-section cost (days 60/meeting, time window 0.5/min, mode 40/15, off-main-campus 30, RMP (5−r)×8,
full 25+wait) + pack cost (3/day, 0.15/min of gap past 15 min), dedupe by identical times, DFS fewest-options-first with
bound, then local swap polish. Date-range overlap handles half-term blocks.
- Search stops at 12,000 nodes (`schedule.js:206`); with many large courses a conflict-free schedule can be missed and a course
  reported "unplaced". Add a final "retry without the cost bound" pass when `unplaced` is non-empty.
- A plan course with **no sections that term** is silently "unplaced" — this is exactly the season signal of #2; surface it
  ("not offered Spring 2027") and feed it back to the planner.
- Data check (not calc): Fall 2026 has exactly 8,192 sections (= 2^13); paging sorts by subject description and dedupes by CRN,
  so lost rows only warn. Compare against `totalCount` in the workflow log.

---

### Suggested order to build
1 gates/cohorts → 4 outside prereqs (placement question) → 5 grade minimums → 2+3 seasons/summers (needs new data) →
6+7 double counting → 8 symmetric coreqs → 9 outside electives → 10–14. Every fix comes with its pinned test above; add a
golden test for EE BS and Nursing BS plans (term per course) reviewed by a human once.

# Nursing accuracy report (Smart Advisor), 2026-10-17

Read-only analysis. Sources, all fetched 2026-10-17 with at least 1 s between requests (raw copies are in `sa-audit/raw/`):
- Catalog 2026-27: [Nursing, B.S.](https://catalog.uvu.edu/health-public-service/nursing/nursing-bs/), [Nursing, A.S.N.](https://catalog.uvu.edu/health-public-service/nursing/nursing-asn/), [Nursing dept page](https://catalog.uvu.edu/health-public-service/nursing/), catalog search for "nursing".
- Department: [degrees index](https://www.uvu.edu/nursing/degrees/index.html), [ASN](https://www.uvu.edu/nursing/degrees/asn.html), [BSN](https://www.uvu.edu/nursing/degrees/bsn.html), [ASN application info](https://www.uvu.edu/nursing/asn_app_info.html), plus the PDFs "Fall 2026 ASN w/BSN completion outline", "Fall 2026 RN-BSN outline", "Fall 2026 LPN w/BSN completion outline", "BSN degree map 2025" and "Nursing elective credits Fall 2025".
- Our data: `data/programs/nursing-{bs,asn}.json` and `data/2025-2026/programs/nursing-{bs,asn,msn}.json`. Planner run in Node (`sa-audit/runplan.mjs`, `flow.mjs`, `dbl.mjs`), with nothing taken, start Spring 2027, 16-credit cap, no summers (the site's defaults today).

## Bottom line
**The course lists are parsed almost exactly right. What's wrong is how the planner orders them.** Every class the plan schedules for nursing-bs and nursing-asn appears in the catalog's requirement list. But the plan ignores the one fact that runs the nursing program: **you must be accepted (competitive, by application) before any NURS class, and acceptance needs the prerequisites finished first.** So the plan's **first semester (Spring 2027) puts 5 nursing cohort classes next to BIOL 1610 and ENGL 1010**, and the Schedule tab tries to schedule them. A nursing student sees classes she can't take yet and that aren't her next step, then sees the prerequisites pushed later. Smaller real errors sit on top of that:
- a stats class gets scheduled alongside the course that requires it
- a made-up "STAT 1040 + STAT 1045" option
- STAT 1040 counted twice
- the LPN track would add 22 credits of phantom classes
- B.S.-only classes are never labelled as such.

Exactly what Tim's girlfriend saw as "not required" can't be measured from here. The likely candidates (reasoned) are:
1. The first-semester NURS classes.
2. The B.S.-only Gen Ed and stats, pathophysiology and elective classes, if she's thinking of the ASN/RN path.
3. ZOOL 4400 shown where her program's own sequence uses ZOOL 2600.

## Other nursing programs: none missing
The catalog has only **two** nursing programs, Nursing A.S.N. and Nursing B.S. (dept page plus search, measured). The department's four "programs" all map onto those two:
- ASN, and LPN to ASN (plus MTECH-LPN): both are the LPN track inside the ASN
- RN-to-BSN: the same B.S. degree
- "Pre-nursing" is an advising status, not a catalog program. There's no nursing minor or certificate.
- The MSN exists only in our 2025-26 archive (it's not in 2026-27). There it isn't flagged `admission` even though it's a graduate program.

## How the real program works (catalog + department)
1. **Prerequisites to apply** (ASN application page and Fall 2026 outline): ENGL 1010/ENGH 1005, Math QL, BIOL 1610, CHEM 1110, PSY 1100, ZOOL 2320/2325, ZOOL 2420/2425. You need a C or better, and grades must be posted before the deadline (Fall entry: May 20; Spring entry: Sep 20). Then comes the interview, then acceptance.
2. **ASN cohort**: 4 fixed semesters, "Nursing core courses must be taken as scheduled and in sequence" (ASN FAQ).
   - Semester 1: NURS 2300/2305/2310/2320/2325
   - Semester 2: NURS 2410/2415/2420/2430/2435/2445
   - Semester 3: NURS 3330/3335/3340/3345/3355
   - Semester 4: NURS 3400/3405/3440/3445
   - MICR 2060/2065 (by the end of semester 4), ENGL 2010 and NUTR 1020 fit in around the cohort.
3. **BSN completion** (B.S. catalog: "Completion of the ASN program is required prior to entering the BSN program", "RN licensure complete"):
   - 9 NURS 4xxx classes plus 5 elective credits
   - Gen Ed (American Institutions, PPCG, Humanities, Fine Arts), university stats and pathophysiology, marked "BSN option only" in the outline
   - NURS 4230 can be taken after ASN semester 2, NURS 4340 after semester 3, NURS 4410G any time; the rest after ASN graduation and RN licence.

## Discrepancy table

| # | Program | Catalog / department says | Our data or plan shows | Effect on a student |
|---|---|---|---|---|
| 1 | BS + ASN | NURS 2300: "Prerequisite(s): Acceptance into ASN/BS Nursing program". Outline: "REQUIRED PREREQUISITES (must be completed before applying to the Nursing program)" | `NURS 2300.prereqs: null, prereqNonCourse: true`. The plan's **Spring 2027** semester = BIOL 1610, ENGL 1010, **NURS 2300, 2305, 2320, 2325, 2415** (BS). In the ASN plan, Spring 2027 = CHEM 1110, ZOOL 2320/2325, **NURS 2300, 2305, 2320, 2325**. NURS 2300/2305/2320/2325 can be tapped as taken with nothing done. | Shown classes she can't take, with the real prerequisites pushed later. The Schedule tab builds a Spring 2027 schedule with NURS sections. |
| 2 | BS + ASN | NURS 2415 (clinical) is taken with NURS 2410 (catalog: NURS 2410 "Corequisite(s): NURS 2415"; outline semester 2) | NURS 2415 has no prereqs or coreqs in the catalog, so the planner puts it **alone in Spring 2027** (BS) or Fall 2027 (ASN), 3 to 4 semesters before NURS 2410. | A clinical scheduled before the program even starts. |
| 3 | BS + ASN | Cohort runs in fixed sequence (above) | BS plan: NURS 2430/2435 slide into the semester-3 group (Spring 2029); NURS 3340/3345 slide into the semester-4 group (Fall 2029) because Gen Ed fills the 16-credit cap. ASN plan: NURS 2310 lands in a different term from NURS 2300/2320. | Wrong cohort; NURS cohort classes can't be moved around. |
| 4 | BS + ASN | Graduation timeline: at least 3 prerequisite semesters, then apply, then 4 cohort semesters (ASN), then about 2 BSN semesters | Plan says ASN **graduates Fall 2029** (6 semesters) and BS **Fall 2030** (8 semesters) | Too optimistic by 1 to 2 semesters (reasoned: Spring application closes Sep 20, before Fall grades post), and acceptance is never guaranteed. This is the "large financial decision" risk. |
| 5 | BS | NURS 4540: "NURS 3405, completion of a university-level statistics course with a minimum C ..." | `prereqs: "NURS 3405"` (the stats words are lost). The stats choice's grad-plan label "Complete one of the following:" doesn't match "University-level statistics course", so it sorts last. Plan Fall 2030 = **NURS 4540 + the stats class in the same semester** | Prerequisite violated: she'd be blocked from NURS 4540. |
| 6 | BS | Stats list: MGMT 2340, PSY 3110, STAT 1040, plus the note "STAT 1040 and STAT 1045 can be used only if not used for GE." | Options: MGMT 2340, PSY 3110, STAT 1040, **"STAT 1040 + STAT 1045" (8 cr, both required)** | A made-up option that asks for two stats classes; STAT 1045 on its own is missing. |
| 7 | BS | Same note: one stats class can't count for both QL and the BSN stats requirement. ASN page: "An additional statistics course will be required for the BSN which cannot be used to fill the GE Math QL requirement." | Taking STAT 1040 marks **both** "Quantitative Literacy" and "University-level statistics course" done. Credits left go 120 → 114 instead of 117 (measured, `dbl.mjs`). | Plan **drops a required class** and promises graduation too early. |
| 8 | BS | "ZOOL 4400 Pathophysiology 3 / or ZOOL 2600 Concepts of Pathophysiology". The grad plan and the outline use ZOOL 2600 first (taken in ASN semester 2). ZOOL 4400 is 4 cr and needs University Advanced Standing. | The plan schedules **ZOOL 4400** and counts it as **3** credits. | Steers her to the harder 4-credit upper-division class when the program's own sequence uses ZOOL 2600; credits are 1 low. |
| 9 | ASN | LPN track = NURS 2210 + NURS 3365 (6 cr). The LPN outline grants "ASN Credits awarded for LPN 22" (experiential credit) | No way to choose the track. If NURS 2210 is ever marked taken, the planner picks the LPN track and fills the rest of the 28-credit group with **7 generic "Choose one of the following tracks" boxes (22 cr)** (measured) | An LPN student is shown 22 credits of classes she'll never take. Everyone else always gets the Direct RN path silently. |
| 10 | ASN | Track courses (NURS 2300 to 3355) are what NURS 3330/3400/3405 build on | The 17-option track group is folded into **one box** (more than 8 options). In the ASN flowchart, NURS 3330 sits in the first column with no arrows and **can be tapped as taken with nothing done** (measured `tapCheck`). | The chart hides the whole cohort chain; you can tap things you aren't eligible for. |
| 11 | BS + ASN | Choice credits: QL options run 3 to 6 cr (MAT 1035 = 6, STAT 1045 = 5, MATH 1050 = 4). American Institutions: HIST 2700 & 2710 = 6. PSY 3110 = 4 | Every choice counts its slot credits (3) whichever option is picked | Credit totals and term loads are too low for those choices. Small, but it adds up. |
| 12 | BS | Admission and matriculation box: ASN complete, RN licence, prerequisite list, "C or higher", P/F not accepted | `admission: true`, `admissionNote: "Each application for acceptance into the program is for a specific semester only."` (the wrong sentence was picked). **The UI never reads `admission` or `admissionNote`** (grep: nothing in `js/`). The matriculation list isn't parsed. | No warning anywhere that this is a competitive-entry program, or which classes are prerequisites to apply. |
| 13 | BS | BSN-only items (AI, PPCG, Humanities, Fine Arts, stats, pathophysiology, 5 electives incl. at least 2 upper-division NURS from an approved list) | All shown as plain requirements, with nothing marking them as "BSN only" vs "needed for RN". The elective is a free 5-credit placeholder with no list, and the "2 upper-division NURS" rule isn't enforced. | Reasoned: an ASN/pre-nursing student comparing against her program sees classes "not required" for the RN. |
| 14 | ASN | Grad plan semester 3 lists PHIL 2050, but the requirement list does not (the online plan swaps in ENGL 2010) | Correctly **not** required; PHIL 2050 is in `courses` but never scheduled (measured) | OK. This is a catalog inconsistency, worth a note on the page. |
| 15 | BS + ASN | Global/Intercultural course, 2 Writing Enriched courses, 40 upper-division credits (RN-BSN outline: "BSN credits alone will not satisfy this requirement") | Not modelled | Possible under-scheduling for RN-BSN transfer students. |

Correct in our data (checked line by line): every ASN and BS course code, title and credit in the course list; ENGL 1010 or ENGL 1005; the ASN 71 / BS 120 totals; the ASN area split (20 Gen Ed + 51 core); the 2025-26 vs 2026-27 differences (NURS 4320 3 cr and NURS 4325 dropped in 2026-27, ENGH→ENGL 1005).

## What the plan schedules, nothing taken (measured, `node runplan.mjs`)

Nursing B.S. (8 terms, 120 cr, "Graduate Fall 2030"). Every item is REQUIRED by the catalog list unless marked:
- **Spring 2027**: BIOL 1610, ENGL 1010 · **NURS 2300, 2305, 2320, 2325, 2415: required, but NOT TAKEABLE (admission gate; added this early because the gate is parsed as "no prereqs")**
- Fall 2027: CHEM 1110, MICR 2060/2065, ZOOL 2320/2325, Quantitative Literacy (ONE-OF-A-CHOICE, counted 3 cr)
- Spring 2028: ENGL 2010, NURS 2310 (admission gate; also before the cohort), NUTR 1020, PSY 1100, ZOOL 2420/2425
- Fall 2028: NURS 2410, 2420, 2445 · American Institutions (ONE-OF) · Fine Arts, PPCG (Gen Ed placeholders, BSN-only)
- Spring 2029: NURS 2430/2435 (wrong cohort semester), NURS 3330/3335/3355, ZOOL 4400 (ONE-OF ZOOL 4400/2600; the planner picks the 4-cr one and counts 3), electives 2 cr (placeholder), Humanities (placeholder)
- Fall 2029: NURS 3340/3345 (wrong cohort semester), 3400, 3405, 3440, 3445, NURS 4230, electives 3 cr
- Spring 2030: NURS 4320, 4340, 4410G, 4500, 4510, 4520
- Fall 2030: NURS 4540 **with** University-level statistics (ONE-OF; same term as the course that requires it), NURS 4550

Nursing A.S.N. (6 terms, 71 cr, "Graduate Fall 2029"):
- **Spring 2027**: CHEM 1110, ZOOL 2320/2325 · **NURS 2300, 2305, 2320, 2325 (track options; admission gate ignored)**
- Fall 2027: BIOL 1610, ENGL 1010, PSY 1100, QL (ONE-OF) · **NURS 2415 alone (no coreq back to 2410)**
- Spring 2028: MICR 2060/2065, NUTR 1020, ZOOL 2420/2425, NURS 2310
- Fall 2028: ENGL 2010, NURS 2410, 2420, 2430, 2435, 2445
- Spring 2029: NURS 3330, 3335, 3340, 3345, 3355
- Fall 2029: NURS 3400, 3405, 3440, 3445

Nothing outside the catalog list is scheduled (no prerequisite-only courses like BIOL 1615 or MAT 1010, and no grad-plan-only PHIL 2050). So the "not required" feeling comes from **order and labelling**, not from extra courses. The one exception is the LPN case (#9).

## Flowchart (measured, `flow.mjs`: same code path as `app.js` → `foldLabs` + `flowChart`)
- B.S.: 35 boxes (labs folded). Column 1 = ENGL 1010, CHEM 1110, **NURS 2300+2305**, NUTR 1020. There's no admission box or gate, so nursing classes sit beside the first-semester prerequisites. Gen Ed row: QL, AI, PPCG, PSY 1100, Humanities, Fine Arts. The stats choice shows its 4 options, including the bogus "STAT 1040 + STAT 1045".
- A.S.N.: 14 boxes. **NURS 3330 in column 1** with no incoming arrow. The 15 Direct-RN courses plus 2 LPN courses are one "Choose one of the following tracks" box. NURS 3400/3405/3440 hang off 3330 only.

## Root causes (file:line)

| Rank | Bug class | Where | Nursing symptom | Other programs affected (measured on `data/programs`, 414 current; 2025-26 in brackets) |
|---|---|---|---|---|
| 1 | **Non-course gates (program acceptance, cohort) count as met.** The parser keeps the text (`prereqNonCourse`), but the planner never reads it, and never reads `program.admission`. There's no "apply / accepted" milestone and no "prerequisites to apply" set. | `scripts/fetch-program.mjs:563` (gate becomes `prereqs:null`); `js/planner.js:149-160` (`evalReq`: null = met); `js/planner.js:392` (no gate in ordering); `scripts/lib/post.mjs:250-258` (flag + note made, then never used: no hits in `js/`) | #1, #3, #4, #12 | **60** current programs schedule an acceptance-gated course in semester 1 (25 of them undergrad: nursing-asn/bs, dental-hygiene-aas/bs, respiratory-therapy-aas/bs, physical-therapist-assistant, OTA, social-work-bsw, elementary-ed, secondary-ed licensure, culinary-arts-aas, architecture-barch, BFA art/dance ...). **46** current programs carry `admission:true` that the UI never shows. **131** schedule a "University Advanced Standing" course in semester 1 (the same gate type, also ignored). |
| 2 | **Catalog grad plan is only a tiebreak.** Sorting is "longest chain first", so upper-division or cohort courses with long chains jump ahead of the catalog's sequence. | `js/planner.js:392` (`height` before `planSem`) | #1, #3 (NURS 2300 chain height beats semester-5 placement) | **123** current [250 all] programs schedule a course the catalog puts 3+ semesters later *before* one it puts earlier (e.g. biology-bs BIOL 4970R in semester 1; accounting-bs ACC 3010 before ECON 2010) |
| 3 | **Matriculation / "Admission Requirements" sections aren't parsed** (only `sc_courselist` tables are read) | `scripts/fetch-program.mjs:380` | #12 (the BS prerequisite list is lost) | **58** current programs name courses in that section; **18** of them name courses that are in **none** of our requirements (missing classes: paramedic cert 9 codes, forensic-science MATH 1050/1060, CS-BS ENGH 1005, language minors' 1010–2020 sequences ...) |
| 4 | **Double counting**: one course completes several units; catalog "only if not used for GE" notes are ignored | `js/planner.js:163-177` (`unitDone`/`choiceRemaining` per unit, no exclusivity) | #7 | 37 current [81] programs list the same code in 2+ requirements (upper bound; some legitimately overlap) |
| 5 | **One-way coreqs**: bundling only follows the course that names the coreq; a partner with no prereqs is placed alone, earlier | `js/planner.js:425` (bundle from `x.coreqs`); `buildModel` never makes coreqs symmetric (`js/planner.js:33,35`) | #2 | **11** current [22]: nursing ×2, respiratory-therapy ×2, digital-cinema ×3, culinary-arts-aas, collision-repair cert, architecture-barch, MPAS |
| 6 | **Track groups with more than 8 options fold into one box**, so their courses drop out of `byCode` and their prereqs count as "outside the program, met" for taps and arrows. Also no track picker. LPN experiential credit isn't modelled, so the leftover credits become phantom choice boxes. | `js/planner.js:10,77` (`MAX_OPTION_BOXES`); `js/planner.js:203` (`inProgram` = `byCode`); `js/planner.js:473-484` (`pickTrack` automatic); `js/planner.js:381` (leftover → generic boxes) | #9, #10 | **5** current [9] programs hide required-course prereqs inside a folded track (nursing-asn, pre-engineering-as, information-technology-bs, business-technologies-and-education-bs, digital-cinema-production-bs) |
| 7 | **Free-text note turned into an "all of these" option**: a note line naming codes without "or" becomes an option needing every code | `scripts/fetch-program.mjs:233-235` (filter lacks "only if / can be used / not used") | #6 | 1 current [2]: nursing-bs only (found by the "only if / can be used" heuristic) |
| 8 | **Prereqs written in words** ("a university-level statistics course") aren't linked to the matching choice group. Grad-plan labels that don't match ("Complete one of the following:") lose their semester hint. | `scripts/fetch-program.mjs:563` (codes only); `js/planner.js:133-141` (exact label match) | #5 | not counted (needs text matching; at least nursing-bs) |
| 9 | **Credits taken from the row/slot, not the course chosen** | `js/planner.js:25` (`r.credits ?? c.credits`), `js/planner.js:176,381` (slot credits) | #8, #11 | 28 current programs where the listed course's own credits differ from the row (e.g. EDSC 4850 row 8 vs 4 in every education BS; DCPR 1010L 1 vs 2); 207 with a pick-one choice whose options exceed the slot |

## Fixes, ranked by how much they cut the risk of taking a class you don't need (or taking one too early)
1. **Model admission programs as phases** (fixes #1, #3, #4, #12; helps about 60 programs). For `admission:true` programs, and any course whose prereq text names acceptance into a program or a cohort:
   - Parse the Matriculation section (or, failing that, the department's list for the cohort programs) into a `applyPrereqs` set.
   - Plan phase 1 = those prerequisites, then an "Apply to the program (competitive)" milestone row with the real deadlines, then the cohort.
   - Gate every acceptance-gated course on that milestone, both in the plan and in the flowchart taps. Show the catalog's admission sentence as a banner. For nursing, a hand-written cohort file (4 fixed semesters, built from the department outline) is the most accurate quick win.
   - Treat "University Advanced Standing" as a gate too (at least not in a first semester with nothing done).
2. **Respect the catalog's sequence**: sort by `planSem` first and chain height second, and never put a course before the catalog's semester for it unless prereqs force it. That fixes about 123 programs' out-of-order plans (needs the 866-file planner test re-run).
3. **Exclusive counting**: a course may complete only one unit unless the catalog says it double-counts (fixes #7, 37 programs to review). Honour "can be used only if not used for GE" notes.
4. **Symmetric coreqs** in `buildModel` (if A lists B, B gets A) so a lab or clinical always lands with its lecture (fixes #2, 11 programs).
5. **Track picker** in the UI for track groups (Direct RN vs LPN), plus model experiential credit (LPN 22 cr) instead of filling generic boxes. Show folded track courses' prereqs in tap checks: use all option codes in `inProgram` (fixes #9, #10).
6. **Parser**: don't turn "A and B can be used only if …" notes into options; add STAT 1045 as its own option (#6). Link worded prereqs ("university-level statistics course") to the choice group, and fuzzy-match grad-plan labels (#5).
7. **Credits from the chosen course** (#8, #11). Default an "A or B" requirement to the alternative the catalog grad plan uses (ZOOL 2600 for nursing).
8. **Label B.S.-only vs ASN/RN** items for nursing (the outline marks them "BSN option only"). Model the approved-elective list and the "2 upper-division NURS" rule.

## NOT verified
- What exactly Tim's girlfriend looked at (which program, catalog year, whether she imported an audit). The "not required" classes above are inferred.
- Real Banner sections for NURS cohort classes in Spring 2027 (the Schedule tab would list them only if sections exist).
- The 18 "missing matriculation course" programs were found with a regex over cached 2026-27 pages from 2026-10-15. Each needs a manual check: some may be optional placement routes.
- University Advanced Standing's exact rules weren't looked up.

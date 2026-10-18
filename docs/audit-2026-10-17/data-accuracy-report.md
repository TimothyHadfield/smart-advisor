# Smart Advisor: data accuracy audit (all programs)

Date: 2026-10-17. Read-only; no project file was edited and no `.claude` folder was opened.
Live site: https://timothyhadfield.github.io/smart-advisor/

**How it was measured.** The UVU catalog (CourseLeaf) pages were compared with the app's parsed program JSON (`data/programs/*.json` = 2026-27, `data/2025-2026/programs/*.json`) in three ways:

- independent re-extraction of the catalog requirement rows (`data/dump.mjs`)
- automated checks over all **865 program files** (413 current + 452 from 2025-26): `check.mjs`, `struct.mjs`, `census.mjs`, `textopts.mjs`, `pairor.mjs`
- running the app's own `buildModel`/`makePlan` on every program (`planrun.mjs`)

48 sample programs were fetched live at least 1 s apart into `data/live/`, and each was read side by side (`data/dumps/<id>.txt`). All scripts and outputs live in `C:\Users\timha\AppData\Local\Temp\claude\c--Users-timha-OneDrive-Desktop-my-website-Code-Projects\acb6c2a0-a1dd-4bfa-a442-735a1bbb5bef\scratchpad\sa-audit\data\`.

## 1. Headline

- **Course codes and credit totals are very accurate.** The credit sum matches the page total in **413/413** current programs; only 2 of 452 older files differ (bioinformatics-bs 118 vs 120, collision-repair-aas 67 vs 64). Only one catalog course code was really lost (MUSC 1236, commercial-music-bm); the other "lost" codes are the deliberate ENGH 1005 typo fix. The independent structure check found **0 courses wrongly made required** by the plain parser.
- **The real risk is meaning, not codes.** These all make a student think they must take a class they don't, or hide a rule they must meet:
  - tracks auto-picked with no chooser
  - recommended or sub-choice lists flattened into "required" track courses
  - pick-N lists drawn as ordinary course boxes
  - Gen Ed boxes the major already satisfies
  - lost grade, admission and cohort notes
- **The data is fresh.** Live list = 413 programs = cache = manifest. All 48 live sample pages were byte-identical to the 2026-10-15 cache. Catalog-year selection is correct.

## 2. Freshness and catalog year (measured 2026-10-17)

| Check | Result |
|---|---|
| Current edition on catalog.uvu.edu | 2026-2027 (archives: 2025-26, 2024-25) |
| Programs in live list vs app manifest | 413 vs 413 (377 ok, 36 warn), none missing or extra |
| 48 live sample pages vs 10-15 cache | 48/48 byte-identical |
| 2025-26 files | 452 (128 programs exist only in 2025-26) |
| 2024-25 | not fetched (app offers only 2026-27 and 2025-26) |
| Year selection (`js/programs.js` yearFor/programPath) | defaults to the current year; picker filters by year; a minor not offered that year falls back to its newest year |

Freshness risk: there is no scheduled re-fetch, and the catalog changes once a year (around May-July) plus mid-year edits. Recommendation: re-run `fetch-all.mjs` monthly in CI and fail on a diff that hasn't been reviewed.

## 3. Sample results (48 programs, stratified across colleges and award types)

"Disc." = discrepancies that matter to a student (wrong required/optional, wrong pick count, lost rule).

| Program | Disc. | Worst one |
|---|---|---|
| computer-science-bs | 3 | Track auto-picked; Secure track's "Complete 12 credits from" CYBR list planned as required; CS 1420 "and an additional 3 credit CS elective" dropped |
| business-technologies-and-education-bs | 2 | Business Education track auto-picked: plan lists student teaching (EDSC 4850 etc.) for everyone |
| dance-bs | 3 | "Strongly Recommended:" courses planned as required track courses; label "Complete 3 credits" on a 6-credit pick |
| dance-bfa (modern) | 2 | "Complete one of the following:" label on a 6-credit pick; Gen Ed "Choose one of…" list not tagged as Gen Ed |
| animation-game-development-bs | 2 | Note row "Includes 36 credits of upper-division" became a track; track auto-picked |
| professional-advancement-bap | 1 | "Complete the following (… Certificate): 16" parsed as "choose 16 credits", so required SLSS 2500/3200/4050G/4800 look optional |
| geology-bs | 2 | "GEO 3200 & 3205 or GEO 3500 & 3505": GEO 3200 made required, alternatives attached to GEO 3205 only |
| theatre-arts-as | 1 | Advisory sentences ("…are advised to take THEA 1113…") turned into options of the 15-credit elective, e.g. a 12-credit "THEA 1113 & 1223 & 2131 & 2156" bundle |
| nursing-asn | 3 | LPN track auto-picked; B- minimum grade and matriculation gate lost |
| respiratory-therapy-aas | 1 | "must be admitted to the program" cohort gate lost |
| social-work-bsw | 1 | Per-course admission note lost |
| english-creative-writing-ba | 1 | ENGL 4120R is required and in a choice; one take satisfies both, but the catalog says "different genre" |
| exercise-science-bs | 1 | Stats pick-one labelled "EXSC/General Elective" (borrowed from the grad plan) |
| music-bs | 2 | Ensemble pick labelled "MUSC Elective (lower division)"; "6 semesters of Concert Attendance" (0 cr) lost |
| art-design-bfa (graphic) | 1 | "Please note: ART 1400 is required for Graphic Design" left as an optional choice |
| art-aas (photo) | 1 | Same ART 1400 note |
| marketing-bs | 1 | Matriculation choice incl. MyEducator counted as 0 credits |
| elementary-education-bs | 1 | Recommended-electives note lost |
| pre-engineering (CE APE) | 1 | Core rebuilt from the sample grad plan, not from requirements |
| accounting-bs | 1 | B- grade rule not shown |
| dental-hygiene-bs | 1 | Minimum grade C note lost |
| mechanical-engineering-bs | 1 | Choice rules parsed but not enforced |
| paramedic cert | 0 | (no grad plan on page; nothing wrong in the data) |
| public-health-bs, criminal-justice-bs, spanish-ba, deaf-studies-interpreting-ba, chemistry-biochemistry-bs, math-actuarial, special-education, information-systems-data-analytics, hospitality-aas, sport-management cert, emergency-services-supervision-bap, forensic-lab-bs, humanities-social-sciences-aa, ASL cert, history-minor, physics-minor, biology-as, biology-bs, early-childhood-as | 0 | Codes, required/optional and credits match |
| cybersecurity-aas, automotive cert, cs-minor, aviation-as, finance-minor, nutrition-minor, psychology-bs, polisci-public-law, electrical-engineering-bs | 0 (automated) | Pass all automated checks; not read line by line |

Of 48 sampled programs, **22 had at least one discrepancy that matters; 26 were clean.** Most of the damage sits in programs with tracks, notes or admission gates.

## 4. Bug classes, counts and responsible code

Counts are **files across both years / current (2026-27) programs**, from `census.json`, `planrun.json` and `textopts.mjs`. Paths are relative to `Smart Advisor/`.

### Wrong required/optional (a student could take a class they don't need)

| # | Class | Count | Example | Code |
|---|---|---|---|---|
| T1 | Program has tracks; app silently picks one (most progress, then cheapest, then first); no chooser UI; plan names that track's courses | 31 / 16 | business-technologies-and-education-bs gets student teaching; computer-science-bs; nursing-asn LPN | `js/planner.js:473-484` pickTrack, `makePlan` 325-469 |
| T3 | Sub-choice or "recommended" list inside a track flattened into the track; planner fills the track in list order | 13 / 7 | CS Secure track CYBR "Complete 12 credits from"; dance-bs "Strongly Recommended:"; digital-cinema-production-bs | `scripts/fetch-program.mjs:212-240` (comment rows in a group), `finishChoice` 342-353 |
| T4 | Track lists more credits than the group needs (nested choice lost) | 10 / 5 | see census.json | same as T3 |
| T2 | Note row became a track | 1 / 1 | animation-game-development-bs "Includes 36/40 credits of upper-division" | `fetch-program.mjs:238` (NOTE regex at 126 lacks `^includes`) |
| R1 | "Complete the following (…)" with a parenthetical parsed as a credit pick | 1 confirmed / 1 | professional-advancement-bap | `fetch-program.mjs:249` regex, then 266-271 |
| PO | Pair-or: "A & B or C & D" makes A required and attaches the alternatives to B | 4 / 1 | geology-bs; 2025-26 digital-cinema-production-aas, writing-entertainment-media-minor (DCPR 1020 & 1020L or THEA 2742) | `fetch-program.mjs:187-196` (orclass targets last item) |
| AD | Advisory free text parsed into choice options | 6 / 1 (3 rows per year) | theatre-arts-as | `fetch-program.mjs:233-235` (exclusion regex lacks "advis") |
| G1 | Gen Ed box kept although a required major course is on that Gen Ed list (possible extra class; reasoned, depends on UVU double-count policy) | 160 / 77 | computer-engineering-bs Physical Science vs PHYS 2210; accounting-bs Social Science vs ECON 2010 | `js/gened.js` areasFor/genEdList, `js/planner.js` buildModel 11-82 |
| SN | Shared-list note makes a course required for one emphasis; stays optional | 2+ / 2 | art-design-bfa, art-aas "ART 1400 is required for Graphic Design" | `finishChoice` (notes not applied) |

### Misleading presentation

| # | Class | Count | Example | Code |
|---|---|---|---|---|
| OB | Pick-N choice lists drawn as separate dashed course boxes showing only code and title, with no "pick 1 of N" cue | 135 groups / 617 boxes in 101 current programs (205 files) | see planrun.json | `js/planner.js:10` MAX_OPTION_BOXES, `js/app.js:200-226` buildBoxes |
| L1 | Choice label's number differs from what it requires | 7 / 4 | dance-bs "Complete 3 credits" on a 6-credit pick | `scripts/lib/post.mjs:55-116` nameChoices (borrows plan labels) |
| L2 | Grad-plan label borrowed onto the wrong choice | several (sample: 2 of 48) | exercise-science-bs "EXSC/General Elective"; music-bs "MUSC Elective (lower division)" | `post.mjs:64, 72-79` |
| L3 | "Choose one of the following:" Gen Ed lists never tagged or named as Gen Ed | sample: dance-bfa | | `post.mjs` generic() requires `/^complete /` (line 114) |
| C1 | Pick-one list whose options differ by 2+ credits; plan counts the cheapest | 112 / 50 | see census.json | `js/planner.js` programCredits 506 |

### Rules and notes lost (data or app ignores them)

| # | Class | Count | Code |
|---|---|---|---|
| N1 | Minimum-grade rule on the page, not in data or app | 278 / 134 | not parsed |
| N2 | Upper-division credit rule not enforced | 351 / 177 | not parsed |
| A1 | Cohort/admission gate ("must be admitted before…") lost | 8 / 4 (respiratory-therapy-aas/bs, social-work-bsw) | not parsed |
| A2 | Admission flag parsed but never shown | 87 / 43 | `buildProgram` 637-672 sets `admission`; `post.mjs:253-259` admissionInfo; no use in `js/` |
| E1 | Entry/prerequisite courses dropped from plan and UI | 4 / 2 (autism minor and certificate) | `entryRequirements` unused in `js/` |
| R2 | Choice rules parsed but not enforced | 17 / 8 | `rules` unused in `js/` |
| M1 | Course title carries a dropped condition ("and an additional 3 credit CS elective", "different genre") | 50 / 24 | parseTable 136-317 keeps the title only |
| M2 | "Recommended:" sub-lists on the page | 12 / 6 | `fetch-program.mjs:286` (recommended only from title text) |
| M3 | "two consecutive semesters"/"times" in title, no repeat in data | 34 / 18 | parseTable |
| Z1 | Zero-credit requirements lost (music-bs concert attendance) | sample: 1 | parseTable |
| DC | Course both required and in a choice is satisfied once (ENGL 4120R) | sample: 1 | `makePlan` |

### Structural fallbacks

| # | Class | Count |
|---|---|---|
| O2 | Core rebuilt from the sample grad plan (`spliceCore`, `post.mjs:138-163`) | 6 / 4 (pre-engineering APEs, mechatronics AAS) |
| O3 | Core left as one placeholder | 2 / 1 |
| P1 | No grad plan on the page | 3 / 2 |

The app ignores these parsed fields entirely (grep of `js/`): `entryRequirements`, `otherTables`, `admission`, `admissionNote`, `rules`, `notes`, `recommended`, `open`.

## 5. Ranked fix recommendations, with the tests that pin each one

Each new test must first be seen to **fail on the current code** before the fix.

1. **Track chooser and nested sub-choices (T1, T3, T4, T2).** This is the biggest "take a class you don't need" risk.
   - Show a "Choose your track" picker; until a track is chosen, show the plan as undecided instead of auto-picking.
   - In the parser, make indented "Complete N credits from" and "Strongly Recommended" blocks inside a track into their own sub-choice or recommended list (`fetch-program.mjs:212-240`, `finishChoice` 342-353).
   - Add `/^includes\b/` and credit-count phrases to NOTE (line 126).
   - Tests:
     - golden JSON for computer-science-bs, dance-bs, animation-game-development-bs, business-technologies-and-education-bs and nursing-asn from frozen HTML
     - invariant over all 865 files: no track's credits exceed the group's credits by more than 15%, and no track name matches a note pattern
     - planner unit test: with no track chosen, `makePlan` names no track-only course
2. **Mark pick-N lists clearly (OB, L1-L3).**
   - Draw choice options inside one labelled group ("Pick 1 of these 4"), or collapse them into one box.
   - Add a sanity check in nameChoices that rejects a borrowed label whose number contradicts `pick`; accept "Choose/Select" in generic().
   - Tests:
     - invariant: a label's credit or count number equals `pick`
     - DOM test (headless, 393 px) that every `.box.flex` sits inside a group showing "pick"
3. **Gen Ed overlap (G1).**
   - Confirm UVU's double-count policy (the catalog says a course may satisfy major and GE where it is on both lists). Then auto-fill the Gen Ed box when a required major course is on that area's list, or at least show "may be met by PHYS 2210".
   - Tests: computer-engineering-bs and accounting-bs plans contain no separate Physical Science or Social Science box.
4. **Show the rules students must meet (N1, A1, A2, E1, R2, M1).**
   - Carry grade minimums, admission and cohort gates, entry courses, upper-division minimums and choice rules into a "Rules" panel per program. These are already parsed or easily parsed; the app just ignores them.
   - Tests:
     - golden check that nursing-asn shows B-, respiratory-therapy-aas shows the admission gate, and the autism minor shows its entry courses
     - invariant: every page sentence matching grade/admission patterns appears in the program JSON
5. **Small parser fixes, each with a one-program golden test.**
   - pair-or, `fetch-program.mjs:187-196`: attach an or-row to the whole preceding "&" group (test: geology-bs, both 2025-26 files)
   - "Complete the following (…)" regex, line 249: allow a parenthetical (test: professional-advancement-bap)
   - "advis" in the free-text exclusion, line 233 (test: theatre-arts-as has no `fromText` options)
   - apply "please note: X is required for Y" (test: art-design-bfa)
   - zero-credit rows (music-bs)
   - MyEducator credits (marketing-bs)
   - repeats from titles (M3)
6. **Regression net and freshness.**
   - Commit about 15 frozen catalog pages (the programs named above plus geology-bs and theatre-arts-as) with hand-verified expected required/optional/choice sets.
   - Run the `struct.mjs`/`census.mjs` invariants over all programs in CI on every parser change:
     - no course required that the catalog indents or lists as "or"
     - credit sum equals page total
     - no lost catalog codes
   - Schedule a monthly re-fetch that diffs against the last run.

## 6. Not verified

- G1 is a "possible extra class": whether UVU lets that major course also count for the Gen Ed area was not confirmed with UVU advising.
- 9 sample programs passed the automated checks but were not read line by line.
- 2024-25 catalog not fetched.
- Behaviour on a real iPhone was not checked; this audit covers data and planner logic only.

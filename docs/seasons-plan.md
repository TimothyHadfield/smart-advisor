# Seasons plan — classes only in the semesters UVU runs them

_2026-10-22 · builder `seasons` · status: BUILT (see progress.md)_

## Tim's words
- "I recently talked to my advisor and a bunch of the classes in certain majors and what not are sometimes only offered specific semesters (fall or spring). Is there anywhere online that says which classes at UVU are offered specific semesters?"
- "could you also fix the cite so it only allows classes that are offered those semesters to be taken in the stated semesters?"

## Before (what existed)
`data/seasons.json` (8 Banner terms, 2024 Fall – 2027 Spring) was a **preference** (D14): the plan could skip at most 2 terms waiting for a class, then put it in anyway. 17 off-season placements remained across all programs.

## Data source
UVU's public Banner 9 class search (no login): `https://userve.uvu.edu/StudentRegistrationSsb/ssb/`. Terms list `classSearch/getTerms`; sections need a cookie session (`term/termSelection` → POST `term/search` → `searchResults/searchResults?txt_subject=…&txt_term=…`). Term codes YYYY20 Spring, YYYY30 Summer, YYYY40 Fall. Fetched **per subject** (the all-subject listing reports exactly 8,192 for Fall 2026, which looks like a cap), ≤2 requests/s. Only course codes are kept.

Window: the **3 most recent terms of each season that have sections** (≈ the last 3 academic years, including posted future terms such as Spring 2027). A term posted only partly (fewer than 60% of the biggest same-season term's sections) is kept as extra evidence but doesn't push an older full term out.

## Rule
- A class is **offered in a season** if it had a section (any type: in person, online, hybrid, livestream) in at least one sampled term of that season.
- **Unknown = allowed**: a class with no sections in the window (new, catalog-only, renamed) may go in any semester.
- **Thin data = allowed**: a class seen in only one sampled term shows no pattern and is not blocked (kept from D14).
- "A or B" classes: allowed when either is offered; the plan names the one that runs that semester.
- Summer: same rule. With Summers off, a class that only ever runs in Summer gets that Summer added for it (it can't be taken otherwise).
- The plan never puts a class in a semester it isn't offered: it waits for the next semester it is (prereqs keep their order because a later class only becomes available once its prereq is placed).

## Where it applies
- Auto plan (`js/planner.js` `makePlan`): hard rule.
- Schedule tab "+ Add class": already lists only the term's real Banner sections (nothing to change).
- There is no manual "move a class" control yet (customization was parked), and plans are recomputed from taken classes on every load, so no saved placement can break the rule.
- Plan rows keep the existing "Usually Fall only" tag (D-A7).

## Ground truth
UVU's EE flowchart PDFs label each box "Offered F, Sp, Su" (`uvu.edu/cet/ece/docs/electrical/ee_flowchart_2026-2027.pdf`). Tests compare seasons.json with every ECE box on it.

## How others do it
Degree planners (Stellic, uAchieve Planner, EAB Navigate) store a per-course "terms offered" attribute and refuse to plan a course in a term outside it; ours derives that attribute from 3 years of real schedules.

## Tests (seen failing on the old code first)
ECE 3780 never in a Fall, ECE 4760 never in a Spring; EE BS auto plan puts every Spring-only ECE class in a Spring; unknown class allowed anywhere; summer rule; prereq order intact after season moves; all-programs sweep: 0 off-season placements.

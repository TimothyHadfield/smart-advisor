# Research (2026-10-15)

## Existing tools
| Tool | Free? | Good | Missing for UVU |
|---|---|---|---|
| [Wolverine Track](https://uvu.edu/wolverinetrack) (UVU official) | Yes | Real degree audit, what-if, student planner | No visual flowchart, no auto schedule builder, no professor ratings |
| [ChillSemester](https://alternativeto.net/software/chillsemester/about/) | Freemium (~$10–12/yr for audit) | Schedule builder with RMP scores | CUNY only |
| ConU Planner Ultimate (Chrome ext.) | Yes | Ratings in schedule builder, prereq tracking | Concordia only |
| "Schedule Builder RMP"-style extensions | Yes | Inline RMP ratings | Ratings only, other schools |

Conclusion: nothing free combines flowcharts + auto grad plan + schedule builder + RMP for UVU. Build it.

## Data sources (measured 2026-10-15 with curl)
- **Catalog = CourseLeaf**, public.
  - Program list: `https://catalog.uvu.edu/programs/` (~412 program links).
  - Program page tabs: `#requirementstextcontainer`, `#graduationplantextcontainer` (UVU's own semester-by-semester plan). Example: [Electrical Engineering BS](https://catalog.uvu.edu/engineering-technology/electrical-and-computer-engineering/electrical-engineering-bs/).
  - One course as XML/HTML with prereqs: `https://catalog.uvu.edu/ribbit/?page=getcourse.rjs&code=ECE%202250` → "Prerequisite(s): MATH 1210, PHYS 2220, ECE 1000", credits, description.
- **Class search (sections, times, instructors)** = CourseLeaf FOSE JSON API:
  `POST https://catalog.uvu.edu/course-search/api/?page=fose&route=search` body `{"other":{"srcdb":"202440"},"criteria":[{"field":"keyword","value":"ECE 2250"}]}` → CRN, section, `meetingTimes`, `instr` ("W. Sheikh"), dates.
  - **Only Summer 2024, Fall 2024, Spring 2025 exist** in this FOSE API (srcdb 202530–202720 return "Cannot open database").
  - ~~Current semesters appear to live only in myUVU (login).~~ **Wrong (corrected 2026-10-22):** UVU's public Banner 9 class search has every term Fall 2005 → Fall 2027 with no login: terms `https://userve.uvu.edu/StudentRegistrationSsb/ssb/classSearch/getTerms?searchTerm=&offset=1&max=200`; sections need only a cookie session (GET `term/termSelection?mode=search`, POST `term/search?mode=search` body `term=202640`, then GET `searchResults/searchResults?txt_subject=ECE&txt_term=202640&pageOffset=0&pageMaxSize=500`; POST `classSearch/resetDataForm` before each new search or Banner repeats the last one). Used by `scripts/fetch-sections.mjs` and `scripts/build-seasons.mjs`. The all-subject listing reports exactly 8,192 for Fall 2026, so seasons are fetched per subject (`classSearch/get_subject?term=…`).
  - Term codes: YYYY20 spring, YYYY30 summer, YYYY40 fall.
  - UVU's ECE flowchart PDFs label every box "Offered F, Sp, Su" (`https://www.uvu.edu/cet/ece/docs/electrical/ee_flowchart_2026-2027.pdf`): ground truth for `tests/seasons.test.mjs`.
- **Rate My Professors:** unofficial GraphQL API used by community wrappers ([npm wrapper](https://classic.yarnpkg.com/en/package/@ritchiefu/rate-my-professors), [pyrmp](https://pypi.org/project/pyrmp/)). Base64 school/teacher IDs. Not official; may change. Instructor names in UVU data are "F. Lastname", so matching needs last name + department.
- Tim's own EE flowchart: Lucidchart "Major Prerequisites" — behind Lucid login, not readable headless.

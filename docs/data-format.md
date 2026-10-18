# Program data: fields added for accuracy (2026-10-17)

Built by `scripts/fetch-program.mjs` + `scripts/lib/post.mjs`. Every field below is new and optional; no
existing field was renamed or removed, so older readers keep working. Golden tests on frozen catalog pages:
`tests/catalog-golden.test.mjs` (fixtures in `tests/fixtures/catalog/`, refreeze with `scripts/freeze-page.mjs`).

## Per requirement (`requirements[]`)
| Field | Shape | Meaning |
|---|---|---|
| `src` | string (≤500 chars) | The catalog lines this requirement came from: `Area (N credits) › instruction › row`, plus `(Note: footnote text)`. Shows *why* a course is listed. Program-level `url` is the catalog page. |
| `minGrade` | `'C'`, `'B-'`, … | Minimum grade the catalog states for this row ("Complete the following with a minimum C or higher", a footnote "must be completed with a grade of B- or higher"). On a choice it applies to every option. |
| `gate`, `gateText` | `'admission'` \| `'advanced-standing'`, string | The row can only be taken after program admission ("Must be accepted into Program to take these Courses", a footnote "must be formally admitted into the BSW program"). |
| `creditsBy` | `{ code: credits }` | Course row with "or" alternatives whose catalog credits differ (`ZOOL 4400` 4 / `ZOOL 2600` 3). `credits` stays the row's number. |
| `prefer` | code | The alternative the sample graduation plan uses, when it is not the first code. |
| `pairOr` | true | A choice built from "A & B or C & D" (both courses of a pair, or the other pair). |

## Track groups (choice with `tracks`)
| Field | Shape | Meaning |
|---|---|---|
| `subs` | `[{ section, label, pick:{credits}\|{count}, credits, open?, minGrade? }]` | A track's own pick lists ("Complete 12 credits from the following"). `credits` = pick credits, or count × cheapest option. |
| option `sub` | index into `subs` | This option is one of that sub-list's choices, **not** required. |
| option `recommended` | true | Advice only ("Strongly Recommended:" lists, "(Recommended)" titles). Not required. |
| option `prefer` | code | "A (Highly Recommended) or B": the slot is required; the advice favors A. |
| option `fromText` | true | Option read from a sentence that names courses ("from CS 2700, ECE 4850, …"). |
| `trackGrades` | `{ track: grade }` | A track's "Complete the following … with a minimum C-". |

**Rule:** inside a track, an option is required only if it has no `sub`, is not `recommended` and is not
`shared`. A track's total = its required options + its `subs` credits + `trackElectives[track]`.

## Per course (`courses{}` and `data/courses.json`)
| Field | Shape | Meaning |
|---|---|---|
| `gate`, `gateText` | `'admission'` \| `'advanced-standing'`, string | Prerequisite requires program admission ("Acceptance into ASN/BS Nursing program") or University Advanced Standing. |
| `prereqWords` | string[] | Prerequisite parts with no course code, kept word for word ("Completion of a university-level statistics course", "University Advanced Standing"). |
| `prereqMinGrade` | grade | Minimum grade the prerequisite line states. |

## Per program
`admissionInfo` (present when the page has a Matriculation/Admission Requirements section or any program
course is gated by admission):
```
{ note?, text?, before: [codes], beforeFrom?: 'matriculation section' | 'graduation plan',
  beforeLabels?: [plan slot labels], gated: [codes], minGrade? }
```
- `before`: courses to finish before applying. From the page's matriculation section; if it lists none, from
  the sample plan's terms before the first gated course (`beforeLabels` = that plan's unnamed slots).
- `gated`: courses that need program admission. `text`: the section's own words. `note`: the existing
  `admissionNote` sentence. `admission` / `admissionNote` are unchanged.

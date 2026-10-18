# Smart Advisor — UX / layout / features report (read-only)

_2026-10-17. Measured on the live site (https://timothyhadfield.github.io/smart-advisor/, build "Oct 17 2026 3:30 AM") with `phone-view.mjs`: iPhone 15 WebKit 393x659 and `--desktop` 1440x900. Programs: `electrical-engineering-bs`, `nursing-bs`, EE BS + `mathematics-minor` (via `--local smart-advisor:v1=...`). Screenshots in this folder. No console errors, no failed requests, no horizontal page overflow on any screen. Load is fast (loadEvent 371 ms, ~177 KB)._

## Screens captured
| File | What |
|---|---|
| p-landing.png / d-landing.png | First visit, no `?p` (lands on EE BS) |
| p-ee-flow.png, d-ee.png | EE flowchart phone / laptop (laptop = chart + plan) |
| p-ee-plan.png, p-nur-plan.png | Plan tab phone |
| p-nur-flow.png, d-nur.png | Nursing flowchart |
| p-ee-sched.png, d-sched.png | Schedule phone / laptop |
| p-settings.png, p-picker.png, p-combo-picker.png, p-gened.png, p-import.png, p-acct.png | Dialogs |
| d-combo.png, p-combo-plan.png | EE + Math minor |
| p-blocked.png | After tapping a box (COMM 2110 turned Taken) |

## Problems, ranked
Severity: **H** = misleads a student or loses their data · **M** = confusing / hidden · **L** = polish.

| # | Sev | Screen | Problem (measured unless marked reasoned) | Fix (plainest) |
|---|---|---|---|---|
| 1 | H | All | **No way to verify a requirement.** `program.url` (catalog page) and `fetched` date are in every program file but never shown. Nothing on any box or plan row links to catalog.uvu.edu. A student told "take NURS 2415" can't check it (Tim's girlfriend case). | Program name in the picker / plan header gets a small "Catalog ↗" link to `program.url`; add "Catalog 2026-27 · checked Oct 15" as a one-liner under the plan header behind a **?**. |
| 2 | H | Flowchart, Plan | **No "why is this class here".** Tapping a box only toggles Taken; plan rows aren't tappable. `courses.json` already holds `title`, `credits`, `prereqText` for 3,378 courses, unused in the UI. | Long-press a box / tap a plan row → small sheet: code, title, credits, requirement it fills ("Nursing core" / "Gen Ed: Quantitative Literacy"), prereq text, "Catalog ↗" course link, Taken switch. Reuse the Gen Ed sheet style. |
| 3 | H | Nursing (all `admission:true` programs) | **Admission/cohort programs look like normal plans.** nursing-bs has `admission:true` + `admissionNote` but no screen shows it. The plan puts NURS 2300 in the first semester alongside ENGL 1010, as if no application step existed (p-nur-plan.png). This is the kind of thing that made the nursing plan "not look like the requirements". | One amber line above the plan: "Needs program admission ?" (the ? opens `admissionNote` + catalog link). Builder/plan agents: keep pre-admission classes in earlier semesters (calc team's call). |
| 4 | H | Any `?p=` link | **`?p=` overwrites the saved plan on every load.** Measured: saved EE + Math minor, opened `?p=nursing-bs` → shows only "Nursing, B.S." and saves that. The URL never updates when you pick another program, so a bookmarked `?p=` link drops your minor/major every reload. | Apply `?p` once, then `history.replaceState` to the bare URL; keep the URL in sync with the picked programs (`?p=a,b`) so a link also shares a combo. |
| 5 | H | Settings | **"Clear taken" wipes every taken class in one tap**, no confirm, no undo (also clears the imported term). | Undo toast ("Cleared · Undo", 5 s) — matches "physical" feel better than a confirm dialog. |
| 6 | M | First visit | **A new student lands on EE BS with no hint** to pick their own major (p-landing.png); the only clue is a small ▾ after the name. Nothing says "tap classes you've taken" either. | First visit (no saved programs, no `?p`): open the picker automatically. After a program loads with nothing taken, show one dismissable line in the legend row: "Tap classes you've taken". |
| 7 | M | Flowchart phone | **Chart is ~3 screens wide** (nursing: 1230x676 px inside a 393x529 viewport), shown at full size; you see 1.5 columns and arrows run off-screen (p-ee-flow.png). No zoom/fit control; pinch zooms the whole page incl. header. | Pinch/two-button zoom on the chart only (fit-width ↔ 100%), default "fit" when the chart is ≤2x wider than the screen. Keep the chart's own scroll. |
| 8 | M | Plan, Flowchart | **Placeholder labels that say nothing**: "Complete a minimum of 5 cr…" ×2 (nursing), "Choose at least two mathema…" ×2 (math minor), "University-level statistics cour…". Truncated at 2-col width; a student can't tell what to take. Placeholders aren't tappable from the plan. | Short labels from the data team (e.g. "NURS elective", "Math minor elective"); tapping the plain row opens the same option list the Gen Ed ≡ sheet uses. |
| 9 | M | Phone, all dialogs | **Back button leaves the site.** No history entries for tabs or dialogs; on iPhone, swipe-back from Plan or from an open sheet exits the app (Tim's rule 10). | Push a history state when a tab changes or a dialog opens; `popstate` closes the dialog / returns to the previous tab. |
| 10 | M | Flowchart | **Gen Ed ≡ button is 22x14 px** (measured) — far under the 44 px tap target, sits on the box border. | Tap anywhere on a Gen Ed box opens the sheet (the sheet already has Untake); or grow the hit area to 44x32 invisibly. |
| 11 | M | Flowchart | **One-tap toggles Taken** with no feedback beyond colour; a scroll-flick on a box can mark it taken (reasoned; p-blocked.png shows COMM 2110 turned Taken from one click). Then the whole plan reshuffles. | Small "Taken · Undo" toast after each tap, same component as #5. |
| 12 | M | Import | Placeholder "Paste Wolverine Track audit" only. A student doesn't know where the audit is or what to copy. The **?** says only "Read on this device only". | Add a "Open Wolverine Track ↗" link (uvu.edu/wolverinetrack) + **?** text: "myUVU › Student › Wolverine Track › Save as PDF". |
| 13 | M | Picker | Opening the picker focuses the **Catalog** select with a heavy focus ring (p-picker.png); the year is the least-used control but sits at the top. Same focus ring on the **?** in Import and Account (p-import.png, p-acct.png). Settings was already fixed for this. | Blur on open (as Settings does) or focus Search; move Catalog below the list or into a small "2026-27 ▾" next to the chosen major. |
| 14 | M | Plan | No **trust/caveat line** anywhere. The site looks official (UVU green) but is unofficial and has known gaps (grade minimums, season-only courses, cohorts — see progress.md NOT verified). | One grey line at the bottom of the plan: "Unofficial · check with your advisor ?". The ? lists the known limits in ≤15-word bullets. |
| 15 | L | Settings | Plan and Schedule settings share one long sheet; on phone it fills the screen (p-settings.png). "Start", "Max credits" have no hint that they reshape the plan. | Keep one sheet; add a "Plan" section header to match "Schedule". |
| 16 | L | Schedule | Default prefs (Avoid gaps, Top rated, Main campus all ON) are silent; "1/20" + tiny ‹ › arrows are ~24 px wide. Rows don't look tappable (they are, to pin). | Arrows to 44 px; a faint › at row end. |
| 17 | L | Laptop | Laptop shows chart + plan side by side, good. Nursing chart's last column is cut at the plan edge (d-nur.png) with no scroll cue; Gen Ed row floats far below on EE. Not checked at 1280x800 (tool is fixed at 1440x900). | Fade edge on the right when the chart scrolls; check at 1280. |
| 18 | L | All | JS/CSS are fetched twice on every load (fresh.js re-fetches with `cache: 'reload'`). Cheap now (~70 KB) but doubles data on phones. | Fetch only the HEAD/version file, not every module. |

## How a student verifies today vs. should
- Today: nothing links out. They'd have to search catalog.uvu.edu by hand.
- Should: every program → catalog page link; every class → catalog course link + prereq text; every plan → "unofficial" line + catalog year + data date; a **"Report a mistake"** link (mailto or GitHub issue form prefilled with program id + class) so wrong data reaches Tim. That last one is cheap and directly serves "I really care about how accurate the requirements are".

## Prior art (brief)
- **Wolverine Track (UVU's own, Ellucian DegreeWorks-style)**: audit, planner, **what-if** and **look-ahead** ("how would these classes / this major change my timeline"). Smart Advisor already reads its audit; the gap is what-if.
- **Stellic**: drag a course between terms with warnings for missing prereqs and "not usually offered this term"; side panel of requirements still unplanned; build a schedule from planned courses; add a second program to see how existing credits apply.
- **DegreeWorks/uAchieve planners**: lock terms, mark courses planned vs. taken, notes per term, advisor-approved plans, print/PDF.
- **Coursicle**: class search with seats/waitlist alerts, share schedule with friends.
- **MyPlan-style (UW)**: credit total per term with min/max per term, cost estimate, export to calendar.

## Feature / customization shortlist (ranked by value to a UVU student)
Plainest version in Tim's style: no page scroll, phone bottom tabs, laptop side-by-side, choices in Settings, explanations behind **?**.

| Rank | Feature | Phone | Laptop | Notes |
|---|---|---|---|---|
| 1 | **Class sheet + catalog links** (fixes #1, #2) | Long-press box / tap plan row → bottom sheet: code+title, credits, "Fills: …", prereqs, Catalog ↗, Taken switch | Same sheet as a small popover beside the box | Data already in `courses.json` + program `url`. Biggest trust win. |
| 2 | **Report a mistake** | "Report ↗" inside the class sheet and under the plan | same | Prefilled GitHub issue / mailto; $0. Tim decides the destination (privacy). |
| 3 | **Admission + unofficial caveat lines** (#3, #14) | One amber line above plan; one grey line at the bottom | same, top of plan panel | Uses `admission`/`admissionNote`. |
| 4 | **Compare / what-if a second major** | Picker: "Compare" switch → plan header shows "EE: Fall 2030 · CE: Spring 2031 (+14 cr)" | Plan panel splits into two columns, one per major, same taken classes | Matches Wolverine Track what-if; the merge code (`programs.js`) already joins programs. |
| 5 | **Move a class to another semester / lock a semester** | Class sheet: "Semester ▾" picker (no drag on phone); semester header tap → lock icon | Drag a plan row to another semester; lock icon on semester header | Planner keeps locked/moved items fixed and re-plans the rest; warn if a prereq breaks. Calc team owns the planner part. |
| 6 | **Per-term credits** | Tap a semester's credit number → 6–21 picker | same | Extends "Max credits"; covers part-time terms. |
| 7 | **Share / print plan** | Header ⋯ → "Copy link" (URL with programs, #4) and "Print" (print CSS: plan grid only, one page) | same | Advisors ask for a printout; link needs no account. |
| 8 | **Cost + graduation estimate** | One line under "Graduate Fall 2030": "≈ $X tuition ?" | same | UVU tuition table by credit band; Tim decides (money/wording). Optional, Settings switch. |
| 9 | **Mark "In progress" / "Planned"** | Taken switch becomes Taken / In progress in the class sheet | same | Audit import already knows IP; tapping can't set it today. |
| 10 | **Schedule: prefer online/evenings per class** | In the class row of Schedule, a small mode chip | same | Settings already has a global mode. |
| 11 | **Notes per semester** | Tap semester header → one text line | same | Syncs with account; low cost. |
| 12 | **Offered-in-season warnings** | Small "Fall only" tag in the class sheet / plan row | same | Needs season data (NOT verified today); only once data exists. |

## Decisions that are Tim's (flag, build plainest meanwhile)
- Wording of the caveat line and admission line.
- Where "Report a mistake" goes (GitHub issue vs. email: privacy).
- Whether to show cost (money wording).
- Auto-opening the picker on first visit (changes the first screen).

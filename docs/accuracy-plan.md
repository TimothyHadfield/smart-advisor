# Accuracy + improvements plan (2026-10-17)

Tim (verbatim): "I really care about how accurate the requirements for majors are, as the consequences can lead to someone taking a class they don't need to take, or making extreamly financially large decisions on the basis of this information. I asked my girlfriend if the schedule looked like the requirements for her nursing program and she said some of the classes weren't required ... Go ahead and do a full analysis on smart advisor and implement any features, improvements, calculation changes, custumization, and smart layout that you can think of."
Tim, same evening: "don't ask me any questions from now on if you have a recommended answer."

Evidence: `docs/audit-2026-10-17/` (nursing-report, data-accuracy-report, calc-report, ux-report). Raw catalog pages + scripts: manager session scratchpad `sa-audit/` (raw/, data/, *.mjs).

## What's actually wrong (short)
- Course codes and credit totals match the catalog (413/413). The harm is in **meaning and order**:
  - Admission/cohort gates ignored → NURS 2300/2305/2320/2325/2415 in semester 1 (60 programs gated, 46 admission flags never shown, 131 Advanced Standing courses early).
  - Catalog's sample sequence only a tiebreak → 123 programs invert it by 3+ semesters.
  - One course counts for two requirements (37 programs; nursing STAT 1040 twice); required course also in an elective group (27 groups).
  - One-way coreqs split pairs (11) and labs planned before lectures (21).
  - No track chooser (16 programs); lists inside tracks treated as required (7).
  - "Pick N" lists drawn like required classes (617 boxes / 101 programs).
  - Out-of-program prereqs assumed met (184 programs, ~1,072 credits hidden).
  - Seasons ignored (716 placements contradict Banner); summers planned as full terms.
  - Grade minimums ignored; audit counts D/D- as passed.
  - No way for a student to verify a class (no catalog link, no "why is this here").

## Decisions (Claude, per Tim's "don't ask if you have a recommendation")
- D-A1 Admission programs plan in phases: **Before you apply** (prereqs) → **Apply** milestone row → **Program** semesters in catalog sequence order. Gated courses never land before the Apply milestone. Advanced Standing treated as a gate too.
- D-A2 Placement order: catalog sample-plan semester first, prereq chain second.
- D-A3 A course satisfies ONE requirement unless the catalog says it may double count. Gen Ed: a required major course that is on a Gen Ed area list fills that Gen Ed box **only if UVU's catalog policy allows** (builder researches; if unconfirmed, keep separate and show "may also count for <area> — ask your advisor").
- D-A4 Coreqs are two-way and must be the SAME term.
- D-A5 Track chooser: show the guessed track with a clear "Guessed — pick yours" chip; never block the plan.
- D-A6 Out-of-program prereqs: shown as "Needed before" boxes (not assumed met), with a "Already have it / placed out" tap.
- D-A7 Seasons from Banner are a preference (one year of data), shown as "Usually Fall only".
- D-A8 Grade minimums shown on the class sheet + D/D- from the audit don't satisfy a C- minimum.
- D-A9 One plain line on plan screens: "Unofficial plan — confirm with your advisor." Admission programs add: "Requires admission — apply after these classes."
- D-A10 "Report a mistake" link → GitHub issue on the public repo (no email shown).
- D-A11 No cost estimate (money data, parked).

## Wave 1 (parallel, separate worktrees under Temp/claude/wt/sa-*)
| Builder | Owns | Must not touch |
|---|---|---|
| sa-plan (planner) | `js/planner.js` + planner tests: D-A1, A2, A3 (within one program), A4, A5 model (`opts.track` / `settings.tracks[groupId]`), credits from the chosen course, grade-minimum data passthrough. Exposes `planPhases(plan)` and `requirementFor(code)` for the UI | app.js/css, scripts/ |
| sa-data (parser) | `scripts/`, `data/` regeneration, parser tests + golden frozen pages: track inner lists as choices, note-made options (nursing STAT), prereqs-in-words, Geology/BAP/Theatre/Animation bugs, MUSC 1236, choice-list title counts, admission/gate fields on each course (`gate: 'admission'|'advanced-standing'`), catalog source text per requirement (`src`) | js/ (except reading) |
| sa-ui (screens) | `index.html`, `css/app.css`, `js/app.js` UI only: class sheet (tap plan row / long-press box: title, credits, prereqs, grade min, catalog link, "why it's here"), D-A9 lines, D-A10 link, `?p=` no longer overwrites saved plan (URL follows the picker), Clear taken confirm + undo, first-visit picker prompt, phone flowchart fit-to-screen, back button history for tabs/sheets, bigger Gen Ed ≡ tap target, no focus ring on open, "pick N" boxes grouped with a "Pick N" label, track chooser chip (calls planner API; stub until sa-plan merges) | planner.js internals, scripts/ |

Merge order: sa-data → sa-plan → sa-ui (each rebases). Full suite `node --test tests/*.test.mjs` + `planner-all` must pass at every merge.

## Wave 2 (after wave 1)
- Seasons data from Banner (`data/seasons.json`) + planner preference + summer rules (D-A7).
- Out-of-program prereqs as boxes (D-A6), grade minimums in audit (D-A8), audit outside classes reduce electives.
- Major+minor double counting; 120 total / 40 upper-division checks with a warning line.
- Customization: move a class to another semester (dropdown phone, drag laptop), lock a semester, credits per semester, "In progress" mark, share link + print.
- What-if: compare a second major's remaining credits.

## Done gate
Nursing BS/ASN plans: no NURS course before the Apply row; cohort order matches catalog sequence; STAT 1040 counts once. EE: ECE 3710/3740 after ECE 2250. Live at 393 px + laptop screenshots. Tests pinned to each finding, seen failing first.

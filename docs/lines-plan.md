# Flowchart lines: simpler and cleaner (2026-10-22)

Tim: "could we also work on our flowchart and lines connections even more? I would really like it to be as maximally simple and clean as possible. Any turns and crossovers should be minimized as much as possible." (earlier, 10-15: lines should "overlap as little as possible")

Tim, on the matriculation line: "we made the matriculation dotted line, but we also move the classes around for it. I was meaning that we would keep the flowchart identical to how it is and we would bend the dotted line to fit around the classes."

## Measure
`node scripts/chart-stats.mjs [--no-split] [--out f.json] [--only id,id] [--top 10]` draws every program (866 files: data/programs + 2025-2026) the way the site does (labs folded, Gen Ed section, laptop box size) and counts per program: crossings, bends (corners as drawn; a shared trunk's corner counts once), overlaps (lines on top of each other), boxHits, length, size, ms; with the matriculation line: strays, sepBox, sepCross.

## Methods (all standard layered-graph drawing)
- **Layers + crossing reduction** (Sugiyama, Tagawa, Toda 1981): longest-path layers, dummy boxes for long arrows, then **median/barycenter sweeps** (Eades & Wormald 1994; Gansner et al. 1993, "dot") with **transpose** (adjacent swaps), from 40 seeded random starts. The sweep now stops after 4 sweeps without a better order.
- **Several candidates, scored as drawn**: the best few orders with bundles and the best few without are each routed at laptop size and scored as the eye sees them: crossings × 100, overlaps of unrelated lines × 30, other overlaps × 3, lines through boxes × 50, bends × 2, then length and height. The simplest drawing wins. Measured: no program got worse in crossings, and the regression test below keeps it that way.
- **Edge concentration / bundling** (Newbery 1989, "Edge concentration: a method for clustering directed graphs"): a group of sources that all lead to the same targets in one column (a biclique) is drawn as one upright bar in the gap before the targets: each source joins the bar, each target leaves it. One bar replaces |S|·|T| lines with |S|+|T|. "Or" lines bundle only from one source (so the dashes stay in step).
- **Straight lines** (Brandes & Köpf 2001 style block alignment): unchanged.
- **Orthogonal routing**: ports spread on each box side; one jog per arrow where it fits; jogs in one gap ordered by exact bitmask DP to cross least (track assignment); a bar is a jog with several ins and outs.

## Matriculation line (redone)
The layout ignores matriculation: boxes sit exactly where they would without it (test: positions identical with and without). The line is drawn after: a DP over row bands (`sepPlan` in js/layout.js) picks, band by band, the column gap that puts every box needing matriculation on the right and every other box on the left. It steps sideways only between rows where no box is in the way, then prefers fewer steps and fewer arrows crossed. In each gap it runs halfway between two tracks, where it shares the least height with their uprights. It takes no room of its own. When no single line can separate the boxes (a box needing matriculation with one that doesn't to its right in the same row), that box gets its own dotted outline: 142 of the 203 charts with a line have at least one such box, 224 boxes in all.

## Results (before = layout before this work and before matriculation; all 866 files)
| | before | after |
|---|---|---|
| crossings | 2389 | 748 |
| bends | 8419 | 6566 |
| overlaps | 1250 | 118 |
| programs worse in crossings | | 0 (better 107) |

Guard: `tests/chart-crossings.test.mjs` + `tests/fixtures/chart-crossings.json` (per-program maximum; lower when better, never raise).

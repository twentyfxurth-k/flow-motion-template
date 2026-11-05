# Flow Motion · lessons from real use

Each entry: what the user saw → cause → fix. "Engine" fixes are already in `index.html`; "data" fixes are what you do in `flow.js`.

## Layout

| What the user saw | Cause | Fix |
|---|---|---|
| Lines run diagonally from a box to a waypoint | `via` segments were drawn straight from the box edge to the first / last waypoint | **Engine:** every `via` segment is now forced horizontal or vertical (an elbow is added). Data: still give waypoints on a clean grid. |
| "Boxes overlap" / a line seems to cut through a box | Boxes of the other mode were drawn faint (ghost) under the lines of the current mode | **Engine:** `ghost: 'hide'` option; the audit reports lines and labels over faint boxes when ghosts are shown. Data: use `ghost: 'hide'` when both modes use the same area, or route around. |
| A label sits on top of another line ("yes" over "save") | A vertical edge crossed a long horizontal edge right where both labels were | **Engine:** audit rule "label sits on edge". Data: move the box so the edges do not cross, or move the label with `lt` (0..1 along the line). |
| Text sticks out of a box | Title / subtitle wider than the box; diamonds only use ~62% of their width | **Engine:** audit measures real text width per mode. Data: widen `w`, or shorten `t` / `s` (move detail to `tip` / `detail`). |
| Widening a box made a new collision | The wider box reached a line routed close to the lane edge | Prefer shorter text over wider boxes near lane edges; re-run the audit after every size change. |
| Shared box showed the other mode's wording (e.g. option "B" text in the old mode) | One node used in both modes with mode-specific text | **Engine:** `byMode: { modeId: { t, s, tip, detail } }`. |
| A side effect looked dimmed in "path only" | No step moved along that edge, so it was not on the path | Add a token for the side effect (`at` + `mv`), e.g. a "status write" token. |
| Page too wide on a phone | Button rows did not shrink | **Engine:** fixed (`.btns{flex:1;min-width:0}` + column layout under 640px). |

## Engine behaviour

| What happened | Cause | Fix |
|---|---|---|
| Play stopped after the first animated step (headless, background tab) | `requestAnimationFrame` is paused there | **Engine:** `frame()` = rAF with a 50ms timer fallback. |
| Stepping scrolled the whole page | `scrollIntoView` on the step list item | **Engine:** scroll only the list container. |
| Esc did nothing in some cases | `keydown` from `document` has no `closest()` | **Engine:** guard `ev.target.closest`. |
| Exported SVG / PNG showed every box bright although the page dimmed them | Opacity fades with a CSS transition; the export read the style mid-fade | **Engine:** export adds `svg.fm-snap` (transitions off) before reading computed styles. |
| Page went blank after adding the HTML export | A literal `</script>` inside the inline engine script closed the tag early | **Engine:** write `<\/script>` in JS strings inside HTML. Syntax-check the extracted script with `node --check`. |
| `--dump-dom` parser read a code comment instead of the result | The engine's own source (in the DOM) contained the marker `<pre id="…">` | Never put a marker the tools grep for inside a comment or string of the page. |
| A label sat on the lane title, audit said 0 | No rule for lane titles | **Engine:** audit rule "label / box / tag covers lane title". |

## Content accuracy (the expensive mistakes)

| What happened | Fix |
|---|---|
| Steps were merged into one box ("processOrder") and the user lost the detail they needed | One box per real call; keep the code reference in `s` / `detail`. |
| A claim was nearly written from memory (which service a task uses) and was wrong on first look | Read the code path to the actual client call before labelling a box; cite `file:line`. Re-check when two files disagree (config vs code). |
| A log line assumed to mark "end of request" only printed on panic | Before using a log line, a status field or a field in an analysis, confirm it is on the normal path in the code. |
| A design change was drawn before the user agreed, then had to be reverted | Draw proposals only after the user says yes; keep a backup of `flow.js` before big edits so a revert is one copy. |
| A proposed value became wrong after new facts arrived (a timeout shorter than the call's normal latency) | When new facts arrive (timeouts, latencies), re-check every place that depends on them: tips, diff rows, questions. |
| Real flows must never end up in a shared template | Template = generic example only. Before every commit, have an independent reviewer (agent) grep and read every file for company or private terms; keep real flows outside it. |

## Visual review checklist (what the scripts cannot judge)

For every mode screenshot:

1. Every line is horizontal / vertical, ends on the right side of the right box, and can be followed without guessing.
2. No two labels or tags touch; no label sits on a line it does not belong to.
3. No box, tag or label is cut off at a lane edge.
4. Lines do not run on top of each other for long stretches unless they share an end.
5. A reader can tell what changed between modes (tags `NEW` / `OLD`, diff table).
6. Every number and claim in titles / tips matches the source (file:line) or is marked as an estimate.
7. Wording in shared boxes is true in every mode.

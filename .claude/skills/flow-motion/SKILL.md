---
name: flow-motion
description: Build or update an interactive, animated before/after flowchart with the Flow Motion template (index.html engine + flow.js data). Use when the user wants to visualise a request flow, compare a current and a proposed design, show what happens in failure scenarios, or asks for a "flow motion", "motion flowchart", "animated flow", "before vs after diagram". Includes the audit loop (data check, layout audit, self test, visual review) that must pass before the page is handed over.
---

# Flow Motion

Turn a real flow (code, design doc, logs) into one static page: lanes, boxes, arrows, coloured tokens that move step by step, modes (before / after), scenarios, a state panel and a diff table.

Template repo: <https://github.com/twentyfxurth-k/flow-motion-template>

- `index.html` engine (generic, do not put flow data here)
- `flow.js` all flow data (`window.FLOW = {...}`)
- `validate.js` data rules · `tools/check.mjs` CLI check · `tools/audit.mjs` full headless audit · `tools/export.mjs` SVG / PNG / one-file HTML
- `AGENTS.md` full schema, layout rules, error table · read it before writing `flow.js`

## 1. Set up

- New page: copy `index.html` + `validate.js` from the template into the target folder, write a new `flow.js` next to them. Keep `tools/` in the template; run it with a path.
- If the template is not on disk: `git clone https://github.com/twentyfxurth-k/flow-motion-template` (or ask the user where it lives).
- The data may be private (company flows). Keep `flow.js` where the user's other private docs live. Never copy private data into the template repo.

## 2. Model the flow (read the source first)

1. Read the code / doc. For every box you draw, note the `file:line` it comes from. Put it in `s`, `tip` or `detail`.
2. Lanes = actors or systems. Main path top → bottom, errors and side effects to the right.
3. Split big steps. One box per real call (e.g. "Charge card", "Save order", "Send email"), not one box per function. Users ask "where did the details go?" when steps are merged.
4. Parallel work (goroutines, `Promise.all`) = one box per task in a row, a fan-out bus and a fan-in bus (`via` on a fixed y).
5. Modes: put mode-only boxes in different spots, or set `ghost: 'hide'` when the modes share the same space.
6. A box that exists in both modes but means something different per mode: use `byMode: { modeId: { s, tip, detail } }`. Do not write the other mode's words into a shared box.
7. Side effects (status writes, logs, emails) get their own token and steps (`at` + `mv`), so "path only" highlights them and the state panel changes at the right moment.
8. Unsure about behaviour → `questions` entry + tell the user. Do not invent.

## 3. Audit loop · must be clean before you hand the page over

```sh
node <template>/tools/check.mjs  <dir>/flow.js           # data rules        → ✔ OK · 0 warning(s)
node <template>/tools/audit.mjs  <dir> --shots /tmp/fm   # check + layout + self test + 1 screenshot per mode
```

`audit.mjs` exit 0 means: no data errors or warnings, 0 layout issues in every mode, every scenario × mode plays to the end with no JS error.

Then do the visual review — the scripts only catch what they have rules for:

- Spawn the **flow-motion-auditor** agent (`.claude/agents/flow-motion-auditor.md`) with the folder, the source files it was built from, and what the user asked for. It runs the scripts, opens every screenshot, compares claims with the source, and reports. It does not edit.
- No agent available: open each screenshot yourself (`--shots`), and go through the checklist in `LESSONS.md` § Visual review.

Fix, re-run, repeat until the scripts are clean **and** the review has no findings. Report the numbers to the user (errors, warnings, layout issues, runs, JS errors).

## 4. Hand over

- Tell the user what was modelled, what came from code (with file:line) and what was assumed.
- Mention anything the audit cannot judge (readability of dense areas, wording).
- Files to share: `node <template>/tools/export.mjs <dir> --out <dir> [--mode m --scen s --step n] [--formats png]` → SVG / PNG of that moment, or one HTML file that plays offline (no folder to zip). Same as the `⬇ Export` button. Exports carry the flow data: same privacy rules as `flow.js`.
- Deep links for sharing a moment: `index.html#mode=<id>&scen=<id>&step=<n>&sel=<nodeId>`. Chart only: `#view=chart`.

## Known problems and fixes

Read `LESSONS.md` in this skill folder. It lists the bugs met in real use, how each showed up, and the fix (engine or data).

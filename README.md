# Flow Motion

An interactive, animated flowchart in a single static page. Show how requests, messages and emails move through a system, step by step, and compare **before** and **after** a change across many **scenarios**.

No build, no dependencies, no network. Open `index.html` in a browser.

![Flow Motion: modes, diff table, scenarios, tokens, flowchart and state panel](docs/screenshot.png)

## Features

- **Flowchart:** lanes, boxes (rect, start/end, decision, database, task, note), arrows with labels and waypoints.
- **Motion:** coloured tokens move along the arrows. Play, pause, step, step back, speed, click any step to jump.
- **Modes:** show the same flow before and after a change. Boxes that exist only in one mode appear as a faint ghost in the others.
- **Diff table:** a short "what changes" table for the selected modes.
- **Scenarios:** each scenario has its own steps per mode, plus a one-line outcome.
- **State panel:** counters (green when right, red when too many), values, and table rows that fill in as the story plays.
- **Path only:** dims every box and arrow that the current scenario does not touch.
- **Click a box:** a highlighted detail card at the top of the right panel: a **what it is / what it solves** summary, the full details, its neighbours and related questions. `✕` or `Esc` closes it.
- **Rich tooltip:** hover a box and a tooltip opens **beside** it (never on top). `tip` supports one bullet per ` · ` part, inline `` `code` `` and `**bold**`.
- **Same rich text everywhere:** edge `tip` and comment text use the same rich text as node tips.
- **Code boxes:** fenced blocks inside `tip`, `detail` and question text render as a monospace box.
- **Diff markers:** in a code box, a line starting with `+ ` is shown green (new) and `~ ` amber (changed); other lines are existing code.
- **Configurable labels:** `FLOW.labels` renames the card header, the `what` / `why` captions and the tooltip hint.
- **Questions drawer:** open questions with options, pros and cons, checkboxes and notes.
- **Comment mode:** click anywhere on the chart to pin a comment; export as JSON or Markdown, import JSON.
- **Export (`⬇ Export` / `X`):** SVG or PNG of the chart exactly as shown (mode, step, theme, Path only, tokens), or the whole page as **one HTML file** (engine + data) that plays offline. Option: include faint boxes of other modes.
- **Move boxes (`✥ Move`):** drag a box to a new place; edges and waypoints follow, the layout audit re-runs, undo / redo with Ctrl/Cmd+Z. The draft is kept in your browser; `▾ Layout → 📋 Copy positions` gives a `layout: {…}` block to paste into `flow.js`.
- **Deep links:** `#mode=after&scen=timeout&step=12&sel=node_id` opens that exact moment.
- **Built-in validation:** the page and `node tools/check.mjs` list every data error (missing edges, hidden nodes, token jumps, overlaps).
- **Layout audit:** the page lists every visual collision per mode (text overflow, lines through boxes, labels on lines, labels on lane titles, stacked lines).
- Light and dark themes, keyboard shortcuts, works offline from `file://`.

## Quick start

```sh
open index.html            # macOS   (or double-click it)
node tools/check.mjs       # check flow.js
```

The example in `flow.js` is an online checkout before and after adding an idempotency key and an email queue.

## Make your own flow

Everything about your flow is in `flow.js`. The engine (`index.html`) stays the same.

1. Copy this folder.
2. Replace the contents of `flow.js` (schema in [AGENTS.md](AGENTS.md)).
3. Run `node tools/check.mjs` until it prints `✔ OK`.
4. Open `index.html`.

### With an AI agent

Point your agent at this folder and ask, for example:

> Read `src/checkout/` and build a Flow Motion page in `flow.js` for the checkout flow. Two modes: current and proposed. Scenarios: happy path, payment timeout then retry, email server down. Run `node tools/check.mjs` until it passes.

`AGENTS.md` has the full schema, layout rules and checks. It is read automatically by agents that support `AGENTS.md`; `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursor/rules/flow-motion.mdc` and `.kiro/steering/flow-motion.md` point to it for the others.

## Check before you share

```sh
node tools/check.mjs                    # data rules
node tools/audit.mjs . --shots shots    # data + layout (every mode) + self test (every scenario) + exports + screenshots
```

Export from the command line (same output as the button; for docs, CI or an agent):

```sh
node tools/export.mjs . --out export                                  # svg + png + html of the first mode / scenario
node tools/export.mjs . --out export --mode after --scen timeout --step 12 --formats png --theme light
```

Both exit 0 when clean. `node tools/drag.test.mjs` tests box dragging with real pointer input (Node 22+, bundled example only). Then look at the screenshots: lines, labels and wording are easier to judge by eye.

## Claude Code

This repo ships a skill and a reviewer agent:

- `.claude/skills/flow-motion/` · how to build a page, the audit loop, and `LESSONS.md` (bugs met in real use and their fixes)
- `.claude/agents/flow-motion-auditor.md` · runs the scripts, opens every screenshot, checks claims against the source, reports only

They load automatically when Claude Code runs in this folder. To use them everywhere, copy them to `~/.claude/skills/flow-motion/` and `~/.claude/agents/`.

## Keyboard

| Key | Action |
|---|---|
| `Space` | play / pause |
| `→` / `←` | step forward / back |
| `R` | reset |
| `M` | next mode |
| `1`–`9` | scenario |
| `P` | path only |
| `F` | fit width / real size |
| `Q` | questions |
| `C` | comment mode |
| `X` | export menu |
| `Esc` | close / clear selection · cancel a drag |
| `↑ ↓ ← →` | with `✥ Move` on and a box selected: move it 10px (`Shift` = 1px) |
| `Ctrl/Cmd+Z` · `Shift+Ctrl/Cmd+Z` | with `✥ Move` on: undo / redo a move |

## Files

| File | What it is |
|---|---|
| `index.html` | Engine and UI |
| `flow.js` | Your data (`window.FLOW`) |
| `validate.js` | Data checks, shared by the page and the CLI |
| `tools/check.mjs` | `node tools/check.mjs [file]` · data rules, no browser |
| `tools/audit.mjs` | `node tools/audit.mjs [folder] [--shots dir] [--json]` · headless check + layout + self test + export check |
| `tools/drag.test.mjs` | `node tools/drag.test.mjs [folder] [--shots dir]` · headless test of dragging boxes (bundled example) |
| `tools/export.mjs` | `node tools/export.mjs [folder] [--out dir] [--formats svg,png,html] [--mode m] [--scen s] [--step n] [--ghost] [--theme light\|dark]` |
| `.claude/` | Claude Code skill (`flow-motion`) and reviewer agent (`flow-motion-auditor`) |
| `AGENTS.md` | Guide for AI agents: schema, rules, verification |

Comments, answers, view settings and moved box positions are stored in the browser (`localStorage`) under `flowmotion:<FLOW.id>:`. Export comments to share them.

## Contributing

`main` and `release` are protected. Fork or branch from `main` (`feat/…`, `fix/…`, `docs/…`) and open a pull request. The maintainer reviews and merges. Releases are tagged `vX.Y.Z` on `release`. Before you open the PR, follow `AGENTS.md` § "Changing this repo", the single source of truth: it covers `node tools/check.mjs`, `node tools/audit.mjs .` (both exit 0) and an independent sensitive-data review of the diff. Never commit real flows or other sensitive data: this repo is public.

## License

MIT, see [LICENSE](LICENSE).

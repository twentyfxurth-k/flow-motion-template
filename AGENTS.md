# AGENTS.md · Flow Motion

Instructions for any AI coding agent (Claude Code, Codex, Cursor, Copilot, Gemini, Kiro, Windsurf, Aider, and others).
Read this whole file before you edit anything.

## What this project is

Flow Motion is one static page that draws a flowchart and animates "tokens" (requests, messages, emails) moving through it, step by step.
It compares **modes** (for example "before" and "after" a fix) across **scenarios** (for example "happy path", "timeout → retry").

- `index.html`: the engine. It is generic and knows nothing about any real system.
- `flow.js`: **all the data**. It sets `window.FLOW = { ... }`.
- `validate.js`: checks `FLOW` (used by the page and by the CLI).
- `tools/check.mjs`: run `node tools/check.mjs` to check `flow.js` without a browser.

No build step, no dependencies, no network. Open `index.html` in a browser (a `file://` URL is fine).

## Your job, usually

The user asks you to turn a real flow (code, a design doc, logs, a meeting note) into a Flow Motion page.

1. **Edit `flow.js` only.** Do not change `index.html` or `validate.js` unless the user asks for an engine change.
2. Read the source material first. List the actors, steps, decisions, stores, and the calls between them.
3. Write `flow.js` (schema below). Start from the example in this repo and replace it.
4. Run `node tools/check.mjs`. Fix every `✖` error. Fix `⚠` warnings unless you have a reason.
5. Open the page (or render it headless, see "Verify") and look at it. Fix overlaps and long labels.
6. Tell the user what you modelled, and anything you assumed or could not confirm.

If the user wants to keep their flow private, keep their `flow.js` out of any public repo. The engine is generic; the data is theirs.

## Changing this repo (branches, PRs, releases)

This applies when you change the template itself (engine, tools, docs, example). It does not apply to a user's own copy.

- `main` and `release` are protected: **no direct push, no force push, no delete.** Every change goes in through a pull request.
- **Only the maintainer merges.** As an agent: open the PR, report the link, and stop. Never merge, never approve your own PR, never ask for or use a bypass.
- `required_approving_review_count` is intentionally 0: GitHub does not let the maintainer approve their own PR, outside contributors cannot push (they must fork and open a PR), and only the maintainer can merge.
- Branch from `main`, one topic per branch: `feat/<name>`, `fix/<name>`, `docs/<name>`. Never commit on `main` or `release`.
- Before every commit:
  1. `node tools/check.mjs` and `node tools/audit.mjs .` exit 0.
  2. Sensitive-data review: have a reviewer that does not know your context (another agent, or a person) read the whole diff and every file it touches for sensitive data, for example: company names, internal system or table names, people, paths with user names, hosts, account ids, tokens and non-example data. Fix every hit before you commit. Nothing sensitive may ever enter history: this repo is public.
- PR description: what changed, why, and the audit numbers (errors, warnings, layout issues, runs, export sizes).
- Releases (maintainer only): merge `main` into `release` through a PR, then tag the release commit `vX.Y.Z` (semver: new feature → minor, fix → patch). Tags `v*` are protected: they cannot be moved or deleted, so tag only what is final.

## Mental model

```
lanes      background columns (actors / systems)
groups     dashed frame behind boxes that run at the same time (goroutines + wg.Wait, Promise.all, async fan-out)
nodes      boxes at (x, y) = centre point
edges      arrows "a>b" between nodes
modes      variants of the design; a node/edge with "modes" is shown only in those modes (others see a faint ghost)
tokens     coloured dots that move (request #1, retry #2, job, email …)
scenarios  stories; each has a list of steps per mode
steps      one move of one token:  {k, mv:"from>to"}  or  {k, at:"node"}
fx         what a step changes in the side panel: state counters, table rows, dim a token
```

A step `mv: "a>b"` needs an edge `{a:"a", b:"b"}` that is visible in that mode. That is the most common mistake.

## Schema (`window.FLOW`)

```js
window.FLOW = {
  id: 'my-flow',                 // used for browser storage keys; keep it stable
  title: 'Title shown at the top',
  desc: 'One or two sentences. `code` and **bold** work.',

  lanes: [ { x, y, w, h, t: 'Lane title' } ],           // optional, drawn behind everything

  groups: [ {                    // optional; dashed frame behind boxes that run at the same time, see "Groups"
    id: 'g_fanout',              // optional; used in messages
    nodes: ['a_stock', 'a_price'], // auto-fit: frame = those boxes (and their tags) + pad, follows them when dragged
    pad: 16,                     // optional, auto-fit only (default 16)
    // or a fixed frame instead of nodes:  x: 400, y: 480, w: 520, h: 160
    tag: 'par',                  // optional pill text at the bottom-left (default 'par'), keep it short
    t: 'stock and price checked in parallel',   // optional caption next to the tag
    modes: ['after'],            // optional; other modes see a faint ghost (or nothing with ghost: 'hide')
  } ],

  nodes: [ {
    id: 'api_charge',            // unique, no spaces, no ">"
    type: 'rect',                // rect | term (pill, start/end) | dec (diamond) | db (cylinder) | task (small) | note (dashed)
    x: 520, y: 540,              // centre of the box
    t: 'Charge card',            // title, ≤ 30 chars
    s: 'payment provider',       // optional subtitle, ≤ 38 chars
    what: 'What this box is',    // optional; summary shown first in the detail card
    why: 'What problem it solves', // optional; goes with `what`. Give every box both
    tip: 'Hover text',           // optional; rich text, see "Rich text" below
    detail: ['bullet', 'bullet'],// optional; shown in the side panel when the box is clicked (the card shows `tip` only when there is no `detail`)
    tag: 'NEW',                  // optional badge: 'TEXT' or {text:'OLD', tone:'chg'}; tones: new chg info bad ok warn
    modes: ['after'],            // optional; omit = visible in every mode
    w: 200, h: 64,               // optional size override
    byMode: { after: { s: 'text in this mode', tip: '…' } },   // optional per-mode t / s / tip / detail / what / why for a shared box
  } ],

  edges: [ {
    a: 'api_stock', b: 'api_charge',   // the edge key is "a>b"; one edge per direction
    label: 'yes',                // optional, keep it short
    tip: 'Hover text',           // optional; same rich text as a node tip
    modes: ['after'],            // optional
    dash: true,                  // optional dashed line (timeouts, async, "may happen")
    route: 'hv',                 // optional: omit = the simple elbow | 'hv' (horizontal then vertical) | 'vh'
                                 //   | 'auto' (routed around the other boxes) | 'manual' (through via)
    via: [[340,220],[340,380]],  // optional waypoints (bends); overrides route (segments are always drawn horizontal/vertical)
    from: { side: 'bottom', t: 0.25 },  // optional port on box a: side top|right|bottom|left, t = place along it 0..1 (default 0.5)
    to: { side: 'top' },         // optional port on box b (diamonds and the round ends of pills always use the middle)
    lt: 0.25,                    // optional label position along the line, 0..1 (default 0.5)
    lo: [12, -8],                // optional label offset [dx, dy] from that point
  } ],

  modes: [ { id: 'before', t: 'Before', d: 'What is different in this mode' } ],   // at least one; ids are used everywhere

  diff: {                        // optional "what changes" table, shown when the current mode is in cols
    cols: ['before', 'after'],
    rows: [
      { k: 'Retry after timeout', v: { before: ['Charges again', 'bad'], after: ['Saved receipt', 'good'] } },
      { k: 'Stock check', same: 'Same in both' },
    ],
  },

  tokens: [ { k: 'r1', label: '#1', color: '#4f8cff', desc: 'request #1' } ],  // label ≤ 3 chars

  state: [                       // side panel counters / values
    { k: 'charges', label: 'Card charges', type: 'num', ok: 1 },   // num: green when == ok, red when > ok
    { k: 'customer', label: 'Customer sees', type: 'text', v0: '—' },
  ],
  tables: [ { k: 'orders', t: 'orders table', cols: ['#', 'order', 'status'] } ],  // first column is the row number

  scenarios: [ {
    id: 'timeout', t: 'Slow payment → retry', d: 'Short story of the scenario',
    sum: { before: 'Outcome in one line', after: 'Outcome in one line' },   // or a single string
    steps: {
      before: [ /* steps */ ],
      after:  [ /* steps */ ],
      // '*': [...]     steps for any mode without its own list
      // after: 'before' reuse another mode's list
      // leave a mode out = scenario is disabled in that mode
    },
  } ],

  questions: [ {                 // optional "open questions" drawer
    id: 'Q1', q: 'Question text', node: 'api_key', mode: 'after', scen: 'timeout',
    detail: { now: ['how it works today'], opts: [ { k: 'A', t: 'Option', how: ['step'], pro: '…', con: '…', rec: true, cur: false } ], ask: 'What to ask', ref: 'file.go:42' },
  } ],

  labels: { selected: '📌 Selected box', what: 'What it is', why: 'What it solves', clickHint: '👆 Click the box for full details' },  // optional UI texts (these are the defaults)
  commentTypes: { q: ['❓', 'Question', '#f59e0b'] },   // optional; overrides comment categories
  ghost: 'hide',                 // optional: 'faint' (default, other modes' boxes drawn faint) | 'hide' (not drawn)

  layout: {                      // optional; positions applied on top of nodes[].x/y (the page's "📋 Copy positions" writes this block)
    api_charge: { x: 540, y: 560 },          // node id → { x?, y? } (centre, same units as nodes[])
    edges: {                     // optional; edge key "a>b" → its route as edited in the page
      'a_fail>c_err': [[880, 445], [165, 445]],             // waypoints that replace that edge's via
      'c_tap>c_post': { to: { side: 'right' }, lt: 0.3 },   // or { via?, from?, to?, lt?, lo?, route? }; null clears from / to / lo,
      'a_save>a_enq': { route: 'auto' },                    //   route: 'auto' drops the via and routes around the boxes
    },
  },
};
```

### Groups (parallel work)

**Parallel work = frame it with a group.** When boxes run at the same time (goroutines + `wg.Wait`, `Promise.all`, an async fan-out),
put them in a row and add a `groups` entry, so the reader sees "these happen together" without reading the steps.

- Prefer the auto-fit form `{ nodes: [...] }`: the frame is the bounding box of those boxes and their tag pills, plus `pad`, with room under them for the tag row.
  It follows the boxes when they are dragged in `✥ Move` (and on undo / reset). A fixed `{ x, y, w, h }` frame never moves.
- Frames are drawn above lanes and behind lines and boxes. List only the boxes that really run concurrently; the frame may also hold the box that fans them out.
- Keep other boxes either fully inside or fully outside the frame (the audit flags a frame edge through a box). Leave about 30 units under the lowest box for the tag row.
- Give the group the same `modes` as its boxes; the audit flags a listed box that is hidden in a mode where the group is shown.
- Show the moves too: one token per parallel task (see "Steps"), so the frame and the motion tell the same story.

### Layout (`layout`) and dragging boxes

- The order is: `nodes[].x/y` → `FLOW.layout` → the viewer's saved draft (see below). `layout` applies to every mode.
- `✥ Move` in the toolbar (off by default) lets anyone drag a box. Under 4px of movement is still a click (select).
  The box centre snaps to a 10px grid (hold Alt for no snap), Esc cancels a drag, the arrow keys move the selected box 10px (Shift = 1px),
  Ctrl/Cmd+Z undoes and Shift+Ctrl/Cmd+Z redoes (50 moves). Edges follow; the layout audit re-runs after every drop and its count for the current mode shows on the toggle.
- Edges follow a moved box (draw.io style). An edge with `via` (or edited in the page) is **manual**: it keeps its middle bends and only its
  end segments change. The bend next to the box slides along its own segment to line up with the port again (a fan-out bus stays connected);
  if that leaves a zero-length or backwards segment, that bend is dropped and the next one is lined up instead.
  Any other edge is **auto**: it keeps the simple elbow as long as nobody touches it (so `flow.js` draws exactly as before); once a box it
  touches moves, it is routed live around the other boxes (12px clear, at most 3 bends where possible, never through a box when a route exists).
  Changed routes go in `layout.edges`.
- **Edit an arrow** (only with `✥ Move` on; outside Move mode a click on an arrow does nothing new): click a line to select it. Then drag
  ■ a bend (10px snap, Alt = free; double-click = remove it, or select it and press Delete / Backspace),
  ▬ the middle of a segment to move the whole segment (double-click it to add a bend; Alt-drag splits it),
  ● an end along the border of **its own box** to choose the side (snapped to quarters of the side, Alt = free),
  or the label along the line (saves `lt`; Alt-drag = free offset `lo`). `↺ Re-route` (shown for a selected arrow) and
  `▾ Layout → ↺ Re-route all moved` put arrows back to auto. Esc cancels a drag, then deselects. Every edit is one undo step.
- **An arrow can never be reconnected to another box**: scenario steps use `mv: 'a>b'`, so `a` / `b` are fixed. Dropping an end on another
  box is refused (the end snaps back and a short message says so). To connect different boxes, edit `edges` in `flow.js`.
- **Dragging is a draft tool.** Moves are saved only in that browser (`localStorage`, key `flowmotion:<FLOW.id>:layout`). They become permanent
  only when you paste the `layout` block from `▾ Layout → 📋 Copy positions` into `flow.js` (it replaces any existing `layout`), then run the checks.
  `↺ Reset layout` drops the draft (boxes and arrows); `👁 Show moved` flashes the boxes and arrows that differ from `flow.js`.
- A node with the id `edges` cannot be placed through `layout` (the key is reserved).

### Rich text (`tip`, `detail` items, question text)

- `tip`: each ` · ` separated part is its own bullet line (a single part has no bullet). Inline `` `code` `` and `**bold**` work everywhere.
- Fenced code block: ```` ```lang\n…\n``` ```` renders as a code box. It is never split on ` · `.
- Diff markers inside a code box: a line starting with `+ ` is new (green), `~ ` is changed (amber), anything else is existing code. The marker is shown in a gutter, not as text.
- Edge `tip` and comment-pin text use the same rich text as node tips (` · ` lines, `` `code` ``, `**bold**`; HTML is escaped).
- ` · ` inside an inline `` `code` `` span does not split. The fence language may be any token (`JSON`, `c++`, `text`); it is never shown in the box.
- Node hover: the tooltip shows the title, the subtitle `s`, then the `tip` lines, and opens beside the box. Click the box for the detail card (top of the right panel).
- Keep code lines ≤ 60 characters (the card is narrow and wraps); put comments on their own line, not at the end of a code line. JSON: one field per line.

### Steps

```js
{ k: 'r1', at: 'c_tap', n: 'User taps Pay' }                       // put/teleport token r1 on a node
{ k: 'r1', mv: 'c_tap>c_post', n: 'App sends POST /orders' }        // animate r1 along edge c_tap>c_post
{ k: 'r1', mv: 'a_charge>a_save', n: 'Save order',
  fx: {
    inc: { orders: 1 },                                             // add to a num state
    set: { customer: ['Receipt', 'ok'] },                           // set a state; [value, tone] or value. tones: ok good bad warn
    row: { t: 'orders', c: ['1001', 'PAID'], tone: 'bad', note: 'duplicate' },  // add a table row (or an array of rows)
    dim: 'r1',                                                      // fade a token (request finished / abandoned)
  } }
```

- `n` is the text in the step list. Write what happens, in plain words, ≤ 70 chars.
- A token continues from where its last step ended. If it starts somewhere else, add an `at` step first (the checker warns about jumps).
- Use one token per thing that moves independently (each request, each message, each email). Two tokens can run in the same scenario.
- Put side effects in `fx` on the step where they happen, so the counters change at the right moment.

## Layout rules

- Coordinates are SVG units. Lanes are columns; a typical lane is 280–600 wide.
- Put nodes on a grid: x in steps of ~260, y in steps of ~140–160. Default box sizes: rect 200×64, dec 200×96, db 190×72, term 190×56.
- Keep at least 40 units between boxes. The checker warns when boxes overlap.
- Main path goes top → bottom. Errors and side paths go to the right.
- When an auto-routed edge crosses a box, give it `via` waypoints or `route: 'hv' | 'vh'`.
- A node that exists only in one mode still takes space in the other mode (it is drawn as a ghost). Do not put two mode-specific nodes in the same spot unless they are never visible together.

## Writing rules

- Short titles. Put detail in `s`, `tip` or `detail`, not in `t`.
- Name things the way the source system names them, so readers can search the code.
- Do not invent behaviour. If the source does not say what happens, write it as an open question in `questions` and tell the user.
- Never put secrets, tokens, passwords, customer data or internal hostnames in `flow.js`.

## Verify

1. `node tools/check.mjs` → must print `✔ OK`. Exit code 1 = errors.
   Then `node tools/audit.mjs [folder] [--shots <dir>]` → runs the page headless once and reports data check, layout audit
   (every mode) and a self test (every scenario × mode played to the end, JS errors, SVG / PNG / HTML export builds). Exit 0 = clean. `--shots` saves one
   chart-only screenshot per mode — **open them and look**; the scripts only catch what they have rules for.
   Claude Code users: the `flow-motion` skill and the `flow-motion-auditor` agent in `.claude/` wrap this loop.
2. Open `index.html`. A red box at the top lists data errors; the console prints them as `[flow] …`.
   A yellow box lists **layout issues** found by the built-in audit, for every mode: text wider than its box, boxes or tags that overlap,
   lines that pass through a box or tag, labels that cover a box, a tag, another label, another line or a lane title, and two lines drawn on top of each other.
   For groups: the tag or caption on a box, a tag, a label or a line, a caption wider than its frame, a frame edge through a box, and a listed box hidden in a mode where the group is shown.
   With `ghost: 'faint'` it also reports lines and labels that cross the faint boxes of other modes. **Get it to 0 before you hand the page over.**
3. Headless check (optional), with any Chromium-based browser:
   ```sh
   # page state after loading: <html data-check="ok|fail" data-ready="1">
   chrome --headless=new --disable-gpu --virtual-time-budget=5000 --dump-dom "file://$PWD/index.html" | grep -o 'data-check="[a-z]*"'
   # screenshot of one moment: mode, scenario, step, selected node come from the URL hash
   chrome --headless=new --disable-gpu --hide-scrollbars --window-size=1600,1200 --virtual-time-budget=6000 \
     --screenshot=shot.png "file://$PWD/index.html#mode=after&scen=timeout&step=12&sel=a_key"
   ```
   (`chrome` = `google-chrome`, `chromium`, or `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.)
   ```sh
   # number of layout issues: <html data-audit="0">
   chrome --headless=new --disable-gpu --virtual-time-budget=5000 --dump-dom "file://$PWD/index.html" | grep -o 'data-audit="[0-9]*"'
   ```
   Hash options: `#selftest=1` plays everything and writes `<pre id="flow-selftest">` + `<html data-selftest="ok|fail">` (it ignores saved viewer positions);
   `#layout=0` ignores (and never writes) the viewer's saved positions, so the page shows exactly `flow.js` (`tools/audit.mjs` uses it); `#move=1` opens with `✥ Move` on;
   `#view=chart` shows only the chart at real size (for screenshots);
   `#export=svg,png,html` (+ `&ghost=1`) writes the exports as JSON into a hidden `pre#flow-export` — `node tools/export.mjs` wraps this and saves the files.
4. In the page, `window.FLOW_CHECK` holds `{errors, warnings}`, `window.FLOW_AUDIT` holds the layout issues, and `window.flowMotion` exposes `audit(modeId)`, `exportSvg({ghost, tokens})`, `exportPng(opt, scale)` (Promise of Blob), `exportHtml()`, `setMode(id)`, `setScen(id)`, `jump(n)`, `stepsOf(scenId, modeId)`, `state`,
   and for the layout: `moveNode(id, x, y)` (absolute; same path as a drag: undo, save, audit), `getLayout()` (`{nodes: {id: {x, y}}, edges: {"a>b": via}}`, only what differs from `flow.js`),
   `resetLayout()`, `setMoveMode(bool)`, `undo()`, `redo()`; for arrows: `getEdgeRoute(key)` (`{via, from, to, lt, lo, route, pts}`),
   `setEdgeRoute(key, {via, from, to, lt, lo, route})` (one undo step, same fields as a `layout.edges` entry), `rerouteEdge(key)`,
   `rerouteAll(all)` (default: arrows of moved boxes and edited arrows; `true` = every arrow), `selectEdge(key)`, `addBend(key, x, y)`, `deleteBend(key, i)`,
   `dragStats()` (`{frames, max, avg}` ms per frame of the last drag). Exports use the live positions and routes; the HTML file embeds them as `FLOW.layout`.
   `groups()` lists the drawn group frames (`{id, auto, box: [x, y, w, h], tag, caption, ghost}`). Exports include the frames; frames of other modes follow the ghost option.
5. `node tools/drag.test.mjs [folder] [--shots <dir>]` tests dragging in headless Chrome (real pointer input over the DevTools protocol, Node 22+). It expects the bundled example `flow.js`.
   `node tools/groups.test.mjs [folder] [--shots <dir>]` does the same for groups (drawing per mode, auto-fit, drag + undo, audit, validation, exports).
   `node tools/edges.test.mjs [folder] [--shots <dir>]` does the same for arrows (re-route on drag, bend / segment / end / label edits, undo, reload, exports, validation, a timed drag on a generated 60-box page).

## Common errors

| Message | Fix |
|---|---|
| `no edge "a>b"` | Add `{a:'a', b:'b'}` to `edges`, or fix the step. |
| `edge "a>b" is hidden in mode "m"` | Add `m` to the edge's `modes`, or remove `modes` from the edge. |
| `node "x" is hidden in mode "m"` | Same as above, for the node. |
| `token "k" jumps from "a" to "b"` | Add `{k, at:'b'}` before the step, or fix the path. |
| `unknown state key` / `unknown table` | Add it to `state` / `tables`, or fix the spelling. |
| `nodes "a" and "b" overlap` | Move one of them, or give them different `modes`. |
| `text overflows box` | Widen the box (`w`) or shorten `t` / `s`. Diamonds only use ~60% of their width for text. |
| `edge … passes through box` | Add or move `via` points so the line goes around, or move the box. |
| `label of … sits on edge` / `overlaps box` | Move the label with `lt`, move the crossing line, or drop the label. |
| `label of … covers lane title` | Move the label with `lt`, or move the line away from the top of the lane. |
| `odd number of ``` (unclosed code fence)` | Close the fence in that `tip`, `detail` item or question text. |
| `code line over 60 chars` | Split the line; move comments to their own line. |
| `what / why / tip must be a string` | Use a string (not an array or object). |
| `labels must be an object of strings` | `labels: { selected: '…', what: '…', why: '…', clickHint: '…' }`. |
| `export: HTML file is not self-contained` | `index.html` must load `validate.js` and `flow.js` with plain `<script src="…">` tags, and `validate.js` must set `flowValidateSrc`. |
| `passes through faint box (other mode)` | Re-route, or set `ghost: 'hide'` if the modes share the same space. |
| `layout: "x" is not a node id` | Fix the id in `layout`, or remove the entry (the node was renamed or deleted). |
| `layout.x: x must be a finite number` | Use a plain number for `x` / `y`. |
| `layout.edges: "a>b" is not an edge` / `must look like [[x,y],[x,y]]` | Fix the edge key, or the waypoint list. |
| `…from: side must be "top", "right", "bottom" or "left"` / `t must be a number from 0 to 1` | Fix the port (`{ side: 'bottom', t: 0.25 }`). |
| `layout.edges["a>b"].lt / .lo / .route …` | `lt` between 0 and 1, `lo: [dx, dy]`, `route: 'auto'` or `'manual'`. |
| `layout.x: the box is outside every lane` | Move the box back into a lane (warning only). |
| `group "g": needs nodes: [ids] (auto-fit) or x, y, w, h` | Give the group `nodes`, or a full `x, y, w, h` frame. |
| `group "g": unknown node "x"` / `x must be a number` | Fix the id in `nodes`, or use plain numbers for the frame. |
| `group "g": the frame does not fully contain any box` | The fixed frame is misplaced; move it, or switch to `nodes: [...]` (warning). |
| `tag / caption of group "g" overlaps box …` · `frame of group "g" cuts through box …` | Move the boxes so the frame has room, shorten `t`, or change `pad`. |
| `group "g": box "x" is hidden in this mode` | Give the group the same `modes` as its boxes, or drop the box from `nodes`. |

## Prompts users can give you

- "Read `<files>` and build a Flow Motion page in `flow.js` for the `<feature>` flow. Two modes: current and proposed. Scenarios: happy path, `<failure 1>`, `<failure 2>`."
- "Add a scenario where `<thing>` fails after `<step>`; show what the customer sees and what gets written."
- "Add a third mode `<name>` that only changes `<part>`; add a diff table against the other modes."
- "Turn the open points from `<doc>` into `questions` with options, pros and cons."

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

## Mental model

```
lanes      background columns (actors / systems)
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

  nodes: [ {
    id: 'api_charge',            // unique, no spaces, no ">"
    type: 'rect',                // rect | term (pill, start/end) | dec (diamond) | db (cylinder) | task (small) | note (dashed)
    x: 520, y: 540,              // centre of the box
    t: 'Charge card',            // title, ≤ 30 chars
    s: 'payment provider',       // optional subtitle, ≤ 38 chars
    tip: 'Hover text',           // optional
    detail: ['bullet', 'bullet'],// optional; shown in the side panel when the box is clicked
    tag: 'NEW',                  // optional badge: 'TEXT' or {text:'OLD', tone:'chg'}; tones: new chg info bad ok warn
    modes: ['after'],            // optional; omit = visible in every mode
    w: 200, h: 64,               // optional size override
    byMode: { after: { s: 'text in this mode', tip: '…' } },   // optional per-mode t / s / tip / detail for a shared box
  } ],

  edges: [ {
    a: 'api_stock', b: 'api_charge',   // the edge key is "a>b"; one edge per direction
    label: 'yes',                // optional, keep it short
    tip: 'Hover text',           // optional
    modes: ['after'],            // optional
    dash: true,                  // optional dashed line (timeouts, async, "may happen")
    route: 'hv',                 // optional: 'auto' (default) | 'hv' (horizontal then vertical) | 'vh'
    via: [[340,220],[340,380]],  // optional waypoints; overrides route (segments are always drawn horizontal/vertical)
    lt: 0.25,                    // optional label position along the line, 0..1 (default 0.5)
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

  commentTypes: { q: ['❓', 'Question', '#f59e0b'] },   // optional; overrides comment categories
  ghost: 'hide',                 // optional: 'faint' (default, other modes' boxes drawn faint) | 'hide' (not drawn)
};
```

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
   (every mode) and a self test (every scenario × mode played to the end, JS errors). Exit 0 = clean. `--shots` saves one
   chart-only screenshot per mode — **open them and look**; the scripts only catch what they have rules for.
   Claude Code users: the `flow-motion` skill and the `flow-motion-auditor` agent in `.claude/` wrap this loop.
2. Open `index.html`. A red box at the top lists data errors; the console prints them as `[flow] …`.
   A yellow box lists **layout issues** found by the built-in audit, for every mode: text wider than its box, boxes or tags that overlap,
   lines that pass through a box or tag, labels that cover a box, a tag, another label or another line, and two lines drawn on top of each other.
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
   Hash options: `#selftest=1` plays everything and writes `<pre id="flow-selftest">` + `<html data-selftest="ok|fail">`;
   `#view=chart` shows only the chart at real size (for screenshots).
4. In the page, `window.FLOW_CHECK` holds `{errors, warnings}`, `window.FLOW_AUDIT` holds the layout issues, and `window.flowMotion` exposes `audit(modeId)`, `setMode(id)`, `setScen(id)`, `jump(n)`, `stepsOf(scenId, modeId)`, `state`.

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
| `passes through faint box (other mode)` | Re-route, or set `ghost: 'hide'` if the modes share the same space. |

## Prompts users can give you

- "Read `<files>` and build a Flow Motion page in `flow.js` for the `<feature>` flow. Two modes: current and proposed. Scenarios: happy path, `<failure 1>`, `<failure 2>`."
- "Add a scenario where `<thing>` fails after `<step>`; show what the customer sees and what gets written."
- "Add a third mode `<name>` that only changes `<part>`; add a diff table against the other modes."
- "Turn the open points from `<doc>` into `questions` with options, pros and cons."

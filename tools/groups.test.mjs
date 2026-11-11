#!/usr/bin/env node
/* Flow Motion · test "groups" (dashed frame behind boxes that run at the same time) in a headless browser.
 * Usage: node tools/groups.test.mjs [dir-or-index.html] [--shots <outdir>]
 *
 * Drives the page over the Chrome DevTools Protocol (page API window.flowMotion + real pointer input), and runs
 * validate.js in Node. Uses its own throw-away browser profile.
 * Expects the bundled example flow.js (group "g_after_enq" around "a_resp" + "q_jobs", mode "after").
 * --shots <outdir>  saves the group at 1600 px (dark + light) and 390 px wide.
 * Exit code: 0 = every case passed, 1 = a case failed, 2 = could not run (no Chrome, bad path).
 * Needs Node 22+ (global WebSocket). Chrome: set CHROME=/path/to/chrome, otherwise common install paths are tried.
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const shotsDir = opt('--shots');
const target = args.find(a => !a.startsWith('--') && a !== shotsDir) || '.';
let page = path.resolve(target);
if (existsSync(page) && statSync(page).isDirectory()) page = path.join(page, 'index.html');
if (!existsSync(page)) { console.error(`✖ ${page} not found`); process.exit(2); }
const dir = path.dirname(page);
if (typeof WebSocket === 'undefined') { console.error('✖ needs Node 22+ (global WebSocket)'); process.exit(2); }

const candidates = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);
const chrome = candidates.find(p => existsSync(p));
if (!chrome) { console.error('✖ Chrome / Chromium not found · set CHROME=/path/to/chrome'); process.exit(2); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmp = mkdtempSync(path.join(os.tmpdir(), 'fm-groups-'));
const profile = path.join(tmp, 'profile');
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1600,1200', 'about:blank'], { stdio: 'ignore' });

const cleanup = () => { try { proc.kill(); } catch {} try { rmSync(tmp, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup);

/* ---------- CDP ---------- */
let ws, seq = 0;
const pending = new Map(), jsErrors = [];
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((ok, no) => pending.set(id, { ok, no, method }));
}
async function connect() {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) throw new Error('Chrome did not open a DevTools port');
  const port = readFileSync(portFile, 'utf8').split('\n')[0].trim();
  let pg;
  for (let i = 0; i < 50 && !pg; i++) { try { pg = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch {} if (!pg) await sleep(100); }
  if (!pg) throw new Error('no page target');
  ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error('WebSocket failed')); });
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.no(new Error(`${p.method}: ${d.error.message}`)) : p.ok(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') jsErrors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') jsErrors.push(d.params.args.map(a => a.value ?? a.description).join(' '));
  };
  await send('Page.enable'); await send('Runtime.enable');
}
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('page: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
async function open(file, hash, ready = "document.documentElement.dataset.ready === '1'") {
  await send('Page.navigate', { url: 'about:blank' }); await sleep(100);   /* a hash-only change would not reload */
  await send('Page.navigate', { url: pathToFileURL(file).href + (hash ? '#' + hash : '') });
  for (let i = 0; i < 600; i++) { try { if (await js(ready)) return; } catch {} await sleep(100); }
  throw new Error('page did not finish loading: ' + hash);
}
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
async function centreOf(id) {
  return js(`(() => { const g = document.querySelector('.nd[data-id="${id}"]'); g.scrollIntoView({ block: 'center', inline: 'center' });
    const r = g.querySelector('.sh').getBoundingClientRect(), m = document.getElementById('svg').getScreenCTM();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, sx: m.a, sy: m.d }; })()`);
}
/* real pointer drag by (dx, dy) in chart units; onMid runs while the button is still down */
async function drag(id, dx, dy, onMid) {
  const c = await centreOf(id);
  await mouse('mouseMoved', c.x, c.y, { buttons: 0 }); await mouse('mousePressed', c.x, c.y);
  const ex = c.x + dx * c.sx, ey = c.y + dy * c.sy;
  for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', c.x + (ex - c.x) * i / 8, c.y + (ey - c.y) * i / 8); await sleep(15); }
  if (onMid) await onMid();
  await mouse('mouseReleased', ex, ey); await sleep(60);
}
const key = (k, code, vk, modifiers = 0) => send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers })
  .then(() => send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers }));
const pos = id => js(`document.querySelector('.nd[data-id="${id}"]').getAttribute('transform')`);
const edgeD = k => js(`document.querySelector('.ed[data-k="${k}"] path.b').getAttribute('d')`);
const layout = () => js('window.flowMotion.getLayout()');
async function shot(name, width) {
  if (!shotsDir) return;
  mkdirSync(shotsDir, { recursive: true });
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(shotsDir, `${name}_${width}.png`), Buffer.from(r.data, 'base64'));
}
async function setWidth(w) {
  if (w) await send('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 2, mobile: true });
  else await send('Emulation.clearDeviceMetricsOverride');
}

const grp = () => js('window.flowMotion.groups()');
const svgTxt = (o = {}) => js(`window.flowMotion.exportSvg(${JSON.stringify(o)})`);
/* a copy of the page with extra lines appended to flow.js */
let siteN = 0;
function site(extra) {
  const d = path.join(tmp, 'site' + (++siteN)); mkdirSync(d);
  copyFileSync(page, path.join(d, 'index.html')); copyFileSync(path.join(dir, 'validate.js'), path.join(d, 'validate.js'));
  writeFileSync(path.join(d, 'flow.js'), readFileSync(path.join(dir, 'flow.js'), 'utf8') + '\n' + extra + '\n');
  return path.join(d, 'index.html');
}
/* expected auto-fit frame for the bundled example: a_resp 200×64 @ 520,830 · q_jobs 190×72 @ 1080,790 with a "NEW" tag; pad 16 */
const AUTO = (() => {
  const tw = Math.max(30, 3 * 6.4 + 12), tx = 1080 + 95 - tw / 2 - 6, tagTop = 790 - 36 - 2 - 9;
  const x0 = 420, y0 = Math.min(754, tagTop), x1 = Math.max(1175, tx + tw / 2), y1 = 862, p = 16;
  return [x0 - p, y0 - p, x1 - x0 + 2 * p, y1 - y0 + p + p + 26];
})();
const near = (a, b, what) => { if (!a || a.length !== b.length || a.some((v, i) => Math.abs(v - b[i]) > 0.01)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

/* ---------- cases ---------- */
const results = [];
async function test(name, fn) {
  try { await fn(); results.push([true, name]); console.log('✔ ' + name); }
  catch (e) { results.push([false, name, e.message]); console.log('✖ ' + name + '\n   ' + e.message); }
}
const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, what) => { if (!v) throw new Error(what); };

try {
  await connect();
  await open(page, 'mode=after');
  await js('localStorage.clear(), true');

  await test('1. one frame per group; visible in its mode, ghosted in the others', async () => {
    await open(page, 'mode=after&layout=0');
    eq(await js("document.querySelectorAll('#gGroups .grp').length"), 1, 'drawn groups');
    const g = (await grp())[0];
    eq(g.id, 'g_after_enq', 'group id'); ok(g.auto, 'auto-fit group'); ok(!g.ghost, 'not ghosted in "after"');
    eq(await js("document.querySelector('.grp .gtt').textContent"), 'async', 'tag text');
    eq(await js("document.querySelector('.grp .gcap').textContent"), 'reply and email job run at the same time', 'caption');
    ok(await js("getComputedStyle(document.querySelector('.grp rect.gb')).strokeDasharray.startsWith('7')"), 'frame is dashed');
    ok(await js("(() => { const g = document.getElementById('gGroups'); return g.previousElementSibling.id === 'gLanes' && g.nextElementSibling.id === 'gEdges'; })()"), 'frames sit above lanes, behind edges and boxes');
    await js("window.flowMotion.setMode('before'), true");
    ok((await grp())[0].ghost, 'ghosted in "before"');
    await sleep(400);   /* opacity fades in .25s */
    eq(await js("getComputedStyle(document.querySelector('.grp')).opacity"), '0.07', 'ghost opacity');
    eq(await js('window.FLOW_AUDIT.length'), 0, 'layout audit clean');
  });

  await test('2. auto-fit frame = boxes + their tags + pad, with room for the tag row', async () => {
    await open(page, 'mode=after&layout=0');
    const g = (await grp())[0];
    near(g.box, AUTO, 'frame');
    near(g.tag, [AUTO[0] + 10, AUTO[1] + AUTO[3] - 26, AUTO[0] + 10 + 12 + 5 * 7, AUTO[1] + AUTO[3] - 8], 'tag pill (bottom-left inside)');
    ok(g.caption[0] > g.tag[2] && g.caption[2] < AUTO[0] + AUTO[2], 'caption right of the tag, inside the frame');
    ok(g.tag[1] >= 862 + 6, 'tag row is below the lowest box');
    const vb = (await js("document.getElementById('svg').getAttribute('viewBox')")).split(' ').map(Number);
    ok(vb[1] + vb[3] >= AUTO[1] + AUTO[3], 'viewBox includes the frame');
  });

  await test('3. the frame follows a dragged member box; undo / redo / reset bring it back', async () => {
    await open(page, 'mode=after&move=1');
    await drag('q_jobs', 40, 0);
    eq((await layout()).nodes.q_jobs, { x: 1120, y: 790 }, 'q_jobs moved');
    near((await grp())[0].box, [AUTO[0], AUTO[1], AUTO[2] + 40, AUTO[3]], 'frame after drag');
    ok(await js("+document.querySelector('.grp rect.gb').getAttribute('width')") === AUTO[2] + 40, 'drawn rect follows');
    await key('z', 'KeyZ', 90, 2);
    near((await grp())[0].box, AUTO, 'frame after undo');
    await key('Z', 'KeyZ', 90, 2 | 8);
    near((await grp())[0].box, [AUTO[0], AUTO[1], AUTO[2] + 40, AUTO[3]], 'frame after redo');
    ok(await js("window.flowMotion.moveNode('a_resp', 520, 900)"), 'moveNode');
    eq((await grp())[0].box[3], AUTO[3] + 70, 'frame grows down with a_resp');
    await js('window.flowMotion.resetLayout(), true');
    near((await grp())[0].box, AUTO, 'frame after reset');
    await drag('a_enq', 0, 60);
    near((await grp())[0].box, AUTO, 'a box that is not a member does not move the frame');
    await js('window.flowMotion.resetLayout(), true');
  });

  await test('4. a fixed frame (x, y, w, h) stays put when boxes move', async () => {
    const f = site("window.FLOW.groups.push({ id: 'fixed', x: 400, y: 490, w: 240, h: 130, modes: ['after'], t: 'fixed' });");
    await open(f, 'mode=after&layout=0&move=1');
    const g = (await grp()).find(x => x.id === 'fixed');
    eq(g.box, [400, 490, 240, 130], 'fixed frame'); ok(!g.auto, 'not auto');
    ok(await js("window.flowMotion.moveNode('a_charge', 560, 560)"), 'moveNode');
    eq((await grp()).find(x => x.id === 'fixed').box, [400, 490, 240, 130], 'fixed frame after a move');
    eq(await js('window.FLOW_CHECK'), { errors: [], warnings: [] }, 'data check');
  });

  await test('5. ghost: "hide" hides other modes\' frames', async () => {
    const f = site("window.FLOW.ghost = 'hide';");
    await open(f, 'mode=before&layout=0');
    eq(await js("getComputedStyle(document.querySelector('.grp')).display"), 'none', 'display in "before"');
    await js("window.flowMotion.setMode('after'), true");
    eq(await js("getComputedStyle(document.querySelector('.grp')).display"), 'inline', 'display in "after"');
  });

  await test('6. layout audit: tag / caption on a box or label, frame through a box, member hidden in a mode', async () => {
    const f = site([
      "window.FLOW.groups.push({ id: 'onbox', x: 410, y: 470, w: 220, h: 80, modes: ['after'], t: 'a caption that is far too long for this frame' });",
      "window.FLOW.groups.push({ id: 'hid', nodes: ['a_email', 'c_err'] });",
      "window.FLOW.groups.push({ id: 'onlabel', x: 500, y: 270, w: 300, h: 46, modes: ['after'], tag: 'par' });",
    ].join('\n'));
    await open(f, 'mode=after&layout=0');
    const A = await js("window.flowMotion.audit('after')"), has = s => A.some(x => x.includes(s));
    ok(has('tag of group "onbox" overlaps box "a_charge"'), 'tag on a box: ' + JSON.stringify(A));
    ok(has('caption of group "onbox" overlaps box "a_charge"'), 'caption on a box');
    ok(has('caption of group "onbox" is wider than its frame'), 'caption wider than the frame');
    ok(has('frame of group "onbox" cuts through box "a_charge"'), 'frame through a box');
    ok(has('group "hid": box "a_email" is hidden in this mode'), 'member hidden in "after"');
    ok(has('tag of group "onlabel" overlaps label of a_key>a_stock'), 'tag on an edge label');
    ok(!(await js("window.flowMotion.audit('before')")).some(x => x.includes('"onbox"')), 'a group is not audited in modes where it is hidden');
    ok(!(await js("window.flowMotion.audit('before')")).some(x => x.includes('group "hid": box')), 'all members visible in "before"');
  });

  await test('7. validate.js: errors for bad groups, warning for a misplaced fixed frame', async () => {
    const { flowCheck } = createRequire(import.meta.url)(path.join(dir, 'validate.js'));
    const sb = { window: {} }; vm.createContext(sb); vm.runInContext(readFileSync(path.join(dir, 'flow.js'), 'utf8'), sb);
    const F = sb.window.FLOW, chk = G => flowCheck(Object.assign({}, F, { groups: G }));
    const E = (G, s) => ok(chk(G).errors.some(e => e.includes(s)), `expected error "${s}", got ${JSON.stringify(chk(G).errors)}`);
    E({}, 'groups must be an array');
    E([{ x: 1, y: 'a', w: 10, h: 10 }], 'groups[0]: y must be a number');
    E([{ id: 'g', x: 1, y: 2, w: 3 }], 'group "g": h must be a number');
    E([{ id: 'g', nodes: ['a_resp', 'nope'] }], 'group "g": unknown node "nope"');
    E([{ id: 'g', nodes: ['a_resp'], modes: ['later'] }], 'group "g": unknown mode "later"');
    E([{ id: 'g', t: 'only a caption' }], 'group "g": needs nodes: [ids] (auto-fit) or x, y, w, h');
    E([{ id: 'g', nodes: [] }], 'nodes must be a non-empty array');
    E([{ id: 'g', nodes: ['a_resp'], pad: '8' }], 'pad must be a number');
    E([{ id: 'g', nodes: ['a_resp'] }, { id: 'g', nodes: ['c_ok'] }], 'duplicate group id "g"');
    const W = chk([{ id: 'far', x: 3000, y: 3000, w: 200, h: 100 }]);
    eq(W.errors, [], 'misplaced frame is not an error');
    ok(W.warnings.some(w => w.includes('group "far": the frame does not fully contain any box')), 'misplaced frame warning: ' + JSON.stringify(W.warnings));
    ok(chk([{ id: 'm', x: 410, y: 500, w: 220, h: 100, modes: ['before'] }]).warnings.length === 0, 'a fixed frame around a_charge is fine');
    ok(chk([{ id: 'm', x: 660, y: 560, w: 240, h: 80, modes: ['after'] }]).warnings.some(w => w.includes('"m"')), 'box of another mode does not count (a_email is "before" only)');
    eq(chk(F.groups), { errors: [], warnings: [] }, 'bundled groups are clean');
  });

  await test('8. exports: SVG has the frame (ghosted ones follow the ghost option), HTML keeps FLOW.groups', async () => {
    await open(page, 'mode=after&layout=0');
    const a = await svgTxt({});
    ok(a.includes('reply and email job run at the same time') && a.includes('>async<'), 'SVG has caption and tag');
    ok(/<rect[^>]*rx="10"[^>]*style="[^"]*stroke-dasharray:\s*7(px)?,?\s*5/.test(a), 'SVG has the dashed frame with inline style');
    ok(/paint-order:\s*stroke/.test(a), 'SVG keeps paint-order on the caption (halo under the text)');
    await js("window.flowMotion.setMode('before'), true");
    ok(!(await svgTxt({ ghost: false })).includes('reply and email job'), 'ghosted frame left out by default');
    ok((await svgTxt({ ghost: true })).includes('reply and email job'), 'ghosted frame kept with ghost: true');
    const html = await js('window.flowMotion.exportHtml()');
    const m = html.match(/<script id="fm-flow">window\.FLOW = ([\s\S]*?);<\/script>/);
    eq(JSON.parse(m[1]).groups.map(g => g.id), ['g_after_enq'], 'HTML export FLOW.groups');
    ok(html.includes('<g id="gGroups">'), 'HTML export has the groups layer');
    const png = await js("window.flowMotion.exportPng({}, 1).then(b => b.size)");
    ok(png > 1000, 'PNG export builds');
  });

  if (shotsDir) {
    await open(page, 'mode=after&layout=0&view=chart');
    await shot('group-dark', 1600);
    await js("document.documentElement.dataset.theme = 'light', true"); await sleep(100);
    await shot('group-light', 1600);
    await setWidth(390);
    await open(page, 'mode=after&layout=0');
    await js("document.querySelector('.grp').scrollIntoView({ block: 'center' }), true");
    await shot('group', 390);
    await setWidth(0);
  }

  await test('no JS errors during the run', async () => { eq(jsErrors, [], 'JS errors'); });
} catch (e) {
  console.error('✖ could not run: ' + e.message); cleanup(); process.exit(2);
}

const failed = results.filter(r => !r[0]);
console.log(`\n${failed.length ? '✖' : '✔'} ${results.length - failed.length}/${results.length} passed`);
if (shotsDir) console.log('shots  ' + path.resolve(shotsDir));
cleanup();
process.exit(failed.length ? 1 : 0);

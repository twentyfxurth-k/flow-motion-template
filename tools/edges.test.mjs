#!/usr/bin/env node
/* Flow Motion · test "arrows follow and can be edited" (draw.io style) in a headless browser.
 * Usage: node tools/edges.test.mjs [dir-or-index.html] [--shots <outdir>]
 *
 * Drives the page over the Chrome DevTools Protocol: the page API (window.flowMotion) plus real pointer
 * input (Input.dispatchMouseEvent / dispatchKeyEvent). Uses its own throw-away browser profile.
 * Expects the bundled example flow.js (it moves "a_fail" / "a_replay" / "c_post" and edits their arrows).
 * Also builds a generated 60-box / 80-arrow page to time a drag (no frame over 16 ms).
 * --shots <outdir>  saves before / after a drag, a selected arrow with its handles, a changed port, at 1600 px and 390 px wide.
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
const tmp = mkdtempSync(path.join(os.tmpdir(), 'fm-edges-'));
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


const route = k => js(`window.flowMotion.getEdgeRoute(${JSON.stringify(k)})`);
const ortho = P => P.every((p, i) => i === 0 || Math.abs(p[0] - P[i - 1][0]) < .01 || Math.abs(p[1] - P[i - 1][1]) < .01);
/* client position of a chart point (scrolled into view) and the chart scale */
async function client(pt) {
  return js(`(() => { const svg = document.getElementById('svg'), p = svg.createSVGPoint(); p.x = ${pt[0]}; p.y = ${pt[1]};
    let q = p.matrixTransform(svg.getScreenCTM());
    if (q.y < 60 || q.y > innerHeight - 60 || q.x < 20 || q.x > innerWidth - 20) { scrollBy(q.x < 20 || q.x > innerWidth - 20 ? q.x - innerWidth / 2 : 0, q.y - innerHeight / 2); q = p.matrixTransform(svg.getScreenCTM()); }
    return { x: q.x, y: q.y, s: svg.getScreenCTM().a }; })()`);
}
/* client centre of an element (scrolled into view) */
async function at(sel) {
  return js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; let r = e.getBoundingClientRect();
    if (r.top < 60 || r.bottom > innerHeight - 60) { scrollBy(0, r.top - innerHeight / 2); r = e.getBoundingClientRect(); }
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, s: document.getElementById('svg').getScreenCTM().a }; })()`);
}
/* real pointer drag from a client point by (dx, dy) chart units; mods: 1 = Alt */
async function pdrag(c, dx, dy, mods = 0, onMid) {
  await mouse('mouseMoved', c.x, c.y, { buttons: 0, modifiers: mods }); await mouse('mousePressed', c.x, c.y, { modifiers: mods });
  const ex = c.x + dx * c.s, ey = c.y + dy * c.s;
  for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', c.x + (ex - c.x) * i / 8, c.y + (ey - c.y) * i / 8, { modifiers: mods }); await sleep(15); }
  if (onMid) await onMid();
  await mouse('mouseReleased', ex, ey, { modifiers: mods }); await sleep(80);
}
async function clickAt(c, n = 1) {
  await mouse('mouseMoved', c.x, c.y, { buttons: 0 });
  for (let i = 1; i <= n; i++) { await mouse('mousePressed', c.x, c.y, { clickCount: i }); await mouse('mouseReleased', c.x, c.y, { clickCount: i }); }
  await sleep(80);
}
/* open with no saved draft */
async function fresh(hash) { await open(page, hash); await js('localStorage.clear(), true'); await open(page, hash); }
const ctrlZ = () => key('z', 'KeyZ', 90, 2), ctrlShiftZ = () => key('Z', 'KeyZ', 90, 2 | 8);
/* the boxes drawn on the page, [id, x0, y0, x1, y1] */
const boxes = () => js(`[...document.querySelectorAll('.nd')].map(g => { const b = g.querySelector('.sh').getBBox(), t = g.getAttribute('transform').match(/translate\\(([-\\d.]+) ([-\\d.]+)\\)/);
  return [g.dataset.id, +t[1] + b.x, +t[2] + b.y, +t[1] + b.x + b.width, +t[2] + b.y + b.height]; })`);
/* does a polyline come closer than gap to a box (open inside)? */
const near = (P, r, gap) => P.some((p, i) => { if (!i) return false; const q = P[i - 1];
  return Math.min(p[0], q[0]) < r[3] + gap && Math.max(p[0], q[0]) > r[1] - gap && Math.min(p[1], q[1]) < r[4] + gap && Math.max(p[1], q[1]) > r[2] - gap; });

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
  await open(page, 'mode=before&move=1');
  await js('localStorage.clear(), true');
  await open(page, 'mode=before&move=1');
  eq(await pos('a_fail'), 'translate(780 380)', 'a_fail starts at flow.js position (is this the bundled example?)');

  await test('1. an auto edge re-routes when its box moves, around the box in between, 12px clear', async () => {
    if (shotsDir) { await open(page, 'mode=before&move=1&view=chart'); await shot('drag-before', 1600); }
    eq((await route('a_stock>a_fail')).route, 'auto', 'a_stock>a_fail is auto');
    await drag('a_fail', 40, 310);
    eq((await layout()).nodes.a_fail, { x: 820, y: 690 }, 'a_fail moved');
    const r = await route('a_stock>a_fail'), B = await boxes(), ch = B.find(b => b[0] === 'a_charge');
    ok(ch[1] < 520 && ch[3] > 520 && ch[2] > 428 && ch[4] < 690, 'a_charge sits on the straight drop from "In stock?" (the old elbow)');
    eq(r.route, 'auto', 'still auto'); ok(ortho(r.pts), 'orthogonal: ' + JSON.stringify(r.pts));
    ok(r.pts.length <= 5, 'at most 3 bends: ' + JSON.stringify(r.pts));
    const hit = B.filter(b => b[0] !== 'a_stock' && b[0] !== 'a_fail' && near(r.pts, b, 11.5)).map(b => b[0]);
    eq(hit, [], 'boxes within 12px of the new route');
    ok(!(await js("window.flowMotion.audit('before')")).some(x => x.includes('a_stock>a_fail')), 'no audit issue for a_stock>a_fail');
    if (shotsDir) await shot('drag-after', 1600);
    await js('window.flowMotion.resetLayout(), true');
  });

  await test('1b. a bend lined up under the box follows it (fan-out bus stays connected)', async () => {
    await fresh('mode=before&move=1');
    ok(await js("window.flowMotion.moveNode('a_fail', 800, 380)"), 'moveNode');
    eq((await layout()).edges['a_fail>c_err'], [[800, 445], [165, 445]], 'bus bend follows in x');
    ok((await edgeD('a_fail>c_err')).startsWith('M800 412'), 'starts at the bottom of the box: ' + await edgeD('a_fail>c_err'));
    await js('window.flowMotion.resetLayout(), true');
  });

  await test('2. a manual edge keeps its middle bends; first and last segments stay orthogonal; a backwards bend is dropped', async () => {
    await fresh('mode=after&move=1');
    await drag('a_replay', 40, 0);
    let r = await route('a_replay>c_ok');
    eq(r.via, [[820, 45], [40, 45], [40, 830]], 'bend next to the box slides with it, the others stay');
    eq(r.pts[0], [820, 88], 'leaves the top of the box'); ok(ortho(r.pts), 'orthogonal');
    await drag('a_replay', 0, -60);
    r = await route('a_replay>c_ok');
    eq(r.via, [[40, 60], [40, 830]], 'the bend at y=45 is now under the top of the box: dropped; the next one lines up with the left port');
    eq(r.pts[0], [720, 60], 'leaves the left side'); ok(ortho(r.pts), 'orthogonal');
    ok(r.pts[1][0] < r.pts[0][0], 'first segment goes away from the box');
    await js('window.flowMotion.resetLayout(), true');
  });

  await test('3. bend drag, segment drag, add bend, delete bend change the route; Ctrl+Z / Shift+Ctrl+Z undo and redo', async () => {
    await fresh('mode=after&move=1');
    const K = 'a_replay>c_ok', v0 = [[780, 45], [40, 45], [40, 830]];
    eq((await route(K)).via, v0, 'starts as flow.js');
    await clickAt(await client([40, 400]));
    eq(await js('window.flowMotion.selectedEdge'), K, 'click on the line selects the arrow');
    eq(await js("[document.querySelectorAll('#gHandles .hb').length, document.querySelectorAll('#gHandles .he').length]"), [3, 2], 'bend and end handles');
    ok(await js(`document.querySelector('.ed[data-k="${K}"]').classList.contains('esel')`), 'arrow highlighted');
    if (shotsDir) { await js("document.getElementById('chart').scrollIntoView({ block: 'start' }), true"); await shot('edge-selected', 1600); }
    await pdrag(await at('#gHandles .hb[data-i="2"]'), 20, 15);
    eq((await route(K)).via, [[780, 60], [60, 60], [60, 830]], 'corner bend dragged, its neighbours follow');
    ok(ortho((await route(K)).pts), 'orthogonal after bend drag');
    await ctrlZ(); eq((await route(K)).via, v0, 'undo');
    await ctrlShiftZ(); eq((await route(K)).via, [[780, 60], [60, 60], [60, 830]], 'redo');
    await pdrag(await at('#gHandles .hs[data-i="1"]'), 0, -20);
    eq((await route(K)).via, [[780, 40], [60, 40], [60, 830]], 'segment dragged along its normal, both bends move');
    await clickAt(await at('#gHandles .hs[data-i="2"]'), 2);
    const va = (await route(K)).via;
    ok(va.length === 4 && va[2][0] === 60 && va[2][1] >= 420 && va[2][1] <= 450 && va[2][1] % 10 === 0, 'double-click on a segment adds a bend there: ' + JSON.stringify(va));
    ok(await js("!!document.querySelector('#gHandles .hb.on')"), 'the new bend is selected');
    await key('Delete', 'Delete', 46);
    eq((await route(K)).via, [[780, 40], [60, 40], [60, 830]], 'Delete removes the selected bend');
    await clickAt(await at('#gHandles .hb[data-i="1"]'), 2);
    const r = await route(K);
    ok(r.via.length < 3 && ortho(r.pts), 'double-click on a corner removes it: ' + JSON.stringify(r));
    ok(!r.pts.some((p, i) => i > 1 && ((p[0] === r.pts[i - 1][0] && p[0] === r.pts[i - 2][0]) || (p[1] === r.pts[i - 1][1] && p[1] === r.pts[i - 2][1]))), 'no spike / doubled-back segment: ' + JSON.stringify(r.pts));
    await clickAt(await at('#gHandles .hs[data-i="0"]'));
    const n = (await route(K)).via.length;
    await pdrag(await at('#gHandles .hs[data-i="1"]'), 30, 0, 1);
    eq((await route(K)).via.length, n + 1, 'Alt-drag on a segment splits it (one bend more)');
    for (let i = 0; i < 6; i++) await ctrlZ();
    eq((await route(K)).via, v0, 'six undos bring flow.js back');
    eq(await layout(), { nodes: {}, edges: {} }, 'getLayout() empty again');
  });

  await test('4. dragging an end changes the port; dropping it on another box is refused with a toast', async () => {
    await fresh('mode=before&move=1');
    const K = 'c_tap>c_post';
    await clickAt(await client([165, 150]));
    eq(await js('window.flowMotion.selectedEdge'), K, 'arrow selected');
    await pdrag(await at('#gHandles .he[data-end="1"]'), 100, 32);
    let r = await route(K);
    eq(r.to, { side: 'right' }, 'to port'); eq(r.pts[r.pts.length - 1], [265, 220], 'ends on the right side of c_post');
    ok(r.pts[r.pts.length - 2][1] === 220 && r.pts[r.pts.length - 2][0] > 265, 'enters from the right, horizontally');
    ok(ortho(r.pts), 'orthogonal');
    if (shotsDir) { await js("document.getElementById('chart').scrollIntoView({ block: 'start' }), true"); await shot('port-changed', 1600); }
    const before = JSON.stringify(r);
    await pdrag(await at('#gHandles .he[data-end="1"]'), 255, 160, 0, async () => {
      ok(await js("!!document.querySelector('#gHandles .he.bad')"), 'end handle turns red over another box');
    });
    eq(JSON.stringify(await route(K)), before, 'route unchanged after a refused drop');
    ok(await js("document.getElementById('toast').classList.contains('on') && /cannot be connected/.test(document.getElementById('toast').textContent)"), 'toast shown');
    eq((await layout()).edges[K], { to: { side: 'right' } }, 'getLayout() has the port only');
    const h0 = await js(`(() => { const c = document.querySelector('#gHandles .he[data-end="0"]'); return [+c.getAttribute('cx'), +c.getAttribute('cy')]; })()`);
    await pdrag(await at('#gHandles .he[data-end="0"]'), 105 - h0[0], 123 - h0[1], 0);
    r = await route(K);
    eq(r.from, { side: 'bottom', t: 0.25 }, 'start port snapped to a quarter of the side');
    eq(r.pts[0], [117.5, 118], 'line starts a quarter along the bottom of c_tap'); ok(ortho(r.pts), 'orthogonal');
  });

  await test('5. dragging the label saves lt; Alt-drag saves a free offset lo', async () => {
    await fresh('mode=before&move=1');
    const K = 'a_stock>a_charge';
    await pdrag(await at(`.ed[data-k="${K}"] .el rect`), 0, 20);
    eq(await js('window.flowMotion.selectedEdge'), K, 'pressing a label selects its arrow');
    eq((await route(K)).lt, 0.75, 'lt');
    eq((await layout()).edges[K], { lt: 0.75 }, 'getLayout()');
    await pdrag(await at(`.ed[data-k="${K}"] .el rect`), 30, 0, 1);
    eq((await route(K)).lo, [30, 0], 'lo with Alt');
    await ctrlZ(); await ctrlZ();
    eq(await layout(), { nodes: {}, edges: {} }, 'undone');
  });

  await test('6. Re-route returns an edited edge to auto (button and API); Esc cancels an arrow drag and deselects', async () => {
    await fresh('mode=after&move=1');
    const K = 'a_replay>c_ok';
    await clickAt(await client([40, 400]));
    ok(await js("!document.getElementById('bReroute').hidden"), 'Re-route button shown for a selected arrow');
    await pdrag(await at('#gHandles .hb[data-i="2"]'), 30, 0, 0, async () => { await key('Escape', 'Escape', 27); });
    eq((await route(K)).via, [[780, 45], [40, 45], [40, 830]], 'Esc during a drag puts the arrow back');
    await js("document.getElementById('bReroute').click(), true");
    let r = await route(K);
    eq([r.route, r.via], ['auto', null], 'auto after Re-route'); ok(ortho(r.pts), 'orthogonal');
    eq((await layout()).edges[K], { route: 'auto' }, 'getLayout() says route auto');
    await ctrlZ(); eq((await route(K)).via, [[780, 45], [40, 45], [40, 830]], 'undo brings the bends back');
    await key('Escape', 'Escape', 27);
    eq(await js('window.flowMotion.selectedEdge'), '', 'Esc deselects the arrow');
    ok(await js("document.querySelectorAll('#gHandles *').length === 0"), 'no handles left');
    ok(await js("window.flowMotion.moveNode('a_replay', 800, 120)"), 'move a box');
    ok(await js('window.flowMotion.rerouteAll() >= 1'), 'rerouteAll() re-routes the arrows of moved boxes');
    eq((await route(K)).route, 'auto', 'auto after rerouteAll');
    await js('window.flowMotion.resetLayout(), true');
  });

  await test('7. a reload keeps the edits, #layout=0 ignores them, Reset clears them', async () => {
    await fresh('mode=after&move=1');
    ok(await js("window.flowMotion.setEdgeRoute('c_tap>c_post', { to: { side: 'right' } })"), 'setEdgeRoute');
    ok(await js("window.flowMotion.setEdgeRoute('a_replay>c_ok', { via: [[780, 60], [60, 60], [60, 830]], lt: 0.2 })"), 'setEdgeRoute via + lt');
    await open(page, 'mode=after');
    eq((await route('c_tap>c_post')).to, { side: 'right' }, 'port after reload');
    eq((await route('a_replay>c_ok')).via, [[780, 60], [60, 60], [60, 830]], 'bends after reload');
    eq((await route('a_replay>c_ok')).lt, 0.2, 'lt after reload');
    await open(page, 'mode=after&layout=0');
    eq((await route('c_tap>c_post')).to, null, '#layout=0 ignores the draft');
    eq(await layout(), { nodes: {}, edges: {} }, 'getLayout() with #layout=0');
    await open(page, 'mode=after');
    await js('window.flowMotion.resetLayout(), true');
    eq(await layout(), { nodes: {}, edges: {} }, 'getLayout() after reset');
    ok(await js("localStorage.getItem('flowmotion:example-checkout:layout') === null"), 'draft removed');
    eq((await route('a_replay>c_ok')).via, [[780, 45], [40, 45], [40, 830]], 'flow.js bends back');
  });

  await test('8. exports use the edited route (SVG path = live path, HTML embeds FLOW.layout.edges)', async () => {
    await open(page, 'mode=after&move=1');
    const K = 'a_replay>c_ok', v = [[780, 60], [60, 60], [60, 830]];
    await js(`window.flowMotion.setEdgeRoute('${K}', { via: ${JSON.stringify(v)} })`);
    const d = await edgeD(K), svg = await js('window.flowMotion.exportSvg({})');
    ok(svg.includes(`d="${d}"`), 'exported SVG has the edited path ' + d);
    ok(!svg.includes('gHandles'), 'no edit handles in the SVG');
    const html = await js('window.flowMotion.exportHtml()'), m = html.match(/<script id="fm-flow">window\.FLOW = ([\s\S]*?);<\/script>/);
    eq(JSON.parse(m[1]).layout.edges[K], v, 'HTML export FLOW.layout.edges');
    await js('window.flowMotion.resetLayout(), true');
    /* the object form in flow.js (as written by Copy positions) is applied at load */
    const d2 = path.join(tmp, 'site'); mkdirSync(d2);
    copyFileSync(page, path.join(d2, 'index.html')); copyFileSync(path.join(dir, 'validate.js'), path.join(d2, 'validate.js'));
    writeFileSync(path.join(d2, 'flow.js'), readFileSync(path.join(dir, 'flow.js'), 'utf8') +
      "\nwindow.FLOW.layout = { edges: { 'c_tap>c_post': { to: { side: 'right' }, lt: 0.3 }, 'a_fail>c_err': { route: 'auto' } } };\n");
    await open(path.join(d2, 'index.html'), 'mode=before&layout=0');
    eq(await js('window.FLOW_CHECK.errors'), [], 'data check');
    eq((await route('c_tap>c_post')).to, { side: 'right' }, 'layout.edges object form applied');
    eq([(await route('a_fail>c_err')).route, (await route('a_fail>c_err')).via], ['auto', null], 'route: auto drops the via');
    eq(await layout(), { nodes: {}, edges: {} }, 'FLOW.layout counts as flow.js, not as an edit');
  });

  await test('9. validate.js: errors for bad layout.edges and bad from / to / lo', async () => {
    const { flowCheck } = createRequire(import.meta.url)(path.join(dir, 'validate.js'));
    const sb = { window: {} }; vm.createContext(sb); vm.runInContext(readFileSync(path.join(dir, 'flow.js'), 'utf8'), sb);
    const F = sb.window.FLOW, chk = E => flowCheck(Object.assign({}, F, { layout: { edges: E } }));
    const E = (L, s) => ok(chk(L).errors.some(e => e.includes(s)), `expected error "${s}", got ${JSON.stringify(chk(L).errors)}`);
    E({ 'x>y': [[1, 2]] }, '"x>y" is not an edge');
    E({ 'c_tap>c_post': { from: { side: 'middle' } } }, 'from: side must be');
    E({ 'c_tap>c_post': { to: { side: 'top', t: 2 } } }, 'to: t must be a number from 0 to 1');
    E({ 'c_tap>c_post': { via: [['a', 1]] } }, '.via must look like');
    E({ 'c_tap>c_post': [[1, 'b']] }, 'must look like [[x,y],[x,y]]');
    E({ 'c_tap>c_post': { lt: 1.5 } }, '.lt must be a number between 0 and 1');
    E({ 'c_tap>c_post': { lo: [1] } }, '.lo must look like [dx, dy]');
    E({ 'c_tap>c_post': { route: 'curvy' } }, '.route must be "auto" or "manual"');
    E({ 'c_tap>c_post': 'nope' }, 'must be [[x,y],…] or { via');
    eq(chk({ 'c_tap>c_post': { via: [[165, 150]], from: { side: 'bottom', t: 0.25 }, to: null, lt: 0.3, lo: [4, -6] } }).errors, [], 'a valid entry');
    ok(chk({ 'c_tap>c_post': { bend: 1 } }).warnings.some(w => w.includes('unknown key "bend"')), 'unknown key is a warning');
    const ce = e => flowCheck(Object.assign({}, F, { edges: F.edges.map((x, i) => i ? x : Object.assign({}, x, e)) })).errors;
    ok(ce({ from: { side: 'up' } }).some(e => e.includes('from: side must be')), 'edges[].from side');
    ok(ce({ lo: 'x' }).some(e => e.includes('lo must look like')), 'edges[].lo');
    eq(ce({ route: 'manual', to: { side: 'left', t: 0.5 } }), [], 'edges[].route manual + to are valid');
  });

  await test('10. outside Move mode a click on an arrow does not select it; self test still 100%', async () => {
    await open(page, 'mode=before');
    await clickAt(await client([165, 150]));
    eq(await js('window.flowMotion.selectedEdge'), '', 'not selected');
    ok(await js("document.querySelectorAll('#gHandles *').length === 0"), 'no handles');
    await open(page, 'selftest=1', '!!document.documentElement.dataset.selftest');
    const r = await js('window.FLOW_SELFTEST');
    ok(r.ok, 'selftest: ' + JSON.stringify(r.errors)); ok(r.runs.every(x => x.reached === x.steps), 'every run complete');
  });

  await test('11. perf: dragging a box with 10 arrows in a 60-box / 80-arrow page, no frame over 16 ms', async () => {
    const d3 = path.join(tmp, 'big'); mkdirSync(d3);
    copyFileSync(page, path.join(d3, 'index.html')); copyFileSync(path.join(dir, 'validate.js'), path.join(d3, 'validate.js'));
    const nodes = [], edges = [], id = (c, r) => `n${r}_${c}`;
    for (let r = 0; r < 6; r++) for (let c = 0; c < 10; c++) nodes.push({ id: id(c, r), x: 140 + c * 260, y: 80 + r * 160, t: `Box ${r}.${c}` });
    const hub = id(4, 2), add = (a, b, x) => { if (a !== b && !edges.some(e => e.a === a && e.b === b)) edges.push(Object.assign({ a, b }, x || {})); };
    [[3, 2], [5, 2], [4, 1], [4, 3], [2, 0], [6, 4], [8, 1], [0, 5], [9, 5], [7, 0]].forEach(([c, r], i) => add(hub, id(c, r), i % 3 ? {} : { via: [[140 + c * 260, 80 + 2 * 160 + 50]] }));
    for (let r = 0; r < 6 && edges.length < 80; r++) for (let c = 0; c < 9 && edges.length < 80; c++) add(id(c, r), id(c + 1, r));
    for (let r = 0; r < 5 && edges.length < 80; r++) for (let c = 0; c < 10 && edges.length < 80; c += 3) add(id(c, r), id(c, r + 1));
    const FL = { id: 'perf-grid', title: 'Perf grid', nodes, edges, tokens: [{ k: 't' }], scenarios: [{ id: 's', t: 's', steps: [{ k: 't', at: hub }] }] };
    writeFileSync(path.join(d3, 'flow.js'), 'window.FLOW = ' + JSON.stringify(FL) + ';\n');
    await open(path.join(d3, 'index.html'), 'move=1&layout=0');
    eq([await js('Object.keys(window.FLOW.nodes).length'), await js('window.FLOW.edges.length')], [60, 80], 'page size');
    const c = await centreOf(hub);
    await mouse('mouseMoved', c.x, c.y, { buttons: 0 }); await mouse('mousePressed', c.x, c.y);
    for (let i = 1; i <= 40; i++) { await mouse('mouseMoved', c.x + i * 4 * c.sx, c.y + i * 3 * c.sy); await sleep(16); }
    await mouse('mouseReleased', c.x + 160 * c.sx, c.y + 120 * c.sy); await sleep(100);
    const st = await js('window.flowMotion.dragStats()');
    console.log(`   perf: ${st.frames} frames · max ${st.max} ms · avg ${st.avg} ms (10 arrows on the box, 60 boxes, 80 arrows)`);
    ok(st.frames >= 10, 'frames measured: ' + JSON.stringify(st));
    ok(st.max < 16, 'max frame ' + st.max + ' ms');
  });

  if (shotsDir) {
    await setWidth(390);
    await open(page, 'mode=after&move=1');
    await js("window.flowMotion.selectEdge('a_replay>c_ok'), true");
    await js("document.getElementById('chart').scrollIntoView({ block: 'start' }), true");
    await shot('edge-selected', 390);
    await js("window.flowMotion.resetLayout(), true");
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

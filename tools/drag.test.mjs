#!/usr/bin/env node
/* Flow Motion · test "drag boxes to move them" in a headless browser.
 * Usage: node tools/drag.test.mjs [dir-or-index.html] [--shots <outdir>]
 *
 * Drives the page over the Chrome DevTools Protocol: the page API (window.flowMotion) plus real pointer
 * input (Input.dispatchMouseEvent / dispatchKeyEvent). Uses its own throw-away browser profile.
 * Expects the bundled example flow.js (it drags "a_fail" and clicks "c_post").
 * --shots <outdir>  saves Move mode on and mid-drag screenshots at 1600 px and 390 px wide.
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
const tmp = mkdtempSync(path.join(os.tmpdir(), 'fm-drag-'));
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
  await js("localStorage.clear(), true");
  await open(page, 'mode=before&move=1');
  const base = await pos('a_fail');
  eq(base, 'translate(780 380)', 'a_fail starts at flow.js position (is this the bundled example?)');
  ok(await js("document.body.classList.contains('mvon') && !document.getElementById('mvHint').hidden"), '#move=1 opens with Move on and the hint shown');

  await test('1. drag 100,50 moves the box and the edge ends; a bend that would run back through the box is dropped', async () => {
    await shot('move-on', 1600);
    await drag('a_fail', 100, 50, () => shot('mid-drag', 1600));
    eq(await pos('a_fail'), 'translate(880 430)', 'box position');
    eq((await layout()).nodes.a_fail, { x: 880, y: 430 }, 'getLayout().nodes.a_fail');
    /* the bus at y=445 is now inside the box (bottom 462): its first bend is dropped and the next one lines up with the left port
       (the "bus follows in x" case is in tools/edges.test.mjs) */
    eq((await layout()).edges['a_fail>c_err'], [[165, 430]], 'bend under the box dropped, next bend lined up with the port');
    ok((await edgeD('a_fail>c_err')).startsWith('M780 430'), 'edge a_fail>c_err starts at the left side of the box: ' + await edgeD('a_fail>c_err'));
    ok((await edgeD('a_stock>a_fail')).includes('780'), 'edge a_stock>a_fail re-routed to the new left side: ' + await edgeD('a_stock>a_fail'));
    ok(!(await js("document.getElementById('svg').dataset.sel")), 'a drag does not select the box');
  });

  await test('2. a press that moves under 4px selects the box and does not move it', async () => {
    const c = await centreOf('c_post'), before = await pos('c_post');
    await mouse('mouseMoved', c.x, c.y, { buttons: 0 }); await mouse('mousePressed', c.x, c.y);
    await mouse('mouseMoved', c.x + 2, c.y + 1); await mouse('mouseReleased', c.x + 2, c.y + 1); await sleep(60);
    eq(await js("document.getElementById('svg').dataset.sel"), 'c_post', 'selected box');
    ok(!(await js("document.getElementById('selCard').hidden")), 'detail card is open');
    eq(await pos('c_post'), before, 'position unchanged');
    ok(!(await layout()).nodes.c_post, 'c_post not in getLayout()');
  });

  await test('3. Ctrl+Z restores the box, Shift+Ctrl+Z moves it again', async () => {
    await key('z', 'KeyZ', 90, 2);
    eq(await pos('a_fail'), 'translate(780 380)', 'after undo');
    eq(await layout(), { nodes: {}, edges: {} }, 'getLayout() after undo');
    await key('Z', 'KeyZ', 90, 2 | 8);
    eq(await pos('a_fail'), 'translate(880 430)', 'after redo');
    eq((await layout()).edges['a_fail>c_err'], [[165, 430]], 'waypoint after redo');
  });

  await test('3b. arrow keys move the selected box (10px, Shift = 1px) and Esc cancels a drag', async () => {
    await open(page, 'mode=before&move=1&sel=a_fail');
    await key('ArrowDown', 'ArrowDown', 40); await key('ArrowLeft', 'ArrowLeft', 37, 8);
    eq(await pos('a_fail'), 'translate(879 440)', 'after ↓ and Shift+←');
    await key('z', 'KeyZ', 90, 2); await key('z', 'KeyZ', 90, 2);
    eq(await pos('a_fail'), 'translate(880 430)', 'two undos');
    await drag('a_fail', 60, 0, async () => { await key('Escape', 'Escape', 27); });
    eq(await pos('a_fail'), 'translate(880 430)', 'after Esc during a drag');
  });

  await test('4. a reload keeps the position (localStorage) and #layout=0 ignores it', async () => {
    await open(page, 'mode=before');
    eq(await pos('a_fail'), 'translate(880 430)', 'after reload');
    ok(await js("!!localStorage.getItem('flowmotion:example-checkout:layout')"), 'saved under flowmotion:<id>:layout');
    await open(page, 'mode=before&layout=0');
    eq(await pos('a_fail'), 'translate(780 380)', 'with #layout=0');
    eq(await layout(), { nodes: {}, edges: {} }, 'getLayout() with #layout=0');
    ok(await js("!!localStorage.getItem('flowmotion:example-checkout:layout')"), '#layout=0 leaves the saved draft alone');
    await open(page, 'mode=before');
  });

  await test('7. exports use the live positions (SVG transform, HTML embeds FLOW.layout)', async () => {
    ok(await js("window.flowMotion.moveNode('a_fail', 900, 420)"), 'moveNode returns true');
    const svg = await js('window.flowMotion.exportSvg({})');
    ok(/<g[^>]*transform="translate\(900 420\)"[^>]*data-id="a_fail"/.test(svg), 'exported SVG has a_fail at 900,420');
    const html = await js('window.flowMotion.exportHtml()');
    const m = html.match(/<script id="fm-flow">window\.FLOW = ([\s\S]*?);<\/script>/);
    ok(m, 'HTML export has the flow data');
    const L = JSON.parse(m[1]).layout || {};
    eq(L.a_fail, { x: 900, y: 420 }, 'HTML export FLOW.layout.a_fail');
    eq(L.edges && L.edges['a_fail>c_err'], [[165, 420]], 'HTML export FLOW.layout.edges');
    ok(Array.isArray(await js('window.FLOW_AUDIT')), 'FLOW_AUDIT updated');
  });

  await test('6. getLayout() after resetLayout() is empty and the saved draft is gone', async () => {
    await js('window.flowMotion.resetLayout(), true');
    eq(await layout(), { nodes: {}, edges: {} }, 'getLayout()');
    eq(await pos('a_fail'), 'translate(780 380)', 'a_fail back at flow.js position');
    ok(await js("localStorage.getItem('flowmotion:example-checkout:layout') === null"), 'localStorage entry removed');
    eq(await js('window.FLOW_AUDIT.length'), 0, 'layout audit clean again');
  });

  await test('5. FLOW.layout in flow.js is applied; validate.js rejects a bad key', async () => {
    const d = path.join(tmp, 'site'); mkdirSync(d);
    copyFileSync(page, path.join(d, 'index.html')); copyFileSync(path.join(dir, 'validate.js'), path.join(d, 'validate.js'));
    writeFileSync(path.join(d, 'flow.js'), readFileSync(path.join(dir, 'flow.js'), 'utf8') +
      "\nwindow.FLOW.layout = { a_fail: { x: 800 }, edges: { 'a_fail>c_err': [[800, 445], [165, 445]] } };\n");
    await open(path.join(d, 'index.html'), 'mode=before&layout=0');
    eq(await pos('a_fail'), 'translate(800 380)', 'a_fail placed by FLOW.layout (x only)');
    ok((await edgeD('a_fail>c_err')).startsWith('M800 '), 'edge follows layout.edges');
    eq(await layout(), { nodes: {}, edges: {} }, 'FLOW.layout counts as flow.js, not as a move');
    eq(await js('window.FLOW_CHECK.errors'), [], 'page data check');
    const { flowCheck } = createRequire(import.meta.url)(path.join(dir, 'validate.js'));
    const sb = { window: {} }; vm.createContext(sb); vm.runInContext(readFileSync(path.join(dir, 'flow.js'), 'utf8'), sb);
    const F = sb.window.FLOW, chk = L => flowCheck(Object.assign({}, F, { layout: L }));
    ok(chk({ nope: { x: 1, y: 2 } }).errors.some(e => e.includes('layout: "nope" is not a node id')), 'unknown key is an error');
    ok(chk({ a_fail: { x: 'a' } }).errors.some(e => e.includes('layout.a_fail: x must be a finite number')), 'non-number x is an error');
    ok(chk({ a_fail: { y: Infinity } }).errors.some(e => e.includes('y must be a finite number')), 'Infinity is an error');
    ok(chk({ edges: { 'x>y': [[1, 2]] } }).errors.some(e => e.includes('"x>y" is not an edge')), 'unknown edge is an error');
    ok(chk({ a_fail: { x: 5000, y: 5000 } }).warnings.some(e => e.includes('outside every lane')), 'box outside every lane is a warning');
    eq(chk({ a_fail: { x: 800 } }).errors, [], 'a valid layout has no errors');
  });

  await test('8. self test still passes 100% on the bundled flow.js', async () => {
    await open(page, 'selftest=1', "!!document.documentElement.dataset.selftest");
    const r = await js('window.FLOW_SELFTEST');
    ok(r.ok, 'selftest: ' + JSON.stringify(r.errors));
    ok(r.runs.every(x => x.reached === x.steps), 'every run complete');
  });

  if (shotsDir) {
    /* desktop: a drop that creates layout issues (badge on the toggle), then the Copy positions dialog */
    await open(page, 'mode=before&move=1');
    await drag('a_fail', -260, 0);
    await js("document.getElementById('bMove').scrollIntoView({ block: 'start' }), true");
    await shot('after-drop-badge', 1600);
    await js("document.getElementById('mvCopy').click(), true"); await sleep(100);
    await shot('copy-positions', 1600);
    await js('window.flowMotion.resetLayout(), true');
    await setWidth(390);
    await open(page, 'mode=after&move=1');
    await js("document.getElementById('bMove').scrollIntoView({ block: 'start' }), true");
    await shot('move-on', 390);
    await drag('a_enq', 0, 60, () => shot('mid-drag', 390));
    await js('window.flowMotion.resetLayout(), true');
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

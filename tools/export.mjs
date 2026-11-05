#!/usr/bin/env node
/* Flow Motion · export without clicking (for agents, CI, docs).
 * Usage: node tools/export.mjs [dir-or-index.html] [--out <dir>] [--formats svg,png,html]
 *                              [--mode <id>] [--scen <id>] [--step <n>] [--ghost] [--theme light|dark]
 *
 * Opens the page in headless Chrome with #export=..., reads the result the page writes into
 * <pre id="flow-export">, and saves <out>/<flowId>_<mode>_<scen>_s<step>.{svg,png,html}.
 * SVG / PNG = the chart at that mode / scenario / step. HTML = page + validate.js + flow data in one file.
 * Exit code: 0 = all files written, 1 = the page reported an error, 2 = could not run (no Chrome, bad path).
 * Chrome: set CHROME=/path/to/chrome, otherwise common install paths are tried.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const VALUED = ['--out', '--formats', '--mode', '--scen', '--step', '--theme'];
const target = args.find((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1])) || '.';
let page = path.resolve(target);
if (existsSync(page) && statSync(page).isDirectory()) page = path.join(page, 'index.html');
if (!existsSync(page)) { console.error(`✖ ${page} not found`); process.exit(2); }
const outDir = path.resolve(opt('--out') || 'export');
const formats = (opt('--formats') || 'svg,png,html').split(',').map(s => s.trim()).filter(Boolean);
const bad = formats.filter(f => !['svg', 'png', 'html'].includes(f));
if (bad.length) { console.error('✖ unknown format(s): ' + bad.join(', ') + ' · use svg,png,html'); process.exit(2); }

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

const h = new URLSearchParams({ export: formats.join(',') });
for (const k of ['mode', 'scen', 'step']) if (opt('--' + k)) h.set(k, opt('--' + k));
if (args.includes('--ghost')) h.set('ghost', '1');
const theme = opt('--theme');
const flags = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--virtual-time-budget=30000', '--window-size=1600,1200', '--dump-dom'];
if (theme === 'dark') flags.push('--force-dark-mode', '--blink-settings=preferredColorScheme=0');
if (theme === 'light') flags.push('--blink-settings=preferredColorScheme=1');

let dom;
try { dom = execFileSync(chrome, [...flags, pathToFileURL(page).href + '#' + h.toString()], { encoding: 'utf8', timeout: 120000, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); }
catch (e) { console.error('✖ headless run failed: ' + e.message); process.exit(2); }

const m = dom.match(/<pre id="flow-export"[^>]*>([\s\S]*?)<\/pre>/);
if (!m) { console.error('✖ the page did not write #flow-export (did index.html load? run tools/audit.mjs)'); process.exit(1); }
const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
let res;
try { res = JSON.parse(unesc(m[1])); } catch (e) { console.error('✖ could not read the export: ' + e.message); process.exit(1); }
if (res.error) { console.error('✖ ' + res.error); process.exit(1); }

mkdirSync(outDir, { recursive: true });
let n = 0;
for (const f of formats) {
  const v = res[f]; if (!v) { console.error(`✖ ${f}: nothing returned`); continue; }
  const file = path.join(outDir, `${res.name}.${f}`);
  writeFileSync(file, f === 'png' ? Buffer.from(v.split(',')[1], 'base64') : v);
  console.log(`✔ ${file} (${Math.round(statSync(file).size / 1024)} KB)`);
  n++;
}
process.exit(n === formats.length ? 0 : 1);

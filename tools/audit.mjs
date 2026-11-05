#!/usr/bin/env node
/* Flow Motion · full audit in a headless browser.
 * Usage: node tools/audit.mjs [dir-or-index.html] [--shots <outdir>] [--json]
 *
 * Runs the page once with #selftest=1 and reports:
 *   1. data check   (validate.js)          → errors / warnings
 *   2. layout audit (engine, every mode)   → overlaps, lines through boxes, labels on lines, text overflow
 *   3. self test    (every scenario×mode)  → JS errors, steps that did not run
 *   4. export       (SVG / PNG / HTML)     → each one builds and is not empty
 * --shots <outdir>  also saves one chart-only screenshot per mode (<outdir>/<mode>.png) for a visual review.
 * Exit code: 0 = clean, 1 = issues found, 2 = could not run (no Chrome, bad path).
 * Chrome: set CHROME=/path/to/chrome, otherwise common install paths are tried.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const shotsDir = opt('--shots');
const target = args.find(a => !a.startsWith('--') && a !== shotsDir) || '.';
let page = path.resolve(target);
if (existsSync(page) && statSync(page).isDirectory()) page = path.join(page, 'index.html');
if (!existsSync(page)) { console.error(`✖ ${page} not found`); process.exit(2); }

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

const url = h => pathToFileURL(page).href + '#' + h;
const run = (extra, h, timeout = 90000) => execFileSync(chrome,
  ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--virtual-time-budget=30000', ...extra, url(h)],
  { encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

let dom;
try { dom = run(['--window-size=1600,1200', '--dump-dom'], 'selftest=1'); }
catch (e) { console.error('✖ headless run failed: ' + e.message); process.exit(2); }

const attr = n => (dom.match(new RegExp(`<html[^>]*\\b${n}="([^"]*)"`)) || [])[1];
const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const items = re => { const m = dom.match(re); return m ? [...m[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map(x => unesc(x[1])) : []; };
const errors = items(/<div class="box"><b>\d+ error\(s\)[\s\S]*?<ul>([\s\S]*?)<\/ul>/);
const warnings = items(/<summary>\d+ warning\(s\)<\/summary><ul>([\s\S]*?)<\/ul>/);
const layout = items(/<summary>\d+ layout issue\(s\)[^<]*<\/summary><ul>([\s\S]*?)<\/ul>/);
let self = null;
const sm = dom.match(/<pre id="flow-selftest">([\s\S]*?)<\/pre>/);
if (sm) { try { self = JSON.parse(unesc(sm[1])); } catch { self = null; } }

const report = {
  page, check: attr('data-check') || 'missing', errors, warnings,
  audit: Number(attr('data-audit') ?? NaN), layout,
  selftest: self ? { ok: self.ok, errors: self.errors, incomplete: self.runs.filter(r => r.reached !== r.steps), runs: self.runs.length, exports: self.exports || null } : null,
  shots: [],
};

if (shotsDir) {
  mkdirSync(shotsDir, { recursive: true });
  const modes = self ? [...new Set(self.runs.map(r => r.mode))] : [''];
  for (const m of modes) {
    const out = path.resolve(shotsDir, (m || 'default') + '.png');
    try { run(['--window-size=2400,2400', `--screenshot=${out}`], `view=chart${m ? '&mode=' + m : ''}`); report.shots.push(out); }
    catch (e) { report.shots.push(`FAILED ${m}: ${e.message}`); }
  }
}

if (flag('--json')) { console.log(JSON.stringify(report, null, 1)); }
else {
  console.log(`page   ${page}`);
  console.log(`check  ${report.check === 'ok' ? '✔' : '✖'} ${errors.length} error(s) · ${warnings.length} warning(s)`);
  errors.forEach(e => console.log('   ✖ ' + e)); warnings.forEach(w => console.log('   ⚠ ' + w));
  console.log(`layout ${report.audit === 0 ? '✔' : '✖'} ${isNaN(report.audit) ? '?' : report.audit} issue(s)`);
  layout.forEach(x => console.log('   ✖ ' + x));
  if (!report.selftest) console.log('self   ✖ did not run (page did not finish loading?)');
  else {
    const t = report.selftest;
    console.log(`self   ${t.ok ? '✔' : '✖'} ${t.runs} run(s) · ${t.errors.length} JS error(s) · ${t.incomplete.length} incomplete`);
    t.errors.forEach(e => console.log('   ✖ ' + e));
    t.incomplete.forEach(r => console.log(`   ✖ ${r.mode}/${r.scen}: reached ${r.reached} of ${r.steps} steps`));
    const x = t.exports;
    console.log(x ? `export ${x.svg && x.png && x.html ? '✔' : '✖'} svg ${Math.round((x.svg || 0) / 1024)} KB · png ${Math.round((x.png || 0) / 1024)} KB · html ${Math.round((x.html || 0) / 1024)} KB` : 'export ✖ not checked (old index.html?)');
  }
  report.shots.forEach(s => console.log('shot   ' + s));
}
const clean = report.check === 'ok' && !warnings.length && report.audit === 0 && report.selftest && report.selftest.ok && !!report.selftest.exports;
process.exit(clean ? 0 : 1);

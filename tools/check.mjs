#!/usr/bin/env node
/* Flow Motion · check a flow file without a browser.
 * Usage: node tools/check.mjs [path/to/flow.js]
 * Exit code: 0 = no errors, 1 = errors found, 2 = the file does not run.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.resolve(process.argv[2] || path.join(root, 'flow.js'));
const { flowCheck, resolveSteps } = createRequire(import.meta.url)(path.join(root, 'validate.js'));

const sandbox = { window: {} };
vm.createContext(sandbox);
try {
  vm.runInContext(readFileSync(file, 'utf8'), sandbox, { filename: file, timeout: 2000 });
} catch (e) {
  console.error(`✖ ${path.relative(process.cwd(), file)} does not run: ${e.message}`);
  process.exit(2);
}

const F = sandbox.window.FLOW;
const { errors, warnings } = flowCheck(F);

if (F && typeof F === 'object') {
  const modes = (F.modes && F.modes.length ? F.modes : [{ id: 'default' }]).map(m => m.id);
  console.log(`flow "${F.id || '(no id)'}": ${(F.nodes || []).length} nodes · ${(F.edges || []).length} edges · ${modes.length} modes · ${(F.scenarios || []).length} scenarios`);
  for (const sc of F.scenarios || []) {
    const per = modes.map(m => { const s = resolveSteps(sc, m); return `${m}=${Array.isArray(s) ? s.length : '—'}`; }).join(' ');
    console.log(`  · ${sc.id}: ${per}`);
  }
}
for (const w of warnings) console.log(`⚠ ${w}`);
for (const e of errors) console.log(`✖ ${e}`);
console.log(errors.length ? `\n${errors.length} error(s), ${warnings.length} warning(s)` : `\n✔ OK · ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);

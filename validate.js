/* Flow Motion · data validator
 * Works in the browser (window.flowCheck) and in Node (require('./validate.js').flowCheck).
 * Returns { errors: string[], warnings: string[] }. The page refuses nothing; it shows the list.
 */
(function (root) {
  'use strict';
  const NODE_TYPES = ['rect', 'term', 'dec', 'db', 'task', 'note'];
  const TONES = ['', 'ok', 'good', 'bad', 'warn', 'new', 'chg', 'info'];
  const FX_KEYS = ['set', 'inc', 'row', 'dim'];

  function flowCheck(F) {
    const E = [], W = [];
    const err = m => E.push(m), warn = m => W.push(m);
    if (!F || typeof F !== 'object') { err('window.FLOW is missing (flow.js did not set it)'); return { errors: E, warnings: W }; }

    const arr = (v, name) => {
      if (v == null) return [];
      if (!Array.isArray(v)) { err(`${name} must be an array`); return []; }
      return v;
    };

    /* modes */
    const modesArr = arr(F.modes, 'modes');
    const modes = modesArr.length ? [] : ['default'];
    modesArr.forEach((m, i) => {
      if (!m || !m.id) return err(`modes[${i}] has no id`);
      if (modes.includes(m.id)) return err(`duplicate mode id "${m.id}"`);
      if (m.id === '*') return err('mode id "*" is reserved');
      modes.push(m.id);
    });
    const checkModes = (where, list) => {
      if (list == null) return;
      if (!Array.isArray(list)) return err(`${where}: "modes" must be an array of mode ids`);
      list.forEach(m => { if (!modes.includes(m)) err(`${where}: unknown mode "${m}"`); });
    };
    const vis = (o, m) => !o || !o.modes || o.modes.includes(m);

    /* lanes */
    arr(F.lanes, 'lanes').forEach((l, i) => {
      ['x', 'y', 'w', 'h'].forEach(k => { if (typeof l[k] !== 'number') err(`lanes[${i}]: ${k} must be a number`); });
    });

    /* nodes */
    const nodes = {};
    const nodeArr = arr(F.nodes, 'nodes');
    if (!nodeArr.length) err('nodes is empty');
    nodeArr.forEach((n, i) => {
      if (!n || !n.id) return err(`nodes[${i}] has no id`);
      if (nodes[n.id]) return err(`duplicate node id "${n.id}"`);
      if (/[>\s]/.test(n.id)) err(`node id "${n.id}" must not contain ">" or spaces`);
      nodes[n.id] = n;
      if (n.type && !NODE_TYPES.includes(n.type)) err(`node "${n.id}": unknown type "${n.type}" (use ${NODE_TYPES.join(', ')})`);
      if (typeof n.x !== 'number' || typeof n.y !== 'number') err(`node "${n.id}": x and y must be numbers`);
      if (!n.t) warn(`node "${n.id}": no title (t)`);
      else if (String(n.t).length > 30) warn(`node "${n.id}": title is ${String(n.t).length} chars; over 30 may overflow the box`);
      if (n.s && String(n.s).length > 38) warn(`node "${n.id}": subtitle over 38 chars may overflow the box`);
      if (n.detail != null && !Array.isArray(n.detail)) err(`node "${n.id}": detail must be an array of strings`);
      if (n.tag && typeof n.tag === 'object' && n.tag.tone && !TONES.includes(n.tag.tone)) warn(`node "${n.id}": unknown tag tone "${n.tag.tone}"`);
      checkModes(`node "${n.id}"`, n.modes);
      if (n.byMode != null) {
        if (typeof n.byMode !== 'object') err(`node "${n.id}": byMode must be an object`);
        else Object.keys(n.byMode).forEach(m => {
          if (!modes.includes(m)) err(`node "${n.id}": byMode key "${m}" is not a mode`);
          Object.keys(n.byMode[m] || {}).forEach(f => { if (!['t', 's', 'tip', 'detail'].includes(f)) err(`node "${n.id}": byMode.${m}.${f} is not allowed (use t, s, tip, detail)`); });
        });
      }
    });

    /* overlap check (same mode visible, boxes intersect) */
    const SZ = { rect: [200, 64], term: [190, 56], dec: [200, 96], db: [190, 72], task: [150, 56], note: [220, 64] };
    const box = n => { const s = SZ[n.type || 'rect'] || SZ.rect; const w = n.w || s[0], h = n.h || s[1]; return [n.x - w / 2, n.y - h / 2, n.x + w / 2, n.y + h / 2]; };
    for (let i = 0; i < nodeArr.length; i++) for (let j = i + 1; j < nodeArr.length; j++) {
      const a = nodeArr[i], b = nodeArr[j];
      if (!a || !b || typeof a.x !== 'number' || typeof b.x !== 'number') continue;
      if (!modes.some(m => vis(a, m) && vis(b, m))) continue;
      const A = box(a), B = box(b);
      if (A[0] < B[2] && B[0] < A[2] && A[1] < B[3] && B[1] < A[3]) warn(`nodes "${a.id}" and "${b.id}" overlap`);
    }

    /* edges */
    const edges = {};
    arr(F.edges, 'edges').forEach((e, i) => {
      if (!e || !e.a || !e.b) return err(`edges[${i}] needs "a" and "b"`);
      const k = e.a + '>' + e.b;
      if (!nodes[e.a]) err(`edge ${k}: unknown node "${e.a}"`);
      if (!nodes[e.b]) err(`edge ${k}: unknown node "${e.b}"`);
      if (edges[k]) err(`duplicate edge ${k}`);
      edges[k] = e;
      checkModes(`edge ${k}`, e.modes);
      if (e.lt != null && !(typeof e.lt === 'number' && e.lt > 0 && e.lt < 1)) err(`edge ${k}: lt must be a number between 0 and 1`);
      if (e.route && !['auto', 'hv', 'vh'].includes(e.route)) err(`edge ${k}: route must be "auto", "hv" or "vh"`);
      if (e.via != null && !(Array.isArray(e.via) && e.via.every(p => Array.isArray(p) && p.length === 2 && p.every(v => typeof v === 'number'))))
        err(`edge ${k}: via must look like [[x,y],[x,y]]`);
      modes.forEach(m => {
        if (vis(e, m) && ((nodes[e.a] && !vis(nodes[e.a], m)) || (nodes[e.b] && !vis(nodes[e.b], m))))
          warn(`edge ${k} is visible in mode "${m}" but one of its nodes is hidden there (add "modes" to the edge)`);
      });
    });

    /* tokens */
    const toks = {};
    const tokArr = arr(F.tokens, 'tokens');
    if (!tokArr.length) err('tokens is empty (each moving dot needs a token)');
    tokArr.forEach((t, i) => {
      if (!t || !t.k) return err(`tokens[${i}] has no k`);
      if (toks[t.k]) return err(`duplicate token "${t.k}"`);
      toks[t.k] = t;
      if (t.label && String(t.label).length > 3) warn(`token "${t.k}": label over 3 chars will not fit in the dot`);
    });

    /* state + tables */
    const stateKeys = {};
    arr(F.state, 'state').forEach((s, i) => {
      if (!s || !s.k) return err(`state[${i}] has no k`);
      if (stateKeys[s.k]) return err(`duplicate state key "${s.k}"`);
      stateKeys[s.k] = s;
      if (s.type && !['num', 'text'].includes(s.type)) err(`state "${s.k}": type must be "num" or "text"`);
    });
    const tables = {};
    arr(F.tables, 'tables').forEach((t, i) => {
      if (!t || !t.k) return err(`tables[${i}] has no k`);
      if (tables[t.k]) return err(`duplicate table "${t.k}"`);
      if (!Array.isArray(t.cols) || !t.cols.length) err(`table "${t.k}": cols must be a non-empty array`);
      tables[t.k] = t;
    });

    /* scenarios */
    const scen = {};
    const scArr = arr(F.scenarios, 'scenarios');
    if (!scArr.length) err('scenarios is empty');
    scArr.forEach((sc, i) => {
      if (!sc || !sc.id) return err(`scenarios[${i}] has no id`);
      if (scen[sc.id]) return err(`duplicate scenario id "${sc.id}"`);
      scen[sc.id] = sc;
      const S = sc.steps;
      if (S == null) return err(`scenario "${sc.id}": no steps`);
      if (!Array.isArray(S) && typeof S === 'object') {
        Object.keys(S).forEach(key => {
          if (key !== '*' && !modes.includes(key)) err(`scenario "${sc.id}": steps key "${key}" is not a mode`);
          if (typeof S[key] === 'string' && !(S[key] in S)) err(`scenario "${sc.id}": steps.${key} points to "${S[key]}" which does not exist`);
        });
      }
      let any = false;
      modes.forEach(m => {
        const list = resolveSteps(sc, m);
        if (list == null) return;
        any = true;
        if (!Array.isArray(list)) return err(`scenario "${sc.id}" [${m}]: steps must be an array`);
        if (!list.length) warn(`scenario "${sc.id}" [${m}]: no steps`);
        const pos = {};
        list.forEach((s, j) => {
          const w = `scenario "${sc.id}" [${m}] step ${j + 1}`;
          if (!s || typeof s !== 'object') return err(`${w}: not an object`);
          if (!s.k || !toks[s.k]) err(`${w}: unknown token "${s.k}"`);
          if (s.mv && s.at) err(`${w}: use "mv" or "at", not both`);
          if (s.mv) {
            const parts = String(s.mv).split('>');
            if (parts.length !== 2) return err(`${w}: mv must look like "from>to"`);
            const [a, b] = parts, e = edges[s.mv];
            if (!e) err(`${w}: no edge "${s.mv}" (add {a:"${a}",b:"${b}"} to edges)`);
            else if (!vis(e, m)) err(`${w}: edge "${s.mv}" is hidden in mode "${m}"`);
            [a, b].forEach(id => { if (nodes[id] && !vis(nodes[id], m)) err(`${w}: node "${id}" is hidden in mode "${m}"`); });
            if (pos[s.k] && pos[s.k] !== a) warn(`${w}: token "${s.k}" jumps from "${pos[s.k]}" to "${a}" (add an "at" step if that is on purpose)`);
            pos[s.k] = b;
          } else if (s.at) {
            if (!nodes[s.at]) err(`${w}: unknown node "${s.at}"`);
            else if (!vis(nodes[s.at], m)) err(`${w}: node "${s.at}" is hidden in mode "${m}"`);
            pos[s.k] = s.at;
          } else err(`${w}: needs "mv" ("from>to") or "at" (node id)`);
          const fx = s.fx;
          if (fx != null) {
            if (typeof fx !== 'object') return err(`${w}: fx must be an object`);
            Object.keys(fx).forEach(k => { if (!FX_KEYS.includes(k)) warn(`${w}: unknown fx key "${k}" (use ${FX_KEYS.join(', ')})`); });
            ['set', 'inc'].forEach(op => {
              if (fx[op]) Object.keys(fx[op]).forEach(k => { if (!stateKeys[k]) err(`${w}: fx.${op} uses unknown state key "${k}"`); });
            });
            if (fx.inc) Object.keys(fx.inc).forEach(k => { if (typeof fx.inc[k] !== 'number') err(`${w}: fx.inc.${k} must be a number`); });
            if (fx.row) (Array.isArray(fx.row) ? fx.row : [fx.row]).forEach(r => {
              if (!r || !tables[r.t]) return err(`${w}: fx.row uses unknown table "${r && r.t}"`);
              if (!Array.isArray(r.c)) return err(`${w}: fx.row.c must be an array of cells`);
              const need = tables[r.t].cols.length - 1;
              if (r.c.length !== need) warn(`${w}: fx.row for "${r.t}" has ${r.c.length} cells; table has ${need} data columns (first column is the row number)`);
            });
            if (fx.dim && !toks[fx.dim]) err(`${w}: fx.dim uses unknown token "${fx.dim}"`);
          }
        });
      });
      if (!any) err(`scenario "${sc.id}": no steps for any mode`);
    });

    /* diff */
    if (F.diff) {
      const cols = arr(F.diff.cols, 'diff.cols');
      cols.forEach(c => { if (!modes.includes(c)) err(`diff.cols: unknown mode "${c}"`); });
      arr(F.diff.rows, 'diff.rows').forEach((r, i) => {
        if (!r.k) warn(`diff.rows[${i}] has no k`);
        if (r.v) Object.keys(r.v).forEach(m => { if (!cols.includes(m)) err(`diff.rows[${i}]: "${m}" is not in diff.cols`); });
        else if (r.same == null) warn(`diff.rows[${i}] needs "v" or "same"`);
      });
    }

    /* questions */
    arr(F.questions, 'questions').forEach((q, i) => {
      const w = `questions[${i}]${q && q.id ? ' "' + q.id + '"' : ''}`;
      if (!q || !q.id) err(`${w}: no id`);
      if (!q || !q.q) err(`${w}: no question text (q)`);
      if (q && q.node && !nodes[q.node]) err(`${w}: unknown node "${q.node}"`);
      if (q && q.mode && !modes.includes(q.mode)) err(`${w}: unknown mode "${q.mode}"`);
      if (q && q.scen && !scen[q.scen]) err(`${w}: unknown scenario "${q.scen}"`);
    });

    return { errors: E, warnings: W };
  }

  /* steps for one scenario in one mode: array | {mode: array | "otherMode", "*": array} */
  function resolveSteps(sc, m) {
    const S = sc.steps;
    if (Array.isArray(S)) return S;
    if (!S || typeof S !== 'object') return null;
    let v = m in S ? S[m] : S['*'], guard = 0;
    while (typeof v === 'string' && guard++ < 8) v = S[v];
    return v == null || typeof v === 'string' ? null : v;
  }

  const api = { flowCheck, resolveSteps };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.flowCheck = flowCheck; root.flowResolveSteps = resolveSteps; }
})(typeof window !== 'undefined' ? window : globalThis);

'use strict';

// Frontend integrity tests — zero extra dependencies (node:vm + node:fs).
// These catch the three classic split-file bugs without a browser:
//   1. Syntax errors (truncated paste, typo during move)
//   2. Duplicate definitions across files (function moved but original not removed)
//   3. Missing definitions (function moved out but callers not updated)
//   4. Router references an undeclared handler
//   5. app.js line count enforcement

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PUBLIC = path.join(__dirname, '..', 'public');

// ── Load + parse declarations from a JS file ─────────────────────────────────

function readSrc(filename) {
    return fs.readFileSync(path.join(PUBLIC, filename), 'utf8');
}

// Extract names of TOP-LEVEL function declarations (start of line).
// Used for duplicate-detection — inner closures can legitimately share names.
// Matches: `function name(` and `async function name(`
function topLevelFunctions(src) {
    const names = [];
    for (const m of src.matchAll(/^(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/gm)) {
        names.push(m[1]);
    }
    return names;
}

// Extract names of ALL function declarations (any indent level).
// Used for missing-definition checks — inner closures are valid call targets too.
function allFunctions(src) {
    const names = new Set();
    for (const m of src.matchAll(/(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g)) {
        names.add(m[1]);
    }
    return names;
}

// Extract all bare function-call sites: word( — minus obvious JS builtins and
// method chains.  We only care about calls to our own named functions.
const JS_BUILTINS = new Set([
    'require','setTimeout','clearTimeout','setInterval','clearInterval',
    'parseInt','parseFloat','isNaN','isFinite','encodeURIComponent',
    'decodeURIComponent','fetch','Promise','Object','Array','Math','Date',
    'JSON','String','Number','Boolean','Error','Map','Set','URL',
    'addEventListener','removeEventListener','querySelector','querySelectorAll',
    'getElementById','getElementsByClassName','appendChild','removeChild',
    'createElement','createObjectURL','revokeObjectURL','dispatchEvent',
    'confirm','alert','open','close','assign','push','pop','shift','unshift',
    'slice','splice','join','split','sort','reverse','filter','map','find',
    'findIndex','forEach','every','some','includes','flat','flatMap','values',
    'keys','entries','fromEntries','replace','match','matchAll','startsWith',
    'endsWith','trim','trimStart','trimEnd','padStart','padEnd','repeat',
    'toString','toLocaleString','toLocaleTimeString','toISOString','toFixed',
    'round','ceil','floor','abs','min','max','log','pow','sqrt',
    'write','reload','preventDefault','stopPropagation','toggle','remove',
    'append','click','focus','blur','scrollIntoView','getBoundingClientRect',
    'getAttribute','setAttribute','removeAttribute','contains','add',
]);

function callSites(src) {
    const calls = new Set();
    // word( — but not after . (method call) or after function/async/new keywords
    for (const m of src.matchAll(/(?<![\w.$])(?<!function\s)(?<!async\s+function\s)(?<!new\s)\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g)) {
        const name = m[1];
        if (!JS_BUILTINS.has(name)) calls.add(name);
    }
    return calls;
}

// ── Collect sources ───────────────────────────────────────────────────────────

// Parse script tags from index.html in order — this is the load order.
function scriptLoadOrder() {
    const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
    const order = [];
    for (const m of html.matchAll(/<script\s+src="\/([^"]+)"/g)) {
        order.push(m[1]);
    }
    return order;
}

// The JS files we care about — all public/*.js files.
function allPublicJsFiles() {
    return fs.readdirSync(PUBLIC)
        .filter(f => f.endsWith('.js'))
        .sort();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('index.html loads all public JS files (none unregistered)', () => {
    const inHtml = new Set(scriptLoadOrder());
    const onDisk = new Set(allPublicJsFiles());
    for (const f of onDisk) {
        assert.ok(inHtml.has(f), `${f} exists in public/ but has no <script> tag in index.html`);
    }
});

test('tutorial video links: the server lists them, app.js fills the footer slot, auth.js the login card', () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
    const app = fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
    const auth = fs.readFileSync(path.join(PUBLIC, 'auth.js'), 'utf8');
    const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'auth.js'), 'utf8');
    assert.match(html, /id="tutorial-links"/, 'index.html has the footer slot');
    assert.match(app, /getElementById\('tutorial-links'\)/, 'app.js fills the footer slot');
    assert.match(app, /state\.config\.tutorial_videos/, 'app.js reads config.tutorial_videos');
    assert.match(app, /\/auth\/config/, 'app.js falls back to the public config when there is no session, so the login page can show the links');
    assert.match(auth, /tutorial_videos[\s\S]*esc\(v\.url\)[\s\S]*esc\(v\.label\)/, 'auth.js renders every video escaped');
    assert.match(route, /tutorial_videos/, 'the server sends tutorial_videos');
    assert.match(route, /router\.get\('\/config'/, 'GET /auth/config exists for the signed-out login page');
});

test('index.html script order: theme.js in <head>, then app.js first in <body>', () => {
    const order = scriptLoadOrder();
    assert.equal(order[0], 'theme.js', 'theme.js must load before the stylesheet so the stored theme applies before first paint');
    assert.equal(order[1], 'app.js', 'app.js must be the first body script tag (provides globals for other files)');
    const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
    assert.ok(html.indexOf('/theme.js') < html.indexOf('/style.css'), 'theme.js comes before the stylesheet');
});

test('all public JS files parse without syntax errors', () => {
    for (const file of allPublicJsFiles()) {
        const src = readSrc(file);
        assert.doesNotThrow(
            () => new vm.Script(src, { filename: file }),
            `Syntax error in public/${file}`
        );
    }
});

test('app.js is under 2000 lines', () => {
    const lines = readSrc('app.js').split('\n').length;
    assert.ok(lines < 2000, `app.js has ${lines} lines — must stay under 2000`);
});

test('no top-level function is declared in more than one file (no duplicates after a split)', () => {
    const seen = new Map(); // name → file
    for (const file of allPublicJsFiles()) {
        const src = readSrc(file);
        for (const name of topLevelFunctions(src)) {
            if (seen.has(name)) {
                assert.fail(`"${name}" is declared in both ${seen.get(name)} and ${file} — remove the copy that was left behind`);
            }
            seen.set(name, file);
        }
    }
});

test('every function called in any public JS file is declared somewhere in public/', () => {
    // Collect ALL declared names (including inner functions) across all files
    const declared = new Set();
    for (const file of allPublicJsFiles()) {
        for (const name of allFunctions(readSrc(file))) {
            declared.add(name);
        }
    }

    // Check call sites in each file against the global pool
    // We only check our own naming conventions — view*, open*Modal, render*, show*, wire*
    const OWN_PATTERN = /^(view|open|render|show|wire|update|resolve|extract|startCooldown|timeAgo|statusBadge|setMain|showError|showToast|closeModal|pollActivity|router|init)\w*/;

    for (const file of allPublicJsFiles()) {
        const src = readSrc(file);
        for (const name of callSites(src)) {
            if (!OWN_PATTERN.test(name)) continue;
            assert.ok(
                declared.has(name),
                `"${name}()" is called in public/${file} but not declared in any public/*.js file`
            );
        }
    }
});

test('router dispatches only to declared functions', () => {
    const src = readSrc('app.js');

    // Extract the routes array block
    const routesMatch = src.match(/const routes\s*=\s*\[([\s\S]*?)\];/);
    assert.ok(routesMatch, 'Could not find routes array in app.js');

    // Pull out function/arrow names referenced in routes
    const declared = new Set();
    for (const file of allPublicJsFiles()) {
        for (const name of topLevelFunctions(readSrc(file))) {
            declared.add(name);
        }
    }

    // Identifiers in route handlers: bare names and arrow-function calls
    for (const m of routesMatch[1].matchAll(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[\(,\]]/g)) {
        const name = m[1];
        if (name === 'params' || JS_BUILTINS.has(name)) continue;
        if (/^[A-Z]/.test(name)) continue; // skip constructors
        assert.ok(
            declared.has(name),
            `Router references "${name}" but it is not declared in any public/*.js file`
        );
    }
});

test('review.js only uses globals that app.js exports (no missing cross-file deps)', () => {
    const APP_GLOBALS_USED_BY_REVIEW = ['esc', 'el', 'api', 'setMain', 'state',
        'openModal', 'closeModal', 'showToast', 'showError', 'runRoute',
        'renderLines', 'renderPagination', 'timeAgo', 'statusBadge',
        'hasLevel', 'canCreateDocuments'];

    const appSrc  = readSrc('app.js');
    const appDecl = new Set(topLevelFunctions(appSrc));
    assert.ok(/\bconst state\b/.test(appSrc), '"state" const not found in app.js');

    for (const name of APP_GLOBALS_USED_BY_REVIEW) {
        if (name === 'state') continue;
        assert.ok(appDecl.has(name),
            `review.js depends on "${name}" but it is not declared as a function in app.js`);
    }
});

test('auth.js only uses globals that app.js exports (no missing cross-file deps)', () => {
    const APP_GLOBALS_USED_BY_AUTH = ['esc', 'el', 'api', 'setMain', 'state',
        'openModal', 'closeModal', 'updateHeader', 'showError'];

    const appSrc  = readSrc('app.js');
    const appDecl = new Set(topLevelFunctions(appSrc));
    assert.ok(/\bconst state\b/.test(appSrc), '"state" const not found in app.js');

    for (const name of APP_GLOBALS_USED_BY_AUTH) {
        if (name === 'state') continue;
        assert.ok(appDecl.has(name),
            `auth.js depends on "${name}" but it is not declared as a function in app.js`);
    }
});

test('selection.js only uses globals that app.js exports (no missing cross-file deps)', () => {
    const APP_GLOBALS_USED_BY_SELECTION = ['esc', 'el', 'api', 'state', 'openModal', 'closeModal',
        'showToast', 'hasLevel', 'openProposeModal'];

    const appSrc  = readSrc('app.js');
    const appDecl = new Set(topLevelFunctions(appSrc));
    for (const name of APP_GLOBALS_USED_BY_SELECTION) {
        if (name === 'state') continue;
        assert.ok(appDecl.has(name),
            `selection.js depends on "${name}" but it is not declared as a function in app.js`);
    }
    // app.js calls into selection.js only from event handlers (after every script has loaded)
    const selDecl = new Set(topLevelFunctions(readSrc('selection.js')));
    const routesBlock = appSrc.match(/const routes\s*=\s*\[([\s\S]*?)\];/)[1];
    for (const name of ['wireSelectionToolbar', 'openForkModal']) {
        assert.ok(selDecl.has(name), `app.js expects selection.js to declare "${name}"`);
        assert.ok(!routesBlock.includes(name), `"${name}" must not be referenced from the routes array (selection.js loads after app.js)`);
    }
});

test('passesThreshold: backend (src/lib/text.js) and frontend (review.js) copies are identical', () => {
    const extract = (src, file) => {
        const m = src.match(/function passesThreshold\([\s\S]*?\n\}/);
        assert.ok(m, `passesThreshold not found in ${file}`);
        return m[0].replace(/\s+/g, ' ').trim();
    };
    const backend = extract(fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'text.js'), 'utf8'), 'src/lib/text.js');
    const frontend = extract(fs.readFileSync(path.join(PUBLIC, 'review.js'), 'utf8'), 'public/review.js');
    assert.equal(frontend, backend,
        'passesThreshold has drifted between src/lib/text.js and public/review.js — no build step, so the copies must be edited together');
});

// ── Guard rails added 2026-10-03 ─────────────────────────────────────────────

test('no inline event handlers or javascript: URLs anywhere in public/ (the CSP forbids them)', () => {
    for (const f of fs.readdirSync(PUBLIC).filter(f => /\.(js|html)$/.test(f))) {
        const src = fs.readFileSync(path.join(PUBLIC, f), 'utf8');
        assert.ok(!/\son[a-z]+\s*=\s*["']/i.test(src), `${f}: inline on*= handler found — use addEventListener`);
        assert.ok(!/javascript:/i.test(src), `${f}: javascript: URL found`);
    }
    const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
    assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>\s*\S/.test(html), 'index.html must not contain inline script bodies');
    assert.ok(!/https?:\/\//.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'index.html must not load external resources');
});

test('ACCESS_LEVELS order is identical in public/app.js and src/middleware/access.js', () => {
    const grab = src => (src.match(/ACCESS_LEVELS = \[([^\]]+)\]/) || [])[1];
    const front = grab(fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8'));
    const back = grab(fs.readFileSync(path.join(__dirname, '..', 'src', 'middleware', 'access.js'), 'utf8'));
    assert.ok(front && back, 'both files must define ACCESS_LEVELS');
    assert.equal(front.replace(/\s+/g, ''), back.replace(/\s+/g, ''), 'hasLevel() in the browser must rank levels exactly like the server');
});

test('safe-area padding needs viewport-fit=cover, and fixed overlays stay out of print', () => {
    const css = fs.readFileSync(path.join(PUBLIC, 'style.css'), 'utf8');
    const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
    if (/env\(safe-area-inset/.test(css)) {
        assert.match(html, /<meta name="viewport" content="[^"]*viewport-fit=cover/, 'env(safe-area-inset-*) is 0 on iPhones unless the viewport meta declares viewport-fit=cover');
    }
    const print = (css.match(/@media print \{([\s\S]*?)\n\}/) || [])[1] || '';
    for (const sel of ['.doc-bottom-bar', '.selection-toolbar', '#toast-container', '#modal-overlay']) {
        assert.ok(print.includes(sel), `${sel} is position: fixed and must be hidden in the print stylesheet`);
    }
});

test('style.css components draw only on the design tokens, and every document status has a badge rule', () => {
    const css = fs.readFileSync(path.join(PUBLIC, 'style.css'), 'utf8');
    const tokensEnd = css.indexOf('/* ===== Reset ===== */');
    assert.ok(tokensEnd > 0, 'the token block must come first');
    const body = css.slice(tokensEnd);
    const hex = [...new Set(body.match(/#[0-9a-fA-F]{3,6}\b|rgba\(\s*(?:255|15|16|2|0)\s*,[^)]*\)/g) || [])];
    assert.deepStrictEqual(hex, [], `colours outside :root belong in the token block (dark mode needs both values): ${hex.join(', ')}`);
    const tokens = css.slice(0, tokensEnd);
    for (const name of ['--color-bg', '--color-surface', '--color-text', '--color-border', '--color-hover', '--color-dim', '--tint-success-bg', '--shadow']) {
        assert.match(tokens, new RegExp(`${name}:[^;]*light-dark\\(`), `${name} needs a light and a dark value`);
    }
    for (const name of ['--color-muted', '--color-text-secondary', '--tint-success-bg']) {
        if (body.includes(`var(${name})`)) assert.ok(css.slice(0, tokensEnd).includes(`${name}:`), `${name} is used but never defined`);
    }
    const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    const statuses = schema.match(/CHECK \(status IN \(([^)]+)\)\)/)[1].match(/'(\w+)'/g).map(q => q.replace(/'/g, ''));
    assert.ok(statuses.includes('final_voting'));
    for (const st of statuses) assert.ok(css.includes(`.status-${st}`), `document status "${st}" has no .status-${st} badge rule`);
});

test('propose controls mirror the server: proposer+ while open, supervisor+ during voting and final_voting, nothing when resolved', () => {
    const app = readSrc('app.js');
    const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'documents.js'), 'utf8');
    assert.match(app, /const canPropose = hasLevel\(doc, \['voting', 'final_voting'\]\.includes\(doc\.status\) \? 'supervisor' : 'proposer'\) && !\['resolved', 'archived'\]\.includes\(doc\.status\)/);
    assert.match(route, /\['voting', 'final_voting'\]\.includes\(doc\.status\) && !meetsLevel\(req\.userAccessLevel, 'supervisor', req\)/, 'POST /documents/:id/variants enforces the same rule');
});

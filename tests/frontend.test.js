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

test('index.html script order: app.js is first', () => {
    const order = scriptLoadOrder();
    assert.equal(order[0], 'app.js', 'app.js must be the first script tag (provides globals for other files)');
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
        'openModal', 'closeModal', 'showToast', 'showError',
        'renderLines', 'renderPagination', 'timeAgo', 'statusBadge'];

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

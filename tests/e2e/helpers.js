'use strict';

// Shared helpers for e2e specs. Each spec creates its own documents through the
// API (as alice, the seeded owner) so specs stay order-independent.

const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3001/api';
const AUTH_DIR = path.resolve('tests/e2e/.auth');

function aliceCookie() {
    const state = JSON.parse(fs.readFileSync(path.join(AUTH_DIR, 'alice.json'), 'utf8'));
    const c = state.cookies.find(x => x.name === 'session_id');
    return `session_id=${c.value}`;
}

function bobCookie() {
    const state = JSON.parse(fs.readFileSync(path.join(AUTH_DIR, 'bob.json'), 'utf8'));
    const c = state.cookies.find(x => x.name === 'session_id');
    return `session_id=${c.value}`;
}

async function apireq(method, endpoint, { body, cookie } = {}) {
    const res = await fetch(`${BASE}${endpoint}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status >= 400) {
        throw new Error(`${method} ${endpoint} → ${res.status}: ${data.error || 'unknown'}`);
    }
    return data;
}

// Create a document as alice, optionally advance its status through the given chain
async function createDoc(title, text, statusChain = ['open']) {
    const cookie = aliceCookie();
    const d = await apireq('POST', '/documents', { body: { title, text }, cookie });
    const docId = d.document.id;
    for (const status of statusChain) {
        await apireq('POST', `/documents/${docId}/status`, { body: { status }, cookie });
    }
    return docId;
}

async function createVariant(docId, fields) {
    const d = await apireq('POST', `/documents/${docId}/variants`, {
        body: { operation: 'replace', rationale: 'e2e', ...fields },
        cookie: aliceCookie(),
    });
    return d.variant.id;
}

async function setStatus(docId, status) {
    await apireq('POST', `/documents/${docId}/status`, { body: { status }, cookie: aliceCookie() });
}

module.exports = { apireq, aliceCookie, bobCookie, createDoc, createVariant, setStatus, AUTH_DIR };

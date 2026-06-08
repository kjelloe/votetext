'use strict';

/* ===== State ===== */
const state = {
    user: null,
    config: {},
    docLines: {},        // docId → { page → lines[] }
    docCache: {},        // docId → document
    docFilterMode: {},   // docId → 'all' | 'page'
    pendingVariantJump: null,  // { docId, page, lineStart } — consumed once by viewDocument
    commentSort: 'chrono',     // sort mode for comment thread on variant page
    commentAuthorId: null,     // user_id of the variant proposer (for Author's filter)
    lastActivityTime: null,    // ISO timestamp of newest activity event seen
    votingBannerInterval: null,// setInterval handle for voting countdown banner
    activityUnread: 0,
    activitySeenTime: null,
};

/* ===== Utilities ===== */
function esc(str) {
    if (str == null) return '';
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
}

function timeAgo(isoDate) {
    if (!isoDate) return '';
    const diff = Date.now() - new Date(isoDate).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

function statusBadge(status) {
    return `<span class="status-badge status-${esc(status)}">${esc(status)}</span>`;
}

function startCooldown(btn, label, seconds) {
    let remaining = seconds;
    btn.disabled = true;
    btn.textContent = `${label} (${remaining}s)`;
    const iv = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(iv);
            btn.disabled = false;
            btn.textContent = label;
        } else {
            btn.textContent = `${label} (${remaining}s)`;
        }
    }, 1000);
}

async function api(method, path, body = null) {
    const opts = { method, credentials: 'same-origin', headers: {} };
    if (body !== null) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    const res = await fetch('/api' + path, opts);
    if (res.status === 204) return null;
    const data = await res.json();
    if (!res.ok) {
        const err = new Error(data.error || `HTTP ${res.status}`);
        err.status = res.status;
        err.data = data;
        throw err;
    }
    return data;
}

function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') node.className = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else if (k === 'html') node.innerHTML = v;
        else node.setAttribute(k, v);
    }
    for (const child of children) {
        if (child == null) continue;
        node.append(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
}

function setMain(node) {
    const main = document.getElementById('app-main');
    main.innerHTML = '';
    main.append(typeof node === 'string' ? (() => { const d = document.createElement('div'); d.innerHTML = node; return d; })() : node);
}

function showError(container, msg) {
    const existing = container.querySelector('.alert-error');
    if (existing) existing.remove();
    const alert = el('div', { class: 'alert alert-error' }, msg);
    container.prepend(alert);
}

function showToast(msg, docId, dismissSeconds) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const id = 'toast-' + Date.now();
    const toast = el('div', { class: 'toast', id });
    toast.innerHTML = `<span>${esc(msg)}</span>${docId ? ` <a href="#/documents/${esc(docId)}" class="toast-link">View</a>` : ''}<button class="toast-dismiss" title="Dismiss">×</button>`;
    container.append(toast);
    toast.querySelector('.toast-dismiss').addEventListener('click', () => toast.remove());
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, (dismissSeconds || 30) * 1000);
}

async function pollActivity() {
    if (!state.user) return;
    try {
        const data = await api('GET', '/activity');
        const events = data.activity || [];
        if (!events.length) return;
        const newest = events[0].created_at;
        if (state.lastActivityTime && newest > state.lastActivityTime) {
            const dismissSecs = (state.config && state.config.toast_dismiss_seconds) || 30;
            for (const e of events) {
                if (e.created_at <= state.lastActivityTime) break;
                if (e.action === 'voting_scheduled') {
                    let meta = {};
                    try { meta = JSON.parse(e.metadata || '{}'); } catch {}
                    const mins = meta.countdown_minutes;
                    const docLabel = esc(e.document_title || 'a document');
                    const msg = `⏱ Voting for "${docLabel}" opens in ${mins} minute${mins !== 1 ? 's' : ''}`;
                    showToast(msg, e.document_id, dismissSecs);
                }
            }
        }
        state.lastActivityTime = newest;
        if (state.activitySeenTime) { state.activityUnread = events.filter(e => e.created_at > state.activitySeenTime).length; updateHeader(); }
    } catch {}
}

/* ===== Modal ===== */
function openModal(contentHtml, title = '') {
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');
    content.innerHTML = title ? `<div class="modal-title">${esc(title)}</div>${contentHtml}` : contentHtml;
    overlay.classList.remove('hidden');
    document.getElementById('modal-close').onclick = closeModal;
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); }, { once: true });
}

function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.getElementById('modal-content').innerHTML = '';
}

/* ===== Header ===== */
function updateHeader() {
    const loginBtn = document.getElementById('login-btn');
    const userMenu = document.getElementById('user-menu');
    const nameSpan = document.getElementById('user-name-display');
    if (state.user) {
        loginBtn.classList.add('hidden');
        userMenu.classList.remove('hidden');
        nameSpan.textContent = state.user.display_name || state.user.email;
    } else {
        loginBtn.classList.remove('hidden');
        userMenu.classList.add('hidden');
    }
    const badge = document.getElementById('act-badge');
    if (badge) { badge.textContent = state.activityUnread || ''; badge.classList.toggle('hidden', !state.activityUnread); }
}

/* ===== Router ===== */
const routes = [
    [/^#\/login$/, viewLogin],
    [/^#\/documents$/, viewDocumentList],
    [/^#\/documents\/(\d+)\/conflicts$/, params => viewConflictResolution(params[1])],
    [/^#\/documents\/(\d+)\/final-vote$/, params => viewFinalVoting(params[1])],
    [/^#\/documents\/(\d+)\/review$/, params => viewDocumentReview(params[1])],
    [/^#\/documents\/(\d+)$/, params => viewDocument(params[1])],
    [/^#\/variants\/(\d+)$/, params => viewVariant(params[1])],
    [/^#\/activity$/, viewActivity],
    [/^#\/profile$/, viewProfile],
];

async function router() {
    if (state.votingBannerInterval) { clearInterval(state.votingBannerInterval); state.votingBannerInterval = null; }
    const hash = location.hash || '#/login';
    for (const [pattern, handler] of routes) {
        const m = hash.match(pattern);
        if (m) {
            setMain(el('div', { class: 'loading-spinner' }, 'Loading…'));
            try { await handler(m); } catch (err) { setMain(`<div class="page-container"><div class="alert alert-error">${esc(err.message)}</div></div>`); }
            return;
        }
    }
    location.hash = '#/documents';
}

/* ===== View: Login ===== */
async function viewLogin() {
    if (state.user) { location.hash = '#/documents'; return; }

    const form = el('div', { class: 'login-container' });
    form.innerHTML = `
        <div class="login-card">
            <h1>VoteText</h1>
            <p class="subtitle">Enter your email to get a login code</p>
            <div id="step-email">
                <div class="form-group">
                    <label for="email-input">Email address</label>
                    <input type="email" id="email-input" placeholder="you@example.com" autocomplete="email">
                </div>
                <p id="email-err" class="error-msg" style="display:none"></p>
                <button id="send-btn" class="btn btn-primary" style="width:100%">Send code</button>
            </div>
            <div id="step-otp" style="display:none">
                <p class="text-muted mb-2">Code sent to <strong id="otp-email"></strong></p>
                <div class="form-group">
                    <label for="otp-input">6-digit code</label>
                    <input type="text" id="otp-input" placeholder="123456" maxlength="6" autocomplete="one-time-code" inputmode="numeric"
                        style="font-family:var(--font-mono);font-size:1.75rem;letter-spacing:.3em;text-align:center">
                </div>
                <p id="otp-err" class="error-msg" style="display:none"></p>
                <button id="verify-btn" class="btn btn-primary" style="width:100%">Verify</button>
                <button id="back-btn" class="btn btn-ghost mt-1" style="width:100%">Use different email</button>
            </div>
        </div>
    `;
    setMain(form);

    const emailInput = document.getElementById('email-input');
    const sendBtn = document.getElementById('send-btn');
    const emailErr = document.getElementById('email-err');
    const otpInput = document.getElementById('otp-input');
    const verifyBtn = document.getElementById('verify-btn');
    const otpErr = document.getElementById('otp-err');

    emailInput.focus();
    emailInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendBtn.click(); });

    sendBtn.addEventListener('click', async () => {
        emailErr.style.display = 'none';
        const email = emailInput.value.trim();
        if (!email || !email.includes('@')) { emailErr.textContent = 'Valid email required'; emailErr.style.display = ''; return; }
        sendBtn.disabled = true; sendBtn.textContent = 'Sending…';
        try {
            await api('POST', '/auth/request-otp', { email });
            document.getElementById('step-email').style.display = 'none';
            document.getElementById('step-otp').style.display = '';
            document.getElementById('otp-email').textContent = email;
            otpInput.focus();
        } catch (err) {
            emailErr.textContent = err.message; emailErr.style.display = '';
            sendBtn.disabled = false; sendBtn.textContent = 'Send code';
        }
    });

    otpInput.addEventListener('input', () => {
        if (otpInput.value.replace(/\D/g, '').length === 6) verifyBtn.click();
    });
    otpInput.addEventListener('keydown', e => { if (e.key === 'Enter') verifyBtn.click(); });

    verifyBtn.addEventListener('click', async () => {
        otpErr.style.display = 'none';
        const code = otpInput.value.replace(/\D/g, '');
        if (!code) { otpErr.textContent = 'Code required'; otpErr.style.display = ''; return; }
        verifyBtn.disabled = true; verifyBtn.textContent = 'Verifying…';
        try {
            const data = await api('POST', '/auth/verify-otp', { email: document.getElementById('otp-email').textContent, code });
            state.user = data.user;
            updateHeader();
            if (!state.user.display_name) { showProfileModal(() => { location.hash = '#/documents'; }); return; }
            location.hash = '#/documents';
        } catch (err) {
            otpErr.textContent = err.message; otpErr.style.display = '';
            verifyBtn.disabled = false; verifyBtn.textContent = 'Verify';
        }
    });

    document.getElementById('back-btn').addEventListener('click', () => {
        document.getElementById('step-otp').style.display = 'none';
        document.getElementById('step-email').style.display = '';
        emailInput.focus();
    });
}

/* ===== View: Document List ===== */
async function viewDocumentList() {
    if (!state.user) { location.hash = '#/login'; return; }

    const data = await api('GET', '/documents');
    const docs = data.documents || [];

    const wrap = el('div', { class: 'page-container' });
    wrap.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">Documents</h1>
            <button id="create-doc-btn" class="btn btn-primary">+ New document</button>
        </div>
        <div id="doc-list"></div>
    `;

    const list = wrap.querySelector('#doc-list');
    if (docs.length === 0) {
        list.innerHTML = `<div class="empty-state"><h3>No documents yet</h3><p>Create a document to get started.</p></div>`;
    } else {
        list.innerHTML = `<div class="doc-grid">${docs.map(d => `
            <a href="#/documents/${esc(d.id)}" class="doc-card">
                <div class="doc-card-title">${esc(d.title)}</div>
                <div class="doc-card-meta">
                    <span>${statusBadge(d.status)}</span>
                    <span>${esc(d.total_lines)} lines · ${esc(d.total_pages)} pages</span>
                    <span>by ${esc(d.owner_name)}</span>
                    <span>${timeAgo(d.updated_at)}</span>
                </div>
            </a>`).join('')}
        </div>`;
    }

    setMain(wrap);

    document.getElementById('create-doc-btn').addEventListener('click', () => openCreateDocModal());
}

function openCreateDocModal(prefill = {}) {
    openModal(`
        <div class="form-group"><label>Title</label><input type="text" id="new-doc-title" placeholder="Document title"></div>
        <div class="form-group"><label>Description <small class="text-muted">(optional)</small></label><input type="text" id="new-doc-desc" placeholder="Brief description"></div>
        <div class="form-group">
            <label>Document text</label>
            <div id="new-doc-dropzone" class="dropzone">
                Drop a .txt or .md file here, or <label for="new-doc-file" class="link-style">browse</label>
                <input type="file" id="new-doc-file" accept=".txt,.md" style="display:none">
            </div>
            <textarea id="new-doc-text" placeholder="…or paste your document text here" style="min-height:200px"></textarea>
            <div id="new-doc-format-notice" class="format-notice" style="display:none">
                <span id="new-doc-format-label">Numbered lines detected</span>
                <label><input type="checkbox" id="new-doc-strip" checked> Strip leading line numbers</label>
            </div>
        </div>
        <div class="form-group">
            <label>Lines per page</label>
            <select id="new-doc-lpp">
                <option value="27">27</option>
                <option value="30" selected>30</option>
                <option value="35">35</option>
                <option value="40">40</option>
                <option value="50">50</option>
                <option value="60">60</option>
            </select>
        </div>
        ${prefill.copyFrom ? `
        <div class="form-group copy-options-row">
            <label class="copy-options-label">Copy from source</label>
            <div class="copy-options">
                <label><input type="checkbox" id="copy-proposals"> Copy proposals</label>
                <label id="copy-votes-label" style="opacity:.45"><input type="checkbox" id="copy-votes" disabled> Copy votes</label>
                <label id="copy-comments-label" style="opacity:.45"><input type="checkbox" id="copy-comments" disabled> Copy comments</label>
            </div>
        </div>` : ''}
        <p id="create-doc-err" class="error-msg" style="display:none"></p>
        <div class="form-actions">
            <button id="create-doc-submit" class="btn btn-primary">Create document</button>
            <button onclick="closeModal()" class="btn btn-ghost">Cancel</button>
        </div>
    `, 'New Document');

    const textarea = document.getElementById('new-doc-text');
    const dropzone = document.getElementById('new-doc-dropzone');
    const fileInput = document.getElementById('new-doc-file');
    const formatNotice = document.getElementById('new-doc-format-notice');
    const formatLabel = document.getElementById('new-doc-format-label');
    const stripCb = document.getElementById('new-doc-strip');
    const errEl = document.getElementById('create-doc-err');

    let detectedFormat = 'plain'; // 'plain' | 'numbered' | 'paged'

    function isNumbered(text) {
        const lines = text.split('\n').filter(l => l.trim().length > 0);
        if (lines.length < 3) return false;
        return lines.filter(l => /^\s*\d+\s/.test(l)).length / lines.length >= 0.5;
    }

    function detectPagedLpp(text) {
        const sections = text.split(/^---$/m);
        if (sections.length < 2) return null;
        for (const section of sections) {
            const n = section.split('\n').filter(l => /^\s*\d+\s/.test(l)).length;
            if (n >= 5) return n;
        }
        return null;
    }

    function setLpp(n) {
        const sel = document.getElementById('new-doc-lpp');
        const prev = sel.querySelector('option[data-detected]');
        if (prev) prev.remove();
        const match = Array.from(sel.options).find(o => parseInt(o.value) === n);
        if (match) {
            sel.value = n;
        } else {
            const opt = document.createElement('option');
            opt.value = n; opt.textContent = `${n} (detected)`; opt.dataset.detected = '1'; opt.selected = true;
            const before = Array.from(sel.options).find(o => parseInt(o.value) > n);
            if (before) sel.insertBefore(opt, before); else sel.appendChild(opt);
        }
    }

    function clearLpp() {
        const sel = document.getElementById('new-doc-lpp');
        const prev = sel.querySelector('option[data-detected]');
        if (prev) { prev.remove(); sel.value = '30'; }
    }

    function runDetect() {
        const text = textarea.value;
        const pagedLpp = detectPagedLpp(text);
        if (pagedLpp !== null) {
            detectedFormat = 'paged';
            formatLabel.textContent = `Page breaks detected — ${pagedLpp} lines/page`;
            stripCb.parentElement.style.display = 'none';
            formatNotice.style.display = '';
            setLpp(pagedLpp);
        } else if (isNumbered(text)) {
            detectedFormat = 'numbered';
            formatLabel.textContent = 'Numbered lines detected';
            stripCb.parentElement.style.display = '';
            formatNotice.style.display = '';
            clearLpp();
        } else {
            detectedFormat = 'plain';
            formatNotice.style.display = 'none';
            clearLpp();
        }
    }

    function loadFile(file) {
        if (!/\.(txt|md)$/i.test(file.name)) {
            errEl.textContent = 'Only .txt and .md files are supported';
            errEl.style.display = '';
            return;
        }
        const reader = new FileReader();
        reader.onload = ev => { textarea.value = ev.target.result; runDetect(); };
        reader.readAsText(file);
    }

    textarea.addEventListener('input', runDetect);
    textarea.addEventListener('paste', () => setTimeout(runDetect, 0));

    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', e => {
        e.preventDefault();
        dropzone.classList.remove('drag-over');
        if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); });

    if (prefill.title) document.getElementById('new-doc-title').value = prefill.title;
    if (prefill.text) { textarea.value = prefill.text; runDetect(); }
    if (prefill.linesPerPage) setLpp(prefill.linesPerPage);

    if (prefill.copyFrom) {
        const proposalsCb = document.getElementById('copy-proposals');
        const votesCb = document.getElementById('copy-votes');
        const commentsCb = document.getElementById('copy-comments');
        proposalsCb.addEventListener('change', () => {
            votesCb.disabled = !proposalsCb.checked;
            commentsCb.disabled = !proposalsCb.checked;
            document.getElementById('copy-votes-label').style.opacity = proposalsCb.checked ? '' : '.45';
            document.getElementById('copy-comments-label').style.opacity = proposalsCb.checked ? '' : '.45';
            if (!proposalsCb.checked) { votesCb.checked = false; commentsCb.checked = false; }
        });
    }

    document.getElementById('create-doc-submit').addEventListener('click', async () => {
        errEl.style.display = 'none';
        const title = document.getElementById('new-doc-title').value.trim();
        let text = textarea.value;
        const description = document.getElementById('new-doc-desc').value.trim();
        const linesPerPage = parseInt(document.getElementById('new-doc-lpp').value);

        if (!title) { errEl.textContent = 'Title required'; errEl.style.display = ''; return; }
        if (!text.trim()) { errEl.textContent = 'Text content required'; errEl.style.display = ''; return; }

        if (detectedFormat === 'paged') {
            text = text.split('\n')
                .filter(l => { const t = l.trim(); return t !== '---' && !/^\*Page \d+/.test(t); })
                .join('\n').replace(/\n{3,}/g, '\n\n').trim();
            text = text.split('\n').map(l => l.replace(/^\s*\d+\s+/, '')).join('\n');
        } else if (detectedFormat === 'numbered' && stripCb.checked) {
            text = text.split('\n').map(l => l.replace(/^\s*\d+\s+/, '')).join('\n');
        }

        const btn = document.getElementById('create-doc-submit');
        btn.disabled = true; btn.textContent = 'Creating…';
        try {
            const data = await api('POST', '/documents', { title, text, description, settings: { lines_per_page: linesPerPage } });
            const newDocId = data.document.id;
            if (prefill.copyFrom) {
                const copy_variants = document.getElementById('copy-proposals').checked;
                const copy_votes    = document.getElementById('copy-votes').checked;
                const copy_comments = document.getElementById('copy-comments').checked;
                if (copy_variants || copy_votes || copy_comments) {
                    btn.textContent = 'Copying data…';
                    await api('POST', `/documents/${prefill.copyFrom}/copy-data`, {
                        target_doc_id: newDocId, copy_variants, copy_votes, copy_comments,
                    });
                }
            }
            closeModal();
            location.hash = `#/documents/${newDocId}`;
        } catch (err) {
            errEl.textContent = err.message; errEl.style.display = '';
            btn.disabled = false; btn.textContent = 'Create document';
        }
    });
}

/* ===== View: Document ===== */
async function viewDocument(docId) {
    const [docData, variantData] = await Promise.all([
        api('GET', `/documents/${docId}`),
        api('GET', `/documents/${docId}/variants`).catch(() => ({ variants: [] })),
    ]);

    const doc = docData.document;
    const rawVariants = variantData.variants || [];
    const heatConfig = variantData.comment_heat || { orange: 10, red: 25 };
    const topPercent = variantData.top_percent || 10;
    const idOrder = Object.fromEntries([...rawVariants].sort((a, b) => a.id - b.id).map((v, i) => [v.id, i + 1]));
    const variants = rawVariants.map(v => ({ ...v, proposal_num: idOrder[v.id] }));

    // Build overlap map: variantId → [{id, num}] for all pairs whose char ranges intersect
    const overlapMap = {};
    for (let i = 0; i < variants.length; i++) {
        const a = variants[i];
        for (let j = i + 1; j < variants.length; j++) {
            const b = variants[j];
            if (a.char_start < b.char_end && a.char_end > b.char_start) {
                (overlapMap[a.id] = overlapMap[a.id] || []).push({ id: b.id, num: b.proposal_num });
                (overlapMap[b.id] = overlapMap[b.id] || []).push({ id: a.id, num: a.proposal_num });
            }
        }
    }
    state.docCache[docId] = doc;

    let currentPage = parseInt(new URLSearchParams(location.hash.split('?')[1] || '').get('page') || '1');

    const linesData = await api('GET', `/documents/${docId}/lines?page=${currentPage}`);
    const lines = linesData.lines || [];
    state.docLines[docId] = state.docLines[docId] || {};
    state.docLines[docId][currentPage] = lines;

    const wrap = el('div', { class: 'doc-layout' });

    // Text panel
    const textPanel = el('div', { class: 'doc-text-panel' });
    textPanel.innerHTML = `
        <div class="doc-text-header">
            <div>
                <h2>${esc(doc.title)}</h2>
                <span>${statusBadge(doc.status)}</span>
            </div>
            <div class="flex gap-1 items-center">
                ${(doc.status === 'voting' || doc.status === 'final_voting') && state.user ? `<a href="#/documents/${esc(String(docId))}/review" class="btn btn-primary btn-sm">Review</a>` : ''}
                ${doc.owner_id === (state.user && state.user.id) ? `<button class="btn btn-ghost btn-sm" id="doc-settings-btn">Settings</button>` : ''}
                ${doc.owner_id === (state.user && state.user.id) ? `<button class="btn btn-ghost btn-sm" id="doc-copy-btn">Copy</button>` : ''}
                ${(doc.owner_id === (state.user && state.user.id)) ? `<button class="btn btn-ghost btn-sm" id="doc-status-btn">Change status</button>` : ''}
            </div>
        </div>
        <div class="doc-text-body" id="doc-lines-container"></div>
        <div class="pagination" id="doc-pagination"></div>
    `;

    renderLines(textPanel.querySelector('#doc-lines-container'), lines, variants);
    renderPagination(textPanel.querySelector('#doc-pagination'), currentPage, doc.total_pages, docId);

    // Sidebar
    const sidebar = el('div', { class: 'doc-sidebar' });

    // Document meta
    const metaSection = el('div', { class: 'sidebar-section' });
    metaSection.innerHTML = `
        <div class="sidebar-header">Document info</div>
        <div class="sidebar-body">
            <p class="text-muted mb-1">${esc(doc.description) || '<em>No description</em>'}</p>
            <p class="text-muted">Owner: <span class="author-tip" title="${esc([doc.owner_name, doc.owner_organization].filter(Boolean).join(' · '))}">${esc(doc.owner_name)}</span></p>
            <p class="text-muted">${doc.total_lines} lines · ${doc.total_pages} pages</p>
            ${doc.owner_id === (state.user && state.user.id) ? `<button class="btn btn-ghost btn-sm mt-2" id="access-btn">Manage access</button>` : ''}
        </div>
    `;

    // Parse settings once for use in hover handler
    let parsedSettings = {};
    try { parsedSettings = typeof doc.settings === 'object' ? doc.settings : JSON.parse(doc.settings || '{}'); } catch {}
    const linesPerPage = parsedSettings.lines_per_page || 30;

    // Variants sidebar — all proposals, filterable by page
    let varFilterMode = state.docFilterMode[docId] || 'all';

    function getPageVariants() {
        const pageLines = state.docLines[docId][currentPage] || [];
        if (!pageLines.length) return [];
        const pageStart = pageLines[0].char_offset_start;
        const pageEnd = pageLines[pageLines.length - 1].char_offset_end;
        return variants.filter(v => v.char_start < pageEnd && v.char_end > pageStart);
    }

    function getTopVariants() {
        const n = Math.max(1, Math.ceil(variants.length * topPercent / 100));
        return [...variants]
            .sort((a, b) => (b.votes_for + b.votes_against + b.votes_abstain) - (a.votes_for + a.votes_against + a.votes_abstain))
            .slice(0, n);
    }

    function renderVariantList() {
        const list = document.getElementById('variants-list');
        const allBtn = document.getElementById('filter-all-btn');
        const pageBtn = document.getElementById('filter-page-btn');
        const topBtn = document.getElementById('filter-top-btn');
        if (!list) return;
        const pageVariants = getPageVariants();
        const topVariants = getTopVariants();
        if (allBtn) {
            allBtn.textContent = `All ${variants.length}`;
            allBtn.className = `btn btn-sm ${varFilterMode === 'all' ? 'btn-primary' : 'btn-ghost'}`;
        }
        if (pageBtn) {
            pageBtn.textContent = `On-page ${pageVariants.length}`;
            pageBtn.className = `btn btn-sm ${varFilterMode === 'page' ? 'btn-primary' : 'btn-ghost'}`;
        }
        if (topBtn) {
            topBtn.textContent = 'Top';
            topBtn.className = `btn btn-sm ${varFilterMode === 'top' ? 'btn-primary' : 'btn-ghost'}`;
        }
        const displayed = varFilterMode === 'page' ? pageVariants : varFilterMode === 'top' ? topVariants : variants;
        const totalComments = variants.reduce((s, v) => s + (v.comment_count || 0), 0);
        list.innerHTML = displayed.length === 0
            ? '<p class="text-muted">No proposals on this page.</p>'
            : displayed.map(v => renderVariantCard(v, overlapMap[v.id] || [], totalComments, heatConfig)).join('');
    }

    const varSection = el('div', { class: 'sidebar-section' });
    varSection.innerHTML = `
        <div class="sidebar-header">
            <span>Proposals</span>
            <div class="flex gap-1 items-center">
                <div style="display:flex;gap:0.25rem">
                    <button id="filter-all-btn" class="btn btn-sm btn-primary">All ${variants.length}</button>
                    <button id="filter-page-btn" class="btn btn-sm btn-ghost">On-page 0</button>
                    <button id="filter-top-btn" class="btn btn-sm btn-ghost">Top</button>
                </div>
                ${state.user ? `<button class="btn btn-primary btn-sm" id="propose-btn">Propose</button>` : ''}
            </div>
        </div>
        <div class="sidebar-body" id="variants-list"></div>
    `;

    sidebar.append(metaSection, varSection);
    wrap.append(textPanel, sidebar);
    setMain(wrap);

    // Voting countdown banner
    if (doc.voting_scheduled_at && doc.status === 'open') {
        const scheduledMs = new Date(doc.voting_scheduled_at).getTime();
        const isOwner = doc.owner_id === (state.user && state.user.id);
        const banner = el('div', { class: 'voting-banner', id: 'voting-banner' });
        banner.innerHTML = `<span id="voting-banner-countdown"></span>${isOwner ? '<button class="btn btn-ghost btn-sm" id="voting-banner-cancel">Cancel</button>' : ''}`;
        textPanel.querySelector('.doc-text-header').insertAdjacentElement('afterend', banner);

        function tickBanner() {
            const countdown = document.getElementById('voting-banner-countdown');
            if (!countdown) return;
            const remaining = scheduledMs - Date.now();
            if (remaining <= 0) { clearInterval(state.votingBannerInterval); state.votingBannerInterval = null; location.reload(); return; }
            const totalMins = Math.floor(remaining / 60000);
            const secs = Math.floor((remaining % 60000) / 1000);
            const hrs = Math.floor(totalMins / 60);
            const mins = totalMins % 60;
            const display = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}:${String(secs).padStart(2, '0')}`;
            countdown.textContent = `⏱ Voting opens in ${display}`;
        }
        tickBanner();
        state.votingBannerInterval = setInterval(tickBanner, 1000);

        if (isOwner) {
            document.getElementById('voting-banner-cancel').addEventListener('click', async () => {
                try {
                    await api('POST', `/documents/${docId}/status`, { cancel_schedule: true });
                    location.reload();
                } catch (err) { alert(err.message); }
            });
        }
    }

    renderVariantList();

    // Events: variant list — click, hover highlight, goto-page
    const variantsList = wrap.querySelector('#variants-list');
    if (variantsList) {
        variantsList.addEventListener('click', async e => {
            const overlapBtn = e.target.closest('.overlap-indicator');
            if (overlapBtn) {
                e.stopPropagation();
                const card = overlapBtn.closest('.variant-card');
                const ids = (overlapBtn.dataset.overlapIds || '').split(',').filter(Boolean);
                const groupCards = [card, ...ids.map(id => variantsList.querySelector(`.variant-card[data-id="${id}"]`)).filter(Boolean)];
                const wasHighlighted = card.classList.contains('overlap-highlight');
                variantsList.querySelectorAll('.overlap-highlight').forEach(c => c.classList.remove('overlap-highlight'));
                if (!wasHighlighted) groupCards.forEach(c => c.classList.add('overlap-highlight'));
                return;
            }
            const link = e.target.closest('.goto-link[data-page]');
            if (link) {
                e.stopPropagation();
                const card = link.closest('.variant-card');
                const lineStart = card ? parseInt(card.dataset.lineStart) : NaN;
                await navigatePage(parseInt(link.dataset.page), isNaN(lineStart) ? null : lineStart);
                return;
            }
            const card = e.target.closest('.variant-card[data-id]');
            if (card) location.hash = `#/variants/${card.dataset.id}`;
        });

        variantsList.addEventListener('mouseover', e => {
            const card = e.target.closest('.variant-card[data-id]');
            if (!card) return;
            const charStart = parseInt(card.dataset.charStart);
            const charEnd = parseInt(card.dataset.charEnd);
            const currentLines = (state.docLines[docId] || {})[currentPage] || [];
            const onPage = currentLines.some(l => l.char_offset_start < charEnd && l.char_offset_end > charStart);
            if (onPage) {
                textPanel.querySelector('#doc-lines-container').querySelectorAll('.line-text').forEach(span => {
                    const cs = parseInt(span.dataset.charStart), ce = parseInt(span.dataset.charEnd);
                    if (cs < charEnd && ce > charStart) span.classList.add('hover-highlight');
                });
            }
            const lineStart = parseInt(card.dataset.lineStart);
            if (!isNaN(lineStart)) {
                const targetPage = Math.max(1, Math.ceil(lineStart / linesPerPage));
                const gotoLink = card.querySelector('.goto-link');
                if (gotoLink) { gotoLink.textContent = `↗ p.${targetPage}`; gotoLink.dataset.page = targetPage; gotoLink.style.display = ''; }
            }
            const overlapIndicator = card.querySelector('.overlap-indicator');
            if (overlapIndicator) overlapIndicator.style.display = '';
        });

        variantsList.addEventListener('mouseout', e => {
            const card = e.target.closest('.variant-card[data-id]');
            if (!card || card.contains(e.relatedTarget)) return;
            textPanel.querySelector('#doc-lines-container').querySelectorAll('.hover-highlight').forEach(el => el.classList.remove('hover-highlight'));
            const gotoLink = card.querySelector('.goto-link');
            if (gotoLink) { gotoLink.style.display = 'none'; delete gotoLink.dataset.page; }
            const overlapIndicator = card.querySelector('.overlap-indicator');
            if (overlapIndicator) overlapIndicator.style.display = 'none';
        });
    }

    // Event: clicking a highlighted line
    textPanel.querySelector('#doc-lines-container').addEventListener('click', e => {
        const lineEl = e.target.closest('.line-text[data-variant-id]');
        if (lineEl) location.hash = `#/variants/${lineEl.dataset.variantId}`;
    });

    // Pagination
    const paginationEl = textPanel.querySelector('#doc-pagination');

    async function navigatePage(page, scrollToLine) {
        page = Math.max(1, Math.min(doc.total_pages, page));
        const lc = textPanel.querySelector('#doc-lines-container');
        if (page !== currentPage) {
            currentPage = page;
            const ld = await api('GET', `/documents/${docId}/lines?page=${page}`);
            state.docLines[docId][page] = ld.lines;
            lc.querySelectorAll('.hover-highlight').forEach(el => el.classList.remove('hover-highlight'));
            renderLines(lc, ld.lines, variants);
            renderPagination(paginationEl, page, doc.total_pages, docId);
        }
        renderVariantList();
        if (scrollToLine) {
            const target = lc.querySelector(`.doc-line[data-line-num="${scrollToLine}"]`);
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    varSection.querySelector('#filter-all-btn').addEventListener('click', () => { varFilterMode = 'all'; state.docFilterMode[docId] = 'all'; renderVariantList(); });
    varSection.querySelector('#filter-page-btn').addEventListener('click', () => { varFilterMode = 'page'; state.docFilterMode[docId] = 'page'; renderVariantList(); });
    varSection.querySelector('#filter-top-btn').addEventListener('click', () => { varFilterMode = 'top'; state.docFilterMode[docId] = 'top'; renderVariantList(); });

    paginationEl.addEventListener('click', async e => {
        const btn = e.target.closest('button[data-page]');
        if (btn) { await navigatePage(parseInt(btn.dataset.page)); return; }
        if (e.target.closest('button[data-action="jump"]')) {
            const input = paginationEl.querySelector('#page-jump-input');
            await navigatePage(parseInt(input.value) || currentPage);
        }
    });

    paginationEl.addEventListener('keydown', async e => {
        if (e.key === 'Enter' && e.target.id === 'page-jump-input') {
            await navigatePage(parseInt(e.target.value) || currentPage);
        }
    });

    // Settings button
    const settingsBtn = textPanel.querySelector('#doc-settings-btn');
    if (settingsBtn) settingsBtn.addEventListener('click', () => openDocSettingsModal(doc));

    // Copy button — opens New Document modal pre-filled with this document's text and title
    const copyBtn = textPanel.querySelector('#doc-copy-btn');
    if (copyBtn) copyBtn.addEventListener('click', async () => {
        copyBtn.disabled = true; copyBtn.textContent = 'Loading…';
        try {
            const { text } = await api('GET', `/documents/${docId}/text`);
            openCreateDocModal({ title: `${doc.title} (copy)`, text, linesPerPage: parsedSettings.lines_per_page, copyFrom: doc.id });
        } finally {
            copyBtn.disabled = false; copyBtn.textContent = 'Copy';
        }
    });

    // Status button
    const statusBtn = textPanel.querySelector('#doc-status-btn');
    if (statusBtn) statusBtn.addEventListener('click', () => openStatusModal(doc));

    // Access button
    const accessBtn = metaSection.querySelector('#access-btn');
    if (accessBtn) accessBtn.addEventListener('click', () => openAccessModal(docId));

    // Text selection → char offset tracking
    let pendingSelection = null;
    const linesContainer = textPanel.querySelector('#doc-lines-container');
    linesContainer.addEventListener('mouseup', () => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.toString().trim()) { pendingSelection = null; return; }
        const anchor = resolveSelectionOffset(sel.anchorNode, sel.anchorOffset);
        const focus = resolveSelectionOffset(sel.focusNode, sel.focusOffset);
        if (anchor === null || focus === null) { pendingSelection = null; return; }
        const charStart = Math.min(anchor, focus);
        const charEnd = Math.max(anchor, focus);
        if (charStart >= charEnd) { pendingSelection = null; return; }
        pendingSelection = { char_start: charStart, char_end: charEnd, text: sel.toString() };
    });

    // Propose button
    const proposeBtn = varSection.querySelector('#propose-btn');
    if (proposeBtn) proposeBtn.addEventListener('click', () => openProposeModal(doc, pendingSelection));

    // Consume back-from-variant scroll target
    const jump = state.pendingVariantJump;
    if (jump && String(jump.docId) === String(docId)) {
        state.pendingVariantJump = null;
        await navigatePage(jump.page, jump.lineStart);
    }
}

function renderLines(container, lines, variants) {
    container.innerHTML = '';
    for (const line of lines) {
        const overlapping = variants.filter(v =>
            v.status !== 'withdrawn' &&
            v.char_start < line.char_offset_end &&
            v.char_end > line.char_offset_start
        );
        const lineEl = el('div', { class: 'doc-line', 'data-line-num': String(line.line_num) });
        const numEl = el('span', { class: 'line-num' }, String(line.line_num));

        const firstVariant = overlapping[0];
        let textClass = 'line-text';
        if (firstVariant) {
            textClass += ` has-variant line-highlighted-${esc(firstVariant.status === 'approved' ? 'approved' : firstVariant.status === 'rejected' ? 'rejected' : 'pending')}`;
        }
        const textEl = el('span', { class: textClass });
        textEl.textContent = line.original_text || ' ';
        textEl.dataset.charStart = line.char_offset_start;
        textEl.dataset.charEnd = line.char_offset_end;
        if (firstVariant) textEl.dataset.variantId = firstVariant.id;

        lineEl.append(numEl, textEl);
        container.append(lineEl);
    }
}

function renderPagination(container, currentPage, totalPages, docId) {
    if (totalPages <= 1) { container.innerHTML = ''; return; }
    const jumpControl = totalPages > 10
        ? `<input id="page-jump-input" type="number" min="1" max="${totalPages}" value="${currentPage}" style="width:4rem;padding:.25rem .4rem;border:1px solid var(--color-border);border-radius:var(--radius);font-size:.875rem;text-align:center">
           <button class="btn btn-ghost btn-sm" data-action="jump">Go</button>`
        : '';
    container.innerHTML = `
        <button class="btn btn-ghost btn-sm" data-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}>← Prev</button>
        <span class="pagination-info">Page ${currentPage} of ${totalPages}</span>
        <button class="btn btn-ghost btn-sm" data-page="${currentPage + 1}" ${currentPage >= totalPages ? 'disabled' : ''}>Next →</button>
        ${jumpControl}
    `;
}

function renderVariantCard(v, overlaps = [], totalComments = 0, heatConfig = { orange: 10, red: 25 }) {
    const numPrefix = v.proposal_num ? `<span class="variant-num">#${esc(v.proposal_num)}</span> ` : '';
    const lineRange = v.line_start != null
        ? (v.line_start === v.line_end ? `line ${esc(v.line_start)}` : `lines ${esc(v.line_start)}–${esc(v.line_end)}`)
        : '';
    const authorTip = esc([v.proposer_name, v.proposer_org].filter(Boolean).join(' · '));
    const author = `<span class="author-tip" title="${authorTip}">by ${esc(v.proposer_name)}</span>`;
    const meta = [statusBadge(v.status), lineRange, author, timeAgo(v.created_at)].filter(Boolean).join(' · ');
    const overlapNums = overlaps.map(o => `#${o.num}`).join(', ');
    const overlapIndicator = overlaps.length
        ? `<span class="overlap-indicator" style="display:none" data-overlap-ids="${esc(overlaps.map(o => o.id).join(','))}" title="Overlaps with ${esc(overlapNums)}">⊕ ${esc(overlapNums)}</span>`
        : '';
    const cc = v.comment_count || 0;
    const pct = totalComments > 0 ? (cc / totalComments) * 100 : 0;
    const heatClass = pct >= heatConfig.red ? 'comment-heat-red' : pct >= heatConfig.orange ? 'comment-heat-orange' : '';
    const commentBubble = `<span class="comment-bubble ${heatClass}" title="${esc(cc)} comment${cc !== 1 ? 's' : ''}">💬 ${esc(cc)}</span>`;
    return `
        <div class="variant-card" data-id="${esc(v.id)}" data-char-start="${esc(v.char_start)}" data-char-end="${esc(v.char_end)}" data-line-start="${esc(v.line_start ?? '')}">
            <div class="variant-card-title">${numPrefix}${esc(v.title) || esc(v.operation) + ' at ' + esc(v.char_start)}</div>
            <div class="variant-card-meta">${meta}</div>
            <div class="variant-card-footer">
                <div class="vote-mini">
                    <span class="vote-mini-for">▲ ${esc(v.votes_for)}</span>
                    <span class="vote-mini-against">▼ ${esc(v.votes_against)}</span>
                    <span class="vote-mini-abstain">◆ ${esc(v.votes_abstain)}</span>
                    ${commentBubble}
                </div>
                <div class="card-footer-right">
                    ${overlapIndicator}
                    <a class="goto-link" style="display:none" title="Go to page"></a>
                </div>
            </div>
        </div>`;
}

function openDocSettingsModal(doc) {
    let settings = {};
    try { settings = typeof doc.settings === 'object' ? doc.settings : JSON.parse(doc.settings || '{}'); } catch {}

    openModal(`
        <div class="form-group"><label>Title</label><input type="text" id="s-title" value="${esc(doc.title)}"></div>
        <div class="form-group"><label>Description</label><input type="text" id="s-desc" value="${esc(doc.description || '')}"></div>
        <div class="form-group">
            <label><input type="checkbox" id="s-anon" ${settings.allow_anonymous_view ? 'checked' : ''}> Allow anonymous viewing</label>
        </div>
        <p id="settings-err" class="error-msg" style="display:none"></p>
        <div class="form-actions">
            <button id="save-settings" class="btn btn-primary">Save</button>
            <button onclick="closeModal()" class="btn btn-ghost">Cancel</button>
        </div>
    `, 'Document settings');

    document.getElementById('save-settings').addEventListener('click', async () => {
        const errEl = document.getElementById('settings-err');
        errEl.style.display = 'none';
        try {
            await api('PATCH', `/documents/${doc.id}`, {
                title: document.getElementById('s-title').value.trim(),
                description: document.getElementById('s-desc').value.trim(),
                settings: { allow_anonymous_view: document.getElementById('s-anon').checked },
            });
            closeModal();
            location.reload();
        } catch (err) { errEl.textContent = err.message; errEl.style.display = ''; }
    });
}

function openStatusModal(doc) {
    const transitions = { draft: ['open'], open: ['voting', 'draft'], voting: ['resolved', 'open'], resolved: ['archived'], archived: [] };
    const allowed = transitions[doc.status] || [];
    if (!allowed.length) {
        openModal(`<p>No further status transitions available for <strong>${esc(doc.status)}</strong>.</p>`, 'Document status');
        return;
    }

    const defaultMins = (state.config && state.config.voting_countdown_default_minutes) || 5;
    const hasSchedule = !!(doc.voting_scheduled_at && doc.status === 'open');

    const cancelBanner = hasSchedule
        ? `<div class="voting-schedule-notice">⏱ Voting already scheduled — <button class="btn btn-ghost btn-sm" id="cancel-schedule-btn">Cancel schedule</button></div>`
        : '';

    const otherBtns = allowed
        .filter(s => s !== 'voting')
        .map(s => `<button class="btn btn-ghost mb-1" style="width:100%" data-status="${esc(s)}">${esc(s)}</button>`)
        .join('');

    const votingSection = allowed.includes('voting') ? `
        <button class="btn btn-ghost mb-1" style="width:100%" id="voting-transition-btn">voting</button>
        <div id="voting-form" style="display:none;margin-top:0.25rem;padding:0.75rem;background:var(--color-bg-secondary);border:1px solid var(--color-border);border-radius:var(--radius);margin-bottom:0.5rem">
            <label style="display:block;margin-bottom:0.5rem;font-size:0.875rem;font-weight:600">Minutes until voting opens <span class="text-muted">(0 = immediate)</span></label>
            <div class="flex gap-1 items-center">
                <input type="number" id="countdown-input" min="0" max="10080" value="${esc(defaultMins)}" style="width:6rem">
                <button id="schedule-voting-btn" class="btn btn-primary btn-sm">Schedule</button>
                <button id="cancel-voting-form-btn" class="btn btn-ghost btn-sm">Cancel</button>
            </div>
        </div>` : '';

    openModal(`
        ${cancelBanner}
        <p class="mb-2">Current status: ${statusBadge(doc.status)}</p>
        <p class="mb-2">Transition to:</p>
        ${votingSection}
        ${otherBtns}
        <p id="status-err" class="error-msg" style="display:none"></p>
    `, 'Change status');

    const mc = document.getElementById('modal-content');
    const errEl = mc.querySelector('#status-err');

    if (hasSchedule) {
        mc.querySelector('#cancel-schedule-btn').addEventListener('click', async () => {
            errEl.style.display = 'none';
            try {
                await api('POST', `/documents/${doc.id}/status`, { cancel_schedule: true });
                closeModal(); location.reload();
            } catch (err) { errEl.textContent = err.message; errEl.style.display = ''; }
        });
    }

    const votingTransBtn = mc.querySelector('#voting-transition-btn');
    if (votingTransBtn) {
        const votingForm = mc.querySelector('#voting-form');
        votingTransBtn.addEventListener('click', () => { votingForm.style.display = ''; votingTransBtn.style.display = 'none'; });
        mc.querySelector('#cancel-voting-form-btn').addEventListener('click', () => { votingForm.style.display = 'none'; votingTransBtn.style.display = ''; });
        mc.querySelector('#schedule-voting-btn').addEventListener('click', async () => {
            const mins = parseInt(mc.querySelector('#countdown-input').value || '0');
            errEl.style.display = 'none';
            try {
                await api('POST', `/documents/${doc.id}/status`, { status: 'voting', countdown_minutes: mins });
                closeModal(); location.reload();
            } catch (err) { errEl.textContent = err.message; errEl.style.display = ''; }
        });
    }

    mc.addEventListener('click', async e => {
        const btn = e.target.closest('button[data-status]');
        if (!btn) return;
        errEl.style.display = 'none';
        try {
            await api('POST', `/documents/${doc.id}/status`, { status: btn.dataset.status });
            closeModal(); location.reload();
        } catch (err) { errEl.textContent = err.message; errEl.style.display = ''; }
    });
}

function openAccessModal(docId) {
    openModal(`<div class="loading-spinner">Loading…</div>`, 'Manage access');

    api('GET', `/documents/${docId}/access`).then(data => {
        const rows = data.access || [];
        const allLevels = ['viewer', 'commenter', 'proposer', 'voter', 'editor', 'admin'];
        const defaultAccessLevels = ['viewer', 'commenter', 'proposer', 'voter'];
        const myIdx = allLevels.indexOf(data.my_access_level || 'admin');
        const allowedLevels = allLevels.filter((_, i) => i <= myIdx);
        const defaultLevel = allowedLevels.includes('proposer') ? 'proposer' : allowedLevels[allowedLevels.length - 1];
        const currentDefault = data.default_access || '';
        document.getElementById('modal-content').innerHTML = `
            <div class="modal-title">Manage access</div>
            <p class="mb-1" style="font-weight:600">Default access</p>
            <div class="flex items-center gap-1 mb-1">
                <select id="default-access-select" class="invite-role-select">
                    <option value="">None — invite only</option>
                    ${defaultAccessLevels.map(l => `<option value="${l}"${l === currentDefault ? ' selected' : ''}>${l}</option>`).join('')}
                </select>
                <span class="text-muted" style="font-size:0.8rem">Role granted to any signed-in user not explicitly invited</span>
            </div>
            <p id="default-access-status" style="font-size:0.75rem;min-height:1rem;margin-bottom:0.5rem"></p>
            <hr style="margin:0.75rem 0;border:none;border-top:1px solid var(--color-border)">
            <div class="mb-2">${rows.map(r => `
                <div class="flex items-center justify-between gap-1 mb-1">
                    <span>${esc(r.email)}</span>
                    <span class="text-muted">${esc(r.access_level)}</span>
                    <span class="row-actions"><button class="btn btn-ghost btn-sm" data-remove="${esc(r.user_id)}">Remove</button></span>
                </div>`).join('') || '<p class="text-muted">No explicit access records.</p>'}
            </div>
            <hr style="margin:1rem 0;border:none;border-top:1px solid var(--color-border)">
            <p class="mb-1" style="font-weight:600">Invite user</p>
            <div class="flex gap-1 mb-1" style="position:relative">
                <div style="flex:1;position:relative">
                    <input type="text" id="invite-search" placeholder="Search by name, email or organisation…" autocomplete="off">
                    <ul id="invite-results" class="user-search-dropdown" style="display:none"></ul>
                </div>
                <button class="btn btn-ghost btn-sm" id="invite-search-btn" title="Search">🔍</button>
                <select id="invite-level" class="invite-role-select">
                    ${allowedLevels.map(l => `<option value="${l}"${l === defaultLevel ? ' selected' : ''}>${l}</option>`).join('')}
                </select>
            </div>
            <p id="invite-err" class="error-msg" style="display:none"></p>
            <button id="invite-submit" class="btn btn-primary btn-sm">Invite</button>
        `;

        document.getElementById('default-access-select').addEventListener('change', async e => {
            const statusEl = document.getElementById('default-access-status');
            const val = e.target.value;
            statusEl.textContent = 'Saving…'; statusEl.style.color = '';
            try {
                await api('PATCH', `/documents/${docId}`, { settings: { default_access: val || null } });
                statusEl.textContent = val ? `Default set to "${val}"` : 'Set to invite only';
                statusEl.style.color = 'var(--color-success, #16a34a)';
            } catch (err) {
                statusEl.textContent = err.message; statusEl.style.color = 'var(--color-error, #dc2626)';
            }
        });

        const searchInput = document.getElementById('invite-search');
        const resultsList = document.getElementById('invite-results');
        const errEl = document.getElementById('invite-err');
        let selectedEmail = '';

        function hideResults() { resultsList.style.display = 'none'; resultsList.innerHTML = ''; }

        async function runSearch() {
            const q = searchInput.value.trim();
            if (q.length < 3) { hideResults(); return; }
            try {
                const { users } = await api('GET', `/auth/search?q=${encodeURIComponent(q)}`);
                if (!users.length) { hideResults(); return; }
                resultsList.innerHTML = users.map(u => `
                    <li class="user-search-result" data-email="${esc(u.email)}">
                        <span class="user-search-name">${esc(u.display_name || u.email)}</span>
                        <span class="user-search-meta">${esc([u.email, u.organization].filter(Boolean).join(' · '))}</span>
                    </li>`).join('');
                resultsList.style.display = '';
            } catch { hideResults(); }
        }

        document.getElementById('invite-search-btn').addEventListener('click', runSearch);
        searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } });
        searchInput.addEventListener('input', () => { selectedEmail = ''; });

        resultsList.addEventListener('click', e => {
            const li = e.target.closest('.user-search-result');
            if (!li) return;
            selectedEmail = li.dataset.email;
            searchInput.value = li.dataset.email;
            hideResults();
            errEl.style.display = 'none';
        });

        document.addEventListener('click', e => {
            if (!e.target.closest('#invite-search') && !e.target.closest('#invite-results')) hideResults();
        }, { once: false, capture: false });

        document.getElementById('invite-submit').addEventListener('click', async () => {
            errEl.style.display = 'none';
            const email = (selectedEmail || searchInput.value).trim();
            const level = document.getElementById('invite-level').value;
            if (!email || !email.includes('@')) { errEl.textContent = 'Select a user from results or enter a valid email address'; errEl.style.display = ''; return; }
            try {
                await api('POST', `/documents/${docId}/access`, { email, access_level: level });
                closeModal();
                openAccessModal(docId);
            } catch (err) { errEl.textContent = err.message; errEl.style.display = ''; }
        });

        document.getElementById('modal-content').addEventListener('click', async e => {
            const removeBtn = e.target.closest('button[data-remove]');
            if (removeBtn) {
                const actions = removeBtn.closest('.row-actions');
                const userId = removeBtn.dataset.remove;
                actions.innerHTML =
                    `<button class="btn btn-danger btn-sm" data-confirm-remove="${esc(userId)}">OK</button>` +
                    `<button class="btn btn-ghost btn-sm" data-cancel-remove="${esc(userId)}">Cancel</button>`;
                return;
            }
            const cancelBtn = e.target.closest('button[data-cancel-remove]');
            if (cancelBtn) {
                const actions = cancelBtn.closest('.row-actions');
                actions.innerHTML = `<button class="btn btn-ghost btn-sm" data-remove="${esc(cancelBtn.dataset.cancelRemove)}">Remove</button>`;
                return;
            }
            const confirmBtn = e.target.closest('button[data-confirm-remove]');
            if (confirmBtn) {
                try {
                    await api('DELETE', `/documents/${docId}/access/${confirmBtn.dataset.confirmRemove}`);
                    closeModal();
                    openAccessModal(docId);
                } catch (err) { alert(err.message); }
            }
        });
    });
}

function resolveSelectionOffset(node, nodeOffset) {
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const lineTextEl = el.closest('.line-text');
    if (lineTextEl) {
        const cs = parseInt(lineTextEl.dataset.charStart);
        return isNaN(cs) ? null : cs + nodeOffset;
    }
    const lineEl = el.closest('.doc-line');
    if (!lineEl) return null;
    const lt = lineEl.querySelector('.line-text');
    if (!lt) return null;
    const cs = parseInt(lt.dataset.charStart);
    return isNaN(cs) ? null : cs;
}

function openProposeModal(doc, selection) {
    const hasSelection = !!(selection && selection.char_start < selection.char_end);
    const selInfo = hasSelection
        ? `Selected range: chars ${selection.char_start}–${selection.char_end}`
        : 'No text selected — select text in the document before proposing';

    const selPreview = hasSelection && selection.text
        ? `<details class="selected-text-collapsible" open>
               <summary>Selected text</summary>
               <pre class="selected-text-preview">${esc(selection.text)}</pre>
           </details>`
        : '';

    openModal(`
        ${selPreview}
        <div class="form-group">
            <label>Operation</label>
            <select id="op-type">
                <option value="replace">Replace</option>
                <option value="insert">Insert</option>
                <option value="delete">Delete</option>
            </select>
        </div>
        <div class="form-group" id="new-text-group">
            <label>New text</label>
            <textarea id="new-text" placeholder="Replacement or inserted text"></textarea>
        </div>
        <div class="form-group">
            <label>Title <span class="text-muted">(brief summary)</span></label>
            <input type="text" id="var-title" placeholder="What does this change do?">
        </div>
        <div class="form-group">
            <label>Rationale <span class="text-muted">(optional)</span></label>
            <textarea id="var-rationale" style="min-height:80px" placeholder="Why is this change needed?"></textarea>
        </div>
        <div class="selection-info">${esc(selInfo)}</div>
        <p id="propose-err" class="error-msg" style="display:none"></p>
        <div class="form-actions">
            <button id="propose-submit" class="btn btn-primary" ${hasSelection ? '' : 'disabled'}>Submit proposal</button>
            <button onclick="closeModal()" class="btn btn-ghost">Cancel</button>
        </div>
    `, 'Propose variant');

    document.getElementById('op-type').addEventListener('change', e => {
        document.getElementById('new-text-group').style.display = e.target.value === 'delete' ? 'none' : '';
    });

    document.getElementById('propose-submit').addEventListener('click', async () => {
        if (!hasSelection) return;
        const errEl = document.getElementById('propose-err');
        errEl.style.display = 'none';
        const operation = document.getElementById('op-type').value;
        const new_text = document.getElementById('new-text').value;
        const title = document.getElementById('var-title').value.trim();
        const rationale = document.getElementById('var-rationale').value.trim();

        const btn = document.getElementById('propose-submit');
        btn.disabled = true; btn.textContent = 'Submitting…';
        try {
            const data = await api('POST', `/documents/${doc.id}/variants`, {
                char_start: selection.char_start, char_end: selection.char_end,
                operation, new_text, title, rationale
            });
            closeModal();
            location.hash = `#/variants/${data.variant.id}`;
        } catch (err) {
            errEl.textContent = err.message; errEl.style.display = '';
            if (err.status === 429 && err.data && err.data.retry_after) {
                startCooldown(btn, 'Submit proposal', err.data.retry_after);
            } else {
                btn.disabled = false; btn.textContent = 'Submit proposal';
            }
        }
    });
}

/* ===== View: Variant detail ===== */
async function viewVariant(variantId) {
    variantId = parseInt(variantId);
    state.commentSort = 'chrono';
    state.commentAuthorId = null;
    const data = await api('GET', `/variants/${variantId}`);
    const v = data.variant;
    state.commentAuthorId = v.user_id;

    // Fetch doc, all doc variants, comments, votes in parallel
    const [docData, allVariantsData, commentData, voteData] = await Promise.all([
        api('GET', `/documents/${v.document_id}`).catch(() => null),
        api('GET', `/documents/${v.document_id}/variants`).catch(() => ({ variants: [] })),
        api('GET', `/variants/${variantId}/comments`).catch(() => ({ comments: [] })),
        api('GET', `/variants/${variantId}/votes`).catch(() => ({ votes: [], tallies: {} })),
    ]);

    const doc = docData && docData.document;
    if (!state.user && !doc) {
        setMain(`<div class="page-container"><div class="card"><h1>${esc(v.title||'Proposal')}</h1>${v.rationale?`<p style="border-left:3px solid var(--color-border);padding:.5rem .75rem;font-style:italic">${esc(v.rationale)}</p>`:''}<div class="diff-block">${renderDiff(v,null)}</div><p class="text-muted mt-2"><a href="#/login">Log in</a> to view the full document and other proposals.</p></div></div>`);
        return;
    }
    const rawVariants = allVariantsData.variants || [];

    // Proposal number: id-ascending order (same as sidebar #N)
    const idOrder = Object.fromEntries([...rawVariants].sort((a, b) => a.id - b.id).map((vv, i) => [vv.id, i + 1]));
    const proposalNum = idOrder[variantId];

    // Document-position order (same as sidebar listing) for prev/next
    const docOrdered = [...rawVariants].sort((a, b) =>
        a.char_start !== b.char_start ? a.char_start - b.char_start : new Date(a.created_at) - new Date(b.created_at)
    );
    const posIdx = docOrdered.findIndex(vv => vv.id === variantId);
    const prevV = posIdx > 0 ? { ...docOrdered[posIdx - 1], proposal_num: idOrder[docOrdered[posIdx - 1].id] } : null;
    const nextV = posIdx < docOrdered.length - 1 ? { ...docOrdered[posIdx + 1], proposal_num: idOrder[docOrdered[posIdx + 1].id] } : null;

    // Page + line for back-to-document jump
    const thisInList = rawVariants.find(vv => vv.id === variantId);
    const lineStart = thisInList ? thisInList.line_start : null;
    let parsedSettings = {};
    try { parsedSettings = doc ? (typeof doc.settings === 'object' ? doc.settings : JSON.parse(doc.settings || '{}')) : {}; } catch {}
    const linesPerPage = parsedSettings.lines_per_page || 30;
    const jumpPage = lineStart
        ? Math.ceil(lineStart / linesPerPage)
        : Math.max(1, Math.ceil((v.char_start / Math.max((doc && doc.total_chars) || 1, 1)) * ((doc && doc.total_pages) || 1)));

    // Get original text from doc lines if available
    let originalText = null;
    if (doc) {
        const allLines = Object.values(state.docLines[v.document_id] || {}).flat();
        if (allLines.length > 0) {
            originalText = extractTextRange(allLines, v.char_start, v.char_end);
        } else {
            try {
                const ld = await api('GET', `/documents/${v.document_id}/lines?page=${jumpPage}`);
                state.docLines[v.document_id] = state.docLines[v.document_id] || {};
                state.docLines[v.document_id][jumpPage] = ld.lines;
                originalText = extractTextRange(ld.lines, v.char_start, v.char_end);
            } catch {}
        }
    }

    const affectedLines = Object.values(state.docLines[v.document_id] || {}).flat()
        .filter(l => l.char_offset_start < v.char_end && l.char_offset_end > v.char_start)
        .sort((a, b) => a.line_num - b.line_num);

    const myVoteRecord = state.user ? voteData.votes.find(vt => vt.user_id === state.user.id) : null;
    const myVote = myVoteRecord != null ? myVoteRecord.vote_value : undefined;

    const wrap = el('div', { class: 'variant-layout' });

    const prevLabel = prevV ? `#${prevV.proposal_num} ${prevV.title || prevV.operation}` : '';
    const nextLabel = nextV ? `#${nextV.proposal_num} ${nextV.title || nextV.operation}` : '';

    wrap.innerHTML = `
        <div class="variant-nav-row">
            ${doc ? `<button id="back-to-doc-btn" class="btn btn-ghost btn-sm">← Back to document</button>` : '<span></span>'}
            <div class="variant-nav-arrows">
                ${prevV ? `<button class="btn btn-ghost variant-nav-arrow" data-nav-id="${esc(prevV.id)}" title="${esc(prevLabel)}">← <span class="nav-arrow-label">Prev</span></button>` : ''}
                ${nextV ? `<button class="btn btn-ghost variant-nav-arrow" data-nav-id="${esc(nextV.id)}" title="${esc(nextLabel)}"><span class="nav-arrow-label">Next</span> →</button>` : ''}
            </div>
        </div>
        <div class="card">
            <div class="flex justify-between items-center mb-1">
                <h1 class="proposal-heading">Proposal ${proposalNum ? `#${esc(proposalNum)}` : ''}</h1>
                <div class="flex gap-1 items-center">${statusBadge(v.status)}<button id="share-variant-btn" class="btn btn-ghost btn-sm">Share</button></div>
            </div>
            ${v.title ? `<p style="font-size:1rem;font-weight:600;margin-bottom:0.5rem">${esc(v.title)}</p>` : ''}
            <p class="text-muted mb-2">
                ${esc(v.operation)} · ${v.operation === 'insert' ? `char ${esc(v.char_start)}` : `chars ${esc(v.char_start)}–${esc(v.char_end)}`} ·
                proposed by <strong>${esc(v.proposer_name)}</strong> · ${timeAgo(v.created_at)}
            </p>
            ${v.rationale ? `<p style="border-left:3px solid var(--color-border);padding:.5rem .75rem;font-style:italic;margin-bottom:.5rem">${esc(v.rationale)}</p>` : ''}

            <div class="diff-block">
                ${renderDiff(v, originalText)}
            </div>

            ${affectedLines.length ? `
            <div class="line-preview-section">
                <div class="line-preview-header">
                    <div class="flex gap-1 items-center">
                        <button id="preview-orig-btn" class="btn btn-primary btn-sm">Original</button>
                        <button id="preview-prop-btn" class="btn btn-ghost btn-sm">Proposed</button>
                        <span class="text-muted" style="font-size:0.8125rem">In context</span>
                    </div>
                </div>
                <div id="line-preview-content" class="line-preview-block"></div>
            </div>` : ''}

            ${state.user && v.proposed_by === state.user.id && v.status === 'pending' ? `
                <div class="flex gap-1 mt-2">
                    <button id="edit-variant-btn" class="btn btn-ghost btn-sm">Edit</button>
                    <button id="withdraw-variant-btn" class="btn btn-danger btn-sm">Withdraw</button>
                </div>` : ''}
        </div>

        <div class="card" id="vote-card">
            <div class="sidebar-header" style="margin:-1.25rem -1.25rem 1rem;padding:.875rem 1.25rem;background:var(--color-bg-secondary);border-bottom:1px solid var(--color-border);border-radius:12px 12px 0 0">
                Votes
            </div>
            ${renderVoteSection(v, myVote)}
        </div>

        <div class="card">
            <div class="sidebar-header" style="margin:-1.25rem -1.25rem 1rem;padding:.875rem 1.25rem;background:var(--color-bg-secondary);border-bottom:1px solid var(--color-border);border-radius:12px 12px 0 0">
                Comments
            </div>
            <div class="comment-sort-bar" id="comment-sort-bar">
                <button id="csort-chrono" class="btn btn-sm btn-primary" data-sort="chrono">Oldest</button>
                <button id="csort-recent" class="btn btn-sm btn-ghost" data-sort="recent">Newest</button>
                <button id="csort-replied" class="btn btn-sm btn-ghost" data-sort="replied">Most replied</button>
                <button id="csort-author" class="btn btn-sm btn-ghost" data-sort="author">Author's</button>
            </div>
            <div id="comment-thread">
                ${renderCommentThread(commentData.comments || [], v.id, 'chrono', v.user_id)}
            </div>
            ${state.user ? `
                <div class="mt-2" id="comment-form">
                    <textarea id="comment-text" class="comment-form" placeholder="Add a comment…"></textarea>
                    <div class="flex gap-1 mt-1">
                        <button id="post-comment-btn" class="btn btn-primary btn-sm">Post comment</button>
                    </div>
                    <p id="comment-err" class="error-msg" style="display:none"></p>
                </div>` : '<p class="text-muted mt-2">Log in to comment.</p>'}
        </div>
    `;

    setMain(wrap);

    // Share button
    document.getElementById('share-variant-btn').addEventListener('click', () => {
        const shareUrl = location.origin + '/#/variants/' + variantId;
        const isProposer = state.user && v.proposed_by === state.user.id;
        openModal(`<div class="form-group"><label>Share link</label><div class="flex gap-1"><input id="share-url" value="${esc(shareUrl)}" readonly style="flex:1"><button id="share-copy-btn" class="btn btn-primary btn-sm">Copy</button></div></div>${isProposer?`<label style="display:flex;align-items:center;gap:.5rem;margin-top:.75rem"><input type="checkbox" id="share-anon-cb"${v.allow_anonymous_share?' checked':''}> Allow anyone to view this proposal without logging in</label>`:''}`, 'Share proposal');
        document.getElementById('share-copy-btn').onclick = () => { navigator.clipboard.writeText(shareUrl).catch(()=>{}); showToast('Link copied!', null, 3); closeModal(); };
        if (isProposer) document.getElementById('share-anon-cb').addEventListener('change', async function() {
            try { await api('PATCH', `/variants/${variantId}/share`, { allow_anonymous_share: this.checked?1:0 }); v.allow_anonymous_share = this.checked?1:0; } catch {}
        });
    });

    // Comment sort buttons
    const sortBar = document.getElementById('comment-sort-bar');
    if (sortBar) {
        let cachedComments = commentData.comments || [];
        const refreshThread = (comments) => {
            cachedComments = comments;
            const thread = document.getElementById('comment-thread');
            if (thread) {
                thread.innerHTML = renderCommentThread(cachedComments, variantId, state.commentSort, state.commentAuthorId);
                wireCommentActions(variantId);
            }
            sortBar.querySelectorAll('button[data-sort]').forEach(b => {
                b.className = `btn btn-sm ${b.dataset.sort === state.commentSort ? 'btn-primary' : 'btn-ghost'}`;
            });
        };
        sortBar.addEventListener('click', e => {
            const btn = e.target.closest('button[data-sort]');
            if (!btn) return;
            state.commentSort = btn.dataset.sort;
            refreshThread(cachedComments);
        });
        sortBar._refreshCommentThread = refreshThread;
    }

    // Line context preview toggle
    const previewEl = document.getElementById('line-preview-content');
    if (previewEl) {
        const origBtn = document.getElementById('preview-orig-btn');
        const propBtn = document.getElementById('preview-prop-btn');
        previewEl.innerHTML = renderOriginalPreview(affectedLines, v);
        origBtn.addEventListener('click', () => {
            previewEl.innerHTML = renderOriginalPreview(affectedLines, v);
            origBtn.className = 'btn btn-primary btn-sm';
            propBtn.className = 'btn btn-ghost btn-sm';
        });
        propBtn.addEventListener('click', () => {
            previewEl.innerHTML = renderProposedPreview(affectedLines, v);
            origBtn.className = 'btn btn-ghost btn-sm';
            propBtn.className = 'btn btn-primary btn-sm';
        });
    }

    // Back to document — navigate and scroll to this proposal
    const backBtn = document.getElementById('back-to-doc-btn');
    if (backBtn) backBtn.addEventListener('click', () => {
        state.pendingVariantJump = { docId: String(v.document_id), page: jumpPage, lineStart };
        location.hash = `#/documents/${v.document_id}`;
    });

    // Prev/next arrows
    wrap.querySelectorAll('.variant-nav-arrow').forEach(btn => {
        btn.addEventListener('click', () => { location.hash = `#/variants/${btn.dataset.navId}`; });
    });

    // Vote buttons
    const voteCard = document.getElementById('vote-card');
    voteCard.addEventListener('click', async e => {
        const btn = e.target.closest('.vote-btn[data-value]');
        if (!btn || !state.user) return;
        const value = parseInt(btn.dataset.value);
        try {
            const result = await api('POST', `/variants/${variantId}/vote`, { vote_value: value });
            v.votes_for = result.tallies.votes_for;
            v.votes_against = result.tallies.votes_against;
            v.votes_abstain = result.tallies.votes_abstain;
            voteCard.innerHTML = `
                <div class="sidebar-header" style="margin:-1.25rem -1.25rem 1rem;padding:.875rem 1.25rem;background:var(--color-bg-secondary);border-bottom:1px solid var(--color-border);border-radius:12px 12px 0 0">Votes</div>
                ${renderVoteSection(v, value)}`;
        } catch (err) { alert(err.message); }
    });

    // Comment form
    const postBtn = document.getElementById('post-comment-btn');
    if (postBtn) {
        postBtn.addEventListener('click', async () => {
            const text = document.getElementById('comment-text').value.trim();
            const errEl = document.getElementById('comment-err');
            errEl.style.display = 'none';
            if (!text) { errEl.textContent = 'Comment required'; errEl.style.display = ''; return; }
            postBtn.disabled = true;
            try {
                await api('POST', `/variants/${variantId}/comments`, { text });
                document.getElementById('comment-text').value = '';
                const cd = await api('GET', `/variants/${variantId}/comments`);
                const sb = document.getElementById('comment-sort-bar');
                if (sb && sb._refreshCommentThread) {
                    sb._refreshCommentThread(cd.comments || []);
                } else {
                    document.getElementById('comment-thread').innerHTML = renderCommentThread(cd.comments || [], variantId, state.commentSort, state.commentAuthorId);
                    wireCommentActions(variantId);
                }
                startCooldown(postBtn, 'Post comment', 5);
            } catch (err) {
                errEl.textContent = err.message; errEl.style.display = '';
                if (err.status === 429 && err.data && err.data.retry_after) {
                    startCooldown(postBtn, 'Post comment', err.data.retry_after);
                } else {
                    postBtn.disabled = false;
                }
            }
        });
    }

    wireCommentActions(variantId);

    // Edit variant
    const editBtn = document.getElementById('edit-variant-btn');
    if (editBtn) editBtn.addEventListener('click', () => openEditVariantModal(v));

    // Withdraw variant
    const withdrawBtn = document.getElementById('withdraw-variant-btn');
    if (withdrawBtn) withdrawBtn.addEventListener('click', async () => {
        if (!confirm('Withdraw this variant?')) return;
        try {
            await api('DELETE', `/variants/${variantId}`);
            location.hash = `#/documents/${v.document_id}`;
        } catch (err) { alert(err.message); }
    });
}

function renderOriginalPreview(lines, v) {
    return lines.map(line => {
        const ls = line.char_offset_start, le = line.char_offset_end;
        const t = line.original_text;
        let content;
        if (v.operation !== 'insert' && v.char_start < le && v.char_end > ls) {
            const s = Math.max(v.char_start, ls) - ls;
            const e = Math.min(v.char_end, le) - ls;
            content = esc(t.substring(0, s)) +
                `<mark class="preview-del">${esc(t.substring(s, e)) || '​'}</mark>` +
                esc(t.substring(e));
        } else {
            content = esc(t) || '&nbsp;';
        }
        return `<div class="preview-line"><span class="preview-lnum">${line.line_num}</span><span class="preview-ltext">${content}</span></div>`;
    }).join('');
}

function renderProposedPreview(lines, v) {
    const blockStart = lines[0].char_offset_start;
    const originalBlock = lines.map(l => l.original_text).join('\n');
    const relStart = Math.max(0, v.char_start - blockStart);
    const relEnd = Math.min(originalBlock.length, v.char_end - blockStart);
    const newText = v.new_text || '';
    let proposed;
    if (v.operation === 'delete') {
        proposed = originalBlock.substring(0, relStart) + originalBlock.substring(relEnd);
    } else if (v.operation === 'insert') {
        proposed = originalBlock.substring(0, relStart) + newText + originalBlock.substring(relStart);
    } else {
        proposed = originalBlock.substring(0, relStart) + newText + originalBlock.substring(relEnd);
    }
    const hlStart = relStart;
    const hlEnd = v.operation === 'delete' ? relStart : relStart + newText.length;
    const startLineNum = lines[0].line_num;
    let charPos = 0;
    return proposed.split('\n').map((lineText, i) => {
        const ls = charPos, le = charPos + lineText.length;
        charPos += lineText.length + 1;
        let content;
        if (hlEnd > hlStart && hlStart < le && hlEnd > ls) {
            const s = Math.max(hlStart, ls) - ls;
            const e = Math.min(hlEnd, le) - ls;
            content = esc(lineText.substring(0, s)) +
                `<mark class="preview-ins">${esc(lineText.substring(s, e)) || '​'}</mark>` +
                esc(lineText.substring(e));
        } else {
            content = esc(lineText) || '&nbsp;';
        }
        return `<div class="preview-line"><span class="preview-lnum">${startLineNum + i}</span><span class="preview-ltext">${content}</span></div>`;
    }).join('');
}

function extractTextRange(lines, charStart, charEnd) {
    const relevant = lines.filter(l => l.char_offset_start < charEnd && l.char_offset_end > charStart);
    if (!relevant.length) return null;
    let text = '';
    for (let i = 0; i < relevant.length; i++) {
        const l = relevant[i];
        const s = Math.max(charStart, l.char_offset_start) - l.char_offset_start;
        const e = Math.min(charEnd, l.char_offset_end) - l.char_offset_start;
        text += l.original_text.substring(s, e);
        if (i < relevant.length - 1) text += '\n';
    }
    return text;
}

function renderDiff(v, originalText) {
    if (v.operation === 'insert') {
        return `<div class="diff-ins">${esc(v.new_text)}</div>
                <div class="diff-context">Inserted at character position ${esc(v.char_start)}</div>`;
    }
    if (v.operation === 'delete') {
        return `<div class="diff-del">${esc(originalText || `[${v.char_end - v.char_start} chars at position ${v.char_start}]`)}</div>
                <div class="diff-context">Text deleted (${esc(v.char_end - v.char_start)} characters)</div>`;
    }
    // replace
    return `${originalText ? `<div class="diff-del">${esc(originalText)}</div>` : `<div class="diff-del">[${v.char_end - v.char_start} chars at position ${v.char_start}]</div>`}
            ${v.new_text ? `<div class="diff-ins">${esc(v.new_text)}</div>` : ''}`;
}

function renderVoteSection(v, myVote) {
    const isFor = myVote === 1;
    const isAgainst = myVote === -1;
    const isAbstain = myVote === 0;
    return `
        <div class="vote-section">
            <button class="vote-btn ${isFor ? 'active-for' : ''}" data-value="1">▲ For <strong>${esc(v.votes_for)}</strong></button>
            <button class="vote-btn ${isAgainst ? 'active-against' : ''}" data-value="-1">▼ Against <strong>${esc(v.votes_against)}</strong></button>
            <button class="vote-btn ${isAbstain ? 'active-abstain' : ''}" data-value="0">◆ Abstain <strong>${esc(v.votes_abstain)}</strong></button>
            ${!state.user ? '<span class="text-muted">Log in to vote</span>' : ''}
        </div>`;
}

function renderCommentThread(comments, variantId, sortMode = 'chrono', authorId = null) {
    if (!comments.length) return '<p class="text-muted">No comments yet.</p>';
    let top = [...comments];
    if (sortMode === 'author') {
        top = top.filter(c => c.user_id === authorId);
    } else if (sortMode === 'recent') {
        top.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } else if (sortMode === 'replied') {
        top.sort((a, b) => (b.replies || []).length - (a.replies || []).length);
    }
    if (!top.length) return '<p class="text-muted">No comments match this filter.</p>';
    return `<div class="comment-thread">` + top.map(c => `
        <div class="comment" id="comment-${esc(c.id)}">
            <div class="comment-header">
                <span class="comment-author">${esc(c.author_name)}</span>
                <span class="comment-time">${timeAgo(c.created_at)}</span>
            </div>
            <div class="comment-text">${esc(c.text)}</div>
            ${state.user ? `<div class="comment-actions">
                <button class="btn btn-ghost btn-sm reply-btn" data-parent="${esc(c.id)}">Reply</button>
                ${c.user_id === (state.user && state.user.id) ? `<button class="btn btn-ghost btn-sm delete-comment-btn" data-id="${esc(c.id)}">Delete</button>` : ''}
            </div>` : ''}
            ${c.replies && c.replies.length ? `
                <div class="comment-replies">
                    ${c.replies.map(r => `
                        <div class="reply" id="comment-${esc(r.id)}">
                            <div class="comment-header">
                                <span class="comment-author">${esc(r.author_name)}</span>
                                <span class="comment-time">${timeAgo(r.created_at)}</span>
                            </div>
                            <div class="comment-text">${esc(r.text)}</div>
                            ${state.user && r.user_id === state.user.id ? `<div class="comment-actions"><button class="btn btn-ghost btn-sm delete-comment-btn" data-id="${esc(r.id)}">Delete</button></div>` : ''}
                        </div>`).join('')}
                </div>` : ''}
        </div>`).join('') + `</div>`;
}

function wireCommentActions(variantId) {
    const thread = document.getElementById('comment-thread');
    if (!thread) return;

    const applyRefresh = (comments) => {
        const sortBar = document.getElementById('comment-sort-bar');
        if (sortBar && sortBar._refreshCommentThread) {
            sortBar._refreshCommentThread(comments);
        } else {
            thread.innerHTML = renderCommentThread(comments, variantId, state.commentSort, state.commentAuthorId);
            wireCommentActions(variantId);
        }
    };

    thread.addEventListener('click', async e => {
        const replyBtn = e.target.closest('.reply-btn');
        if (replyBtn) {
            const parentId = replyBtn.dataset.parent;
            const existing = document.getElementById(`reply-form-${parentId}`);
            if (existing) { existing.remove(); return; }
            const form = el('div', { id: `reply-form-${parentId}`, style: 'margin-top:.5rem' });
            form.innerHTML = `
                <textarea style="width:100%;min-height:60px;border:1px solid var(--color-border);border-radius:var(--radius);padding:.5rem;font-family:var(--font-sans);font-size:.875rem" placeholder="Write a reply…"></textarea>
                <div class="flex gap-1 mt-1">
                    <button class="btn btn-primary btn-sm post-reply-btn" data-parent="${esc(parentId)}">Reply</button>
                    <button class="btn btn-ghost btn-sm cancel-reply-btn">Cancel</button>
                </div>
                <p class="reply-err error-msg" style="display:none"></p>
            `;
            replyBtn.closest('.comment').append(form);
            form.querySelector('textarea').focus();
        }

        const cancelReply = e.target.closest('.cancel-reply-btn');
        if (cancelReply) {
            cancelReply.closest('[id^="reply-form-"]').remove();
        }

        const postReply = e.target.closest('.post-reply-btn');
        if (postReply) {
            const parentId = postReply.dataset.parent;
            const textarea = postReply.closest('[id^="reply-form-"]').querySelector('textarea');
            const errEl = postReply.closest('[id^="reply-form-"]').querySelector('.reply-err');
            const text = textarea.value.trim();
            if (!text) { errEl.textContent = 'Reply required'; errEl.style.display = ''; return; }
            postReply.disabled = true;
            try {
                await api('POST', `/variants/${variantId}/comments`, { text, parent_comment_id: parseInt(parentId) });
                const cd = await api('GET', `/variants/${variantId}/comments`);
                applyRefresh(cd.comments || []);
            } catch (err) { errEl.textContent = err.message; errEl.style.display = ''; postReply.disabled = false; }
        }

        const deleteBtn = e.target.closest('.delete-comment-btn');
        if (deleteBtn) {
            if (!confirm('Delete this comment?')) return;
            try {
                await api('DELETE', `/comments/${deleteBtn.dataset.id}`);
                const cd = await api('GET', `/variants/${variantId}/comments`);
                applyRefresh(cd.comments || []);
            } catch (err) { alert(err.message); }
        }
    }, { capture: false });
}

function openEditVariantModal(v) {
    openModal(`
        <div class="form-group"><label>Title</label><input type="text" id="edit-title" value="${esc(v.title)}"></div>
        <div class="form-group"><label>Rationale</label><textarea id="edit-rationale">${esc(v.rationale)}</textarea></div>
        <div class="form-group"><label>New text</label><textarea id="edit-newtext">${esc(v.new_text)}</textarea></div>
        <p id="edit-err" class="error-msg" style="display:none"></p>
        <div class="form-actions">
            <button id="save-edit-btn" class="btn btn-primary">Save</button>
            <button onclick="closeModal()" class="btn btn-ghost">Cancel</button>
        </div>
    `, 'Edit variant');

    document.getElementById('save-edit-btn').addEventListener('click', async () => {
        const errEl = document.getElementById('edit-err');
        errEl.style.display = 'none';
        try {
            await api('PATCH', `/variants/${v.id}`, {
                title: document.getElementById('edit-title').value.trim(),
                rationale: document.getElementById('edit-rationale').value.trim(),
                new_text: document.getElementById('edit-newtext').value,
            });
            closeModal();
            location.reload();
        } catch (err) { errEl.textContent = err.message; errEl.style.display = ''; }
    });
}

/* ===== View: Document Review ===== */
async function viewDocumentReview(docId) {
    if (!state.user) { location.hash = '#/login'; return; }
    const [docData, varData] = await Promise.all([
        api('GET', `/documents/${docId}`),
        api('GET', `/documents/${docId}/variants`).catch(() => ({ variants: [] })),
    ]);
    const doc = docData.document;
    if (doc.status !== 'voting' && doc.status !== 'final_voting') { location.hash = `#/documents/${docId}`; return; }
    const isFinalVoting = doc.status === 'final_voting';
    const rawV = varData.variants || [];
    const idOrder = Object.fromEntries([...rawV].sort((a, b) => a.id - b.id).map((v, i) => [v.id, i + 1]));
    let variants = rawV.map(v => ({ ...v, num: idOrder[v.id] }));
    const overlapCount = {};
    for (let i = 0; i < variants.length; i++)
        for (let j = i + 1; j < variants.length; j++) {
            const [a, b] = [variants[i], variants[j]];
            if (a.char_start < b.char_end && a.char_end > b.char_start) {
                overlapCount[a.id] = (overlapCount[a.id] || 0) + 1;
                overlapCount[b.id] = (overlapCount[b.id] || 0) + 1;
            }
        }
    let sortMode = 'line', hideZero = false, curPage = 1;
    const wrap = el('div', { class: 'review-layout' });
    const textPanel = el('div', { class: 'review-text-panel' });
    textPanel.innerHTML = `<div class="doc-text-header"><div><h2>${esc(doc.title)}</h2>${statusBadge(doc.status)}</div><a href="#/documents/${esc(String(docId))}" class="btn btn-ghost btn-sm">← Document</a></div><div class="doc-text-body" id="rdoc-lines"></div><div class="pagination" id="rdoc-pagination"></div>`;
    const propPanel = el('div', { class: 'review-proposals-panel' });
    propPanel.innerHTML = `<div class="review-toolbar"><strong>Proposals</strong><div class="flex gap-1">${!isFinalVoting ? `<a href="#/documents/${esc(String(docId))}/conflicts" class="btn btn-warning btn-sm">Resolve conflicts</a>` : `<span class="review-final-badge">Final voting</span><a href="#/documents/${esc(String(docId))}/final-vote" class="btn btn-success btn-sm">Voting walkthrough</a>`}<button id="rsort-line" class="btn btn-primary btn-sm">Line</button><button id="rsort-num" class="btn btn-ghost btn-sm">#</button><button id="rsort-votes" class="btn btn-ghost btn-sm">Votes</button><button id="rsort-conflicts" class="btn btn-ghost btn-sm">Conflicts</button><label style="font-size:.8125rem;display:flex;align-items:center;gap:.3rem"><input type="checkbox" id="rfilter-zero"> Hide 0-vote</label></div></div><div id="review-list"></div>`;
    wrap.append(textPanel, propPanel);
    setMain(wrap);

    async function loadPage(page) {
        const d = await api('GET', `/documents/${docId}/lines?page=${page}`);
        curPage = page;
        renderLines(document.getElementById('rdoc-lines'), d.lines || [], rawV);
        renderPagination(document.getElementById('rdoc-pagination'), page, doc.total_pages, docId);
    }

    function renderReviewList() {
        const list = document.getElementById('review-list');
        if (!list) return;
        let sorted = [...variants];
        if (hideZero) sorted = sorted.filter(v => v.votes_for + v.votes_against + v.votes_abstain > 0);
        if (sortMode === 'num') sorted.sort((a, b) => a.num - b.num);
        else if (sortMode === 'votes') sorted.sort((a, b) => (b.votes_for + b.votes_against + b.votes_abstain) - (a.votes_for + a.votes_against + a.votes_abstain));
        else if (sortMode === 'conflicts') sorted.sort((a, b) => (overlapCount[b.id] || 0) - (overlapCount[a.id] || 0));
        else sorted.sort((a, b) => a.char_start - b.char_start || a.id - b.id);
        list.innerHTML = '';
        if (!sorted.length) { list.innerHTML = '<div class="text-muted" style="padding:1.5rem">No proposals match filter.</div>'; return; }
        for (const v of sorted) {
            const oc = overlapCount[v.id] || 0;
            const suggestConflict = oc > 0 && v.status === 'pending';
            const isVoting = v.status === 'pending' && !suggestConflict;
            const card = el('div', { class: 'review-card' });
            const hasTally = v.final_yes != null || v.final_no != null;
            const tallyHtml = isFinalVoting && hasTally
                ? `<div class="review-final-tally">✓ ${v.final_yes ?? 0} &nbsp;✗ ${v.final_no ?? 0} &nbsp;◯ ${v.final_abstain ?? 0}</div>`
                : '';
            card.innerHTML = `<div class="review-card-header"><span class="variant-num">#${v.num}</span><span class="review-card-title">${esc(v.title || v.operation)}</span>${oc ? `<span class="review-overlap-badge">⊕${oc}</span>` : ''}</div><div class="text-muted review-card-meta">Lines ${esc(String(v.line_start || '?'))}–${esc(String(v.line_end || '?'))} · ${esc(v.operation)} · ▲${v.votes_for} ▼${v.votes_against}</div>${tallyHtml}<div class="review-actions"><button class="review-btn review-btn-voting${isVoting ? ' review-btn-active' : ''}" data-action="pending">VOTING</button><button class="review-btn review-btn-conflict${v.status === 'conflict' || suggestConflict ? ' review-btn-active' : ''}" data-action="conflict">CONFLICT</button><button class="review-btn review-btn-danger${v.status === 'rejected' ? ' review-btn-active' : ''}" data-action="rejected">NOT VOTING</button><button class="review-btn review-btn-danger${v.status === 'not_applicable' ? ' review-btn-active' : ''}" data-action="not_applicable">Not applicable</button><button class="review-btn review-btn-danger${v.status === 'withdrawn' ? ' review-btn-active' : ''}" data-action="withdrawn">Withdrawn</button></div>`;
            card.querySelectorAll('.review-btn').forEach(btn => btn.addEventListener('click', async () => {
                try {
                    const data = await api('PATCH', `/variants/${v.id}/review-status`, { status: btn.dataset.action });
                    const idx = variants.findIndex(x => x.id === v.id);
                    if (idx >= 0) variants[idx] = { ...variants[idx], ...data.variant };
                    renderReviewList();
                } catch (e) { showError(wrap, e.message); }
            }));
            list.append(card);
        }
    }

    wrap.addEventListener('click', async e => {
        const pb = e.target.closest('[data-page]');
        if (pb && !pb.disabled) { await loadPage(parseInt(pb.dataset.page)); return; }
        if (e.target.dataset.action === 'jump') {
            const inp = document.getElementById('page-jump-input');
            if (inp) await loadPage(parseInt(inp.value) || curPage);
        }
    });
    wrap.addEventListener('keydown', async e => {
        if (e.key === 'Enter' && e.target.id === 'page-jump-input') await loadPage(parseInt(e.target.value) || curPage);
    });

    ['line', 'num', 'votes', 'conflicts'].forEach(m => {
        const btn = document.getElementById(`rsort-${m}`);
        if (btn) btn.addEventListener('click', () => {
            sortMode = m;
            ['line', 'num', 'votes', 'conflicts'].forEach(k => { const b = document.getElementById(`rsort-${k}`); if (b) b.className = `btn btn-${k === m ? 'primary' : 'ghost'} btn-sm`; });
            renderReviewList();
        });
    });
    document.getElementById('rfilter-zero').addEventListener('change', e => { hideZero = e.target.checked; renderReviewList(); });

    await loadPage(1);
    renderReviewList();
}

/* ===== View: Activity ===== */
async function viewActivity() {
    if (!state.user) { location.hash = '#/login'; return; }
    await renderActivity(false);
}

async function renderActivity(mineOnly) {
    const url = mineOnly ? '/activity?mine=true' : '/activity';
    const data = await api('GET', url);
    const activity = data.activity || [];

    const wrap = el('div', { class: 'page-container' });
    const icons = { document_created: '📄', document_updated: '✏️', document_status_changed: '🔄', variant_proposed: '💡', variant_updated: '✏️', variant_withdrawn: '↩️', vote_cast: '🗳️', vote_changed: '🔁', vote_retracted: '↩️', comment_added: '💬', comment_updated: '✏️', user_invited: '👤', user_blocked: '🚫', user_unblocked: '✅', voting_scheduled: '⏱', voting_schedule_cancelled: '🚫' };

    wrap.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">Activity</h1>
            <div class="flex gap-1">
                <button id="act-all-btn" class="btn ${!mineOnly ? 'btn-primary' : 'btn-ghost'} btn-sm">All</button>
                <button id="act-mine-btn" class="btn ${mineOnly ? 'btn-primary' : 'btn-ghost'} btn-sm">Mine</button>
            </div>
        </div>
        ${activity.length === 0 ? '<div class="empty-state"><h3>No activity yet</h3><p>Start by creating or joining a document.</p></div>' :
            `<div class="activity-list">${activity.map(a => {
                let meta = {}; try { meta = JSON.parse(a.metadata || '{}'); } catch {}
                const extra = a.action === 'voting_scheduled' && meta.countdown_minutes != null
                    ? ` · <span class="text-muted">${esc(meta.countdown_minutes)} min countdown</span>`
                    : '';
                return `<div class="activity-item${a.action === 'voting_scheduled' ? ' activity-item-voting' : ''}">
                    <span class="activity-icon">${icons[a.action] || '•'}</span>
                    <div class="activity-body">
                        <strong>${esc(a.user_name || 'Unknown')}</strong> ${esc(a.action.replace(/_/g, ' '))}
                        ${a.document_title ? ` on <a href="#/documents/${esc(a.document_id)}">${esc(a.document_title)}</a>` : ''}
                        ${a.variant_id ? ` · <a href="#/variants/${esc(a.variant_id)}">view variant</a>` : ''}
                        ${extra}
                    </div>
                    <span class="activity-time">${timeAgo(a.created_at)}</span>
                </div>`;
            }).join('')}
            </div>`}
    `;
    state.activityUnread = 0;
    if (state.user) { const k = `act_seen_${state.user.id}`; localStorage.setItem(k, new Date().toISOString()); state.activitySeenTime = new Date().toISOString(); }
    updateHeader();
    setMain(wrap);

    document.getElementById('act-all-btn').addEventListener('click', () => renderActivity(false));
    document.getElementById('act-mine-btn').addEventListener('click', () => renderActivity(true));
}

/* ===== View: Profile ===== */
async function viewProfile() {
    if (!state.user) { location.hash = '#/login'; return; }

    const wrap = el('div', { class: 'profile-container' });
    wrap.innerHTML = `
        <h1 class="page-title mb-2">Profile</h1>
        <div class="card">
            <div class="form-group"><label>Email</label><input type="text" value="${esc(state.user.email)}" disabled></div>
            <div class="form-group"><label>Display name</label><input type="text" id="profile-name" value="${esc(state.user.display_name || '')}"></div>
            <div class="form-group"><label>Organization</label><input type="text" id="profile-org" value="${esc(state.user.organization || '')}"></div>
            <div class="form-group">
                <label><input type="checkbox" id="profile-nonsearchable" ${state.user.is_non_searchable ? 'checked' : ''}> Non-searchable profile — hide me from user search results</label>
            </div>
            <p id="profile-err" class="error-msg" style="display:none"></p>
            <p id="profile-ok" class="text-success" style="display:none">Saved!</p>
            <div class="form-actions">
                <button id="save-profile-btn" class="btn btn-primary">Save profile</button>
            </div>
        </div>
    `;
    setMain(wrap);

    document.getElementById('save-profile-btn').addEventListener('click', async () => {
        const errEl = document.getElementById('profile-err');
        const okEl = document.getElementById('profile-ok');
        errEl.style.display = 'none'; okEl.style.display = 'none';
        try {
            const d = await api('PATCH', '/auth/profile', { display_name: document.getElementById('profile-name').value.trim(), organization: document.getElementById('profile-org').value.trim(), is_non_searchable: document.getElementById('profile-nonsearchable').checked ? 1 : 0 });
            state.user = d.user; updateHeader(); okEl.style.display = '';
        } catch (err) { errEl.textContent = err.message; errEl.style.display = ''; }
    });
}

/* ===== Profile completion modal ===== */
function showProfileModal(onDone) {
    openModal(`<div class="form-group"><label>Email</label><input type="text" value="${esc(state.user.email)}" disabled></div>
        <div class="form-group"><label>Display name</label><input type="text" id="pm-name" value="${esc(state.user.display_name||'')}"></div>
        <div class="form-group"><label>Organization <span class="text-muted">(optional)</span></label><input type="text" id="pm-org" value="${esc(state.user.organization||'')}"></div>
        <div class="flex gap-1 mt-2"><button id="pm-skip" class="btn btn-ghost btn-sm">Skip for now</button><button id="pm-save" class="btn btn-primary btn-sm">Save and continue</button></div>`,
        'Complete your profile');
    document.getElementById('pm-skip').onclick = () => { closeModal(); onDone(); };
    document.getElementById('pm-save').onclick = async () => {
        try { const d = await api('PATCH', '/auth/profile', { display_name: document.getElementById('pm-name').value.trim(), organization: document.getElementById('pm-org').value.trim() }); state.user = d.user; updateHeader(); } catch {}
        closeModal(); onDone();
    };
}

/* ===== Init ===== */
document.getElementById('login-btn').addEventListener('click', () => { location.hash = '#/login'; });
document.getElementById('logout-btn').addEventListener('click', async () => { await api('POST', '/auth/logout'); state.user = null; updateHeader(); location.hash = '#/login'; });

(async function init() {
    try {
        const data = await api('GET', '/auth/me');
        state.user = data.user;
        state.config = data.config || {};
    } catch {}
    updateHeader();
    window.addEventListener('hashchange', () => router());
    await router();
    if (state.user) {
        const seenKey = `act_seen_${state.user.id}`;
        state.activitySeenTime = localStorage.getItem(seenKey) || new Date().toISOString();
        try {
            const data = await api('GET', '/activity');
            state.lastActivityTime = (data.activity && data.activity[0]) ? data.activity[0].created_at : new Date().toISOString();
            state.activityUnread = (data.activity || []).filter(e => e.created_at > state.activitySeenTime).length;
            updateHeader();
        } catch {}
        setInterval(pollActivity, 30000);
    }
})();

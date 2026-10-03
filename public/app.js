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
const ACCESS_LEVELS = ['viewer', 'commenter', 'proposer', 'voter', 'supervisor', 'editor', 'admin'];

function hasLevel(doc, minLevel) {
    return !!(doc && doc.my_access_level) && ACCESS_LEVELS.indexOf(doc.my_access_level) >= ACCESS_LEVELS.indexOf(minLevel);
}

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
    if (res.status === 401 && state.user) {
        state.user = null;
        updateHeader();
        closeModal();
        location.hash = '#/login';
    }
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
                    const docLabel = e.document_title || 'a document';
                    const msg = `⏱ Voting for "${docLabel}" opens in ${mins} minute${mins !== 1 ? 's' : ''}`;
                    showToast(msg, e.document_id, dismissSecs);
                }
            }
        }
        state.lastActivityTime = newest;
        if (state.activitySeenTime) { state.activityUnread = events.filter(e => e.created_at > state.activitySeenTime && e.user_id !== state.user.id).length; updateHeader(); }
    } catch {}
}

/* ===== Modal ===== */
function openModal(contentHtml, title = '') {
    const overlay = document.getElementById('modal-overlay');
    // Fresh node per modal: listeners a previous modal attached to the content must not fire for this one
    const content = document.getElementById('modal-content').cloneNode(false);
    document.getElementById('modal-content').replaceWith(content);
    content.innerHTML = title ? `<div class="modal-title">${esc(title)}</div>${contentHtml}` : contentHtml;
    overlay.classList.remove('hidden');
    document.getElementById('modal-close').onclick = closeModal;
    overlay.onclick = e => { if (e.target === overlay) closeModal(); };
    content.addEventListener('click', e => { if (e.target.closest('.modal-cancel')) closeModal(); });
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
    const usersLink = document.getElementById('nav-users-link');
    if (usersLink) usersLink.classList.toggle('hidden', !(state.user && state.user.role === 'superadmin'));
}

/* ===== Router ===== */
const routes = [
    [/^#\/login$/, () => viewLogin()],
    [/^#\/documents$/, viewDocumentList],
    [/^#\/documents\/(\d+)\/conflicts$/, params => viewConflictResolution(params[1])],
    [/^#\/documents\/(\d+)\/final-vote$/, params => viewFinalVoting(params[1])],
    [/^#\/documents\/(\d+)\/resolved-text$/, params => viewResolvedText(params[1])],
    [/^#\/documents\/(\d+)\/review$/, params => viewDocumentReview(params[1])],
    [/^#\/documents\/(\d+)\/moderation$/, params => viewModeration(params[1])],
    [/^#\/admin\/users$/, () => viewUserAdmin()],
    [/^#\/documents\/(\d+)$/, params => viewDocument(params[1])],
    [/^#\/variants\/(\d+)$/, params => viewVariant(params[1])],
    [/^#\/activity$/, viewActivity],
    [/^#\/profile$/, () => viewProfile()],
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

// Serialise navigations: a new route waits for the previous handler to finish,
// so a still-running view cannot replace the DOM out from under the next one.
let routerQueue = Promise.resolve();
function runRoute() {
    routerQueue = routerQueue.then(router);
    return routerQueue;
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
            <button class="btn btn-ghost modal-cancel">Cancel</button>
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
    const variants = rawVariants;

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

    let currentPage = 1;

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
                ${(doc.status === 'voting' || doc.status === 'final_voting') && hasLevel(doc, 'supervisor') ? `<a href="#/documents/${esc(String(docId))}/review" class="btn btn-primary btn-sm">Review</a>` : ''}${(['resolved', 'archived'].includes(doc.status) && state.user) || (doc.status === 'final_voting' && hasLevel(doc, 'supervisor')) ? `<a href="#/documents/${esc(String(docId))}/resolved-text" class="btn btn-ghost btn-sm">Resolved text</a>` : ''}
                ${hasLevel(doc, 'editor') ? `<button class="btn btn-ghost btn-sm" id="doc-settings-btn">Settings</button>` : ''}
                ${doc.owner_id === (state.user && state.user.id) ? `<button class="btn btn-ghost btn-sm" id="doc-copy-btn">Copy</button>` : ''}
                ${hasLevel(doc, 'supervisor') ? `<button class="btn btn-ghost btn-sm" id="doc-status-btn">Change status</button>` : ''}
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
            ${hasLevel(doc, 'supervisor') ? `<button class="btn btn-ghost btn-sm mt-2" id="access-btn">Manage access</button> <a href="#/documents/${esc(String(docId))}/moderation" class="btn btn-ghost btn-sm mt-2">Moderation</a>` : ''}
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
                ${hasLevel(doc, 'proposer') && !['resolved', 'archived'].includes(doc.status) ? `<button class="btn btn-primary btn-sm" id="propose-btn">Propose</button>` : ''}
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
        const canCancel = hasLevel(doc, 'supervisor');
        const banner = el('div', { class: 'voting-banner', id: 'voting-banner' });
        banner.innerHTML = `<span id="voting-banner-countdown"></span>${canCancel ? '<button class="btn btn-ghost btn-sm" id="voting-banner-cancel">Cancel</button>' : ''}`;
        textPanel.querySelector('.doc-text-header').insertAdjacentElement('afterend', banner);

        function tickBanner() {
            const countdown = document.getElementById('voting-banner-countdown');
            if (!countdown) return;
            const remaining = scheduledMs - Date.now();
            if (remaining <= 0) {
                // The server flips the status on its own clock — poll it instead of reloading in a loop
                clearInterval(state.votingBannerInterval);
                countdown.textContent = '⏱ Voting is opening…';
                state.votingBannerInterval = setInterval(async () => {
                    try { const d = await api('GET', `/documents/${docId}`); if (d.document.status !== 'open' || !d.document.voting_scheduled_at) location.reload(); } catch {}
                }, 5000);
                return;
            }
            const totalMins = Math.floor(remaining / 60000);
            const secs = Math.floor((remaining % 60000) / 1000);
            const hrs = Math.floor(totalMins / 60);
            const mins = totalMins % 60;
            const display = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}:${String(secs).padStart(2, '0')}`;
            countdown.textContent = `⏱ Voting opens in ${display}`;
        }
        tickBanner();
        state.votingBannerInterval = setInterval(tickBanner, 1000);

        if (canCancel) {
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

        variantsList.addEventListener('keydown', e => {
            const card = e.target.closest('.variant-card[data-id]');
            if (card && e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); location.hash = `#/variants/${card.dataset.id}`; }
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
        if (lineEl && window.getSelection().isCollapsed) location.hash = `#/variants/${lineEl.dataset.variantId}`;
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
    const captureSelection = () => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || !linesContainer.contains(sel.anchorNode)) return;
        if (sel.isCollapsed || !sel.toString().trim()) { pendingSelection = null; return; }
        const anchor = resolveSelectionOffset(sel.anchorNode, sel.anchorOffset);
        let focus = resolveSelectionOffset(sel.focusNode, sel.focusOffset);
        if (focus === null && !linesContainer.contains(sel.focusNode)) {
            // Dragged past the text panel: clamp to the first or last line on the page
            const lines = linesContainer.querySelectorAll('.line-text');
            const forward = sel.anchorNode.compareDocumentPosition(sel.focusNode) & Node.DOCUMENT_POSITION_FOLLOWING;
            focus = lines.length ? parseInt(forward ? lines[lines.length - 1].dataset.charEnd : lines[0].dataset.charStart) : null;
        }
        if (anchor === null || focus === null) { pendingSelection = null; return; }
        const text = sel.toString().replace(/\n+$/, '');
        const charStart = Math.min(anchor, focus);
        const charEnd = Math.min(Math.max(anchor, focus), charStart + text.length);
        if (charStart >= charEnd) { pendingSelection = null; return; }
        pendingSelection = { char_start: charStart, char_end: charEnd, text };
    };
    if (state.selectionListener) document.removeEventListener('selectionchange', state.selectionListener);
    state.selectionListener = captureSelection;
    document.addEventListener('selectionchange', captureSelection);
    linesContainer.addEventListener('mouseup', captureSelection);

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
        if (firstVariant) {
            textEl.dataset.variantId = firstVariant.id;
            textEl.title = `Proposal${overlapping.length > 1 ? 's' : ''} ${overlapping.map(x => '#' + x.proposal_num).join(', ')}`;
        }

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
        <div class="variant-card" tabindex="0" data-id="${esc(v.id)}" data-char-start="${esc(v.char_start)}" data-char-end="${esc(v.char_end)}" data-line-start="${esc(v.line_start ?? '')}">
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
        <div class="form-group">
            <label>Majority required for proposals
                <select id="s-threshold">
                    <option value="">Simple majority (default)</option>
                    <option value="simple">Simple majority</option>
                    <option value="absolute">Absolute majority</option>
                    <option value="two_thirds">⅔ majority</option>
                    <option value="three_quarters">¾ majority</option>
                </select>
            </label>
        </div>
        <p id="settings-err" class="error-msg" style="display:none"></p>
        <div class="form-actions">
            <button id="save-settings" class="btn btn-primary">Save</button>
            <button class="btn btn-ghost modal-cancel">Cancel</button>
            ${state.user && doc.owner_id === state.user.id ? '<span class="row-actions" style="margin-left:auto"><button id="delete-doc-btn" class="btn btn-danger btn-sm">Delete document</button></span>' : ''}
        </div>
    `, 'Document settings');

    const deleteBtn = document.getElementById('delete-doc-btn');
    if (deleteBtn) deleteBtn.addEventListener('click', () => {
        const actions = deleteBtn.closest('.row-actions');
        actions.innerHTML = '<span class="text-muted" style="font-size:.8rem">Delete this document and all its proposals?</span> <button id="delete-doc-ok" class="btn btn-danger btn-sm">OK</button> <button class="btn btn-ghost btn-sm modal-cancel">Cancel</button>';
        document.getElementById('delete-doc-ok').addEventListener('click', async () => {
            try { await api('DELETE', `/documents/${doc.id}`); closeModal(); location.hash = '#/documents'; }
            catch (err) { const errEl = document.getElementById('settings-err'); errEl.textContent = err.message; errEl.style.display = ''; }
        });
    });

    document.getElementById('s-threshold').value = settings.majority_threshold || '';

    document.getElementById('save-settings').addEventListener('click', async () => {
        const errEl = document.getElementById('settings-err');
        errEl.style.display = 'none';
        const thresholdVal = document.getElementById('s-threshold').value || null;
        try {
            await api('PATCH', `/documents/${doc.id}`, {
                title: document.getElementById('s-title').value.trim(),
                description: document.getElementById('s-desc').value.trim(),
                settings: { allow_anonymous_view: document.getElementById('s-anon').checked, majority_threshold: thresholdVal },
            });
            closeModal();
            location.reload();
        } catch (err) { errEl.textContent = err.message; errEl.style.display = ''; }
    });
}

function openStatusModal(doc) {
    const transitions = { draft: ['open'], open: ['voting', 'draft'], voting: ['resolved', 'open'], final_voting: ['voting', 'resolved'], resolved: ['archived'], archived: [] };
    const supervisorTransitions = { open: ['voting'], voting: [], final_voting: ['voting', 'resolved'] };
    const allowed = (hasLevel(doc, 'admin') ? transitions[doc.status] : supervisorTransitions[doc.status]) || [];
    if (!allowed.length && !(doc.voting_scheduled_at && doc.status === 'open')) {
        const hint = doc.status === 'voting' ? ' Use Review → Resolve conflicts → Ready for final voting to move on.' : '';
        openModal(`<p>No status change available here for <strong>${esc(doc.status)}</strong>.${esc(hint)}</p>`, 'Document status');
        return;
    }

    const defaultMins = (state.config && state.config.voting_countdown_default_minutes) || 5;
    const hasSchedule = !!(doc.voting_scheduled_at && doc.status === 'open');

    const cancelBanner = hasSchedule
        ? `<div class="voting-schedule-notice">⏱ Voting already scheduled — <button class="btn btn-ghost btn-sm" id="cancel-schedule-btn">Cancel schedule</button></div>`
        : '';

    const otherBtns = allowed
        .filter(s => s !== 'voting' || doc.status !== 'open')
        .map(s => `<button class="btn btn-ghost mb-1" style="width:100%" data-status="${esc(s)}">${esc(s)}</button>`)
        .join('');

    const votingSection = allowed.includes('voting') && doc.status === 'open' ? `
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

function resolveSelectionOffset(node, nodeOffset) {
    if (node.nodeType !== Node.TEXT_NODE) {
        // Element-anchored selection (triple-click, keyboard): the offset is a child index,
        // so the point is the start of that child or the end of the one before it
        const after = node.childNodes[nodeOffset];
        const before = node.childNodes[nodeOffset - 1];
        const target = after || before || node;
        const holder = target.nodeType === Node.TEXT_NODE ? target.parentElement : target;
        const lt = holder.closest('.line-text') || holder.querySelector('.line-text') || (holder.closest('.doc-line') || holder).querySelector?.('.line-text');
        if (!lt) return null;
        const edge = after ? 'charStart' : 'charEnd';
        const v = parseInt(lt.dataset[edge]);
        return isNaN(v) ? null : v;
    }
    const lineTextEl = node.parentElement.closest('.line-text');
    if (lineTextEl) {
        const cs = parseInt(lineTextEl.dataset.charStart);
        return isNaN(cs) ? null : cs + nodeOffset;
    }
    const lineEl = node.parentElement.closest('.doc-line');
    const lt = lineEl && lineEl.querySelector('.line-text');
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
            <button class="btn btn-ghost modal-cancel">Cancel</button>
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
    state.commentAuthorId = v.proposed_by;

    // Fetch doc, all doc variants, comments, votes in parallel
    const [docData, allVariantsData, commentData, voteData, relData] = await Promise.all([
        api('GET', `/documents/${v.document_id}`).catch(() => null),
        api('GET', `/documents/${v.document_id}/variants`).catch(() => ({ variants: [] })),
        api('GET', `/variants/${variantId}/comments`).catch(() => ({ comments: [] })),
        api('GET', `/variants/${variantId}/votes`).catch(() => ({ votes: [], tallies: {} })),
        api('GET', `/variants/${variantId}/relations`).catch(() => ({ relations: [] })),
    ]);

    const doc = docData && docData.document;
    state.canModerate = !!(state.user && doc && ['supervisor', 'editor', 'admin'].includes(doc.my_access_level));
    state.canComment = hasLevel(doc, 'commenter');
    if (!state.user && !doc) {
        setMain(`<div class="page-container"><div class="card"><h1>${esc(v.title||'Proposal')}</h1>${v.rationale?`<p style="border-left:3px solid var(--color-border);padding:.5rem .75rem;font-style:italic">${esc(v.rationale)}</p>`:''}<div class="diff-block">${renderDiff(v,null)}</div><p class="text-muted mt-2"><a href="#/login">Log in</a> to view the full document and other proposals.</p></div></div>`);
        return;
    }
    const rawVariants = allVariantsData.variants || [];
    const proposalNum = v.proposal_num;

    // Document-position order (same as sidebar listing) for prev/next
    const docOrdered = [...rawVariants].sort((a, b) =>
        a.char_start !== b.char_start ? a.char_start - b.char_start : new Date(a.created_at) - new Date(b.created_at)
    );
    const posIdx = docOrdered.findIndex(vv => vv.id === variantId);
    const prevV = posIdx > 0 ? docOrdered[posIdx - 1] : null;
    const nextV = posIdx < docOrdered.length - 1 ? docOrdered[posIdx + 1] : null;

    // Page + line for back-to-document jump
    const thisInList = rawVariants.find(vv => vv.id === variantId);
    const lineStart = thisInList ? thisInList.line_start : null;
    let parsedSettings = {};
    try { parsedSettings = doc ? (typeof doc.settings === 'object' ? doc.settings : JSON.parse(doc.settings || '{}')) : {}; } catch {}
    const linesPerPage = parsedSettings.lines_per_page || 30;
    const jumpPage = lineStart
        ? Math.ceil(lineStart / linesPerPage)
        : Math.max(1, Math.ceil((v.char_start / Math.max((doc && doc.total_chars) || 1, 1)) * ((doc && doc.total_pages) || 1)));

    // Make sure every page the proposal touches is cached, then cut the original text out of it
    let originalText = null;
    if (doc) {
        state.docLines[v.document_id] = state.docLines[v.document_id] || {};
        const lastPage = thisInList && thisInList.line_end ? Math.ceil(thisInList.line_end / linesPerPage) : jumpPage;
        for (let p = jumpPage; p <= Math.max(jumpPage, lastPage); p++) {
            if (state.docLines[v.document_id][p]) continue;
            try { state.docLines[v.document_id][p] = (await api('GET', `/documents/${v.document_id}/lines?page=${p}`)).lines; } catch {}
        }
        originalText = extractTextRange(Object.values(state.docLines[v.document_id]).flat(), v.char_start, v.char_end);
    }

    const affectedLines = Object.values(state.docLines[v.document_id] || {}).flat()
        .filter(l => l.char_offset_start < v.char_end && l.char_offset_end > v.char_start)
        .sort((a, b) => a.line_num - b.line_num);

    const myVoteRecord = state.user ? voteData.votes.find(vt => vt.user_id === state.user.id) : null;
    const myVote = myVoteRecord != null ? myVoteRecord.vote_value : undefined;

    const wrap = el('div', { class: 'variant-layout' });

    const canFork = !['withdrawn', 'rejected', 'not_applicable', 'merged'].includes(v.status) &&
        (doc && doc.status === 'open' ? hasLevel(doc, 'proposer') : ['voting', 'final_voting'].includes(doc && doc.status) && hasLevel(doc, 'supervisor'));
    const canVote = hasLevel(doc, 'voter') && ['draft', 'open', 'voting'].includes(doc.status);
    const voteNote = !state.user ? 'Log in to vote' : canVote ? '' : (hasLevel(doc, 'voter') ? 'Voting on proposals is closed' : 'Voter access is required to vote');
    const numOf = id => { const m = rawVariants.find(x => x.id === id); return m ? `#${m.proposal_num}` : ''; };
    const basedOn = (relData.relations || []).filter(r => r.relation_type === 'based_on' && r.from_variant_id === variantId);
    const forks = (relData.relations || []).filter(r => r.relation_type === 'based_on' && r.to_variant_id === variantId);
    const relationLine = [
        ...basedOn.map(r => `based on <a href="#/variants/${esc(r.to_variant_id)}">${esc(numOf(r.to_variant_id))} ${esc(r.to_title || 'proposal')}</a>`),
        ...forks.map(r => `forked as <a href="#/variants/${esc(r.from_variant_id)}">${esc(numOf(r.from_variant_id))} ${esc(r.from_title || 'proposal')}</a>`),
    ].join(' · ');

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
                <div class="flex gap-1 items-center">${statusBadge(v.status)}<button id="share-variant-btn" class="btn btn-ghost btn-sm">Share</button>${canFork ? '<button id="fork-variant-btn" class="btn btn-ghost btn-sm">Fork</button>' : ''}${state.canModerate ? (v.is_hidden ? '<button id="mod-unhide-btn" class="btn btn-ghost btn-sm">Unhide</button>' : '<button id="mod-hide-btn" class="btn btn-ghost btn-sm">Hide</button>') : ''}</div>
            </div>
            ${v.is_hidden ? '<div class="alert alert-error">Hidden by moderator — participants cannot see this proposal.</div>' : ''}
            ${v.title ? `<p style="font-size:1rem;font-weight:600;margin-bottom:0.5rem">${esc(v.title)}</p>` : ''}
            <p class="text-muted mb-2">
                ${esc(v.operation)} · ${v.operation === 'insert' ? `char ${esc(v.char_start)}` : `chars ${esc(v.char_start)}–${esc(v.char_end)}`} ·
                proposed by <strong>${esc(v.proposer_name)}</strong> · ${timeAgo(v.created_at)}
            </p>
            ${relationLine ? `<p class="text-muted mb-2" id="variant-relations">${relationLine}</p>` : ''}
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

            ${state.user && v.proposed_by === state.user.id && v.status === 'pending' && doc && ['draft', 'open'].includes(doc.status) ? `
                <div class="flex gap-1 mt-2">
                    <button id="edit-variant-btn" class="btn btn-ghost btn-sm">Edit</button>
                    <button id="withdraw-variant-btn" class="btn btn-danger btn-sm">Withdraw</button>
                </div>` : ''}
        </div>

        <div class="card" id="vote-card">
            <div class="sidebar-header" style="margin:-1.25rem -1.25rem 1rem;padding:.875rem 1.25rem;background:var(--color-bg-secondary);border-bottom:1px solid var(--color-border);border-radius:12px 12px 0 0">
                Votes
            </div>
            ${renderVoteSection(v, myVote, canVote, voteNote)}
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
                ${renderCommentThread(commentData.comments || [], v.id, 'chrono', v.proposed_by)}
            </div>
            ${hasLevel(doc, 'commenter') ? `
                <div class="mt-2" id="comment-form">
                    <textarea id="comment-text" class="comment-form" placeholder="Add a comment…"></textarea>
                    <div class="flex gap-1 mt-1">
                        <button id="post-comment-btn" class="btn btn-primary btn-sm">Post comment</button>
                    </div>
                    <p id="comment-err" class="error-msg" style="display:none"></p>
                </div>` : `<p class="text-muted mt-2">${state.user ? 'Commenter access is required to post.' : 'Log in to comment.'}</p>`}
        </div>
    `;

    setMain(wrap);

    // Moderation hide/unhide (supervisor+)
    const modHideBtn = document.getElementById('mod-hide-btn');
    if (modHideBtn) modHideBtn.addEventListener('click', async () => {
        if (!confirm('Hide this proposal from all participants?')) return;
        try { await api('POST', `/variants/${variantId}/hide`); runRoute(); } catch (err) { alert(err.message); }
    });
    const modUnhideBtn = document.getElementById('mod-unhide-btn');
    if (modUnhideBtn) modUnhideBtn.addEventListener('click', async () => {
        try { await api('POST', `/variants/${variantId}/unhide`); runRoute(); } catch (err) { alert(err.message); }
    });

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

    // Fork button
    if (canFork) {
        document.getElementById('fork-variant-btn').addEventListener('click', () => {
            const defaultTitle = `Your variant of ${v.title || v.operation}`;
            openModal(`
                <div class="form-group"><label>Title</label><input type="text" id="fork-title" value="${esc(defaultTitle)}"></div>
                <div class="form-group"><label>Proposed text</label><textarea id="fork-text" class="comment-form" rows="4"></textarea></div>
                <div class="form-group"><label>Rationale</label><textarea id="fork-rationale" class="comment-form" rows="2" placeholder="Why does this variant differ?"></textarea></div>
                <p id="fork-err" class="error-msg" style="display:none"></p>
                <div class="form-actions">
                    <button id="fork-submit-btn" class="btn btn-primary">Submit fork</button>
                    <button class="btn btn-ghost modal-cancel">Cancel</button>
                </div>
            `, 'Fork proposal');
            document.getElementById('fork-text').value = v.new_text;
            document.getElementById('fork-submit-btn').addEventListener('click', async () => {
                const errEl = document.getElementById('fork-err');
                errEl.style.display = 'none';
                try {
                    const d = await api('POST', `/variants/${variantId}/fork`, {
                        title: document.getElementById('fork-title').value.trim(),
                        new_text: document.getElementById('fork-text').value,
                        rationale: document.getElementById('fork-rationale').value.trim(),
                    });
                    closeModal();
                    location.hash = `#/variants/${d.variant.id}`;
                } catch (e) { errEl.textContent = e.message; errEl.style.display = ''; }
            });
        });
    }

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

    // Vote buttons — clicking the active vote again retracts it
    const voteCard = document.getElementById('vote-card');
    let currentVote = myVote;
    voteCard.addEventListener('click', async e => {
        const btn = e.target.closest('.vote-btn[data-value]');
        if (!btn || !state.user) return;
        const value = parseInt(btn.dataset.value);
        try {
            let tallies;
            if (currentVote === value) {
                await api('DELETE', `/variants/${variantId}/vote`);
                const d = await api('GET', `/variants/${variantId}/votes`);
                tallies = d.tallies;
                currentVote = undefined;
            } else {
                const result = await api('POST', `/variants/${variantId}/vote`, { vote_value: value });
                tallies = result.tallies;
                currentVote = value;
            }
            v.votes_for = tallies.votes_for;
            v.votes_against = tallies.votes_against;
            v.votes_abstain = tallies.votes_abstain;
            voteCard.innerHTML = `
                <div class="sidebar-header" style="margin:-1.25rem -1.25rem 1rem;padding:.875rem 1.25rem;background:var(--color-bg-secondary);border-bottom:1px solid var(--color-border);border-radius:12px 12px 0 0">Votes</div>
                ${renderVoteSection(v, currentVote, canVote, voteNote)}`;
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
    return `${originalText ? `<div class="diff-del">${esc(originalText)}</div>` : `<div class="diff-del">${esc(`[${v.char_end - v.char_start} chars at position ${v.char_start}]`)}</div>`}
            ${v.new_text ? `<div class="diff-ins">${esc(v.new_text)}</div>` : ''}`;
}

function renderVoteSection(v, myVote, canVote = true, note = '') {
    const isFor = myVote === 1;
    const isAgainst = myVote === -1;
    const isAbstain = myVote === 0;
    const dis = canVote ? '' : ' disabled';
    return `
        <div class="vote-section">
            <button class="vote-btn ${isFor ? 'active-for' : ''}" data-value="1"${dis}>▲ For <strong>${esc(v.votes_for)}</strong></button>
            <button class="vote-btn ${isAgainst ? 'active-against' : ''}" data-value="-1"${dis}>▼ Against <strong>${esc(v.votes_against)}</strong></button>
            <button class="vote-btn ${isAbstain ? 'active-abstain' : ''}" data-value="0"${dis}>◆ Abstain <strong>${esc(v.votes_abstain)}</strong></button>
            ${note ? `<span class="text-muted">${esc(note)}</span>` : ''}
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
    const editWindowMs = ((state.config && state.config.comment_edit_window_minutes) || 30) * 60000;
    const inWindow = t => !!t && (Date.now() - new Date(t).getTime()) < editWindowMs;

    function renderOne(c, isReply, parentEditedAt) {
        const cls = isReply ? 'reply' : 'comment';
        if (c.is_hidden) {
            return `<div class="${cls}" id="comment-${esc(c.id)}">
                <div class="comment-text text-muted"><em>Comment hidden by moderator</em>${state.canModerate && c.author_name ? ` — ${esc(c.author_name)}: ${esc(c.text)}` : ''}</div>
                ${state.canModerate ? `<div class="comment-actions"><button class="btn btn-ghost btn-sm unhide-comment-btn" data-id="${esc(c.id)}">Unhide</button></div>` : ''}
                ${!isReply && c.replies && c.replies.length ? `<div class="comment-replies">${c.replies.map(r => renderOne(r, true, c.edited_at)).join('')}</div>` : ''}
            </div>`;
        }
        const isMine = state.user && c.user_id === state.user.id;
        const canDelete = isMine;
        const canEdit = isMine && (inWindow(c.created_at) || (isReply && inWindow(parentEditedAt)));
        const canHide = state.canModerate && state.user && c.user_id !== state.user.id;
        const parentEditedLater = isReply && parentEditedAt && parentEditedAt > c.created_at;
        return `<div class="${cls}" id="comment-${esc(c.id)}">
            <div class="comment-header">
                <span class="comment-author">${esc(c.author_name)}</span>
                <span class="comment-time">${timeAgo(c.created_at)}${c.edited_at ? ` <span title="${esc(c.edited_at)}">· edited ${timeAgo(c.edited_at)}</span>` : ''}</span>
            </div>
            <div class="comment-text">${esc(c.text)}</div>
            ${parentEditedLater ? `<div class="comment-time" style="font-style:italic">parent comment was edited</div>` : ''}
            ${state.user && ((!isReply && state.canComment) || canDelete || canEdit || canHide) ? `<div class="comment-actions">
                ${!isReply && state.canComment ? `<button class="btn btn-ghost btn-sm reply-btn" data-parent="${esc(c.id)}">Reply</button>` : ''}
                ${canEdit ? `<button class="btn btn-ghost btn-sm edit-comment-btn" data-id="${esc(c.id)}">Edit</button>` : ''}
                ${canDelete ? `<button class="btn btn-ghost btn-sm delete-comment-btn" data-id="${esc(c.id)}">Delete</button>` : ''}
                ${canHide ? `<button class="btn btn-ghost btn-sm hide-comment-btn" data-id="${esc(c.id)}">Hide</button>` : ''}
            </div>` : ''}
            ${!isReply && c.replies && c.replies.length ? `<div class="comment-replies">${c.replies.map(r => renderOne(r, true, c.edited_at)).join('')}</div>` : ''}
        </div>`;
    }
    return `<div class="comment-thread">` + top.map(c => renderOne(c, false)).join('') + `</div>`;
}

function wireCommentActions(variantId) {
    const thread = document.getElementById('comment-thread');
    if (!thread || thread.dataset.wired) return;
    thread.dataset.wired = '1';

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

        const editBtn = e.target.closest('.edit-comment-btn');
        if (editBtn) {
            const id = editBtn.dataset.id;
            const existing = document.getElementById(`edit-form-${id}`);
            if (existing) { existing.remove(); return; }
            const commentEl = document.getElementById(`comment-${id}`);
            const textEl = commentEl.querySelector('.comment-text');
            const form = el('div', { id: `edit-form-${id}`, style: 'margin-top:.5rem' });
            form.innerHTML = `
                <textarea style="width:100%;min-height:60px;border:1px solid var(--color-border);border-radius:var(--radius);padding:.5rem;font-family:var(--font-sans);font-size:.875rem"></textarea>
                <div class="flex gap-1 mt-1">
                    <button class="btn btn-primary btn-sm save-edit-comment-btn" data-id="${esc(id)}">Save</button>
                    <button class="btn btn-ghost btn-sm cancel-edit-comment-btn" data-id="${esc(id)}">Cancel</button>
                </div>
                <p class="edit-comment-err error-msg" style="display:none"></p>
            `;
            form.querySelector('textarea').value = textEl.textContent;
            textEl.after(form);
            form.querySelector('textarea').focus();
        }

        const cancelEdit = e.target.closest('.cancel-edit-comment-btn');
        if (cancelEdit) {
            document.getElementById(`edit-form-${cancelEdit.dataset.id}`).remove();
        }

        const saveEdit = e.target.closest('.save-edit-comment-btn');
        if (saveEdit) {
            const id = saveEdit.dataset.id;
            const form = document.getElementById(`edit-form-${id}`);
            const text = form.querySelector('textarea').value.trim();
            const errEl = form.querySelector('.edit-comment-err');
            if (!text) { errEl.textContent = 'Text required'; errEl.style.display = ''; return; }
            saveEdit.disabled = true;
            try {
                await api('PATCH', `/comments/${id}`, { text });
                const cd = await api('GET', `/variants/${variantId}/comments`);
                applyRefresh(cd.comments || []);
            } catch (err) { errEl.textContent = err.message; errEl.style.display = ''; saveEdit.disabled = false; }
        }

        const hideCBtn = e.target.closest('.hide-comment-btn');
        if (hideCBtn) {
            if (!confirm('Hide this comment for all participants?')) return;
            try {
                await api('POST', `/comments/${hideCBtn.dataset.id}/hide`);
                const cd = await api('GET', `/variants/${variantId}/comments`);
                applyRefresh(cd.comments || []);
            } catch (err) { alert(err.message); }
        }

        const unhideCBtn = e.target.closest('.unhide-comment-btn');
        if (unhideCBtn) {
            try {
                await api('POST', `/comments/${unhideCBtn.dataset.id}/unhide`);
                const cd = await api('GET', `/variants/${variantId}/comments`);
                applyRefresh(cd.comments || []);
            } catch (err) { alert(err.message); }
        }
    }, { capture: false });
}

function openEditVariantModal(v) {
    openModal(`
        <div class="form-group"><label>Title</label><input type="text" id="edit-title" value="${esc(v.title)}"></div>
        <div class="form-group"><label>Rationale</label><textarea id="edit-rationale"></textarea></div>
        <div class="form-group"><label>New text</label><textarea id="edit-newtext"></textarea></div>
        <p id="edit-err" class="error-msg" style="display:none"></p>
        <div class="form-actions">
            <button id="save-edit-btn" class="btn btn-primary">Save</button>
            <button class="btn btn-ghost modal-cancel">Cancel</button>
        </div>
    `, 'Edit variant');
    document.getElementById('edit-rationale').value = v.rationale || '';
    document.getElementById('edit-newtext').value = v.new_text || '';

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
    const icons = { document_created: '📄', document_updated: '✏️', document_status_changed: '🔄', variant_proposed: '💡', variant_updated: '✏️', variant_withdrawn: '↩️', vote_cast: '🗳️', vote_changed: '🔁', vote_retracted: '↩️', comment_added: '💬', comment_updated: '✏️', user_invited: '👤', user_blocked: '🚫', user_unblocked: '✅', voting_scheduled: '⏱', voting_schedule_cancelled: '🚫', variant_threshold_changed: '⚖️', variant_hidden: '🙈', variant_unhidden: '👁️', comment_hidden: '🙈', comment_unhidden: '👁️', user_protected: '🛡️', user_unprotected: '🛡️', document_deleted: '🗑️', document_data_copied: '📋', user_access_changed: '🔑', user_access_removed: '🚪', variant_share_changed: '🔗', variant_relation_added: '🧷', comment_deleted: '🗑️' };

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

/* ===== Init ===== */
document.getElementById('login-btn').addEventListener('click', () => { location.hash = '#/login'; });
document.getElementById('logout-btn').addEventListener('click', async () => { await api('POST', '/auth/logout'); state.user = null; updateHeader(); location.hash = '#/login'; });

// Called at boot and again after an in-tab login: loads config, the unread badge and starts polling
async function startSession() {
    if (!state.user) return;
    try { state.config = (await api('GET', '/auth/me')).config || {}; } catch {}
    state.activitySeenTime = localStorage.getItem(`act_seen_${state.user.id}`) || new Date().toISOString();
    try {
        const data = await api('GET', '/activity');
        state.lastActivityTime = (data.activity && data.activity[0]) ? data.activity[0].created_at : new Date().toISOString();
        state.activityUnread = (data.activity || []).filter(e => e.created_at > state.activitySeenTime && e.user_id !== state.user.id).length;
        updateHeader();
    } catch {}
    if (!state.pollTimer) state.pollTimer = setInterval(pollActivity, 30000);
}

async function init() {
    try {
        const data = await api('GET', '/auth/me');
        state.user = data.user;
        state.config = data.config || {};
    } catch {}
    updateHeader();
    window.addEventListener('hashchange', () => runRoute());
    await runRoute();
    await startSession();
}

// Defer boot until DOMContentLoaded so auth.js/review.js are guaranteed to have
// executed before the first route runs — avoids a race on fast /auth/me.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

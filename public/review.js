'use strict';

/* ===== Shared helpers ===== */

const THRESHOLD_LABELS = { simple: 'Simple', absolute: 'Absolute', two_thirds: '⅔ majority', three_quarters: '¾ majority' };

function passesThreshold(yes, no, abstain, threshold) {
    yes = yes || 0; no = no || 0; abstain = abstain || 0;
    const total = yes + no + abstain;
    if (total === 0) return false;
    switch (threshold) {
        case 'absolute':       return 2 * yes > total;
        case 'two_thirds':     return 3 * yes >= 2 * total;
        case 'three_quarters': return 4 * yes >= 3 * total;
        default:               return yes > no;
    }
}

function _buildOrderedBlocks(variants, varMap) {
    const voteable = variants.filter(v => !['withdrawn', 'rejected', 'not_applicable'].includes(v.status) && !v.is_hidden);
    const groups = _buildConflictGroups(voteable);
    const inGroup = new Set(groups.flatMap(g => g.map(v => v.id)));
    const standalone = voteable.filter(v => !inGroup.has(v.id));

    let groupIdx = 0;
    const groupBlocks = groups.map(group => {
        groupIdx++;
        const minCharStart = Math.min(...group.map(v => v.char_start));
        const roots = group.filter(v => !v.parent_variant_id).sort((a, b) => {
            if (a.vote_order == null && b.vote_order == null) return a.char_start - b.char_start;
            if (a.vote_order == null) return 1; if (b.vote_order == null) return -1;
            return a.vote_order - b.vote_order;
        });
        const items = [];
        roots.forEach((root, ri) => {
            items.push({ v: varMap[root.id], isChild: false, parentNum: null, orderIdx: ri + 1 });
            const children = group.filter(c => c.parent_variant_id === root.id).sort((a, b) => (a.vote_order || Infinity) - (b.vote_order || Infinity));
            children.forEach((child, ci) => items.push({ v: varMap[child.id], isChild: true, parentNum: varMap[root.id].num, orderIdx: ci + 1 }));
        });
        return { type: 'group', groupNum: groupIdx, minCharStart, items };
    });

    const standaloneBlocks = standalone.map(v => ({
        type: 'standalone', minCharStart: v.char_start,
        items: [{ v: varMap[v.id], isChild: false, parentNum: null }]
    }));

    return [...groupBlocks, ...standaloneBlocks].sort((a, b) => a.minCharStart - b.minCharStart);
}

function _csvCell(val) {
    let s = val == null ? '' : String(val).replace(/\r?\n/g, ' ');
    if (typeof val === 'string' && /^[=+\-@\t]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
}

function _downloadCSV(doc, blocks, fullText) {
    const docSettings = (doc.settings && typeof doc.settings === 'object') ? doc.settings : {};
    const docDefaultThreshold = docSettings.majority_threshold || 'simple';
    const rows = [
        ['Order', 'Proposal #', 'Title', 'Type', 'Line Start', 'Line End',
         'Proposer', 'Organization', 'Original Text', 'Proposed Text',
         'Conflict Group', 'Vote Order', 'Parent Proposal #', 'Yes', 'No', 'Abstain', 'Threshold']
    ];
    let order = 0;
    for (const block of blocks) {
        for (const { v, isChild, parentNum, orderIdx } of block.items) {
            order++;
            const orig = fullText && v.operation !== 'insert' ? fullText.slice(v.char_start, v.char_end) : '';
            const thresholdLabel = v.majority_threshold
                ? THRESHOLD_LABELS[v.majority_threshold] || v.majority_threshold
                : `doc default (${THRESHOLD_LABELS[docDefaultThreshold] || docDefaultThreshold})`;
            rows.push([
                order, v.num, v.title || v.operation, v.operation,
                v.line_start || '', v.line_end || '',
                v.proposer_name || '', v.proposer_org || '',
                orig, v.new_text,
                block.type === 'group' ? `Group ${block.groupNum}` : '',
                block.type === 'group' ? orderIdx : '',
                parentNum || '',
                v.final_yes ?? '', v.final_no ?? '', v.final_abstain ?? '',
                thresholdLabel
            ]);
        }
    }
    const csv = '﻿' + rows.map(r => r.map(_csvCell).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `${doc.title.replace(/[^a-z0-9]/gi, '_')}_final_voting.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}

function _openPrintHTML(doc, blocks, fullText) {
    const esc2 = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const docSettings = (doc.settings && typeof doc.settings === 'object') ? doc.settings : {};
    const docDefaultThreshold = docSettings.majority_threshold || 'simple';
    let order = 0;
    let body = '';
    for (const block of blocks) {
        if (block.type === 'group') {
            const lines = block.items.flatMap(i => [i.v.line_start, i.v.line_end]).filter(Boolean);
            body += `<div class="conflict-group"><div class="group-header">Conflict group ${block.groupNum} — Lines ${Math.min(...lines)}–${Math.max(...lines)}</div>`;
        }
        for (const { v, isChild, parentNum, orderIdx } of block.items) {
            order++;
            const orig = fullText && v.operation !== 'insert' ? fullText.slice(v.char_start, v.char_end) : '';
            const childNote = isChild ? `<span class="child-note">Child of #${parentNum} — voted only if parent fails</span>` : '';
            const orderBadge = !isChild && block.type === 'group' ? `<span class="order-badge">${orderIdx}</span>` : '';
            const thresholdLbl = v.majority_threshold
                ? THRESHOLD_LABELS[v.majority_threshold] || v.majority_threshold
                : `doc default — ${THRESHOLD_LABELS[docDefaultThreshold] || docDefaultThreshold}`;
            body += `<div class="proposal${isChild ? ' child' : ''}">
<div class="proposal-header">${orderBadge}<strong>#${esc2(v.num)} ${esc2(v.title || v.operation)}</strong> <span class="op">${esc2(v.operation)}</span> · Lines ${esc2(v.line_start)}–${esc2(v.line_end)} · ${esc2(v.proposer_name || '')}${v.proposer_org ? ` (${esc2(v.proposer_org)})` : ''}${childNote}</div>
<div class="texts"><div class="label">${v.operation === 'insert' ? 'Inserted at:' : 'Original:'}</div><div class="text">${v.operation === 'insert' ? `character ${esc2(v.char_start)} (nothing removed)` : (esc2(orig) || '<em>—</em>')}</div><div class="label">Proposed:</div><div class="text">${esc2(v.new_text) || '<em>—</em>'}</div></div>
<div class="tally">Threshold: ${esc2(thresholdLbl)} &nbsp;·&nbsp; Yes: ______ &nbsp;&nbsp; No: ______ &nbsp;&nbsp; Abstain: ______</div>
</div>`;
        }
        if (block.type === 'group') body += '</div>';
    }
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Final voting — ${esc2(doc.title)}</title><style>
body{font-family:Georgia,serif;max-width:820px;margin:2rem auto;color:#111}
h1{font-size:1.4rem;margin-bottom:.25rem}h2{font-size:1rem;font-weight:normal;color:#555;margin-top:0}
.meta{color:#777;font-size:.85rem;margin-bottom:2rem}
.conflict-group{border:2px solid #d97706;border-radius:4px;padding:.75rem;margin:1.25rem 0}
.group-header{font-weight:bold;font-size:.85rem;color:#92400e;margin-bottom:.5rem}
.proposal{border:1px solid #ccc;border-radius:4px;padding:.75rem;margin:.75rem 0;page-break-inside:avoid}
.proposal.child{margin-left:2rem;border-color:#f0a800}
.proposal-header{font-size:.95rem;margin-bottom:.5rem}
.order-badge{display:inline-block;background:#1d4ed8;color:#fff;border-radius:50%;width:1.4em;height:1.4em;text-align:center;line-height:1.4em;font-size:.8rem;margin-right:.4rem}
.child-note{font-size:.75rem;color:#92400e;margin-left:.5rem}
.op{font-size:.75rem;background:#eee;padding:.1rem .3rem;border-radius:3px}
.texts{font-size:.875rem;margin:.5rem 0}
.label{font-weight:bold;font-size:.75rem;color:#555;margin-top:.4rem}
.text{background:#f5f5f5;padding:.3rem .5rem;border-radius:3px;white-space:pre-wrap;word-break:break-word}
.tally{margin-top:.6rem;font-size:.9rem;border-top:1px dashed #ccc;padding-top:.4rem}
@media print{.proposal{page-break-inside:avoid}.conflict-group{page-break-inside:avoid}}
</style></head><body>
<h1>Final voting</h1><h2>${esc2(doc.title)}</h2>
<div class="meta">Generated: ${new Date().toLocaleString()}</div>
${body}
<div style="margin-top:2rem;border-top:2px solid #333;padding-top:1rem">
<strong>Overall document vote</strong><br>
<div class="tally" style="margin-top:.5rem">Yes: ______ &nbsp;&nbsp; No: ______ &nbsp;&nbsp; Abstain: ______</div>
</div>
</body></html>`;

    const win = window.open('', '_blank');
    if (win) { win.document.write(html); win.document.close(); }
}

/* ===== Resolved Text View ===== */

function _outcomeLabel(docVotePassed) {
    return docVotePassed == null ? 'RESOLVED' : docVotePassed ? 'PASSED' : 'FAILED';
}

function _downloadMarkdown(doc, text, docVotePassed, resolvedAt) {
    let md = `# ${doc.title}\n\n`;
    if (resolvedAt) {
        const label = _outcomeLabel(docVotePassed);
        md += `_${label} at ${new Date(resolvedAt).toLocaleString()}_\n\n`;
    }
    md += text;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8;' }));
    a.download = `${doc.title.replace(/[^a-z0-9]/gi, '_')}_resolved.md`;
    a.click();
    URL.revokeObjectURL(a.href);
}

function _printResolvedHTML(doc, text, docVotePassed, resolvedAt) {
    const esc2 = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let statusLine = '';
    if (resolvedAt) {
        statusLine = `<div class="status-banner ${_outcomeLabel(docVotePassed).toLowerCase()}">${_outcomeLabel(docVotePassed)} at ${new Date(resolvedAt).toLocaleString()}</div>`;
    }
    const lines = text.split('\n').map((l, i) =>
        `<div class="line"><span class="num">${i + 1}</span><span class="text">${esc2(l) || '&nbsp;'}</span></div>`
    ).join('');
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${esc2(doc.title)} — resolved</title><style>
body{font-family:Georgia,serif;max-width:820px;margin:2rem auto;color:#111}
h1{font-size:1.4rem;margin-bottom:.25rem}
.status-banner{padding:.5rem 1rem;border-radius:4px;font-weight:bold;margin-bottom:1rem}
.status-banner.passed{background:#d1fae5;color:#065f46}.status-banner.failed{background:#fee2e2;color:#991b1b}.status-banner.resolved{background:#f1f5f9;color:#334155}
.meta{color:#777;font-size:.85rem;margin-bottom:1.5rem}
.line{display:flex;align-items:baseline;font-size:.875rem;line-height:1.6}
.num{min-width:3rem;color:#9ca3af;font-size:.75rem;text-align:right;padding-right:.75rem;flex-shrink:0;font-family:monospace}
.text{white-space:pre-wrap;word-break:break-word}@media print{body{margin:1rem}}
</style></head><body><h1>${esc2(doc.title)}</h1>${statusLine}<div class="meta">Generated: ${new Date().toLocaleString()}</div>${lines}</body></html>`;
    const win = window.open('', '_blank');
    if (win) { win.document.write(html); win.document.close(); }
}

async function viewResolvedText(docId) {
    if (!state.user) { location.hash = '#/login'; return; }
    const [docData, rtData] = await Promise.all([
        api('GET', `/documents/${docId}`),
        api('GET', `/documents/${docId}/resolved-text`),
    ]);
    const doc = docData.document;
    const text = rtData.text || '';
    const resolvedAt = rtData.resolved_at;
    const docVotePassed = rtData.doc_vote_passed;
    const isOwner = doc.owner_id === state.user.id;

    const wrap = el('div', { class: 'page-container' });
    const hdr = el('div', { class: 'page-header' });
    hdr.innerHTML = `<h1 class="page-title">Resolved text — <span style="font-weight:400">${esc(doc.title)}</span></h1>`;

    const toolbar = el('div', { class: 'flex gap-1' });
    const mdBtn   = el('button', { class: 'btn btn-ghost btn-sm' }, 'Export Markdown');
    const printBtn = el('button', { class: 'btn btn-ghost btn-sm' }, 'Print HTML');
    const backHref = doc.status === 'final_voting' ? `#/documents/${esc(String(docId))}/final-vote` : `#/documents/${esc(String(docId))}`;
    const backBtn = el('a', { href: backHref, class: 'btn btn-ghost btn-sm' }, '← Back');
    mdBtn.addEventListener('click', () => _downloadMarkdown(doc, text, docVotePassed, resolvedAt));
    printBtn.addEventListener('click', () => _printResolvedHTML(doc, text, docVotePassed, resolvedAt));
    toolbar.append(mdBtn, printBtn, backBtn);

    if (doc.status === 'final_voting' && hasLevel(doc, 'supervisor')) {
        const resolveBtn = el('button', { class: 'btn btn-primary btn-sm' }, 'Mark as Resolved');
        resolveBtn.addEventListener('click', async () => {
            if (!confirm('Mark as resolved? This will finalize variant statuses and store the resolved text.')) return;
            try {
                await api('POST', `/documents/${docId}/status`, { status: 'resolved' });
                // Setting an identical hash fires no hashchange — re-render through the router queue
                if (location.hash === `#/documents/${docId}/resolved-text`) await runRoute();
                else location.hash = `#/documents/${docId}/resolved-text`;
            } catch (e) { alert(e.message); }
        });
        toolbar.append(resolveBtn);
    }

    if ((doc.status === 'resolved' || doc.status === 'archived') && isOwner && canCreateDocuments()) {
        const forkBtn = el('button', { class: 'btn btn-ghost btn-sm' }, 'Fork as new document');
        forkBtn.addEventListener('click', async () => {
            let forkText = text;
            if (docVotePassed === false) {
                try { const td = await api('GET', `/documents/${docId}/text`); forkText = td.text || text; } catch {}
            }
            try {
                const nd = await api('POST', '/documents', { title: doc.title + ' (fork)', text: forkText });
                location.hash = `#/documents/${nd.document.id}`;
            } catch (e) { alert(e.message); }
        });
        toolbar.append(forkBtn);
    }

    hdr.append(toolbar);

    if (doc.status === 'resolved' || doc.status === 'archived') {
        const passLabel = _outcomeLabel(docVotePassed);
        const cls = docVotePassed == null ? 'alert-neutral' : docVotePassed ? 'alert-success' : 'alert-error';
        const banner = el('div', { class: `alert ${cls}`, style: 'margin-top:.75rem' });
        banner.textContent = resolvedAt ? `${passLabel} at ${new Date(resolvedAt).toLocaleString()}` : passLabel;
        hdr.append(banner);
    }

    wrap.append(hdr);

    const lines = text.split('\n');
    const textDiv = el('div', { class: 'resolved-text-view', style: 'margin-top:1rem' });
    textDiv.innerHTML = lines.map((line, i) =>
        `<div class="rt-line"><span class="rt-linenum">${i + 1}</span><span class="rt-text">${esc(line) || ' '}</span></div>`
    ).join('');
    wrap.append(textDiv);
    setMain(wrap);
}

function _requireSupervisor(doc) {
    if (hasLevel(doc, 'supervisor')) return true;
    setMain(`<div class="page-container"><div class="alert alert-error">Supervisor access or higher is required for this page.</div><p class="mt-2"><a href="#/documents/${esc(String(doc.id))}">← Back to the document</a></p></div>`);
    return false;
}

/* ===== Conflict Resolution View ===== */

function _buildConflictGroups(variants) {
    const active = variants.filter(v => !['withdrawn', 'rejected', 'not_applicable'].includes(v.status));
    const adj = {};
    for (const v of active) adj[v.id] = [];
    for (let i = 0; i < active.length; i++)
        for (let j = i + 1; j < active.length; j++) {
            const [a, b] = [active[i], active[j]];
            if (a.char_start < b.char_end && a.char_end > b.char_start) { adj[a.id].push(b.id); adj[b.id].push(a.id); }
        }
    const visited = new Set(), groups = [];
    for (const v of active) {
        if (visited.has(v.id)) continue;
        const group = [], queue = [v.id];
        while (queue.length) {
            const id = queue.shift(); if (visited.has(id)) continue; visited.add(id);
            const m = active.find(x => x.id === id); if (m) group.push(m);
            for (const n of adj[id]) queue.push(n);
        }
        if (group.length >= 2) groups.push(group);
    }
    return groups;
}

function _isGroupResolved(group) {
    const roots = group.filter(v => !v.parent_variant_id);
    return roots.length > 0 && group.every(v => v.vote_order != null || v.parent_variant_id != null);
}

async function viewConflictResolution(docId) {
    if (!state.user) { location.hash = '#/login'; return; }
    const [docData, varData] = await Promise.all([
        api('GET', `/documents/${docId}`),
        api('GET', `/documents/${docId}/variants`),
    ]);
    const doc = docData.document;
    if (!_requireSupervisor(doc)) return;
    if (doc.status !== 'voting') { location.hash = `#/documents/${docId}/review`; return; }

    const varMap = Object.fromEntries(varData.variants.map(v => [v.id, { ...v, num: v.proposal_num }]));

    const wrap = el('div', { class: 'page-container' });
    const hdr = el('div', { class: 'page-header' });
    hdr.innerHTML = `<h1 class="page-title">Resolve Conflicts — <span style="font-weight:400">${esc(doc.title)}</span></h1>`;
    hdr.append(el('a', { href: `#/documents/${esc(String(docId))}/review`, class: 'btn btn-ghost btn-sm' }, '← Back to review'));
    wrap.append(hdr);

    const goFinal = async () => { try { await api('POST', `/documents/${docId}/status`, { status: 'final_voting' }); location.hash = `#/documents/${docId}`; } catch (e) { alert(e.message); } };
    const readyBtn = el('button', { class: 'btn btn-lg conflict-ready-btn btn-warning' }, 'Ready for final voting');

    if (!_buildConflictGroups(Object.values(varMap)).length) {
        wrap.append(el('div', { class: 'empty-state' },
            el('h3', {}, 'No conflicts to resolve'),
            el('p', {}, 'All active proposals target non-overlapping character ranges.')
        ));
        if (doc.status === 'voting') {
            readyBtn.className = 'btn btn-lg conflict-ready-btn btn-success';
            readyBtn.textContent = '✓ Ready for final voting';
            readyBtn.onclick = goFinal;
            wrap.append(readyBtn);
        }
        setMain(wrap);
        return;
    }

    const groupsEl = el('div', { class: 'conflict-groups' });
    wrap.append(groupsEl, readyBtn);
    setMain(wrap);

    const save = async (updates) => {
        try {
            await Promise.all(updates.map(async ({ id, patch }) => {
                const d = await api('PATCH', `/variants/${id}/conflict-order`, patch);
                Object.assign(varMap[id], d.variant);
            }));
            redraw();
        } catch (e) { alert(e.message); }
    };

    function redraw() {
        const groups = _buildConflictGroups(Object.values(varMap));
        groupsEl.innerHTML = '';
        groups.forEach((g, i) => groupsEl.append(_renderConflictGroup(g.map(v => varMap[v.id]), i, save)));
        const allDone = groups.length > 0 && groups.every(g => _isGroupResolved(g.map(v => varMap[v.id])));
        readyBtn.className = `btn btn-lg conflict-ready-btn ${allDone ? 'btn-success' : 'btn-warning'}`;
        readyBtn.textContent = allDone ? '✓ Ready for final voting' : 'Ready for final voting';
        readyBtn.onclick = allDone
            ? goFinal
            : () => alert('All conflict groups must be fully ordered first.\n\nFor each group, drag every proposal into the numbered list above, or drop it onto another proposal to make it a dependent child (voted only if its parent fails).');
    }

    redraw();
}

function _renderConflictGroup(group, gIdx, save) {
    const lineMin = Math.min(...group.map(v => v.line_start || 0));
    const lineMax = Math.max(...group.map(v => v.line_end || 0));
    const resolved = _isGroupResolved(group);

    const card = el('div', { class: `conflict-group${resolved ? ' conflict-group-resolved' : ''}` });
    card.innerHTML = `<div class="conflict-group-header"><strong>Conflict group ${gIdx + 1}</strong><span class="text-muted">Lines ${lineMin}–${lineMax}</span><span class="conflict-badge ${resolved ? 'conflict-badge-ok' : 'conflict-badge-warn'}">${resolved ? '✓ Resolved' : 'Unresolved'}</span></div>`;

    const listEl = el('div', { class: 'conflict-list' });
    card.append(listEl);

    let dragId = null;

    const sortedRoots = (g) => [...g.filter(v => !v.parent_variant_id && v.vote_order != null)].sort((a, b) => a.vote_order - b.vote_order);

    // Keyboard/touch alternative to drag-and-drop: move up/down, make a child of a root, add to the list
    const kbd = (v, roots) => {
        const box = el('span', { class: 'conflict-kbd' });
        const isRoot = roots.some(r => r.id === v.id);
        if (isRoot) {
            const i = roots.findIndex(r => r.id === v.id);
            const reorder = (from, to) => { const r = [...roots]; const [m] = r.splice(from, 1); r.splice(to, 0, m); return save(r.map((x, k) => ({ id: x.id, patch: { vote_order: k + 1, parent_variant_id: null } }))); };
            const up = el('button', { class: 'btn btn-ghost btn-sm', title: 'Move up', onclick: () => reorder(i, i - 1) }, '↑');
            const down = el('button', { class: 'btn btn-ghost btn-sm', title: 'Move down', onclick: () => reorder(i, i + 1) }, '↓');
            up.disabled = i === 0; down.disabled = i === roots.length - 1;
            box.append(up, down);
        } else {
            box.append(el('button', { class: 'btn btn-ghost btn-sm', title: 'Add as the last root in the voting order', onclick: () => save([{ id: v.id, patch: { vote_order: Math.max(0, ...roots.map(r => r.vote_order)) + 1, parent_variant_id: null } }]) }, '+ root'));
        }
        const others = roots.filter(r => r.id !== v.id);
        if (others.length) {
            const sel = el('select', { class: 'invite-role-select', title: 'Make this a child (voted only if the parent fails)' });
            sel.innerHTML = `<option value="">child of…</option>${others.map(r => `<option value="${r.id}">#${esc(String(r.num))}</option>`).join('')}`;
            sel.addEventListener('change', () => { if (sel.value) save([{ id: v.id, patch: { parent_variant_id: parseInt(sel.value) } }]); });
            box.append(sel);
        }
        return box;
    };

    function buildList() {
        listEl.innerHTML = '';
        const roots = sortedRoots(group);
        const childrenOf = (pid) => [...group.filter(v => v.parent_variant_id === pid)].sort((a, b) => (a.vote_order || Infinity) - (b.vote_order || Infinity));

        const mkDZ = (pos) => {
            const dz = el('div', { class: 'conflict-dropzone' });
            dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('active'); });
            dz.addEventListener('dragleave', () => dz.classList.remove('active'));
            dz.addEventListener('drop', async e => {
                e.preventDefault(); dz.classList.remove('active');
                if (!dragId) return;
                const dragged = group.find(v => v.id === dragId);
                if (!dragged) return;
                const filtered = roots.filter(r => r.id !== dragId);
                const dragIdx = roots.findIndex(r => r.id === dragId);
                const insertAt = dragIdx >= 0 && pos > dragIdx ? Math.min(pos - 1, filtered.length) : Math.min(pos, filtered.length);
                filtered.splice(insertAt, 0, dragged);
                await save(filtered.map((r, i) => ({ id: r.id, patch: { vote_order: i + 1, parent_variant_id: null } })));
            });
            return dz;
        };

        const mkChildDZ = (parentRoot, pos, siblings) => {
            const dz = el('div', { class: 'conflict-dropzone conflict-dropzone-child' });
            dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('active'); });
            dz.addEventListener('dragleave', () => dz.classList.remove('active'));
            dz.addEventListener('drop', async e => {
                e.preventDefault(); dz.classList.remove('active');
                if (!dragId) return;
                const dragged = siblings.find(c => c.id === dragId);
                if (!dragged) return;
                const filtered = siblings.filter(c => c.id !== dragId);
                const dragIdx = siblings.findIndex(c => c.id === dragId);
                const insertAt = dragIdx >= 0 && pos > dragIdx ? Math.min(pos - 1, filtered.length) : Math.min(pos, filtered.length);
                filtered.splice(insertAt, 0, dragged);
                await save(filtered.map((c, i) => ({ id: c.id, patch: { vote_order: i + 1, parent_variant_id: parentRoot.id } })));
            });
            return dz;
        };

        roots.forEach((root, ri) => {
            listEl.append(mkDZ(ri));

            const rc = el('div', { class: 'conflict-card', draggable: 'true' });
            rc.innerHTML = `<span class="conflict-drag-handle" title="Drag to reorder or drop onto a proposal to make this a child">⠿</span><span class="conflict-order-badge">${ri + 1}</span><span class="conflict-card-body"><span class="conflict-card-title" title="${esc(root.rationale || '')}">${esc(root.title || root.operation)}</span> <span class="variant-num">#${esc(String(root.num))}</span><span class="text-muted conflict-card-meta"> · ${esc(root.operation)} · lines ${esc(String(root.line_start || '?'))}–${esc(String(root.line_end || '?'))}</span></span>`;
            rc.append(kbd(root, roots));
            rc.addEventListener('dragstart', e => { dragId = root.id; rc.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
            rc.addEventListener('dragend', () => { dragId = null; rc.classList.remove('dragging'); listEl.querySelectorAll('.conflict-card.drop-target').forEach(x => x.classList.remove('drop-target')); });
            rc.addEventListener('dragover', e => { if (dragId && dragId !== root.id) { e.preventDefault(); e.stopPropagation(); rc.classList.add('drop-target'); } });
            rc.addEventListener('dragleave', () => rc.classList.remove('drop-target'));
            rc.addEventListener('drop', async e => {
                e.preventDefault(); e.stopPropagation(); rc.classList.remove('drop-target');
                if (dragId && dragId !== root.id) await save([{ id: dragId, patch: { parent_variant_id: root.id } }]);
            });
            listEl.append(rc);

            const sortedChildren = childrenOf(root.id);
            sortedChildren.forEach((child, ci) => {
                listEl.append(mkChildDZ(root, ci, sortedChildren));
                const cc = el('div', { class: 'conflict-card conflict-card-child', draggable: 'true' });
                cc.innerHTML = `<span class="conflict-drag-handle" title="Drag to reorder among siblings">⠿</span><span class="conflict-child-order-badge">${ci + 1}</span><span class="conflict-child-badge">child of #${esc(String(root.num))}</span><span class="conflict-card-body"><span class="conflict-card-title" title="${esc(child.rationale || '')}">${esc(child.title || child.operation)}</span> <span class="variant-num">#${esc(String(child.num))}</span></span><button class="conflict-remove-child" title="Remove child relationship">×</button>`;
                cc.addEventListener('dragstart', e => { dragId = child.id; cc.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
                cc.addEventListener('dragend', () => { dragId = null; cc.classList.remove('dragging'); });
                cc.querySelector('.conflict-remove-child').addEventListener('click', async () => {
                    await save([{ id: child.id, patch: { vote_order: null, parent_variant_id: null } }]);
                });
                listEl.append(cc);
            });
            listEl.append(mkChildDZ(root, sortedChildren.length, sortedChildren));
        });

        listEl.append(mkDZ(roots.length));

        const unordered = group.filter(v => !v.parent_variant_id && v.vote_order == null);
        if (unordered.length) {
            listEl.append(el('div', { class: 'conflict-unordered-label' },
                `↑ Drag ${unordered.length} unassigned proposal${unordered.length !== 1 ? 's' : ''} into the numbered list above, or drop onto another proposal to make it a child:`
            ));
            for (const v of unordered) {
                const uc = el('div', { class: 'conflict-card conflict-card-unordered', draggable: 'true' });
                uc.innerHTML = `<span class="conflict-drag-handle">⠿</span><span class="conflict-card-body"><span class="conflict-card-title" title="${esc(v.rationale || '')}">${esc(v.title || v.operation)}</span> <span class="variant-num">#${esc(String(v.num))}</span><span class="text-muted conflict-card-meta"> · ${esc(v.operation)} · lines ${esc(String(v.line_start || '?'))}–${esc(String(v.line_end || '?'))}</span></span>`;
                uc.append(kbd(v, roots));
                uc.addEventListener('dragstart', e => { dragId = v.id; uc.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
                uc.addEventListener('dragend', () => { dragId = null; uc.classList.remove('dragging'); listEl.querySelectorAll('.conflict-card.drop-target').forEach(x => x.classList.remove('drop-target')); });
                listEl.append(uc);
            }
        }
    }

    buildList();
    return card;
}

/* ===== Final Voting Walkthrough ===== */

async function viewFinalVoting(docId) {
    if (!state.user) { location.hash = '#/login'; return; }
    const [docData, varData, textData] = await Promise.all([
        api('GET', `/documents/${docId}`),
        api('GET', `/documents/${docId}/variants`),
        api('GET', `/documents/${docId}/text`),
    ]);
    const doc = docData.document;
    if (!_requireSupervisor(doc)) return;
    if (doc.status !== 'final_voting') { location.hash = `#/documents/${docId}/review`; return; }

    const docSettings = (doc.settings && typeof doc.settings === 'object') ? doc.settings : {};
    const docDefaultThreshold = docSettings.majority_threshold || 'simple';

    const varMap = Object.fromEntries(varData.variants.map(v => [v.id, { ...v, num: v.proposal_num }]));
    const fullText = textData.text || '';
    const blocks = _buildOrderedBlocks(varData.variants, varMap);

    const wrap = el('div', { class: 'page-container' });
    const hdr = el('div', { class: 'page-header' });
    hdr.innerHTML = `<h1 class="page-title">Final voting — <span style="font-weight:400">${esc(doc.title)}</span></h1>`;
    const toolbar = el('div', { class: 'flex gap-1' });
    const csvBtn  = el('button', { class: 'btn btn-ghost btn-sm' }, 'Export CSV');
    const prntBtn = el('button', { class: 'btn btn-ghost btn-sm' }, 'Print HTML');
    const rtBtn   = el('a', { href: `#/documents/${esc(String(docId))}/resolved-text`, class: 'btn btn-ghost btn-sm' }, 'Resolved text');
    const backBtn = el('a', { href: `#/documents/${esc(String(docId))}/review`, class: 'btn btn-ghost btn-sm' }, '← Back to review');
    csvBtn.addEventListener('click', () => _downloadCSV(doc, _buildOrderedBlocks(Object.values(varMap), varMap), fullText));
    prntBtn.addEventListener('click', () => _openPrintHTML(doc, _buildOrderedBlocks(Object.values(varMap), varMap), fullText));
    toolbar.append(csvBtn, prntBtn, rtBtn, backBtn);
    hdr.append(toolbar);
    const progressEl = el('div', { id: 'fv-progress', class: 'fv-progress' });
    const blockersEl = el('div', { id: 'fv-blockers', class: 'alert alert-error', style: 'display:none;margin-top:.5rem' });
    hdr.append(progressEl, blockersEl);
    wrap.append(hdr);

    const list = el('div', { class: 'fv-list' });

    const tallied = pv => pv.final_yes != null || pv.final_no != null;
    const passes = pv => tallied(pv) && passesThreshold(pv.final_yes, pv.final_no, pv.final_abstain, pv.majority_threshold || docDefaultThreshold);
    const skipped = item => item.isChild && varMap[item.v.parent_variant_id] && passes(varMap[item.v.parent_variant_id]);

    function updateProgress() {
        const allItems = blocks.flatMap(b => b.items);
        const done = allItems.filter(i => tallied(varMap[i.v.id]) || skipped(i)).length;
        progressEl.textContent = `${done} of ${allItems.length} proposals recorded`;
        progressEl.className = `fv-progress${done === allItems.length ? ' fv-progress-done' : ''}`;
        updateBlockers();
    }

    // Mirrors the server's resolve gate so the supervisor sees the problem before "Mark as Resolved"
    function updateBlockers() {
        const items = blocks.flatMap(b => b.items);
        const winners = items.filter(i => !skipped(i) && passes(varMap[i.v.id])).map(i => varMap[i.v.id]);
        const consumedEnd = pv => pv.operation === 'insert' ? pv.char_start : pv.char_end;
        const problems = [];
        for (let i = 0; i < winners.length; i++) for (let j = i + 1; j < winners.length; j++) {
            const a = winners[i], b = winners[j];
            if (a.char_start < consumedEnd(b) && b.char_start < consumedEnd(a)) problems.push(`#${a.num} and #${b.num} overlap and both pass — mark one NOT VOTING in the review view`);
        }
        const missing = items.filter(i => !skipped(i) && !tallied(varMap[i.v.id])).map(i => `#${varMap[i.v.id].num}`);
        if (missing.length) problems.push(`no tally yet for ${missing.join(', ')}`);
        blockersEl.style.display = problems.length ? '' : 'none';
        blockersEl.innerHTML = problems.length ? `<strong>Cannot be resolved yet:</strong> ${problems.map(esc).join(' · ')}` : '';
    }

    function updateChildrenState(parentId) {
        const pv = varMap[parentId];
        if (!pv) return;
        const hasTally = pv.final_yes != null || pv.final_no != null;
        const threshold = pv.majority_threshold || docDefaultThreshold;
        const passed = hasTally && passesThreshold(pv.final_yes, pv.final_no, pv.final_abstain, threshold);
        list.querySelectorAll(`[data-parent-id="${parentId}"]`).forEach(childCard => {
            childCard.classList.toggle('fv-card-child-skipped', passed);
            const skipNote = childCard.querySelector('.fv-skip-note');
            if (skipNote) skipNote.style.display = passed ? '' : 'none';
        });
        const parentCard = list.querySelector(`[data-id="${parentId}"]`);
        if (!parentCard || !hasTally) return;
        let badge = parentCard.querySelector('.fv-result-badge');
        if (!badge) {
            badge = document.createElement('span');
            parentCard.querySelector('.fv-card-header').append(badge);
        }
        badge.textContent = passed ? '✓ Passed' : '✗ Failed';
        badge.className = `fv-result-badge ${passed ? 'fv-result-passed' : 'fv-result-failed'}`;
    }

    function renderProposalCard(v, isChild, parentNum, blockType, groupNum, orderIdx) {
        const orig = v.operation === 'insert' ? '' : fullText.slice(v.char_start, v.char_end);
        const cardAttrs = { class: `fv-card${isChild ? ' fv-card-child' : ''}`, 'data-id': String(v.id) };
        if (isChild) cardAttrs['data-parent-id'] = String(v.parent_variant_id || '');
        const card = el('div', cardAttrs);
        const statusHtml = `<span class="fv-status-badge fv-status-${v.status}">${esc(v.status)}</span>`;
        const orderBadge = !isChild && blockType === 'group' ? `<span class="fv-order-badge">${esc(String(orderIdx || ''))}</span>` : '';
        const childNote  = isChild ? `<span class="fv-child-note">↳ child of #${esc(String(parentNum))} — voted only if parent fails</span>` : '';
        const skipNote   = isChild ? `<span class="fv-skip-note" style="display:none">Not voting on — parent passed</span>` : '';
        card.innerHTML = `
<div class="fv-card-header">
  ${orderBadge}<strong class="fv-card-num">#${esc(String(v.num))}</strong>
  <span class="fv-card-title">${esc(v.title || v.operation)}</span>
  ${statusHtml}
  <span class="fv-card-meta text-muted">${esc(v.operation)} · lines ${esc(String(v.line_start || '?'))}–${esc(String(v.line_end || '?'))}</span>
  ${childNote}${skipNote}
</div>
<div class="fv-card-texts">
  <div class="fv-label">${v.operation === 'insert' ? 'Inserted at' : 'Original'}</div><div class="fv-text">${v.operation === 'insert' ? `<em class="text-muted">character ${esc(String(v.char_start))} — nothing removed</em>` : (esc(orig) || '<em class="text-muted">— empty —</em>')}</div>
  <div class="fv-label">Proposed</div><div class="fv-text">${esc(v.new_text) || '<em class="text-muted">— deletion —</em>'}</div>
</div>
<div class="fv-inputs">
  <label>Yes <input class="fv-num-input" type="number" min="0" name="yes" value="${esc(String(v.final_yes ?? ''))}"></label>
  <label>No <input class="fv-num-input" type="number" min="0" name="no" value="${esc(String(v.final_no ?? ''))}"></label>
  <label>Abstain <input class="fv-num-input" type="number" min="0" name="abstain" value="${esc(String(v.final_abstain ?? ''))}"></label>
  <button class="btn btn-sm btn-primary fv-save-btn">Save</button>
  <span class="fv-saved-indicator" style="display:none">✓ Saved</span>
</div>
<div class="fv-threshold"><label class="text-muted" style="font-size:.85rem">Threshold <select class="fv-threshold-sel"><option value="">Doc default (${esc(THRESHOLD_LABELS[docDefaultThreshold] || 'Simple')})</option><option value="simple">Simple</option><option value="absolute">Absolute</option><option value="two_thirds">⅔ majority</option><option value="three_quarters">¾ majority</option></select></label></div>
<div class="fv-majority"></div>
<div class="fv-audit"><button class="fv-audit-btn">View audit trail</button><div class="fv-audit-list" style="display:none"></div></div>`;
        const saveBtn  = card.querySelector('.fv-save-btn');
        const savedInd = card.querySelector('.fv-saved-indicator');
        const majEl    = card.querySelector('.fv-majority');
        const auditBtn = card.querySelector('.fv-audit-btn');
        const auditList = card.querySelector('.fv-audit-list');
        auditBtn.addEventListener('click', async () => {
            if (auditList.style.display !== 'none') { auditList.style.display = 'none'; auditBtn.textContent = 'View audit trail'; return; }
            try {
                const d = await api('GET', `/variants/${v.id}/final-vote-log`);
                auditList.innerHTML = d.logs.length ? d.logs.map(l =>
                    `<div class="fv-audit-entry"><span class="fv-audit-time">${new Date(l.recorded_at).toLocaleString()}</span> <span>${esc(l.user_name)}</span>: yes=${l.final_yes??'–'} no=${l.final_no??'–'} abstain=${l.final_abstain??'–'}</div>`
                ).join('') : '<div class="fv-audit-entry text-muted">No entries yet.</div>';
                auditList.style.display = ''; auditBtn.textContent = 'Hide audit trail';
            } catch {}
        });

        const thresholdSel = card.querySelector('.fv-threshold-sel');
        thresholdSel.value = v.majority_threshold || '';
        thresholdSel.addEventListener('change', async () => {
            const val = thresholdSel.value || null;
            try {
                const d = await api('PATCH', `/variants/${v.id}/threshold`, { majority_threshold: val });
                Object.assign(varMap[v.id], d.variant);
                updateMajority();
                updateChildrenState(isChild ? v.parent_variant_id : v.id);
                updateProgress();
            } catch (e) { alert(e.message); thresholdSel.value = varMap[v.id].majority_threshold || ''; }
        });

        function updateMajority() {
            const pv = varMap[v.id];
            const yes = pv.final_yes || 0, no = pv.final_no || 0, abstain = pv.final_abstain || 0;
            const threshold = pv.majority_threshold || docDefaultThreshold;
            const isSimple = !threshold || threshold === 'simple';
            const denominator = isSimple ? (yes + no) : (yes + no + abstain);
            if (denominator === 0) { majEl.textContent = ''; majEl.className = 'fv-majority'; return; }
            const pct = Math.round(yes / denominator * 100);
            const passed = passesThreshold(yes, no, abstain, threshold);
            const lbl = (THRESHOLD_LABELS[threshold] || 'Simple').toLowerCase();
            const cls = passed ? 'fv-majority-pass' : (isSimple && yes === no ? 'fv-majority-split' : 'fv-majority-fail');
            majEl.textContent = `${pct}% yes — needs ${lbl}`;
            majEl.className = `fv-majority ${cls}`;
        }
        updateMajority();

        saveBtn.addEventListener('click', async () => {
            const yes     = parseInt(card.querySelector('[name=yes]').value,     10);
            const no      = parseInt(card.querySelector('[name=no]').value,      10);
            const abstain = parseInt(card.querySelector('[name=abstain]').value, 10);
            const patch = {};
            if (!isNaN(yes))     patch.yes     = yes;
            if (!isNaN(no))      patch.no      = no;
            if (!isNaN(abstain)) patch.abstain = abstain;
            try {
                const d = await api('PATCH', `/variants/${v.id}/final-vote`, patch);
                Object.assign(varMap[v.id], d.variant);
                saveBtn.style.display = 'none';
                savedInd.style.display = '';
                savedInd.textContent = '✓ Saved at ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                updateMajority();
                if (!isChild) updateChildrenState(v.id);
                updateProgress();
            } catch (e) { alert(e.message); }
        });
        card.querySelectorAll('.fv-num-input').forEach(inp => inp.addEventListener('input', () => {
            saveBtn.style.display = ''; savedInd.style.display = 'none';
        }));
        return card;
    }

    for (const block of blocks) {
        if (block.type === 'group') {
            const allLines = block.items.flatMap(i => [i.v.line_start, i.v.line_end]).filter(Boolean);
            const sec = el('div', { class: 'fv-group' });
            sec.innerHTML = `<div class="fv-group-header">Conflict group ${esc(String(block.groupNum))} <span class="text-muted">· Lines ${Math.min(...allLines)}–${Math.max(...allLines)}</span></div>`;
            for (const { v, isChild, parentNum, orderIdx } of block.items)
                sec.append(renderProposalCard(v, isChild, parentNum, 'group', block.groupNum, orderIdx));
            list.append(sec);
        } else {
            const { v } = block.items[0];
            list.append(renderProposalCard(v, false, null, 'standalone', null));
        }
    }

    // Overall document vote section
    const docVote = el('div', { class: 'fv-docvote' });
    docVote.innerHTML = `
<h2 class="fv-docvote-title">Overall document vote</h2>
<p class="text-muted" style="margin:.25rem 0 1rem">Record the total vote on the document as a whole.</p>
<div class="fv-inputs">
  <label>Yes <input class="fv-num-input" type="number" min="0" id="dv-yes" value="${esc(String(doc.doc_vote_yes ?? ''))}"></label>
  <label>No <input class="fv-num-input" type="number" min="0" id="dv-no" value="${esc(String(doc.doc_vote_no ?? ''))}"></label>
  <label>Abstain <input class="fv-num-input" type="number" min="0" id="dv-abstain" value="${esc(String(doc.doc_vote_abstain ?? ''))}"></label>
  <button class="btn btn-sm btn-primary" id="dv-save">Save</button>
  <span id="dv-saved" style="display:none">✓ Saved</span>
</div>`;

    wrap.append(list, docVote);
    setMain(wrap);
    updateProgress();
    for (const block of blocks)
        for (const { v, isChild } of block.items)
            if (!isChild) updateChildrenState(v.id);

    docVote.querySelector('#dv-save').addEventListener('click', async () => {
        const yes     = parseInt(docVote.querySelector('#dv-yes').value,     10);
        const no      = parseInt(docVote.querySelector('#dv-no').value,      10);
        const abstain = parseInt(docVote.querySelector('#dv-abstain').value, 10);
        const patch = {};
        if (!isNaN(yes))     patch.yes     = yes;
        if (!isNaN(no))      patch.no      = no;
        if (!isNaN(abstain)) patch.abstain = abstain;
        try {
            await api('PATCH', `/documents/${docId}/doc-vote`, patch);
            docVote.querySelector('#dv-save').style.display = 'none';
            docVote.querySelector('#dv-saved').style.display = '';
        } catch (e) { alert(e.message); }
    });
    docVote.querySelectorAll('.fv-num-input').forEach(inp => inp.addEventListener('input', () => {
        docVote.querySelector('#dv-save').style.display = '';
        docVote.querySelector('#dv-saved').style.display = 'none';
    }));
}

/* ===== View: Document Review ===== */
async function viewDocumentReview(docId) {
    if (!state.user) { location.hash = '#/login'; return; }
    const [docData, varData] = await Promise.all([
        api('GET', `/documents/${docId}`),
        api('GET', `/documents/${docId}/variants`).catch(() => ({ variants: [] })),
    ]);
    const doc = docData.document;
    if (!_requireSupervisor(doc)) return;
    if (doc.status !== 'voting' && doc.status !== 'final_voting') { location.hash = `#/documents/${docId}`; return; }
    const isFinalVoting = doc.status === 'final_voting';
    const docSettings = (doc.settings && typeof doc.settings === 'object') ? doc.settings : {};
    const docDefaultThreshold = docSettings.majority_threshold || 'simple';
    const rawV = varData.variants || [];
    let variants = rawV.map(v => ({ ...v, num: v.proposal_num }));
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
        page = Math.max(1, Math.min(doc.total_pages, page || 1));
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
            card.innerHTML = `<div class="review-card-header"><span class="variant-num">#${esc(String(v.num))}</span><span class="review-card-title">${esc(v.title || v.operation)}</span>${oc ? `<span class="review-overlap-badge">⊕${oc}</span>` : ''}</div><div class="text-muted review-card-meta">Lines ${esc(String(v.line_start || '?'))}–${esc(String(v.line_end || '?'))} · ${esc(v.operation)} · ▲${v.votes_for} ▼${v.votes_against}</div>${tallyHtml}<div class="review-actions"><button class="review-btn review-btn-voting${isVoting ? ' review-btn-active' : ''}" data-action="pending">VOTING</button><button class="review-btn review-btn-conflict${v.status === 'conflict' || suggestConflict ? ' review-btn-active' : ''}" data-action="conflict">CONFLICT</button><button class="review-btn review-btn-danger${v.status === 'rejected' ? ' review-btn-active' : ''}" data-action="rejected">NOT VOTING</button><button class="review-btn review-btn-danger${v.status === 'not_applicable' ? ' review-btn-active' : ''}" data-action="not_applicable">Not applicable</button><button class="review-btn review-btn-danger${v.status === 'withdrawn' ? ' review-btn-active' : ''}" data-action="withdrawn">Withdrawn</button></div><div class="review-threshold text-muted" style="font-size:.8rem;margin-top:.4rem">Threshold <select class="review-thresh-sel"><option value="">Doc default (${esc(THRESHOLD_LABELS[docDefaultThreshold] || 'Simple')})</option><option value="simple">Simple</option><option value="absolute">Absolute</option><option value="two_thirds">⅔</option><option value="three_quarters">¾</option></select></div>`;
            const threshSel = card.querySelector('.review-thresh-sel');
            threshSel.value = v.majority_threshold || '';
            threshSel.addEventListener('change', async () => {
                const val = threshSel.value || null;
                try {
                    const d = await api('PATCH', `/variants/${v.id}/threshold`, { majority_threshold: val });
                    const idx = variants.findIndex(x => x.id === v.id);
                    if (idx >= 0) variants[idx] = { ...variants[idx], majority_threshold: d.variant.majority_threshold };
                } catch (e) { showError(wrap, e.message); threshSel.value = v.majority_threshold || ''; }
            });
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

/* ===== View: Moderation (supervisor+) ===== */
async function viewModeration(docId) {
    if (!state.user) { location.hash = '#/login'; return; }
    const [docData, modData] = await Promise.all([
        api('GET', `/documents/${docId}`),
        api('GET', `/documents/${docId}/moderation`),
    ]);
    const doc = docData.document;
    const hv = modData.hidden_variants || [];
    const hc = modData.hidden_comments || [];

    const rowStyle = 'display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:.5rem 0;border-bottom:1px solid var(--color-border)';
    const wrap = el('div', { class: 'page-container' });
    wrap.innerHTML = `
        <div class="flex justify-between items-center mb-2">
            <h1>Moderation — ${esc(doc.title)}</h1>
            <a href="#/documents/${esc(String(docId))}" class="btn btn-ghost btn-sm">← Document</a>
        </div>
        <div class="card mb-2">
            <h2 class="mb-1">Hidden proposals</h2>
            <div id="mod-variant-list">
            ${hv.length ? hv.map(v => `
                <div class="mod-row" style="${rowStyle}">
                    <div><a href="#/variants/${esc(String(v.id))}">${esc(v.title || v.operation)}</a>
                        <span class="text-muted"> — proposed by ${esc(v.proposer_name)}</span></div>
                    <button class="btn btn-ghost btn-sm mod-unhide-variant" data-id="${esc(v.id)}">Unhide</button>
                </div>`).join('') : '<p class="text-muted">No hidden proposals.</p>'}
            </div>
        </div>
        <div class="card">
            <h2 class="mb-1">Hidden comments</h2>
            <div id="mod-comment-list">
            ${hc.length ? hc.map(c => `
                <div class="mod-row" style="${rowStyle}">
                    <div>${esc(c.text)}
                        <span class="text-muted"> — by ${esc(c.author_name)}, hidden by ${esc(c.hidden_by_name || '?')} ·
                        <a href="#/variants/${esc(String(c.variant_id))}">proposal</a></span></div>
                    <button class="btn btn-ghost btn-sm mod-unhide-comment" data-id="${esc(c.id)}">Unhide</button>
                </div>`).join('') : '<p class="text-muted">No moderator-hidden comments.</p>'}
            </div>
        </div>
    `;
    setMain(wrap);

    wrap.addEventListener('click', async e => {
        const vBtn = e.target.closest('.mod-unhide-variant');
        if (vBtn) {
            try { await api('POST', `/variants/${vBtn.dataset.id}/unhide`); runRoute(); } catch (err) { alert(err.message); }
        }
        const cBtn = e.target.closest('.mod-unhide-comment');
        if (cBtn) {
            try { await api('POST', `/comments/${cBtn.dataset.id}/unhide`); runRoute(); } catch (err) { alert(err.message); }
        }
    });
}

/* ===== View: User administration (superadmin) ===== */
async function viewUserAdmin() {
    if (!state.user) { location.hash = '#/login'; return; }
    if (state.user.role !== 'superadmin') {
        setMain(`<div class="page-container"><div class="alert alert-error">Superadmin access required.</div></div>`);
        return;
    }
    const data = await api('GET', '/users');
    const users = data.users || [];

    const rowStyle = 'display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:.5rem 0;border-bottom:1px solid var(--color-border)';
    const wrap = el('div', { class: 'page-container' });
    wrap.innerHTML = `
        <h1 class="mb-2">Users</h1>
        <div class="card">
            <p class="text-muted mb-2">Role: <strong>user</strong> takes part in documents they are invited to; <strong>creator</strong> may also create documents; <strong>superadmin</strong> administers the site. Protected users are hidden from all user searches (e.g. access invites).</p>
            ${users.map(u => `
                <div class="user-admin-row" style="${rowStyle}">
                    <div>
                        <strong>${esc(u.display_name || u.email)}</strong>
                        <span class="text-muted"> — ${esc(u.email)}${u.is_protected ? ' · <em>protected</em>' : ''}${u.is_active ? '' : ' · <em>inactive</em>'}</span>
                    </div>
                    <div class="flex items-center gap-1">
                        ${u.id === state.user.id
                            ? `<span class="text-muted">${esc(u.role)}</span>`
                            : `<select class="invite-role-select role-select" data-id="${esc(u.id)}" title="Site role">${['user', 'creator', 'superadmin'].map(r => `<option value="${r}"${r === u.role ? ' selected' : ''}>${r}</option>`).join('')}</select>`}
                        <button class="btn btn-ghost btn-sm protect-toggle-btn" data-id="${esc(u.id)}" data-val="${u.is_protected ? 0 : 1}">
                            ${u.is_protected ? 'Unprotect' : 'Protect'}
                        </button>
                    </div>
                </div>`).join('')}
        </div>
    `;
    setMain(wrap);

    wrap.addEventListener('click', async e => {
        const btn = e.target.closest('.protect-toggle-btn');
        if (!btn) return;
        try {
            await api('PATCH', `/users/${btn.dataset.id}/protection`, { is_protected: parseInt(btn.dataset.val) });
            runRoute();
        } catch (err) { alert(err.message); }
    });
    wrap.addEventListener('change', async e => {
        const sel = e.target.closest('.role-select');
        if (!sel) return;
        try {
            await api('PATCH', `/users/${sel.dataset.id}/role`, { role: sel.value });
            runRoute();
        } catch (err) { alert(err.message); runRoute(); }
    });
}

/* ===== Manage access modal (supervisor+ read; admin edits) ===== */
function openAccessModal(docId) {
    openModal(`<div class="loading-spinner">Loading…</div>`, 'Manage access');

    api('GET', `/documents/${docId}/access`).then(data => {
        const rows = data.access || [];
        const defaultAccessLevels = ['viewer', 'commenter', 'proposer', 'voter'];
        const myLevel = data.my_access_level || 'admin';
        const myIdx = ACCESS_LEVELS.indexOf(myLevel);
        const isAdmin = myLevel === 'admin';
        const canEditSettings = ['editor', 'admin'].includes(myLevel);
        const allowedLevels = ACCESS_LEVELS.filter((_, i) => i <= myIdx);
        const defaultLevel = allowedLevels.includes('proposer') ? 'proposer' : allowedLevels[allowedLevels.length - 1];
        const currentDefault = data.default_access || '';
        const mc = document.getElementById('modal-content');
        mc.innerHTML = `
            <div class="modal-title">Manage access</div>
            ${canEditSettings ? `
            <p class="mb-1" style="font-weight:600">Default access</p>
            <div class="flex items-center gap-1 mb-1">
                <select id="default-access-select" class="invite-role-select">
                    <option value="">None — invite only</option>
                    ${defaultAccessLevels.map(l => `<option value="${l}"${l === currentDefault ? ' selected' : ''}>${l}</option>`).join('')}
                </select>
                <span class="text-muted" style="font-size:0.8rem">Role for any signed-in user who opens the document's link</span>
            </div>
            <p id="default-access-status" style="font-size:0.75rem;min-height:1rem;margin-bottom:0.5rem"></p>
            <hr style="margin:0.75rem 0;border:none;border-top:1px solid var(--color-border)">` : ''}
            <div class="mb-2">${rows.map(r => `
                <div class="flex items-center justify-between gap-1 mb-1 access-row${r.blocked ? ' access-row-blocked' : ''}" data-user="${esc(r.user_id)}">
                    <span>${esc(r.email)}</span>
                    ${isAdmin
                        ? `<select class="invite-role-select access-level-sel" data-user="${esc(r.user_id)}" title="Change access level">${ACCESS_LEVELS.map(l => `<option value="${l}"${l === r.access_level ? ' selected' : ''}>${l}</option>`).join('')}</select>
                           <span class="row-actions"><button class="btn btn-ghost btn-sm" data-block="${esc(r.user_id)}" data-blocked="${r.blocked ? 1 : 0}">${r.blocked ? 'Unblock' : 'Block'}</button><button class="btn btn-ghost btn-sm" data-remove="${esc(r.user_id)}">Remove</button></span>`
                        : `<span class="text-muted">${esc(r.access_level)}${r.blocked ? ' (blocked)' : ''}</span>`}
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

        const defaultAccessSelect = document.getElementById('default-access-select');
        if (defaultAccessSelect) defaultAccessSelect.addEventListener('change', async e => {
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
                const { users } = await api('GET', `/auth/search?q=${encodeURIComponent(q)}&document_id=${encodeURIComponent(docId)}`);
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

        document.getElementById('invite-submit').addEventListener('click', async () => {
            errEl.style.display = 'none';
            const email = (selectedEmail || searchInput.value).trim();
            const level = document.getElementById('invite-level').value;
            if (!email || !email.includes('@')) { errEl.textContent = 'Select a user from results or enter a valid email address'; errEl.style.display = ''; return; }
            try {
                await api('POST', `/documents/${docId}/access`, { email, access_level: level });
                openAccessModal(docId);
            } catch (err) { errEl.textContent = err.message; errEl.style.display = ''; }
        });

        mc.addEventListener('change', async e => {
            const sel = e.target.closest('.access-level-sel');
            if (!sel) return;
            try { await api('PATCH', `/documents/${docId}/access/${sel.dataset.user}`, { access_level: sel.value }); }
            catch (err) { alert(err.message); openAccessModal(docId); }
        });

        mc.addEventListener('click', async e => {
            if (!e.target.closest('#invite-search') && !e.target.closest('#invite-results')) hideResults();
            const blockBtn = e.target.closest('button[data-block]');
            if (blockBtn) {
                try { await api('PATCH', `/documents/${docId}/access/${blockBtn.dataset.block}`, { blocked: blockBtn.dataset.blocked !== '1' }); openAccessModal(docId); }
                catch (err) { alert(err.message); }
                return;
            }
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
                const blocked = cancelBtn.closest('.access-row').classList.contains('access-row-blocked');
                actions.innerHTML = `<button class="btn btn-ghost btn-sm" data-block="${esc(cancelBtn.dataset.cancelRemove)}" data-blocked="${blocked ? 1 : 0}">${blocked ? 'Unblock' : 'Block'}</button><button class="btn btn-ghost btn-sm" data-remove="${esc(cancelBtn.dataset.cancelRemove)}">Remove</button>`;
                return;
            }
            const confirmBtn = e.target.closest('button[data-confirm-remove]');
            if (confirmBtn) {
                try {
                    await api('DELETE', `/documents/${docId}/access/${confirmBtn.dataset.confirmRemove}`);
                    openAccessModal(docId);
                } catch (err) { alert(err.message); }
            }
        });
    }).catch(err => {
        const mc = document.getElementById('modal-content');
        if (mc) mc.innerHTML = `<div class="modal-title">Manage access</div><div class="alert alert-error">${esc(err.message)}</div>`;
    });
}

'use strict';

/* ===== Shared helpers ===== */

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
        for (const root of roots) {
            items.push({ v: varMap[root.id], isChild: false, parentNum: null });
            for (const child of group.filter(c => c.parent_variant_id === root.id))
                items.push({ v: varMap[child.id], isChild: true, parentNum: varMap[root.id].num });
        }
        return { type: 'group', groupNum: groupIdx, minCharStart, items };
    });

    const standaloneBlocks = standalone.map(v => ({
        type: 'standalone', minCharStart: v.char_start,
        items: [{ v: varMap[v.id], isChild: false, parentNum: null }]
    }));

    return [...groupBlocks, ...standaloneBlocks].sort((a, b) => a.minCharStart - b.minCharStart);
}

function _csvCell(val) {
    const s = val == null ? '' : String(val).replace(/\r?\n/g, ' ');
    return '"' + s.replace(/"/g, '""') + '"';
}

function _downloadCSV(doc, blocks, fullText) {
    const rows = [
        ['Order', 'Proposal #', 'Title', 'Type', 'Line Start', 'Line End',
         'Proposer', 'Organization', 'Original Text', 'Proposed Text',
         'Conflict Group', 'Vote Order', 'Parent Proposal #', 'Yes', 'No', 'Abstain']
    ];
    let order = 0;
    for (const block of blocks) {
        for (const { v, isChild, parentNum } of block.items) {
            order++;
            const orig = fullText ? fullText.slice(v.char_start, v.char_end) : '';
            rows.push([
                order, v.num, v.title || v.operation, v.operation,
                v.line_start || '', v.line_end || '',
                v.proposer_name || '', v.proposer_org || '',
                orig, v.new_text,
                block.type === 'group' ? `Group ${block.groupNum}` : '',
                isChild ? 'child' : (v.vote_order || ''),
                parentNum || '',
                v.final_yes ?? '', v.final_no ?? '', v.final_abstain ?? ''
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
    let order = 0;
    let body = '';
    for (const block of blocks) {
        if (block.type === 'group') {
            const lines = [block.items[0].v.line_start, ...block.items.map(i => i.v.line_end)];
            body += `<div class="conflict-group"><div class="group-header">Conflict group ${block.groupNum} — Lines ${Math.min(...lines)}–${Math.max(...lines)}</div>`;
        }
        for (const { v, isChild, parentNum } of block.items) {
            order++;
            const orig = fullText ? fullText.slice(v.char_start, v.char_end) : '';
            const childNote = isChild ? `<span class="child-note">Child of #${parentNum} — voted only if parent fails</span>` : '';
            const orderBadge = !isChild && block.type === 'group' ? `<span class="order-badge">${v.vote_order}</span>` : '';
            body += `<div class="proposal${isChild ? ' child' : ''}">
<div class="proposal-header">${orderBadge}<strong>#${esc2(v.num)} ${esc2(v.title || v.operation)}</strong> <span class="op">${esc2(v.operation)}</span> · Lines ${esc2(v.line_start)}–${esc2(v.line_end)} · ${esc2(v.proposer_name || '')}${v.proposer_org ? ` (${esc2(v.proposer_org)})` : ''}${childNote}</div>
<div class="texts"><div class="label">Original:</div><div class="text">${esc2(orig) || '<em>—</em>'}</div><div class="label">Proposed:</div><div class="text">${esc2(v.new_text) || '<em>—</em>'}</div></div>
<div class="tally">Yes: ______ &nbsp;&nbsp; No: ______ &nbsp;&nbsp; Abstain: ______</div>
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
    if (doc.status !== 'voting') { location.hash = `#/documents/${docId}/review`; return; }

    const idOrder = Object.fromEntries([...varData.variants].sort((a, b) => a.id - b.id).map((v, i) => [v.id, i + 1]));
    const varMap = Object.fromEntries(varData.variants.map(v => [v.id, { ...v, num: idOrder[v.id] }]));

    const wrap = el('div', { class: 'page-container' });
    const hdr = el('div', { class: 'page-header' });
    hdr.innerHTML = `<h1 class="page-title">Resolve Conflicts — <span style="font-weight:400">${esc(doc.title)}</span></h1>`;
    hdr.append(el('a', { href: `#/documents/${esc(String(docId))}/review`, class: 'btn btn-ghost btn-sm' }, '← Back to review'));
    wrap.append(hdr);

    if (!_buildConflictGroups(Object.values(varMap)).length) {
        wrap.append(el('div', { class: 'empty-state' },
            el('h3', {}, 'No conflicts to resolve'),
            el('p', {}, 'All active proposals target non-overlapping character ranges.')
        ));
        setMain(wrap);
        return;
    }

    const groupsEl = el('div', { class: 'conflict-groups' });
    const readyBtn = el('button', { class: 'btn btn-lg conflict-ready-btn btn-warning' }, 'Ready for final voting');
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
            ? async () => { try { await api('POST', `/documents/${docId}/status`, { status: 'final_voting' }); location.hash = `#/documents/${docId}`; } catch (e) { alert(e.message); } }
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

    const sortedRoots = (g) => [...g.filter(v => !v.parent_variant_id)].sort((a, b) => {
        if (a.vote_order == null && b.vote_order == null) return (a.char_start || 0) - (b.char_start || 0);
        if (a.vote_order == null) return 1; if (b.vote_order == null) return -1;
        return a.vote_order - b.vote_order;
    });

    function buildList() {
        listEl.innerHTML = '';
        const roots = sortedRoots(group);
        const childrenOf = (pid) => group.filter(v => v.parent_variant_id === pid);

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

        roots.forEach((root, ri) => {
            listEl.append(mkDZ(ri));

            const rc = el('div', { class: 'conflict-card', draggable: 'true' });
            rc.innerHTML = `<span class="conflict-drag-handle" title="Drag to reorder or drop onto a proposal to make this a child">⠿</span><span class="conflict-order-badge">${ri + 1}</span><span class="conflict-card-body"><span class="conflict-card-title">${esc(root.title || root.operation)}</span> <span class="variant-num">#${root.num}</span><span class="text-muted conflict-card-meta"> · ${esc(root.operation)} · lines ${esc(String(root.line_start || '?'))}–${esc(String(root.line_end || '?'))}</span></span>`;
            rc.addEventListener('dragstart', e => { dragId = root.id; rc.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
            rc.addEventListener('dragend', () => { dragId = null; rc.classList.remove('dragging'); listEl.querySelectorAll('.conflict-card.drop-target').forEach(x => x.classList.remove('drop-target')); });
            rc.addEventListener('dragover', e => { if (dragId && dragId !== root.id) { e.preventDefault(); e.stopPropagation(); rc.classList.add('drop-target'); } });
            rc.addEventListener('dragleave', () => rc.classList.remove('drop-target'));
            rc.addEventListener('drop', async e => {
                e.preventDefault(); e.stopPropagation(); rc.classList.remove('drop-target');
                if (dragId && dragId !== root.id) await save([{ id: dragId, patch: { vote_order: null, parent_variant_id: root.id } }]);
            });
            listEl.append(rc);

            for (const child of childrenOf(root.id)) {
                const cc = el('div', { class: 'conflict-card conflict-card-child', draggable: 'true' });
                cc.innerHTML = `<span class="conflict-drag-handle" title="Drag to drop zone above to remove from parent">⠿</span><span class="conflict-child-badge">child of #${root.num}</span><span class="conflict-card-body"><span class="conflict-card-title">${esc(child.title || child.operation)}</span> <span class="variant-num">#${child.num}</span></span><button class="conflict-remove-child" title="Remove child relationship">×</button>`;
                cc.addEventListener('dragstart', e => { dragId = child.id; cc.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
                cc.addEventListener('dragend', () => { dragId = null; cc.classList.remove('dragging'); });
                cc.querySelector('.conflict-remove-child').addEventListener('click', async () => {
                    await save([{ id: child.id, patch: { vote_order: null, parent_variant_id: null } }]);
                });
                listEl.append(cc);
            }
        });

        listEl.append(mkDZ(roots.length));

        const unordered = group.filter(v => !v.parent_variant_id && v.vote_order == null);
        if (unordered.length) {
            listEl.append(el('div', { class: 'conflict-unordered-label' },
                `↑ Drag ${unordered.length} unassigned proposal${unordered.length !== 1 ? 's' : ''} into the numbered list above, or drop onto another proposal to make it a child:`
            ));
            for (const v of unordered) {
                const uc = el('div', { class: 'conflict-card conflict-card-unordered', draggable: 'true' });
                uc.innerHTML = `<span class="conflict-drag-handle">⠿</span><span class="conflict-card-body"><span class="conflict-card-title">${esc(v.title || v.operation)}</span> <span class="variant-num">#${v.num}</span><span class="text-muted conflict-card-meta"> · ${esc(v.operation)} · lines ${esc(String(v.line_start || '?'))}–${esc(String(v.line_end || '?'))}</span></span>`;
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
    if (doc.status !== 'final_voting') { location.hash = `#/documents/${docId}/review`; return; }

    const idOrder = Object.fromEntries([...varData.variants].sort((a, b) => a.id - b.id).map((v, i) => [v.id, i + 1]));
    const varMap = Object.fromEntries(varData.variants.map(v => [v.id, { ...v, num: idOrder[v.id] }]));
    const fullText = textData.text || '';
    const blocks = _buildOrderedBlocks(varData.variants, varMap);

    const wrap = el('div', { class: 'page-container' });
    const hdr = el('div', { class: 'page-header' });
    hdr.innerHTML = `<h1 class="page-title">Final voting — <span style="font-weight:400">${esc(doc.title)}</span></h1>`;
    const toolbar = el('div', { class: 'flex gap-1' });
    const csvBtn  = el('button', { class: 'btn btn-ghost btn-sm' }, 'Export CSV');
    const prntBtn = el('button', { class: 'btn btn-ghost btn-sm' }, 'Print HTML');
    const backBtn = el('a', { href: `#/documents/${esc(String(docId))}/review`, class: 'btn btn-ghost btn-sm' }, '← Back to review');
    csvBtn.addEventListener('click', () => _downloadCSV(doc, _buildOrderedBlocks(Object.values(varMap), varMap), fullText));
    prntBtn.addEventListener('click', () => _openPrintHTML(doc, _buildOrderedBlocks(Object.values(varMap), varMap), fullText));
    toolbar.append(csvBtn, prntBtn, backBtn);
    hdr.append(toolbar);
    const progressEl = el('div', { id: 'fv-progress', class: 'fv-progress' });
    hdr.append(progressEl);
    wrap.append(hdr);

    const list = el('div', { class: 'fv-list' });

    function updateProgress() {
        const allItems = blocks.flatMap(b => b.items);
        const done = allItems.filter(i => i.v.final_yes != null || i.v.final_no != null).length;
        progressEl.textContent = `${done} of ${allItems.length} proposals recorded`;
        progressEl.className = `fv-progress${done === allItems.length ? ' fv-progress-done' : ''}`;
    }

    function renderProposalCard(v, isChild, parentNum, blockType, groupNum) {
        const orig = fullText.slice(v.char_start, v.char_end);
        const card = el('div', { class: `fv-card${isChild ? ' fv-card-child' : ''}`, 'data-id': v.id });
        const statusHtml = `<span class="fv-status-badge fv-status-${v.status}">${esc(v.status)}</span>`;
        const orderBadge = !isChild && blockType === 'group' ? `<span class="fv-order-badge">${esc(String(v.vote_order || ''))}</span>` : '';
        const childNote  = isChild ? `<span class="fv-child-note">↳ child of #${esc(String(parentNum))} — voted only if parent fails</span>` : '';
        card.innerHTML = `
<div class="fv-card-header">
  ${orderBadge}<strong class="fv-card-num">#${esc(String(v.num))}</strong>
  <span class="fv-card-title">${esc(v.title || v.operation)}</span>
  ${statusHtml}
  <span class="fv-card-meta text-muted">${esc(v.operation)} · lines ${esc(String(v.line_start || '?'))}–${esc(String(v.line_end || '?'))}</span>
  ${childNote}
</div>
<div class="fv-card-texts">
  <div class="fv-label">Original</div><div class="fv-text">${esc(orig) || '<em class="text-muted">— empty —</em>'}</div>
  <div class="fv-label">Proposed</div><div class="fv-text">${esc(v.new_text) || '<em class="text-muted">— deletion —</em>'}</div>
</div>
<div class="fv-inputs">
  <label>Yes <input class="fv-num-input" type="number" min="0" name="yes" value="${esc(String(v.final_yes ?? ''))}"></label>
  <label>No <input class="fv-num-input" type="number" min="0" name="no" value="${esc(String(v.final_no ?? ''))}"></label>
  <label>Abstain <input class="fv-num-input" type="number" min="0" name="abstain" value="${esc(String(v.final_abstain ?? ''))}"></label>
  <button class="btn btn-sm btn-primary fv-save-btn">Save</button>
  <span class="fv-saved-indicator" style="display:none">✓ Saved</span>
</div>`;
        const saveBtn = card.querySelector('.fv-save-btn');
        const savedInd = card.querySelector('.fv-saved-indicator');
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
                saveBtn.style.display = 'none'; savedInd.style.display = '';
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
            for (const { v, isChild, parentNum } of block.items)
                sec.append(renderProposalCard(v, isChild, parentNum, 'group', block.groupNum));
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

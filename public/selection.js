'use strict';

/* ===== Selection toolbar and sheets (Phase M, 2026-10-29/30) =====
   A floating Propose / Variant bar anchored to the text selection in the document reader,
   the fork modal, the temporary highlight of the selected lines while a sheet is open, and
   the phone sheet following the visual viewport when the keyboard opens.
   Depends on app.js globals: el, esc, api, openModal, closeModal, hasLevel, openProposeModal, showToast. */

const SEL_TOOLBAR_GAP = 8;
const SEL_TOUCH_DEBOUNCE_MS = 350;

let selCtx = null;          // { doc, linesContainer, variants, getSelection, pointerType, snapshot }
let selShowTimer = null;
let selPointerDown = false;
let selToolbarPressedUntil = 0;
let selGlobalsWired = false;

function selectionToolbarEl() {
    let bar = document.getElementById('selection-toolbar');
    if (bar) return bar;
    bar = el('div', { id: 'selection-toolbar', class: 'selection-toolbar hidden', role: 'toolbar', 'aria-label': 'Selection actions' });
    const keepSelection = e => { e.preventDefault(); selToolbarPressedUntil = Date.now() + 500; };
    bar.addEventListener('pointerdown', keepSelection);
    bar.addEventListener('mousedown', keepSelection);
    bar.addEventListener('touchstart', () => { selToolbarPressedUntil = Date.now() + 500; }, { passive: true });
    bar.addEventListener('click', e => {
        const btn = e.target.closest('button[data-action]');
        if (!btn || !selCtx) return;
        const snapshot = selCtx.snapshot;
        hideSelectionToolbar();
        if (btn.dataset.action === 'propose') openProposeModal(selCtx.doc, snapshot, selCtx.onCreated);
        else if (btn.dataset.action === 'variant') openForkFromSelection(parseInt(btn.dataset.variantId));
        else if (btn.dataset.action === 'choose') openVariantChooser(snapshot);
    });
    document.body.append(bar);
    return bar;
}

function wireSelectionToolbar(ctx) {
    hideSelectionToolbar();
    selCtx = { ...ctx, pointerType: null, snapshot: null };
    const lc = ctx.linesContainer;
    lc.addEventListener('pointerdown', e => { selCtx.pointerType = e.pointerType; });
    lc.addEventListener('pointerup', e => { selCtx.pointerType = e.pointerType; scheduleSelectionToolbar(0); });
    lc.addEventListener('mouseup', () => scheduleSelectionToolbar(0));
    lc.addEventListener('touchend', () => { selCtx.pointerType = 'touch'; scheduleSelectionToolbar(0); }, { passive: true });

    if (selGlobalsWired) return;
    selGlobalsWired = true;
    document.addEventListener('selectionchange', () => {
        if (!selCtx) return;
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.toString().trim()) {
            if (Date.now() < selToolbarPressedUntil) return;
            hideSelectionToolbar();
            return;
        }
        if (selPointerDown) return;
        scheduleSelectionToolbar(SEL_TOUCH_DEBOUNCE_MS);
    });
    // A drag may start outside the text panel, so the pointer state is tracked on the document
    document.addEventListener('pointerdown', () => { selPointerDown = true; });
    document.addEventListener('pointerup', () => { selPointerDown = false; });
    document.addEventListener('pointercancel', () => { selPointerDown = false; });
    document.addEventListener('mouseup', () => { selPointerDown = false; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hideSelectionToolbar(); });
    document.addEventListener('scroll', () => { if (selCtx && isSelectionToolbarVisible()) positionSelectionToolbar(); }, { capture: true, passive: true });
    window.addEventListener('resize', () => { if (selCtx && isSelectionToolbarVisible()) positionSelectionToolbar(); });
    window.addEventListener('hashchange', hideSelectionToolbar);
}

function scheduleSelectionToolbar(delayMs) {
    clearTimeout(selShowTimer);
    selShowTimer = setTimeout(showSelectionToolbar, delayMs);
}

function isSelectionToolbarVisible() {
    const bar = document.getElementById('selection-toolbar');
    return !!bar && !bar.classList.contains('hidden');
}

function hideSelectionToolbar() {
    clearTimeout(selShowTimer);
    const bar = document.getElementById('selection-toolbar');
    if (bar) bar.classList.add('hidden');
    if (selCtx) selCtx.snapshot = null;
}

function showSelectionToolbar() {
    if (!selCtx || !document.contains(selCtx.linesContainer)) { hideSelectionToolbar(); return; }
    const selection = selCtx.getSelection();
    if (!selection || !(selection.char_start < selection.char_end)) { hideSelectionToolbar(); return; }
    const native = window.getSelection();
    if (!native || native.rangeCount === 0 || native.isCollapsed || !selCtx.linesContainer.contains(native.anchorNode)) { hideSelectionToolbar(); return; }

    selCtx.snapshot = selection;
    const bar = selectionToolbarEl();
    bar.innerHTML = selectionToolbarHtml(selection);
    bar.classList.remove('hidden');
    positionSelectionToolbar();
}

function selectionToolbarHtml(selection) {
    const forkable = forkableProposalsIn(selection);
    let variantBtn = '';
    if (forkable.length === 1) {
        variantBtn = `<button class="btn btn-ghost btn-sm" id="sel-variant-btn" data-action="variant" data-variant-id="${esc(forkable[0].id)}" title="Same lines as #${esc(forkable[0].proposal_num)}, different wording">Variant of #${esc(forkable[0].proposal_num)}</button>`;
    } else if (forkable.length > 1) {
        variantBtn = `<button class="btn btn-ghost btn-sm" id="sel-variant-btn" data-action="choose" title="Propose a different wording for one of ${esc(forkable.length)} proposals on these lines">Variant…</button>`;
    }
    return `<button class="btn btn-primary btn-sm" id="sel-propose-btn" data-action="propose">Propose</button>${variantBtn}`;
}

// Mirrors canFork on the proposal page: pending/conflict proposals, proposer+ while open,
// supervisor+ during voting. The server enforces the same rule on POST /variants/:id/fork.
function forkableProposalsIn(selection) {
    const doc = selCtx.doc;
    const mayFork = doc.status === 'open' ? hasLevel(doc, 'proposer')
        : ['voting', 'final_voting'].includes(doc.status) && hasLevel(doc, 'supervisor');
    if (!mayFork) return [];
    return (selCtx.variants || []).filter(v =>
        ['pending', 'conflict'].includes(v.status) &&
        v.char_start < selection.char_end && v.char_end > selection.char_start);
}

function positionSelectionToolbar() {
    const bar = document.getElementById('selection-toolbar');
    const native = window.getSelection();
    if (!bar || !native || native.rangeCount === 0 || native.isCollapsed) { hideSelectionToolbar(); return; }
    const rect = native.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) { hideSelectionToolbar(); return; }

    const vw = window.innerWidth, vh = window.innerHeight;
    const header = document.getElementById('app-header');
    const topLimit = header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
    const w = bar.offsetWidth, h = bar.offsetHeight;
    const touch = selCtx.pointerType ? selCtx.pointerType === 'touch' : window.matchMedia('(pointer: coarse)').matches;
    // Mouse: above the selection (editor convention). Touch: below, because iOS and Android
    // draw their own callout above it. Either flips when there is no room.
    let placement = touch ? 'below' : 'above';
    if (placement === 'above' && rect.top - h - SEL_TOOLBAR_GAP < topLimit) placement = 'below';
    if (placement === 'below' && rect.bottom + h + SEL_TOOLBAR_GAP > vh) placement = 'above';
    const top = placement === 'above' ? rect.top - h - SEL_TOOLBAR_GAP : rect.bottom + SEL_TOOLBAR_GAP;
    const left = Math.max(SEL_TOOLBAR_GAP, Math.min(rect.left + rect.width / 2 - w / 2, vw - w - SEL_TOOLBAR_GAP));
    bar.style.top = `${Math.round(top)}px`;
    bar.style.left = `${Math.round(left)}px`;
    bar.dataset.placement = placement;
}

async function openForkFromSelection(variantId) {
    try {
        const data = await api('GET', `/variants/${variantId}`);
        openForkModal(data.variant, selCtx && selCtx.onCreated);
    } catch (err) {
        showToast(err.message || 'Could not load the proposal');
    }
}

function openVariantChooser(selection) {
    const forkable = forkableProposalsIn(selection);
    openModal(`
        <p class="text-muted mb-1">A variant keeps the proposal's lines and only changes the wording. For different lines, use <strong>Propose</strong> instead.</p>
        <div class="sel-variant-choices">
            ${forkable.map(v => `<button class="btn btn-ghost sel-variant-choice" data-variant-id="${esc(v.id)}">Variant of #${esc(v.proposal_num)} <span class="text-muted">${esc(v.title || v.operation)}</span></button>`).join('')}
        </div>
        <div class="form-actions"><button class="btn btn-ghost modal-cancel">Cancel</button></div>
    `, 'Which proposal?');
    document.getElementById('modal-content').addEventListener('click', e => {
        const btn = e.target.closest('.sel-variant-choice');
        if (!btn) return;
        closeModal();
        openForkFromSelection(parseInt(btn.dataset.variantId));
    });
}

/* ===== Fork modal (moved from viewVariant in app.js 2026-10-29; also opened from the toolbar) ===== */
// onCreated: given on the document page (stay put, refresh, toast); absent on the proposal page (navigate)
function openForkModal(v, onCreated) {
    const defaultTitle = `Your variant of ${v.title || v.operation}`;
    const parent = `<div class="fork-parent">
            <div class="fork-parent-head">Variant of ${v.proposal_num ? `#${esc(v.proposal_num)} ` : ''}${esc(v.title || v.operation)}</div>
            <pre>${esc(v.new_text || '')}</pre>
            <div class="text-muted fork-parent-note">Same lines, your wording. Both go to the vote.</div>
        </div>`;
    openModal(`
        ${parent}
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
    if (v.char_start != null && v.char_end != null) markSelectedLines(v);
    document.getElementById('fork-submit-btn').addEventListener('click', async () => {
        const errEl = document.getElementById('fork-err');
        errEl.style.display = 'none';
        try {
            const d = await api('POST', `/variants/${v.id}/fork`, {
                title: document.getElementById('fork-title').value.trim(),
                new_text: document.getElementById('fork-text').value,
                rationale: document.getElementById('fork-rationale').value.trim(),
            });
            closeModal();
            if (onCreated) await onCreated(d.variant);
            else location.hash = `#/variants/${d.variant.id}`;
        } catch (e) { errEl.textContent = e.message; errEl.style.display = ''; }
    });
}

/* ===== Sheets (Phase M.2) =====
   Below 768 px the modal is a bottom sheet (CSS). While it is open the lines of the captured
   range keep a highlight, because focusing the textarea collapses the native selection; and the
   overlay follows the visual viewport so the sheet is not hidden behind the on-screen keyboard. */
function markSelectedLines(range) {
    document.querySelectorAll('#doc-lines-container .line-text').forEach(span => {
        const cs = parseInt(span.dataset.charStart), ce = parseInt(span.dataset.charEnd);
        span.classList.toggle('line-selected', cs < range.char_end && ce > range.char_start);
    });
}

function clearSelectedLines() {
    document.querySelectorAll('.line-selected').forEach(span => span.classList.remove('line-selected'));
}

function fitSheetToViewport() {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;
    const vv = window.visualViewport;
    if (overlay.classList.contains('hidden') || !vv || window.innerWidth > 768) {
        overlay.style.height = '';
        overlay.style.top = '';
        return;
    }
    overlay.style.height = `${Math.round(vv.height)}px`;
    overlay.style.top = `${Math.round(vv.offsetTop)}px`;
}

function wireSheetSupport() {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;
    new MutationObserver(() => {
        if (overlay.classList.contains('hidden')) clearSelectedLines();
        fitSheetToViewport();
    }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', fitSheetToViewport);
        window.visualViewport.addEventListener('scroll', fitSheetToViewport);
    }
}

wireSheetSupport();

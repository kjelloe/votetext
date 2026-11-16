'use strict';

// Injected into every page (context.addInitScript): a drawn pointer that follows the real mouse events
// Playwright dispatches, with a ripple on mousedown. Playwright's video does not show an OS cursor.

const CURSOR_INIT = `(() => {
    const ARROW = '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24"><path d="M5 2 L5 20 L9.5 15.5 L13 22 L15.5 21 L12 14.5 L18 14.5 Z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    const TOUCH = '<div style="width:34px;height:34px;border-radius:50%;background:rgba(17,17,17,.28);border:2px solid rgba(255,255,255,.9)"></div>';
    const touch = window.matchMedia('(pointer: coarse)').matches;
    function ready() {
        if (document.getElementById('tutorial-cursor')) return;
        const style = document.createElement('style');
        style.textContent = '#tutorial-cursor{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;opacity:0;transition:opacity .2s;will-change:transform}'
            + '#tutorial-cursor.touch{margin:-17px 0 0 -17px}'
            + '.tutorial-ripple{position:fixed;z-index:2147483646;pointer-events:none;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;border:3px solid #2563eb;animation:tutorial-ripple .55s ease-out forwards}'
            + '@keyframes tutorial-ripple{from{transform:scale(1);opacity:.9}to{transform:scale(4.5);opacity:0}}'
            + '.tutorial-spot{position:fixed;z-index:2147483645;pointer-events:none;border:3px solid #f59e0b;border-radius:10px;box-shadow:0 0 0 4px rgba(245,158,11,.25);animation:tutorial-spot 1.1s ease-in-out infinite}'
            + '@keyframes tutorial-spot{0%,100%{box-shadow:0 0 0 4px rgba(245,158,11,.25)}50%{box-shadow:0 0 0 10px rgba(245,158,11,.08)}}';
        document.head.appendChild(style);
        const cur = document.createElement('div');
        cur.id = 'tutorial-cursor';
        cur.className = touch ? 'touch' : '';
        cur.innerHTML = touch ? TOUCH : ARROW;
        document.body.appendChild(cur);
        document.addEventListener('mousemove', e => {
            cur.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
            cur.style.opacity = '1';
        }, true);
        document.addEventListener('mousedown', e => {
            const r = document.createElement('div');
            r.className = 'tutorial-ripple';
            r.style.left = e.clientX + 'px';
            r.style.top = e.clientY + 'px';
            document.body.appendChild(r);
            setTimeout(() => r.remove(), 600);
        }, true);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
})();`;

module.exports = { CURSOR_INIT };

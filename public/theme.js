'use strict';

// Applies the stored theme before the first paint (Phase D). Loaded from <head>: the CSP allows no inline
// script. app.js owns the toggle; without a stored choice the stylesheet follows the system scheme.
(function () {
    try {
        var t = localStorage.getItem('vt_theme');
        if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
    } catch (e) {}
})();

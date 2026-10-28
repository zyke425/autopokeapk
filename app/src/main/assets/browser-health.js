/* Read-only foreground page checks, independent of the poke loop and its state. */
(function () {
    'use strict';
    if (window.__autoPokeHealth) return;
    let blankSince = 0, stalledSince = 0;
    const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    function visible(el) {
        if (!el || !el.isConnected || !el.getClientRects().length) return false;
        for (let p = el; p; p = p.parentElement) {
            const s = getComputedStyle(p);
            if (s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) === 0) return false;
        }
        return true;
    }
    function renderedContent() {
        if (!document.body || !visible(document.body)) return false;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node, count = 0;
        while ((node = walker.nextNode()) && count++ < 1500) {
            if (!normalize(node.textContent) || !node.parentElement || node.parentElement.closest('script,style,noscript,template')
                || !visible(node.parentElement)) continue;
            const range = document.createRange(); range.selectNodeContents(node);
            const shown = Array.from(range.getClientRects()).some(r => r.width > 0 && r.height > 0
                && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight);
            range.detach(); if (shown) return true;
        }
        return Array.from(document.querySelectorAll('input:not([type="hidden"]),textarea,select,iframe')).some(visible);
    }
    function read(cfg = {}) {
        const now = Number(cfg.now) || Date.now();
        const result = (kind, ready = false, pokes = false) => ({ kind, ready, pokes });
        if (location.protocol !== 'https:' || !/(^|\.)facebook\.com$/i.test(location.hostname)) return result('offpage');
        if (document.hidden) { blankSince = 0; stalledSince = 0; return result('hidden'); }
        if (/^\/(?:login|checkpoint|recover|two_step_verification|auth_platform)(?:[/.]|$)/i.test(location.pathname)
            || Array.from(document.querySelectorAll('input[type="password"],input[name="email"],input[autocomplete="one-time-code"],iframe[src*="captcha"]')).some(visible)) {
            blankSince = 0; stalledSince = 0; return result('login');
        }
        if (window.__autoPokeBasic && window.__autoPokeBasic.read().state === 'offer') {
            blankSince = 0; stalledSince = 0; return result('basic-setup');
        }
        const exact = /^\/pokes(?:\.php)?\/?$/.test(location.pathname);
        const expected = exact || cfg.pokesExpected === true;
        if ((expected || cfg.browserExpected === true) && !renderedContent()) {
            if (!blankSince) blankSince = now;
            const grace = document.readyState === 'loading' ? 30000 : 10000;
            return result(now - blankSince >= grace ? 'blank' : 'rendering');
        }
        blankSince = 0;
        if (!document.body || document.readyState === 'loading') return result('loading');
        const body = normalize(document.body.innerText);
        const headings = Array.from(document.querySelectorAll('h1,h2,h3,[role="heading"],span'))
            .filter(el => visible(el) && !el.closest('a,button,[role="button"],nav,header'));
        const heading = headings.some(el => normalize(el.textContent) === 'pokes');
        const evidence = /poked you|times in a row|suggested pokes|no pokes|no new pokes|friends who poked you|friends you poked/.test(body)
            || headings.some(el => normalize(el.textContent) === 'suggested');
        const backs = Array.from(document.querySelectorAll('button,a,[role="button"],input[type="submit"]')).some(el => visible(el)
            && /poke\s*back/i.test(el.innerText || el.value || el.getAttribute('aria-label') || el.textContent));
        if ((exact || heading) && (evidence || backs)) { stalledSince = 0; return result('ready', true, true); }
        if (expected) {
            if (!stalledSince) stalledSince = now;
            return result(now - stalledSince >= 45000 ? 'stalled' : 'loading');
        }
        stalledSince = 0;
        return result('content', true);
    }
    function diagnostics() {
        const navigation = performance.getEntriesByType('navigation')[0];
        return {
            documentState: document.readyState,
            htmlCharacters: document.documentElement ? document.documentElement.outerHTML.length : 0,
            bodyElements: document.body ? document.body.childElementCount : 0,
            textCharacters: document.body ? document.body.innerText.length : 0,
            scriptElements: document.scripts.length,
            frames: document.querySelectorAll('iframe').length,
            navigationBodyBytes: navigation && Number.isFinite(navigation.encodedBodySize) ? navigation.encodedBodySize : -1
        };
    }
    window.__autoPokeHealth = { read, diagnostics };
})();

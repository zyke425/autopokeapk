/* Navigate through Facebook's rendered UI, preserving its client-side router. */
(function () {
    'use strict';
    if (window.__autoPokeEntry) return;
    const normalize = v => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();
    function usable(el) {
        if (!el || !el.isConnected || !el.getClientRects().length || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
        if (el.closest('article,[role="article"],[role="feed"],form')) return false;
        for (let p = el; p; p = p.parentElement) {
            const s = getComputedStyle(p);
            if (s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) === 0 || p.hasAttribute('inert')) return false;
        }
        return true;
    }
    const label = el => [el.getAttribute('aria-label'), el.getAttribute('title'), el.innerText, el.textContent].map(normalize);
    function safePokesHref(el) {
        if (!el.hasAttribute('href')) return true;
        try {
            const u = new URL(el.getAttribute('href'), location.href);
            return u.protocol === 'https:' && /^(?:(?:www|m|mbasic|free)\.)?facebook\.com$/i.test(u.hostname)
                && !u.username && !u.password && (!u.port || u.port === '443') && /^\/pokes(?:\.php)?\/?$/.test(u.pathname)
                && !Array.from(u.searchParams.keys()).some(k => /^(?:poke_target|poke|target_id|uid|action|send_poke|fb_dtsg|jazoest)$/i.test(k));
        } catch (_) { return false; }
    }
    function open(cfg = {}) {
        if (location.protocol !== 'https:' || !/(^|\.)facebook\.com$/i.test(location.hostname)) return { kind: 'offpage' };
        const health = window.__autoPokeHealth.read({ now: cfg.now, browserExpected: true, pokesExpected: false });
        if (health.kind === 'login' || health.kind === 'basic-setup' || health.kind === 'hidden'
            || health.kind === 'blank' || health.kind === 'rendering' || health.kind === 'loading') return health;
        if (health.pokes) return { kind: 'existing' };
        if (cfg.awaiting === true) return { kind: 'waiting' };
        const controls = Array.from(document.querySelectorAll('a,button,[role="link"],[role="button"]')).filter(usable);
        const poke = controls.find(el => label(el).some(value => /^pokes(?:\s*\(?[\d,]+\)?)?$/.test(value)) && safePokesHref(el));
        if (poke) { poke.click(); return { kind: 'clicked' }; }
        if (cfg.allowMenu === true) {
            const menu = controls.find(el => label(el).includes('menu') && el.getBoundingClientRect().top < 240);
            if (menu) { menu.click(); return { kind: 'menu' }; }
        }
        return { kind: 'missing' };
    }
    window.__autoPokeEntry = { open };
})();

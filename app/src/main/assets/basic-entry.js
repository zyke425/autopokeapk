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
            if (s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) === 0 || p.hasAttribute('inert')
                || p.disabled || p.getAttribute('aria-disabled') === 'true') return false;
        }
        return true;
    }
    const label = el => [el.getAttribute('aria-label'), el.getAttribute('title'), el.innerText, el.textContent].map(normalize);
    const controls = () => Array.from(document.querySelectorAll('a,button,[role="link"],[role="button"]')).filter(usable);
    function activate(el, clientOnly) {
        if (!clientOnly) { el.click(); return; }
        // Let the site's existing handlers run, then cancel a plain anchor's
        // default GET. The native refresh guard also blocks document navigation.
        const prevent = event => { if (event.composedPath().includes(el)) event.preventDefault(); };
        window.addEventListener('click', prevent);
        try { el.click(); } finally { window.removeEventListener('click', prevent); }
    }
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
        const health = window.__autoPokeHealth.read({ now: cfg.now, browserExpected: true, pokesExpected: false, navigationView: cfg.clientOnly === true });
        if (health.kind === 'login' || health.kind === 'basic-setup' || health.kind === 'hidden'
            || health.kind === 'blank' || health.kind === 'rendering' || health.kind === 'loading') return health;
        if (health.pokes) return { kind: 'existing' };
        if (cfg.awaiting === true) return { kind: 'waiting' };
        const available = controls();
        const poke = available.find(el => label(el).some(value => /^pokes(?:\s*\(?[\d,]+\)?)?$/.test(value)) && safePokesHref(el));
        if (poke) {
            // Keep the site's real navigation address even when its handler opens
            // a Pokes view without updating the document's Home URL.
            const pokesLink = poke.hasAttribute('href') ? new URL(poke.getAttribute('href'), location.href).href : '';
            activate(poke, cfg.clientOnly); return { kind: 'clicked', pokesLink };
        }
        if (cfg.allowMenu === true) {
            const menu = available.find(el => label(el).includes('menu') && el.getBoundingClientRect().top < 240);
            if (menu) { activate(menu, cfg.clientOnly); return { kind: 'menu' }; }
        }
        return { kind: 'missing' };
    }
    let session;
    function fingerprint() {
        const text = document.body ? document.body.innerText : '';
        let hash = 2166136261;
        for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
        return hash >>> 0;
    }
    function heading() {
        return Array.from(document.querySelectorAll('h1,h2,h3,[role="heading"],span'))
            .find(el => usable(el) && !el.closest('a,button,[role="button"]') && normalize(el.textContent) === 'pokes');
    }
    function refresh(cfg = {}) {
        const now = Number(cfg.now) || Date.now();
        const health = window.__autoPokeHealth.read({now, browserExpected:true, navigationView:true});
        if (!session || session.id !== cfg.cycle) session = {id:cfg.cycle, at:now, epoch:cfg.epoch, phase:'start', menu:false};
        if (session.epoch !== cfg.epoch) { session.epoch = cfg.epoch; session.at = now; }
        const result = kind => ({kind, phase:session.phase, pokes:health.pokes === true});
        if (['offpage','hidden','login','basic-setup'].includes(health.kind)) { session.at = now; return result(health.kind); }
        if (session.phase === 'done') return result('existing');
        if (session.phase === 'unavailable') return result('refresh-unavailable');
        if (now - session.at >= 30000) { session.phase = 'unavailable'; return result('refresh-unavailable'); }
        if (['rendering','blank','loading','stalled'].includes(health.kind)) return result('refreshing');
        if (session.phase === 'start' && health.pokes) {
            session.heading = heading(); session.fingerprint = fingerprint();
            const available = controls().filter(el => el.getBoundingClientRect().top < 240);
            const reload = available.find(el => label(el).some(v => /^(?:refresh|reload)(?: pokes)?$/.test(v)) && safePokesHref(el));
            const back = available.find(el => label(el).some(v => /^(?:(?:go )?back|[←‹❮])$/.test(v)));
            const poke = available.find(el => label(el).some(v => /^pokes(?:\s*\(?[\d,]+\)?)?$/.test(v)) && safePokesHref(el));
            const target = reload || back || poke;
            if (!target) { session.phase = 'unavailable'; return result('refresh-unavailable'); }
            session.phase = target === back ? 'back' : 'settling';
            session.at = now; activate(target, true);
            return result('refreshing');
        }
        if (session.phase === 'start') session.phase = 'entry';
        if (session.phase === 'back') {
            if (health.pokes) return result('refreshing');
            session.phase = 'entry';
        }
        if (session.phase === 'entry') {
            const entry = open({now, allowMenu:!session.menu, clientOnly:true});
            if (entry.kind === 'menu') session.menu = true;
            if (entry.kind === 'clicked') { session.phase = 'settling'; session.at = now; session.departed = true; }
            if (entry.kind === 'missing') { session.phase = 'unavailable'; return result('refresh-unavailable'); }
            return {...result('refreshing'), pokesLink:entry.pokesLink || ''};
        }
        if (session.phase === 'settling') {
            if (!health.pokes) session.departed = true;
            const changed = session.departed || session.heading !== heading() || session.fingerprint !== fingerprint();
            if (health.pokes && changed && now - session.at >= 750) { session.phase = 'done'; return result('existing'); }
        }
        return result('refreshing');
    }
    window.__autoPokeEntry = { open, refresh };
})();

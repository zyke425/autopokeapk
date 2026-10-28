/* Adapted from the user's Facebook Autopoke GUI 2.12 flow.
 * Native Android owns scheduling and persistence. No native JS bridge is exposed.
 * Only rendered Poke back controls are clicked; no API calls are constructed.
 */
(function () {
    'use strict';
    if (window.__autoPokeAndroid) return;
    const SELECTOR = 'button,[role="button"],a,input[type="submit"],input[type="button"]';
    const normalize = value => String(value || '')
        .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufe0e\ufe0f\ufeff]/g, '')
        .replace(/\s+/g, ' ').trim().toLowerCase();
    const isBackLabel = value => /^[\p{S}\p{P}\s]*poke\s*back[\p{S}\p{P}\s]*$/u.test(normalize(value));
    const isBack = el => [el.innerText, el.textContent, el.value,
        el.getAttribute('aria-label'), el.getAttribute('title')].some(isBackLabel);
    function visible(el) {
        if (!el || !el.isConnected || !el.getClientRects().length) return false;
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) !== 0;
    }
    function usable(el) {
        for (let p = el; p && p !== document.body; p = p.parentElement) {
            if (p.disabled || p.getAttribute('aria-disabled') === 'true' || p.hasAttribute('inert') || !visible(p)) return false;
        }
        return visible(el);
    }
    const backs = root => {
        const list = Array.from(root.querySelectorAll(SELECTOR)).filter(isBack);
        // Keep the inner actionable node when a role=button wraps a real button/link.
        return list.filter(el => !list.some(other => other !== el && el.contains(other)));
    };
    function hash(text) {
        let a = 2166136261, b = 5381;
        for (let i = 0; i < text.length; i++) {
            a = Math.imul(a ^ text.charCodeAt(i), 16777619);
            b = Math.imul(b, 33) ^ text.charCodeAt(i);
        }
        return (a >>> 0).toString(36) + (b >>> 0).toString(36);
    }
    function person(button) {
        let row = null, profile = null;
        for (let el = button.parentElement, depth = 0; el && depth < 10; el = el.parentElement, depth++) {
            if (backs(el).length > 1) break;
            const link = Array.from(el.querySelectorAll('a[href]')).find(a => {
                if (isBack(a) || !normalize(a.textContent)) return false;
                try {
                    const url = new URL(a.getAttribute('href'), location.href);
                    return url.protocol === 'https:' && /(^|\.)facebook\.com$/i.test(url.hostname)
                        && !/^\/(?:pokes|help|privacy|login|settings|friends)(?:[/.]|$)/i.test(url.pathname);
                } catch (_) { return false; }
            });
            if (link) { row = el; profile = link; break; }
            const text = normalize(el.innerText || el.textContent);
            if (/poked you|times in a row/.test(text) && text.replace(/poke\s*back|poked you|times in a row|[\d,\s]/g, '')) { row = el; break; }
        }
        if (!row) return null;
        let text = normalize(row.innerText || row.textContent).replace(/poke\s*back/g, '').trim();
        let identity = text;
        if (profile) {
            const url = new URL(profile.getAttribute('href'), location.href);
            identity = url.pathname + (url.searchParams.has('id') ? '?id=' + url.searchParams.get('id') : '');
        }
        const counter = text.match(/[\d,]+\s+(?:pokes?|times in a row)\b/);
        // Relative timestamps do not represent a new poke.
        text = text.replace(/\b\d+\s*(?:s|m|h|d|sec(?:ond)?s?|min(?:ute)?s?|hours?|days?|weeks?)\s*(?:ago)?\b/g, '').trim();
        return { button, identity: hash(identity), key: hash(identity + '|' + (counter ? counter[0] : text)) };
    }
    let state = null, pending = null, readySince = 0, recoveryUntil = 0;
    let dirty = false, networkRestricted = false, networkError = false;
    function readErrors(value) {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) { value.forEach(readErrors); return; }
        if (Array.isArray(value.errors) && value.errors.length) {
            networkError = true;
            if (value.errors.some(e => e && (Number(e.code) === 1675004 || /rate limit|temporarily blocked|we limit how often/i.test(e.message || '')))) networkRestricted = true;
        }
        if (value.payload) readErrors(value.payload);
    }
    function inspect(text) {
        if (typeof text !== 'string' || text.length > 1000000) return;
        text = text.replace(/^\s*for\s*\(\s*;\s*;\s*\)\s*;\s*/, '');
        try { readErrors(JSON.parse(text)); } catch (_) {
            for (const line of text.split('\n')) { try { readErrors(JSON.parse(line)); } catch (_) {} }
        }
    }
    function graphql(value) {
        try {
            const url = new URL(value, location.href);
            return /(^|\.)facebook\.com$/i.test(url.hostname) && /^\/(?:api\/)?graphql\/?$/.test(url.pathname);
        } catch (_) { return false; }
    }
    // Observe errors from the page's own requests. Do not retain request/response data.
    if (typeof window.fetch === 'function') {
        const original = window.fetch;
        window.fetch = function (...args) {
            const track = graphql(args[0] && args[0].url || args[0]);
            return original.apply(this, args).then(response => {
                if (track) {
                    if (!response.ok) { networkError = true; if (response.status === 429) networkRestricted = true; }
                    response.clone().text().then(inspect, () => { networkError = true; });
                }
                return response;
            }, error => { if (track) networkError = true; throw error; });
        };
    }
    if (window.XMLHttpRequest) {
        const proto = window.XMLHttpRequest.prototype, open = proto.open, send = proto.send;
        const urls = new WeakMap();
        proto.open = function (method, url, ...rest) { urls.set(this, url); return open.call(this, method, url, ...rest); };
        proto.send = function (...args) {
            if (graphql(urls.get(this))) this.addEventListener('loadend', () => {
                if (this.status < 200 || this.status >= 300) networkError = true;
                if (this.status === 429) networkRestricted = true;
                try {
                    if (this.responseType === 'json') readErrors(this.response);
                    else if (!this.responseType || this.responseType === 'text') inspect(this.responseText);
                } catch (_) { networkError = true; }
            }, { once: true });
            return send.apply(this, args);
        };
    }
    function tick(cfg) {
        const now = Number(cfg.now) || Date.now();
        if (!state) {
            const saved = cfg.state || {};
            state = { attempts: Math.max(0, Number(saved.attempts) || 0), nextAt: Number(saved.nextAt) || 0,
                held: saved.held === true, records: Array.isArray(saved.records) ? saved.records.slice(-300) : [] };
        }
        const refreshMs = Math.max(1000, Math.min(300000, Number(cfg.refreshMs) || 1000));
        const gapMs = Math.max(5000, Math.min(300000, Number(cfg.gapMs) || 7000));
        const result = (kind, message, extra = {}) => {
            const value = { kind, message, attempts: state.attempts, detected: 0, ...extra };
            if (dirty) { value.state = JSON.parse(JSON.stringify(state)); dirty = false; }
            return value;
        };
        if (!/^https:$/.test(location.protocol) || !/(^|\.)facebook\.com$/i.test(location.hostname)) return result('offpage', 'Open Facebook Pokes to begin.');
        if (!cfg.running || document.hidden) { readySince = 0; return result('paused', 'Paused. Tap Start when ready.'); }
        if (state.held) return result('restricted', 'Facebook reported a restriction. Check it manually before resuming.');
        if (/^\/(?:login|checkpoint|recover|two_step_verification|auth_platform)(?:[/.]|$)/i.test(location.pathname)
            || Array.from(document.querySelectorAll('input[type="password"]')).some(visible)) {
            readySince = 0; return result('login', 'Sign in to Facebook, then tap Open Pokes.');
        }
        if (document.readyState !== 'complete' || !document.body) { readySince = 0; return result('loading', 'Waiting for Facebook to finish loading…'); }
        const buttons = backs(document).filter(visible);
        const headings = Array.from(document.querySelectorAll('h1,h2,h3,[role="heading"]'));
        const exactRoute = /(?:^|\/)pokes(?:\.php)?\/?$/.test(location.pathname);
        const heading = headings.some(el => visible(el) && normalize(el.textContent) === 'pokes')
            || Array.from(document.querySelectorAll('span')).some(el => visible(el) && normalize(el.textContent) === 'pokes');
        const bodyText = normalize(document.body.innerText);
        const evidence = /friends you poked|friends who poked you|poked you|suggested pokes|no pokes|no new pokes|\d[\d,]*\s+pokes\b/.test(bodyText)
            || headings.some(el => visible(el) && normalize(el.textContent) === 'suggested');
        // Path alone is insufficient: don't reload an unrendered shell forever.
        if (!((exactRoute || (heading && evidence)) && (buttons.length || evidence))) {
            readySince = 0;
            return result('offpage', exactRoute ? 'Waiting for the Pokes view to render…' : 'Tap Open Pokes. The loop resumes on the Pokes page.');
        }
        const warning = Array.from(document.querySelectorAll('[role="alert"],[role="dialog"]')).find(el => visible(el)
            && /rate limit exceeded|temporarily blocked|try again later|going too fast|we limit how often/i.test(el.textContent || ''));
        if (networkRestricted || warning) {
            state.held = true; dirty = true; pending = null;
            return result('restricted', 'Facebook reported a restriction. Auto-poking and refresh are paused.');
        }
        if (networkError && pending) {
            pending = null; networkError = false; recoveryUntil = now + 30000; readySince = 0;
        }
        if (now < recoveryUntil) return result('waiting', 'A Facebook request failed. Retrying in ' + Math.ceil((recoveryUntil - now) / 1000) + 's.');
        if (recoveryUntil) { recoveryUntil = 0; readySince = now; return result('refresh', 'Reloading after the temporary error.'); }
        const items = buttons.map(person).filter(Boolean);
        if (pending) {
            const unchanged = items.some(item => item.key === pending.key && usable(item.button));
            const elapsed = now - pending.sentAt;
            if (elapsed >= refreshMs && (!unchanged || elapsed >= 12000)) {
                pending = null; readySince = 0;
                return result('refresh', 'Refreshing Pokes after the click.', { detected: buttons.length });
            }
            return result('waiting', 'Click attempted. Waiting for the row to update…', { detected: buttons.length });
        }
        const item = items.find(item => {
            const record = state.records.find(r => r.key === item.key);
            return usable(item.button) && (!record || (record.tries < 2 && record.readyAt <= now));
        });
        if (item) {
            readySince = 0;
            if (now < state.nextAt) return result('waiting', 'Poke back found. Next attempt in ' + Math.ceil((state.nextAt - now) / 1000) + 's.', { detected: buttons.length });
            let record = state.records.find(r => r.key === item.key);
            if (!record) { record = { key: item.key, tries: 0, readyAt: 0 }; state.records.push(record); }
            record.tries++; record.readyAt = now + 180000;
            state.records = state.records.slice(-300);
            state.nextAt = now + gapMs;
            pending = { key: item.key, sentAt: now };
            networkError = false;
            dirty = true;
            try { item.button.click(); state.attempts++; }
            catch (_) { pending = null; return result('error', 'The control could not be clicked. Stop and check Facebook.'); }
            return result('clicked', 'Poke-back click attempted.', { detected: buttons.length });
        }
        // Even deferred unchanged rows refresh, so a new incoming poke can appear.
        if (!readySince) readySince = now;
        if (now - readySince >= refreshMs) { readySince = 0; return result('refresh', 'Refreshing to look for new poke backs.', { detected: buttons.length }); }
        return result('watching', buttons.length ? 'Waiting for an eligible Poke back. Refreshing shortly…' : 'Watching for Poke back. Refreshing shortly…', { detected: buttons.length });
    }
    window.__autoPokeAndroid = { tick };
})();

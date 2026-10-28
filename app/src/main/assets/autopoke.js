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
    const withoutTime = text => text.replace(/\b\d+\s*(?:s|m|h|d|sec(?:ond)?s?|min(?:ute)?s?|hours?|days?|weeks?)\s*(?:ago)?\b/g, '').trim();
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
        let identity = withoutTime(text).replace(/[\d,]+\s+(?:pokes?|times in a row)\b/g, '').trim();
        if (profile) {
            const url = new URL(profile.getAttribute('href'), location.href);
            identity = url.pathname + (url.searchParams.has('id') ? '?id=' + url.searchParams.get('id') : '');
        }
        const counter = text.match(/[\d,]+\s+(?:pokes?|times in a row)\b/);
        // Relative timestamps do not represent a new poke.
        text = withoutTime(text);
        return { button, identity: hash(identity), key: hash(identity + '|' + (counter ? counter[0] : text)) };
    }
    let state = null, pending = null, prepared = null, authorizedToken = null;
    let readySince = 0, stalledSince = 0, healthySince = 0, blankSince = 0;
    let dirty = false, networkRestricted = false, networkError = false, networkInFlight = 0;
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
            if (track) networkInFlight++;
            let request;
            try { request = original.apply(this, args); }
            catch (error) { if (track) { networkInFlight--; networkError = true; } throw error; }
            return request.then(response => {
                if (track) {
                    if (!response.ok) { networkError = true; if (response.status === 429) networkRestricted = true; }
                    try {
                        response.clone().text().then(inspect, () => { networkError = true; })
                            .finally(() => { networkInFlight--; });
                    } catch (_) { networkInFlight--; networkError = true; }
                }
                return response;
            }, error => { if (track) { networkInFlight--; networkError = true; } throw error; });
        };
    }
    if (window.XMLHttpRequest) {
        const proto = window.XMLHttpRequest.prototype, open = proto.open, send = proto.send;
        const urls = new WeakMap();
        proto.open = function (method, url, ...rest) { urls.set(this, url); return open.call(this, method, url, ...rest); };
        proto.send = function (...args) {
            const track = graphql(urls.get(this));
            let settled = false;
            const finish = () => { if (track && !settled) { settled = true; networkInFlight--; } };
            if (track) {
                networkInFlight++;
                this.addEventListener('loadend', () => {
                if (this.status < 200 || this.status >= 300) networkError = true;
                if (this.status === 429) networkRestricted = true;
                try {
                    if (this.responseType === 'json') readErrors(this.response);
                    else if (!this.responseType || this.responseType === 'text') inspect(this.responseText);
                } catch (_) { networkError = true; }
                finish();
                }, { once: true });
            }
            try { return send.apply(this, args); }
            catch (error) { if (track) networkError = true; finish(); throw error; }
        };
    }
    function tick(cfg) {
        const now = Number(cfg.now) || Date.now();
        if (!state) {
            const saved = cfg.state || {};
            state = { attempts: Math.max(0, Number(saved.attempts) || 0), nextAt: Number(saved.nextAt) || 0,
                held: saved.held === true,
                idleRounds: Math.max(0, Math.min(6, Number(saved.idleRounds) || 0)),
                failures: Math.max(0, Math.min(5, Number(saved.failures) || 0)), retryAt: Number(saved.retryAt) || 0,
                records: Array.isArray(saved.records) ? saved.records.filter(r => r && typeof r.key === 'string').slice(-300) : [] };
        }
        const refreshMs = Math.max(1000, Math.min(300000, Number(cfg.refreshMs) || 1000));
        const gapMs = Math.max(5000, Math.min(300000, Number(cfg.gapMs) || 7000));
        const result = (kind, message, extra = {}) => {
            const value = { kind, message, attempts: state.attempts, detected: 0, ...extra };
            if (dirty) { value.state = JSON.parse(JSON.stringify(state)); dirty = false; }
            return value;
        };
        if (!/^https:$/.test(location.protocol) || !/(^|\.)facebook\.com$/i.test(location.hostname)) return result('offpage', 'Open Facebook Pokes to begin.');
        if (!cfg.running || document.hidden) { readySince = 0; stalledSince = 0; blankSince = 0; return result('paused', 'Paused. Tap Start when ready.'); }
        if (state.held) return result('restricted', 'Facebook reported a restriction. Check it manually before resuming.');
        const warning = Array.from(document.querySelectorAll('[role="alert"],[role="dialog"],h1,h2')).find(el => visible(el)
            && /rate limit exceeded|temporarily blocked|try again later|going too fast|we limit how often/i.test(el.textContent || ''));
        if (networkRestricted || warning) {
            state.held = true; dirty = true; pending = null; prepared = null;
            return result('restricted', 'Facebook reported a restriction. Auto-poking and refresh are paused.');
        }
        if (/^\/(?:login|checkpoint|recover|two_step_verification|auth_platform)(?:[/.]|$)/i.test(location.pathname)
            || Array.from(document.querySelectorAll('input[type="password"],input[name="email"],input[autocomplete="one-time-code"],iframe[src*="captcha"]')).some(visible)) {
            blankSince = 0;
            readySince = 0; return result('login', 'Sign in to Facebook, then tap Open Pokes.');
        }
        if (pending && now - pending.sentAt >= 90000) {
            pending = null; prepared = null;
            return result('error', 'The poke result is still unknown after 90s. Loop paused; check Facebook manually.');
        }
        if (networkError) {
            pending = null; prepared = null; networkError = false; healthySince = 0;
            state.failures = Math.min(5, state.failures + 1);
            state.retryAt = now + Math.min(300000, 30000 * Math.pow(2, state.failures - 1));
            readySince = 0; dirty = true;
        }
        if (now < state.retryAt) return result('waiting', 'A Facebook request failed. Retrying in ' + Math.ceil((state.retryAt - now) / 1000) + 's.');
        if (state.retryAt) { state.retryAt = 0; dirty = true; return result('refresh', 'Reloading after the temporary error.'); }
        if (document.readyState !== 'complete' || !document.body) { readySince = 0; return result('loading', 'Waiting for Facebook to finish loading…'); }
        const exactRoute = /(?:^|\/)pokes(?:\.php)?\/?$/.test(location.pathname);
        const bodyText = normalize(document.body.innerText);
        const hiddenRoot = [document.documentElement, document.body].some(el => {
            const style = getComputedStyle(el);
            return style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0;
        });
        const empty = hiddenRoot || (!bodyText && !Array.from(document.querySelectorAll('input:not([type="hidden"]),textarea,select')).some(visible));
        if (empty && (exactRoute || cfg.pokesExpected === true)) {
            readySince = 0;
            // An optimistic UI update can temporarily remove the whole list.
            // Keep the request and the durable guard intact until it finishes.
            if (pending && networkInFlight) { blankSince = 0; return result('waiting', 'Waiting for Facebook’s request to finish…'); }
            if (!blankSince) blankSince = now;
            if (now - blankSince >= 10000) return result('blank', 'Facebook returned a blank page. Recovering the browser…', { blank: true });
            return result('rendering', 'Facebook is loading. Checking the blank page…', { blank: true });
        }
        blankSince = 0;
        const buttons = backs(document).filter(visible);
        const headings = Array.from(document.querySelectorAll('h1,h2,h3,[role="heading"]'));
        const heading = headings.some(el => visible(el) && normalize(el.textContent) === 'pokes')
            || Array.from(document.querySelectorAll('span')).some(el => visible(el) && normalize(el.textContent) === 'pokes');
        const evidence = /friends you poked|friends who poked you|poked you|suggested pokes|no pokes|no new pokes|\d[\d,]*\s+pokes\b/.test(bodyText)
            || headings.some(el => visible(el) && normalize(el.textContent) === 'suggested');
        // Path alone is insufficient: don't reload an unrendered shell forever.
        if (!((exactRoute || (heading && evidence)) && (buttons.length || evidence))) {
            readySince = 0;
            if (pending && networkInFlight) return result('waiting', 'Waiting for Facebook’s request to finish…');
            if (exactRoute) {
                if (!stalledSince) stalledSince = now;
                if (now - stalledSince >= 45000) return result('stalled', 'The Pokes view did not finish rendering.');
            } else stalledSince = 0;
            return result('offpage', exactRoute ? 'Waiting for the Pokes view to render…' : 'Tap Open Pokes. The loop resumes on the Pokes page.');
        }
        stalledSince = 0;
        if (!healthySince) healthySince = now;
        if (state.failures && !networkInFlight && now - healthySince >= 30000) { state.failures = 0; dirty = true; }
        const items = buttons.map(person).filter(Boolean);
        if (prepared) {
            if (now - prepared.at >= 15000) { prepared = null; return result('watching', 'The saved click expired. Watching for a new eligible poke.'); }
            if (authorizedToken !== prepared.token) return result('waiting', 'Preparing poke back…');
            const action = prepared; prepared = null;
            const current = person(action.button);
            if (!current || current.key !== action.key || !usable(action.button)) return result('watching', 'The row changed before the click. Scanning again.');
            pending = { key: action.key, sentAt: now };
            state.nextAt = Math.max(state.nextAt, now + gapMs);
            state.attempts++; dirty = true; networkError = false;
            try { action.button.click(); }
            catch (_) { pending = null; return result('error', 'The control could not be clicked. Stop and check Facebook.'); }
            return result('clicked', 'Poke-back click attempted.', { detected: buttons.length });
        }
        if (pending) {
            const unchanged = items.some(item => item.key === pending.key && usable(item.button));
            const elapsed = now - pending.sentAt;
            if (elapsed >= refreshMs && !networkInFlight && (!unchanged || elapsed >= 12000)) {
                pending = null; readySince = 0;
                return result('refresh', 'Refreshing Pokes after the click.', { detected: buttons.length });
            }
            return result('waiting', networkInFlight ? 'Click attempted. Waiting for Facebook’s request to finish…' : 'Click attempted. Waiting for the row to update…', { detected: buttons.length });
        }
        const item = items.find(item => {
            const record = state.records.find(r => r.key === item.key);
            return usable(item.button) && (!record || (record.tries < 2 && record.readyAt <= now));
        });
        if (item) {
            readySince = 0;
            if (state.idleRounds) { state.idleRounds = 0; dirty = true; }
            if (now < state.nextAt) return result('waiting', 'Poke back found. Next attempt in ' + Math.ceil((state.nextAt - now) / 1000) + 's.', { detected: buttons.length });
            let record = state.records.find(r => r.key === item.key);
            if (!record) { record = { key: item.key, tries: 0, readyAt: 0 }; state.records.push(record); }
            record.tries++; record.readyAt = now + 180000;
            state.records = state.records.slice(-300);
            state.nextAt = now + gapMs;
            networkError = false;
            dirty = true;
            const token = hash(item.key + '|' + now + '|' + record.tries);
            prepared = { token, button: item.button, key: item.key, at: now };
            // Android must durably save the returned guard before calling execute().
            return result('prepared', 'Preparing poke back…', { token, detected: buttons.length });
        }
        // Even deferred unchanged rows refresh, so a new incoming poke can appear.
        if (!readySince) readySince = now;
        const idleDelay = cfg.adaptive === false ? refreshMs : Math.max(refreshMs, Math.min(60000, refreshMs * Math.pow(2, state.idleRounds)));
        if (now - readySince >= idleDelay) {
            readySince = 0; state.idleRounds = Math.min(6, state.idleRounds + 1); dirty = true;
            return result('refresh', 'Refreshing to look for new poke backs.', { detected: buttons.length });
        }
        return result('watching', 'Watching for an eligible Poke back. Refresh in ' + Math.ceil((idleDelay - (now - readySince)) / 1000) + 's.', { detected: buttons.length });
    }
    window.__autoPokeAndroid = { tick, execute(cfg, token) {
        if (!prepared || prepared.token !== token) return { kind: 'waiting', message: 'The saved click is no longer available.', attempts: state ? state.attempts : 0 };
        authorizedToken = token;
        try { return tick(cfg); } finally { authorizedToken = null; }
    } };
})();

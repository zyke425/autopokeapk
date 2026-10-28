/* Read Facebook's own carrier UI. Never opt in, buy data, or change a mode. */
(function () {
    'use strict';
    if (window.__autoPokeBasic) return;
    const normalize = value => String(value || '').replace(/[\u200b-\u200f\ufeff]/g, '')
        .replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim().toLowerCase().replace(/^[\p{S}\p{P}\s]+/u, '');
    const modeLabel = /^(?:basic mode(?: plus)?|free mode|text[- ]only mode|data mode)$/;
    const offerTitle = /^you(?:'re| are) out of data,? but (?:you )?can still use facebook[.!]?$/;
    const text = el => normalize(el.innerText || el.textContent || el.getAttribute('aria-label'));
    function visible(el) {
        if (!el || !el.isConnected || !el.getClientRects().length) return false;
        for (let p = el; p; p = p.parentElement) {
            const style = getComputedStyle(p);
            if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
        }
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
    }
    const inFeed = el => !!el.closest('article,[role="article"],[role="feed"]');
    const actions = el => Array.from(el.querySelectorAll('button,a,[role="button"],input[type="submit"]'))
        .filter(visible).map(node => normalize(node.innerText || node.value || node.getAttribute('aria-label') || node.textContent));
    function read() {
        if (location.protocol !== 'https:' || !/(^|\.)facebook\.com$/i.test(location.hostname) || !document.body) return { state: 'unknown' };
        const candidates = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node, inspected = 0;
        while ((node = walker.nextNode()) && inspected++ < 3000) {
            const raw = node.textContent;
            if (!raw || raw.length > 240) continue;
            const fragment = normalize(raw);
            if (!/^(?:basic|free|text|data)\b|^you(?:'re| are) out of/.test(fragment)) continue;
            const parent = node.parentElement;
            if ((modeLabel.test(fragment) || offerTitle.test(fragment)) && parent && parent !== document.body
                && visible(parent) && !inFeed(parent)) {
                candidates.push({ el: parent, value: fragment }); continue;
            }
            // Labels can be split across nested spans. Only inspect the few short
            // ancestors of a possible label, rather than styling every feed node.
            for (let el = node.parentElement, depth = 0; el && depth < 4; el = el.parentElement, depth++) {
                if (el === document.body || inFeed(el) || el.textContent.length > 240) break;
                const value = text(el);
                if ((modeLabel.test(value) || offerTitle.test(value)) && visible(el)) {
                    candidates.push({ el, value }); break;
                }
            }
        }
        // Match the actual out-of-data offer and its Continue control. Generic
        // retry messages and ordinary posts never pause or activate anything.
        for (const { el, value: title } of candidates) {
            if (title.length > 160 || !offerTitle.test(title)) continue;
            for (let box = el, depth = 0; box && depth < 6; box = box.parentElement, depth++) {
                if (box === document.body || inFeed(box)) break;
                const content = text(box);
                if (content.length > 1600) break;
                if (actions(box).some(label => label === 'continue')) return { state: 'offer' };
            }
        }
        // An exact label near the top is evidence only when it shares a small
        // container with Facebook's carrier-mode actions, as in its native bar.
        for (const { el, value: label } of candidates) {
            const mode = /^(?:basic mode(?: plus)?|free mode|text[- ]only mode)$/.test(label) ? 'basic'
                : label === 'data mode' ? 'data' : null;
            const rect = el.getBoundingClientRect();
            if (!mode || rect.top < -10 || rect.top > 160 || rect.bottom <= 0) continue;
            for (let bar = el, depth = 0; bar && depth < 4; bar = bar.parentElement, depth++) {
                if (bar === document.body || inFeed(bar) || text(bar).length > 400) break;
                if (actions(bar).some(action => /^(?:buy data|go to free|go to data|see photos|use data|data mode)$/.test(action))) {
                    return { state: mode, label: mode === 'basic' ? label === 'basic mode plus' ? 'Basic mode plus' : 'Basic mode' : 'Data mode' };
                }
            }
        }
        return { state: 'unknown' };
    }
    function pokesLink() {
        if (location.protocol !== 'https:' || !/(^|\.)facebook\.com$/i.test(location.hostname)) return '';
        for (const link of document.querySelectorAll('a[href]')) {
            if (!visible(link) || text(link) !== 'pokes') continue;
            try {
                const url = new URL(link.getAttribute('href'), location.href);
                if (url.protocol === 'https:' && /^(?:(?:www|m|mbasic|free)\.)?facebook\.com$/i.test(url.hostname)
                    && !url.username && !url.password && (!url.port || url.port === '443')
                    && /^\/pokes(?:\.php)?\/?$/.test(url.pathname)
                    && !Array.from(url.searchParams.keys()).some(k => /^(?:poke_target|poke|target_id|uid|action|send_poke|fb_dtsg|jazoest)$/i.test(k))) {
                    url.hash = ''; return url.href;
                }
            } catch (_) { }
        }
        return '';
    }
    window.__autoPokeBasic = { read, pokesLink };
})();

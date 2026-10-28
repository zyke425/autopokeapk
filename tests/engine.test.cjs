const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const script = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/autopoke.js'), 'utf8');
let browser;
const start = 1800000000000;
before(async () => { browser = await chromium.launch({ headless: true, executablePath: process.env.AUTOPOKE_TEST_BROWSER || undefined }); });
after(async () => { await browser?.close(); });

const row = (name = 'Alex', count = 19, action = 'Poke back') => `<article class="person"><a href="https://www.facebook.com/${name.toLowerCase()}">${name}</a><span>${count} pokes · poked you 19m ago</span><button onclick="window.clicks=(window.clicks||0)+1;this.disabled=true">${action}</button></article>`;
const pageHtml = body => `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>Pokes</h1>${body}</body></html>`;
async function fixture(html, url = 'https://www.facebook.com/pokes?ref=search') {
    const context = await browser.newContext();
    await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: html }));
    const page = await context.newPage();
    await page.goto(url);
    await page.evaluate(script);
    const config = (now = start, changes = {}) => ({
        running: true, refreshMs: 1000, gapMs: 7000, now, state: {}, ...changes
    });
    const rawTick = (now = start, changes = {}) => page.evaluate(cfg => window.__autoPokeAndroid.tick(cfg), config(now, changes));
    const execute = (token, now = start, changes = {}) => page.evaluate(({cfg, token}) => window.__autoPokeAndroid.execute(cfg, token), { cfg: config(now, changes), token });
    const tick = async (now = start, changes = {}) => {
        const reservation = await rawTick(now, changes);
        if (reservation.kind !== 'prepared') return reservation;
        // Simulate Android's durable journal boundary before executing the token.
        assert.ok(reservation.state?.records.length, 'a guard must be returned before a click');
        return execute(reservation.token, now, changes);
    };
    return { context, page, tick, rawTick, execute };
}

test('clicks Poke back and never suggested Poke', async () => {
    const f = await fixture(pageHtml(row() + row('Ben', 4, 'Poke')));
    try {
        const r = await f.tick(); assert.equal(r.kind, 'clicked'); assert.equal(r.attempts, 1);
        assert.equal(await f.page.evaluate(() => clicks), 1);
        assert.equal(await f.page.locator('button').nth(1).isDisabled(), false);
    } finally { await f.context.close(); }
});
test('Start is required and Stop prevents clicks and refreshes', async () => {
    const f = await fixture(pageHtml(row()));
    try {
        assert.equal((await f.tick(start, { running: false })).kind, 'paused');
        assert.equal(await f.page.evaluate(() => window.clicks || 0), 0);
        await f.tick();
        assert.equal((await f.tick(start + 10000, { running: false })).kind, 'paused');
    } finally { await f.context.close(); }
});
test('idle refresh respects the adjustable delay after render', async () => {
    const f = await fixture(pageHtml('<h2>Suggested</h2>' + row('Ben', 4, 'Poke')));
    try {
        assert.equal((await f.tick(start, { refreshMs: 3000 })).kind, 'watching');
        assert.equal((await f.tick(start + 2999, { refreshMs: 3000 })).kind, 'watching');
        assert.equal((await f.tick(start + 3000, { refreshMs: 3000 })).kind, 'refresh');
    } finally { await f.context.close(); }
});
test('post-click refresh waits for row update and configured delay', async () => {
    const f = await fixture(pageHtml(row()));
    try {
        await f.tick();
        assert.equal((await f.tick(start + 999)).kind, 'waiting');
        assert.equal((await f.tick(start + 1000)).kind, 'refresh');
    } finally { await f.context.close(); }
});
test('an unchanged control gets time to finish before reload', async () => {
    const f = await fixture(pageHtml(row().replace('this.disabled=true', 'window.unchanged=true')));
    try {
        await f.tick();
        assert.equal((await f.tick(start + 1000)).kind, 'waiting');
        assert.equal((await f.tick(start + 11999)).kind, 'waiting');
        assert.equal((await f.tick(start + 12000)).kind, 'refresh');
    } finally { await f.context.close(); }
});
test('refresh does not interrupt an in-flight poke request after an optimistic row update', async () => {
    const f = await fixture(pageHtml(row().replace('this.disabled=true', "this.disabled=true;fetch('/api/graphql/')")));
    try {
        await f.page.reload();
        await f.page.evaluate(() => window.fetch = () => new Promise(resolve => { window.finishRequest = resolve; }));
        await f.page.evaluate(script);
        await f.tick();
        assert.equal((await f.tick(start + 15000)).kind, 'waiting');
        await f.page.evaluate(async () => { finishRequest(new Response('{}')); await new Promise(r => setTimeout(r, 20)); });
        assert.equal((await f.tick(start + 15500)).kind, 'refresh');
    } finally { await f.context.close(); }
});
test('persistent duplicate guard survives a full reload', async () => {
    const f = await fixture(pageHtml(row()));
    try {
        const r = await f.tick();
        await f.page.reload(); await f.page.evaluate(script);
        assert.equal((await f.tick(start + 15000, { state: r.state })).kind, 'watching');
        assert.equal(await f.page.evaluate(() => window.clicks || 0), 0);
    } finally { await f.context.close(); }
});
test('new poke count becomes eligible after the minimum global gap', async () => {
    const f = await fixture(pageHtml(row()));
    try {
        const r = await f.tick(); await f.page.reload();
        await f.page.locator('article span').evaluate(el => el.textContent = '20 pokes · poked you now');
        await f.page.evaluate(script);
        assert.equal((await f.tick(start + 1000, { state: r.state })).kind, 'waiting');
        assert.equal((await f.tick(start + 7000, { state: r.state })).kind, 'clicked');
    } finally { await f.context.close(); }
});
test('two attempts are the limit for the same unchanged poke', async () => {
    const f = await fixture(pageHtml(row()));
    try {
        const one = await f.tick(); await f.page.reload(); await f.page.evaluate(script);
        const two = await f.tick(start + 180001, { state: one.state }); assert.equal(two.kind, 'clicked');
        await f.page.reload(); await f.page.evaluate(script);
        assert.equal((await f.tick(start + 900000, { state: two.state })).kind, 'watching');
    } finally { await f.context.close(); }
});
test('notices cannot create an automatic restriction hold', async () => {
    const f = await fixture(pageHtml('<div role="alert">We limit how often you can do this. Try again later.</div>' + row()));
    try {
        const r = await f.tick(); assert.equal(r.kind, 'clicked');
        assert.equal(r.state.held, undefined);
        assert.equal((await f.tick(start + 1000)).kind, 'refresh');
        assert.equal(await f.page.evaluate(() => clicks), 1);
    } finally { await f.context.close(); }
});

test('GraphQL error responses do not stop a ready poke or replay requests', async () => {
    const f = await fixture(pageHtml(row()));
    try {
        await f.page.reload();
        await f.page.evaluate(() => {
            window.requests = 0;
            window.fetch = async () => { requests++; return new Response(JSON.stringify({ errors: [{ code: 1675004, message: 'Rate limit exceeded' }] })); };
        });
        await f.page.evaluate(script);
        await f.page.evaluate(async () => { await fetch('/api/graphql/', { method: 'POST', body: 'fb_api_req_friendly_name=PokeMutation' }); });
        assert.equal((await f.tick()).kind, 'clicked');
        assert.equal((await f.tick(start + 1000)).kind, 'refresh');
        assert.equal(await f.page.evaluate(() => requests), 1);
    } finally { await f.context.close(); }
});

test('a rejected request uses normal row timing without a retry countdown', async () => {
    const f = await fixture(pageHtml(row().replace('this.disabled=true', "fetch('/api/graphql/').catch(()=>{})")));
    try {
        await f.page.reload(); await f.page.evaluate(() => window.fetch = () => Promise.reject(new Error('Offline')));
        await f.page.evaluate(script); await f.tick(); await f.page.waitForTimeout(20);
        const waiting = await f.tick(start + 500);
        assert.equal(waiting.kind, 'waiting'); assert.match(waiting.message, /row to update/);
        assert.equal((await f.tick(start + 12000)).kind, 'refresh');
        assert.equal(await f.page.evaluate(() => clicks), 1);
    } finally { await f.context.close(); }
});

test('login, checkpoint and unrelated pages never click or refresh', async () => {
    for (const [html, url, kind] of [
        [pageHtml('<input type="password">' + row()), 'https://www.facebook.com/pokes', 'login'],
        [pageHtml(row()), 'https://www.facebook.com/checkpoint/', 'login'],
        [row(), 'https://www.facebook.com/messages', 'offpage'],
        [pageHtml(row()), 'https://facebook.com.evil.example/pokes', 'offpage']
    ]) {
        const f = await fixture(html, url);
        try { assert.equal((await f.tick()).kind, kind); assert.equal(await f.page.evaluate(() => window.clicks || 0), 0); }
        finally { await f.context.close(); }
    }
});
test('mobile Pokes header works even when URL is a root SPA route', async () => {
    const f = await fixture(pageHtml('<p>Friends who poked you</p>' + row()), 'https://m.facebook.com/');
    try { assert.equal((await f.tick()).kind, 'clicked'); } finally { await f.context.close(); }
});
test('a loading shell is not repeatedly refreshed', async () => {
    const f = await fixture('<html><body><div>Loading…</div></body></html>');
    try {
        assert.equal((await f.tick()).kind, 'offpage');
        assert.equal((await f.tick(start + 45000)).kind, 'stalled');
    } finally { await f.context.close(); }
});
test('disabled, hidden and unidentified controls are not clicked', async () => {
    for (const body of [row().replace('<button ', '<button disabled '), row().replace('<article ', '<article style="opacity:0" '), '<button>Poke back</button>']) {
        const f = await fixture(pageHtml(body));
        try { assert.notEqual((await f.tick()).kind, 'clicked'); assert.equal(await f.page.evaluate(() => window.clicks || 0), 0); }
        finally { await f.context.close(); }
    }
});
test('nested role=button produces only one click', async () => {
    const f = await fixture(pageHtml(row().replace('<button ', '<div role="button"><button ').replace('</button>', '</button></div>')));
    try { assert.equal((await f.tick()).kind, 'clicked'); assert.equal(await f.page.evaluate(() => clicks), 1); }
    finally { await f.context.close(); }
});
test('relative time changes do not bypass the saved duplicate guard', async () => {
    const html = pageHtml(row().replace('19 pokes · ', ''));
    const f = await fixture(html);
    try {
        const r = await f.tick(); await f.page.reload();
        await f.page.locator('article span').evaluate(el => el.textContent = 'poked you 20m ago');
        await f.page.evaluate(script);
        assert.equal((await f.tick(start + 30000, { state: r.state })).kind, 'watching');
    } finally { await f.context.close(); }
});

test('a click requires a saved guard and the matching one-use execution token', async () => {
    const f = await fixture(pageHtml(row()));
    try {
        const reserved = await f.rawTick();
        assert.equal(reserved.kind, 'prepared'); assert.equal(reserved.state.records[0].tries, 1);
        assert.equal(reserved.state.attempts, 0);
        assert.equal(await f.page.evaluate(() => window.clicks || 0), 0);
        assert.equal((await f.execute('wrong-token')).kind, 'waiting');
        assert.equal(await f.page.evaluate(() => window.clicks || 0), 0);
        assert.equal((await f.execute(reserved.token)).kind, 'clicked');
        assert.equal((await f.execute(reserved.token, start + 1)).kind, 'waiting');
        assert.equal(await f.page.evaluate(() => clicks), 1);
    } finally { await f.context.close(); }
});
test('an interrupted click remains guarded when Android restores the journal', async () => {
    const f = await fixture(pageHtml(row()));
    try {
        const reserved = await f.rawTick();
        await f.page.reload(); await f.page.evaluate(script);
        assert.equal((await f.execute(reserved.token)).kind, 'waiting');
        assert.equal((await f.tick(start + 15000, { state: reserved.state })).kind, 'watching');
        assert.equal(await f.page.evaluate(() => window.clicks || 0), 0);
    } finally { await f.context.close(); }
});
test('row changes and expired reservations cancel the prepared click', async () => {
    const f = await fixture(pageHtml(row()));
    try {
        const reserved = await f.rawTick();
        await f.page.locator('article span').evaluate(el => el.textContent = '20 pokes · poked you now');
        assert.equal((await f.execute(reserved.token)).kind, 'watching');
        assert.equal(await f.page.evaluate(() => window.clicks || 0), 0);
        await f.page.reload(); await f.page.evaluate(script);
        const again = await f.rawTick();
        assert.equal((await f.execute(again.token, start + 15000)).kind, 'watching');
        assert.equal(await f.page.evaluate(() => window.clicks || 0), 0);
    } finally { await f.context.close(); }
});
test('Stop between preparation and execution prevents the click', async () => {
    const f = await fixture(pageHtml(row()));
    try {
        const reserved = await f.rawTick();
        assert.equal((await f.execute(reserved.token, start, { running: false })).kind, 'paused');
        assert.equal(await f.page.evaluate(() => window.clicks || 0), 0);
    } finally { await f.context.close(); }
});
test('removing the Pokes view before execution prevents a detached-button click', async () => {
    const f = await fixture(pageHtml(row()));
    try {
        const reserved = await f.rawTick();
        await f.page.evaluate(() => document.body.innerHTML = '<h1>You’re temporarily blocked</h1><p>Going too fast.</p>');
        const r = await f.execute(reserved.token);
        assert.equal(r.kind, 'offpage');
        assert.equal(await f.page.evaluate(() => window.clicks || 0), 0);
    } finally { await f.context.close(); }
});

test('checkpoint pages still require sign-in without inventing a restriction hold', async () => {
    const f = await fixture('<h1>Temporarily blocked</h1>', 'https://www.facebook.com/checkpoint/');
    try { assert.equal((await f.tick()).kind, 'login'); } finally { await f.context.close(); }
});

test('adaptive idle refresh backs off across reloads and caps at 60 seconds', async () => {
    const f = await fixture(pageHtml('<h2>Suggested</h2>'));
    try {
        let state = {}, now = start;
        for (const seconds of [5, 10, 20, 40, 60, 60, 60]) {
            assert.equal((await f.tick(now, { state, refreshMs: 5000 })).kind, 'watching');
            assert.equal((await f.tick(now + seconds * 1000 - 1, { state, refreshMs: 5000 })).kind, 'watching');
            const r = await f.tick(now + seconds * 1000, { state, refreshMs: 5000 });
            assert.equal(r.kind, 'refresh'); state = r.state;
            await f.page.reload(); await f.page.evaluate(script); now += seconds * 1000 + 100;
        }
    } finally { await f.context.close(); }
});
test('fixed refresh remains configurable and adaptive mode does not shorten a long user delay', async () => {
    for (const [refreshMs, adaptive, rounds] of [[3000, false, 6], [120000, true, 6]]) {
        const f = await fixture(pageHtml('<h2>Suggested</h2>'));
        try {
            const changes = { refreshMs, adaptive, state: { idleRounds: rounds } };
            await f.tick(start, changes);
            assert.equal((await f.tick(start + refreshMs - 1, changes)).kind, 'watching');
            assert.equal((await f.tick(start + refreshMs, changes)).kind, 'refresh');
        } finally { await f.context.close(); }
    }
});
test('an eligible incoming poke resets the idle backoff', async () => {
    const f = await fixture(pageHtml(row()));
    try {
        const r = await f.tick(start, { state: { idleRounds: 6 } });
        assert.equal(r.kind, 'clicked'); assert.equal(r.state.idleRounds, 0);
    } finally { await f.context.close(); }
});
test('old retry timers are discarded across reloads while duplicate guards survive', async () => {
    const f = await fixture(pageHtml(row()));
    try {
        const first = await f.tick();
        const old = { ...first.state, held: true, failures: 5, retryAt: start + 300000, holdReason: 'Old error' };
        await f.page.reload(); await f.page.evaluate(script);
        const r = await f.tick(start + 15000, { state: old });
        assert.equal(r.kind, 'watching'); assert.equal(r.state.attempts, 1);
        assert.deepEqual(r.state.records, first.state.records);
        for (const key of ['held','failures','retryAt','holdReason','holdSource']) assert.equal(r.state[key], undefined);
        await f.page.locator('article span').evaluate(el => el.textContent = '20 pokes · poked you now');
        assert.equal((await f.tick(start + 16000)).kind, 'clicked');
    } finally { await f.context.close(); }
});

test('a never-settling poke request eventually refreshes with its guard intact', async () => {
    const f = await fixture(pageHtml(row().replace('this.disabled=true', "this.disabled=true;fetch('/api/graphql/')")));
    try {
        await f.page.reload(); await f.page.evaluate(() => window.fetch = () => new Promise(() => {}));
        await f.page.evaluate(script); await f.tick();
        assert.equal((await f.tick(start + 89999)).kind, 'waiting');
        assert.equal((await f.tick(start + 90000)).kind, 'refresh');
        assert.equal(await f.page.evaluate(() => clicks), 1);
    } finally { await f.context.close(); }
});
test('relative times in text-only person rows do not create a second identity', async () => {
    const html = pageHtml(row().replace(/<a[^>]*>Alex<\/a>/, '<span>Alex</span>').replace('19 pokes · ', ''));
    const f = await fixture(html);
    try {
        const r = await f.tick(); assert.equal(r.kind, 'clicked');
        await f.page.reload();
        await f.page.locator('article span').nth(1).evaluate(el => el.textContent = 'poked you 20m ago');
        await f.page.evaluate(script);
        assert.equal((await f.tick(start + 30000, { state: r.state })).kind, 'watching');
    } finally { await f.context.close(); }
});

test('a completely blank Pokes document triggers recovery after a 10-second grace period', async () => {
    const f = await fixture('<html><body></body></html>');
    try {
        assert.equal((await f.tick()).kind, 'rendering');
        assert.equal((await f.tick(start + 9999)).kind, 'rendering');
        assert.equal((await f.tick(start + 10000)).kind, 'blank');
        assert.equal(await f.page.evaluate(() => window.clicks || 0), 0);
    } finally { await f.context.close(); }
});
test('hidden text and script tags do not mask an otherwise blank page', async () => {
    const f = await fixture('<html><body><span hidden>Pokes</span><script>window.shell=true;</script>  </body></html>');
    try {
        await f.tick();
        assert.equal((await f.tick(start + 10000)).kind, 'blank');
    } finally { await f.context.close(); }
});
test('an invisible root is treated as blank even when its DOM still contains Pokes', async () => {
    const f = await fixture(pageHtml(row()));
    try {
        await f.page.evaluate(() => document.body.style.opacity = '0');
        assert.equal((await f.tick()).kind, 'rendering');
        assert.equal((await f.tick(start + 10000)).kind, 'blank');
        assert.equal(await f.page.evaluate(() => window.clicks || 0), 0);
    } finally { await f.context.close(); }
});
test('redirected empty root routes recover only when native code expects Pokes', async () => {
    for (const expected of [true, false]) {
        const f = await fixture('<html><body></body></html>', 'https://www.facebook.com/');
        try {
            await f.tick(start, { pokesExpected: expected });
            assert.equal((await f.tick(start + 10000, { pokesExpected: expected })).kind, expected ? 'blank' : 'offpage');
        } finally { await f.context.close(); }
    }
});
test('late-arriving content clears the blank-page timer', async () => {
    const f = await fixture('<html><body></body></html>');
    try {
        await f.tick();
        await f.page.evaluate(() => document.body.innerHTML = '<h1>Pokes</h1><h2>Suggested</h2>');
        assert.equal((await f.tick(start + 9000)).kind, 'watching');
        await f.page.evaluate(() => document.body.innerHTML = '');
        assert.equal((await f.tick(start + 10000)).kind, 'rendering');
        assert.equal((await f.tick(start + 19999)).kind, 'rendering');
        assert.equal((await f.tick(start + 20000)).kind, 'blank');
    } finally { await f.context.close(); }
});
test('blank-page recovery never interrupts login or one-time-code entry', async () => {
    for (const input of ['<input type="password">', '<input name="email">', '<input autocomplete="one-time-code">']) {
        const f = await fixture('<html><body>' + input + '</body></html>');
        try {
            assert.equal((await f.tick()).kind, 'login');
            assert.equal((await f.tick(start + 120000)).kind, 'login');
        } finally { await f.context.close(); }
    }
});
test('a blank optimistic update waits for the poke request before recovering', async () => {
    const f = await fixture(pageHtml(row().replace('this.disabled=true', "this.disabled=true;fetch('/api/graphql/')")));
    try {
        await f.page.reload();
        await f.page.evaluate(() => window.fetch = () => new Promise(resolve => { window.finishRequest = resolve; }));
        await f.page.evaluate(script); await f.tick();
        await f.page.evaluate(() => document.body.innerHTML = '');
        assert.equal((await f.tick(start + 20000)).kind, 'waiting');
        await f.page.evaluate(async () => { finishRequest(new Response('{}')); await new Promise(r => setTimeout(r, 20)); });
        assert.equal((await f.tick(start + 21000)).kind, 'rendering');
        assert.equal((await f.tick(start + 31000)).kind, 'blank');
    } finally { await f.context.close(); }
});
test('Stop resets the blank-page grace period on resume', async () => {
    const f = await fixture('<html><body></body></html>');
    try {
        await f.tick(); await f.tick(start + 5000, { running: false });
        assert.equal((await f.tick(start + 60000)).kind, 'rendering');
        assert.equal((await f.tick(start + 70000)).kind, 'blank');
    } finally { await f.context.close(); }
});

async function observedError(operation, status = 200, error = { code: 1675004, message: 'Rate limit exceeded' }) {
    const f = await fixture(pageHtml('<h2>Suggested</h2>'));
    await f.page.reload();
    await f.page.evaluate(({status, error}) => {
        window.fetch = async () => new Response(JSON.stringify(error ? { errors: [error] } : {}), { status });
    }, {status, error});
    await f.page.evaluate(script);
    await f.page.evaluate(async operation => {
        const body = operation ? 'fb_api_req_friendly_name=' + encodeURIComponent(operation) : '';
        await fetch('/api/graphql/', { method: 'POST', body });
        await new Promise(resolve => setTimeout(resolve, 15));
    }, operation);
    return f;
}
test('a generic try-again-later sidebar notice does not hold the loop', async () => {
    const f = await fixture(pageHtml(row('Rheane', 757, 'Poked').replace('<button ', '<button disabled ')
        + '<div role="alert">Could not load the sidebar. Try again later.</div>'));
    try {
        assert.equal((await f.tick()).kind, 'watching');
        await f.page.locator('article button').evaluate(el => { el.disabled = false; el.textContent = 'Poke back'; });
        assert.equal((await f.tick(start + 7000)).kind, 'clicked');
    } finally { await f.context.close(); }
});
test('casual mentions in headings and dialogs are not treated as block notices', async () => {
    for (const notice of ['<h2>Why this image was temporarily blocked</h2>', '<div role="dialog">The animation is going too fast. Try again later.</div>']) {
        const f = await fixture(pageHtml('<h2>Suggested</h2>' + notice));
        try { assert.equal((await f.tick()).kind, 'watching'); } finally { await f.context.close(); }
    }
});
test('background chat errors never add a request-failed countdown', async () => {
    const f = await observedError('ChatSidebarQuery');
    try {
        const r = await f.tick(); assert.equal(r.kind, 'watching'); assert.equal(r.state.retryAt, undefined);
        assert.equal((await f.tick(start + 1000)).kind, 'refresh');
    } finally { await f.context.close(); }
});

test('unattributed GraphQL rate errors do not claim a confirmed poke rejection', async () => {
    const f = await observedError(null);
    try { const r = await f.tick(); assert.equal(r.kind, 'watching'); assert.equal(r.state.held, undefined); }
    finally { await f.context.close(); }
});
test('read-only Pokes queries are distinguished from poke mutations', async () => {
    const f = await observedError('PokesBackButtonStateQuery', 200, { code: 1675004, message: 'Rate limit exceeded', path: ['poke'] });
    try { const r = await f.tick(); assert.equal(r.kind, 'watching'); assert.equal(r.state.held, undefined); }
    finally { await f.context.close(); }
});
test('a known poke mutation error cannot stop the next eligible row', async () => {
    const f = await observedError('PokeMutation');
    try {
        const r = await f.tick(); assert.equal(r.kind, 'watching'); assert.equal(r.state.held, undefined);
        await f.page.locator('body').evaluate((el, html) => el.insertAdjacentHTML('beforeend', html), row());
        assert.equal((await f.tick(start + 500)).kind, 'clicked');
    } finally { await f.context.close(); }
});

test('poke-looking error paths are ignored without response inspection', async () => {
    const f = await observedError(null, 200, { code: 1675004, message: 'Rate limit exceeded', path: ['poke'] });
    try { assert.equal((await f.tick()).kind, 'watching'); } finally { await f.context.close(); }
});

test('HTTP errors on page requests do not create engine retry timers', async () => {
    for (const operation of [null, 'ChatSidebarQuery', 'PokeMutation']) {
        for (const status of [429, 500]) {
            const f = await observedError(operation, status, null);
            try {
                const r = await f.tick(); assert.equal(r.kind, 'watching');
                assert.equal(r.state.retryAt, undefined); assert.equal(r.state.held, undefined);
                assert.equal((await f.tick(start + 1000)).kind, 'refresh');
            } finally { await f.context.close(); }
        }
    }
});

test('an unlabelled request synchronously emitted by the poke click is attributable', async () => {
    const f = await fixture(pageHtml(row().replace('this.disabled=true', "this.disabled=true;fetch('/api/graphql/')")));
    try {
        await f.page.reload();
        await f.page.evaluate(() => window.fetch = async () => new Response(JSON.stringify({ errors: [{ code: 1675004 }] })));
        await f.page.evaluate(script); await f.tick(); await f.page.waitForTimeout(20);
        const r = await f.tick(start + 500);
        assert.equal(r.kind, 'waiting'); assert.equal(r.attempts, 1);
        assert.equal((await f.tick(start + 1000)).kind, 'refresh');
    } finally { await f.context.close(); }
});
test('an explicitly unrelated operation emitted during a click is not misattributed', async () => {
    const f = await fixture(pageHtml(row().replace('this.disabled=true', "this.disabled=true;fetch('/api/graphql/',{method:'POST',body:'fb_api_req_friendly_name=ChatSidebarQuery'})")));
    try {
        await f.page.reload();
        await f.page.evaluate(() => window.fetch = async () => new Response(JSON.stringify({ errors: [{ code: 1675004 }] })));
        await f.page.evaluate(script); await f.tick(); await f.page.waitForTimeout(20);
        const r = await f.tick(start + 500);
        assert.equal(r.kind, 'waiting'); assert.equal(r.attempts, 1);
        assert.equal((await f.tick(start + 1000)).kind, 'refresh');
    } finally { await f.context.close(); }
});
test('XHR errors use the same action scoping as fetch errors', async () => {
    for (const operation of ['ChatSidebarQuery', 'PokeMutation']) {
        const f = await fixture(pageHtml('<h2>Suggested</h2>'));
        try {
            await f.context.route('**/api/graphql/', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ errors: [{ code: 1675004 }] }) }));
            await f.page.evaluate(operation => new Promise(resolve => {
                const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/graphql/');
                xhr.addEventListener('loadend', resolve, { once: true });
                xhr.send('fb_api_req_friendly_name=' + operation);
            }), operation);
            assert.equal((await f.tick()).kind, 'watching');
        } finally { await f.context.close(); }
    }
});
test('URL-encoded, JSON, URLSearchParams, and FormData names are scoped without saving secrets', async () => {
    for (const format of ['encoded', 'json', 'params', 'form']) {
        const f = await fixture(pageHtml('<h2>Suggested</h2>'));
        try {
            await f.page.reload();
            await f.page.evaluate(() => window.fetch = async () => new Response(JSON.stringify({ errors: [{ code: 1675004 }] })));
            await f.page.evaluate(script);
            await f.page.evaluate(async format => {
                const fields = { fb_api_req_friendly_name: 'PokeMutation', fb_dtsg: 'FAKE_SECRET_NOT_TO_SAVE' };
                let body;
                if (format === 'encoded') body = new URLSearchParams(fields).toString();
                if (format === 'json') body = JSON.stringify(fields);
                if (format === 'params') body = new URLSearchParams(fields);
                if (format === 'form') { body = new FormData(); for (const [k,v] of Object.entries(fields)) body.set(k,v); }
                await fetch('/api/graphql/', { method: 'POST', body }); await new Promise(r => setTimeout(r, 15));
            }, format);
            const r = await f.tick(); assert.equal(r.kind, 'watching');
            assert.equal(JSON.stringify(r).includes('FAKE_SECRET_NOT_TO_SAVE'), false);
            assert.equal(JSON.stringify(r).includes('fb_dtsg'), false);
        } finally { await f.context.close(); }
    }
});
test('visible notices do not turn off a healthy Pokes loop', async () => {
    for (const notice of ['<h1>You are temporarily blocked</h1>', '<h1>Rate limit exceeded</h1>', '<div role="alert">It looks like you were misusing this feature by going too fast.</div>']) {
        const f = await fixture(pageHtml('<h2>Suggested</h2>' + notice));
        try { const r = await f.tick(); assert.equal(r.kind, 'watching'); assert.equal((await f.tick(start + 1000)).kind, 'refresh'); }
        finally { await f.context.close(); }
    }
});

test('old saved holds and countdowns cannot block an eligible poke', async () => {
    const f = await fixture(pageHtml(row()));
    try {
        const r = await f.tick(start, { state: { attempts: 131, held: true, holdReason: 'Old pause', retryAt: start + 300000, failures: 5 } });
        assert.equal(r.kind, 'clicked'); assert.equal(r.attempts, 132);
        assert.equal(r.state.held, undefined); assert.equal(r.state.retryAt, undefined);
    } finally { await f.context.close(); }
});

test('repeated background errors leave normal refresh timing intact', async () => {
    const f = await observedError('ChatSidebarQuery');
    try {
        await f.tick(start, { refreshMs: 30000, adaptive: false });
        for (const elapsed of [10000, 20000, 29999, 30000]) {
            await f.page.evaluate(async () => { await fetch('/api/graphql/', { method: 'POST', body: 'fb_api_req_friendly_name=ChatSidebarQuery' }); });
            const r = await f.tick(start + elapsed, { refreshMs: 30000, adaptive: false });
            assert.equal(r.kind, elapsed < 30000 ? 'watching' : 'refresh');
            assert.equal(r.state?.retryAt, undefined);
        }
    } finally { await f.context.close(); }
});

test('an unrelated error does not discard or interrupt an in-flight poke', async () => {
    const handler = "this.disabled=true;fetch('/api/graphql/',{method:'POST',body:'fb_api_req_friendly_name=PokeMutation'});fetch('/api/graphql/',{method:'POST',body:'fb_api_req_friendly_name=ChatSidebarQuery'})";
    const f = await fixture(pageHtml(row().replace('this.disabled=true', handler)));
    try {
        await f.page.reload();
        await f.page.evaluate(() => window.fetch = (url, init) => {
            if (init.body.includes('PokeMutation')) return new Promise(resolve => { window.finishPoke = resolve; });
            return Promise.resolve(new Response(JSON.stringify({ errors: [{ code: 1675004 }] })));
        });
        await f.page.evaluate(script); await f.tick(); await f.page.waitForTimeout(20);
        assert.equal((await f.tick(start + 500)).kind, 'waiting');
        assert.equal((await f.tick(start + 30000)).kind, 'waiting');
        await f.page.evaluate(async () => { finishPoke(new Response('{}')); await new Promise(r => setTimeout(r, 20)); });
        const r = await f.tick(start + 31000);
        assert.equal(r.kind, 'refresh'); assert.equal(r.attempts, 1);
    } finally { await f.context.close(); }
});

test('mobile hidden SPA descendants trigger recovery even with stale Pokes text', async () => {
    for (const style of ['opacity:0', 'visibility:hidden', 'display:none']) {
        const f = await fixture('<html><body><main style="' + style + '">' + pageHtml(row()) + '</main></body></html>', 'https://m.facebook.com/pokes');
        try {
            assert.equal((await f.tick()).kind, 'rendering');
            assert.equal((await f.tick(start + 10000)).kind, 'blank');
            assert.equal(await f.page.evaluate(() => window.clicks || 0), 0);
        } finally { await f.context.close(); }
    }
});
test('mobile redirected shells get a recovery deadline without an exact Pokes path', async () => {
    const f = await fixture('<html><body>Loading…</body></html>', 'https://m.facebook.com/');
    try {
        assert.equal((await f.tick(start, { pokesExpected: true })).kind, 'offpage');
        assert.equal((await f.tick(start + 45000, { pokesExpected: true })).kind, 'stalled');
    } finally { await f.context.close(); }
});
test('an interactive mobile document can poke without waiting for unrelated resources', async () => {
    const f = await fixture(pageHtml(row()), 'https://m.facebook.com/pokes');
    try {
        await f.page.evaluate(() => Object.defineProperty(document, 'readyState', { get: () => 'interactive' }));
        assert.equal((await f.tick()).kind, 'clicked');
        assert.equal((await f.tick(start + 1000)).kind, 'refresh');
    } finally { await f.context.close(); }
});
test('a permanently loading blank mobile document is recovered after its longer grace', async () => {
    const f = await fixture('<html><body></body></html>', 'https://m.facebook.com/pokes');
    try {
        await f.page.evaluate(() => Object.defineProperty(document, 'readyState', { get: () => 'loading' }));
        assert.equal((await f.tick()).kind, 'rendering');
        assert.equal((await f.tick(start + 29999)).kind, 'rendering');
        assert.equal((await f.tick(start + 30000)).kind, 'blank');
    } finally { await f.context.close(); }
});
test('a never-loading mobile shell cannot hold the engine forever', async () => {
    const f = await fixture('<html><body>Loading…</body></html>', 'https://m.facebook.com/pokes');
    try {
        await f.page.evaluate(() => Object.defineProperty(document, 'readyState', { get: () => 'loading' }));
        assert.equal((await f.tick()).kind, 'loading');
        assert.equal((await f.tick(start + 45000)).kind, 'stalled');
    } finally { await f.context.close(); }
});
test('background requests that never settle cannot interrupt normal refresh', async () => {
    const handler = "this.disabled=true;fetch('/api/graphql/',{method:'POST',body:'fb_api_req_friendly_name=ChatSidebarQuery'})";
    const f = await fixture(pageHtml(row().replace('this.disabled=true', handler)));
    try {
        await f.page.reload(); await f.page.evaluate(() => window.fetch = () => new Promise(() => {}));
        await f.page.evaluate(script); assert.equal((await f.tick()).kind, 'clicked');
        assert.equal((await f.tick(start + 1000)).kind, 'refresh');
    } finally { await f.context.close(); }
});
test('poke response bodies are never read to make automation decisions', async () => {
    const handler = "this.disabled=true;fetch('/api/graphql/')";
    const f = await fixture(pageHtml(row().replace('this.disabled=true', handler)));
    try {
        await f.page.reload();
        await f.page.evaluate(() => {
            window.bodyReads = 0;
            window.fetch = async () => ({ status: 429, clone() { bodyReads++; throw new Error('Do not inspect'); }, text() { bodyReads++; throw new Error('Do not inspect'); } });
        });
        await f.page.evaluate(script); await f.tick(); await f.page.waitForTimeout(10);
        assert.equal((await f.tick(start + 1000)).kind, 'refresh');
        assert.equal(await f.page.evaluate(() => bodyReads), 0);
    } finally { await f.context.close(); }
});
test('an actual XHR poke waits for completion and ignores its error response', async () => {
    const handler = "this.disabled=true;const x=new XMLHttpRequest();x.open('POST','/api/graphql/');x.send('fb_api_req_friendly_name=PokeMutation')";
    const f = await fixture(pageHtml(row().replace('this.disabled=true', handler)));
    try {
        let release;
        const responseGate = new Promise(resolve => { release = resolve; });
        await f.context.route('**/api/graphql/', async route => { await responseGate; await route.fulfill({ status: 429, contentType: 'application/json', body: '{"errors":[{"code":1675004}]}' }); });
        assert.equal((await f.tick()).kind, 'clicked');
        assert.equal((await f.tick(start + 15000)).kind, 'waiting');
        release(); await f.page.waitForTimeout(100);
        assert.equal((await f.tick(start + 16000)).kind, 'refresh');
    } finally { await f.context.close(); }
});
test('late completion of an expired request cannot poison the next poke', async () => {
    const handler = "this.disabled=true;fetch('/api/graphql/')";
    const f = await fixture(pageHtml(row().replace('this.disabled=true', handler)));
    try {
        await f.page.reload(); await f.page.evaluate(() => window.fetch = () => new Promise(resolve => { window.finishOld = resolve; }));
        await f.page.evaluate(script); const first = await f.tick();
        assert.equal((await f.tick(start + 90000)).kind, 'refresh');
        await f.page.locator('article').evaluate(el => { el.querySelector('span').textContent = '20 pokes · poked you now'; el.querySelector('button').disabled = false; el.querySelector('button').onclick = () => { clicks++; el.querySelector('button').disabled = true; }; });
        assert.equal((await f.tick(start + 91000)).kind, 'clicked');
        await f.page.evaluate(() => finishOld(new Response('{}')));
        assert.equal((await f.tick(start + 92000)).kind, 'refresh');
        assert.equal(first.state.records[0].tries, 1);
        assert.equal(await f.page.evaluate(() => clicks), 2);
    } finally { await f.context.close(); }
});

test('successive incoming pokes keep looping across reloads and failed requests', async () => {
    const f = await fixture(pageHtml(row().replace('this.disabled=true', "this.disabled=true;fetch('/api/graphql/').catch(()=>{})")));
    try {
        let state = { held: true, failures: 5, retryAt: start + 300000 };
        for (let round = 0; round < 24; round++) {
            if (round) await f.page.reload();
            await f.page.locator('article span').evaluate((el, count) => el.textContent = count + ' pokes · poked you now', 19 + round);
            await f.page.evaluate(round => {
                window.fetch = round % 3 === 0 ? () => Promise.reject(new Error('Request failed'))
                    : async () => new Response('{"errors":[{"code":1675004}]}', { status: round % 3 === 1 ? 429 : 200 });
            }, round);
            await f.page.evaluate(script);
            const now = start + round * 8000;
            const clicked = await f.tick(now, { state });
            assert.equal(clicked.kind, 'clicked'); assert.equal(clicked.attempts, round + 1); state = clicked.state;
            const result = await f.tick(now + 1000);
            assert.equal(result.kind, 'refresh'); assert.doesNotMatch(result.message, /request failed|retrying/i);
        }
        assert.equal(state.attempts, 24); assert.equal(state.records.length, 24);
    } finally { await f.context.close(); }
});

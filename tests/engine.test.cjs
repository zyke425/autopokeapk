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
test('a Facebook restriction pauses both clicks and reloads', async () => {
    const f = await fixture(pageHtml('<div role="alert">We limit how often you can do this. Try again later.</div>' + row()));
    try {
        const r = await f.tick(); assert.equal(r.kind, 'restricted'); assert.equal(r.state.held, true);
        assert.equal((await f.tick(start + 999999)).kind, 'restricted');
        assert.equal(await f.page.evaluate(() => window.clicks || 0), 0);
    } finally { await f.context.close(); }
});
test('GraphQL rate-limit errors pause without replaying requests', async () => {
    const f = await fixture(pageHtml(row()));
    try {
        // Reset the document, put a fake existing fetch under the observer, then inject.
        await f.page.reload();
        await f.page.evaluate(() => {
            window.requests = 0;
            window.fetch = async () => {
                requests++;
                return new Response(JSON.stringify({ errors: [{ code: 1675004, message: 'Rate limit exceeded' }] }));
            };
        });
        await f.page.evaluate(script);
        await f.page.evaluate(async () => { await fetch('/api/graphql/'); await new Promise(r => setTimeout(r, 10)); });
        assert.equal((await f.tick()).kind, 'restricted');
        assert.equal(await f.page.evaluate(() => requests), 1);
    } finally { await f.context.close(); }
});
test('temporary request errors wait before retrying', async () => {
    const f = await fixture(pageHtml(row().replace('this.disabled=true', "fetch('/api/graphql/').catch(()=>{})")));
    try {
        await f.page.reload(); await f.page.evaluate(() => window.fetch = () => Promise.reject(new Error('Offline')));
        await f.page.evaluate(script); await f.tick();
        await f.page.waitForTimeout(30);
        assert.match((await f.tick(start + 500)).message, /request failed/);
        assert.equal((await f.tick(start + 30000)).kind, 'waiting');
        assert.equal((await f.tick(start + 30500)).kind, 'refresh');
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
test('a restriction replacing the entire page cancels a prepared click', async () => {
    const f = await fixture(pageHtml(row()));
    try {
        const reserved = await f.rawTick();
        await f.page.evaluate(() => document.body.innerHTML = '<h1>You’re temporarily blocked</h1><p>Going too fast.</p>');
        const r = await f.execute(reserved.token);
        assert.equal(r.kind, 'restricted'); assert.equal(r.state.held, true);
        assert.equal(await f.page.evaluate(() => window.clicks || 0), 0);
    } finally { await f.context.close(); }
});
test('restriction dialogs on a checkpoint page are recognized before login routing', async () => {
    const f = await fixture('<h1>Temporarily blocked</h1>', 'https://www.facebook.com/checkpoint/');
    try { assert.equal((await f.tick()).kind, 'restricted'); } finally { await f.context.close(); }
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
test('temporary-error backoff survives a reload and escalates repeated failures', async () => {
    const f = await fixture(pageHtml('<h2>Suggested</h2>'));
    try {
        async function failRequest() {
            await f.page.reload();
            await f.page.evaluate(() => window.fetch = () => Promise.reject(new Error('Offline')));
            await f.page.evaluate(script);
            await f.page.evaluate(async () => { try { await fetch('/api/graphql/'); } catch (_) {} });
        }
        await failRequest();
        const first = await f.tick(); assert.equal(first.state.retryAt, start + 30000);
        await f.page.reload(); await f.page.evaluate(script);
        assert.equal((await f.tick(start + 29999, { state: first.state })).kind, 'waiting');
        const refresh = await f.tick(start + 30000, { state: first.state }); assert.equal(refresh.kind, 'refresh');
        await failRequest();
        const second = await f.tick(start + 31000, { state: refresh.state });
        assert.equal(second.state.failures, 2); assert.equal(second.state.retryAt, start + 91000);
    } finally { await f.context.close(); }
});
test('an unresolved poke request pauses for manual review instead of hanging forever', async () => {
    const f = await fixture(pageHtml(row().replace('this.disabled=true', "this.disabled=true;fetch('/api/graphql/')")));
    try {
        await f.page.reload(); await f.page.evaluate(() => window.fetch = () => new Promise(() => {}));
        await f.page.evaluate(script); await f.tick();
        assert.equal((await f.tick(start + 89999)).kind, 'waiting');
        assert.equal((await f.tick(start + 90000)).kind, 'error');
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

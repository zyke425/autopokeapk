const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const scripts = ['basic-mode.js', 'browser-health.js', 'basic-entry.js', 'autopoke.js']
    .map(name => fs.readFileSync(path.join(__dirname, '../app/src/main/assets', name), 'utf8')).join('\n');
const start = 1800000000000;
const address = 'https://m.facebook.com/pokes?ref=menu&zero=carrier';
const offer = '<div role="dialog"><h2>You’re out of data, but can still use Facebook</h2><button onclick="window.consents=1;this.parentElement.remove()">Continue</button></div>';
const shell = body => '<!doctype html><html><head><meta charset="utf-8"></head><body><header><span>Basic mode plus</span><button onclick="window.buys=1">Buy data</button></header>' + body + '</body></html>';
let browser;
before(async () => { browser = await chromium.launch({ headless:true, executablePath:process.env.AUTOPOKE_TEST_BROWSER || undefined }); });
after(async () => { await browser?.close(); });
async function fixture(options = {}) {
    const context = await browser.newContext(); const requests = [];
    await context.route('**/*', route => {
        const url = new URL(route.request().url()); requests.push(url.pathname + url.search);
        // Reproduce the phone's failure: a full Pokes GET is empty; loading Home
        // again presents the carrier offer. Only the existing client router works.
        return route.fulfill({contentType:'text/html', body:url.pathname === '/pokes' ? '<!doctype html><html><body></body></html>'
            : shell((requests.length > 1 ? offer : '') + '<main id="app"></main>')});
    });
    const page = await context.newPage(); await page.goto('https://m.facebook.com/');
    await page.evaluate(options => {
        window.entries = 0; window.clicks = 0; window.backs = 0;
        window.homeHtml = options.fromNotifications
            ? '<h1>Notifications</h1><a href="/pokes?ref=menu&zero=carrier" onclick="event.preventDefault();window.showPokes()"><strong>Alex and Rhea</strong> poked you. 4 minutes ago</a><button onclick="window.wrong=1">We noticed a new login</button>'
            : '<h1>Facebook</h1><a href="/pokes?ref=menu&zero=carrier" onclick="event.preventDefault();window.showPokes()">Pokes</a>';
        window.showHome = () => {
            window.backs++;
            if (options.noopBack) return;
            if (!options.sameUrl) history.pushState({}, '', '/');
            document.getElementById('app').innerHTML = window.homeHtml;
        };
        window.showPokes = () => {
            window.entries++;
            if (!options.sameUrl) history.pushState({}, '', '/pokes?ref=menu&zero=carrier');
            const back = options.noBack ? '' : '<button aria-label="Back" onclick="window.showHome()">←</button>';
            const reload = options.reload ? '<button aria-label="Refresh Pokes" onclick="window.showPokes()">↻</button>' : '';
            const row = options.idle ? '<p>No new pokes</p>' : '<div>'
                + (options.plainRows ? '<strong>Alex Sample</strong><div>4m ago · ' + entries + ' pokes 🌟</div>'
                    : '<a href="/alex">Alex</a> poked you ' + entries + ' times in a row')
                + ' <button onclick="window.clicks++;this.disabled=true">Poke back</button></div>';
            document.getElementById('app').innerHTML = back + reload + '<h2>Pokes</h2>' + row;
        };
        document.getElementById('app').innerHTML = homeHtml;
    }, options);
    if (options.untracked) await page.evaluate(() => showPokes());
    await page.evaluate(scripts);
    if (options.manualEntry) await page.locator('#app a').click();
    else if (!options.untracked) assert.equal((await page.evaluate(() => __autoPokeEntry.open())).kind, 'clicked');
    return {context, page, requests,
        refresh:(now, cycle = 1, epoch = 0) => page.evaluate(cfg => __autoPokeEntry.refresh(cfg), {now, cycle, epoch}),
        tick:cfg => page.evaluate(cfg => __autoPokeAndroid.tick({running:true, refreshMs:1000, gapMs:5000, adaptive:false, pokesExpected:true, ...cfg}), cfg),
        execute:(now, token) => page.evaluate(({now, token}) => __autoPokeAndroid.execute({running:true, now, refreshMs:1000, gapMs:5000, pokesExpected:true}, token), {now, token})};
}
async function cycle(f, now, id) {
    assert.equal((await f.refresh(now, id)).kind, 'refreshing');
    assert.equal((await f.refresh(now + 500, id)).kind, 'refreshing');
    assert.equal((await f.refresh(now + 1250, id)).kind, 'existing');
}

test('reproduces a hard-reload blank, then refreshes eight poke backs with no document reload', async () => {
    const f = await fixture();
    try {
        const probe = await f.context.newPage(); await probe.goto(address);
        assert.equal(await probe.locator('body').innerText(), '', 'direct GET is a blank document in this fixture');
        await probe.evaluate(scripts);
        assert.equal((await probe.evaluate(now => __autoPokeAndroid.tick({running:true, now, pokesExpected:true}), start)).kind, 'rendering');
        assert.equal((await probe.evaluate(now => __autoPokeAndroid.tick({running:true, now, pokesExpected:true}), start + 10000)).kind, 'blank');
        await probe.goto('https://m.facebook.com/'); await probe.evaluate(scripts);
        assert.equal(await probe.evaluate(() => __autoPokeBasic.read().state), 'offer'); await probe.close();
        let state = {};
        for (let i = 0; i < 8; i++) {
            const now = start + i * 10000;
            const prepared = await f.tick({now, state}); assert.equal(prepared.kind, 'prepared'); state = prepared.state;
            const clicked = await f.execute(now, prepared.token); assert.equal(clicked.kind, 'clicked'); state = clicked.state || state;
            assert.equal((await f.tick({now:now + 1000})).kind, 'refresh');
            await cycle(f, now + 1500, i + 1);
            assert.equal(f.page.url(), address);
        }
        assert.equal(await f.page.evaluate(() => clicks), 8);
        assert.equal(await f.page.evaluate(() => entries), 9);
        assert.equal(await f.page.evaluate(() => backs), 8);
        assert.equal(await f.page.evaluate(() => window.buys || window.consents || 0), 0);
        assert.deepEqual(f.requests, ['/', '/pokes?ref=menu&zero=carrier', '/']);
    } finally { await f.context.close(); }
});
test('idle refresh cycles re-enter Pokes without fetching Home or another Pokes document', async () => {
    const f = await fixture({idle:true});
    try {
        for (let i = 0; i < 5; i++) {
            const now = start + i * 10000;
            assert.equal((await f.tick({now})).kind, 'watching');
            assert.equal((await f.tick({now:now + 1000})).kind, 'refresh');
            await cycle(f, now + 1500, i + 1);
        }
        assert.deepEqual(f.requests, ['/']); assert.equal(await f.page.evaluate(() => entries), 6);
    } finally { await f.context.close(); }
});
test('client-only views can refresh when both Home and Pokes keep the same document URL', async () => {
    const f = await fixture({sameUrl:true});
    try {
        for (let i = 0; i < 3; i++) await cycle(f, start + i * 10000, i + 1);
        assert.equal(f.page.url(), 'https://m.facebook.com/');
        assert.equal(await f.page.evaluate(() => entries), 4); assert.deepEqual(f.requests, ['/']);
    } finally { await f.context.close(); }
});
test('a site refresh control is preferred and does not need a trip through Home', async () => {
    const f = await fixture({reload:true});
    try {
        assert.equal((await f.refresh(start)).phase, 'settling');
        assert.equal((await f.refresh(start + 500)).kind, 'refreshing');
        assert.equal((await f.refresh(start + 750)).kind, 'existing');
        assert.equal(await f.page.evaluate(() => backs), 0);
        assert.equal(await f.page.evaluate(() => entries), 2); assert.deepEqual(f.requests, ['/']);
    } finally { await f.context.close(); }
});
test('missing refresh controls keep Pokes available instead of loading another URL', async () => {
    const f = await fixture({noBack:true});
    try {
        const r = await f.refresh(start); assert.equal(r.kind, 'refresh-unavailable'); assert.equal(r.pokes, true);
        assert.equal((await f.tick({now:start + 1000, allowRefresh:false})).kind, 'prepared');
        assert.deepEqual(f.requests, ['/']);
    } finally { await f.context.close(); }
});
test('an ineffective Back action is clicked only once and never counts as a refresh', async () => {
    const f = await fixture({noopBack:true});
    try {
        assert.equal((await f.refresh(start)).kind, 'refreshing');
        assert.equal((await f.refresh(start + 750)).kind, 'refreshing');
        assert.equal((await f.refresh(start + 30000)).kind, 'refresh-unavailable');
        assert.equal((await f.refresh(start + 34000)).kind, 'refresh-unavailable');
        assert.equal(await f.page.evaluate(() => backs), 1); assert.deepEqual(f.requests, ['/']);
    } finally { await f.context.close(); }
});
test('a Pokes anchor without a client handler cannot trigger a fallback document GET', async () => {
    const f = await fixture();
    try {
        await f.page.evaluate(() => homeHtml = '<h1>Facebook</h1><a href="/pokes?ref=menu&zero=carrier">Pokes</a>');
        await f.refresh(start); await f.refresh(start + 500);
        const r = await f.refresh(start + 30500); assert.equal(r.kind, 'refresh-unavailable'); assert.equal(r.pokes, false);
        assert.equal(await f.page.locator('h1').innerText(), 'Facebook'); assert.deepEqual(f.requests, ['/']);
    } finally { await f.context.close(); }
});
test('an actual carrier offer defers client refresh and is never accepted automatically', async () => {
    const f = await fixture();
    try {
        await f.page.locator('body').evaluate((el, value) => el.insertAdjacentHTML('beforeend', value), offer);
        assert.equal((await f.refresh(start)).kind, 'basic-setup');
        assert.equal((await f.refresh(start + 60000)).kind, 'basic-setup');
        assert.equal(await f.page.evaluate(() => backs || window.consents || window.buys || 0), 0);
        await f.page.getByRole('button', {name:'Continue', exact:true}).click();
        await cycle(f, start + 61000, 1); assert.deepEqual(f.requests, ['/']);
    } finally { await f.context.close(); }
});
test('sign-in controls remain manual during a refresh', async () => {
    const f = await fixture();
    try {
        await f.page.locator('body').evaluate(el => el.insertAdjacentHTML('beforeend', '<input type="password">'));
        assert.equal((await f.refresh(start)).kind, 'login');
        assert.equal(await f.page.evaluate(() => backs || clicks), 0); assert.deepEqual(f.requests, ['/']);
    } finally { await f.context.close(); }
});
test('returning from the background gives a pending client route foreground time to finish', async () => {
    const f = await fixture();
    try {
        await f.refresh(start, 1, 0);
        assert.equal((await f.refresh(start + 60000, 1, 1)).kind, 'refreshing');
        assert.equal((await f.refresh(start + 60750, 1, 1)).kind, 'existing');
        assert.deepEqual(f.requests, ['/']);
    } finally { await f.context.close(); }
});
test('slow client navigation can finish after twenty seconds without another click or document load', async () => {
    const f = await fixture();
    try {
        await f.page.evaluate(() => showPokes = () => { window.pendingEntry = (window.pendingEntry || 0) + 1; });
        await f.refresh(start); await f.refresh(start + 500);
        assert.equal((await f.refresh(start + 20500)).kind, 'refreshing');
        await f.page.locator('#app').evaluate(el => el.innerHTML = '<h2>Pokes</h2><p>No new pokes</p>');
        assert.equal((await f.refresh(start + 21250)).kind, 'existing');
        assert.equal(await f.page.evaluate(() => pendingEntry), 1); assert.deepEqual(f.requests, ['/']);
    } finally { await f.context.close(); }
});
test('pausing document refresh does not suppress new incoming poke-back attempts', async () => {
    const f = await fixture({noBack:true});
    try {
        const prepared = await f.tick({now:start, allowRefresh:false});
        assert.equal(prepared.kind, 'prepared'); assert.equal((await f.execute(start, prepared.token)).kind, 'clicked');
        assert.equal((await f.tick({now:start + 1000, allowRefresh:false})).kind, 'watching');
        await f.page.evaluate(() => showPokes());
        assert.equal((await f.tick({now:start + 6000, allowRefresh:false})).kind, 'prepared');
        assert.deepEqual(f.requests, ['/']);
    } finally { await f.context.close(); }
});
test('disabled and feed refresh controls are ignored while the real Back control remains usable', async () => {
    const f = await fixture();
    try {
        await f.page.locator('#app').evaluate(el => el.insertAdjacentHTML('afterbegin', '<div aria-disabled="true"><button onclick="window.wrong=1">Refresh</button></div><article><button onclick="window.wrong=1">Reload</button></article>'));
        await cycle(f, start, 1);
        assert.equal(await f.page.evaluate(() => window.wrong || 0), 0); assert.deepEqual(f.requests, ['/']);
    } finally { await f.context.close(); }
});
test('an unrecorded Back control is never used as an automatic refresh route', async () => {
    const f = await fixture({untracked:true, fromNotifications:true});
    try {
        const r = await f.refresh(start); assert.equal(r.kind, 'refresh-unavailable'); assert.equal(r.pokes, true);
        assert.equal(r.returnSource, 'unrecorded'); assert.equal(await f.page.evaluate(() => backs), 0);
        assert.equal(await f.page.locator('h2').innerText(), 'Pokes'); assert.deepEqual(f.requests, ['/']);
    } finally { await f.context.close(); }
});
test('plain Basic rows keep clicking across recorded notification refreshes and return to Pokes each time', async () => {
    const f = await fixture({fromNotifications:true, plainRows:true});
    try {
        for (let i = 0; i < 5; i++) {
            const now = start + i * 10000;
            const prepared = await f.tick({now}); assert.equal(prepared.kind, 'prepared');
            assert.equal((await f.execute(now, prepared.token)).kind, 'clicked');
            assert.equal((await f.tick({now:now + 1000})).kind, 'refresh');
            assert.equal((await f.refresh(now + 1500, i + 1)).returnSource, 'notification');
            assert.equal(await f.page.locator('h1').innerText(), 'Notifications');
            await f.refresh(now + 2000, i + 1);
            const ready = await f.refresh(now + 2750, i + 1); assert.equal(ready.kind, 'existing');
            assert.equal(ready.pokes, true); assert.equal(await f.page.locator('h2').innerText(), 'Pokes');
        }
        assert.equal(await f.page.evaluate(() => entries), 6); assert.equal(await f.page.evaluate(() => clicks), 5);
        assert.equal(await f.page.evaluate(() => window.wrong || 0), 0);
        assert.deepEqual(f.requests, ['/']);
    } finally { await f.context.close(); }
});
test('a real user click on a poke notification records the return entry without guessing a history destination', async () => {
    const f = await fixture({fromNotifications:true, manualEntry:true});
    try {
        assert.equal((await f.refresh(start)).returnSource, 'notification');
        await f.refresh(start + 500); assert.equal((await f.refresh(start + 1250)).kind, 'existing');
        assert.deepEqual(f.requests, ['/']);
    } finally { await f.context.close(); }
});
test('manual navigation away clears a previously recorded refresh return route', async () => {
    const f = await fixture();
    try {
        await f.page.getByRole('button', {name:'Back', exact:true}).click();
        await f.page.evaluate(() => showPokes());
        const r = await f.refresh(start); assert.equal(r.kind, 'refresh-unavailable');
        assert.equal(r.returnSource, 'unrecorded'); assert.equal(await f.page.evaluate(() => backs), 1);
    } finally { await f.context.close(); }
});

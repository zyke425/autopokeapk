const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const scripts = ['basic-mode.js', 'browser-health.js', 'basic-entry.js', 'autopoke.js']
    .map(name => fs.readFileSync(path.join(__dirname, '../app/src/main/assets', name), 'utf8')).join('\n');
const start = 1800000000000;
const address = 'https://m.facebook.com/pokes?ref=menu&zero=carrier';
const bar = '<header><span>Basic mode plus</span><button onclick="window.buys=1">Buy data</button></header>';
const shell = body => '<!doctype html><html><head><meta charset="utf-8"></head><body>' + bar + body + '</body></html>';
const view = (number, idle) => '<h2>Pokes</h2>' + (idle ? '<p>No new pokes</p>'
    : '<div><a href="/alex">Alex</a> poked you ' + number + ' times in a row <button onclick="window.clicks=(window.clicks||0)+1;this.disabled=true">Poke back</button></div>');
const home = '<h1>Facebook</h1><a href="/pokes?ref=menu&zero=carrier" onclick="event.preventDefault();history.pushState({},\'\',this.href);document.getElementById(\'view\').innerHTML=window.pokesView">Pokes</a><main id="view">Home</main>';
const offer = '<div role="dialog"><h2>You’re out of data, but can still use Facebook</h2><button onclick="window.consents=1;this.parentElement.remove()">Continue</button></div>';
let browser;
before(async () => { browser = await chromium.launch({ headless: true, executablePath: process.env.AUTOPOKE_TEST_BROWSER || undefined }); });
after(async () => { await browser?.close(); });
async function fixture(idle = false) {
    const context = await browser.newContext();
    const requests = []; let pokesLoads = 0;
    await context.route('**/*', route => {
        const url = new URL(route.request().url()); requests.push(url.pathname + url.search);
        if (url.pathname === '/pokes') return route.fulfill({ contentType: 'text/html', body: shell(view(++pokesLoads + 1, idle)) });
        // Re-entering Home reproduces the carrier offer reported after 1.1.8's refresh.
        return route.fulfill({ contentType: 'text/html', body: shell((requests.length > 1 ? offer : '') + home) });
    });
    const page = await context.newPage(); await page.goto('https://m.facebook.com/');
    await page.evaluate(value => window.pokesView = value, view(1, idle)); await page.evaluate(scripts);
    assert.equal((await page.evaluate(() => __autoPokeEntry.open({allowMenu:true}))).kind, 'clicked');
    assert.equal(page.url(), address);
    return { context, page, requests, inject: () => page.evaluate(scripts),
        tick: cfg => page.evaluate(cfg => __autoPokeAndroid.tick({running:true, refreshMs:1000, gapMs:5000, adaptive:false, pokesExpected:true, ...cfg}), cfg),
        entry: () => page.evaluate(() => __autoPokeEntry.open({allowMenu:true})) };
}

test('successive poke-back refreshes reload Pokes without revisiting Home or reopening consent', async () => {
    const f = await fixture(); let state = {};
    try {
        for (let i = 0; i < 8; i++) {
            assert.equal((await f.entry()).kind, 'existing');
            const now = start + i * 10000;
            const prepared = await f.tick({now, state}); assert.equal(prepared.kind, 'prepared');
            state = prepared.state; // The native app durably saves this before execute.
            const clicked = await f.page.evaluate(({now, token}) => __autoPokeAndroid.execute({running:true, now, refreshMs:1000, gapMs:5000, pokesExpected:true}, token), {now, token:prepared.token});
            assert.equal(clicked.kind, 'clicked'); state = clicked.state || state;
            assert.equal(await f.page.evaluate(() => window.clicks), 1);
            assert.equal((await f.tick({now:now + 1000})).kind, 'refresh');
            await f.page.reload(); await f.inject();
            assert.equal(f.page.url(), address);
            assert.equal((await f.entry()).kind, 'existing');
            assert.equal(await f.page.evaluate(() => window.buys || window.consents || 0), 0);
        }
        assert.deepEqual(f.requests, ['/', ...Array(8).fill('/pokes?ref=menu&zero=carrier')]);
    } finally { await f.context.close(); }
});

test('idle refresh cycles keep the Pokes route and carrier parameters', async () => {
    const f = await fixture(true); let state = {};
    try {
        for (let i = 0; i < 5; i++) {
            const now = start + i * 10000;
            const watching = await f.tick({now, state}); assert.equal(watching.kind, 'watching'); state = watching.state || state;
            const refresh = await f.tick({now:now + 1000}); assert.equal(refresh.kind, 'refresh'); state = refresh.state || state;
            await f.page.reload(); await f.inject();
            assert.equal(f.page.url(), address); assert.equal((await f.entry()).kind, 'existing');
        }
        assert.deepEqual(f.requests, ['/', ...Array(5).fill('/pokes?ref=menu&zero=carrier')]);
    } finally { await f.context.close(); }
});

test('a redirected Home view stays in entry inspection until the actual Pokes view returns', async () => {
    const f = await fixture();
    try {
        await f.page.route(url => url.searchParams.has('returned'), route => route.fulfill({contentType:'text/html', body:shell(home)}));
        // Start at the document a redirect would return, without a live server.
        await f.page.goto('https://m.facebook.com/?returned=1');
        assert.equal(f.page.url(), 'https://m.facebook.com/?returned=1');
        await f.page.evaluate(value => window.pokesView = value, view(2, false)); await f.inject();
        assert.equal((await f.entry()).kind, 'clicked', 'Home content must not complete Pokes entry');
        assert.equal((await f.entry()).kind, 'existing');
        assert.equal(await f.page.evaluate(() => window.clicks || window.buys || 0), 0);
        assert.deepEqual(f.requests, ['/']);
    } finally { await f.context.close(); }
});

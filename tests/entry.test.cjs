const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const source = name => fs.readFileSync(path.join(__dirname, '../app/src/main/assets', name), 'utf8');
const script = ['basic-mode.js','browser-health.js','basic-entry.js'].map(source).join('\n');
const html = body => '<!doctype html><html><head><meta charset="utf-8"></head><body>' + body + '</body></html>';
const bar = '<header><span>Basic mode plus</span><button onclick="window.buys=(window.buys||0)+1">Buy data</button></header>';
const pokes = '<h2>Pokes</h2><div>Alex poked you 19 times in a row <button onclick="window.pokeClicks=(window.pokeClicks||0)+1">Poke back</button></div>';
const home = bar + '<h1>Facebook</h1><a href="/pokes?ref=menu&zero=carrier" onclick="event.preventDefault();window.entries=(window.entries||0)+1;history.pushState({},\'\',this.href);document.getElementById(\'view\').innerHTML=window.pokesHtml">Pokes</a><main id="view">Home</main>';
let browser;
before(async () => { browser = await chromium.launch({ headless: true, executablePath: process.env.AUTOPOKE_TEST_BROWSER || undefined }); });
after(async () => { await browser?.close(); });
async function fixture(body, url = 'https://m.facebook.com/') {
    const context = await browser.newContext(); let deepLoads = 0;
    await context.route('**/*', route => {
        if (new URL(route.request().url()).pathname.startsWith('/pokes')) { deepLoads++; return route.fulfill({ contentType: 'text/html', body: html('') }); }
        return route.fulfill({ contentType: 'text/html', body: html(body) });
    });
    const page = await context.newPage(); await page.goto(url);
    await page.evaluate(value => window.pokesHtml = value, pokes); await page.evaluate(script);
    return { context, page, deepLoads: () => deepLoads, open: (cfg = {}) => page.evaluate(cfg => __autoPokeEntry.open({now:1800000000000,...cfg}), cfg) };
}

test('reproduces the old fresh-GET blank and opens Pokes through the existing client router', async () => {
    const f = await fixture(home);
    try {
        // The old implementation extracted href, then discarded the handler.
        const url = await f.page.evaluate(() => __autoPokeBasic.pokesLink());
        await f.page.goto(url); assert.equal(await f.page.locator('body').innerText(), ''); assert.equal(f.deepLoads(), 1);
        await f.page.goto('https://m.facebook.com/'); await f.page.evaluate(value => window.pokesHtml = value, pokes); await f.page.evaluate(script);
        assert.equal((await f.open()).kind, 'clicked');
        assert.equal((await f.open({awaiting:true})).kind, 'existing');
        assert.equal(f.deepLoads(), 1, 'the new path must not issue another deep-link GET');
        assert.match(f.page.url(), /pokes\?ref=menu&zero=carrier/);
        assert.equal(await f.page.evaluate(() => window.pokeClicks || window.buys || 0), 0);
    } finally { await f.context.close(); }
});
test('one menu action reveals the real Pokes item without clicking Buy data', async () => {
    const markup = bar + '<button aria-label="Menu" onclick="document.getElementById(\'nav\').hidden=false;window.menus=(window.menus||0)+1">☰</button><nav id="nav" hidden><button onclick="document.getElementById(\'view\').innerHTML=window.pokesHtml">Pokes</button></nav><main id="view">Home</main>';
    const f = await fixture(markup);
    try {
        assert.equal((await f.open({allowMenu:true})).kind, 'menu');
        assert.equal((await f.open({allowMenu:false})).kind, 'clicked');
        assert.equal((await f.open({awaiting:true})).kind, 'existing');
        assert.equal(await f.page.evaluate(() => menus), 1); assert.equal(await f.page.evaluate(() => window.buys || 0), 0);
    } finally { await f.context.close(); }
});
test('missing Pokes does not turn into a guessed deep link or repeated menu clicks', async () => {
    const f = await fixture(bar + '<button aria-label="Menu" onclick="window.menus=(window.menus||0)+1">Menu</button><p>Home</p>');
    try {
        assert.equal((await f.open({allowMenu:true})).kind, 'menu');
        for (let i=0;i<5;i++) assert.equal((await f.open({allowMenu:false})).kind, 'missing');
        assert.equal(f.deepLoads(), 0); assert.equal(await f.page.evaluate(() => menus), 1);
    } finally { await f.context.close(); }
});
test('consent and login are never accepted by entry navigation', async () => {
    for (const [body, kind] of [
        [bar + '<div role="dialog"><h2>You’re out of data, but can still use Facebook</h2><button onclick="window.consents=1">Continue</button></div>' + home, 'basic-setup'],
        ['<input type="password">' + home, 'login']
    ]) {
        const f = await fixture(body);
        try { assert.equal((await f.open({allowMenu:true})).kind, kind); assert.equal(await f.page.evaluate(() => window.consents || window.entries || 0), 0); }
        finally { await f.context.close(); }
    }
});
test('an in-progress client route is not clicked repeatedly', async () => {
    const f = await fixture(bar + '<a href="/pokes" onclick="event.preventDefault();window.entries=(window.entries||0)+1">Pokes</a><p>Home</p>');
    try {
        assert.equal((await f.open()).kind, 'clicked');
        for(let i=0;i<5;i++) assert.equal((await f.open({awaiting:true})).kind, 'waiting');
        assert.equal(await f.page.evaluate(() => entries), 1); assert.equal(f.deepLoads(), 0);
    } finally { await f.context.close(); }
});
test('feed content, forms, disabled controls and action URLs are excluded', async () => {
    for (const content of [
        '<article><button>Pokes</button></article>', '<form><button>Pokes</button></form>',
        '<button disabled>Pokes</button>', '<a href="/pokes?poke_target=123">Pokes</a>',
        '<a href="https://evil.example/pokes">Pokes</a>'
    ]) {
        const f = await fixture(bar + '<p>Home</p>' + content);
        try { assert.equal((await f.open()).kind, 'missing'); assert.equal(f.deepLoads(), 0); }
        finally { await f.context.close(); }
    }
});
test('an existing Pokes page needs no navigation and never sends a poke', async () => {
    const f = await fixture(bar + pokes);
    try { assert.equal((await f.open({allowMenu:true})).kind, 'existing'); assert.equal(await f.page.evaluate(() => window.pokeClicks || 0), 0); }
    finally { await f.context.close(); }
});
test('load snapshots expose counts rather than cookies, text or response contents', async () => {
    const f = await fixture('<p>PRIVATE_MESSAGE_NOT_TO_COPY</p><script>window.secret="TOKEN_NOT_TO_COPY";</script>');
    try {
        const report = await f.page.evaluate(() => __autoPokeHealth.diagnostics());
        assert.ok(report.htmlCharacters > 0); assert.equal(report.scriptElements, 1);
        assert.equal(typeof report.navigationBodyBytes, 'number');
        assert.equal(JSON.stringify(report).includes('PRIVATE_MESSAGE'), false);
        assert.equal(JSON.stringify(report).includes('TOKEN_NOT_TO_COPY'), false);
        assert.equal(report.cookie, undefined); assert.equal(report.html, undefined);
    } finally { await f.context.close(); }
});
test('a Pokes navigation badge does not hide the client-side entry control', async () => {
    const f = await fixture(home.replace('>Pokes</a>', '>Pokes (3)</a>'));
    try { assert.equal((await f.open()).kind, 'clicked'); assert.equal((await f.open({awaiting:true})).kind, 'existing'); assert.equal(f.deepLoads(), 0); }
    finally { await f.context.close(); }
});
test('a client-only Pokes view retains the site link when its URL still says Home', async () => {
    const f = await fixture(home.replace("history.pushState({},'',this.href);", ''));
    try {
        const entry = await f.open();
        assert.equal(entry.kind, 'clicked');
        assert.equal(entry.pokesLink, 'https://m.facebook.com/pokes?ref=menu&zero=carrier');
        assert.equal(f.page.url(), 'https://m.facebook.com/');
        assert.equal((await f.open({awaiting:true})).kind, 'existing');
        assert.equal(f.deepLoads(), 0);
    } finally { await f.context.close(); }
});

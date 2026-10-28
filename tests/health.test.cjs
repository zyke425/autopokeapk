const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const source = name => fs.readFileSync(path.join(__dirname, '../app/src/main/assets', name), 'utf8');
const script = source('basic-mode.js') + '\n' + source('browser-health.js');
const start = 1800000000000;
let browser;
before(async () => { browser = await chromium.launch({ headless: true, executablePath: process.env.AUTOPOKE_TEST_BROWSER || undefined }); });
after(async () => { await browser?.close(); });
async function fixture(body, url = 'https://m.facebook.com/pokes') {
    const context = await browser.newContext();
    await context.route('**/*', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"></head><body>' + body + '</body></html>' }));
    const page = await context.newPage(); await page.goto(url); await page.evaluate(script);
    return { context, page, inspect: (now = start, values = {}) => page.evaluate(cfg => __autoPokeHealth.read(cfg), { now, pokesExpected: true, browserExpected: true, ...values }) };
}
const row = '<h2>Pokes</h2><div><a href="/alex">Alex</a> poked you 1,043 times in a row <button onclick="window.clicks=(window.clicks||0)+1">Poke back</button></div>';
const offer = '<div role="dialog"><h2>You’re out of data, but can still use Facebook</h2><button onclick="window.consents=(window.consents||0)+1">Continue</button></div>';

test('stopped-loop inspection detects the reported blank mobile Pokes page without sending pokes', async () => {
    const f = await fixture('');
    try {
        assert.equal((await f.inspect()).kind, 'rendering');
        assert.equal((await f.inspect(start + 10000)).kind, 'blank');
        assert.equal(await f.page.evaluate(() => typeof window.__autoPokeAndroid), 'undefined');
        assert.equal(await f.page.evaluate(() => window.clicks || 0), 0);
    } finally { await f.context.close(); }
});
test('blank Basic setup pages recover even before Pokes or Start is selected', async () => {
    const f = await fixture('', 'https://m.facebook.com/');
    try {
        await f.inspect(start, { pokesExpected: false });
        assert.equal((await f.inspect(start + 10000, { pokesExpected: false })).kind, 'blank');
    } finally { await f.context.close(); }
});
test('a stopped-loop Pokes view is recognized without clicking any control', async () => {
    const f = await fixture(row);
    try {
        assert.deepEqual(await f.inspect(), { kind: 'ready', ready: true, pokes: true });
        assert.equal(await f.page.evaluate(() => window.clicks || 0), 0);
    } finally { await f.context.close(); }
});
test('a late visible Pokes view clears the blank timer', async () => {
    const f = await fixture('');
    try {
        await f.inspect(); await f.page.locator('body').evaluate((el, html) => el.innerHTML = html, row);
        assert.equal((await f.inspect(start + 9000)).kind, 'ready');
        await f.page.locator('body').evaluate(el => el.innerHTML = '');
        assert.equal((await f.inspect(start + 10000)).kind, 'rendering');
        assert.equal((await f.inspect(start + 19999)).kind, 'rendering');
        assert.equal((await f.inspect(start + 20000)).kind, 'blank');
    } finally { await f.context.close(); }
});
test('manual sign-in and two-step controls are never classified as blank', async () => {
    for (const input of ['<input type="password">', '<input name="email">', '<input autocomplete="one-time-code">', '<iframe src="/captcha"></iframe>']) {
        const f = await fixture(input);
        try { assert.equal((await f.inspect()).kind, 'login'); assert.equal((await f.inspect(start + 120000)).kind, 'login'); }
        finally { await f.context.close(); }
    }
});
test('Basic consent remains manual while the loop is stopped', async () => {
    const f = await fixture(offer + row);
    try {
        assert.equal((await f.inspect()).kind, 'basic-setup');
        assert.equal((await f.inspect(start + 120000)).kind, 'basic-setup');
        assert.equal(await f.page.evaluate(() => window.consents || window.clicks || 0), 0);
    } finally { await f.context.close(); }
});
test('a usable setup home is not forced into Pokes before the user chooses it', async () => {
    const f = await fixture('<header><a href="/pokes">Pokes</a></header><p>A post about a friend who poked you.</p>', 'https://m.facebook.com/');
    try { assert.deepEqual(await f.inspect(start, { pokesExpected: false }), { kind: 'content', ready: true, pokes: false }); }
    finally { await f.context.close(); }
});
test('loading documents and redirected shells still have bounded health states', async () => {
    const f = await fixture('Loading…', 'https://m.facebook.com/');
    try {
        assert.equal((await f.inspect()).kind, 'loading');
        assert.equal((await f.inspect(start + 45000)).kind, 'stalled');
    } finally { await f.context.close(); }
    const blank = await fixture('');
    try {
        await blank.page.evaluate(() => Object.defineProperty(document, 'readyState', { get: () => 'loading' }));
        await blank.inspect();
        assert.equal((await blank.inspect(start + 29999)).kind, 'rendering');
        assert.equal((await blank.inspect(start + 30000)).kind, 'blank');
    } finally { await blank.context.close(); }
});
test('site-provided Pokes navigation keeps its mobile host and carrier parameters', async () => {
    const f = await fixture('<a href="/pokes/?ref=menu&zero=carrier#top">Pokes</a>', 'https://m.facebook.com/');
    try { assert.equal(await f.page.evaluate(() => __autoPokeBasic.pokesLink()), 'https://m.facebook.com/pokes/?ref=menu&zero=carrier'); }
    finally { await f.context.close(); }
});
test('Pokes navigation rejects action links, external origins and credentials', async () => {
    for (const href of ['/pokes?poke_target=1', '/a/pokes.php', '/pokes?%70oke_target=1', '/pokes?action', 'https://facebook.com.example.org/pokes', 'https://user@m.facebook.com/pokes']) {
        const f = await fixture('<a href="' + href + '">Pokes</a>');
        try { assert.equal(await f.page.evaluate(() => __autoPokeBasic.pokesLink()), ''); }
        finally { await f.context.close(); }
    }
});
test('read-only inspection neither changes the browser mode nor creates automation state', async () => {
    const f = await fixture('<header><span>Basic mode plus</span><button onclick="window.buys=1">Buy data</button></header>' + row);
    try {
        for (let i = 0; i < 20; i++) assert.equal((await f.inspect(start + i * 1500)).kind, 'ready');
        assert.equal(await f.page.evaluate(() => window.clicks || window.buys || 0), 0);
        assert.equal(await f.page.evaluate(() => typeof __autoPokeAndroid), 'undefined');
        assert.equal(await f.page.evaluate(() => __autoPokeBasic.read().state), 'basic');
    } finally { await f.context.close(); }
});
test('an unexpectedly hidden foreground page is reported without acknowledging readiness', async () => {
    const f = await fixture(row);
    try {
        await f.page.evaluate(() => Object.defineProperty(document, 'hidden', { get: () => true }));
        assert.deepEqual(await f.inspect(), { kind: 'hidden', ready: false, pokes: false });
        assert.equal((await f.inspect(start + 120000)).kind, 'hidden');
        assert.equal(await f.page.evaluate(() => window.clicks || 0), 0);
    } finally { await f.context.close(); }
});

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
    const tick = (now = start, changes = {}) => page.evaluate(cfg => window.__autoPokeAndroid.tick(cfg), {
        running: true, refreshMs: 1000, gapMs: 7000, now, state: {}, ...changes
    });
    return { context, page, tick };
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
        assert.equal((await f.tick(start + 300000)).kind, 'offpage');
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

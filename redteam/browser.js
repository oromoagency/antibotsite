/**
 * browser.js — 4 profils de bots NAVIGATEUR (Puppeteer), du moins au plus furtif.
 * Ce sont les profils décisifs : un vrai Chromium peut exécuter le PoW Argon2 client.
 * Question testée : la furtivité permet-elle de passer le gate ET d'extraire les données ?
 */

const TARGET = process.env.TARGET || 'https://antibotsite.onrender.com';
const NAV_TIMEOUT = 45000;

// Capture l'issue d'une session navigateur : a-t-elle été validée ? a-t-elle eu des données ?
async function drive(page, label) {
    const net = { verifyChallenge: null, prismDemo: null, challengeConfig: null };

    page.on('response', async (res) => {
        const url = res.url();
        try {
            if (url.includes('/api/verify-challenge')) {
                net.verifyChallenge = { status: res.status(), body: (await res.text()).slice(0, 300) };
            } else if (url.includes('/api/challenge-config')) {
                net.challengeConfig = { status: res.status() };
            } else if (url.includes('/api/prism/demo')) {
                net.prismDemo = { status: res.status(), body: (await res.text()).slice(0, 400) };
            }
        } catch (_) {}
    });

    let navStatus = null;
    try {
        const resp = await page.goto(TARGET + '/', { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });
        navStatus = resp ? resp.status() : null;
    } catch (e) {
        return { label, error: 'nav: ' + e.message.slice(0, 120), net };
    }

    // Laisse le flux client (PoW + verify) se dérouler
    await new Promise(r => setTimeout(r, 8000));

    const webdriver = await page.evaluate(() => navigator.webdriver).catch(() => 'n/a');
    const finalUrl  = page.url();
    const title     = await page.title().catch(() => '');

    // Tente d'appeler l'API protégée depuis le contexte de la page (avec ses cookies)
    let apiProbe = null;
    try {
        apiProbe = await page.evaluate(async () => {
            const r = await fetch('/api/prism/demo', { headers: { 'Accept': 'application/json' } });
            const t = await r.text();
            return { status: r.status, body: t.slice(0, 400) };
        });
    } catch (e) { apiProbe = { error: e.message.slice(0, 100) }; }

    // Détecte si du vrai contenu est apparu (vs page de défi)
    const bodyText = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 300) : '').catch(() => '');

    return { label, navStatus, webdriver, finalUrl, title, net, apiProbe, bodyPeek: bodyText.replace(/\s+/g, ' ').trim() };
}

async function runBrowserProfiles() {
    const puppeteer = require('puppeteer-extra');
    const stealth = require('puppeteer-extra-plugin-stealth');
    const vanilla = require('puppeteer');
    const results = [];

    // ── Profil 17 : Headless par défaut (navigator.webdriver = true) ──────────
    {
        const b = await vanilla.launch({ headless: 'new', args: ['--no-sandbox'] });
        const p = await b.newPage();
        await p.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
        results.push(Object.assign({ id: 17, name: 'Puppeteer headless (no stealth)', category: 'browser', expected: 'L5 détecte webdriver → 403' }, await drive(p, 'headless-default')));
        await b.close();
    }

    // ── Profil 18 : Stealth (webdriver masqué) ────────────────────────────────
    {
        puppeteer.use(stealth());
        const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
        const p = await b.newPage();
        results.push(Object.assign({ id: 18, name: 'Puppeteer + stealth', category: 'browser', expected: 'PoW résolu ; validation = test décisif' }, await drive(p, 'stealth')));
        await b.close();
    }

    // ── Profil 19 : Stealth + ghost-cursor (souris humaine) ───────────────────
    {
        puppeteer.use(stealth());
        const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
        const p = await b.newPage();
        let cursorMoved = false;
        try {
            const { createCursor } = require('ghost-cursor');
            await p.goto(TARGET + '/', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
            const cursor = createCursor(p);
            // Mouvements de souris plausibles avant la suite
            await cursor.moveTo({ x: 200, y: 200 }).catch(() => {});
            await cursor.moveTo({ x: 450, y: 380 }).catch(() => {});
            cursorMoved = true;
        } catch (_) {}
        const r = Object.assign({ id: 19, name: 'Puppeteer + stealth + ghost-cursor', category: 'browser', expected: 'biométrie souris plausible ; test L6' }, await drive(p, 'stealth-ghostcursor'));
        r.cursorMoved = cursorMoved;
        results.push(r);
        await b.close();
    }

    // ── Profil 20 : Stealth, extraction directe API après gate ────────────────
    {
        puppeteer.use(stealth());
        const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
        const p = await b.newPage();
        const r = Object.assign({ id: 20, name: 'Puppeteer + stealth → extraction API', category: 'browser', expected: 'si validé : données réfractées (watermark/poison)' }, await drive(p, 'stealth-extract'));
        // Analyse de réfraction si données obtenues
        if (r.apiProbe && r.apiProbe.body) {
            r.refractionCheck = analyzeRefraction(r.apiProbe.body);
        }
        results.push(r);
        await b.close();
    }

    return results;
}

// Détecte des signes de réfraction dans une réponse JSON (watermark/poison)
function analyzeRefraction(body) {
    try {
        const json = JSON.parse(body);
        const data = json.data || json;
        return {
            hasData: Array.isArray(data) ? data.length > 0 : !!data,
            reality: json.reality || 'n/a',
            sample: JSON.stringify(data).slice(0, 200),
        };
    } catch (_) {
        return { hasData: false, note: 'non-json ou tronqué' };
    }
}

module.exports = { runBrowserProfiles, analyzeRefraction };

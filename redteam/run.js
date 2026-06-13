/**
 * run.js — Orchestrateur du red-team. Lance les 16 profils HTTP + 4 navigateur,
 * collecte les résultats et écrit redteam/report-data.json.
 */

const fs = require('fs');
const path = require('path');
const { PROFILES, classify } = require('./profiles');
const { runBrowserProfiles } = require('./browser');

const TARGET = process.env.TARGET || 'https://antibotsite.onrender.com';
const KNOWN_CHALLENGE_LEN = 18758; // taille connue de la page de défi (recon)

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function doRequest(req) {
    const url = TARGET + req.path;
    const t0 = Date.now();
    const res = await fetch(url, {
        method: req.method || 'GET',
        headers: req.headers || {},
        body: req.body || undefined,
        redirect: 'manual',
    });
    const body = await res.text();
    return {
        path: req.path,
        status: res.status,
        ms: Date.now() - t0,
        len: body.length,
        ctype: res.headers.get('content-type') || '',
        xRobots: res.headers.get('x-robots-tag') || '',
        nxSess: /nx_sess/.test(res.headers.get('set-cookie') || ''),
        outcome: classify(res.status, res.headers.get('content-type') || '', body, req.path),
        bodySample: body.slice(0, 120).replace(/\s+/g, ' ').trim(),
    };
}

async function runHttpProfiles() {
    const out = [];
    for (const prof of PROFILES) {
        const responses = [];
        for (const req of prof.requests) {
            try {
                responses.push(await doRequest(req));
            } catch (e) {
                responses.push({ path: req.path, error: String(e.message || e) });
            }
            await sleep(150); // gentil — pas de flood
        }
        // Verdict du profil : a-t-il obtenu du contenu réel ou des données ?
        const leaked = responses.some(r => r.outcome === 'CONTENT_LEAK' || r.outcome === 'API_DATA');
        const honeypotBaited = responses.some(r => r.outcome === 'HONEYPOT_BAIT');
        const allGatedOrBlocked = responses.every(r =>
            ['CHALLENGE_PAGE', 'API_BLOCKED', 'BLOCKED_403', 'RATE_LIMITED', 'REDIRECT', 'HONEYPOT_BAIT'].includes(r.outcome));
        out.push({
            id: prof.id, name: prof.name, category: prof.category, expected: prof.expected,
            responses,
            verdict: leaked ? 'FUITE' : (honeypotBaited ? 'PIÈGE ACTIF' : (allGatedOrBlocked ? 'CONTENU PROTÉGÉ' : 'À VÉRIFIER')),
        });
        process.stdout.write(`  [${String(prof.id).padStart(2)}] ${prof.name.padEnd(34)} → ${out[out.length - 1].verdict}\n`);
    }
    return out;
}

(async () => {
    console.log(`\n=== RED-TEAM ${TARGET} ===`);
    console.log(`Date: ${new Date().toISOString()}\n`);

    console.log('── Profils HTTP (1-16) ──');
    const http = await runHttpProfiles();

    console.log('\n── Profils navigateur (17-20) — Puppeteer/stealth ──');
    let browser = [];
    try {
        browser = await runBrowserProfiles();
        for (const b of browser) {
            const validated = b.net && b.net.verifyChallenge && b.net.verifyChallenge.status === 200 && /success.*true/.test(b.net.verifyChallenge.body);
            const gotData = b.apiProbe && b.apiProbe.status === 200;
            b.verdict = gotData ? 'DONNÉES OBTENUES' : (validated ? 'VALIDÉ (sans données API)' : 'BLOQUÉ/NON VALIDÉ');
            process.stdout.write(`  [${b.id}] ${b.name.padEnd(40)} webdriver=${b.webdriver} verify=${b.net?.verifyChallenge?.status || '—'} api=${b.apiProbe?.status || '—'} → ${b.verdict}\n`);
        }
    } catch (e) {
        console.log('  ERREUR navigateur:', e.message);
    }

    const report = {
        target: TARGET,
        date: new Date().toISOString(),
        knownChallengeLen: KNOWN_CHALLENGE_LEN,
        httpProfiles: http,
        browserProfiles: browser,
        summary: {
            httpTotal: http.length,
            httpProtected: http.filter(p => p.verdict === 'CONTENU PROTÉGÉ').length,
            httpHoneypotBaited: http.filter(p => p.verdict === 'PIÈGE ACTIF').length,
            httpLeaked: http.filter(p => p.verdict === 'FUITE').length,
            browserTotal: browser.length,
            browserGotData: browser.filter(b => b.verdict === 'DONNÉES OBTENUES').length,
            browserValidated: browser.filter(b => b.verdict && b.verdict.startsWith('VALIDÉ')).length,
            browserBlocked: browser.filter(b => b.verdict === 'BLOQUÉ/NON VALIDÉ').length,
        },
    };

    const outPath = path.join(__dirname, 'report-data.json');
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`\n✓ Données écrites : ${outPath}`);
    console.log('\n── RÉSUMÉ ──');
    console.log(JSON.stringify(report.summary, null, 2));
})();

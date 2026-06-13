/**
 * recon.js — Reconnaissance baseline du site cible (notre propre déploiement).
 * Aucune charge agressive : une poignée de requêtes pour cartographier les réponses.
 */

const TARGET = process.env.TARGET || 'https://antibotsite.onrender.com';

const probes = [
    { name: 'Browser (full headers)', path: '/', headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'sec-ch-ua': '"Chromium";v="126", "Not(A:Brand";v="24", "Google Chrome";v="126"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
    }},
    { name: 'curl (bare)', path: '/', headers: { 'User-Agent': 'curl/8.4.0' } },
    { name: 'Googlebot UA', path: '/', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' } },
    { name: 'GPTBot UA', path: '/', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)' } },
    { name: 'robots.txt', path: '/robots.txt', headers: { 'User-Agent': 'curl/8.4.0' } },
    { name: 'challenge-config', path: '/api/challenge-config', headers: { 'User-Agent': 'Mozilla/5.0' } },
    { name: 'prism/demo (no session)', path: '/api/prism/demo', headers: { 'User-Agent': 'Mozilla/5.0' } },
];

async function probe(p) {
    const url = TARGET + p.path;
    const t0 = Date.now();
    try {
        const res = await fetch(url, { headers: p.headers, redirect: 'manual' });
        const ms = Date.now() - t0;
        const body = await res.text();
        const setCookie = res.headers.get('set-cookie') || '';
        return {
            name: p.name,
            status: res.status,
            ms,
            len: body.length,
            ctype: res.headers.get('content-type') || '',
            xRobots: res.headers.get('x-robots-tag') || '',
            xPrismeAction: res.headers.get('x-prisme-action') || '',
            xPrismeReality: res.headers.get('x-prisme-reality') || '',
            location: res.headers.get('location') || '',
            nxSess: /nx_sess/.test(setCookie),
            snippet: body.slice(0, 160).replace(/\s+/g, ' ').trim(),
        };
    } catch (e) {
        return { name: p.name, error: String(e.message || e), ms: Date.now() - t0 };
    }
}

(async () => {
    console.log(`[RECON] Cible: ${TARGET}`);
    console.log('[RECON] Note: Render free tier peut faire un cold-start (~30-60s) sur la 1re requête.\n');
    for (const p of probes) {
        const r = await probe(p);
        if (r.error) { console.log(`✗ ${r.name.padEnd(28)} ERREUR (${r.ms}ms): ${r.error}`); continue; }
        console.log(`• ${r.name.padEnd(28)} ${r.status} ${String(r.ms).padStart(5)}ms len=${String(r.len).padStart(6)} ${r.ctype.split(';')[0]}`);
        console.log(`    nx_sess=${r.nxSess} xRobots="${r.xRobots}" action="${r.xPrismeAction}" reality="${r.xPrismeReality}" loc="${r.location}"`);
        console.log(`    body: ${r.snippet}`);
    }
})();

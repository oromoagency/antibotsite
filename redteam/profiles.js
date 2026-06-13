/**
 * profiles.js — 16 profils de bots au niveau HTTP (sans navigateur).
 * Chaque profil simule un client automatisé distinct contre notre propre site.
 * Volume volontairement faible (test fonctionnel, pas de flood).
 */

const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'sec-ch-ua': '"Chromium";v="126", "Not(A:Brand";v="24", "Google Chrome";v="126"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Upgrade-Insecure-Requests': '1',
};

// Chaque profil : { id, name, category, expected, requests:[{path, method, headers, body}] }
// expected = comportement attendu de la défense selon la doctrine Zero Bot.
const PROFILES = [
    // ── Catégorie 1 : Clients HTTP scriptés déclaratifs ───────────────────────
    { id: 1, name: 'curl/8.4', category: 'script-client', expected: 'gate ou block (pas de contenu)',
      requests: [{ path: '/', headers: { 'User-Agent': 'curl/8.4.0' } }] },
    { id: 2, name: 'wget', category: 'script-client', expected: 'gate ou block',
      requests: [{ path: '/', headers: { 'User-Agent': 'Wget/1.21.4' } }] },
    { id: 3, name: 'python-requests', category: 'script-client', expected: 'gate ou block',
      requests: [{ path: '/', headers: { 'User-Agent': 'python-requests/2.31.0' } }] },
    { id: 4, name: 'Go-http-client', category: 'script-client', expected: 'gate ou block',
      requests: [{ path: '/', headers: { 'User-Agent': 'Go-http-client/2.0' } }] },
    { id: 5, name: 'Scrapy', category: 'script-client', expected: 'gate ou block',
      requests: [{ path: '/', headers: { 'User-Agent': 'Scrapy/2.11 (+https://scrapy.org)' } }] },
    { id: 6, name: 'node axios', category: 'script-client', expected: 'gate ou block',
      requests: [{ path: '/', headers: { 'User-Agent': 'axios/1.6.0' } }] },

    // ── Catégorie 2 : Crawlers déclarés (spoofés, pas de rDNS) ────────────────
    { id: 7, name: 'Googlebot (spoof)', category: 'declared-crawler', expected: 'block (Zero Bot)',
      requests: [{ path: '/', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' } }] },
    { id: 8, name: 'Bingbot (spoof)', category: 'declared-crawler', expected: 'block (Zero Bot)',
      requests: [{ path: '/', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)' } }] },
    { id: 9, name: 'GPTBot (spoof)', category: 'declared-crawler', expected: 'block (Zero Bot)',
      requests: [{ path: '/', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)' } }] },

    // ── Catégorie 3 : Incohérences d'en-têtes (browser UA mal forgé) ──────────
    { id: 10, name: 'Browser UA, no Accept-Language', category: 'header-mismatch', expected: 'contradiction medium',
      requests: [{ path: '/', headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'], 'Accept': 'text/html' } }] },
    { id: 11, name: 'Chromium UA, no sec-ch-ua', category: 'header-mismatch', expected: 'contradiction medium',
      requests: [{ path: '/', headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'], 'Accept-Language': 'en-US' } }] },
    { id: 12, name: 'Browser UA complet (HTTP)', category: 'header-mismatch', expected: 'gate (HTTP ne résout pas le PoW)',
      requests: [{ path: '/', headers: BROWSER_HEADERS }] },

    // ── Catégorie 4 : Attaques comportementales ───────────────────────────────
    { id: 13, name: 'API-first (sans page)', category: 'behavioral', expected: '401 human_session_required',
      requests: [{ path: '/api/prism/demo', headers: BROWSER_HEADERS }] },
    { id: 14, name: 'Rafale vélocité (8x)', category: 'behavioral', expected: 'gate constant / rate-limit',
      requests: Array.from({ length: 8 }, () => ({ path: '/', headers: BROWSER_HEADERS })) },
    { id: 15, name: 'Honeypot toucher', category: 'behavioral', expected: 'trap 403 + strike',
      requests: [{ path: '/api/__internal/v2/stats', headers: BROWSER_HEADERS }] },
    { id: 16, name: 'Demo API directe (toutes voies)', category: 'behavioral', expected: '401 sans session',
      requests: [
        { path: '/api/demo/v1/users', headers: BROWSER_HEADERS },
        { path: '/api/demo/v1/metrics', headers: BROWSER_HEADERS },
      ] },
];

// Marqueurs pour classifier une réponse HTML
const CHALLENGE_MARKERS = ['argon', 'difficulty', 'challenge', 'proof', 'preuve', 'verif'];
const CONTENT_MARKERS   = ['data-price', 'id="dashboard"', 'class="product', 'protected_app', 'api-key', 'sk_live'];

// Chemins honeypot intentionnels — retournent du bait, jamais de vraies données.
// Un 200+JSON ici est un piège actif, PAS une fuite.
const HONEYPOT_PATHS = new Set([
    '/__internal/v2/stats',
    '/api/__internal/v2/stats',
    '/api/feedback-invisible',
]);

function classify(status, ctype, body, path = '') {
    // Les endpoints honeypot retournent intentionnellement du JSON 200 — c'est du bait
    if (HONEYPOT_PATHS.has(path)) return 'HONEYPOT_BAIT';

    const isJson = ctype.includes('json');
    const low = (body || '').toLowerCase();

    if (isJson) {
        if (status === 401) return 'API_BLOCKED';
        if (status === 403) return 'API_BLOCKED';
        if (status === 200) return 'API_DATA';
        return 'API_OTHER_' + status;
    }
    if (status === 403) return 'BLOCKED_403';
    if (status === 429) return 'RATE_LIMITED';
    if (status >= 300 && status < 400) return 'REDIRECT';

    const hasChallenge = CHALLENGE_MARKERS.some(m => low.includes(m));
    const hasContent   = CONTENT_MARKERS.some(m => low.includes(m));
    if (hasContent && !hasChallenge) return 'CONTENT_LEAK';
    if (hasChallenge) return 'CHALLENGE_PAGE';
    return 'HTML_' + status;
}

module.exports = { PROFILES, classify, BROWSER_HEADERS, CHALLENGE_MARKERS, CONTENT_MARKERS };

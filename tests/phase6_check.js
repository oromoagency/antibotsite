// Test de régression Phase 6 — rapport bots #3 : "je veux que des humains, un bot reste un bot"
// Vérifie les 3 nouveaux signaux :
//   1. L1 détection UA bot (Googlebot / GPTBot / curl / python-requests…)
//   2. L6 MISSING_KEYBOARD_PENALTY durci (-45 → BLOCK, non-BAN, retryable)
//   3. L6 NO_INTERACTION_PENALTY durci (-85 → BAN, non-retryable)

const crypto = require('crypto-js');
const config = require('../src/config');
const L1_network = require('../src/layers/L1_network');
const L1_tls = require('../src/layers/L1_tls');
const L2 = require('../src/layers/L2_access');
const L3 = require('../src/layers/L3_pow');
const L4 = require('../src/layers/L4_hardware');
const L5 = require('../src/layers/L5_automation');
const L6 = require('../src/layers/L6_biometrics');
const verdict = require('../src/policy/verdict');

// ─── Utilitaires ────────────────────────────────────────────────────────────

function mineNonce(timestamp, fingerprint) {
    const target = '0'.repeat(config.CHALLENGE_DIFFICULTY);
    let nonce = 0;
    for (;;) {
        const h = crypto.SHA256(timestamp.toString() + JSON.stringify(fingerprint) + nonce.toString()).toString();
        if (h.startsWith(target)) return nonce.toString();
        nonce++;
    }
}

// Mock request minimal pour tester L1_network middleware
function mockReq(uaString, rawHeaderPairs, httpVersion) {
    const rawHeaders = rawHeaderPairs.reduce((acc, [k, v]) => [...acc, k, v], []);
    const headers = rawHeaderPairs.reduce((acc, [k, v]) => ({ ...acc, [k.toLowerCase()]: v }), {});
    return { rawHeaders, headers, httpVersion: httpVersion || '2.0', ip: '1.2.3.4', connection: { remoteAddress: '1.2.3.4' } };
}

function runL1Network(req) {
    let called = false;
    L1_network.analyze(req, {}, () => { called = true; });
    return req.l1Signals;
}

// ─── Pipeline complet (identique à l'orchestrateur, sans Express) ───────────

// L3 borné aux champs PoW (le rejeu de télémétrie est testé en phase 7).
function runPipeline(p) {
    const pow = L3.analyze({ nonce: p.nonce, timestamp: p.timestamp, fingerprint: p.fingerprint });
    if (pow.fatal) return { fatal: true, score: 0, reasons: pow.reasons };

    const tls = L1_tls.analyze({ ja4: p.ja4, userAgent: p.fingerprint.userAgent });
    const acc = L2.analyze({ ip: p.ip });
    const hw = L4.analyze({ webgl: p.hardware && p.hardware.webgl, canvas: p.hardware && p.hardware.canvas, audio: p.hardware && p.hardware.audio, sensorDesync: p.sensorDesync, fingerprint: p.fingerprint });
    const au = L5.analyze({ automation: p.automation, vsync: p.vsync });
    const bio = L6.analyze({ mouseTrajectory: p.mouseTrajectory, keystrokes: p.keystrokes });

    const net = p.l1Network || { score: 0, reasons: [], declarative: false };
    const l1 = {
        score: (net.score || 0) + (tls.score || 0),
        reasons: [...(net.reasons || []), ...(tls.reasons || [])],
        declarative: net.declarative === true,
    };
    const v = verdict.decide([pow, l1, acc, hw, au, bio]);
    return { fatal: false, ...v };
}

// ─── Gabarits ────────────────────────────────────────────────────────────────

const ts = Date.now();
const fp = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36', language: 'fr-FR', screenResolution: '1920x1080' };

const fpNonce = mineNonce(ts, fp);

const humanMouse = [];
let mx = 100, my = 100, mt = ts;
for (let i = 0; i < 30; i++) { mx += Math.round(8 + Math.sin(i) * 5 + (i % 3)); my += Math.round(6 + Math.cos(i * 1.3) * 4 + (i % 2)); mt += 12 + (i % 5); humanMouse.push({ x: mx, y: my, t: mt, p: 'mouse', et: 'move', pr: 0 }); }
humanMouse.push({ x: mx + 10, y: my + 5, t: mt + 200, p: 'mouse', et: 'down', pr: 0.5 });
const humanKeys = [90, 110, 75, 130, 95, 120].map((d, i) => ({ key: 'a', dwellTime: d, flightTime: 50 + i, t_up: ts + i * 200 }));
const humanVsync = [16.7, 16.6, 16.9, 16.5, 17.0, 16.4, 16.8, 16.6, 16.7, 16.9];
const cleanAutomation = { webdriver: false, webdriverPatched: false, stealthArtifacts: false, cdpStackTrap: false, cdpProxyTrap: false };
const realHardware = { canvas: 'a1b2c3hash', webgl: { vendor: 'NVIDIA', renderer: 'NVIDIA GeForce RTX 3060' }, audio: '124.04347657' };

const base = () => ({
    nonce: fpNonce, timestamp: ts, fingerprint: fp,
    ip: '86.200.10.5', ja4: undefined, sensorDesync: false,
    hardware: realHardware, automation: { ...cleanAutomation },
    vsync: humanVsync, mouseTrajectory: humanMouse, keystrokes: humanKeys,
});

let failures = 0;

function check(label, payload, mode) {
    const r = runPipeline(payload);
    const passed = !r.fatal && r.allowed;
    const banned = !r.fatal && r.ban;
    let ok;
    if (mode === 'pass') ok = passed;
    else if (mode === 'block') ok = !passed;
    else if (mode === 'block_no_ban') ok = !passed && !banned;
    else if (mode === 'ban') ok = !passed && banned;
    if (!ok) failures++;
    const verdict = passed ? 'PASS' : (banned ? 'BLOCK+BAN' : 'BLOCK');
    console.log(`${ok ? '✅' : '❌'} ${label} | score=${r.fatal ? 'FATAL' : r.score} | attendu=${mode} | obtenu=${verdict}`);
    if (r.reasons.length) console.log(`     raisons: ${r.reasons.join(' | ')}`);
}

// ─── Section 1 : L1 détection UA bot ────────────────────────────────────────

console.log('=== Test Phase 6 — Section 1 : L1 détection UA bot ===');

function checkL1UA(label, ua, expectBot) {
    const req = mockReq(ua, [['Host', 'example.com'], ['User-Agent', ua]]);
    const signals = runL1Network(req);
    const isBot = signals.score <= L1_network.PENALTIES.knownBotUA;
    const ok = isBot === expectBot;
    if (!ok) failures++;
    console.log(`${ok ? '✅' : '❌'} ${label} | score=${signals.score} | bot=${isBot}(att ${expectBot})`);
}

checkL1UA('Chrome humain           ', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', false);
checkL1UA('Firefox humain          ', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0', false);
checkL1UA('Safari iOS humain       ', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', false);
checkL1UA('Googlebot               ', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', true);
checkL1UA('GPTBot (OpenAI)         ', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)', true);
checkL1UA('ClaudeBot (Anthropic)   ', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +anthropic.com/bot)', true);
checkL1UA('Bingbot                 ', 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', true);
checkL1UA('AhrefsBot SEO           ', 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)', true);
checkL1UA('python-requests         ', 'python-requests/2.31.0', true);
checkL1UA('curl                    ', 'curl/7.88.1', true);
checkL1UA('Scrapy                  ', 'Scrapy/2.11.0 (+https://scrapy.org)', true);
checkL1UA('PerplexityBot           ', 'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)', true);

// ─── Section 2 : L6 pénalités durcies ───────────────────────────────────────

console.log('\n=== Test Phase 6 — Section 2 : L6 pénalités durcies ===');

// Bot souris sans clavier : fausse trajectoire propre mais jamais touché au champ de saisie
// Résultat attendu : BLOCK (non BAN) — humain peut réessayer et taper cette fois
const mouseOnlyBot = { ...base(), keystrokes: [] };
check('Bot souris sans clavier (BLOCK, retryable)', mouseOnlyBot, 'block_no_ban');

// Bot zéro interaction + hardware/vsync parfaitement forgés : une SEULE couche
// témoigne (L6, -85) → doctrine de corroboration : BLOCK sans ban. Il ne passera
// jamais (re-bloqué à chaque tentative), et un vrai script brut échoue aussi sur
// L4/L5 (cf. POST direct en phase 5) → 3 témoins → BAN par accumulation.
const noInteractionBot = { ...base(), mouseTrajectory: [], keystrokes: [] };
check('Bot zéro interaction (BLOCK, 1 témoin)   ', noInteractionBot, 'block_no_ban');

// ─── Section 3 : pipeline complet avec UA bot connu ─────────────────────────

console.log('\n=== Test Phase 6 — Section 3 : pipeline complet avec UA bot L1 ===');

// Googlebot : inject le signal L1 manuellement (le middleware tourne via Express en prod).
// `declarative: true` : le bot s'est IDENTIFIÉ lui-même — exempté de corroboration.
const googlebotProfile = {
    ...base(),
    l1Network: { score: L1_network.PENALTIES.knownBotUA, reasons: ['User-Agent bot connu détecté (Googlebot/2.1)'], declarative: true },
};
check('Googlebot (auto-identifié L1)             ', googlebotProfile, 'ban');

const gptbotProfile = {
    ...base(),
    l1Network: { score: L1_network.PENALTIES.knownBotUA, reasons: ['User-Agent bot connu détecté (GPTBot/1.1)'], declarative: true },
};
check('GPTBot OpenAI (auto-identifié L1)         ', gptbotProfile, 'ban');

console.log(failures === 0 ? '\n✅ TOUS LES TESTS PASSENT' : `\n❌ ${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);

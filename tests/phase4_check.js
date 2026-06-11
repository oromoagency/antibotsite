// Test de régression Phase 4 — L1 TLS/JA4 (cohérence JA4 ↔ User-Agent).

const L1 = require('../src/layers/L1_tls');

const UA_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const UA_FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0';
const UA_CURL = 'curl/8.4.0';

// JA4 plausibles
const JA4_CHROME = 't13d1516h2_8daaf6152771_e5627efa2ab1';
const JA4_FIREFOX = 't13d1715h2_5b57614c22b0_3cbfd9057e0d';
const JA4_PY_SPOOF = 't12i090800_aaaaaaaaaaaa_bbbbbbbbbbbb'; // TLS1.2, SNI absent, 9 ciphers, pas de h2

let failures = 0;
function check(label, args, predicate) {
    const r = L1.analyze(args);
    const ok = predicate(r);
    if (!ok) failures++;
    console.log(`${ok ? '✅' : '❌'} ${label} | score=${r.score}`);
    if (r.reasons.length) console.log(`     raisons: ${r.reasons.join(' | ')}`);
}

console.log('=== Test Phase 4 : L1 empreinte TLS/JA4 ===');

check('Chrome réel + UA Chrome   ', { ja4: JA4_CHROME, userAgent: UA_CHROME }, r => r.score === 0);
check('Firefox réel + UA Firefox ', { ja4: JA4_FIREFOX, userAgent: UA_FIREFOX }, r => r.score === 0);
check('Python TLS + UA Chrome usurpé', { ja4: JA4_PY_SPOOF, userAgent: UA_CHROME }, r => r.score <= -60);
check('Aucun JA4 (pas de proxy)  ', { ja4: undefined, userAgent: UA_CHROME }, r => r.score === 0);
check('UA non-navigateur (curl)  ', { ja4: JA4_PY_SPOOF, userAgent: UA_CURL }, r => r.score === 0);
// Faux positif corporate : proxy SSL d'entreprise (TLS 1.3, SNI ok, http/1.1,
// 25 ciphers OpenSSL) re-originant le trafic d'un HUMAIN → ne doit jamais
// franchir -40 (seuil de blocage solo).
check('Proxy SSL entreprise (humain)', { ja4: 't13d2511h1_aaaaaaaaaaaa_bbbbbbbbbbbb', userAgent: UA_CHROME }, r => r.score >= -40 && r.score < 0);

// Blocklist exacte
L1.KNOWN_BOT_JA4.add('t13d1516h2_deadbeef0000_cafebabe1111');
check('JA4 sur blocklist         ', { ja4: 't13d1516h2_deadbeef0000_cafebabe1111', userAgent: UA_CHROME }, r => r.score === -100);

console.log(failures === 0 ? '\n✅ TOUS LES TESTS PASSENT' : `\n❌ ${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);

// Test de régression Phase 8 — DURCISSEMENT POST-AUDIT (revue adversariale, 33 findings).
// Verrouille les corrections : sécurité, faux-négatifs fermés, faux-positifs corrigés.

const crypto = require('crypto-js');
const config = require('../src/config');
const L2 = require('../src/layers/L2_access');
const L3 = require('../src/layers/L3_pow');
const L4 = require('../src/layers/L4_hardware');
const L5 = require('../src/layers/L5_automation');
const L6 = require('../src/layers/L6_biometrics');
const verdict = require('../src/policy/verdict');
const reputation = require('../src/store/reputation');
const validationController = require('../src/controllers/validationController');

function mineNonce(timestamp, fingerprint) {
    const target = '0'.repeat(config.CHALLENGE_DIFFICULTY);
    let nonce = 0;
    for (;;) {
        const h = crypto.SHA256(timestamp.toString() + JSON.stringify(fingerprint) + nonce.toString()).toString();
        if (h.startsWith(target)) return nonce.toString();
        nonce++;
    }
}

const ts = Date.now();
const fp = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36', language: 'fr-FR', screenResolution: '1920x1080' };
const fpNonce = mineNonce(ts, fp);

function cleanHumanMouse(offset) {
    const pts = [];
    let x = 100 + (offset % 31), y = 100 + (offset % 17), t = ts + offset;
    for (let i = 0; i < 30; i++) {
        x += Math.round(8 + Math.sin(i + offset) * 5 + (i % 3));
        y += Math.round(6 + Math.cos(i * 1.3 + offset) * 4 + (i % 2));
        t += 12 + (i % 5);
        pts.push({ x, y, t, p: 'mouse', et: 'move', pr: 0 });
    }
    pts.push({ x: x + 9, y: y + 4, t: t + 200, p: 'mouse', et: 'down', pr: 0.5 });
    return pts;
}
const humanKeys = [90, 110, 75, 130, 95, 120].map((d, i) => ({ key: 'a', dwellTime: d, flightTime: i === 0 ? 0 : 50 + i, t_up: ts + i * 200 }));
const humanVsync = [16.7, 16.6, 16.9, 16.5, 17.0, 16.4, 16.8, 16.6, 16.7, 16.9];
const cleanAutomation = { webdriver: false, webdriverPatched: false, stealthArtifacts: false, cdpStackTrap: false, cdpProxyTrap: false };
const realHardware = { canvas: 'a1b2c3hash', webgl: { vendor: 'NVIDIA', renderer: 'NVIDIA GeForce RTX 3060' }, audio: '124.04347657' };

let failures = 0;
function assert(label, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failures++;
    console.log(`${ok ? '✅' : '❌'} ${label} | obtenu=${JSON.stringify(actual)} | attendu=${JSON.stringify(expected)}`);
}
function assertTrue(label, cond) {
    if (!cond) failures++;
    console.log(`${cond ? '✅' : '❌'} ${label}`);
}

// ═══ A. SÉCURITÉ ═══
console.log('=== Phase 8 — A. Sécurité ===');

// A1. Secret aléatoire (pas la constante connue du source)
assertTrue('SECRET_KEY n\'est pas la constante codée en dur',
    config.SECRET_KEY !== 'MY_ULTRA_SECURE_SECRET_DO_NOT_SHARE_EVER' && config.SECRET_KEY.length >= 32);

// A2. Timestamp dans le futur (au-delà de 5s) → FATAL (PoW pré-calculé)
const futureTs = ts + 30000;
const futureNonce = mineNonce(futureTs, fp);
const futurePow = L3.analyze({ nonce: futureNonce, timestamp: futureTs, fingerprint: fp });
assertTrue('Timestamp +30s dans le futur → fatal', futurePow.fatal === true);

// A3. Petite avance d'horloge (3s) tolérée → pas fatal
const skewTs = ts + 3000;
const skewNonce = mineNonce(skewTs, fp);
const skewPow = L3.analyze({ nonce: skewNonce, timestamp: skewTs, fingerprint: fp });
assertTrue('Avance horloge 3s tolérée → non fatal', skewPow.fatal === false);

// A4. Honeypot CSRF : POST cross-origin → AUCUN strike sur l'IP victime
const victimIp = '203.0.113.50';
const beforeStrikes = reputation.getReputation(victimIp).strikes;
const mockRes = () => ({ status() { return this; }, send() { return this; }, json() { return this; } });
validationController.recordSilentFeedback(
    { ip: victimIp, headers: { origin: 'https://evil-site.example', host: 'antibot.local' }, connection: {} }, mockRes());
assert('Honeypot cross-origin (CSRF) → pas de strike victime', reputation.getReputation(victimIp).strikes, beforeStrikes);

// A5. Honeypot même origine (vrai bot parcourant notre DOM) → strike
const botIp = '203.0.113.77';
validationController.recordSilentFeedback(
    { ip: botIp, headers: { origin: 'https://antibot.local', host: 'antibot.local' }, connection: {} }, mockRes());
assertTrue('Honeypot même origine → strike appliqué', reputation.getReputation(botIp).strikes === 1);

// ═══ B. FAUX NÉGATIFS FERMÉS ═══
console.log('\n=== Phase 8 — B. Faux négatifs fermés ===');

// B1. nodriver à UN SEUL piège CDP : passait pile à 60, désormais 55 → BLOQUÉ
const oneTrap = L5.analyze({ automation: { ...cleanAutomation, cdpProxyTrap: true }, vsync: humanVsync });
assert('Un seul piège CDP (proxy) → -45 (était -40)', oneTrap.score, -45);

// B2. Rejeu de mini-trajectoire 2 points (dodgeait l'ancien seuil 5)
const tinyTraj = [{ x: 10, y: 20, t: ts, p: 'mouse' }, { x: 12, y: 23, t: ts + 40, p: 'mouse' }];
const r1 = L3.analyze({ nonce: fpNonce, timestamp: ts, fingerprint: fp, mouseTrajectory: tinyTraj, keystrokes: [] });
const r2 = L3.analyze({ nonce: fpNonce, timestamp: ts, fingerprint: fp, mouseTrajectory: tinyTraj, keystrokes: [] });
assert('Mini-rejeu 2 pts : 1re → 0', r1.score, 0);
assert('Mini-rejeu 2 pts : 2e → -80', r2.score, L3.REPLAYED_TELEMETRY_PENALTY);

// B3. Vélocité IP-seule : le martèlement SANS empreinte est désormais compté
const hammerIp = '198.18.0.1';
let last = null;
for (let i = 1; i <= 30; i++) last = L2.analyze({ ip: hammerIp }); // pas de fingerprint
assert('Martèlement IP-seule (30/min) → -30', last.score, -30);

// B4. Le script qui OMET l'empreinte finit banni par ACCUMULATION (L2 IP + L6)
//     À la 30e tentative : L2 IP-seule -30 (témoin) + L6 zéro interaction -85 (témoin) = ban
function noFpScriptVerdict(ip) {
    const acc = L2.analyze({ ip }); // pas de fingerprint
    const bio = L6.analyze({ mouseTrajectory: [], keystrokes: [] });
    return verdict.decide([{ score: 0, reasons: [] }, acc, bio]);
}
const omitIp = '198.18.0.2';
let omitBannedAt = null;
for (let i = 1; i <= 30; i++) {
    const v = noFpScriptVerdict(omitIp);
    if (v.ban && omitBannedAt === null) omitBannedAt = i;
}
assertTrue('Script sans empreinte : banni dès que la cadence IP corrobore (≤30)', omitBannedAt !== null && omitBannedAt <= 30);

// ═══ C. FAUX POSITIFS CORRIGÉS ═══
console.log('\n=== Phase 8 — C. Faux positifs corrigés ===');

// C1. Mobile sans screenResolution mais avec userAgent → AUCUNE pénalité incomplet
const mobileFp = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1', language: 'fr-FR' };
const mobileHw = L4.analyze({ webgl: { vendor: 'Apple', renderer: 'Apple GPU' }, canvas: 'h', audio: '35.7', fingerprint: mobileFp });
assert('Mobile sans screenResolution → L4 = 0', mobileHw.score, 0);

// C2. Payload VRAIMENT vide (pas d'userAgent) → pénalité incomplet conservée
const emptyHw = L4.analyze({ webgl: realHardware.webgl, canvas: 'h', audio: 'a', fingerprint: { language: 'fr' } });
assertTrue('Fingerprint sans userAgent → pénalité incomplet', emptyHw.reasons.some(r => r.includes('incomplet')));

// C3. Employé RDP + navigateur vie-privée (Basic Render + Canvas/Audio bloqués) → plafonné
const rdpPrivacyHw = L4.analyze({
    webgl: { vendor: 'Microsoft', renderer: 'Microsoft Basic Render Driver' },
    canvas: 'CANVAS_BLOCKED', audio: 'AUDIO_ERROR', fingerprint: fp,
});
assert('RDP + vie-privée → L4 plafonné à -20 (était -45)', rdpPrivacyHw.score, -20);

// C4. Clavier : cadence plate ET frappe surhumaine se CUMULENT (-80, plus d'early-return)
const flatFastKeys = [100, 100, 100, 100, 100, 100].map((d, i) => ({ key: 'a', dwellTime: d, flightTime: i === 0 ? 0 : 2, t_up: ts + i * 5 }));
const flatFastBio = L6.analyze({ mouseTrajectory: cleanHumanMouse(5000), keystrokes: flatFastKeys });
assert('Clavier plat + surhumain → -80 (cumul)', flatFastBio.score, -80);
assertTrue('  ... avec les deux raisons', flatFastBio.reasons.some(r => r.includes('artificielle')) && flatFastBio.reasons.some(r => r.includes('surhumaine')));

// ═══ D. DOCTRINE : FUSION L1 = UN SEUL TÉMOIN ═══
console.log('\n=== Phase 8 — D. Fusion L1 (une couche = un témoin) ===');

// L1_network -40 + L1_tls -50 : fusionnés = 1 témoin (score 10, PAS de ban) ;
// comptés séparément = 2 témoins (score 10 < 20 → ban à tort sur une seule couche).
const netSig = { score: -40, reasons: ['header anomalie'], declarative: false };
const tlsSig = { score: -50, reasons: ['SNI absent'], declarative: false };
const mergedL1 = {
    score: netSig.score + tlsSig.score,
    reasons: [...netSig.reasons, ...tlsSig.reasons],
    declarative: false,
};
const vMerged = verdict.decide([mergedL1]);
const vSeparate = verdict.decide([netSig, tlsSig]);
assert('L1 fusionné → 1 témoin', vMerged.witnesses, 1);
assertTrue('L1 fusionné (score 10) → PAS de ban', vMerged.ban === false);
assertTrue('L1 séparé (bug) aurait banni à tort (2 témoins)', vSeparate.witnesses === 2 && vSeparate.ban === true);

// ═══ E. NON-RÉGRESSION DOCTRINE ═══
console.log('\n=== Phase 8 — E. Non-régression : ban indépendant de allowed ===');
// Un bot à score >= 60 n'est jamais banni (ban exige score < 20).
const vHigh = verdict.decide([{ score: -15, reasons: [] }, { score: -15, reasons: [] }]);
assertTrue('2 témoins faibles mais score 70 → PASS, pas de ban', vHigh.allowed === true && vHigh.ban === false);

console.log(failures === 0 ? '\n✅ TOUS LES TESTS PASSENT' : `\n❌ ${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);

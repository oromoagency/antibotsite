// Test de régression Phase 9 — INTELLIGENCE GLOBALE (l'étage au-dessus des couches).
// Verrouille : le journal des verdicts (events), la posture de flotte
// (CALME/VIGILANCE/ATTAQUE), la difficulté PoW adaptative avec FENÊTRE DE
// GRÂCE anti-faux-positifs, le rejet sans strike du PoW à difficulté périmée,
// l'endpoint admin protégé, et l'invariant doctrine : la posture ne touche
// JAMAIS aux seuils de verdict.

const crypto = require('crypto-js');
const config = require('../src/config');
const L3 = require('../src/layers/L3_pow');
const verdict = require('../src/policy/verdict');
const posture = require('../src/policy/posture');
const events = require('../src/store/events');
const reputation = require('../src/store/reputation');
const validationController = require('../src/controllers/validationController');
const adminController = require('../src/controllers/adminController');

// Mine un nonce dont le hash a EXACTEMENT k zéros de tête (le k+1e caractère
// est non-zéro) — indispensable : un hash qui aurait par hasard k+1 zéros
// satisferait aussi la difficulté supérieure et fausserait les tests d'escalade.
function mineNonceExact(timestamp, fingerprint, k) {
    const target = '0'.repeat(k);
    let nonce = 0;
    for (;;) {
        const h = crypto.SHA256(timestamp.toString() + JSON.stringify(fingerprint) + nonce.toString()).toString();
        if (h.startsWith(target) && h[k] !== '0') return nonce.toString();
        nonce++;
    }
}

const fp = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36', language: 'fr-FR', screenResolution: '1920x1080' };

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

// Injecte n verdicts hostiles depuis n IPs distinctes à l'instant t.
function injectHostile(n, t, prefix) {
    for (let i = 0; i < n; i++) {
        events.record({ ip: `${prefix}.${i}`, verdict: 'block', score: 30, witnesses: 1, reasons: ['signal de test'], t });
    }
}

// ═══ A. JOURNAL DES VERDICTS (store/events.js) ═══
console.log('=== Phase 9 — A. Journal des verdicts ===');

events.clear();
const nowA = Date.now();
events.record({ ip: '10.0.0.1', verdict: 'pass', score: 100, t: nowA - 1000 });
events.record({ ip: '10.0.0.2', verdict: 'block', score: 40, reasons: ['raison X'], t: nowA - 800 });
events.record({ ip: '10.0.0.2', verdict: 'ban', score: 5, reasons: ['raison X'], t: nowA - 500 });
events.record({ ip: '10.0.0.3', verdict: 'fatal', score: 0, reasons: ['raison Y'], t: nowA - 200 });
const statsA = events.statsWindow(60 * 1000, nowA);
assert('A1. Comptage pass/block/ban/fatal', [statsA.pass, statsA.block, statsA.ban, statsA.fatal], [1, 1, 1, 1]);
assert('A2. Hostiles = block+ban+fatal', statsA.hostile, 3);
assert('A3. IPs hostiles DISTINCTES (10.0.0.2 ×2 = 1)', statsA.hostileIps, 2);
assertTrue('A4. Raison dominante agrégée ("raison X" ×2)', statsA.topReasons[0].reason === 'raison X' && statsA.topReasons[0].count === 2);

// Mémoire bornée : on dépasse le plafond, le store élague par l'avant.
events.clear();
for (let i = 0; i < events.MAX_EVENTS + 500; i++) {
    events.record({ ip: '10.1.0.1', verdict: 'pass', score: 100 });
}
assertTrue(`A5. Store borné à ${events.MAX_EVENTS} événements`, events.size() <= events.MAX_EVENTS);

// TTL : un événement de plus d'une heure est élagué à l'écriture suivante.
events.clear();
events.record({ ip: '10.2.0.1', verdict: 'ban', t: Date.now() - 2 * 60 * 60 * 1000 });
events.record({ ip: '10.2.0.2', verdict: 'pass' });
assert('A6. Événement > 1 h élagué (TTL)', events.size(), 1);

// ═══ B. POSTURE DE FLOTTE ═══
console.log('\n=== Phase 9 — B. Posture : CALME → VIGILANCE → ATTAQUE ===');

posture._reset(); events.clear();
assert('B1. Défaut : CALME, difficulté de base', [posture.evaluate(), posture.currentDifficulty()], [posture.LEVELS.CALM, config.CHALLENGE_DIFFICULTY]);

// VIGILANCE par IPs distinctes (≥ 4 IPs hostiles = attaque distribuée naissante)
const nowB = Date.now();
injectHostile(4, nowB - 1000, '203.0.113');
assert('B2. 4 IPs hostiles → VIGILANCE, difficulté 5', [posture.evaluate(nowB), posture.currentDifficulty()], [posture.LEVELS.VIGILANCE, 5]);

// VIGILANCE par volume (≥ 12 hostiles même depuis peu d'IPs)
posture._reset(); events.clear();
for (let i = 0; i < 12; i++) events.record({ ip: '198.18.5.1', verdict: 'block', t: nowB - 900, reasons: [] });
assert('B3. 12 hostiles (1 IP) → VIGILANCE', posture.evaluate(nowB), posture.LEVELS.VIGILANCE);

// ATTAQUE par IPs distinctes (≥ 10 = attaque distribuée)
posture._reset(); events.clear();
injectHostile(10, nowB - 1000, '203.0.114');
assert('B4. 10 IPs hostiles → ATTAQUE', posture.evaluate(nowB), posture.LEVELS.ATTACK);
assertTrue(`B5. Difficulté PLAFONNÉE à ${posture.MAX_DIFFICULTY} même sous ATTAQUE (anti-FP mobile)`, posture.currentDifficulty() === posture.MAX_DIFFICULTY);

// Dé-escalade : la fenêtre se vide → retour CALME
const afterWindow = nowB + posture.POSTURE_WINDOW_MS + 1000;
assert('B6. Fenêtre vidée → retour CALME, difficulté base', [posture.evaluate(afterWindow), posture.currentDifficulty()], [posture.LEVELS.CALM, config.CHALLENGE_DIFFICULTY]);

// ═══ C. FENÊTRE DE GRÂCE (anti-FP critique) ═══
console.log('\n=== Phase 9 — C. Fenêtre de grâce : escalade pendant le minage ===');

posture._reset(); events.clear();
const T0 = Date.now();
injectHostile(12, T0 - 500, '192.0.2');
posture.evaluate(T0); // escalade 4 → 5 à T0
assert('C1. 10 s après escalade : difficulté 4 ENCORE acceptée (grâce)', posture.minAcceptableDifficulty(T0 + 10 * 1000), 4);
assert('C2. 95 s après escalade : difficulté 5 exigée (grâce expirée)', posture.minAcceptableDifficulty(T0 + 95 * 1000), 5);
// Dé-escalade : la difficulté INFÉRIEURE est acceptée immédiatement (un hash
// miné à 5 satisfait toujours 4 — seule la borne basse compte).
posture.evaluate(T0 + posture.POSTURE_WINDOW_MS + 1000);
assert('C3. Après dé-escalade : difficulté 4 acceptée immédiatement', posture.minAcceptableDifficulty(T0 + posture.POSTURE_WINDOW_MS + 2000), 4);

// ═══ D. L3 : DIFFICULTÉ ADAPTATIVE ═══
console.log('\n=== Phase 9 — D. L3 : PoW périmé rejeté SANS strike ===');

// D1. Posture CALME : un hash à difficulté 4 passe.
posture._reset(); events.clear();
const fpD1 = { ...fp, language: 'fr-CA' };
const tsD1 = Date.now();
const calmPow = L3.analyze({ nonce: mineNonceExact(tsD1, fpD1, 4), timestamp: tsD1, fingerprint: fpD1 });
assertTrue('D1. CALME : hash difficulté 4 accepté', calmPow.fatal === false);

// D2. Escalade DANS la fenêtre de grâce : le hash 4 passe encore.
posture._reset(); events.clear();
injectHostile(12, Date.now() - 500, '192.0.3');
posture.evaluate(); // escalade maintenant
const fpD2 = { ...fp, language: 'fr-BE' };
const tsD2 = Date.now();
const gracePow = L3.analyze({ nonce: mineNonceExact(tsD2, fpD2, 4), timestamp: tsD2, fingerprint: fpD2 });
assertTrue('D2. Escalade il y a < 90 s : hash 4 accepté (grâce)', gracePow.fatal === false);

// D3. Escalade il y a 2 min (grâce expirée) : hash 4 → FATAL mais SANS strike
//     (humain resté sur la page pendant l'escalade — il recharge et re-mine).
posture._reset(); events.clear();
const pastNow = Date.now() - 120 * 1000;
injectHostile(12, pastNow - 500, '192.0.4');
posture.evaluate(pastNow); // escalade il y a 2 min
const fpD3 = { ...fp, language: 'fr-CH' };
const tsD3 = Date.now();
const stalePow = L3.analyze({ nonce: mineNonceExact(tsD3, fpD3, 4), timestamp: tsD3, fingerprint: fpD3 });
assertTrue('D3. Grâce expirée : hash 4 → fatal', stalePow.fatal === true);
assertTrue('D3b. ... mais noStrike=true (anti-FP)', stalePow.noStrike === true);
assertTrue('D3c. ... raison "difficulté périmée"', stalePow.reasons[0].includes('périmée'));

// D4. Un PoW FORGÉ (hash faux) reste un rejet AVEC strike.
const forgedPow = L3.analyze({ nonce: 'garbage', timestamp: Date.now(), fingerprint: { ...fp, language: 'fr-LU' } });
assertTrue('D4. Hash forgé → fatal SANS exemption de strike', forgedPow.fatal === true && forgedPow.noStrike !== true);

// ═══ E. ORCHESTRATEUR : strike épargné de bout en bout ═══
console.log('\n=== Phase 9 — E. Contrôleur : pas de strike pour le PoW périmé ===');

// (posture toujours escaladée il y a 2 min depuis D3)
const mkRes = () => {
    const r = { code: 0, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.cookie = () => r;
    return r;
};

const staleIp = '198.51.100.42';
const fpE = { ...fp, language: 'fr-MC' };
const tsE = Date.now();
const resE = mkRes();
validationController.verifyChallenge(
    { ip: staleIp, body: { nonce: mineNonceExact(tsE, fpE, 4), timestamp: tsE, fingerprint: fpE }, headers: {}, connection: {} }, resE);
assert('E1. PoW périmé → 403 (retryable)', resE.code, 403);
assert('E2. ... et AUCUN strike sur l\'IP', reputation.getReputation(staleIp).strikes, 0);

const forgedIp = '198.51.100.43';
const resE3 = mkRes();
validationController.verifyChallenge(
    { ip: forgedIp, body: { nonce: 'garbage', timestamp: Date.now(), fingerprint: { ...fp, language: 'fr-AD' } }, headers: {}, connection: {} }, resE3);
assert('E3. PoW forgé → strike conservé (non-régression)', reputation.getReputation(forgedIp).strikes, 1);

// Le rejet fatal est journalisé pour la posture.
assertTrue('E4. Rejets journalisés dans le store d\'événements', events.statsWindow(60 * 1000).fatal >= 2);

// ═══ F. ENDPOINT ADMIN ═══
console.log('\n=== Phase 9 — F. Tableau de bord : jeton obligatoire ===');

const resF1 = mkRes();
adminController.getStats({ headers: { 'x-admin-token': 'mauvais-jeton' } }, resF1);
assert('F1. Jeton invalide → 401', resF1.code, 401);

const resF2 = mkRes();
adminController.getStats({ headers: {} }, resF2);
assert('F2. Jeton absent → 401', resF2.code, 401);

const resF3 = mkRes();
adminController.getStats({ headers: { 'x-admin-token': config.ADMIN_TOKEN } }, resF3);
assertTrue('F3. Jeton valide → stats (posture, difficulté, fenêtres)',
    resF3.body !== null
    && typeof resF3.body.posture === 'string'
    && typeof resF3.body.difficulty === 'number'
    && resF3.body.window5min && typeof resF3.body.window5min.hostile === 'number'
    && resF3.body.lastHour && Array.isArray(resF3.body.lastHour.topReasons));

// ═══ G. DOCTRINE : la posture ne touche JAMAIS au verdict ═══
console.log('\n=== Phase 9 — G. Invariant : seuils de verdict INTOUCHÉS sous ATTAQUE ===');

posture._reset(); events.clear();
injectHostile(15, Date.now() - 500, '192.0.5');
posture.evaluate();
assertTrue('G0. (préambule) posture = ATTAQUE', posture.currentLevel() === posture.LEVELS.ATTACK);

// Un humain propre passe toujours à l'identique.
const vClean = verdict.decide([{ score: 0, reasons: [] }]);
assertTrue('G1. Humain propre sous ATTAQUE → PASS (score 100)', vClean.allowed === true && vClean.score === 100);

// Un bot mono-témoin reste BLOCK sans ban (la corroboration ne se durcit pas).
const vOne = verdict.decide([{ score: -100, reasons: ['webdriver'] }]);
assertTrue('G2. Bot 1 témoin sous ATTAQUE → BLOCK sans ban (corroboration intacte)', vOne.allowed === false && vOne.ban === false);

// La difficulté annoncée au client reste plafonnée.
const resG = mkRes();
validationController.getChallengeConfig({ headers: {} }, resG);
assertTrue(`G3. Difficulté annoncée ≤ ${posture.MAX_DIFFICULTY} sous ATTAQUE`,
    resG.body !== null && resG.body.difficulty === posture.MAX_DIFFICULTY);

// Nettoyage : ne pas polluer un éventuel enchaînement de suites dans le même processus.
posture._reset(); events.clear();

console.log(failures === 0 ? '\n✅ TOUS LES TESTS PASSENT' : `\n❌ ${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);

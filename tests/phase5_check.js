// Test de régression Phase 5 — ANTI-FAUX-POSITIFS (rapport bots #2 + revue adversariale).
// Rejoue le pipeline complet pour chaque profil d'HUMAIN à risque (doivent PASSER),
// des compromis assumés (bloqués SANS ban, retryables), et des bots de contrôle.

const crypto = require('crypto-js');
const config = require('../src/config');
const L1_tls = require('../src/layers/L1_tls');
const L2 = require('../src/layers/L2_access');
const L3 = require('../src/layers/L3_pow');
const L4 = require('../src/layers/L4_hardware');
const L5 = require('../src/layers/L5_automation');
const L6 = require('../src/layers/L6_biometrics');
const verdict = require('../src/policy/verdict');

function mineNonce(timestamp, fingerprint) {
    const target = '0'.repeat(config.CHALLENGE_DIFFICULTY);
    let nonce = 0;
    for (;;) {
        const h = crypto.SHA256(timestamp.toString() + JSON.stringify(fingerprint) + nonce.toString()).toString();
        if (h.startsWith(target)) return nonce.toString();
        nonce++;
    }
}

// Pipeline complet (identique à l'orchestrateur, sans Express).
// L3 borné aux champs PoW : le rejeu de télémétrie (phase 7) se déclencherait
// artificiellement ici, les profils partageant humanMouse.
function runPipeline(p) {
    const pow = L3.analyze({ nonce: p.nonce, timestamp: p.timestamp, fingerprint: p.fingerprint });
    if (pow.fatal) return { fatal: true, score: 0, reasons: pow.reasons };

    const tls = L1_tls.analyze({ ja4: p.ja4, userAgent: p.fingerprint.userAgent });
    const acc = L2.analyze({ ip: p.ip });
    const hw = L4.analyze({
        webgl: p.hardware && p.hardware.webgl,
        canvas: p.hardware && p.hardware.canvas,
        audio: p.hardware && p.hardware.audio,
        sensorDesync: p.sensorDesync, fingerprint: p.fingerprint,
    });
    const au = L5.analyze({ automation: p.automation, vsync: p.vsync });
    const bio = L6.analyze({ mouseTrajectory: p.mouseTrajectory, keystrokes: p.keystrokes });

    const l1 = mergeL1(p.l1Network, tls);
    const v = verdict.decide([pow, l1, acc, hw, au, bio]);
    return { fatal: false, ...v };
}

// Fusion L1 (réseau + TLS) en UN témoin, comme l'orchestrateur.
function mergeL1(net, tls) {
    net = net || { score: 0, reasons: [], declarative: false };
    return {
        score: (net.score || 0) + (tls.score || 0),
        reasons: [...(net.reasons || []), ...(tls.reasons || [])],
        declarative: net.declarative === true,
    };
}

const ts = Date.now();
const fp = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36', language: 'fr-FR', screenResolution: '1920x1080' };
const fpMobile = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1', language: 'fr-FR', screenResolution: '390x844' };
// Précomputer chaque nonce UNE SEULE FOIS : 15+ appels séquentiels à mineNonce()
// dépassaient le seuil L3 de 60s avant même que les checks démarrent.
const fpNonce = mineNonce(ts, fp);
const fpMobileNonce = mineNonce(ts, fpMobile);

// Gabarits humains sains — champs et/pr ajoutés (format gateway v2 : bracket + pression)
const humanMouse = [];
let x = 100, y = 100, t = ts;
for (let i = 0; i < 30; i++) { x += Math.round(8 + Math.sin(i) * 5 + (i % 3)); y += Math.round(6 + Math.cos(i * 1.3) * 4 + (i % 2)); t += 12 + (i % 5); humanMouse.push({ x, y, t, p: 'mouse', et: 'move', pr: 0 }); }
// Clic réel : pointerdown avec pression 0.5 (spec W3C Pointer Events)
humanMouse.push({ x: x + 10, y: y + 5, t: t + 200, p: 'mouse', et: 'down', pr: 0.5 });
const humanKeys = [90, 110, 75, 130, 95, 120].map((d, i) => ({ key: 'a', dwellTime: d, flightTime: 50 + i, t_up: ts + i * 200 }));
const humanVsync = [16.7, 16.6, 16.9, 16.5, 17.0, 16.4, 16.8, 16.6, 16.7, 16.9, 16.5, 17.1, 16.3, 16.8, 16.6];
const cleanAutomation = { webdriver: false, webdriverPatched: false, stealthArtifacts: false, cdpStackTrap: false, cdpProxyTrap: false };
const realHardware = { canvas: 'a1b2c3hash', webgl: { vendor: 'NVIDIA', renderer: 'NVIDIA GeForce RTX 3060' }, audio: '124.04347657' };
const blockedHardware = { canvas: 'CANVAS_BLOCKED', webgl: { vendor: 'NO_WEBGL', renderer: 'NO_WEBGL' }, audio: 'AUDIO_ERROR' };
const RESIDENTIAL_IP = '86.200.10.5';

const base = (fingerprint) => ({
    nonce: fingerprint === fpMobile ? fpMobileNonce : fpNonce,
    timestamp: ts, fingerprint,
    ip: RESIDENTIAL_IP, ja4: undefined, sensorDesync: false,
    hardware: realHardware, automation: { ...cleanAutomation },
    vsync: humanVsync, mouseTrajectory: humanMouse, keystrokes: humanKeys,
});

// ============ PROFILS HUMAINS À RISQUE (tous doivent PASSER) ============

// 1. Navigateur vie-privée : Canvas/WebGL/Audio TOUS bloqués (CanvasBlocker, Brave strict)
const privacyHuman = { ...base(fp), hardware: blockedHardware };

// 2. Mobile : aucun point souris, 2 taps tactiles seulement
const mobileHuman = {
    ...base(fpMobile),
    hardware: { canvas: 'mobilehash', webgl: { vendor: 'Apple Inc.', renderer: 'Apple GPU' }, audio: '35.7383' },
    mouseTrajectory: [{ x: 195, y: 600, t: ts, p: 'touch' }, { x: 200, y: 410, t: ts + 2200, p: 'touch' }],
};

// 3. Firefox resistFingerprinting : timers quantifiés → VSync à variance nulle + audio bloqué
const rfpHuman = {
    ...base(fp),
    vsync: Array(15).fill(16.6667),
    hardware: { ...realHardware, audio: 'AUDIO_ERROR' },
};

// 4. VPN grand public (Cloudflare WARP / iCloud Private Relay) : IP datacenter, hardware réel
const vpnHuman = { ...base(fp), ip: '104.16.1.1' };

// 5. Employé derrière un proxy SSL d'entreprise : JA4 re-originé (http/1.1, 25 ciphers)
const corpProxyHuman = { ...base(fp), ja4: 't13d2511h1_aaaaaaaaaaaa_bbbbbbbbbbbb' };

// 6. Coup de souris rapide pendant le jank du minage PoW : saut de 400px mais dt = 120ms
const jankMouse = humanMouse.slice(0, 25).concat([
    { x: 900, y: 500, t: humanMouse[24].t + 120, p: 'mouse', et: 'move', pr: 0 },
    { x: 905, y: 503, t: humanMouse[24].t + 135, p: 'mouse', et: 'move', pr: 0 },
    { x: 911, y: 508, t: humanMouse[24].t + 151, p: 'mouse', et: 'move', pr: 0 },
    { x: 915, y: 512, t: humanMouse[24].t + 300, p: 'mouse', et: 'down', pr: 0.5 },
]);
const jankHuman = { ...base(fp), mouseTrajectory: jankMouse };

// 7. Utilisateur clavier-seul (accessibilité) : frappe ok, AUCUN pointer event
const keyboardOnlyHuman = { ...base(fp), mouseTrajectory: [] };

// 8. [REVUE] Aveugle sous Tor + lecteur d'écran : hardware farblé + clavier seul (cumul)
const torScreenReaderHuman = { ...base(fp), hardware: blockedHardware, mouseTrajectory: [] };

// 9. [REVUE] VPN WARP + extensions vie-privée CUMULÉS : datacenter + hardware farblé
const vpnPrivacyHuman = { ...base(fp), ip: '104.16.1.1', hardware: blockedHardware };

// 10. [REVUE] Mobile/desktop lent : seulement 12 points souris sous contention PoW
const slowMouse = [];
let sx = 100, sy = 100, st = ts;
for (let i = 0; i < 12; i++) { sx += Math.round(8 + Math.sin(i) * 5 + (i % 3)); sy += Math.round(6 + Math.cos(i * 1.3) * 4 + (i % 2)); st += 80 + (i % 5); slowMouse.push({ x: sx, y: sy, t: st, p: 'mouse', et: 'move', pr: 0 }); }
slowMouse.push({ x: sx + 10, y: sy + 5, t: st + 200, p: 'mouse', et: 'down', pr: 0.5 });
const slowDeviceHuman = { ...base(fp), mouseTrajectory: slowMouse };

// 11. [REVUE] Firefox RFP + proxy entreprise CUMULÉS (vsync constant + TLS h1 + audio bloqué)
const corpRfpHuman = {
    ...base(fp), ja4: 't13d2511h1_aaaaaaaaaaaa_bbbbbbbbbbbb',
    vsync: Array(15).fill(16.6667),
    hardware: { ...realHardware, audio: 'AUDIO_ERROR' },
};

// ============ COMPROMIS ASSUMÉ (bloqué SANS ban — retryable) ============

// 12. Développeur avec DevTools ouverts : déclenche les deux pièges CDP (-55).
//     Bloqué (45) mais JAMAIS banni — population quasi nulle en prod, et les devs
//     testent sur loopback (non bannissable). Prix assumé pour fermer le trou nodriver.
const devToolsHuman = { ...base(fp), automation: { ...cleanAutomation, cdpStackTrap: true, cdpProxyTrap: true } };

// ============ PROFILS BOTS DE CONTRÔLE (doivent rester BLOQUÉS) ============

// 13. nodriver (G3) : vrai GPU, pas de webdriver, mais les deux pièges CDP, biométrie maquillée
const nodriverBot = { ...base(fp), automation: { ...cleanAutomation, cdpStackTrap: true, cdpProxyTrap: true } };
// (identique au dev DevTools en signaux passifs — c'est précisément pourquoi on bloque les deux)

// 14. Agent VLM : clics par coordonnées (sauts énormes à dt quasi nul) + datacenter
const vlmMouse = [];
for (let i = 0; i < 25; i++) {
    const px = (i % 2 === 0) ? 50 + i * 2 : 850 - i * 2;
    const py = (i % 2 === 0) ? 600 - i * 3 : 80 + i * 3;
    vlmMouse.push({ x: px, y: py, t: ts + i * 8, p: 'mouse' });
}
const vlmBot = { ...base(fp), ip: '3.5.6.7', mouseTrajectory: vlmMouse };

// 15. POST direct sans aucune télémétrie (script HTTP brut)
const directPostBot = {
    ...base(fp),
    hardware: undefined, automation: {}, vsync: [],
    mouseTrajectory: [], keystrokes: [],
};

// 16. Bot VLM ligne droite + CDP : trajectoire parfaitement horizontale (contourne
//     le jerk mais pas la courbure), pointerdown avec pression 0 (signature CDP).
const linearBotMouse = [];
for (let i = 0; i < 20; i++) {
    linearBotMouse.push({ x: 100 + i * 20, y: 200, t: ts + i * 40, p: 'mouse', et: 'move', pr: 0 });
}
linearBotMouse.push({ x: 500, y: 200, t: ts + 20 * 40, p: 'mouse', et: 'down', pr: 0 });
const linearBot = { ...base(fp), mouseTrajectory: linearBotMouse };

let failures = 0;
// mode: 'pass' | 'block' | 'block_no_ban'
function check(label, payload, mode) {
    const r = runPipeline(payload);
    const passed = !r.fatal && r.allowed;
    const banned = !r.fatal && r.ban;
    let ok;
    if (mode === 'pass') ok = passed;
    else if (mode === 'block') ok = !passed;
    else if (mode === 'block_no_ban') ok = !passed && !banned;
    if (!ok) failures++;
    const verdict = passed ? 'PASS' : (banned ? 'BLOCK+BAN' : 'BLOCK');
    console.log(`${ok ? '✅' : '❌'} ${label} | score=${r.fatal ? 'FATAL' : r.score} | attendu=${mode} | obtenu=${verdict}`);
    if (r.reasons.length) console.log(`     raisons: ${r.reasons.join(' | ')}`);
}

console.log('=== Test Phase 5 : anti-faux-positifs (humains à risque) ===');
check('Vie privée (tout bloqué)      ', privacyHuman, 'pass');
check('Mobile tactile (2 taps)       ', mobileHuman, 'pass');
check('Firefox resistFingerprinting  ', rfpHuman, 'pass');
check('VPN WARP / Private Relay      ', vpnHuman, 'pass');
check('Proxy SSL entreprise          ', corpProxyHuman, 'pass');
check('Flick souris pendant jank PoW ', jankHuman, 'pass');
check('Clavier-seul (accessibilité)  ', keyboardOnlyHuman, 'pass');
check('Tor + lecteur écran (cumul)   ', torScreenReaderHuman, 'pass');
check('VPN + vie-privée (cumul)      ', vpnPrivacyHuman, 'pass');
check('Appareil lent (12 pts souris) ', slowDeviceHuman, 'pass');
check('Firefox RFP + proxy (cumul)   ', corpRfpHuman, 'pass');
console.log('--- compromis assumé : bloqué mais JAMAIS banni ---');
check('Dev DevTools ouverts          ', devToolsHuman, 'block_no_ban');
console.log('--- contrôles : les bots restent bloqués ---');
check('nodriver (G3, pièges CDP)     ', nodriverBot, 'block');
check('Agent VLM (téléportation)     ', vlmBot, 'block');
check('POST direct sans télémétrie   ', directPostBot, 'block');
check('Bot ligne droite + CDP pr=0   ', linearBot, 'block');

console.log(failures === 0 ? '\n✅ TOUS LES TESTS PASSENT' : `\n❌ ${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);

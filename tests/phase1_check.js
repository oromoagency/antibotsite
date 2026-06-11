// Test de régression Phase 1 — vérifie l'agrégation des couches L3→L6.
// Rejoue 3 profils : humain, bot headless brut, bot furtif G3.

const crypto = require('crypto-js');
const config = require('../src/config');
const L3 = require('../src/layers/L3_pow');
const L4 = require('../src/layers/L4_hardware');
const L5 = require('../src/layers/L5_automation');
const L6 = require('../src/layers/L6_biometrics');

const TRUST_THRESHOLD = 60;

function mineNonce(timestamp, fingerprint) {
    const target = '0'.repeat(config.CHALLENGE_DIFFICULTY);
    let nonce = 0;
    for (;;) {
        const h = crypto.SHA256(timestamp.toString() + JSON.stringify(fingerprint) + nonce.toString()).toString();
        if (h.startsWith(target)) return nonce.toString();
        nonce++;
    }
}

function runPipeline(p) {
    // L3 borné aux champs PoW : le rejeu de télémétrie (testé en phase 7) se
    // déclencherait artificiellement ici, les profils partageant leurs trajectoires.
    const pow = L3.analyze({ nonce: p.nonce, timestamp: p.timestamp, fingerprint: p.fingerprint });
    if (pow.fatal) return { fatal: true, score: 0, reasons: pow.reasons };
    let s = 100 + pow.score;
    const reasons = [...pow.reasons];
    const hw = L4.analyze({
        webgl: p.hardware.webgl, canvas: p.hardware.canvas, audio: p.hardware.audio,
        sensorDesync: p.sensorDesync, fingerprint: p.fingerprint,
    });
    s += hw.score; reasons.push(...hw.reasons);
    const au = L5.analyze({ automation: p.automation, vsync: p.vsync });
    s += au.score; reasons.push(...au.reasons);
    const bio = L6.analyze({ mouseTrajectory: p.mouseTrajectory, keystrokes: p.keystrokes });
    s += bio.score; reasons.push(...bio.reasons);
    return { fatal: false, score: s, reasons };
}

const ts = Date.now();
const fp = { userAgent: 'Mozilla/5.0 Chrome/120', language: 'fr-FR', screenResolution: '1920x1080', isBot: false };
const validNonce = mineNonce(ts, fp);

// --- Profil HUMAIN ---
const humanMouse = [];
let x = 100, y = 100, t = ts;
for (let i = 0; i < 30; i++) { x += Math.round(8 + Math.sin(i) * 5 + (i % 3)); y += Math.round(6 + Math.cos(i * 1.3) * 4 + (i % 2)); t += 12 + (i % 5); humanMouse.push({ x, y, t }); }
const humanKeys = [90, 110, 75, 130, 95, 120].map((d, i) => ({ key: 'a', dwellTime: d, flightTime: 50 + i, t_up: ts + i * 200 }));
const humanVsync = [16.7, 16.6, 16.9, 16.5, 17.0, 16.4, 16.8, 16.6, 16.7, 16.9, 16.5, 17.1, 16.3, 16.8, 16.6];

const human = {
    nonce: validNonce, timestamp: ts, fingerprint: fp,
    sensorDesync: false,
    hardware: { canvas: 'a1b2c3hash', webgl: { vendor: 'NVIDIA', renderer: 'NVIDIA GeForce RTX 3060' }, audio: '124.04347657' },
    automation: { webdriver: false, webdriverPatched: false, stealthArtifacts: false, cdpStackTrap: false, cdpProxyTrap: false },
    vsync: humanVsync, mouseTrajectory: humanMouse, keystrokes: humanKeys,
};

// --- Profil BOT HEADLESS BRUT (Puppeteer par défaut) ---
const botMouse = [];
for (let i = 0; i < 25; i++) botMouse.push({ x: 100 + i * 5, y: 100 + i * 5, t: ts + i * 10 }); // ligne droite parfaite
const headlessBot = {
    nonce: mineNonce(ts, fp), timestamp: ts, fingerprint: fp,
    sensorDesync: false,
    hardware: { canvas: 'CANVAS_BLOCKED', webgl: { vendor: 'Google Inc.', renderer: 'Google SwiftShader' }, audio: 'NO_AUDIO' },
    automation: { webdriver: true, webdriverPatched: false, stealthArtifacts: true, cdpStackTrap: true, cdpProxyTrap: true },
    vsync: [], mouseTrajectory: botMouse, keystrokes: [],
};

// --- Profil BOT FURTIF G3 (Camoufox/undetected : tout maquillé SAUF GPU+CDP) ---
const stealthBot = {
    nonce: mineNonce(ts, fp), timestamp: ts, fingerprint: fp,
    sensorDesync: false,
    hardware: { canvas: 'spoofedhash', webgl: { vendor: 'Google Inc.', renderer: 'ANGLE (Software, Vulkan 1.3.0)' }, audio: '124.04' },
    automation: { webdriver: false, webdriverPatched: true, stealthArtifacts: false, cdpStackTrap: false, cdpProxyTrap: true },
    vsync: humanVsync, mouseTrajectory: humanMouse, keystrokes: humanKeys,
};

let failures = 0;
function check(label, payload, shouldPass) {
    const r = runPipeline(payload);
    const passed = !r.fatal && r.score >= TRUST_THRESHOLD;
    const ok = passed === shouldPass;
    if (!ok) failures++;
    console.log(`${ok ? '✅' : '❌'} ${label} | score=${r.fatal ? 'FATAL' : r.score} | attendu=${shouldPass ? 'PASS' : 'BLOCK'} | obtenu=${passed ? 'PASS' : 'BLOCK'}`);
    console.log(`     raisons: ${r.reasons.join(' | ') || 'aucune'}`);
}

console.log('=== Test Phase 1 : pipeline antibot couche par couche ===');
check('Humain légitime          ', human, true);
check('Bot headless brut (G2)    ', headlessBot, false);
check('Bot furtif G3 (GPU+CDP)   ', stealthBot, false);
console.log(failures === 0 ? '\n✅ TOUS LES TESTS PASSENT' : `\n❌ ${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);

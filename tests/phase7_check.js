// Test de régression Phase 7 — CORROBORATION & VOLUMÉTRIE (rapport bots #3).
// Doctrine : « un seul indicateur ne doit jamais suffire à conclure au bot ».
//   A. Renderers logiciels ambigus : l'humain RDP/VDI et l'humain au GPU
//      blocklisté PASSENT ; le bot n'est banni que sur corroboration (≥2 couches).
//   B. Vélocité L2 : cadence de tentatives par IP+empreinte (fenêtre 60 s).
//   C. Rejeu de télémétrie L3 : séquence biométrique identique re-soumise.
//   D. Frappe surhumaine L6 : vol moyen < 8 ms = injection en rafale.
//   E. Accumulation de bout en bout : un script en boucle, non bannissable à la
//      1re tentative (1 témoin), finit banni quand la cadence corrobore.

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

// Pipeline miroir de la production : L3 reçoit la télémétrie (anti-rejeu actif),
// L2 reçoit l'empreinte (vélocité active). Chaque profil doit donc avoir une
// trajectoire UNIQUE et une IP dédiée pour ne pas polluer les autres cas.
function runPipeline(p) {
    const pow = L3.analyze({ nonce: p.nonce, timestamp: p.timestamp, fingerprint: p.fingerprint, mouseTrajectory: p.mouseTrajectory, keystrokes: p.keystrokes });
    if (pow.fatal) return { fatal: true, score: 0, reasons: pow.reasons };

    const tls = L1_tls.analyze({ ja4: p.ja4, userAgent: p.fingerprint.userAgent });
    const acc = L2.analyze({ ip: p.ip, fingerprint: p.fingerprint });
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

const ts = Date.now();
const fp = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36', language: 'fr-FR', screenResolution: '1920x1080' };
const fpNonce = mineNonce(ts, fp);

// Trajectoire humaine UNIQUE par profil (offset temporel) — indispensable :
// l'anti-rejeu L3 verrait sinon la même séquence d'un profil à l'autre.
function makeHumanMouse(offset) {
    const pts = [];
    let x = 100 + offset % 37, y = 100 + offset % 23, t = ts + offset;
    for (let i = 0; i < 30; i++) {
        x += Math.round(8 + Math.sin(i + offset) * 5 + (i % 3));
        y += Math.round(6 + Math.cos(i * 1.3 + offset) * 4 + (i % 2));
        t += 12 + (i % 5);
        pts.push({ x, y, t, p: 'mouse', et: 'move', pr: 0 });
    }
    pts.push({ x: x + 10, y: y + 5, t: t + 200, p: 'mouse', et: 'down', pr: 0.5 });
    return pts;
}

const humanKeys = [90, 110, 75, 130, 95, 120].map((d, i) => ({ key: 'a', dwellTime: d, flightTime: i === 0 ? 0 : 50 + i, t_up: ts + i * 200 }));
const humanVsync = [16.7, 16.6, 16.9, 16.5, 17.0, 16.4, 16.8, 16.6, 16.7, 16.9];
const cleanAutomation = { webdriver: false, webdriverPatched: false, stealthArtifacts: false, cdpStackTrap: false, cdpProxyTrap: false };
const realHardware = { canvas: 'a1b2c3hash', webgl: { vendor: 'NVIDIA', renderer: 'NVIDIA GeForce RTX 3060' }, audio: '124.04347657' };

let profileSeq = 0;
const base = () => ({
    nonce: fpNonce, timestamp: ts, fingerprint: fp,
    ip: `86.200.10.${10 + profileSeq}`, // IP dédiée par profil (isole la vélocité)
    ja4: undefined, sensorDesync: false,
    hardware: realHardware, automation: { ...cleanAutomation },
    vsync: humanVsync, mouseTrajectory: makeHumanMouse(++profileSeq * 1000), keystrokes: humanKeys,
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
    const v = passed ? 'PASS' : (banned ? 'BLOCK+BAN' : 'BLOCK');
    console.log(`${ok ? '✅' : '❌'} ${label} | score=${r.fatal ? 'FATAL' : r.score} | témoins=${r.witnesses ?? '-'} | attendu=${mode} | obtenu=${v}`);
    if (r.reasons && r.reasons.length) console.log(`     raisons: ${r.reasons.join(' | ')}`);
}

function assert(label, actual, expected) {
    const ok = actual === expected;
    if (!ok) failures++;
    console.log(`${ok ? '✅' : '❌'} ${label} | obtenu=${actual} | attendu=${expected}`);
}

// ─── A. Corroboration & renderers ambigus ───────────────────────────────────

console.log('=== Phase 7 — A. Corroboration : un témoin ne suffit jamais ===');

// 1. Employé en Remote Desktop : "Microsoft Basic Render Driver", tout le reste humain
const rdpHuman = { ...base(), hardware: { ...realHardware, webgl: { vendor: 'Microsoft', renderer: 'Microsoft Basic Render Driver' } } };
check('Humain RDP/VDI (Basic Render)        ', rdpHuman, 'pass');

// 2. Humain au GPU blocklisté : Chrome retombe sur SwiftShader
const blocklistedGpuHuman = { ...base(), hardware: { ...realHardware, webgl: { vendor: 'Google Inc.', renderer: 'Google SwiftShader' } } };
check('Humain GPU blocklisté (SwiftShader)  ', blocklistedGpuHuman, 'pass');

// 3. Bot webdriver=true mais TOUT le reste parfaitement forgé : 1 seul témoin
//    → bloqué (score 0) mais JAMAIS banni sur ce seul indicateur.
const webdriverOnlyBot = { ...base(), automation: { ...cleanAutomation, webdriver: true } };
check('Bot webdriver seul (1 témoin)        ', webdriverOnlyBot, 'block_no_ban');

// 4. Bot corroboré : SwiftShader (L4) + webdriver patché + piège CDP (L5) = 2 couches
const corroboratedBot = {
    ...base(),
    hardware: { ...realHardware, webgl: { vendor: 'Google Inc.', renderer: 'Google SwiftShader' } },
    automation: { ...cleanAutomation, webdriverPatched: true, cdpProxyTrap: true },
};
check('Bot corroboré L4+L5 (2 témoins)      ', corroboratedBot, 'ban');

// ─── B. Vélocité L2 ─────────────────────────────────────────────────────────

console.log('\n=== Phase 7 — B. Vélocité : cadence de tentatives (60 s glissantes) ===');

const velIp = '86.200.99.1';
let lastVel = null;
for (let i = 1; i <= 15; i++) {
    lastVel = L2.analyze({ ip: velIp, fingerprint: fp });
    if (i === 4) assert('Tentative 4 (humain qui réessaie) → 0  ', lastVel.score, 0);
    if (i === 5) assert('Tentative 5 → -15                      ', lastVel.score, -15);
    if (i === 9) assert('Tentative 9 → -40                      ', lastVel.score, -40);
}
assert('Tentative 15 (martèlement) → -75       ', lastVel.score, -75);

// ─── C. Rejeu de télémétrie L3 ──────────────────────────────────────────────

console.log('\n=== Phase 7 — C. Anti-rejeu : séquence biométrique identique ===');

const replayMouse = makeHumanMouse(777777);
const first = L3.analyze({ nonce: fpNonce, timestamp: ts, fingerprint: fp, mouseTrajectory: replayMouse, keystrokes: humanKeys });
assert('1re soumission → 0                     ', first.score, 0);
const second = L3.analyze({ nonce: fpNonce, timestamp: ts, fingerprint: fp, mouseTrajectory: replayMouse, keystrokes: humanKeys });
assert('2e soumission identique → -80          ', second.score, L3.REPLAYED_TELEMETRY_PENALTY);

// ─── D. Frappe surhumaine L6 ────────────────────────────────────────────────

console.log('\n=== Phase 7 — D. Frappe surhumaine : vol moyen < 8 ms ===');

const botKeys = [90, 110, 75, 130, 95, 120].map((d, i) => ({ key: 'a', dwellTime: d, flightTime: i === 0 ? 0 : 2, t_up: ts + i * 5 }));
const botTyping = L6.analyze({ mouseTrajectory: makeHumanMouse(888888), keystrokes: botKeys });
assert('Bot rafale (vol 2 ms) → -40            ', botTyping.score, -40);

// Humain ultra-rapide en rollover : vols NÉGATIFS (touche suivante avant relâchement)
const rolloverKeys = [90, 110, 75, 130, 95, 120].map((d, i) => ({ key: 'a', dwellTime: d, flightTime: i === 0 ? 0 : -(25 + i * 7), t_up: ts + i * 80 }));
const rollover = L6.analyze({ mouseTrajectory: makeHumanMouse(999999), keystrokes: rolloverKeys });
assert('Humain rollover (vols négatifs) → 0    ', rollover.score, 0);

// ─── E. Accumulation de bout en bout ────────────────────────────────────────

console.log('\n=== Phase 7 — E. Le script en boucle finit banni par ACCUMULATION ===');

// Script zéro-interaction qui martèle : tentative 1 = 1 témoin (L6) → pas de ban.
// Dès la 5e tentative, la cadence (L2) devient le 2e témoin → ban.
const loopIp = '86.200.99.2';
const loopScript = () => ({
    nonce: fpNonce, timestamp: ts, fingerprint: fp, ip: loopIp,
    ja4: undefined, sensorDesync: false,
    hardware: realHardware, automation: { ...cleanAutomation },
    vsync: humanVsync, mouseTrajectory: [], keystrokes: [],
});
let earlyBan = false;
for (let i = 1; i <= 4; i++) {
    const r = runPipeline(loopScript());
    if (r.ban) earlyBan = true;
}
assert('Tentatives 1-4 : jamais banni (1 témoin)', earlyBan, false);
check('5e tentative : cadence corrobore → BAN ', loopScript(), 'ban');

console.log(failures === 0 ? '\n✅ TOUS LES TESTS PASSENT' : `\n❌ ${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);

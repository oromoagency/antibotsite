// Test de régression Phase 3 — L6 : jerk vs téléportation (complémentaires).

const L6 = require('../src/layers/L6_biometrics');

const ts = 1_000_000;
const humanKeys = [90, 110, 75, 130, 95, 120].map((d, i) => ({ key: 'a', dwellTime: d, flightTime: 50 + i, t_up: ts + i * 200 }));

// 1. HUMAIN : trajectoire continue avec gigue naturelle (petits pas).
const humanMouse = [];
let x = 100, y = 100, t = ts;
for (let i = 0; i < 30; i++) { x += Math.round(8 + Math.sin(i) * 5 + (i % 3)); y += Math.round(6 + Math.cos(i * 1.3) * 4 + (i % 2)); t += 12 + (i % 5); humanMouse.push({ x, y, t }); }

// 2. BOT LISSÉ : interpolation linéaire parfaite (petits pas réguliers).
const smoothedMouse = [];
for (let i = 0; i < 25; i++) smoothedMouse.push({ x: 100 + i * 5, y: 100 + i * 5, t: ts + i * 10 });

// 3. AGENT VLM : clics par coordonnées = sauts géants (jerk élevé, PAS lissé).
const vlmMouse = [];
for (let i = 0; i < 25; i++) {
    const px = (i % 2 === 0) ? 50 + i * 2 : 850 - i * 2;
    const py = (i % 2 === 0) ? 600 - i * 3 : 80 + i * 3;
    vlmMouse.push({ x: px, y: py, t: ts + i * 15 });
}

let failures = 0;
function check(label, mouse, expectTeleport, expectSmoothed) {
    const r = L6.analyze({ mouseTrajectory: mouse, keystrokes: humanKeys });
    const hasTele = r.reasons.some(x => x.includes('Téléportation'));
    const hasSmooth = r.reasons.some(x => x.includes('lissée'));
    const ok = hasTele === expectTeleport && hasSmooth === expectSmoothed;
    if (!ok) failures++;
    console.log(`${ok ? '✅' : '❌'} ${label} | score=${r.score} | téléport=${hasTele}(att ${expectTeleport}) | lissé=${hasSmooth}(att ${expectSmoothed})`);
    if (r.reasons.length) console.log(`     raisons: ${r.reasons.join(' | ')}`);
}

console.log('=== Test Phase 3 : L6 jerk vs téléportation ===');
check('Humain (continu)         ', humanMouse, false, false);
check('Bot lissé (jerk)         ', smoothedMouse, false, true);
check('Agent VLM (téléportation)', vlmMouse, true, false);
console.log(failures === 0 ? '\n✅ TOUS LES TESTS PASSENT' : `\n❌ ${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);

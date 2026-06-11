// Test de régression Phase 11 — Camoufox (WebGPU absent) + CDP géométrie (width/height=0).
//
// Section A : L4 — WebGPU absent sur Chrome ≥113 avec WebGL actif = Camoufox probable.
//             Camoufox désactive WebGPU car trop complexe à spoofer au niveau C++.
// Section B : L6 — PointerEvent width/height nuls = CDP Input.dispatchMouseEvent
//             sans spécification de géométrie (vrai pointeur souris = 1×1 spec W3C).
//             Les deux checks L6 (pression=0 et géométrie=0) sont INDÉPENDANTS et cumulables.
// Section C : Non-régression — humain Chrome 120 avec WebGPU et bonne biométrie.
// Section D : Intégration — Camoufox + injection CDP géométrie → 2 témoins → BAN.

const L4 = require('../src/layers/L4_hardware');
const L6 = require('../src/layers/L6_biometrics');
const verdict = require('../src/policy/verdict');

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

// ─── Helpers trajectoire souris ────────────────────────────────────────────────
// Trajectoire 15 points en zigzag à amplitude variable : le cross-product de
// chaque triplet est élevé (≈400-800) → analyzeCurvature OK ; les magnitudes
// d'accélération changent significativement d'un pas à l'autre → analyzeJerk OK ;
// max step ≈60px en 47ms → loin des 300px/50ms du seuil téléportation.
const AMP = [20, -25, 30, -28, 22, -33, 25, -19, 31, -24, 18, -29, 35, -21, 27];
function mouseMoves(n) {
    n = n || AMP.length; // 15 par défaut
    const pts = [];
    for (let i = 0; i < n; i++) {
        pts.push({
            x: 100 + i * 8,
            y: 200 + AMP[i % AMP.length],
            // timing : 47-75ms, strictement croissant (55 + offset [0,20])
            t: i * 55 + (i * 7 % 11) * 2,
            p: 'mouse',
            et: 'move',
            pr: 0,
        });
    }
    return pts;
}

// Crée n pointerdown avec les options données.
// Si w est undefined, le champ w n'est PAS ajouté (simule ancien client).
function mouseDowns(n, opts) {
    opts = opts || {};
    var pr = opts.pr !== undefined ? opts.pr : 0.5;
    var w  = opts.w;
    var h  = opts.h;
    var downs = [];
    for (var i = 0; i < n; i++) {
        var pt = { x: 250, y: 200, t: 1000 + i * 100, p: 'mouse', et: 'down', pr: pr };
        if (w !== undefined) { pt.w = w; pt.h = h !== undefined ? h : w; }
        downs.push(pt);
    }
    return downs;
}

// Frappe humaine minimale : variance dwellTime > 2ms, vol moyen ~130ms > 8ms.
const GOOD_KEYS = [
    { key: 'J', dwellTime: 82, flightTime: 0,   t_up: 100  },
    { key: 'e', dwellTime: 76, flightTime: 128,  t_up: 304  },
    { key: 's', dwellTime: 91, flightTime: 135,  t_up: 530  },
    { key: ' ', dwellTime: 68, flightTime: 142,  t_up: 740  },
    { key: 's', dwellTime: 85, flightTime: 119,  t_up: 944  },
    { key: 'u', dwellTime: 73, flightTime: 131,  t_up: 1148 },
    { key: 'i', dwellTime: 88, flightTime: 125,  t_up: 1361 },
    { key: 's', dwellTime: 79, flightTime: 138,  t_up: 1578 },
];

// UA types
const CHROME_120_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CHROME_112_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36';
const FIREFOX_130_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0';
const REAL_WEBGL  = { vendor: 'NVIDIA Corporation', renderer: 'NVIDIA GeForce RTX 3080/PCIe/SSE2' };

// ═══════════════════════════════════════════════════════════
// A. L4 : DÉTECTION WEBGPU ABSENT (CAMOUFOX)
// ═══════════════════════════════════════════════════════════
console.log('\n=== Phase 11 — A. L4 : WebGPU absent (Camoufox) ===');

// A1. Chrome 120 + webgpu=false + WebGL réel → pénalité WEBGPU_ABSENT_PENALTY
const hwA1 = L4.analyze({ webgl: REAL_WEBGL, canvas: 'aabb', audio: '0.123',
    webgpu: false, fingerprint: { userAgent: CHROME_120_UA } });
assert('A1. Chrome 120 webgpu=false + WebGL OK → pénalité -20',
    hwA1.score, L4.WEBGPU_ABSENT_PENALTY);
assertTrue('A1. Raison contient "WebGPU"',
    hwA1.reasons.some(function(r){ return r.includes('WebGPU'); }));

// A2. Chrome 112 + webgpu=false → PAS de pénalité (WebGPU optionnel avant 113)
const hwA2 = L4.analyze({ webgl: REAL_WEBGL, canvas: 'aabb', audio: '0.123',
    webgpu: false, fingerprint: { userAgent: CHROME_112_UA } });
assert('A2. Chrome 112 webgpu=false → score 0 (< Chrome 113)', hwA2.score, 0);

// A3. Chrome 120 + webgpu=true → pas de pénalité
const hwA3 = L4.analyze({ webgl: REAL_WEBGL, canvas: 'aabb', audio: '0.123',
    webgpu: true, fingerprint: { userAgent: CHROME_120_UA } });
assert('A3. Chrome 120 webgpu=true → score 0', hwA3.score, 0);

// A4. Chrome 120 + webgpu=false + WebGL absent → guard bloque la pénalité WebGPU
const hwA4 = L4.analyze({
    webgl: { vendor: 'NO_WEBGL', renderer: 'NO_WEBGL' },
    canvas: 'aabb', audio: '0.123',
    webgpu: false, fingerprint: { userAgent: CHROME_120_UA } });
assertTrue('A4. Chrome 120 webgpu=false WebGL absent → pas de raison WebGPU',
    !hwA4.reasons.some(function(r){ return r.includes('WebGPU'); }));

// A5. Firefox 130 + webgpu=false → pas de pénalité (UA non Chrome)
const hwA5 = L4.analyze({ webgl: REAL_WEBGL, canvas: 'aabb', audio: '0.123',
    webgpu: false, fingerprint: { userAgent: FIREFOX_130_UA } });
assert('A5. Firefox 130 webgpu=false → score 0 (non Chrome)', hwA5.score, 0);

// A6. Chrome 120 + webgpu=false + fingerprint absent → pas de pénalité (guard UA)
const hwA6 = L4.analyze({ webgl: REAL_WEBGL, canvas: 'aabb', audio: '0.123',
    webgpu: false, fingerprint: null });
assertTrue('A6. webgpu=false sans fingerprint → pas de raison WebGPU',
    !hwA6.reasons.some(function(r){ return r.includes('WebGPU'); }));

// ═══════════════════════════════════════════════════════════
// B. L6 : GÉOMÉTRIE POINTEREVENT (width=0, height=0 = CDP)
// ═══════════════════════════════════════════════════════════
console.log('\n=== Phase 11 — B. L6 : géométrie PointerEvent (CDP vs réel) ===');

const SYN = L6.SYNTHETIC_INJECT_PENALTY; // -50

// Baseline : trajectory parfaite — moves + downs avec pr=0.5, w=1, h=1.
// Toutes les analyses L6 doivent retourner 0.
const baseTrajectory = mouseMoves().concat(mouseDowns(2, { pr: 0.5, w: 1, h: 1 }));
const sBase = L6.analyze({ mouseTrajectory: baseTrajectory, keystrokes: GOOD_KEYS }).score;
assert('B-baseline. Trajectoire humaine parfaite → score 0', sBase, 0);

// B1. Géométrie nulle (w=0, h=0) + pression ok (0.5) → 1× SYN pénalité
const tB1 = mouseMoves().concat(mouseDowns(2, { pr: 0.5, w: 0, h: 0 }));
const sB1 = L6.analyze({ mouseTrajectory: tB1, keystrokes: GOOD_KEYS }).score;
assert('B1. Géométrie w=0 h=0 pr=0.5 → ' + SYN + ' (géométrie CDP)', sB1, SYN);

// B2. Géométrie ok (w=1, h=1) + pression nulle (0) → pénalité pression
const tB2 = mouseMoves().concat(mouseDowns(2, { pr: 0, w: 1, h: 1 }));
const sB2 = L6.analyze({ mouseTrajectory: tB2, keystrokes: GOOD_KEYS }).score;
assert('B2. Pression=0 géométrie=1 → ' + SYN + ' (pression CDP)', sB2, SYN);

// B3. Les DEUX défauts : pression=0 ET géométrie=0 → double pénalité
const tB3 = mouseMoves().concat(mouseDowns(2, { pr: 0, w: 0, h: 0 }));
const sB3 = L6.analyze({ mouseTrajectory: tB3, keystrokes: GOOD_KEYS }).score;
assert('B3. Pression=0 + géométrie=0 → ' + (2*SYN) + ' (double pénalité)', sB3, 2 * SYN);

// B4. Sans champ w (ancien client, format pre-Phase11) → PAS de pénalité géométrie
const tB4 = mouseMoves().concat(mouseDowns(2, { pr: 0.5 })); // pas de w
const sB4 = L6.analyze({ mouseTrajectory: tB4, keystrokes: GOOD_KEYS }).score;
assert('B4. Sans champ w (ancien client) → score 0 (guard w absent)', sB4, 0);

// B5. Downs géométrie mixte (un w=0, un w=1) → every() = false → pas de pénalité
const tB5 = mouseMoves().concat([
    { x: 250, y: 200, t: 1000, p: 'mouse', et: 'down', pr: 0.5, w: 0, h: 0 },
    { x: 260, y: 210, t: 1100, p: 'mouse', et: 'down', pr: 0.5, w: 1, h: 1 },
]);
const sB5 = L6.analyze({ mouseTrajectory: tB5, keystrokes: GOOD_KEYS }).score;
assert('B5. Géométrie mixte (w=0 et w=1) → score 0 (every=false)', sB5, 0);

// B6. Moves sans champ `et` (pré-Phase11) → guard moves.length=0 → bracket inactif,
//     même si les downs ont des mauvaises valeurs.
const movesNoEt = mouseMoves().map(function(pt) {
    var p = Object.assign({}, pt);
    delete p.et;
    return p;
});
const tB6base = movesNoEt.concat(mouseDowns(2, { pr: 0.5, w: 1, h: 1 }));
const tB6bad  = movesNoEt.concat(mouseDowns(2, { pr: 0,   w: 0, h: 0 }));
const sB6base = L6.analyze({ mouseTrajectory: tB6base, keystrokes: GOOD_KEYS }).score;
const sB6bad  = L6.analyze({ mouseTrajectory: tB6bad,  keystrokes: GOOD_KEYS }).score;
assert('B6. Moves sans champ et → bracket inactif (diff=0 malgré bad downs)', sB6bad - sB6base, 0);

// ═══════════════════════════════════════════════════════════
// C. NON-RÉGRESSION : humain Chrome 120, WebGPU présent
// ═══════════════════════════════════════════════════════════
console.log('\n=== Phase 11 — C. Non-régression : humain Chrome 120 ===');

// C1. Chrome 120 + webgpu=true → L4 score = 0
const hwC1 = L4.analyze({ webgl: REAL_WEBGL, canvas: 'aabb', audio: '0.123',
    webgpu: true, fingerprint: { userAgent: CHROME_120_UA } });
assert('C1. Chrome 120 webgpu=true → L4 score 0', hwC1.score, 0);

// C2. Bonne biométrie (zigzag + bonne frappe) → L6 score = 0
const bioC2 = L6.analyze({ mouseTrajectory: baseTrajectory, keystrokes: GOOD_KEYS });
assert('C2. Biométrie humaine parfaite → L6 score 0', bioC2.score, 0);

// C3. Verdict complet : Chrome 120, webgpu=true, bonne biométrie → PASS
const vC3 = verdict.decide([
    { score: 0 },   // L3 pow
    { score: 0 },   // L1
    { score: 0 },   // L2
    hwC1,           // L4
    { score: 0 },   // L5
    bioC2,          // L6
]);
assertTrue('C3. Pipeline humain (webgpu=true, bonne bio) → autorisé', vC3.allowed === true);

// ═══════════════════════════════════════════════════════════
// D. INTÉGRATION : Camoufox + injection CDP géométrie
// ═══════════════════════════════════════════════════════════
console.log('\n=== Phase 11 — D. Intégration : Camoufox + CDP géométrie ===');

// L4 commun : Chrome 120, WebGL réel, WebGPU absent (Camoufox).
// score L4 = WEBGPU_ABSENT_PENALTY = -20
const hwD = L4.analyze({
    webgl: REAL_WEBGL,
    canvas: 'aabb', audio: '0.123',
    webgpu: false,
    fingerprint: { userAgent: CHROME_120_UA },
});

// --- D scénario 1 : injection géométrie seule (attaquant a patché la pression) ---
// pr=0.5 (patché), w=0 → une seule pénalité L6 = -50.
// Score total = 100 - 20 - 50 = 30. Règle : score < TRUST(60) → BLOCK.
// BAN impossible ici : score(30) ≥ STRIKE_THRESHOLD(20) → protection corroboration.
const tD1 = mouseMoves().concat(mouseDowns(2, { pr: 0.5, w: 0, h: 0 }));
const bioD1 = L6.analyze({ mouseTrajectory: tD1, keystrokes: GOOD_KEYS });
const vD1 = verdict.decide([
    { score: 0 }, { score: 0 }, { score: 0 }, hwD, { score: 0 }, bioD1,
]);
const scoreD1 = 100 + hwD.score + bioD1.score;

assertTrue('D1a. Camoufox + géométrie CDP → BLOCK (non autorisé)', vD1.allowed === false);
assertTrue('D1b. Scénario géométrie seule → BLOCK sans BAN (score=' + scoreD1 + ' ≥ STRIKE_THRESHOLD)',
    vD1.ban === false);
assertTrue('D1c. Score D1 (' + scoreD1 + ') < TRUST_THRESHOLD 60', scoreD1 < 60);

// --- D scénario 2 : double injection (attaquant n'a patché NI pression NI géométrie) ---
// pr=0 + w=0 → deux pénalités L6 cumulées = -100. Score = 100 - 20 - 100 = -20.
// BAN : score(-20) < STRIKE_THRESHOLD(20) ET 2 témoins indépendants (L4 + L6).
const tD2 = mouseMoves().concat(mouseDowns(2, { pr: 0, w: 0, h: 0 }));
const bioD2 = L6.analyze({ mouseTrajectory: tD2, keystrokes: GOOD_KEYS });
const vD2 = verdict.decide([
    { score: 0 }, { score: 0 }, { score: 0 }, hwD, { score: 0 }, bioD2,
]);
const scoreD2 = 100 + hwD.score + bioD2.score;

assertTrue('D2a. Camoufox + double injection CDP → non autorisé', vD2.allowed === false);
assertTrue('D2b. Double injection → BAN (score=' + scoreD2 + ' < STRIKE_THRESHOLD + 2 témoins)',
    vD2.ban === true);
assertTrue('D2c. Score D2 (' + scoreD2 + ') < 0', scoreD2 < 0);

// ─── Résumé ──────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60));
if (failures === 0) {
    console.log('--- phase11 --- ✅ TOUS LES TESTS PASSENT');
} else {
    console.log('--- phase11 --- ❌ ' + failures + ' ÉCHEC(S)');
    process.exit(1);
}

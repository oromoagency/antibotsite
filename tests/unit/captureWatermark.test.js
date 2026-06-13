/**
 * Tests — Watermark de capture (stéganographie défensive / traçabilité post-fuite)
 *
 * Vérifie le contrat du codec :
 *   - roundtrip : encode(seed) → luminances → decode == id encodé
 *   - tolérance au bruit (code à répétition + vote majoritaire)
 *   - ZÉRO fausse attribution : bruit / image plate / aléatoire → valid:false
 *   - décodeur image (tableau RGBA) → même id
 *   - déterminisme par (seed, époque) et séparation inter-sessions
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
    encodeWatermark, decodeWatermark, decodeColumns, decodeStripPixels, sessionWatermarkId,
    N_CELLS, WORD_BITS, BASE_L, DELTA_L,
} = require('../../prism-sdk');

const EPOCH = '2026-W24';

// Reconstruit les luminances idéales depuis les bits rendus (BASE ± DELTA).
const lumsFromBits = (bits, noise = 0) =>
    bits.map((b, i) => {
        const base = BASE_L + (b ? DELTA_L : -DELTA_L);
        // bruit déterministe borné (pas de Math.random → test reproductible)
        const jitter = noise ? ((i * 73 % 21) - 10) / 10 * noise : 0;
        return base + jitter;
    });

describe('captureWatermark — roundtrip', () => {
    test('encode → decode restitue l\'id pour plusieurs seeds', () => {
        for (const seed of ['nx_abc', 'nx_def', 'seed-123', 'a', 'humain-valide-x']) {
            const w = encodeWatermark(seed, EPOCH);
            assert.equal(w.bits.length, N_CELLS, 'longueur de bande attendue');
            const dec = decodeWatermark(lumsFromBits(w.bits));
            assert.equal(dec.valid, true, `valid pour ${seed}`);
            assert.equal(dec.id, w.id, `id restitué pour ${seed}`);
            assert.equal(dec.id, sessionWatermarkId(seed, EPOCH), 'cohérent avec sessionWatermarkId');
        }
    });

    test('confiance maximale sur signal propre', () => {
        const w = encodeWatermark('nx_clean', EPOCH);
        const dec = decodeWatermark(lumsFromBits(w.bits));
        assert.ok(dec.confidence >= 0.99, `confiance haute (${dec.confidence})`);
    });
});

describe('captureWatermark — tolérance au bruit', () => {
    test('décode encore avec un bruit < DELTA (vote majoritaire)', () => {
        const w = encodeWatermark('nx_noisy', EPOCH);
        // bruit d'amplitude ~0.5*DELTA : ne franchit pas le seuil bimodal
        const dec = decodeWatermark(lumsFromBits(w.bits, DELTA_L * 0.5));
        assert.equal(dec.valid, true);
        assert.equal(dec.id, w.id);
    });

    test('une copie entière corrompue est rattrapée par la majorité', () => {
        const w = encodeWatermark('nx_rep', EPOCH);
        const lums = lumsFromBits(w.bits);
        // corrompre toute la 1re copie (les WORD_BITS premières cellules) → inversion
        for (let i = 0; i < WORD_BITS; i++) {
            lums[i] = BASE_L + (w.bits[i] ? -DELTA_L : DELTA_L);
        }
        const dec = decodeWatermark(lums);
        assert.equal(dec.valid, true, 'majorité sur 3 copies tolère 1 copie inversée');
        assert.equal(dec.id, w.id);
    });
});

describe('captureWatermark — zéro fausse attribution', () => {
    test('image plate (luminance constante) → invalide', () => {
        const flat = new Array(N_CELLS).fill(50);
        const dec = decodeWatermark(flat);
        assert.equal(dec.valid, false);
        assert.equal(dec.id, null);
    });

    test('luminances pseudo-aléatoires → invalide (checksum/accord)', () => {
        let bad = 0;
        for (let s = 0; s < 200; s++) {
            const lums = Array.from({ length: N_CELLS }, (_, i) => ((i * 9301 + s * 49297) % 233) % 100);
            if (decodeWatermark(lums).valid) bad++;
        }
        // le checksum 8 bits borne le taux de faux-accept ; on tolère un résiduel infime
        assert.ok(bad <= 2, `faux-accept résiduels trop nombreux: ${bad}/200`);
    });

    test('tableau vide / trop court → invalide sans crash', () => {
        assert.equal(decodeWatermark([]).valid, false);
        assert.equal(decodeWatermark([1, 2, 3]).valid, false);
        assert.equal(decodeWatermark(null).valid, false);
    });
});

describe('captureWatermark — décodeur image (RGBA)', () => {
    test('image synthétique de la bande → même id', () => {
        const w = encodeWatermark('nx_img', EPOCH);
        const cellW = 4, height = 8, width = N_CELLS * cellW;
        const data = new Uint8ClampedArray(width * height * 4);
        for (let c = 0; c < N_CELLS; c++) {
            const L = BASE_L + (w.bits[c] ? DELTA_L : -DELTA_L);
            for (let x = c * cellW; x < (c + 1) * cellW; x++) {
                for (let y = 0; y < height; y++) {
                    const idx = (y * width + x) * 4;
                    data[idx] = L; data[idx + 1] = L; data[idx + 2] = L; data[idx + 3] = 255;
                }
            }
        }
        const dec = decodeStripPixels({ width, height, data });
        assert.equal(dec.valid, true);
        assert.equal(dec.id, w.id);
    });

    test('image absente / malformée → invalide sans crash', () => {
        assert.equal(decodeStripPixels(null).valid, false);
        assert.equal(decodeStripPixels({ width: 0, height: 0, data: [] }).valid, false);
    });
});

describe('captureWatermark — décodeur par colonnes (chemin admin)', () => {
    test('colonnes suréchantillonnées (1200) → rééchantillonnage serveur → même id', () => {
        const w = encodeWatermark('nx_cols', EPOCH);
        const M = 1200;
        const columns = [];
        for (let i = 0; i < M; i++) {
            const cell = Math.min(N_CELLS - 1, Math.floor((i / M) * N_CELLS));
            columns.push(BASE_L + (w.bits[cell] ? DELTA_L : -DELTA_L));
        }
        const dec = decodeColumns(columns);
        assert.equal(dec.valid, true);
        assert.equal(dec.id, w.id);
    });

    test('bruit aléatoire en colonnes → invalide', () => {
        const columns = Array.from({ length: 1200 }, (_, i) => ((i * 7919) % 211) % 100);
        assert.equal(decodeColumns(columns).valid, false);
    });
});

describe('captureWatermark — déterminisme & séparation', () => {
    test('même (seed, époque) → même id', () => {
        assert.equal(sessionWatermarkId('nx_x', EPOCH), sessionWatermarkId('nx_x', EPOCH));
    });

    test('seeds différents → ids différents', () => {
        assert.notEqual(sessionWatermarkId('nx_a', EPOCH), sessionWatermarkId('nx_b', EPOCH));
    });

    test('époques différentes → ids différents (rotation)', () => {
        assert.notEqual(sessionWatermarkId('nx_a', '2026-W24'), sessionWatermarkId('nx_a', '2026-W25'));
    });
});

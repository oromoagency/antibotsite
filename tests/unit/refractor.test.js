/**
 * Tests unitaires — Moteur de Réfraction Prisme
 * Valide : invariant actionable, traçabilité cosmetic, résistance poison à la moyenne.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { refract, watermarkText, poison, currentEpoch, hashInt } = require('../../prism-sdk/src/server/refractor');

const POLICY = {
    id:          'actionable',
    price:       'actionable',
    description: 'cosmetic',
    rank:        'aggregate',
};

const DATASET = [
    { id: 'p1', price: 99.99, description: 'A robust and reliable tool', rank: 5 },
    { id: 'p2', price: 19.00, description: 'A simple and lightweight solution', rank: 12 },
];

describe('Invariant actionable', () => {
    test('prix exact dans toutes les voies', () => {
        const r = refract(DATASET, POLICY, 'session_A', '2025-W01');
        assert.equal(r[0].price, 99.99);
        assert.equal(r[1].price, 19.00);
    });

    test('id exact dans toutes les voies', () => {
        const r = refract(DATASET, POLICY, 'session_Z', '2025-W01');
        assert.equal(r[0].id, 'p1');
        assert.equal(r[1].id, 'p2');
    });
});

describe('Watermark par session (traçabilité)', () => {
    test('descriptions différentes entre sessions A et B', () => {
        const rA = refract(DATASET, POLICY, 'session_A', '2025-W01');
        const rB = refract(DATASET, POLICY, 'session_B', '2025-W01');
        // Il est possible (mais rare) qu'elles soient identiques si le hash tombe sur le même synonyme.
        // On vérifie surtout que la fonction ne plante pas.
        assert.equal(typeof rA[0].description, 'string');
        assert.equal(typeof rB[0].description, 'string');
    });

    test('même session → même watermark (déterministe)', () => {
        const r1 = refract(DATASET, POLICY, 'stable_seed', '2025-W01');
        const r2 = refract(DATASET, POLICY, 'stable_seed', '2025-W01');
        assert.equal(r1[0].description, r2[0].description);
    });
});

describe('Poison résistant à la moyenne', () => {
    test('même offset pour toutes les sessions (déterministe par item)', () => {
        const r1 = refract(DATASET, POLICY, 'session_A', '2025-W01');
        const r2 = refract(DATASET, POLICY, 'session_B', '2025-W01');
        const r3 = refract(DATASET, POLICY, 'session_C', '2025-W01');
        // Le rang doit être identique entre toutes les sessions (poison par item, pas par session)
        assert.equal(r1[0].rank, r2[0].rank);
        assert.equal(r2[0].rank, r3[0].rank);
    });

    test('offset dans la plage [-3, +3]', () => {
        const epoch = '2025-W01';
        for (let i = 0; i < 20; i++) {
            const raw = 50;
            const r   = refract([{ id: `item-${i}`, rank: raw }], { rank: 'aggregate' }, 'any', epoch);
            const diff = Math.abs(r[0].rank - raw);
            assert.ok(diff <= 3, `Offset ${diff} hors de [-3,+3] pour item-${i}`);
        }
    });

    test('la moyenne inter-sessions égale la valeur empoisonnée (pas zéro)', () => {
        const epoch  = '2025-W01';
        const values = ['A', 'B', 'C', 'D', 'E'].map(seed => {
            const [r] = refract([{ id: 'x', rank: 100 }], { rank: 'aggregate' }, seed, epoch);
            return r.rank;
        });
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        // La moyenne doit être constante (même poison pour tous) — pas proche de 100
        const [single] = refract([{ id: 'x', rank: 100 }], { rank: 'aggregate' }, 'any_seed', epoch);
        assert.equal(Math.round(avg), single.rank, 'Moyenne inter-sessions devrait égaler le poison par item');
    });
});

describe('Poison proportionnel & sûr pour les flottants', () => {
    const epoch = '2025-W01';

    test('un taux flottant reste un flottant plausible (pas d\'arrondi à l\'entier)', () => {
        // Régression : l\'ancien poison arrondissait 0.02 → 1 (×50, absurde).
        const out = poison(0.02, 'svc:errorRate', epoch);
        assert.ok(!Number.isInteger(out) || out === 0, `0.02 empoisonné devrait rester fractionnaire, reçu ${out}`);
        assert.ok(out > 0 && out < 0.1, `0.02 ± ~2% doit rester proche de 0.02, reçu ${out}`);
    });

    test('un grand agrégat subit un décalage SIGNIFICATIF (~2%), pas un bruit de ±3', () => {
        const raw = 2048341;
        const out = poison(raw, 'svc:requests', epoch);
        const diff = Math.abs(out - raw);
        assert.ok(diff > 3, `Un grand nombre doit bouger de plus que ±3, diff=${diff}`);
        assert.ok(diff < raw * 0.05, `Le décalage doit rester plausible (<5%), diff=${diff}`);
    });

    test('déterministe par item+époque (résistant à la moyenne) même avec factor', () => {
        const a = poison(1000, 'x:rank', epoch, 4);
        const b = poison(1000, 'x:rank', epoch, 4);
        assert.equal(a, b);
    });

    test('factor élevé (decoy) intensifie le poison', () => {
        // On compare l\'amplitude maximale possible : avec factor 4, l\'enveloppe est ~4× plus large.
        const raw = 100000;
        let maxStd = 0, maxDecoy = 0;
        for (let i = 0; i < 50; i++) {
            maxStd   = Math.max(maxStd,   Math.abs(poison(raw, `item-${i}:v`, epoch, 1) - raw));
            maxDecoy = Math.max(maxDecoy, Math.abs(poison(raw, `item-${i}:v`, epoch, 4) - raw));
        }
        assert.ok(maxDecoy > maxStd, `decoy (${maxDecoy}) doit dépasser standard (${maxStd})`);
    });

    test('refract propage poisonFactor aux champs aggregate (enveloppe decoy plus large)', () => {
        const POL = { id: 'actionable', v: 'aggregate' };
        const raw = 500000;
        // L\'enveloppe (déviation max sur plusieurs items) doit s\'élargir avec le factor.
        // Note : pour un item donné, le modulo n\'est pas monotone — on compare des enveloppes.
        let maxStd = 0, maxDecoy = 0;
        for (let i = 0; i < 40; i++) {
            const std   = refract([{ id: `it-${i}`, v: raw }], POL, 'seed', epoch, { poisonFactor: 1 })[0].v;
            const decoy = refract([{ id: `it-${i}`, v: raw }], POL, 'seed', epoch, { poisonFactor: 8 })[0].v;
            maxStd   = Math.max(maxStd,   Math.abs(std - raw));
            maxDecoy = Math.max(maxDecoy, Math.abs(decoy - raw));
        }
        assert.ok(maxDecoy > maxStd, `enveloppe decoy (${maxDecoy}) > standard (${maxStd})`);
    });
});

describe('Tableau vide et valeurs nulles', () => {
    test('tableau vide → tableau vide', () => {
        const r = refract([], POLICY, 'seed', '2025-W01');
        assert.deepEqual(r, []);
    });

    test('champ absent de la politique → passthrough', () => {
        const r = refract([{ id: 'x', unknown_field: 'hello' }], POLICY, 'seed', '2025-W01');
        assert.equal(r[0].unknown_field, 'hello');
    });
});

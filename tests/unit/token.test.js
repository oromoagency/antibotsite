/**
 * Tests unitaires — Token de session L7 (durabilité de la réalité)
 *
 * Valide le correctif d'architecture : le JWT porte `reality` + `sessionSeed`,
 * ce qui permet au Shield de réhydrater la décision de la gate après un
 * redémarrage du store RAM. Sans ça, la réfraction retombait à 'normal'.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// Le moteur lit SECRET_KEY depuis sa config singleton — l'initialiser avant tout.
const config = require('../../prism-sdk/src/server/engine/config');
config.init({ secretKey: 'unit_test_secret_key_0123456789abcdef' });

const { createToken, verifyToken } = require('../../prism-sdk/src/server/engine/layers/L7_session');

describe('L7 token — roundtrip & durabilité de la réalité', () => {
    test('reality + sessionSeed + suspicion survivent au roundtrip', () => {
        const token = createToken('1.2.3.4', { ua: 'x' }, 88, 0.12, 'seed_abc', 'watermarked');
        const r = verifyToken(token);
        assert.equal(r.valid, true);
        assert.equal(r.data.reality, 'watermarked');
        assert.equal(r.data.sessionSeed, 'seed_abc');
        assert.equal(r.data.suspicion, 0.12);
        assert.equal(r.data.trustScore, 88);
    });

    test('reality par défaut = normal si non fournie (rétro-compat)', () => {
        const token = createToken('1.2.3.4', {}, 100, 0.1, 'seed_x');
        assert.equal(verifyToken(token).data.reality, 'normal');
    });

    test('decoy se conserve aussi', () => {
        const token = createToken('9.9.9.9', {}, 10, 0.9, 'seed_y', 'decoy');
        assert.equal(verifyToken(token).data.reality, 'decoy');
    });

    test('token falsifié → invalide', () => {
        assert.equal(verifyToken('not-a-real-token').valid, false);
    });

    test('token vide / null → invalide (jamais de crash)', () => {
        assert.equal(verifyToken('').valid, false);
        assert.equal(verifyToken(null).valid, false);
        assert.equal(verifyToken(undefined).valid, false);
    });
});

/**
 * Tests d'intégration — Contrat de la gate Prisme
 *
 * Démarre l'app Express réelle (src/server.js exporte `app`) sur un port éphémère
 * et vérifie le contrat d'accès Zero Bot Mode de bout en bout, sans résoudre le PoW :
 *   - page utile sans session humaine  → gateway servi
 *   - UA script (python/curl…)         → 403 immédiat
 *   - API sensible sans session        → 401
 *   - dashboard admin                  → servi (porte = token sur /api/admin/*)
 *   - API admin sans token             → 401  ; avec token → 200
 */

// L'env doit être posé AVANT de require src/server (config lue à l'import).
process.env.SECRET_KEY = 'integration_test_secret_0123456789abcdef';
process.env.ADMIN_TOKEN = 'integration_admin_token';
process.env.NODE_ENV = 'test';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../../src/server');

const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

let server, base;

before(async () => {
    await new Promise((resolve) => {
        server = app.listen(0, () => {
            base = `http://127.0.0.1:${server.address().port}`;
            resolve();
        });
    });
});

after(() => { if (server) server.close(); });

describe('Gate Prisme — contrat d\'accès Zero Bot', () => {
    test('GET / (navigateur, sans session) → gateway servi', async () => {
        const r = await fetch(base + '/', { headers: { 'user-agent': BROWSER } });
        assert.equal(r.status, 200);
        const body = await r.text();
        // Le gateway est anonymisé (titre "Chargement…") et contient le challenge.
        assert.match(body, /Chargement|challenge|défi|verif/i);
    });

    test('GET / (UA script python) → 403 immédiat', async () => {
        const r = await fetch(base + '/', { headers: { 'user-agent': 'python-requests/2.31' } });
        assert.equal(r.status, 403);
    });

    test('GET / (UA curl) → 403 immédiat', async () => {
        const r = await fetch(base + '/', { headers: { 'user-agent': 'curl/8.4.0' } });
        assert.equal(r.status, 403);
    });

    test('GET /api/prism/demo sans session humaine → 401', async () => {
        const r = await fetch(base + '/api/prism/demo', { headers: { 'user-agent': BROWSER } });
        assert.equal(r.status, 401);
    });

    test('GET /admin → dashboard servi directement (porte = token API)', async () => {
        const r = await fetch(base + '/admin', { headers: { 'user-agent': BROWSER } });
        assert.equal(r.status, 200);
        assert.match(await r.text(), /Admin|Control Center/i);
    });

    test('GET /api/admin/stats sans token → 401', async () => {
        const r = await fetch(base + '/api/admin/stats', { headers: { 'user-agent': BROWSER } });
        assert.equal(r.status, 401);
    });

    test('GET /api/admin/stats avec token → 200 + posture', async () => {
        const r = await fetch(base + '/api/admin/stats', {
            headers: { 'user-agent': BROWSER, 'x-admin-token': 'integration_admin_token' },
        });
        assert.equal(r.status, 200);
        const j = await r.json();
        assert.ok(j.posture, 'le rapport admin doit exposer la posture');
    });

    test('GET /api/challenge-config → difficulté + nonce serveur', async () => {
        const r = await fetch(base + '/api/challenge-config', { headers: { 'user-agent': BROWSER } });
        assert.equal(r.status, 200);
        const j = await r.json();
        assert.ok(typeof j.difficulty === 'number');
        assert.ok(typeof j.serverNonce === 'string' && j.serverNonce.length > 0);
    });

    test('GET /api/noscript-entry → page "JavaScript requis" (route publique, plus 404)', async () => {
        const r = await fetch(base + '/api/noscript-entry', { headers: { 'user-agent': BROWSER } });
        assert.equal(r.status, 200);
        assert.match(await r.text(), /JavaScript/i);
    });

    test('POST /api/admin/decode-watermark sans token → 401', async () => {
        const r = await fetch(base + '/api/admin/decode-watermark', {
            method: 'POST',
            headers: { 'user-agent': BROWSER, 'content-type': 'application/json' },
            body: JSON.stringify({ columns: [1, 2, 3] }),
        });
        assert.equal(r.status, 401);
    });

    test('POST /api/admin/decode-watermark : roundtrip d\'une empreinte encodée', async () => {
        const { encodeWatermark, currentEpoch, BASE_L, DELTA_L } = require('../../prism-sdk');
        const seed = 'integration-leak-seed';
        const w = encodeWatermark(seed, currentEpoch());
        // Reconstruire les colonnes idéales depuis les bits rendus (BASE ± DELTA).
        const columns = w.bits.map((b) => BASE_L + (b ? DELTA_L : -DELTA_L));
        const r = await fetch(base + '/api/admin/decode-watermark', {
            method: 'POST',
            headers: { 'user-agent': BROWSER, 'content-type': 'application/json', 'x-admin-token': 'integration_admin_token' },
            body: JSON.stringify({ columns }),
        });
        assert.equal(r.status, 200);
        const j = await r.json();
        assert.equal(j.valid, true, 'empreinte décodée valide');
        assert.equal(j.id, w.id, 'id décodé == id encodé');
    });
});

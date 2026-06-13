/**
 * Tests unitaires — Orchestrateur causal
 * Valide : unknown → gate_required, bot → blocked, human → normal.
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { decideReality, calculateSuspicion } = require('../../prism-sdk/src/server/engine/antibot/policy/causalOrchestrator');
const { createSession } = require('../../prism-sdk/src/server/engine/antibot/session/sessionModel');

function makeSession(overrides = {}) {
    const s = createSession();
    return Object.assign(s, overrides);
}

describe('Règle Zero Bot Mode', () => {
    beforeEach(() => { process.env.ANTIBOT_ZERO_BOT_MODE = 'true'; });

    test('session inconnue non validée → gate_required (jamais normal)', () => {
        const s = makeSession({ humanValidated: false });
        s.coherence.level = 'unknown';
        const r = decideReality(s);
        assert.equal(r, 'gate_required');
    });

    test('bot déclaratif → blocked', () => {
        const s = makeSession({ botClass: 'claims_bot', humanValidated: false });
        const r = decideReality(s);
        assert.equal(r, 'blocked');
    });

    test('humain validé, cohérence suffisante → normal', () => {
        const s = makeSession({ humanValidated: true });
        s.coherence.level = 'sufficient';
        const r = decideReality(s);
        assert.equal(r, 'normal');
    });

    test('contradiction critique → blocked', () => {
        const s = makeSession({ humanValidated: false });
        s.coherence.contradictions.push({ severity: 'critical' });
        const r = decideReality(s);
        assert.equal(r, 'blocked');
    });

    // Doctrine révisée : 1 seul groupe HIGH → watermarked (protection anti-FP biométrie seule).
    // Exemple : biometric_anomaly sans corroboration hardware/automation = humain immobile.
    test('1 seul groupe HIGH → watermarked (pas blocked) en ZBM', () => {
        const s = makeSession({ humanValidated: false });
        s.coherence.contradictions.push({ severity: 'high', independentGroup: 'human_interaction' });
        const r = decideReality(s);
        assert.equal(r, 'watermarked');
    });

    // Corroboration obligatoire : ≥2 groupes HIGH indépendants → blocked.
    // Exemple : hardware_anomaly (GPU) + biometric_anomaly (souris) = deux domaines distincts.
    test('≥2 groupes HIGH indépendants → blocked en ZBM', () => {
        const s = makeSession({ humanValidated: false });
        s.coherence.contradictions.push({ severity: 'high', independentGroup: 'hardware_consistency' });
        s.coherence.contradictions.push({ severity: 'high', independentGroup: 'human_interaction' });
        const r = decideReality(s);
        assert.equal(r, 'blocked');
    });

    test('contradiction moyenne → watermarked en ZBM', () => {
        const s = makeSession({ humanValidated: true });
        s.coherence.contradictions.push({ severity: 'medium' });
        const r = decideReality(s);
        assert.equal(r, 'watermarked');
    });
});

describe('calculateSuspicion', () => {
    test('sans contradictions → suspicion basse', () => {
        const s = calculateSuspicion([]);
        assert.equal(s, 0.1);
    });

    test('contradiction critique → suspicion élevée', () => {
        const s = calculateSuspicion([{ severity: 'critical' }]);
        assert.ok(s >= 0.5, `Suspicion ${s} trop basse pour critique`);
    });

    test('plafonnée à 1.0', () => {
        const many = Array(10).fill({ severity: 'critical' });
        const s = calculateSuspicion(many);
        assert.equal(s, 1.0);
    });
});

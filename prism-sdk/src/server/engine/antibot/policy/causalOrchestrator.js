/**
 * causalOrchestrator.js
 * Décide de la réalité et calcule la suspicion [0,1] à partir du graphe de cohérence.
 *
 * Règle fondamentale : un seul indicateur ne suffit jamais.
 * La suspicion est le produit pondéré des contradictions — jamais d'un fait isolé.
 */

const SEVERITY_WEIGHT = {
    critical: 0.50,
    high:     0.25,
    medium:   0.12,
    low:      0.05,
};

function calculateSuspicion(contradictions) {
    if (!contradictions || contradictions.length === 0) return 0.1;
    let s = 0.1;
    for (const c of contradictions) {
        s += SEVERITY_WEIGHT[c.severity] || 0.05;
    }
    return Math.min(1.0, parseFloat(s.toFixed(3)));
}

function decideReality(session) {
    const zeroBotMode   = process.env.ANTIBOT_ZERO_BOT_MODE !== 'false';
    const contradictions = session.coherence?.contradictions || [];
    const level          = session.coherence?.level || 'unknown';

    const hasCritical = contradictions.some(c => c.severity === 'critical');
    const hasHigh     = contradictions.some(c => c.severity === 'high');
    const hasMedium   = contradictions.some(c => c.severity === 'medium');

    // Suspicion calculée et persistée dans la session
    session.suspicion = calculateSuspicion(contradictions);

    // Bot déclaratif ou scanner → blocage immédiat en zero-bot mode
    if (zeroBotMode && (session.botClass === 'claims_bot' || hasCritical)) {
        return 'blocked';
    }

    // Contradiction critique hors zero-bot → Prisme strict (decoy)
    if (hasCritical) return 'decoy';

    // Contradictions fortes — doctrine : corroboration inter-groupes obligatoire.
    // Un seul groupe HIGH (ex: biometric_anomaly seule après PoW court, sans aucun
    // signal hardware/automation) ne suffit pas à bloquer — PoW prouve la capacité JS.
    // ≥2 groupes indépendants HIGH → blocage confirmé.
    if (hasHigh) {
        const highGroups = new Set(
            contradictions.filter(c => c.severity === 'high').map(c => c.independentGroup)
        );
        if (highGroups.size >= 2) return zeroBotMode ? 'blocked' : 'decoy';
        // Un seul groupe → watermark (token accordé, données empoisonnées, traçable)
        return zeroBotMode ? 'watermarked' : 'observed';
    }

    // Contradictions moyennes → watermark
    if (hasMedium) return zeroBotMode ? 'watermarked' : 'observed';

    // Cohérence inconnue (session trop jeune) → gate obligatoire
    // JAMAIS "normal" pour une session non prouvée humaine
    if (level === 'unknown' || !session.humanValidated) {
        return 'gate_required';
    }

    // Humain validé, cohérence suffisante → normal
    return 'normal';
}

module.exports = { decideReality, calculateSuspicion };

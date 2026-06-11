// Politique de verdict — spécialité : rendre la DÉCISION à partir des témoignages
// des couches. AUCUNE détection ici : les couches détectent, ce module tranche.
//
// Doctrine (rapport bots #3) : « Un seul indicateur ne doit jamais suffire à
// conclure qu'un utilisateur est un bot. C'est l'accumulation cohérente de
// plusieurs signaux, observés dans leur contexte, qui doit permettre de prendre
// une décision fiable. »
//
// Concrètement :
//   - BLOQUER (403, retryable) : score sous le seuil de confiance. Peut résulter
//     d'une seule couche très négative — l'accès est refusé mais l'utilisateur
//     peut réessayer immédiatement (zéro coût pour un humain mal classé).
//   - BANNIR (strike + ban temporaire escaladé) : exige EN PLUS du score bas
//     soit (a) un signal DÉCLARATIF — le client s'est lui-même identifié comme
//     bot (User-Agent Googlebot/GPTBot, rejeu de PoW…), soit (b) la CORROBORATION
//     d'au moins 2 couches indépendantes. Une couche = un témoin : trois signaux
//     internes à L6 ne comptent que pour un témoignage (ils peuvent partager une
//     même cause racine, ex. un périphérique d'entrée exotique).
//
// C'est ce qui protège l'humain atypique : un seul capteur qui « voit un bot »
// (GPU logiciel d'un poste RDP, webdriver d'un outil d'accessibilité…) ne peut
// plus jamais déclencher de bannissement à lui seul.

const TRUST_THRESHOLD = 60;   // sous ce score : accès refusé (403)
const STRIKE_THRESHOLD = 20;  // sous ce score : ban possible SI corroboration
const SIGNIFICANT_SIGNAL = -15; // contribution minimale pour compter comme témoin

// layerResults : tableau de { score, reasons, declarative? } (entrées null/undefined ignorées).
// IMPORTANT : une COUCHE = une entrée = un témoin. Si une couche logique est éclatée
// en plusieurs modules (ex. L1 réseau + L1 TLS), l'orchestrateur DOIT les fusionner en
// UNE entrée avant d'appeler decide(), sinon elle compterait pour 2 témoins (revue).
// Retourne { allowed, ban, score, reasons, witnesses, declarative }.
const decide = (layerResults) => {
    let score = 100;
    const reasons = [];
    let witnesses = 0;
    let declarative = false;

    for (const r of layerResults) {
        if (!r) continue;
        score += r.score || 0;
        if (r.reasons && r.reasons.length) reasons.push(...r.reasons);
        if ((r.score || 0) <= SIGNIFICANT_SIGNAL) witnesses++;
        if (r.declarative === true) declarative = true;
    }

    // Le BAN est calculé INDÉPENDAMMENT de l'autorisation (revue) : la doctrine de
    // corroboration ne doit pas pouvoir être court-circuitée par l'ordre d'évaluation.
    // Un ban exige un score franchement bas ET (auto-déclaration OU >= 2 témoins).
    const ban = score < STRIKE_THRESHOLD && (declarative || witnesses >= 2);
    // L'accès n'est accordé que si le score atteint le seuil ET qu'aucun ban n'est dû.
    // Le seuil reste >= (et non >) : un humain atypique peut légitimement atterrir
    // pile à TRUST_THRESHOLD (ex. employé RDP) — le durcir bloquerait ce cas.
    const allowed = score >= TRUST_THRESHOLD && !ban;

    return { allowed, ban, score, reasons, witnesses, declarative };
};

module.exports = { decide, TRUST_THRESHOLD, STRIKE_THRESHOLD, SIGNIFICANT_SIGNAL };

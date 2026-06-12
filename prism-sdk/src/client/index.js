const EntropyCollector = require('./entropy');
const PowSolver = require('./pow-solver');
const ProgressiveAssembler = require('./assembler');

/**
 * Initialisation globale du SDK client
 */
function initPrismClient(options = {}) {
    // 1. Démarrer la collecte d'entropie
    const collector = new EntropyCollector((entropyScore) => {
        // Envoi silencieux au serveur (beacon)
        if (options.onEntropyUpdate) {
            options.onEntropyUpdate(entropyScore);
        }
    });
    collector.start();

    // 2. Intercepteur de requêtes fetch/XHR (Optionnel) pour gérer 
    // automatiquement les 401 Challenge PoW.
    
    return {
        stop: () => collector.stop(),
        solvePow: PowSolver.solveChallenge,
        assemble: ProgressiveAssembler.assembleValue
    };
}

module.exports = {
    initPrismClient,
    EntropyCollector,
    PowSolver,
    ProgressiveAssembler
};

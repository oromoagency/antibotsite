/**
 * Collecte silencieuse des événements utilisateur pour calculer
 * l'entropie comportementale (Distribution Gamma).
 */

class EntropyCollector {
    constructor(callback) {
        this.timings = [];
        this.lastEvent = Date.now();
        this.callback = callback; // Fonction appelée avec le score d'entropie
        this.batchSize = 20;

        this._onMouseMove = this._onMouseMove.bind(this);
    }

    start() {
        if (typeof window !== 'undefined') {
            window.addEventListener('mousemove', this._onMouseMove, { passive: true });
            window.addEventListener('scroll', this._onMouseMove, { passive: true });
            window.addEventListener('click', this._onMouseMove, { passive: true });
        }
    }

    stop() {
        if (typeof window !== 'undefined') {
            window.removeEventListener('mousemove', this._onMouseMove);
            window.removeEventListener('scroll', this._onMouseMove);
            window.removeEventListener('click', this._onMouseMove);
        }
    }

    _onMouseMove(e) {
        const now = Date.now();
        const delta = now - this.lastEvent;
        this.lastEvent = now;

        // On ignore les deltas trop petits (bruit) ou trop grands (inactivité)
        if (delta > 5 && delta < 2000) {
            this.timings.push(delta);
        }

        if (this.timings.length >= this.batchSize) {
            this._computeAndSend();
        }
    }

    _computeAndSend() {
        const entropy = this.computeEntropy(this.timings);
        if (this.callback) {
            this.callback(entropy);
        }
        this.timings = []; // reset
    }

    /**
     * Calcule l'entropie de Shannon de la distribution des délais
     * @param {number[]} deltas 
     * @returns {number}
     */
    computeEntropy(deltas) {
        const buckets = {};
        for (const d of deltas) {
            const bucket = Math.floor(d / 50); // buckets de 50ms
            buckets[bucket] = (buckets[bucket] || 0) + 1;
        }
        
        let entropy = 0;
        const n = deltas.length;
        
        for (const key in buckets) {
            const count = buckets[key];
            const p = count / n;
            entropy -= p * Math.log2(p);
        }
        
        return entropy;
    }
}

module.exports = EntropyCollector;

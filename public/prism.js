/**
 * 🌈 Prisme SDK — Navigateur (Vanilla JS)
 * Version autonome de l'Ingénierie Offensive.
 */

window.PrismSDK = (function() {
    // 1. Entropie Comportementale (Shannon Entropy)
    class EntropyCollector {
        constructor(callback) {
            this.timings = [];
            this.lastEvent = Date.now();
            this.callback = callback;
            this.batchSize = 20;
            this._onMouseMove = this._onMouseMove.bind(this);
        }

        start() {
            window.addEventListener('mousemove', this._onMouseMove, { passive: true });
            window.addEventListener('scroll', this._onMouseMove, { passive: true });
            window.addEventListener('click', this._onMouseMove, { passive: true });
        }

        stop() {
            window.removeEventListener('mousemove', this._onMouseMove);
            window.removeEventListener('scroll', this._onMouseMove);
            window.removeEventListener('click', this._onMouseMove);
        }

        _onMouseMove(e) {
            const now = Date.now();
            const delta = now - this.lastEvent;
            this.lastEvent = now;

            if (delta > 5 && delta < 2000) {
                this.timings.push(delta);
            }

            if (this.timings.length >= this.batchSize) {
                this._computeAndSend();
            }
        }

        _computeAndSend() {
            const entropy = this.computeEntropy(this.timings);
            if (this.callback) this.callback(entropy);
            this.timings = [];
        }

        computeEntropy(deltas) {
            const buckets = {};
            for (const d of deltas) {
                const bucket = Math.floor(d / 50);
                buckets[bucket] = (buckets[bucket] || 0) + 1;
            }
            let entropy = 0;
            const n = deltas.length;
            for (const key in buckets) {
                const p = buckets[key] / n;
                entropy -= p * Math.log2(p);
            }
            return parseFloat(entropy.toFixed(3));
        }
    }

    // 2. Proof of Work Solver (SHA-256)
    async function sha256(message) {
        const msgBuffer = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async function solveChallenge(payload, difficulty) {
        const target = Math.floor(0xffffff / difficulty);
        let nonce = 0;
        while (true) {
            const hash = await sha256(payload + nonce.toString());
            const prefix = parseInt(hash.slice(0, 6), 16);
            if (prefix <= target) return nonce;
            nonce++;
            if (nonce % 500 === 0) await new Promise(r => setTimeout(r, 0)); // Yield thread
        }
    }

    // 3. Révélation Progressive (Assemblage CSS + JSON)
    function assembleValue(baseValue, cssVarName) {
        const styles = window.getComputedStyle(document.documentElement);
        const cssCentsStr = styles.getPropertyValue(cssVarName).trim();
        const cents = parseInt(cssCentsStr || '0', 10);
        return baseValue + (cents / 100);
    }

    // Initialisation
    return {
        init: function(options = {}) {
            const collector = new EntropyCollector((score) => {
                if (options.onEntropy) options.onEntropy(score);
            });
            collector.start();
            return {
                stopEntropy: () => collector.stop(),
                solveChallenge,
                assembleValue
            };
        }
    };
})();

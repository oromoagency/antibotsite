/**
 * Assembleur de données fragmentées (Révélation Progressive).
 * Récupère le prix de base dans le JSON, les centimes dans le CSS, 
 * et un symbole via WebSocket.
 */

class ProgressiveAssembler {
    
    /**
     * Résout la valeur finale en combinant JSON et CSS
     * @param {number} baseValue - La valeur depuis le JSON
     * @param {string} cssVarName - Le nom de la variable CSS qui contient la suite
     * @returns {number}
     */
    static assembleValue(baseValue, cssVarName) {
        if (typeof window === 'undefined') return baseValue; // SSR fallback

        // Lire la valeur depuis les variables CSS injectées par le serveur
        const styles = window.getComputedStyle(document.documentElement);
        const cssCentsStr = styles.getPropertyValue(cssVarName).trim();
        
        const cents = parseInt(cssCentsStr || '0', 10);
        
        // Assemblage final : base + (cents / 100)
        return baseValue + (cents / 100);
    }

    /**
     * Exemple de Hook React fictif
     * export function usePrismField(baseValue, cssVarName) {
     *     const [value, setValue] = useState(baseValue);
     *     useEffect(() => {
     *         setValue(ProgressiveAssembler.assembleValue(baseValue, cssVarName));
     *     }, [baseValue, cssVarName]);
     *     return value;
     * }
     */
}

module.exports = ProgressiveAssembler;

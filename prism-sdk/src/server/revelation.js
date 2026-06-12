const crypto = require('crypto');

/**
 * Fragmente une valeur numérique (ex: un prix) sur plusieurs canaux
 * pour implémenter la "Révélation Progressive".
 * 
 * @param {number} value - La valeur à fragmenter (ex: 49.99)
 * @param {string} seed - Le seed de la session
 * @returns {Object} Les fragments (JSON, CSS, et Canvas Pixel)
 */
function fragmentValue(value, seed) {
    if (typeof value !== 'number') return { json: value };

    const basePart = Math.floor(value); // ex: 49
    const centsPart = Math.round((value - basePart) * 100); // ex: 99

    // Génération d'une propriété CSS unique par seed
    const cssVarName = `--prism-v-${seed.slice(0, 6)}`;
    const cssStyle = `${cssVarName}: ${centsPart};`;

    // Génération d'un pixel de validation RGB (canvas)
    // On cache une checksum dans les bits faibles des couleurs
    const checksum = (basePart + centsPart) % 255;
    const canvasData = {
        r: 100 + (checksum % 10),
        g: 150 + (checksum % 10),
        b: checksum
    };

    return {
        json_fragment: basePart,    // Ce qui ira dans le payload JSON normal
        css_fragment: cssStyle,     // Ce qui devra être injecté dans une balise <style>
        css_var: cssVarName,        // Le nom de la variable pour le client
        canvas_fragment: canvasData // Ce qui sera envoyé via WebSocket ou encodé
    };
}

/**
 * Middleware Express optionnel pour injecter la partie CSS de la fragmentation
 * dans le flux de réponse si la page est rendue en SSR.
 */
function cssInjectionMiddleware(req, res, next) {
    // Si c'est une requête API, la Révélation Progressive est gérée par le JSON 
    // qui contient la propriété 'style' à injecter par le frontend.
    next();
}

module.exports = {
    fragmentValue,
    cssInjectionMiddleware
};

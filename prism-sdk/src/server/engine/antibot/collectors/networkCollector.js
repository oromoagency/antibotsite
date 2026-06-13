/**
 * networkCollector.js
 * Collecte les faits réseau et les signaux d'en-têtes HTTP pour le graphe causal.
 * Chaque fait est un témoin indépendant — jamais de décision ici, seulement des observations.
 */

const { createFact } = require('../coherence/factModel');

const BOT_UA  = /bot|crawler|spider|slurp|baiduspider|yandex|bingbot|googlebot|gptbot|ccbot|anthropic|perplexity|bytespider|ahrefsbot|semrush/i;

function collect(req, session) {
    if (!session) return;

    const ip       = req.ip || 'unknown';
    const ua       = req.headers['user-agent'] || '';
    const language = req.headers['accept-language'] || '';
    const encoding = req.headers['accept-encoding'] || '';
    const hints    = req.headers['sec-ch-ua'] || '';
    const referer  = req.headers['referer'] || req.headers['referrer'] || '';
    const origin   = req.headers['origin'] || '';
    const accept   = req.headers['accept'] || '';

    session.facts.push(createFact(
        session.id,
        'network',
        'http_request',
        {
            ip,
            userAgent:    ua,
            language,
            encoding,
            clientHints:  hints,
            referer,
            origin,
            accept,
            path:         req.path,
            method:       req.method,
        }
    ));

    // Compteur de requêtes pour la vélocité
    session.counters.requests = (session.counters.requests || 0) + 1;

    if (BOT_UA.test(ua)) {
        session.botClass = 'claims_bot';
        session.facts.push(createFact(
            session.id,
            'network',
            'bot_user_agent',
            { ua },
            'server',
            'high'
        ));
    }

    if (!session.ipHistory.includes(ip)) {
        session.ipHistory.push(ip);
    }
    if (ua && !session.userAgentHistory.includes(ua)) {
        session.userAgentHistory.push(ua);
    }
}

module.exports = { collect };

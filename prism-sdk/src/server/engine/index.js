const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const config = require('./config');

const L1_network = require('./layers/L1_network');
const visitorTracker = require('./middlewares/visitorTracker');
const antibotEntry = require('./antibot/middleware/antibotEntry');
const gatewayController = require('./controllers/gatewayController');
const trackingController = require('./controllers/trackingController');
const adminController = require('./controllers/adminController');
const telegramController = require('./controllers/telegramController');
const L7_session = require('./layers/L7_session');
const honeypot = require('../honeypot');

const DECLARED_BOT_UA = /googlebot|bingbot|yandexbot|baiduspider|duckduckbot|slurp|gptbot|ccbot|anthropic-ai|perplexitybot|bytespider|ahrefsbot|semrushbot|dotbot|rogerbot|exabot|mj12bot|python-requests|python-urllib|aiohttp|scrapy|curl\/|wget\/|go-http-client|java\/|okhttp\/|node-fetch|axios\/|libwww|httpie|nmap|masscan|nikto|sqlmap/i;

function PrismeShield(options = {}) {
    // 1. Initialize configuration
    config.init(options);

    const router = express.Router();

    // The Gateway needs to be able to parse JSON and cookies
    router.use(express.json({ limit: '128kb' }));
    router.use(cookieParser());

    // Honeypot Trap Route
    router.use('/__internal/v2/stats', honeypot.honeypotTrapMiddleware);

    // 2. Base middlewares
    router.use(L1_network.analyze);
    router.use(visitorTracker);
    router.use(antibotEntry);

    // 3. API Routes for the Gateway Challenge
    router.get('/api/challenge-config', gatewayController.getChallengeConfig);
    router.post('/api/verify-challenge', gatewayController.verifyChallenge);
    router.post('/api/feedback-invisible', gatewayController.recordSilentFeedback);

    // Tracking Routes
    router.post('/api/track/event', trackingController.recordEvent);
    router.post('/api/auth/login', trackingController.recordLoginAttempt);
    router.post('/api/auth/register', trackingController.recordRegister);

    // Admin Routes
    router.get('/api/admin/stats', adminController.getStats);
    router.get('/api/admin/report', adminController.getFullReport);
    router.get('/api/admin/visitors', trackingController.getVisitors);
    router.get('/api/admin/visitor/:id', trackingController.getVisitorById);
    router.get('/api/admin/logs', trackingController.getLogs);
    router.post('/api/admin/telegram', telegramController.sendReport);

    // 4. The main Shield (protects everything defined after it)
    router.use((req, res, next) => {
        // Exclure le dashboard admin du test PoW si l'app le gère autrement, mais
        // ici on va dire que si le token admin est fourni, on laisse passer.
        const adminToken = req.headers['x-admin-token'];
        if (adminToken && config.ADMIN_TOKEN && adminToken === config.ADMIN_TOKEN) {
            return next();
        }

        const ua = req.headers['user-agent'] || '';
        if (DECLARED_BOT_UA.test(ua)) {
            if (config.ZERO_BOT_MODE) {
                return res.status(403).json({ error: 'bot_access_restricted' });
            }
        }

        const jwtResult = L7_session.verifyToken(req.cookies['human_auth_token']);
        if (!jwtResult.valid) {
            res.clearCookie('human_auth_token');
            if (req.path.startsWith('/api/') || req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
                return res.status(401).json({ error: 'human_session_required' });
            }
            // Serve the Gateway UI natively for HTML requests
            return res.sendFile('gateway.html', { root: path.join(__dirname, 'views') });
        }
        
        // Pass if verified
        next();
    });

    return router;
}

module.exports = { 
    PrismeShield,
    store: {
        events: require('./store/events'),
        visitors: require('./store/visitors'),
        eventLog: require('./store/eventLog'),
        nonces: require('./store/nonces'),
        reputation: require('./store/reputation')
    },
    sessionStore: require('./antibot/session/sessionStore')
};

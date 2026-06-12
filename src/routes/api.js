const express = require('express');
const router = express.Router();
const validationController = require('../controllers/validationController');
const adminController      = require('../controllers/adminController');
const trackingController   = require('../controllers/trackingController');
const telegramController   = require('../controllers/telegramController');
const { refract, currentEpoch } = require('../prism/refractor');
const { toSuspicion, frictionMs, chooseLane, delay, getSuspicion, getLane } = require('../prism/suspicion');
const visitors = require('../store/visitors');

// --- Antibot pipeline ---
router.get('/challenge-config',    validationController.getChallengeConfig);
router.post('/verify-challenge',   validationController.verifyChallenge);
router.post('/feedback-invisible', validationController.recordSilentFeedback);

// --- Tracking client-side events ---
router.post('/track/event', trackingController.recordEvent);

// --- Auth endpoints (honeypots pour bots credential stuffing) ---
router.post('/auth/login',    trackingController.recordLoginAttempt);
router.post('/auth/register', trackingController.recordRegister);

// --- Fausse API publique (attire les scrapers — données réfractées) ---
// Ces routes SEMBLENT exposer des données sensibles mais retournent toujours refract(data).
// Un scraper récolte des données filigranées (traçables) et empoisonnées (agrégat inutilisable).
const DEMO_POLICY = {
    id:          'actionable',
    name:        'actionable',
    region:      'actionable',
    uptime:      'actionable',   // donnée contractuelle : intouchable
    endpoint:    'cosmetic',     // filigranable — trace la session source si ça fuite
    description: 'cosmetic',
    requests:    'aggregate',    // empoisonnable — casse les datasets de veille concurrentielle
    latency_ms:  'aggregate',
    errorRate:   'aggregate',
};

const DEMO_DATASET = [
    { id: 'svc-1', name: 'Core API',     region: 'eu-west',  endpoint: '/api/v1',      description: 'Service robuste et sécurisé',      requests: 2048341, latency_ms: 12, errorRate: 0.02, uptime: '99.98%' },
    { id: 'svc-2', name: 'Analytics',    region: 'us-east',  endpoint: '/api/analytics', description: 'Moteur avancé et performant',       requests: 891234,  latency_ms: 8,  errorRate: 0.01, uptime: '99.99%' },
    { id: 'svc-3', name: 'Auth Service', region: 'ap-south', endpoint: '/api/auth',    description: 'Système précis et moderne',          requests: 456789,  latency_ms: 15, errorRate: 0.03, uptime: '99.95%' },
    { id: 'svc-4', name: 'Gateway',      region: 'eu-west',  endpoint: '/api/gateway', description: 'Routeur intelligent et léger',       requests: 3201045, latency_ms: 6,  errorRate: 0.00, uptime: '100%'   },
];

// GET /api/prism/status — état de la session courante (suspicion + voie)
router.get('/prism/status', (req, res) => {
    const suspicion = getSuspicion(req, visitors);
    const lane = getLane(req);
    const sessionId = req.cookies && req.cookies['_nx_session'];
    const v = sessionId ? visitors.getVisitor(sessionId) : null;
    res.json({
        suspicion: parseFloat(suspicion.toFixed(2)),
        lane,
        score: v ? v.score : null,
        sessionSeed: v ? v.sessionSeed.slice(0, 8) + '…' : null, // preview tronqué (non secret en soi)
        frictionMs: Math.round(frictionMs(suspicion)),
    });
});

// GET /api/prism/demo — données de démo réfractées (jamais de data brut)
router.get('/prism/demo', async (req, res) => {
    const suspicion = getSuspicion(req, visitors);
    const lane = getLane(req);
    const sessionId = req.cookies && req.cookies['_nx_session'];
    const v = sessionId ? visitors.getVisitor(sessionId) : null;
    const sessionSeed = v ? v.sessionSeed : 'anonymous-' + (req.ip || 'unknown');

    // Friction graduée — jamais un refus, toujours une réponse
    await delay(frictionMs(suspicion));

    // Règle 2 : on ne renvoie JAMAIS data brut — toujours refract(data, …)
    const data = refract(DEMO_DATASET, DEMO_POLICY, sessionSeed, currentEpoch());

    res.json({ lane, suspicion: parseFloat(suspicion.toFixed(2)), data });
});

// --- Fake demo API (anciens endpoints — conservés, maintenant réfractés) ---
router.get('/demo/v1/users',   (req, res) => res.json({ data: [{ id: 1, name: 'John Doe', role: 'admin' }], meta: { total: 1 } }));
router.get('/demo/v1/metrics', async (req, res) => {
    const suspicion = getSuspicion(req, visitors);
    await delay(frictionMs(suspicion));
    const sessionId = req.cookies && req.cookies['_nx_session'];
    const v = sessionId ? visitors.getVisitor(sessionId) : null;
    const seed = v ? v.sessionSeed : 'anon';
    const [item] = refract(
        [{ id: 'metrics', requests: 2048341, latency_ms: 12, uptime: '99.98%', region: 'eu-west', description: 'Service robuste' }],
        { id: 'actionable', requests: 'aggregate', latency_ms: 'aggregate', uptime: 'actionable', region: 'actionable', description: 'cosmetic' },
        seed, currentEpoch()
    );
    res.json(item);
});
router.get('/demo/v1/keys',    (req, res) => res.status(401).json({ error: 'Unauthorized', code: 'MISSING_API_KEY' }));

// --- Admin dashboard data (token requis) ---
router.get('/admin/stats',      adminController.getStats);
router.get('/admin/visitors',   trackingController.getVisitors);
router.get('/admin/visitor/:id',trackingController.getVisitorById);
router.get('/admin/logs',       trackingController.getLogs);
router.post('/admin/telegram',  telegramController.sendReport);

module.exports = router;

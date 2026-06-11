const express = require('express');
const router = express.Router();
const validationController = require('../controllers/validationController');
const adminController      = require('../controllers/adminController');
const trackingController   = require('../controllers/trackingController');
const telegramController   = require('../controllers/telegramController');

// --- Antibot pipeline ---
router.get('/challenge-config',    validationController.getChallengeConfig);
router.post('/verify-challenge',   validationController.verifyChallenge);
router.post('/feedback-invisible', validationController.recordSilentFeedback);

// --- Tracking client-side events ---
router.post('/track/event', trackingController.recordEvent);

// --- Auth endpoints (honeypots pour bots credential stuffing) ---
router.post('/auth/login',    trackingController.recordLoginAttempt);
router.post('/auth/register', trackingController.recordRegister);

// --- Fake demo API (attire les bots/scrapers) ---
router.get('/demo/v1/users',   (req, res) => res.json({ data: [{ id: 1, name: 'John Doe', role: 'admin' }], meta: { total: 1 } }));
router.get('/demo/v1/metrics', (req, res) => res.json({ requests: 2048341, latency_ms: 12, uptime: '99.98%', region: 'eu-west' }));
router.get('/demo/v1/keys',    (req, res) => res.status(401).json({ error: 'Unauthorized', code: 'MISSING_API_KEY' }));

// --- Admin dashboard data (token requis) ---
router.get('/admin/stats',      adminController.getStats);
router.get('/admin/visitors',   trackingController.getVisitors);
router.get('/admin/visitor/:id',trackingController.getVisitorById);
router.get('/admin/logs',       trackingController.getLogs);
router.post('/admin/telegram',  telegramController.sendReport);

module.exports = router;

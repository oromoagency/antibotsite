// Controller de tracking des événements côté client + endpoints admin dashboard.

const crypto    = require('crypto');
const config    = require('../config');
const visitors  = require('../store/visitors');
const eventLog  = require('../store/eventLog');
const telegram  = require('./telegramController');
const { computeHeat, computeEntropyFromDeltas } = require('../../prism-sdk/src/server/suspicion');

// --- Validation token admin (timing-safe) ---
const tokenValid = (supplied) => {
    if (!supplied || typeof supplied !== 'string') return false;
    try {
        const a = crypto.createHash('sha256').update(supplied).digest();
        const b = crypto.createHash('sha256').update(config.ADMIN_TOKEN).digest();
        return crypto.timingSafeEqual(a, b);
    } catch { return false; }
};

// POST /api/track/event — reçoit les événements JS côté client
exports.recordEvent = (req, res) => {
    const { type, sessionId, data = {} } = req.body || {};
    if (!type) return res.json({ ok: true });

    const v = sessionId ? visitors.getVisitor(sessionId) : null;

    switch (type) {
        case 'identify':
            if (v) visitors.updateVisitor(sessionId, {
                screen:                  data.screen,
                timezone:                data.timezone || (data.languages && ''),
                cookiesEnabled:          data.cookieEnabled  ?? data.cookiesEnabled,
                localStorageAvailable:   data.localStorageAvailable,
                sessionStorageAvailable: data.sessionStorageAvailable,
                indexedDbAvailable:      data.indexedDbAvailable,
                language:                (data.languages && data.languages[0]) || data.language || v.language,
                // Hardware
                hardwareConcurrency: data.hardwareConcurrency,
                deviceMemory:        data.deviceMemory,
                platform:            data.platform,
                maxTouchPoints:      data.maxTouchPoints,
                colorDepth:          data.colorDepth,
                pixelRatio:          data.pixelRatio,
                viewportW:           data.viewportW,
                viewportH:           data.viewportH,
                // Réseau
                connection: data.connection,
                localIps:   data.localIps,
                // Préférences
                doNotTrack:        data.doNotTrack,
                prefDark:          data.prefDark,
                prefReducedMotion: data.prefReducedMotion,
                prefContrast:      data.prefContrast,
                // Plugins & polices
                plugins:      data.plugins,
                fonts:        data.fonts,
                battery:      data.battery,
                webglRenderer:data.webglRenderer,
            });
            break;
        case 'click':
            if (v) visitors.updateVisitor(sessionId, { clicks: v.clicks + 1 });
            break;
        case 'scroll':
            if (v) visitors.updateVisitor(sessionId, { scrolls: v.scrolls + 1 });
            break;
        case 'form_submit':
            if (v) {
                visitors.updateVisitor(sessionId, { formSubmissions: v.formSubmissions + 1 });
                telegram.notifyActivity(v, 'Formulaire Soumis', `ID Formulaire: ${data.formId || 'Inconnu'}`).catch(() => {});
            }
            break;
        case 'login_attempt':
            if (v) visitors.updateVisitor(sessionId, { loginAttempts: v.loginAttempts + 1 });
            break;
        case 'js_error':
            if (v) visitors.updateVisitor(sessionId, { jsErrors: v.jsErrors + 1 });
            break;
        case 'prism_entropy':
            if (v && Array.isArray(data.deltas)) {
                // SECURITE : Calcul côté serveur des deltas temporels bruts
                const entropy = computeEntropyFromDeltas(data.deltas);
                const heat = computeHeat({ entropy, requestFrequency: 1 });
                
                // Si la chaleur est > 0.5, c'est que l'entropie est faible (comportement robotique)
                if (heat > 0.5) {
                    const penalty = Math.floor(heat * 20); // Jusqu'à -20 points par batch
                    const newScore = Math.max(0, v.score - penalty);
                    visitors.updateVisitor(sessionId, { score: newScore, entropy });
                    if (newScore < 80 && v.score >= 80) {
                        telegram.notifySuspect(visitors.getVisitor(sessionId)).catch(() => {});
                    }
                } else {
                    visitors.updateVisitor(sessionId, { entropy });
                }
                data.computedEntropy = entropy;
            }
            break;
    }

    if (v) visitors.addEvent(sessionId, { type, ...data });

    eventLog.record({ type, sessionId, ip: v?.ip || 'unknown', data });

    res.json({ ok: true });
};

// POST /api/auth/login — enregistre les tentatives de connexion (honeypot)
exports.recordLoginAttempt = (req, res) => {
    const { email } = req.body || {};
    const sid = req.cookies && req.cookies['_nx_session'];
    const v   = sid ? visitors.getVisitor(sid) : null;

    if (v) {
        visitors.updateVisitor(sid, { loginAttempts: v.loginAttempts + 1 });
        visitors.addEvent(sid, { type: 'login_attempt', email: email?.slice(0, 50) });
        // Score : trop de tentatives = suspect
        if (v.loginAttempts >= 3) {
            visitors.updateVisitor(sid, { decision: 'suspect', score: Math.max(0, v.score - 20) });
            telegram.notifySuspect(visitors.getVisitor(sid)).catch(() => {});
        }
    }

    eventLog.record({ type: 'login_attempt', sessionId: sid, ip: req.ip, email: email?.slice(0, 50) });

    // Réponse fictive (honeypot)
    setTimeout(() => {
        res.status(401).json({ error: 'Invalid credentials. Please check your email and password.' });
    }, 800 + Math.random() * 400);
};

// POST /api/auth/register
exports.recordRegister = (req, res) => {
    const { email } = req.body || {};
    const sid = req.cookies && req.cookies['_nx_session'];
    const v   = sid ? visitors.getVisitor(sid) : null;
    if (v) {
        visitors.updateVisitor(sid, { formSubmissions: v.formSubmissions + 1 });
        visitors.addEvent(sid, { type: 'register_attempt', email: email?.slice(0, 50) });
    }
    eventLog.record({ type: 'register_attempt', sessionId: sid, ip: req.ip, email: email?.slice(0, 50) });
    res.json({ success: true, message: 'Account created! Check your email to confirm.' });
};

// GET /api/admin/visitors — liste filtrée (token requis)
exports.getVisitors = (req, res) => {
    if (!tokenValid(req.headers['x-admin-token'])) return res.status(401).json({ error: 'Non autorisé.' });

    let list = visitors.getAllVisitors();
    const { ip, country, status, browser, minScore, maxScore } = req.query;
    const limit  = Math.min(parseInt(req.query.limit  || '100', 10), 500);
    const offset = parseInt(req.query.offset || '0', 10);

    if (ip)       list = list.filter(v => v.ip.includes(ip));
    if (country)  list = list.filter(v => (v.country || '').toLowerCase().includes(country.toLowerCase()));
    if (status)   list = list.filter(v => v.decision === status);
    if (browser)  list = list.filter(v => (v.browser || '').toLowerCase().includes(browser.toLowerCase()));
    if (minScore !== undefined) list = list.filter(v => v.score >= Number(minScore));
    if (maxScore !== undefined) list = list.filter(v => v.score <= Number(maxScore));

    const total = list.length;
    list = list.slice(offset, offset + limit);

    res.json({ total, visitors: list });
};

// GET /api/admin/visitor/:id — fiche complète
exports.getVisitorById = (req, res) => {
    if (!tokenValid(req.headers['x-admin-token'])) return res.status(401).json({ error: 'Non autorisé.' });
    const v = visitors.getVisitor(req.params.id);
    if (!v) return res.status(404).json({ error: 'Visiteur non trouvé.' });
    res.json(v);
};

// GET /api/admin/logs — journal global
exports.getLogs = (req, res) => {
    if (!tokenValid(req.headers['x-admin-token'])) return res.status(401).json({ error: 'Non autorisé.' });
    const limit = Math.min(parseInt(req.query.limit || '200', 10), 1000);
    res.json(eventLog.getRecent(limit));
};

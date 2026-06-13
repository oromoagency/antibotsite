// Middleware de tracking visiteurs — s'applique aux pages publiques HTML.
// Crée ou met à jour la session visiteur via cookie _nx_session.
// N'effectue AUCUNE détection anti-bot : rôle purement observationnel.

const visitors = require('../store/visitors');
const eventLog = require('../store/eventLog');

const COOKIE_MAX_AGE = 2 * 60 * 60; // 2 heures en secondes

const visitorTracker = (req, res, next) => {
    // Ne tracker que les pages (GET HTML), pas les API calls
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api/')) return next();
    if (req.path === '/favicon.ico') return next();

    const ip = req.ip || 'unknown';
    const ua = req.headers['user-agent'] || '';
    const referer  = req.headers['referer'] || req.headers['referrer'] || '';
    const language = (req.headers['accept-language'] || '').split(',')[0].trim();

    // Récupère la session existante depuis le cookie
    let sessionId = req.cookies && req.cookies['_nx_session'];
    let visitor = sessionId ? visitors.getVisitor(sessionId) : null;

    if (!visitor) {
        // Nouvelle session
        visitor = visitors.createVisitor({ ip, userAgent: ua, referer, language });
        sessionId = visitor.id;

        eventLog.record({
            type: 'arrive',
            sessionId,
            ip,
            userAgent: ua,
            referer,
            url: req.path,
        });

        // Timeout pour les bots sans exécution JS (Scrapers)
        // IMPORTANT : exclure /admin et /favicon.ico — ces pages ne font jamais le PoW
        const isPublicPage = !req.path.startsWith('/admin') && req.path !== '/favicon.ico';
        if (isPublicPage) {
            const scraperTimer = setTimeout(() => {
                const v = visitors.getVisitor(sessionId);
                if (v && v.decision === 'pending') {
                    v.decision = 'blocked';
                    v.score = 0;
                    v.reasons.push('HTTP Scraper détecté : Aucune exécution du défi cryptographique en 15 secondes (Scrapy, curl, wget, Requests Python...)');
                    require('../controllers/telegramController').notifySuspect(v).catch(() => {});
                }
            }, 15000);
            // Ne pas maintenir l'event loop en vie pour ce timer de housekeeping
            // (permet à l'app hôte / aux tests de sortir proprement).
            if (scraperTimer.unref) scraperTimer.unref();
        }
    }

    // Enregistrer la page visitée
    visitors.addPage(sessionId, req.path);
    visitors.updateVisitor(sessionId, { lastSeen: Date.now() });

    eventLog.record({
        type:      'pageview',
        sessionId,
        ip,
        url:       req.path,
        userAgent: ua,
    });

    // Attacher l'ID de session à la requête pour les controllers
    req.visitorId = sessionId;

    // Définir / renouveler le cookie de session
    res.cookie('_nx_session', sessionId, {
        httpOnly: false, // doit être lisible par le JS client pour les events
        secure:   process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge:   COOKIE_MAX_AGE * 1000,
    });

    next();
};

module.exports = visitorTracker;

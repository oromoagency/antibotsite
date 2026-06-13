// Observabilité (Phase 9) — expose l'état GLOBAL du système à l'opérateur :
// posture de flotte, difficulté PoW courante, statistiques de verdicts,
// raisons dominantes, pièges honeypot.
// Lecture seule : aucun levier de décision ici.
//
// Protégé par ADMIN_TOKEN (en-tête x-admin-token), comparaison en temps
// constant — un attaquant ne peut pas deviner le jeton octet par octet
// en mesurant la latence.

const crypto   = require('crypto');
const config   = require('../config');
const posture  = require('../policy/posture');
const events   = require('../store/events');
const visitors = require('../store/visitors');
const eventLog = require('../store/eventLog');
const sessionStore = require('../antibot/session/sessionStore');
const { getBlacklistStats } = require('../../prism-sdk/src/server/honeypot');

const tokenValid = (supplied) => {
    if (typeof supplied !== 'string' || supplied.length === 0) return false;
    const a = crypto.createHash('sha256').update(supplied).digest();
    const b = crypto.createHash('sha256').update(config.ADMIN_TOKEN).digest();
    return crypto.timingSafeEqual(a, b);
};

// ── GET /api/admin/stats ───────────────────────────────────────────────────
// Métriques légères — appelé toutes les 5s par le dashboard live.
exports.getStats = (req, res) => {
    if (!tokenValid(req.headers['x-admin-token'])) {
        return res.status(401).json({ error: 'Non autorisé.' });
    }

    posture.evaluate();

    const w5   = events.statsWindow(5 * 60 * 1000);
    const w60  = events.statsWindow(60 * 60 * 1000);
    const vis  = visitors.getAllVisitors();

    res.json({
        generatedAt:   new Date().toISOString(),
        uptime:        Math.round(process.uptime()),
        posture:       posture.currentLevel(),
        difficulty:    posture.currentDifficulty(),
        eventsStored:  events.size(),
        honeypot:      getBlacklistStats(),
        window5min:    w5,
        lastHour:      w60,
        visitors: {
            total:   vis.length,
            allowed: vis.filter(v => v.decision === 'allowed').length,
            suspect: vis.filter(v => v.decision === 'suspect').length,
            blocked: vis.filter(v => v.decision === 'blocked').length,
            pending: vis.filter(v => !['allowed','suspect','blocked'].includes(v.decision)).length,
        },
    });
};

// ── GET /api/admin/report ──────────────────────────────────────────────────
// Rapport complet téléchargeable — toutes les données en un seul JSON.
// Contient : posture, visiteurs complets, logs, stats causal engine, honeypot.
exports.getFullReport = (req, res) => {
    if (!tokenValid(req.headers['x-admin-token'])) {
        return res.status(401).json({ error: 'Non autorisé.' });
    }

    posture.evaluate();

    const allVisitors  = visitors.getAllVisitors();
    const recentLogs   = eventLog.getRecent(2000);
    const w5           = events.statsWindow(5 * 60 * 1000);
    const w60          = events.statsWindow(60 * 60 * 1000);
    const honey        = getBlacklistStats();

    // Agrégation des stats de sessions causales
    const causalStats = (() => {
        try {
            // Accès direct au store interne pour les stats globales
            const store = sessionStore._getStore ? sessionStore._getStore() : null;
            if (!store) return null;
            let humanValidated = 0, gateRequired = 0, blocked = 0;
            const contradictionCount = {};
            for (const session of store.values()) {
                if (session.humanValidated)           humanValidated++;
                else if (session.prisme?.reality === 'blocked') blocked++;
                else                                   gateRequired++;
                for (const c of (session.coherence?.contradictions || [])) {
                    contradictionCount[c.ruleId] = (contradictionCount[c.ruleId] || 0) + 1;
                }
            }
            const topRules = Object.entries(contradictionCount)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([rule, count]) => ({ rule, count }));
            return { sessions: store.size, humanValidated, gateRequired, blocked, topRules };
        } catch (_) { return null; }
    })();

    // Stats visiteurs par décision
    const visitorStats = {
        total:   allVisitors.length,
        allowed: allVisitors.filter(v => v.decision === 'allowed').length,
        suspect: allVisitors.filter(v => v.decision === 'suspect').length,
        blocked: allVisitors.filter(v => v.decision === 'blocked').length,
        pending: allVisitors.filter(v => !['allowed','suspect','blocked'].includes(v.decision)).length,
        avgScore: allVisitors.length
            ? Math.round(allVisitors.reduce((s, v) => s + (v.score || 0), 0) / allVisitors.length)
            : 0,
    };

    const report = {
        meta: {
            generatedAt:  new Date().toISOString(),
            target:       process.env.SITE_URL || 'https://antibotsite.onrender.com',
            environment:  process.env.NODE_ENV || 'development',
            uptimeSeconds: Math.round(process.uptime()),
            version:      '2.0.0',
        },
        posture: {
            level:      posture.currentLevel(),
            difficulty: posture.currentDifficulty(),
        },
        events: {
            stored:    events.size(),
            window5min: w5,
            lastHour:   w60,
        },
        honeypot:     honey,
        causal:       causalStats,
        visitors:     { stats: visitorStats, data: allVisitors },
        logs:         recentLogs,
    };

    // Déclenche le téléchargement direct dans le browser
    const filename = `nexapi-report-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json(report);
};

/**
 * contradictionRules.js
 * 10 règles causales indépendantes. Chaque règle témoigne d'un domaine distinct.
 * Doctrine : un seul fait ne suffit jamais — la corroboration inter-domaines décide.
 */

const crypto = require('crypto');

function createContradiction(ruleId, title, severity, domains, independentGroup, facts, confidence = 'high') {
    return {
        id: 'contradiction_' + crypto.randomBytes(8).toString('hex'),
        ruleId,
        title,
        severity,
        domains,
        independentGroup,
        facts,
        confidence,
        createdAt: Date.now()
    };
}

const CHROMIUM_UA = /chrome|chromium|edg\//i;
const BROWSER_UA  = /mozilla|webkit|gecko|chrome|safari|firefox/i;
const BOT_CLAIM   = /bot|crawler|spider|slurp|baiduspider|yandex|bingbot|googlebot|gptbot|ccbot|anthropic|perplexity|bytespider|ahrefsbot|semrush/i;
const SCRIPT_UA   = /curl|wget|python|aiohttp|requests|scrapy|node-fetch|axios|java\/|okhttp|go-http-client|libwww|httpie/i;

// Plages CIDR simplifiées des principaux hébergeurs et datacenter connus
// (liste réduite — un vrai déploiement charge MaxMind ou IPinfo)
const DATACENTER_CIDRS = [
    [0x23000000, 8],   // 35.0.0.0/8  — Google Cloud
    [0x22000000, 8],   // 34.0.0.0/8  — Google Cloud
    [0x34000000, 8],   // 52.0.0.0/8  — AWS
    [0x36000000, 8],   // 54.0.0.0/8  — AWS
    [0x68100000, 12],  // 104.16.0.0/12 — Cloudflare Workers
    [0x2d400000, 10],  // 45.64.0.0/10 — DigitalOcean range
    [0xc7300000, 16],  // 199.48.0.0/16 — Linode
];

function ipToInt(ip) {
    const s = String(ip || '').replace(/^::ffff:/, '');
    const parts = s.split('.');
    if (parts.length !== 4) return null;
    let n = 0;
    for (const p of parts) {
        const o = parseInt(p, 10);
        if (isNaN(o) || o < 0 || o > 255) return null;
        n = (n * 256 + o) >>> 0;
    }
    return n;
}

function isDatacenterIp(ip) {
    const n = ipToInt(ip);
    if (n === null) return false;
    return DATACENTER_CIDRS.some(([base, bits]) => {
        const mask = bits === 32 ? 0xffffffff : ~((1 << (32 - bits)) - 1) >>> 0;
        return (n & mask) === (base & mask);
    });
}

const RULES = [
    // ─── Règle 1 : API sensible avant toute page HTML ─────────────────────────
    {
        id: 'api_first_session',
        evaluate: (session) => {
            const apiCalls  = session.facts.filter(f => f.name === 'api_call' && f.value?.isSensitive);
            const htmlViews = session.facts.filter(f => f.name === 'http_request' && !f.value?.path?.startsWith('/api/'));
            if (apiCalls.length > 0 && htmlViews.length === 0) {
                return createContradiction(
                    'api_first_session',
                    'Sensitive API called before any page view',
                    'high', ['api', 'intent'], 'api_intent', [apiCalls[0].id]
                );
            }
            return null;
        }
    },

    // ─── Règle 2 : Dérive d'identité (UA change en cours de session) ──────────
    {
        id: 'session_identity_drift',
        evaluate: (session) => {
            if (session.userAgentHistory.length > 1) {
                const facts = session.facts.filter(f => f.name === 'http_request');
                return createContradiction(
                    'session_identity_drift',
                    'User-Agent changed mid-session',
                    'medium', ['network', 'environment'], 'network_consistency',
                    facts.slice(0, 2).map(f => f.id)
                );
            }
            return null;
        }
    },

    // ─── Règle 3 : Vélocité excessive ─────────────────────────────────────────
    {
        id: 'request_velocity_spike',
        evaluate: (session) => {
            if (session.counters.requests > 120 || session.counters.sensitiveApiCalls > 40) {
                return createContradiction(
                    'request_velocity_spike',
                    'Request velocity exceeds human threshold',
                    session.counters.sensitiveApiCalls > 40 ? 'high' : 'medium',
                    ['network', 'timing'], 'velocity', []
                );
            }
            return null;
        }
    },

    // ─── Règle 4 : UA navigateur sans Accept-Language ─────────────────────────
    // Un vrai navigateur envoie toujours Accept-Language. Les scripts HTTP ne le font pas.
    {
        id: 'ua_missing_accept_language',
        evaluate: (session) => {
            const req = session.facts.find(f => f.name === 'http_request');
            if (!req) return null;
            const ua  = req.value?.userAgent || '';
            const lang = req.value?.language || '';
            if (BROWSER_UA.test(ua) && !lang) {
                return createContradiction(
                    'ua_missing_accept_language',
                    'Browser UA without Accept-Language header',
                    'medium', ['network', 'client'], 'header_consistency', [req.id]
                );
            }
            return null;
        }
    },

    // ─── Règle 5 : UA Chromium sans Client Hints (sec-ch-ua) ──────────────────
    // Chromium 89+ envoie sec-ch-ua sur toute requête vers le même domaine.
    // Un bot qui clone l'UA Chrome ne génère presque jamais les Client Hints natifs.
    {
        id: 'client_hints_mismatch',
        evaluate: (session) => {
            const req = session.facts.find(f => f.name === 'http_request');
            if (!req) return null;
            const ua   = req.value?.userAgent || '';
            const hints = req.value?.clientHints || '';
            if (CHROMIUM_UA.test(ua) && !hints) {
                return createContradiction(
                    'client_hints_mismatch',
                    'Chromium UA without sec-ch-ua Client Hints',
                    'medium', ['network', 'client'], 'header_consistency', [req.id]
                );
            }
            return null;
        }
    },

    // ─── Règle 6 : UA déclarant crawler non vérifié ───────────────────────────
    // Se prétendre Googlebot/Bingbot sans vérification DNS = spoofing suspect.
    {
        id: 'ua_spoofing_search_crawler',
        evaluate: (session) => {
            if (session.botClass === 'claims_bot') {
                const facts = session.facts.filter(f => f.name === 'bot_user_agent');
                return createContradiction(
                    'ua_spoofing_search_crawler',
                    'UA claims crawler without verified reverse-DNS',
                    'critical', ['network', 'identity'], 'identity', facts.map(f => f.id)
                );
            }
            return null;
        }
    },

    // ─── Règle 7 : UA script HTTP déclaratif ──────────────────────────────────
    {
        id: 'script_http_client',
        evaluate: (session) => {
            const req = session.facts.find(f => f.name === 'http_request');
            if (!req) return null;
            const ua = req.value?.userAgent || '';
            if (SCRIPT_UA.test(ua)) {
                return createContradiction(
                    'script_http_client',
                    'Request from script HTTP client',
                    'critical', ['network', 'client'], 'identity', [req.id]
                );
            }
            return null;
        }
    },

    // ─── Règle 8 : IP datacenter avec UA navigateur ───────────────────────────
    // Un humain sur AWS/GCP/Azure est improbable (sauf si VPN d'entreprise identifié).
    // Seul, c'est medium — insuffisant pour bloquer seul.
    {
        id: 'ip_datacenter',
        evaluate: (session) => {
            const req = session.facts.find(f => f.name === 'http_request');
            if (!req) return null;
            const ip = req.value?.ip || '';
            const ua = req.value?.userAgent || '';
            if (isDatacenterIp(ip) && BROWSER_UA.test(ua)) {
                return createContradiction(
                    'ip_datacenter',
                    'Browser UA from known datacenter IP range',
                    'medium', ['network', 'infrastructure'], 'network_infra', [req.id]
                );
            }
            return null;
        }
    },

    // ─── Règle 9 : Piège honeypot déclenché ───────────────────────────────────
    {
        id: 'honeypot_access',
        evaluate: (session) => {
            if (session.honeypotTriggered) {
                return createContradiction(
                    'honeypot_access',
                    'Invisible honeypot endpoint accessed',
                    'critical', ['intent', 'automation'], 'honeypot', []
                );
            }
            return null;
        }
    },

    // ─── Règle 10 : Vélocité API élevée dans les 60 premières secondes ────────
    {
        id: 'early_api_burst',
        evaluate: (session) => {
            const age = Date.now() - session.createdAt;
            if (age < 60_000 && session.counters.sensitiveApiCalls > 10) {
                return createContradiction(
                    'early_api_burst',
                    'High API burst in first 60s of session',
                    'high', ['timing', 'intent'], 'early_burst', []
                );
            }
            return null;
        }
    },
    // ─── Règle 11 : Anomalie d'automatisation détectée (L5) ───────────────────
    {
        id: 'automation_detected',
        evaluate: (session) => {
            const autoFacts = session.facts.filter(f => f.name === 'automation_anomaly');
            if (autoFacts.length > 0) {
                return createContradiction(
                    'automation_detected',
                    'Automation tools explicitly detected (Puppeteer, Selenium, etc.)',
                    'critical', ['environment', 'automation'], 'automation_flag', autoFacts.map(f => f.id)
                );
            }
            return null;
        }
    },

    // ─── Règle 12 : Anomalie matérielle détectée (L4) ─────────────────────────
    {
        id: 'hardware_anomaly',
        evaluate: (session) => {
            const hwFacts = session.facts.filter(f => f.name === 'hardware_anomaly');
            if (hwFacts.length > 0) {
                return createContradiction(
                    'hardware_anomaly',
                    'Hardware fingerprint is inconsistent with a real browser (Headless/VM)',
                    'high', ['hardware', 'environment'], 'hardware_consistency', hwFacts.map(f => f.id)
                );
            }
            return null;
        }
    },

    // ─── Règle 13 : Anomalie biométrique (L6) ─────────────────────────────────
    {
        id: 'biometric_anomaly',
        evaluate: (session) => {
            const bioFacts = session.facts.filter(f => f.name === 'biometric_anomaly');
            if (bioFacts.length > 0) {
                // Vérifier si l'anomalie est purement une absence d'interaction (qui est normale sur la page Gateway de 1 seconde)
                // ou un manque de clic (-5).
                let isRobotic = false;
                for (const f of bioFacts) {
                    if (f.value && f.value.reasons) {
                        for (const reason of f.value.reasons) {
                            // Si la raison mentionne une téléportation, un lissage, une injection, une ligne droite, etc.
                            if (!reason.includes('Aucune interaction') && 
                                !reason.includes('Aucune activité') && 
                                !reason.includes('sans clic')) {
                                isRobotic = true;
                            }
                        }
                    }
                }

                if (!isRobotic) {
                    // C'est juste une absence d'interaction (ex: l'humain attend sur la Gateway).
                    // On ne lève pas de contradiction forte.
                    return createContradiction(
                        'biometric_absence',
                        'Absence of biometric interaction (acceptable on fast Gateway)',
                        'low', ['biometrics', 'intent'], 'human_interaction', bioFacts.map(f => f.id)
                    );
                }

                return createContradiction(
                    'biometric_anomaly',
                    'Mouse/Keyboard interaction is mathematically robotic',
                    'high', ['biometrics', 'intent'], 'human_interaction', bioFacts.map(f => f.id)
                );
            }
            return null;
        }
    },

    // ─── Règle 14 : Sensor Desync (Décalage temporel) ─────────────────────────
    {
        id: 'sensor_desync_detected',
        evaluate: (session) => {
            const desyncFacts = session.facts.filter(f => f.name === 'sensor_desync');
            if (desyncFacts.length > 0) {
                return createContradiction(
                    'sensor_desync_detected',
                    'Sensor timestamps are desynchronized (often caused by Ghost-Cursor/Puppeteer)',
                    'critical', ['timing', 'hardware'], 'sensor_sync', desyncFacts.map(f => f.id)
                );
            }
            return null;
        }
    },
];

module.exports = { createContradiction, RULES };

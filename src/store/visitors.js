// Store visiteurs en mémoire — sessions identifiées par cookie _nx_session
// Données collectées pour l'analyse anti-bot et le dashboard admin.
// Toutes les données restent en RAM, aucune persistance externe requise.

const crypto = require('crypto');

const visitors = new Map();
const MAX_VISITORS = 10000;

// --- Parsing User-Agent ---
const parseUA = (ua = '') => {
    const s = String(ua);
    let browser = 'Other', os = 'Other';

    if (/Edg\//i.test(s))           browser = 'Edge';
    else if (/OPR\//i.test(s))      browser = 'Opera';
    else if (/Chrome\//i.test(s))   browser = 'Chrome';
    else if (/Firefox\//i.test(s))  browser = 'Firefox';
    else if (/Safari\//i.test(s))   browser = 'Safari';
    else if (/curl\//i.test(s))     browser = 'curl';
    else if (/python/i.test(s))     browser = 'Python';
    else if (/wget/i.test(s))       browser = 'wget';
    else if (/Go-http/i.test(s))    browser = 'Go';
    else if (/axios/i.test(s))      browser = 'axios';
    else if (/node-fetch/i.test(s)) browser = 'node-fetch';
    else if (/scrapy/i.test(s))     browser = 'Scrapy';

    if (/Windows/i.test(s))     os = 'Windows';
    else if (/iPhone|iPad/i.test(s)) os = 'iOS';
    else if (/Android/i.test(s)) os = 'Android';
    else if (/Mac OS X/i.test(s)) os = 'macOS';
    else if (/Linux/i.test(s))   os = 'Linux';

    return { browser, os };
};

// --- Géolocalisation IP via ip-api.com (gratuit, sans clé) ---
const geolocate = async (ip) => {
    const privateRanges = /^(::1|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::ffff:)/;
    if (privateRanges.test(ip)) return null;
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 3000);
        const res = await fetch(
            `http://ip-api.com/json/${ip}?fields=country,countryCode,regionName,city,as,isp`,
            { signal: ctrl.signal }
        );
        clearTimeout(t);
        if (!res.ok) return null;
        const d = await res.json();
        return { country: d.country, countryCode: d.countryCode, region: d.regionName, city: d.city, asn: d.as, isp: d.isp };
    } catch { return null; }
};

// --- CRUD visiteurs ---
const generateId = () => crypto.randomBytes(16).toString('hex');

const createVisitor = (data) => {
    if (visitors.size >= MAX_VISITORS) {
        const oldest = visitors.keys().next().value;
        visitors.delete(oldest);
    }
    const { browser, os } = parseUA(data.userAgent);
    const id = generateId();
    const visitor = {
        id,
        startTime:  Date.now(),
        lastSeen:   Date.now(),
        ip:         data.ip        || 'unknown',
        userAgent:  data.userAgent || 'unknown',
        referer:    data.referer   || '',
        language:   data.language  || '',
        browser, os,
        // Géolocalisation (remplie en background)
        country: null, countryCode: null, region: null, city: null, asn: null, isp: null,
        // Données côté client (remplies via /api/track/event type 'identify')
        screen: null, timezone: null, cookiesEnabled: null, localStorageAvailable: null,
        // Activité
        pages:           [],
        events:          [],
        clicks:          0,
        scrolls:         0,
        formSubmissions: 0,
        loginAttempts:   0,
        jsErrors:        0,
        // Anti-bot
        score:    100,
        decision: 'pending',
        reasons:  [],
    };
    visitors.set(id, visitor);

    // Géolocalisation en background (fire-and-forget)
    geolocate(data.ip).then(geo => {
        if (geo) updateVisitor(id, geo);
    }).catch(() => {});

    return visitor;
};

const getVisitor  = (id) => visitors.get(id) || null;

const updateVisitor = (id, data) => {
    const v = visitors.get(id);
    if (!v) return;
    Object.assign(v, data);
    v.lastSeen = Date.now();
};

const addEvent = (id, event) => {
    const v = visitors.get(id);
    if (!v) return;
    if (v.events.length < 500) v.events.push({ t: Date.now(), ...event });
    v.lastSeen = Date.now();
};

const addPage = (id, url) => {
    const v = visitors.get(id);
    if (!v) return;
    if (v.pages.length < 100) v.pages.push({ url, t: Date.now() });
};

const getAllVisitors = () =>
    Array.from(visitors.values()).sort((a, b) => b.startTime - a.startTime);

const getStats = () => {
    let total = 0, allowed = 0, blocked = 0, suspect = 0, pending = 0;
    let formSubmissions = 0, clicks = 0, loginAttempts = 0;
    for (const v of visitors.values()) {
        total++;
        if (v.decision === 'allowed')  allowed++;
        else if (v.decision === 'blocked') blocked++;
        else if (v.decision === 'suspect') suspect++;
        else pending++;
        formSubmissions += v.formSubmissions;
        clicks          += v.clicks;
        loginAttempts   += v.loginAttempts;
    }
    return { total, allowed, blocked, suspect, pending, formSubmissions, clicks, loginAttempts };
};

module.exports = { createVisitor, getVisitor, updateVisitor, addEvent, addPage, getAllVisitors, getStats, parseUA };

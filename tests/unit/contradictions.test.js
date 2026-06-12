/**
 * Tests unitaires — Règles de contradiction causale
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { RULES } = require('../../src/antibot/coherence/contradictionRules');
const { createSession } = require('../../src/antibot/session/sessionModel');
const { createFact } = require('../../src/antibot/coherence/factModel');

function makeSession(overrides = {}) {
    const s = createSession();
    return Object.assign(s, overrides);
}

function rule(id) {
    return RULES.find(r => r.id === id);
}

describe('api_first_session', () => {
    test('déclenche si API sensible avant toute page', () => {
        const s = makeSession();
        s.facts.push(createFact(s.id, 'api', 'api_call', { isSensitive: true, path: '/api/data' }));
        const c = rule('api_first_session').evaluate(s);
        assert.ok(c, 'Contradiction attendue');
        assert.equal(c.severity, 'high');
    });

    test('ne déclenche pas si page HTML vue avant', () => {
        const s = makeSession();
        s.facts.push(createFact(s.id, 'network', 'http_request', { path: '/pricing', method: 'GET' }));
        s.facts.push(createFact(s.id, 'api', 'api_call', { isSensitive: true, path: '/api/data' }));
        const c = rule('api_first_session').evaluate(s);
        assert.equal(c, null);
    });
});

describe('session_identity_drift', () => {
    test('déclenche si UA change', () => {
        const s = makeSession();
        s.userAgentHistory.push('Mozilla/5.0');
        s.userAgentHistory.push('curl/7.0');
        const c = rule('session_identity_drift').evaluate(s);
        assert.ok(c);
        assert.equal(c.severity, 'medium');
    });

    test('ne déclenche pas si un seul UA', () => {
        const s = makeSession();
        s.userAgentHistory.push('Mozilla/5.0');
        const c = rule('session_identity_drift').evaluate(s);
        assert.equal(c, null);
    });
});

describe('ua_spoofing_search_crawler', () => {
    test('déclenche pour claims_bot', () => {
        const s = makeSession();
        s.botClass = 'claims_bot';
        s.facts.push(createFact(s.id, 'network', 'bot_user_agent', { ua: 'Googlebot/2.1' }));
        const c = rule('ua_spoofing_search_crawler').evaluate(s);
        assert.ok(c);
        assert.equal(c.severity, 'critical');
    });

    test('ne déclenche pas pour unknown (navigateur normal)', () => {
        const s = makeSession();
        s.botClass = 'unknown';
        const c = rule('ua_spoofing_search_crawler').evaluate(s);
        assert.equal(c, null);
    });
});

describe('script_http_client', () => {
    test('déclenche pour curl', () => {
        const s = makeSession();
        s.facts.push(createFact(s.id, 'network', 'http_request', { userAgent: 'curl/7.88', path: '/' }));
        const c = rule('script_http_client').evaluate(s);
        assert.ok(c);
        assert.equal(c.severity, 'critical');
    });

    test('ne déclenche pas pour Firefox', () => {
        const s = makeSession();
        s.facts.push(createFact(s.id, 'network', 'http_request', { userAgent: 'Mozilla/5.0 (Firefox/120)', path: '/' }));
        const c = rule('script_http_client').evaluate(s);
        assert.equal(c, null);
    });
});

describe('honeypot_access', () => {
    test('déclenche si honeypotTriggered', () => {
        const s = makeSession();
        s.honeypotTriggered = true;
        const c = rule('honeypot_access').evaluate(s);
        assert.ok(c);
        assert.equal(c.severity, 'critical');
    });
});

describe('early_api_burst', () => {
    test('déclenche si >10 appels API dans les 60 premières secondes', () => {
        const s = makeSession();
        s.counters.sensitiveApiCalls = 15;
        const c = rule('early_api_burst').evaluate(s);
        assert.ok(c);
        assert.equal(c.severity, 'high');
    });

    test('ne déclenche pas si session plus ancienne', () => {
        const s = makeSession();
        s.createdAt = Date.now() - 120_000;
        s.counters.sensitiveApiCalls = 15;
        const c = rule('early_api_burst').evaluate(s);
        assert.equal(c, null);
    });
});

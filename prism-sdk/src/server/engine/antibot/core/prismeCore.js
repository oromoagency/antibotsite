/**
 * Prisme Core
 * Platform-neutral decision engine for Express, Cloudflare Workers, Akamai
 * EdgeWorkers, and any HTTP runtime that can provide normalized request facts.
 *
 * Doctrine:
 * - no useful content without a validated human session in zero-bot mode;
 * - no hard decision from a single weak anomaly;
 * - official crawlers are still machines when zero-bot mode is enabled;
 * - edge code gives the least possible feedback to automation.
 */

const DEFAULT_CONFIG = {
    zeroBotMode: true,
    gatePath: '/gateway',
    apiPrefix: '/api/',
    sessionCookieNames: ['nx_sess', 'nx_human'],
    publicPrefixes: [
        '/api/challenge-config',
        '/api/verify-challenge',
        '/api/feedback-invisible',
        '/api/track/event',
        '/api/noscript-entry',
        '/__internal/',
        '/robots.txt',
        '/favicon.ico',
        '/argon2',
        '/prism.js'
    ],
    staticExtensions: [
        '.css', '.js', '.mjs', '.map', '.png', '.jpg', '.jpeg', '.gif',
        '.webp', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.wasm'
    ],
    protectedPagePrefixes: ['/', '/app', '/pricing', '/docs', '/login', '/register'],
    sensitiveApiPrefixes: ['/api/prism/', '/api/demo/', '/api/admin/'],
    crawlerPattern: /(googlebot|bingbot|google-inspectiontool|google-extended|adsbot-google|apis-google|storebot-google|googleother|google-safety|duckduckbot|yandex|baiduspider|slurp|facebookexternalhit|twitterbot|linkedinbot|slackbot|discordbot|telegrambot|whatsapp|gptbot|ccbot|perplexitybot|anthropic-ai|claudebot|bytespider|ahrefsbot|semrushbot)/i,
    scriptPattern: /(curl|wget|python|aiohttp|requests|scrapy|node-fetch|axios|java\/|okhttp|go-http-client|phpcrawl|httpclient|libwww)/i,
    scannerPattern: /(sqlmap|nikto|nessus|nuclei|zgrab|acunetix|dirbuster|wfuzz|metasploit|zap|sucuri|virustotal|malwarebytes|netcraft)/i
};

function mergeConfig(overrides) {
    return { ...DEFAULT_CONFIG, ...(overrides || {}) };
}

function parseCookies(cookieHeader) {
    const cookies = {};
    String(cookieHeader || '').split(';').forEach((part) => {
        const idx = part.indexOf('=');
        if (idx <= 0) return;
        const key = part.slice(0, idx).trim();
        cookies[key] = decodeURIComponent(part.slice(idx + 1).trim());
    });
    return cookies;
}

function pathStarts(path, prefixes) {
    return prefixes.some((prefix) => path === prefix || path.startsWith(prefix));
}

function hasStaticExtension(path, extensions) {
    const lower = path.toLowerCase();
    return extensions.some((ext) => lower.endsWith(ext));
}

function isPublicPath(path, config) {
    return pathStarts(path, config.publicPrefixes) || hasStaticExtension(path, config.staticExtensions);
}

function isSensitiveApi(path, config) {
    return pathStarts(path, config.sensitiveApiPrefixes);
}

function isProtectedPage(path, config) {
    if (path.startsWith(config.apiPrefix)) return false;
    if (isPublicPath(path, config)) return false;
    return pathStarts(path, config.protectedPagePrefixes);
}

function hasKnownHumanSession(input, config) {
    if (input.humanValidated === true || input.hasHumanSession === true) return true;
    const cookies = input.cookies || parseCookies(input.cookieHeader || '');
    return config.sessionCookieNames.some((name) => Boolean(cookies[name]));
}

function contradiction(id, severity, domains, title, confidence) {
    return {
        id,
        severity,
        domains,
        title,
        confidence: confidence || 'high'
    };
}

function analyzeRequest(input, overrides) {
    const config = mergeConfig(overrides);
    const path = input.path || '/';
    const method = input.method || 'GET';
    const ua = input.userAgent || '';
    const hasHumanSession = hasKnownHumanSession(input, config);
    const publicPath = isPublicPath(path, config);
    const protectedPage = isProtectedPage(path, config);
    const sensitiveApi = isSensitiveApi(path, config);
    const api = path.startsWith(config.apiPrefix);
    const contradictions = [];

    const claimsCrawler = config.crawlerPattern.test(ua);
    const claimsScript = config.scriptPattern.test(ua);
    const claimsScanner = config.scannerPattern.test(ua);

    if (claimsCrawler) {
        contradictions.push(contradiction(
            'declared_crawler',
            'critical',
            ['network', 'identity'],
            'User-Agent declares crawler automation'
        ));
    }

    if (claimsScript) {
        contradictions.push(contradiction(
            'script_http_client',
            'critical',
            ['network', 'client'],
            'User-Agent declares script HTTP client'
        ));
    }

    if (claimsScanner) {
        contradictions.push(contradiction(
            'security_scanner',
            'critical',
            ['network', 'intent'],
            'User-Agent declares scanner or vulnerability tooling'
        ));
    }

    if (input.verifiedCrawler === true && config.zeroBotMode) {
        contradictions.push(contradiction(
            'verified_machine_disallowed',
            'critical',
            ['policy', 'identity'],
            'Verified crawler is disallowed in zero-bot mode'
        ));
    }

    if (sensitiveApi && !hasHumanSession) {
        contradictions.push(contradiction(
            'api_without_human_session',
            'high',
            ['api', 'intent'],
            'Sensitive API requested without validated human session'
        ));
    }

    if (protectedPage && !hasHumanSession) {
        contradictions.push(contradiction(
            'content_without_human_session',
            'medium',
            ['content', 'session'],
            'Useful page requested without validated human session'
        ));
    }

    const critical = contradictions.some((c) => c.severity === 'critical');
    const high = contradictions.some((c) => c.severity === 'high');

    let action = 'allow';
    let reality = hasHumanSession ? 'normal' : 'observed';
    let status = 200;

    if (publicPath) {
        action = 'allow_public';
        reality = 'public';
    } else if (config.zeroBotMode && critical) {
        action = 'deny';
        reality = 'blocked';
        status = 403;
    } else if (config.zeroBotMode && sensitiveApi && !hasHumanSession) {
        action = 'deny_api';
        reality = 'blocked';
        status = 401;
    } else if (config.zeroBotMode && protectedPage && !hasHumanSession) {
        action = 'gate';
        reality = 'gate';
        status = 200;
    } else if (high && api) {
        action = 'prisme_degraded';
        reality = 'degraded';
    } else if (contradictions.length > 0 && api) {
        action = 'prisme_watermarked';
        reality = 'watermarked';
    }

    return {
        action,
        reality,
        status,
        path,
        method,
        publicPath,
        protectedPage,
        sensitiveApi,
        hasHumanSession,
        contradictions,
        reasonCodes: contradictions.map((c) => c.id)
    };
}

function edgeHeaders(decision) {
    return {
        'x-prisme-action': decision.action,
        'x-prisme-reality': decision.reality,
        'x-prisme-reasons': decision.reasonCodes.slice(0, 6).join(','),
        'x-robots-tag': 'noindex, nofollow, noarchive, nosnippet'
    };
}

module.exports = {
    DEFAULT_CONFIG,
    analyzeRequest,
    edgeHeaders,
    parseCookies,
    isPublicPath,
    isSensitiveApi,
    isProtectedPage
};

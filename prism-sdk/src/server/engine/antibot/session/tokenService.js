/**
 * tokenService.js
 * Opaque session cookie used by the Prisme Causal pipeline.
 */

const COOKIE_NAME = 'nx_sess';

const COOKIE_OPTIONS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    maxAge: 4 * 60 * 60 * 1000
};

function setSessionCookie(res, sessionId) {
    res.cookie(COOKIE_NAME, sessionId, COOKIE_OPTIONS);
}

function getSessionIdFromRequest(req) {
    return req.cookies ? req.cookies[COOKIE_NAME] : null;
}

function clearSessionCookie(res) {
    res.clearCookie(COOKIE_NAME, COOKIE_OPTIONS);
}

module.exports = {
    COOKIE_NAME,
    COOKIE_OPTIONS,
    setSessionCookie,
    getSessionIdFromRequest,
    clearSessionCookie
};

// Notifications Telegram — alertes en temps réel sur les visites suspectes/bloquées.

const crypto   = require('crypto');
const config   = require('../config');
const visitors = require('../store/visitors');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8097351985:AAE9VdgeONd-c9kQJYlKUvacFKeatlnV73A';
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID   || '6265830405';

// --- Envoi d'un message Telegram ---
const sendMessage = async (text) => {
    const truncated = text.length > 4096 ? text.slice(0, 4090) + '...' : text;
    try {
        const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: CHAT_ID, text: truncated, parse_mode: 'HTML' }),
        });
        return res.ok;
    } catch (e) {
        console.error('[TELEGRAM] Erreur envoi:', e.message);
        return false;
    }
};

// --- Échappement HTML sécurisé pour Telegram ---
const escapeHtml = (text) => {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
};

// --- Notification d'un visiteur suspect/bloqué/autorisé ---
const notifySuspect = async (visitor) => {
    if (!visitor) return;
    
    const emoji = visitor.decision === 'blocked' ? '🚫'
                : visitor.decision === 'suspect' ? '⚠️' : 'ℹ️';

    const duration = Math.round((Date.now() - visitor.startTime) / 1000);
    const pages    = escapeHtml(visitor.pages.map(p => p.url).join(', ') || 'aucune');
    const reasons  = escapeHtml(visitor.reasons.join('\n  - ') || 'aucune');
    const safeUa   = escapeHtml((visitor.userAgent || '').slice(0, 100));

    const msg = `${emoji} <b>Visiteur ${visitor.decision.toUpperCase()}</b>

🔍 <b>Identité</b>
  IP : <code>${escapeHtml(visitor.ip)}</code>
  Pays : ${escapeHtml(visitor.country || '?')} ${escapeHtml(visitor.countryCode || '')} — ${escapeHtml(visitor.city || '')}, ${escapeHtml(visitor.region || '')}
  ASN : ${escapeHtml(visitor.asn || '?')}
  ISP : ${escapeHtml(visitor.isp || '?')}

💻 <b>Environnement</b>
  Navigateur : ${escapeHtml(visitor.browser)} — ${escapeHtml(visitor.os)}
  UA : <code>${safeUa}</code>
  Langue : ${escapeHtml(visitor.language || '?')}
  Écran : ${escapeHtml(visitor.screen || '?')}
  Fuseau : ${escapeHtml(visitor.timezone || '?')}

🎯 <b>Score anti-bot : ${visitor.score}/100</b>
  Décision : ${visitor.decision}
  Raisons :
  - ${reasons}

📊 <b>Activité</b>
  Durée session : ${duration}s
  Pages visitées : ${pages}
  Clics : ${visitor.clicks} | Scrolls : ${visitor.scrolls}

🔗 Référent : ${escapeHtml(visitor.referer || 'direct')}
⏰ ${new Date(visitor.startTime).toISOString()}`;

    await sendMessage(msg);
};

// POST /api/admin/telegram — envoie un rapport de stats à Telegram
const sendReport = async (req, res) => {
    const config2 = require('../config');
    const crypto2 = require('crypto');
    const supplied = req.headers['x-admin-token'];
    if (!supplied) return res.status(401).json({ error: 'Non autorisé.' });
    try {
        const a = crypto2.createHash('sha256').update(supplied).digest();
        const b = crypto2.createHash('sha256').update(config2.ADMIN_TOKEN).digest();
        if (!crypto2.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Non autorisé.' });
    } catch { return res.status(401).json({ error: 'Non autorisé.' }); }

    const stats = visitors.getStats();
    const msg = `📊 <b>Rapport NexAPI Cloud — ${new Date().toLocaleString('fr-FR')}</b>

👥 Visiteurs total : <b>${stats.total}</b>
  ✅ Autorisés : ${stats.allowed}
  ⚠️ Suspects : ${stats.suspect}
  🚫 Bloqués : ${stats.blocked}
  ⏳ En attente : ${stats.pending}

📈 Activité
  Formulaires : ${stats.formSubmissions}
  Clics : ${stats.clicks}
  Tentatives login : ${stats.loginAttempts}`;

    const ok = await sendMessage(msg);
    res.json({ ok, message: ok ? 'Rapport envoyé.' : 'Erreur Telegram.' });
};

module.exports = { sendMessage, notifySuspect, sendReport };

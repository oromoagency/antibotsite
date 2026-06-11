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

// --- Notification d'un visiteur suspect/bloqué/autorisé ---
const notifySuspect = async (visitor) => {
    if (!visitor) return;
    
    // Le code suivant a été retiré pour envoyer l'alerte à TOUT LE MONDE :
    // if (visitor.score >= 70 && visitor.decision === 'allowed') return;

    const emoji = visitor.decision === 'blocked' ? '🚫'
                : visitor.decision === 'suspect' ? '⚠️' : 'ℹ️';

    const duration = Math.round((Date.now() - visitor.startTime) / 1000);
    const pages    = visitor.pages.map(p => p.url).join(', ') || 'aucune';
    const reasons  = visitor.reasons.join('\n  - ') || 'aucune';

    const msg = `${emoji} <b>Visiteur ${visitor.decision.toUpperCase()}</b>

🔍 <b>Identité</b>
  IP : <code>${visitor.ip}</code>
  Pays : ${visitor.country || '?'} ${visitor.countryCode || ''} — ${visitor.city || ''}, ${visitor.region || ''}
  ASN : ${visitor.asn || '?'}
  ISP : ${visitor.isp || '?'}

💻 <b>Environnement</b>
  Navigateur : ${visitor.browser} — ${visitor.os}
  UA : <code>${(visitor.userAgent || '').slice(0, 100)}</code>
  Langue : ${visitor.language || '?'}
  Écran : ${visitor.screen || '?'}
  Fuseau : ${visitor.timezone || '?'}
  Cookies : ${visitor.cookiesEnabled ?? '?'} | LocalStorage : ${visitor.localStorageAvailable ?? '?'}

🎯 <b>Score anti-bot : ${visitor.score}/100</b>
  Décision : ${visitor.decision}
  Raisons :
  - ${reasons}

📊 <b>Activité</b>
  Durée session : ${duration}s
  Pages visitées : ${pages}
  Clics : ${visitor.clicks} | Scrolls : ${visitor.scrolls}
  Formulaires : ${visitor.formSubmissions} | Tentatives login : ${visitor.loginAttempts}
  Erreurs JS : ${visitor.jsErrors}

🔗 Référent : ${visitor.referer || 'direct'}
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

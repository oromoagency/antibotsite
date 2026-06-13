// Notifications Telegram — alertes en temps réel sur les visites suspectes/bloquées.

const crypto   = require('crypto');
const config   = require('../config');
const visitors = require('../store/visitors');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('[TELEGRAM] TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID absent — notifications désactivées.');
}

// --- Envoi d'un message Telegram ---
const sendMessage = async (text) => {
    if (!BOT_TOKEN || !CHAT_ID) return false;
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
// Ordre d'affichage des couches dans le rapport Telegram
const LAYER_ORDER = ['L1-Réseau', 'L2-Accès', 'L3-PoW', 'L4-Hardware', 'L5-Automation', 'L6-Biométrie'];

const notifySuspect = async (visitor) => {
    if (!visitor) return;
    if (visitor.decision !== 'allowed') return;

    const emoji = visitor.decision === 'blocked' ? '🚫'
                : visitor.decision === 'suspect'  ? '⚠️' : 'ℹ️';

    const duration = Math.round((Date.now() - visitor.startTime) / 1000);
    const pages    = escapeHtml((visitor.pages || []).map(p => p.url).join(', ') || 'aucune');
    const safeUa   = escapeHtml((visitor.userAgent || '').slice(0, 120));

    // --- Raisons groupées par couche ---
    const layerScores = visitor.layerScores || {};
    const grouped = {};
    for (const r of visitor.reasons || []) {
        const m = r.match(/^\[([^\]]+)\]\s*(.*)/);
        if (m) { if (!grouped[m[1]]) grouped[m[1]] = []; grouped[m[1]].push(m[2]); }
    }
    // Raisons sans tag de couche (ex. scraper HTTP bloqué avant PoW)
    const untagged = (visitor.reasons || []).filter(r => !r.match(/^\[[^\]]+\]/));

    // Section "Analyse par couche" — n'apparaît que si des données de couche existent
    let layerSection = '';
    const hasLayers = Object.keys(layerScores).length > 0 || Object.keys(grouped).length > 0;
    if (hasLayers) {
        const lines = LAYER_ORDER.map(tag => {
            const sc = layerScores.hasOwnProperty(tag) ? layerScores[tag] : null;
            const reasons = grouped[tag] || [];
            const scStr = sc === null ? '  ?' : (sc >= 0 ? ` +${sc}` : ` ${sc}`).padEnd(4);
            const ico = sc === 0 && reasons.length === 0 ? '✅' : sc !== null && sc <= -30 ? '🔴' : '🟡';
            const detail = reasons.length ? reasons.map(r => escapeHtml(r)).join(' | ') : '✓';
            return `  ${ico} <b>${escapeHtml(tag.padEnd(16))}</b> <code>${scStr}</code> ${detail}`;
        });
        layerSection = `\n\n🛡️ <b>Analyse par couche</b>\n${lines.join('\n')}`;
    }

    // Section hardware — n'apparaît que si des données JS ont été collectées
    const hasHardware = visitor.hardwareConcurrency || visitor.deviceMemory || visitor.webglRenderer
                     || visitor.screen || visitor.platform;
    let hwSection = '';
    if (hasHardware) {
        const hw = [
            visitor.hardwareConcurrency ? `${visitor.hardwareConcurrency} CPU` : null,
            visitor.deviceMemory        ? `${visitor.deviceMemory} GB RAM` : null,
            visitor.maxTouchPoints != null ? `${visitor.maxTouchPoints} touch pts` : null,
            visitor.platform            ? `(${visitor.platform})` : null,
        ].filter(Boolean).join(' · ') || '—';
        const display = [
            visitor.screen,
            visitor.viewportW && visitor.viewportH ? `viewport ${visitor.viewportW}×${visitor.viewportH}` : null,
            visitor.colorDepth ? `${visitor.colorDepth}-bit` : null,
            visitor.pixelRatio ? `×${visitor.pixelRatio} DPR` : null,
        ].filter(Boolean).join(' · ') || '—';
        hwSection = `\n\n🖥️ <b>Hardware</b>
  CPU/RAM : ${escapeHtml(hw)}
  Affichage : ${escapeHtml(display)}
  WebGL : ${escapeHtml(visitor.webglRenderer || '—')}
  Batterie : ${visitor.battery ? `${Math.round((visitor.battery.level||0)*100)}% · ${visitor.battery.charging ? '⚡' : '🔋'}` : '—'}`;
    }

    // Section réseau/IP locale — n'apparaît que si WebRTC a fuité ou connexion connue
    const hasNet = visitor.localIps || visitor.connection;
    let netSection = '';
    if (hasNet) {
        const conn = visitor.connection
            ? [visitor.connection.effectiveType,
               visitor.connection.downlink != null ? `↓${visitor.connection.downlink}Mbps` : null,
               visitor.connection.rtt      != null ? `RTT ${visitor.connection.rtt}ms` : null]
               .filter(Boolean).join(' · ')
            : '—';
        const localIp = Array.isArray(visitor.localIps) ? visitor.localIps.join(', ') : (visitor.localIps || '—');
        netSection = `\n\n🔌 <b>Réseau client</b>
  Connexion : ${escapeHtml(conn)}
  IP locale (WebRTC) : <code>${escapeHtml(localIp)}</code>`;
    }

    const msg = `${emoji} <b>Visiteur ${escapeHtml(visitor.decision.toUpperCase())}</b>

🔍 <b>Identité</b>
  IP : <code>${escapeHtml(visitor.ip)}</code>
  Pays : ${escapeHtml(visitor.country || '?')} ${visitor.countryCode ? `(${escapeHtml(visitor.countryCode)})` : ''} — ${escapeHtml(visitor.city || '?')}, ${escapeHtml(visitor.region || '?')}
  ASN : ${escapeHtml(visitor.asn || '?')}
  ISP : ${escapeHtml(visitor.isp || '?')}

💻 <b>Environnement</b>
  Navigateur : ${escapeHtml(visitor.browser)} — ${escapeHtml(visitor.os)}
  UA : <code>${safeUa}</code>
  Langue : ${escapeHtml(visitor.language || '?')}
  Écran : ${escapeHtml(visitor.screen || '?')}
  Timezone : ${escapeHtml(visitor.timezone || '?')}${hwSection}${netSection}

🎯 <b>Score anti-bot : ${visitor.score}/100</b>
  Décision : <b>${escapeHtml(visitor.decision)}</b>
  Raisons :
  - ${untagged.length ? escapeHtml(untagged.join('\n  - ')) : Object.entries(grouped).map(([tag, rs]) => escapeHtml(`[${tag}] ${rs.join(' | ')}`)).join('\n  - ') || 'aucune'}${layerSection}

📊 <b>Activité</b>
  Durée : ${duration}s | Pages : ${(visitor.pages||[]).length} | Clics : ${visitor.clicks||0} | Scrolls : ${visitor.scrolls||0}
  Logins : ${visitor.loginAttempts||0} | Forms : ${visitor.formSubmissions||0} | JS Errors : ${visitor.jsErrors||0}
  Pages visitées : ${pages}

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

// --- Notification d'activité importante ---
const notifyActivity = async (visitor, actionLabel, detailText) => {
    if (!visitor) return;
    const msg = `🔔 <b>Activité Importante : ${escapeHtml(actionLabel)}</b>
    
👤 <b>Visiteur</b> : <code>${escapeHtml(visitor.ip)}</code>
Détails : <i>${escapeHtml(detailText)}</i>
(Score actuel : ${visitor.score})`;
    await sendMessage(msg);
};

module.exports = { sendMessage, notifySuspect, sendReport, notifyActivity };

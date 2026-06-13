// Journal global d'événements — toutes les actions importantes du système
// triées chronologiquement pour le dashboard admin.

const crypto = require('crypto');

const log = [];
const MAX_EVENTS = 1000000;

const record = (event) => {
    if (log.length >= MAX_EVENTS) log.shift(); // FIFO
    log.push({
        id:        crypto.randomBytes(8).toString('hex'),
        timestamp: Date.now(),
        ...event,
    });
};

const getRecent = (limit = 1000000) => log.slice(-limit).reverse();

const getBySession = (sessionId) => log.filter(e => e.sessionId === sessionId);

const getByType = (type) => log.filter(e => e.type === type);

const size = () => log.length;

module.exports = { record, getRecent, getBySession, getByType, size };

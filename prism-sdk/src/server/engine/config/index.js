// prism-sdk/src/server/engine/config/index.js
// Singleton config for the engine
const tuning = require('./tuning');

const state = {
    PORT: 3000,
    ADMIN_TOKEN: '',
    SECRET_KEY: '',
    CHALLENGE_DIFFICULTY: 100000,
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_CHAT_ID: '',
    ZERO_BOT_MODE: true,
};

module.exports = {
    get: (key) => state[key],
    set: (key, value) => { state[key] = value; },
    init: (opts) => {
        if (opts.adminToken) state.ADMIN_TOKEN = opts.adminToken;
        if (opts.secretKey) state.SECRET_KEY = opts.secretKey;
        if (opts.challengeDifficulty) state.CHALLENGE_DIFFICULTY = opts.challengeDifficulty;
        if (opts.telegramBotToken) state.TELEGRAM_BOT_TOKEN = opts.telegramBotToken;
        if (opts.telegramChatId) state.TELEGRAM_CHAT_ID = opts.telegramChatId;
        if (opts.zeroBotMode !== undefined) state.ZERO_BOT_MODE = opts.zeroBotMode;
    },
    get ADMIN_TOKEN() { return state.ADMIN_TOKEN; },
    get SECRET_KEY() { return state.SECRET_KEY; },
    get CHALLENGE_DIFFICULTY() { return state.CHALLENGE_DIFFICULTY; },
    get TELEGRAM_BOT_TOKEN() { return state.TELEGRAM_BOT_TOKEN; },
    get TELEGRAM_CHAT_ID() { return state.TELEGRAM_CHAT_ID; },
    get ZERO_BOT_MODE() { return state.ZERO_BOT_MODE; },
    get PORT() { return state.PORT; },
    tuning
};

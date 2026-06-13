const L4 = require('./prism-sdk/src/server/engine/layers/L4_hardware');
const facts = {
    webgl: null,
    canvas: null,
    audio: null,
    webgpu: null,
    sensorDesync: null,
    fingerprint: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36" },
    battery: null,
    screenProfile: null,
    renderTimeMs: null
};

const result = L4.analyze(facts);
console.log(result);

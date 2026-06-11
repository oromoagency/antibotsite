// Test de régression Phase 2 — L2 (datacenter + réputation).

const L2 = require('../src/layers/L2_access');
const reputation = require('../src/store/reputation');

let failures = 0;
function assert(label, cond) {
    if (!cond) failures++;
    console.log(`${cond ? '✅' : '❌'} ${label}`);
}

console.log('=== Test Phase 2 : L2 accès & réputation IP ===');

// --- Détection datacenter (CIDR) ---
assert('AWS 3.5.6.7 → datacenter', L2.isDatacenter('3.5.6.7') === true);
assert('DigitalOcean 157.230.5.5 → datacenter', L2.isDatacenter('157.230.5.5') === true);
assert('Azure 20.40.1.1 → datacenter', L2.isDatacenter('20.40.1.1') === true);
assert('Google DNS 8.8.8.8 → résidentiel/hors-liste', L2.isDatacenter('8.8.8.8') === false);
assert('IP résidentielle 86.200.10.5 → hors-liste', L2.isDatacenter('86.200.10.5') === false);
assert('IPv4-mapped ::ffff:3.5.6.7 → datacenter', L2.isDatacenter('::ffff:3.5.6.7') === true);

// --- Scoring ---
assert('analyze datacenter → -15', L2.analyze({ ip: '3.5.6.7' }).score === L2.DATACENTER_PENALTY);
assert('analyze résidentiel → 0', L2.analyze({ ip: '8.8.8.8' }).score === 0);

// --- Ban temporaire escaladé ---
const victim = '198.51.100.7'; // IP de test (TEST-NET-2)
assert('avant strike → non banni', reputation.isBanned(victim) === false);
const s1 = reputation.recordStrike(victim);
assert('strike 1 → banni 5 min', reputation.isBanned(victim) === true && s1.ttl === 5 * 60 * 1000);
const s2 = reputation.recordStrike(victim);
assert('strike 2 → TTL 30 min', s2.ttl === 30 * 60 * 1000);
const s3 = reputation.recordStrike(victim);
assert('strike 3 → TTL plafonné 2 h', s3.ttl === 2 * 60 * 60 * 1000);
const s4 = reputation.recordStrike(victim);
assert('strike 4 → reste plafonné 2 h', s4.ttl === 2 * 60 * 60 * 1000);

// --- Sécurité loopback (pas d'auto-lockout en dev) ---
reputation.recordStrike('127.0.0.1');
assert('loopback 127.0.0.1 jamais banni', reputation.isBanned('127.0.0.1') === false);
reputation.recordStrike('::1');
assert('loopback ::1 jamais banni', reputation.isBanned('::1') === false);

console.log(failures === 0 ? '\n✅ TOUS LES TESTS PASSENT' : `\n❌ ${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);

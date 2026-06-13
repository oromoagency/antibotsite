/**
 * Tests unitaires — Révélation Progressive
 * Valide : fragmentation entier/centièmes + reconstitution, et que le JSON seul
 * (sans le canal CSS) ne suffit pas à retrouver la valeur exacte.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { fragmentValue, fragmentField } = require('../../prism-sdk/src/server/revelation');

describe('fragmentValue', () => {
    test('sépare entier et centièmes', () => {
        const f = fragmentValue(49.99, '--x');
        assert.equal(f.base, 49);
        assert.equal(f.cents, 99);
        assert.equal(f.cssRule, '--x:99');
    });

    test('valeur entière → centièmes 0', () => {
        const f = fragmentValue(19, '--y');
        assert.equal(f.base, 19);
        assert.equal(f.cents, 0);
    });

    test('non-numérique → passthrough sans crash', () => {
        const f = fragmentValue('N/A', '--z');
        assert.equal(f.base, 'N/A');
        assert.equal(f.cssRule, '');
    });
});

describe('fragmentField', () => {
    const DATA = [
        { id: 'a', price: 49.99 },
        { id: 'b', price: 19.00 },
        { id: 'c', price: 149.50 },
    ];

    test('le JSON ne contient que la partie ENTIÈRE (fuite neutralisée)', () => {
        const { rows } = fragmentField(DATA, 'price');
        assert.equal(rows[0].price, 49);   // pas 49.99
        assert.equal(rows[2].price, 149);  // pas 149.50
    });

    test('styles CSS portent les centièmes par ligne', () => {
        const { styles } = fragmentField(DATA, 'price');
        assert.match(styles, /--pr-price-0:99/);
        assert.match(styles, /--pr-price-1:0/);
        assert.match(styles, /--pr-price-2:50/);
        assert.match(styles, /^:root\{/);
    });

    test('reconstitution base + centièmes/100 = valeur exacte', () => {
        const { rows, styles } = fragmentField(DATA, 'price');
        // Simuler l'assemblage client : lire le centième dans la "feuille de style".
        rows.forEach((row) => {
            const m = styles.match(new RegExp(`${row.priceVar}:(\\d+)`));
            const cents = m ? parseInt(m[1], 10) : 0;
            const reassembled = row.price + cents / 100;
            const original = DATA.find((d) => d.id === row.id).price;
            assert.equal(reassembled, original);
        });
    });

    test('champ absent / non numérique → ligne inchangée', () => {
        const { rows } = fragmentField([{ id: 'x', label: 'free' }], 'price');
        assert.equal(rows[0].label, 'free');
        assert.equal(rows[0].priceVar, undefined);
    });
});

/**
 * revelation.js — Révélation Progressive
 *
 * Fragmente une valeur numérique sur deux canaux : la partie ENTIÈRE reste dans le
 * JSON, la partie DÉCIMALE (centièmes) part dans une variable CSS que seul un
 * navigateur appliquera. Un extracteur qui lit le JSON brut n'obtient que l'entier ;
 * pour reconstituer la valeur exacte il doit exécuter le CSS + connaître l'algorithme
 * d'assemblage (client/assembler.js : base + var/100).
 *
 * LIMITE HONNÊTE : si la feuille de style voyage dans la même réponse HTTP, un
 * adversaire déterminé peut tout recombiner. Ce n'est pas un secret cryptographique —
 * c'est une friction qui neutralise les extracteurs JSON naïfs et augmente le coût des
 * autres. La vraie barrière reste le gate (un client sans navigateur n'arrive jamais ici).
 */

// Fragmente une valeur numérique unique. Renvoie la base (entier), les centièmes,
// le nom de variable CSS et la déclaration CSS correspondante.
function fragmentValue(value, varName) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { base: value, cents: 0, varName: null, cssRule: '' };
    }
    const base  = Math.floor(value);
    const cents = Math.round((value - base) * 100);
    const name  = varName || '--pr-v';
    return { base, cents, varName: name, cssRule: `${name}:${cents}` };
}

// Fragmente le champ numérique `field` sur un jeu de lignes.
// Renvoie { rows, styles } :
//   - rows  : chaque ligne a `field` = partie entière, et `${field}Var` = nom de variable CSS
//   - styles: une règle `:root{ --pr-...:NN; ... }` à injecter dans un <style> côté client
// Le client reconstitue : valeur = row[field] + getComputedStyle(:root)[row[field+'Var']] / 100
function fragmentField(rows, field, prefix = 'pr') {
    if (!Array.isArray(rows)) return { rows: rows ? [rows] : [], styles: '' };
    const decls = [];
    const out = rows.map((row, i) => {
        if (!row || typeof row[field] !== 'number') return row;
        const varName = `--${prefix}-${field}-${i}`;
        const { base, cents } = fragmentValue(row[field], varName);
        decls.push(`${varName}:${cents}`);
        return { ...row, [field]: base, [`${field}Var`]: varName };
    });
    return { rows: out, styles: decls.length ? `:root{${decls.join(';')}}` : '' };
}

module.exports = {
    fragmentValue,
    fragmentField,
};

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { createCursor } = require('ghost-cursor');

puppeteer.use(StealthPlugin());

const TARGET_URL = 'http://localhost:3000';

const delay = ms => new Promise(res => setTimeout(res, ms));

const profiles = [
    { name: "Bot 1: Basique (Sans Stealth, Sans Mouvement)", stealth: false, ghostCursor: false },
    { name: "Bot 2: Stealth Basique (Sans Mouvement)", stealth: true, ghostCursor: false },
    { name: "Bot 3: Stealth + Mouvements robotiques (linéaires)", stealth: true, ghostCursor: false, linearMouse: true },
    { name: "Bot 4: Stealth Avancé + Ghost Cursor (Comportement 100% Humain)", stealth: true, ghostCursor: true },
    { name: "Bot 5: Stealth Avancé + Ghost Cursor + Frappes clavier", stealth: true, ghostCursor: true, keystrokes: true },
    { name: "Bot 6: Stealth + Ghost Cursor (Lent et Hésitant)", stealth: true, ghostCursor: true, hesitant: true },
    { name: "Bot 7: Stealth + Ghost Cursor + Scroll agressif", stealth: true, ghostCursor: true, scrollAggressive: true },
    { name: "Bot 8: Stealth + Ghost Cursor + Mobile Viewport", stealth: true, ghostCursor: true, mobile: true },
    { name: "Bot 9: Stealth + Ghost Cursor (Très rapide)", stealth: true, ghostCursor: true, fast: true },
    { name: "Bot 10: Stealth + Ghost Cursor + Clics aléatoires", stealth: true, ghostCursor: true, randomClicks: true }
];

async function runBot(profile, index) {
    console.log(`\n[+] Lancement ${profile.name}...`);
    
    // Si stealth est désactivé, on utilise puppeteer standard
    const browserLauncher = profile.stealth ? puppeteer : require('puppeteer');

    const browser = await browserLauncher.launch({
        headless: "new", // Headless mode
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    const page = await browser.newPage();
    
    if (profile.mobile) {
        await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
        await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');
    } else {
        await page.setViewport({ width: 1280, height: 800 });
    }

    let cursor = null;
    if (profile.ghostCursor) {
        cursor = createCursor(page);
    }

    let verificationStatus = "TIMED_OUT";
    let verificationScore = 0;

    // Intercepter la requête de validation en arrière-plan
    page.on('response', async (response) => {
        if (response.url().includes('/api/verify-challenge')) {
            try {
                const status = response.status();
                if (status === 200) {
                    const data = await response.json();
                    verificationStatus = "PASSED";
                    verificationScore = data.score;
                } else if (status === 403) {
                    verificationStatus = "BLOCKED (403)";
                } else {
                    verificationStatus = `ERROR (${status})`;
                }
            } catch (e) {
                verificationStatus = "PARSE_ERROR";
            }
        }
    });

    try {
        await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 15000 });

        // Simuler le comportement
        if (profile.ghostCursor && cursor) {
            if (profile.hesitant) {
                await cursor.moveTo({ x: 100, y: 100 });
                await delay(1000);
                await cursor.moveTo({ x: 200, y: 250 });
                await delay(2000);
            } else if (profile.fast) {
                await cursor.moveTo({ x: 500, y: 500 });
                await cursor.moveTo({ x: 800, y: 100 });
            } else {
                await cursor.moveTo({ x: 300, y: 300 });
                await cursor.click('a'); // click on a random link or just move
            }

            if (profile.keystrokes) {
                await page.keyboard.press('Tab');
                await delay(200);
                await page.keyboard.press('ArrowDown');
            }

            if (profile.scrollAggressive) {
                for (let i = 0; i < 5; i++) {
                    await page.mouse.wheel({ deltaY: 500 });
                    await delay(100);
                }
            }
            
            if (profile.randomClicks) {
                await cursor.click();
                await delay(500);
                await cursor.click();
            }
            
            // Bouger un peu aléatoirement pour générer des events pointermove
            await cursor.moveTo({ x: 400, y: 400 });
            await delay(500);
            await cursor.moveTo({ x: 600, y: 500 });
            
        } else if (profile.linearMouse) {
            // Mouvement robotique : ligne droite parfaite, vitesse constante
            for (let i = 0; i < 50; i++) {
                await page.mouse.move(100 + i * 10, 100 + i * 5, { steps: 1 });
                await delay(20);
            }
        } else {
            // Pas de mouvement, juste attendre
            await delay(2000);
        }

        // Attendre que la validation asynchrone ait le temps de finir (challenge argon2 prend ~2-3 sec)
        await delay(5000);

    } catch (e) {
        console.error(`Erreur sur le bot ${index+1}:`, e.message);
    } finally {
        await browser.close();
        console.log(`[=] Résultat ${profile.name} : ${verificationStatus} (Score estimé: ${verificationScore})`);
        return { name: profile.name, status: verificationStatus, score: verificationScore };
    }
}

async function start() {
    console.log("=== DÉBUT DU TEST DE PÉNÉTRATION DES 10 AGENTS ===");
    const results = [];
    
    // On lance séquentiellement pour ne pas surcharger le serveur ou se faire ban IP
    for (let i = 0; i < profiles.length; i++) {
        const res = await runBot(profiles[i], i);
        results.push(res);
        await delay(2000); // Pause entre les bots
    }

    console.log("\n\n=== RAPPORT FINAL ===");
    results.forEach((r, i) => {
        const icon = r.status.includes('BLOCKED') ? '🔴' : (r.status === 'PASSED' ? '🟢' : '🟡');
        console.log(`${icon} Agent ${i+1}: ${r.name}`);
        console.log(`    Statut: ${r.status} | Score Prisme: ${r.score}`);
    });
}

start();

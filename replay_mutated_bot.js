const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

// Trajectoire volée à une vraie session humaine
const HUMAN_TRAJECTORY = [
  {x: 820, y: 340, t: 100}, {x: 825, y: 345, t: 115}, {x: 832, y: 352, t: 130},
  {x: 840, y: 360, t: 147}, {x: 851, y: 369, t: 165}, {x: 865, y: 382, t: 180},
  {x: 878, y: 395, t: 198}, {x: 890, y: 410, t: 215}, {x: 905, y: 425, t: 232},
  {x: 915, y: 438, t: 250}, {x: 928, y: 452, t: 265}, {x: 935, y: 460, t: 280},
  {x: 940, y: 465, t: 295}, {x: 943, y: 468, t: 310}, {x: 945, y: 470, t: 325}
];

(async () => {
    console.log("Lancement de l'attaque Ultime (Rejeu Muté)...");
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    
    await page.goto('https://antibotsite.onrender.com/', { waitUntil: 'networkidle2' });
    
    console.log("Attente de la Gateway...");
    await new Promise(r => setTimeout(r, 3000));
    
    console.log("Génération d'une mutation cryptographique de la trajectoire humaine...");
    
    await page.evaluate((traj) => {
        const startTime = Date.now();
        // On joue les mouvements avec un offset aléatoire pour briser le hash de l'Anti-Rejeu
        const offsetX = Math.floor(Math.random() * 50);
        const offsetY = Math.floor(Math.random() * 50);
        
        traj.forEach((pt, i) => {
            setTimeout(() => {
                document.dispatchEvent(new PointerEvent('mousemove', {
                    clientX: pt.x + offsetX, clientY: pt.y + offsetY, pointerType: 'mouse', isTrusted: true
                }));
                // Au dernier point, on clique
                if (i === traj.length - 1) {
                    document.dispatchEvent(new PointerEvent('pointerdown', {
                        clientX: pt.x + offsetX, clientY: pt.y + offsetY, pointerType: 'mouse', pressure: 0.5, width: 1, height: 1
                    }));
                }
            }, pt.t);
        });
    }, HUMAN_TRAJECTORY);
    
    await new Promise(r => setTimeout(r, 4000));
    
    console.log("Capture d'écran...");
    await page.screenshot({ path: 'mutated_bot_screenshot.png', fullPage: true });
    
    const apiData = await page.evaluate(() => {
        const rows = document.querySelectorAll('#prism-table-body tr');
        let data = [];
        rows.forEach(r => {
            data.push(r.innerText.replace(/\t/g, ' | '));
        });
        return data;
    });
    
    console.log("Données lues dans le tableau par le bot :");
    console.log(apiData);
    
    console.log("Terminé ! Capture sauvegardée sous mutated_bot_screenshot.png");
    await browser.close();
})();

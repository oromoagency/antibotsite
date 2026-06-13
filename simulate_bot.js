const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
    console.log("Lancement du bot stealth...");
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    console.log("Visite du site...");
    try {
        await page.goto('https://antibotsite.onrender.com/', { waitUntil: 'networkidle2' });
    } catch(e) {
        console.log("Timeout ou erreur navigation", e);
    }

    console.log("Attente de la Gateway (8s)...");
    await new Promise(r => setTimeout(r, 8000));

    // Mouvement pour révéler la landing page (enlever l'overlay opaque)
    console.log("Mouvement de souris...");
    await page.mouse.move(100, 100);
    await page.mouse.move(200, 200);
    await page.mouse.move(300, 300);
    await new Promise(r => setTimeout(r, 1000));

    // Scroll vers le bas pour voir le tableau des stats Prism
    console.log("Scroll vers le bas pour voir les stats...");
    await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
    
    // Attendre 3 secondes pour que les données API chargent et le rendering se fasse
    await new Promise(r => setTimeout(r, 3000));

    console.log("Capture d'écran...");
    const path = "C:\\Users\\sanog\\.gemini\\antigravity\\brain\\d87d182e-b738-48eb-9c4c-73b252d5aad1\\scratch\\bot_screenshot.png";
    await page.screenshot({ path, fullPage: true });

    await browser.close();
    console.log("Terminé ! Capture sauvegardée.");
})();

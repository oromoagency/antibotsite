const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { createCursor } = require('ghost-cursor');

puppeteer.use(StealthPlugin());

(async () => {
    console.log("Lancement de l'agent 100% humain (Stealth + Bézier)...");
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    
    // Ghost-cursor pour simuler une souris humaine parfaite (courbes de Bézier)
    const cursor = createCursor(page);

    await page.goto('https://antibotsite.onrender.com/', { waitUntil: 'networkidle2' });
    
    console.log("Attente de la Gateway...");
    await new Promise(r => setTimeout(r, 4000));
    
    console.log("Génération de mouvements de souris humains (Bézier)...");
    // Mouvement complexe avec ghost-cursor
    await cursor.moveTo({ x: 100, y: 100 });
    await cursor.moveTo({ x: 400, y: 300 });
    await cursor.click();
    await cursor.moveTo({ x: 500, y: 800 });
    
    await new Promise(r => setTimeout(r, 2000));
    
    console.log("Capture d'écran...");
    await page.screenshot({ path: 'human_bot_screenshot.png', fullPage: true });
    
    // On récupère aussi les données API que le bot "voit" dans son DOM
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
    
    console.log("Terminé ! Capture sauvegardée sous human_bot_screenshot.png");
    await browser.close();
})();

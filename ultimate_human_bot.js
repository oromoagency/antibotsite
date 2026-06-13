const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

(async () => {
    console.log("Lancement de l'agent Ultime (Injection Biométrique)...");
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    
    await page.goto('https://antibotsite.onrender.com/', { waitUntil: 'networkidle2' });
    
    console.log("Attente de la Gateway...");
    await new Promise(r => setTimeout(r, 4000));
    
    console.log("Injection de fausse biométrie parfaite via JS...");
    await page.evaluate(() => {
        // Génération d'une trajectoire avec accélération et courbes
        const points = [];
        let cx = 100, cy = 100;
        let time = Date.now();
        for (let i = 0; i < 30; i++) {
            // Courbe sinusoïdale + vitesse variable
            cx += 10 + Math.random() * 5 + Math.sin(i * 0.5) * 15;
            cy += 5 + Math.random() * 5 + Math.cos(i * 0.5) * 10;
            time += 20 + Math.random() * 20; // dt entre 20 et 40ms
            points.push({ x: cx, y: cy, t: time });
        }
        
        // Dispatch des MouseMoves
        points.forEach(pt => {
            document.dispatchEvent(new PointerEvent('mousemove', {
                clientX: pt.x, clientY: pt.y, pointerType: 'mouse'
            }));
        });
        
        // Dispatch d'un clic parfait
        document.dispatchEvent(new PointerEvent('pointerdown', {
            clientX: cx, clientY: cy,
            pointerType: 'mouse',
            pressure: 0.5,
            width: 1, height: 1
        }));
        
        document.dispatchEvent(new PointerEvent('pointerup', {
            clientX: cx, clientY: cy,
            pointerType: 'mouse',
            pressure: 0,
            width: 1, height: 1
        }));
        
        // Dispatch de frappes clavier humaines (variées)
        const keys = ['h', 'e', 'l', 'l', 'o'];
        keys.forEach(k => {
            const dwell = 40 + Math.random() * 40;
            document.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
            // On retarde le keyup (virtuellement)
            setTimeout(() => {
                document.dispatchEvent(new KeyboardEvent('keyup', { key: k }));
            }, dwell);
        });
    });
    
    await new Promise(r => setTimeout(r, 3000));
    
    console.log("Capture d'écran...");
    await page.screenshot({ path: 'ultimate_bot_screenshot.png', fullPage: true });
    
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
    
    console.log("Terminé ! Capture sauvegardée sous ultimate_bot_screenshot.png");
    await browser.close();
})();

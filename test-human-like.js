const puppeteer = require('puppeteer');

(async () => {
    console.log('Lancement du navigateur robot...');
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();

    console.log('Navigation vers la Gateway...');
    // Ne pas attendre idle, pour pouvoir bouger la souris pendant le chargement
    page.goto('https://antibotsite.onrender.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});

    console.log('Génération de mouvements de souris "humains"...');
    // On bouge la souris de manière répétée pour feindre l'humanité
    for (let i = 0; i < 20; i++) {
        await page.mouse.move(100 + i * 10, 200 + Math.sin(i) * 20, { steps: 5 });
        await new Promise(r => setTimeout(r, 20));
    }

    // On attend 2 secondes pour laisser le redirect se faire si on est bloqué
    console.log('Attente du verdict du serveur...');
    await new Promise(r => setTimeout(r, 2000));

    const url = page.url();
    console.log('URL finale :', url);
    if (url.includes('google')) {
        console.log('❌ ÉCHEC : Le bot a été éjecté malgré ses mouvements de souris.');
    } else {
        console.log('✅ SUCCÈS : Le bot a bypassé la Gateway !');
    }
    
    await browser.close();
})();

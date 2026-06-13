const puppeteer = require('puppeteer');

(async () => {
    console.log('🔥 Initialisation de l\'agent d\'attaque ultime...');
    // Lancement de Puppeteer en mode furtif maximum (sans plugin externe)
    const browser = await puppeteer.launch({ 
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled', // Tente de cacher webdriver au niveau C++
            '--disable-features=IsolateOrigins,site-per-process', 
        ]
    });
    
    const page = await browser.newPage();
    
    // Faux profil 100% réaliste
    const REAL_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
    await page.setUserAgent(REAL_UA);

    // Injection de scripts avant le chargement de la page pour cacher les traces
    await page.evaluateOnNewDocument(() => {
        // 1. Cacher webdriver
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        
        // 2. Falsifier l'écran pour L4_Hardware
        window.devicePixelRatio = 2; // Écran Retina
        const originalMatchMedia = window.matchMedia;
        window.matchMedia = function(query) {
            if (query === '(pointer: fine)') return { matches: true };
            if (query === '(pointer: coarse)') return { matches: false };
            if (query === '(pointer: none)') return { matches: false };
            return originalMatchMedia.call(window, query);
        };
    });

    // Interception de requêtes pour MODIFIER LE PAYLOAD envoyé au serveur !
    // C'est l'attaque la plus puissante : on laisse le PoW se calculer, puis on nettoie nos traces.
    await page.setRequestInterception(true);
    page.on('request', interceptedRequest => {
        if (interceptedRequest.url().includes('/api/verify-challenge') && interceptedRequest.method() === 'POST') {
            console.log('⚔️ Interception de la requête de vérification ! Falsification en cours...');
            try {
                let data = JSON.parse(interceptedRequest.postData());
                
                // Le bot réalise que les données sont maintenant dans boundPayload !
                if (data.boundPayload) {
                    let bound = JSON.parse(data.boundPayload);
                    
                    bound.automation.webdriver = false;
                    bound.hardware.webgl.vendor = 'Apple Inc.';
                    bound.hardware.webgl.renderer = 'Apple M2';
                    bound.hardware.renderTimeMs = 1.1;
                    
                    data.boundPayload = JSON.stringify(bound);
                } else {
                    data.automation = { webdriver: false };
                    data.hardware = { webgl: { vendor: 'Apple Inc.', renderer: 'Apple M2' }, renderTimeMs: 1.1 };
                }
                
                interceptedRequest.continue({
                    postData: JSON.stringify(data)
                });
                console.log('💉 Payload falsifié (même avec boundPayload) envoyé avec succès !');
            } catch (e) {
                interceptedRequest.continue();
            }
        } else {
            interceptedRequest.continue();
        }
    });

    console.log('🚀 Navigation vers la cible...');
    page.goto('https://antibotsite.onrender.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});

    // Mouvements de souris lents et erratiques (pour L6_Biometrics)
    console.log('👤 Simulation de mouvements humains lents...');
    for (let i = 0; i < 30; i++) {
        await page.mouse.move(200 + Math.random() * 50, 300 + Math.random() * 50, { steps: 2 });
        await new Promise(r => setTimeout(r, 50));
    }

    // Attente du verdict du serveur (jusqu'à 10s pour être large)
    console.log('⏳ Attente du verdict de Prisme...');
    await new Promise(r => setTimeout(r, 10000));

    const finalUrl = page.url();
    console.log('\n================================');
    console.log('URL Finale :', finalUrl);
    if (finalUrl.includes('google')) {
        console.log('❌ ÉCHEC TOTAL : Prisme a détecté l\'attaque malgré la falsification extrême !');
        await page.screenshot({ path: 'bypass-proof.png' });
    } else {
        console.log('✅ BYPASS RÉUSSI : Le bot a vaincu le système.');
        await page.screenshot({ path: 'bypass-proof.png' });
    }
    console.log('================================\n');

    await browser.close();
})();

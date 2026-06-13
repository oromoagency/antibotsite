const puppeteer = require('puppeteer');

const AGENTS = [
    { id: 1, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    { id: 2, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15' },
    { id: 3, ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/115.0' },
    { id: 4, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0' },
    { id: 5, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36' },
];

async function runAgent(agent) {
    let browser;
    try {
        browser = await puppeteer.launch({ headless: 'new' });
        const page = await browser.newPage();
        await page.setUserAgent(agent.ua);
        
        console.log(`[Agent ${agent.id}] Lancement avec UA: ${agent.ua.split(' ')[0]}...`);
        
        page.goto('https://antibotsite.onrender.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
        
        for (let i = 0; i < 20; i++) {
            await page.mouse.move(100 + i * 15, 200 + Math.cos(i) * 30, { steps: 5 });
            await new Promise(r => setTimeout(r, 30));
        }
        
        // Attendre le redirect potentiel (Gateway peut être lent sous charge CPU)
        await new Promise(r => setTimeout(r, 15000));
        
        const url = page.url();
        const success = !url.includes('google');
        
        await browser.close();
        
        return {
            id: agent.id,
            status: success ? '✅ BYPASS RÉUSSI' : '❌ BLOQUÉ (403)',
            finalUrl: url
        };
    } catch (e) {
        if (browser) await browser.close();
        return { id: agent.id, status: '⚠️ ERREUR CRASH', finalUrl: e.message };
    }
}

(async () => {
    console.log('🚀 Lancement de l\'audit : 5 agents simultanés...');
    console.log('==================================================');
    
    const promises = AGENTS.map(runAgent);
    const results = await Promise.all(promises);
    
    console.log('\n📊 RÉSULTATS DE L\'AUDIT');
    console.log('==================================================');
    results.forEach(r => {
        console.log(`Agent ${r.id} | Statut: ${r.status} | URL: ${r.finalUrl}`);
    });
    console.log('==================================================');
})();

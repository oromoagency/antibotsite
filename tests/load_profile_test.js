const puppeteer = require('puppeteer');
const http = require('http');

async function runTest() {
    console.log("🤖 Lancement de l'attaque simulée (Puppeteer Bot)...");

    const browser = await puppeteer.launch({ 
        headless: "new"
    });
    
    const page = await browser.newPage();
    
    console.log("🌐 Navigation vers le site protégé (http://localhost:3000)...");
    
    try {
        const response = await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
        
        console.log(`📡 Status Code HTTP reçu : ${response.status()}`);
        
        // On attend 5 secondes pour voir si le script JS de la page (Proof of Work) s'exécute 
        // et réussit à nous rediriger
        console.log("⏳ Attente de 5 secondes pour laisser le sas agir...");
        await new Promise(r => setTimeout(r, 5000));
        
        const pageTitle = await page.title();
        const pageContent = await page.content();
        
        console.log(`\n📄 Titre de la page actuelle : ${pageTitle}`);
        
        if (pageContent.includes("Acces Autorise")) {
            console.log("❌ ÉCHEC SÉCURITÉ : Le bot a réussi à passer le Sas et voir le sanctuaire !");
        } else if (pageTitle.includes("Vérification")) {
            console.log("✅ SUCCÈS SÉCURITÉ : Le bot est resté bloqué dans le sas de vérification.");
            
            // Analysons pourquoi le bot est bloqué.
            // On peut faire une requête directe à l'API pour voir le message de rejet
            console.log("\n🕵️ Test d'attaque directe sur l'API (/api/verify-challenge)...");
            
            const apiResult = await page.evaluate(async () => {
                const res = await fetch('/api/verify-challenge', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        nonce: "1234",
                        timestamp: Date.now(),
                        fingerprint: { isBot: true }, // Headless typique
                        interactionProof: false // Le bot ne bouge pas la souris
                    })
                });
                return { status: res.status, text: await res.text() };
            });
            
            console.log(`🛡️ Réponse du serveur à l'API : ${apiResult.status} - ${apiResult.text}`);
            
        } else {
             console.log("❓ Résultat inconnu. La page a peut-être planté.");
        }

    } catch (error) {
        console.error("💥 Erreur pendant l'attaque :", error.message);
    } finally {
        await browser.close();
    }
}

runTest();

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    const result = await page.evaluate(() => {
        let leak = false;
        try {
            const d = Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver');
            d.get.call(undefined);
            leak = true; // S'il ne throw pas d'erreur, c'est un mock !
        } catch (e) {
            leak = e.message.includes('Illegal invocation') ? false : true;
        }
        return leak;
    });
    console.log("Stealth plugin leak detected:", result);
    await browser.close();
})();

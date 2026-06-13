const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    const result = await page.evaluate(() => {
        return {
            onNavigator: !!Object.getOwnPropertyDescriptor(navigator, 'webdriver'),
            onPrototype: !!Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver'),
            // another flaw: Permissions.prototype.query.toString()
            permissionsMock: Function.prototype.toString.call(Permissions.prototype.query).includes('[native code]'),
            permissionsName: Permissions.prototype.query.name
        };
    });
    console.log(result);
    await browser.close();
})();

const { chromium } = require('playwright');
const http = require('http');
const handler = require('serve-handler');

const server = http.createServer((request, response) => {
  return handler(request, response, { public: '/Users/josephmt/Documents/app_inventario_juan/src' });
});

server.listen(3008, async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    await page.goto('http://localhost:3008/index.html');
    await page.waitForTimeout(1000); 
    
    // Check initial height of app-container
    let initialH = await page.evaluate(() => document.getElementById('app-container').getBoundingClientRect().height);
    console.log("Initial height:", initialH);
    
    // Zoom to 120%
    await page.evaluate(() => document.body.style.zoom = '1.2');
    
    // Wait for layout
    await page.waitForTimeout(100);
    
    let nativeZoomH = await page.evaluate(() => document.getElementById('app-container').getBoundingClientRect().height);
    console.log("Height with pure native zoom:", nativeZoomH);
    
    // Apply the developer's hack
    await page.evaluate(() => {
        document.documentElement.style.height = `calc(100vh / 1.2)`;
        document.body.style.height = `calc(100vh / 1.2)`;
    });
    
    await page.waitForTimeout(100);
    let hackedH = await page.evaluate(() => document.getElementById('app-container').getBoundingClientRect().height);
    console.log("Height with hacked zoom:", hackedH);
    
    await browser.close();
    server.close();
});

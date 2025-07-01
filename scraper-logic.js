// scraper-logic.js
const { Pool } = require('pg');
const puppeteer = require('puppeteer');

const scrapeAndSave = async () => {
    console.log("Kazıma işlemi başlıyor...");
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
    });
    let browser = null;
    try {
        browser = await puppeteer.launch({ 
            headless: true, 
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--single-process'
            ] 
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');

        await page.goto('https://eksisozluk.com/debe', { waitUntil: 'networkidle2', timeout: 120000 });
        
        const entryLinks = await page.evaluate(() => {
            const items = [];
            document.querySelectorAll('ul.topic-list li a').forEach(el => items.push({ title: el.innerText.trim(), link: el.href }));
            return items;
        });

        const finalDebeList = [];
        for (const entry of entryLinks) {
            console.log(`İçerik çekiliyor: ${entry.title}`);
            await page.goto(entry.link, { waitUntil: 'networkidle2', timeout: 120000 });
            const entryContent = await page.evaluate(() => document.querySelector('div.content')?.innerHTML.trim() || "İçerik bulunamadı.");
            finalDebeList.push({ ...entry, content: entryContent });
        }

        const today = new Date().toISOString().split('T')[0];
        const insertSql = `
            INSERT INTO debes (date, content) VALUES ($1, $2)
            ON CONFLICT (date) DO UPDATE SET content = EXCLUDED.content;
        `;
        const contentString = JSON.stringify(finalDebeList);
        await pool.query(insertSql, [today, contentString]);
        
        console.log(`Yeni veri (${today}) başarıyla veritabanına kaydedildi.`);
        return { success: true, message: `Başarıyla ${finalDebeList.length} entry kaydedildi.` };
    } catch (error) {
        console.error("Kazıma sırasında hata oluştu:", error);
        return { success: false, message: "Kazıma sırasında bir hata oluştu." };
    } finally {
        if (browser) await browser.close();
        await pool.end();
        console.log("Kazıma işlemi ve veritabanı bağlantısı sonlandırıldı.");
    }
};

module.exports = { scrapeAndSave };

// scraper-logic.js
require('dotenv').config();

// Bu, artık bizim tek ana kazıyıcı fonksiyonumuz olacak.
const runScrapeProcess = async () => {
    // Ortamın production olup olmadığını ve debug modunu kontrol et
    const isProduction = process.env.NODE_ENV === 'production';
    const isDebugMode = process.env.DEBUG_MODE === 'true';
    
    let puppeteer;
    let launchOptions;

    // Ortama göre doğru kütüphaneleri ve ayarları seç
    if (isProduction) {
        // CANLI ORTAM (RENDER) İÇİN AYARLAR
        console.log("Canlı ortam (production) algılandı. @sparticuz/chromium kullanılıyor.");
        const chromium = (await import('@sparticuz/chromium')).default;
        puppeteer = (await import('puppeteer-core')).default;
        
        launchOptions = {
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless, // Canlıda her zaman gizli mod
        };
    } else {
        // LOKAL ORTAM (SENİN BİLGİSAYARIN) İÇİN AYARLAR
        console.log("Lokal ortam (development) algılandı. Standart puppeteer kullanılıyor.");
        puppeteer = (await import('puppeteer')).default;
        
        launchOptions = {
            headless: !isDebugMode, // Debug modu true ise, headless false olur (tarayıcı görünür)
        };
        if(isDebugMode) console.log("DEBUG MODU AKTİF: Tarayıcı görünür olacak.");
    }
        
    const today = new Date().toISOString().split('T')[0];
    console.log(`Akıllı kazıma işlemi başlıyor: ${today}`);
    
    const { Pool } = require('pg');
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: isProduction ? { rejectUnauthorized: false } : false,
    });

    try {
        const checkSql = 'SELECT COUNT(*) FROM debes WHERE date = $1';
        const { rows } = await pool.query(checkSql, [today]);
        const linkCount = parseInt(rows[0].count, 10);

        if (linkCount === 0) {
            console.log(`Bugün (${today}) için link bulunamadı. Faz 1 (Link Kazıma) başlıyor...`);
            let browser = null;
            try {
                browser = await puppeteer.launch(launchOptions);
                const page = await browser.newPage();

                // --- EKLENEN OPTİMİZASYON SATIRLARI ---
                await page.setViewport({ width: 1920, height: 1080 });
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');

                await page.goto('https://eksisozluk.com/debe', { waitUntil: 'networkidle2', timeout: 120000 });
                
                const entryLinks = await page.evaluate(() =>
                    Array.from(document.querySelectorAll('ul.topic-list li a')).map((el, index) => ({
                        title: el.innerText.trim(),
                        link: el.href,
                        order: index + 1
                    }))
                );

                if (entryLinks.length > 0) {
                    const client = await pool.connect();
                    try {
                        await client.query('BEGIN');
                        const insertSql = `INSERT INTO debes (date, "entryOrder", title, link) VALUES ($1, $2, $3, $4) ON CONFLICT (link) DO NOTHING;`;
                        for (const entry of entryLinks) {
                            await client.query(insertSql, [today, entry.order, entry.title, entry.link]);
                        }
                        await client.query('COMMIT');
                        console.log(`Faz 1 tamamlandı: ${entryLinks.length} adet link veritabanına eklendi.`);
                    } catch (e) {
                        await client.query('ROLLBACK');
                        throw e;
                    } finally {
                        client.release();
                    }
                }
            } finally {
                if (browser) await browser.close();
            }
        } else {
            console.log(`Bugün (${today}) için ${linkCount} link zaten mevcut. Faz 1 atlanıyor.`);
        }

        console.log("Faz 2 (İçerik Doldurma) başlıyor...");
        let browser = null;
        try {
            const selectSql = `SELECT link, title FROM debes WHERE date = $1 AND content IS NULL ORDER BY "entryOrder" ASC LIMIT $2`;
            const { rows: entriesToProcess } = await pool.query(selectSql, [today, 15]);

            if (entriesToProcess.length === 0) {
                console.log("İçeriği doldurulacak yeni kayıt bulunamadı. İşlem tamamlandı.");
                return;
            }
            
            console.log(`${entriesToProcess.length} adet entry'nin içeriği doldurulacak.`);
            
            browser = await puppeteer.launch(launchOptions);
            const page = await browser.newPage();
            
            // --- EKLENEN OPTİMİZASYON SATIRLARI ---
            await page.setViewport({ width: 1920, height: 1080 });
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
            
            for (const entry of entriesToProcess) {
                 console.log(`İçerik çekiliyor: ${entry.title}`);
                 try {
                    await page.goto(entry.link, { waitUntil: 'networkidle2', timeout: 120000 });
                    await page.waitForSelector('div.content', { timeout: 10000 });
                    
                    const entryContent = await page.evaluate(() => {
                        const element = document.querySelector('div.content');
                        return element ? element.innerHTML.trim() : "İçerik elementi evaluate içinde bulunamadı.";
                    });

                    const updateSql = `UPDATE debes SET content = $1 WHERE link = $2`;
                    await pool.query(updateSql, [entryContent, entry.link]);
                    console.log(`'${entry.title}' içeriği başarıyla güncellendi.`);
                 } catch(e) {
                     console.error(`HATA: '${entry.title}' içeriği çekilemedi. Hata: ${e.message}`);
                 }
            }
        } finally {
            if (browser) await browser.close();
        }
        
    } catch (error) {
        console.error("Akıllı kazıma işlemi sırasında genel bir hata oluştu:", error);
    } finally {
        await pool.end();
        console.log("Akıllı kazıma işlemi ve veritabanı bağlantısı sonlandırıldı.");
    }
};

module.exports = { runScrapeProcess };


// scraper-logic.js
const BATCH_SIZE = 15;

const launchBrowser = async () => {
    const chromium = (await import('@sparticuz/chromium')).default;
    const puppeteer = (await import('puppeteer-core')).default;
    return puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
    });
};

// Bu, artık bizim tek ana kazıyıcı fonksiyonumuz olacak.
const runScrapeProcess = async () => {
    const today = new Date().toISOString().split('T')[0];
    console.log(`Akıllı kazıma işlemi başlıyor: ${today}`);
    
    const { Pool } = require('pg');
    const isProduction = process.env.NODE_ENV === 'production';
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: isProduction ? { rejectUnauthorized: false } : false,
        family: 4, // IPv4 kullan
    });

    try {
        // --- ADIM 1: VERİTABANINI KONTROL ET ---
        const checkSql = 'SELECT COUNT(*) FROM debes WHERE date = $1';
        const { rows } = await pool.query(checkSql, [today]);
        const linkCount = parseInt(rows[0].count, 10);

        // --- ADIM 2: EĞER LİNK YOKSA, LİNKLERİ ÇEK (FAZ 1) ---
        if (linkCount === 0) {
            console.log(`Bugün (${today}) için link bulunamadı. Faz 1 (Link Kazıma) başlıyor...`);
            let browser = null;
            try {
                browser = await launchBrowser();
                const page = await browser.newPage();
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

        // --- ADIM 3: İÇERİĞİ BOŞ OLANLARI DOLDUR (FAZ 2) ---
        console.log("Faz 2 (İçerik Doldurma) başlıyor...");
        let browser = null;
        try {
            // DÜZELTME: LIMIT için $1 yerine $2 kullanıldı.
            const selectSql = `SELECT link, title FROM debes WHERE date = $1 AND content IS NULL ORDER BY "entryOrder" ASC LIMIT $2`;
            // DÜZELTME: pool.query'ye BATCH_SIZE parametresi eklendi.
            const { rows: entriesToProcess } = await pool.query(selectSql, [today, BATCH_SIZE]);

            if (entriesToProcess.length === 0) {
                console.log("İçeriği doldurulacak yeni kayıt bulunamadı. İşlem tamamlandı.");
                return;
            }
            
            console.log(`${entriesToProcess.length} adet entry'nin içeriği doldurulacak.`);
            
            browser = await launchBrowser();
            const page = await browser.newPage();
            
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


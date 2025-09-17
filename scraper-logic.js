
const BATCH_SIZE = 15; // Her tetiklendiğinde işlenecek içerik sayısı

// Tarayıcıyı başlatmak için bir yardımcı fonksiyon
const launchBrowser = async () => {
    const chromium = (await import('@sparticuz/chromium')).default;
    const puppeteer = (await import('puppeteer-core')).default;
    return puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
        family: 4,  // IPv4 kullan
    });
};

// Faz 1: Sadece linkleri çeker ve veritabanına boş kayıtlar olarak ekler
const scrapeLinks = async () => {
    console.log("Faz 1: Link kazıma işlemi başlıyor...");
    const { Pool } = require('pg');
    const isProduction = process.env.NODE_ENV === 'production';
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: isProduction ? { rejectUnauthorized: false } : false,
    });

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

        if (entryLinks.length === 0) {
            throw new Error("Hiçbir link bulunamadı. Ekşi Sözlük HTML yapısı değişmiş olabilir.");
        }

        const today = new Date().toISOString().split('T')[0];
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // O güne ait eski kayıtları (varsa) temizle
            await client.query('DELETE FROM debes WHERE date = $1', [today]);
            
            const insertSql = `
                INSERT INTO debes (date, "entryOrder", title, link)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (link) DO NOTHING;
            `;
            for (const entry of entryLinks) {
                await client.query(insertSql, [today, entry.order, entry.title, entry.link]);
            }
            await client.query('COMMIT');
            console.log(`Faz 1 tamamlandı: ${entryLinks.length} adet link veritabanına eklendi.`);
            return { success: true };
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error("Faz 1 (Link Kazıma) sırasında hata oluştu:", error);
        return { success: false };
    } finally {
        if (browser) await browser.close();
        await pool.end();
    }
};

// Faz 2: İçerik alanı boş olan kayıtları çeker ve doldurur
const scrapeContent = async () => {
    console.log("Faz 2: İçerik doldurma işlemi başlıyor...");
     const { Pool } = require('pg');
    const isProduction = process.env.NODE_ENV === 'production';
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: isProduction ? { rejectUnauthorized: false } : false,
    });
    
    let browser = null;
    try {
        const selectSql = `SELECT link, title FROM debes WHERE content IS NULL ORDER BY "entryOrder" ASC LIMIT $1`;
        const { rows: entriesToProcess } = await pool.query(selectSql, [BATCH_SIZE]);

        if (entriesToProcess.length === 0) {
            console.log("İçeriği doldurulacak yeni kayıt bulunamadı. İşlem tamamlandı.");
            return { success: true };
        }
        
        console.log(`${entriesToProcess.length} adet entry'nin içeriği doldurulacak.`);
        
        browser = await launchBrowser();
        const page = await browser.newPage();
        
        for (const entry of entriesToProcess) {
             console.log(`İçerik çekiliyor: ${entry.title}`);
             try {
                await page.goto(entry.link, { waitUntil: 'networkidle2', timeout: 120000 });
                const entryContent = await page.evaluate(() => document.querySelector('div.content')?.innerHTML.trim() || "İçerik bulunamadı.");
                
                const updateSql = `UPDATE debes SET content = $1 WHERE link = $2`;
                await pool.query(updateSql, [entryContent, entry.link]);
                console.log(`'${entry.title}' içeriği başarıyla güncellendi.`);
             } catch(e) {
                 console.error(`HATA: '${entry.title}' içeriği çekilemedi. Hata: ${e.message}`);
             }
        }
        console.log("Faz 2 (İçerik Doldurma) tamamlandı.");
        return { success: true };
    } catch (error) {
        console.error("Faz 2 (İçerik Doldurma) sırasında hata oluştu:", error);
        return { success: false };
    } finally {
        if (browser) await browser.close();
        await pool.end();
    }
};

module.exports = { scrapeLinks, scrapeContent };


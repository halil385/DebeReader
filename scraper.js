// scraper.js
// scraper.js
require('dotenv').config();

const BATCH_SIZE = 10; // Her döngüde kaç entry işleyeceğimizi belirler.

const sendPushNotification = async (pool, title, body) => {
    try {
        console.log("Bildirim gönderimi için tokenlar kontrol ediliyor...");
        
        // Veritabanından tokenları çek
        const { rows } = await pool.query("SELECT token FROM push_tokens");
        const tokens = rows.map(r => r.token).filter(t => t); // Boş olmayanları al

        if (tokens.length === 0) {
            console.log("Bildirim gönderilecek kayıtlı cihaz/token bulunamadı.");
            return;
        }

        console.log(`${tokens.length} adet cihaza bildirim hazırlanıyor...`);

        // Expo formatına uygun mesajları hazırla
        const messages = tokens.map(token => ({
            to: token,
            sound: 'default',
            title: title,
            body: body,
            data: { url: 'debereader://home' }, // Uygulama açılınca yönlendirme için
        }));

        // Expo API'ye gönder (Node.js 18+ native fetch kullanılır)
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Accept-encoding': 'gzip, deflate',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(messages),
        });

        const data = await response.json();
        console.log(`Bildirim Sonucu: ${data.data?.status || 'İşlem Tamamlandı'}`);
        
        // Hataları logla (varsa)
        if (data.errors) {
            console.error("Bildirim hataları:", JSON.stringify(data.errors));
        }

    } catch (error) {
        console.error("Bildirim gönderme işlemi sırasında hata:", error);
    }
};

const runScrapeProcess = async () => {
    // Bu betik doğrudan GitHub Actions'da çalışacağı için
    // her zaman 'production' ortamındadır.
    const isProduction = true; 
    
    // Gerekli kütüphaneleri dinamik olarak import et
    const { Pool } = require('pg');
    const chromium = (await import('@sparticuz/chromium')).default;
    const puppeteer = (await import('puppeteer-core')).default;

    const launchOptions = {
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
    };

    console.log(`GitHub Actions üzerinde kazıma işlemi başlıyor...`);
    const today = new Date().toISOString().split('T')[0];
    // Veritabanı bağlantısını GitHub Secrets'tan alacak
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: isProduction ? { rejectUnauthorized: false } : false,
    });
    
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS debes (
                id SERIAL PRIMARY KEY,
                date DATE NOT NULL,
                "entryOrder" INTEGER NOT NULL,
                title TEXT NOT NULL,
                link TEXT NOT NULL UNIQUE,
                content TEXT,
                createdAt TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // --- YENİ: Push Token tablosunu garantiye al ---
        await pool.query(`
            CREATE TABLE IF NOT EXISTS push_tokens (
                id SERIAL PRIMARY KEY,
                token TEXT UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // --- FAZ 1: Linkleri Çek (Eğer Gerekliyse) ---
        const checkSql = 'SELECT COUNT(*) FROM debes WHERE date = $1';
        const { rows } = await pool.query(checkSql, [today]);
        if (parseInt(rows[0].count, 10) === 0) {
            console.log(`Bugün (${today}) için link bulunamadı. Faz 1 (Link Kazıma) başlıyor...`);
            let browser = null;
            try {
                browser = await puppeteer.launch(launchOptions);
                const page = await browser.newPage();
                
                await page.setViewport({ width: 1920, height: 1080 });
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/5.0 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');

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
                        console.log(`Faz 1 tamamlandı: ${entryLinks.length} adet link eklendi.`);
                    } catch (e) { await client.query('ROLLBACK'); throw e; } 
                    finally { client.release(); }
                }
            } finally {
                if (browser) await browser.close();
            }
        } else {
             console.log(`Bugün (${today}) için linkler zaten mevcut. Faz 1 atlanıyor.`);
        }

        // --- FAZ 2: İçerikleri Döngü İçinde Doldur ---
        console.log("Faz 2 (İçerik Doldurma) başlıyor...");
        while (true) {
            const selectSql = `SELECT link, title FROM debes WHERE date = $1 AND content IS NULL ORDER BY "entryOrder" ASC LIMIT $2`;
            const { rows: entriesToProcess } = await pool.query(selectSql, [today, BATCH_SIZE]);

            if (entriesToProcess.length === 0) {
                console.log("İçeriği doldurulacak başka kayıt kalmadı. İşlem başarıyla tamamlandı.");

                // --- YENİ: Bildirim Gönderimi (İşlem bitince tetiklenir) ---
                // Sadece veriler o an tamamlandıysa (zaten önceden tamamlanmışsa tekrar atmasın diye kontrol eklenebilir ama GitHub Actions günde 1 çalıştığı için sorun olmaz)
                console.log("Kullanıcılara bildirim gönderiliyor...");
                await sendPushNotification(
                    pool, 
                    "Debe Reader", 
                    "Bugünün en beğenilen entryleri hazır! Okumak için tıkla."
                );
                
                break; // Döngüden çık
            }
            
            console.log(`Döngü başladı: ${entriesToProcess.length} adet entry işlenecek...`);
            let browser = null;
            try {
                browser = await puppeteer.launch(launchOptions);
                const page = await browser.newPage();

                await page.setViewport({ width: 1920, height: 1080 });
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/5.0 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');

                for (const entry of entriesToProcess) {
                     console.log(`- İçerik çekiliyor: ${entry.title}`);
                     try {
                        await page.goto(entry.link, { waitUntil: 'networkidle2', timeout: 120000 });
                        await page.waitForSelector('div.content', { timeout: 10000 });
                        const entryContent = await page.evaluate(() => document.querySelector('div.content')?.innerHTML.trim() || "İçerik bulunamadı.");
                        const updateSql = `UPDATE debes SET content = $1 WHERE link = $2`;
                        await pool.query(updateSql, [entryContent, entry.link]);
                     } catch(e) {
                         console.error(`-- HATA: '${entry.title}' çekilemedi. Hata: ${e.message}`);
                     }
                }
            } finally {
                if (browser) await browser.close();
                console.log("Döngü tamamlandı, tarayıcı kapatıldı.");
            }
        }
    } catch (error) {
        console.error("Akıllı kazıma işlemi sırasında genel bir hata oluştu:", error);
    } finally {
        await pool.end();
        console.log("Akıllı kazıma işlemi ve veritabanı bağlantısı sonlandırıldı.");
    }
};

runScrapeProcess();
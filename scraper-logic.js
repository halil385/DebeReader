// scraper-logic.js
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const scrapeAndSave = async (targetDate) => {
    // DİNAMİK IMPORT'LARI ASYNC FONKSİYONUN İÇİNE TAŞIDIK
    const chromium = (await import('@sparticuz/chromium')).default;
    const puppeteer = (await import('puppeteer-core')).default;

    console.log(`Kazıma işlemi başlıyor: ${targetDate}`);
    const { Pool } = require('pg');

    const isProduction = process.env.NODE_ENV === 'production';

    // dotenv kütüphanesi ile lokal ve canlı ortam ayrımı
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: isProduction ? { rejectUnauthorized: false } : false,
        family: 4 // IPv4 kullanımı
    });

    // Tarayıcıyı her seferinde aynı seçeneklerle başlatmak için bir fonksiyon
    const launchBrowser = async () => {
        // Bu fonksiyonun içinde await kullandığımız için async olmalı
        return puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        });
    }

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS debes (
                date DATE PRIMARY KEY,
                content JSONB NOT NULL,
                createdAt TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("'debes' tablosu kazıyıcı tarafından kontrol edildi/oluşturuldu.");

        // --- İLK AŞAMA: Sadece linkleri çekmek için tarayıcıyı bir kez kullan ---
        let entryLinks = [];
        let initialBrowser = await launchBrowser();
        try {
            const page = await initialBrowser.newPage();
            await page.setViewport({ width: 1920, height: 1080 });
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
            
            await page.goto('https://eksisozluk.com/debe', { waitUntil: 'networkidle2', timeout: 120000 });
            
            // SENİN GÜNCELLEDİĞİN SEÇİCİYİ KULLANIYORUZ
            entryLinks = await page.evaluate(() => {
                const items = [];
                document.querySelectorAll('ul.topic-list li a').forEach(el => {
                    items.push({ 
                        title: el.innerText.trim(), 
                        link: el.href 
                    });
                });
                return items;
            });
        } finally {
            if (initialBrowser) await initialBrowser.close();
        }

        console.log(`Başarıyla ${entryLinks.length} adet link bulundu. İçerikler parçalar halinde çekilecek...`);

        // --- İKİNCİ AŞAMA: Linkleri parçalara ayırıp her parça için tarayıcıyı yeniden başlat ---
        const finalDebeList = [];
        const BATCH_SIZE = 5; // Her seferinde 5 entry çekeceğiz

        for (let i = 0; i < entryLinks.length; i += BATCH_SIZE) {
            const batch = entryLinks.slice(i, i + BATCH_SIZE);
            console.log(`--- Deste ${Math.floor(i / BATCH_SIZE) + 1} işleniyor (${i + 1}-${i + batch.length}) ---`);
            
            let batchBrowser = await launchBrowser();
            try {
                const page = await batchBrowser.newPage();
                for (const entry of batch) {
                    try {
                        // HER İSTEK ARASINA RASTGELE BİR GECİKME EKLE (1-3 saniye)
                        await delay(Math.random() * 2000 + 1000); 
                        
                        console.log(`İçerik çekiliyor: ${entry.title}`);
                        await page.goto(entry.link, { waitUntil: 'networkidle2', timeout: 120000 });
                        
                        const entryContent = await page.evaluate(() => document.querySelector('div.content')?.innerHTML.trim() || "İçerik bulunamadı.");
                        finalDebeList.push({ ...entry, content: entryContent });

                    } catch (singleError) {
                        // TEK BİR SAYFA HATA VERİRSE, BUNU KAYDET VE ÇÖKMEDEN DEVAM ET
                        console.error(`HATA: '${entry.title}' başlıklı entry çekilemedi. Hata: ${singleError.message}`);
                    }
                }
            } finally {
                if (batchBrowser) await batchBrowser.close();
                console.log(`--- Deste ${Math.floor(i / BATCH_SIZE) + 1} tamamlandı, tarayıcı kapatıldı. ---`);
            }
        }

        // Sadece başarılı bir şekilde çekilen verileri kaydet
        if (finalDebeList.length > 0) {
            const insertSql = `
                INSERT INTO debes (date, content) VALUES ($1, $2)
                ON CONFLICT (date) DO UPDATE SET content = EXCLUDED.content;
            `;
            const contentString = JSON.stringify(finalDebeList);
            await pool.query(insertSql, [targetDate, contentString]);
            console.log(`Yeni veri (${targetDate}) başarıyla veritabanına kaydedildi. Toplam ${finalDebeList.length} entry işlendi.`);
        } else {
            console.warn("Hiçbir entry başarıyla çekilemedi, veritabanına kayıt yapılmadı.");
        }

        return { success: true, message: `İşlem tamamlandı. Başarıyla ${finalDebeList.length} entry işlendi.` };
    } catch (error) {
        console.error("Kazıma sırasında hata oluştu:", error);
        return { success: false, message: "Kazıma sırasında bir hata oluştu." };
    } finally {
        await pool.end();
        console.log("Kazıma işlemi ve veritabanı bağlantısı sonlandırıldı.");
    }
};

module.exports = { scrapeAndSave };

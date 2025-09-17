// Rastgele bir süre beklemek için yardımcı bir fonksiyon
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const scrapeAndSave = async (targetDate) => {
    // Dinamik import'ları fonksiyonun içine taşıdık
    const chromium = (await import('@sparticuz/chromium')).default;
    const puppeteer = (await import('puppeteer-core')).default;

    console.log(`Kazıma işlemi başlıyor: ${targetDate}`);
    const { Pool } = require('pg');
    const isProduction = process.env.NODE_ENV === 'production';
    
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: isProduction ? { rejectUnauthorized: false } : false,
        family: 4, // IPv4 kullan   
    });

    const launchBrowser = async () => {
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
            await page.goto('https://eksisozluk.com/debe', { waitUntil: 'networkidle2', timeout: 120000 });
            entryLinks = await page.evaluate(() => 
                Array.from(document.querySelectorAll('ul.topic-list li a')).map(el => ({
                    title: el.innerText.trim(),
                    link: el.href
                }))
            );
        } finally {
            if (initialBrowser) await initialBrowser.close();
        }

        console.log(`Başarıyla ${entryLinks.length} adet link bulundu. İçerikler tek tek çekilecek...`);

        // --- NİHAİ ÇÖZÜM: HER BİR ENTRY İÇİN YENİDEN DENEME MANTIĞIYLA ÇALIŞ ---
        const finalDebeList = [];
        const MAX_RETRIES = 2; // Her sayfa için toplam 3 deneme (1 asıl + 2 tekrar)

        for (let i = 0; i < entryLinks.length; i++) {
            const entry = entryLinks[i];
            console.log(`--- Entry ${i + 1}/${entryLinks.length} işleniyor: ${entry.title} ---`);
            
            let success = false;
            for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
                let browser = null;
                try {
                    // Her deneme arasına küçük bir gecikme ekle
                    if (attempt > 1) {
                         const retryDelay = 2000 * attempt; // Her denemede daha uzun bekle
                         console.log(`${retryDelay / 1000} saniye sonra tekrar denenecek... (deneme ${attempt})`);
                         await delay(retryDelay);
                    } else {
                         await delay(Math.random() * 1500 + 500); // Normal bekleme
                    }
                    
                    browser = await launchBrowser();
                    const page = await browser.newPage();
                    
                    await page.goto(entry.link, { waitUntil: 'networkidle2', timeout: 120000 });
                    
                    const entryContent = await page.evaluate(() => document.querySelector('div.content')?.innerHTML.trim() || "İçerik bulunamadı.");
                    finalDebeList.push({ ...entry, content: entryContent });
                    
                    console.log(`'${entry.title}' başarıyla çekildi.`);
                    success = true;
                    break; // Başarılı olunca yeniden deneme döngüsünden çık

                } catch (singleError) {
                    console.error(`HATA (deneme ${attempt}): '${entry.title}' çekilemedi. Hata: ${singleError.message}`);
                    if (attempt === MAX_RETRIES + 1) {
                        console.error(`'${entry.title}' için tüm denemeler başarısız oldu. Bu entry atlanıyor.`);
                    }
                } finally {
                    if (browser) await browser.close();
                }
            }
             console.log(`--- Entry ${i + 1} tamamlandı ---`);
        }

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
        console.error("Kazıma sırasında genel bir hata oluştu:", error);
        return { success: false, message: "Kazıma sırasında genel bir hata oluştu." };
    } finally {
        await pool.end();
        console.log("Kazıma işlemi ve veritabanı bağlantısı sonlandırıldı.");
    }
};

module.exports = { scrapeAndSave };
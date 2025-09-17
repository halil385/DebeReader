// Rastgele bir süre beklemek için yardımcı bir fonksiyon
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const scrapeAndSave = async (targetDate) => {
    // Dinamik import'ları fonksiyonun içine taşıdık
    const chromium = (await import('@sparticuz/chromium')).default;
    const puppeteer = (await import('puppeteer-core')).default;

    console.log(`Kazıma işlemi başlıyor: ${targetDate}`);
    const { Pool } = require('pg');
    const isProduction = process.env.NODE_ENV === 'production';
    
    // Lokal ve canlı ortamlar için esnek veritabanı bağlantısı
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: isProduction ? { rejectUnauthorized: false } : false,
        family: 4 // IPv4 kullanımı için
    });

    // Tarayıcıyı her seferinde aynı seçeneklerle başlatmak için bir fonksiyon
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
            // Sayfa yükleme süresini artırarak timeout hatalarını azaltıyoruz
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

        // --- NİHAİ ÇÖZÜM: HER BİR ENTRY İÇİN TARAYICIYI YENİDEN BAŞLAT ---
        const finalDebeList = [];
        for (let i = 0; i < entryLinks.length; i++) {
            const entry = entryLinks[i];
            console.log(`--- Entry ${i + 1}/${entryLinks.length} işleniyor: ${entry.title} ---`);
            
            let browser = null;
            try {
                // Her istek arasına küçük bir gecikme ekleyerek engellenme riskini azalt
                await delay(Math.random() * 1500 + 500); // 0.5 - 2 saniye arası bekle
                
                browser = await launchBrowser();
                const page = await browser.newPage();
                
                await page.goto(entry.link, { waitUntil: 'networkidle2', timeout: 120000 });
                
                const entryContent = await page.evaluate(() => document.querySelector('div.content')?.innerHTML.trim() || "İçerik bulunamadı.");
                finalDebeList.push({ ...entry, content: entryContent });
                
                console.log(`'${entry.title}' başarıyla çekildi.`);

            } catch (singleError) {
                // Tek bir sayfa hata verirse, logla ve çökmeden devam et
                console.error(`HATA: '${entry.title}' başlıklı entry çekilemedi. Hata: ${singleError.message}`);
            } finally {
                // Her işlemden sonra tarayıcıyı mutlaka kapat
                if (browser) await browser.close();
                console.log(`--- Tarayıcı kapatıldı ---`);
            }
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


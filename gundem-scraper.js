require('dotenv').config();

const runGundemScraper = async () => {
    console.log("Gündem Scraper Başlatılıyor (Veritabanı Aktif)");

    // GitHub Actions otomatik olarak GITHUB_ACTIONS=true değişkenini atar
    const isProduction = process.env.NODE_ENV === 'production' || process.env.GITHUB_ACTIONS === 'true';
    const isDebugMode = process.env.DEBUG_MODE === 'true';

    const { Pool } = require('pg');
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: isProduction ? { rejectUnauthorized: false } : false,
    });

    let puppeteer;
    let launchOptions;

    // Ortama göre puppeteer seçimi (Mevcut scraper-logic.js yapısına benzer)
    if (isProduction) {
        console.log("Canlı ortam (production) algılandı. @sparticuz/chromium kullanılıyor.");
        const chromium = (await import('@sparticuz/chromium')).default;
        puppeteer = (await import('puppeteer-core')).default;
        
        launchOptions = {
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        };
    } else {
        console.log("Lokal ortam (development) algılandı. Standart puppeteer kullanılıyor.");
        puppeteer = require('puppeteer');
        
        launchOptions = {
            headless: !isDebugMode, 
        };
        if(isDebugMode) console.log("DEBUG MODU AKTİF: Tarayıcı görünür olacak.");
    }

    const browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');

    try {
        console.log("Veritabanı tablosu kontrol ediliyor...");
        await pool.query(`
            CREATE TABLE IF NOT EXISTS gundem_entries (
                id SERIAL PRIMARY KEY,
                date DATE NOT NULL,
                rank INTEGER NOT NULL,
                topic_title TEXT NOT NULL,
                topic_link TEXT NOT NULL,
                entry_content TEXT,
                entry_author TEXT,
                entry_date TEXT,
                createdAt TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT gundem_unique_date_topic UNIQUE (date, topic_title)
            )
        `);

        let allTopics = [];

        // 1. ADIM: Gündemin İlk 3 Sayfasını Gez
        for (let p = 1; p <= 3; p++) {
            console.log(`Gündem Sayfa ${p} taranıyor...`);
            const url = `https://eksisozluk.com/basliklar/gundem?p=${p}`;
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
            
            // Başlıkları ve entry sayılarını çek
            const topicsOnPage = await page.evaluate(() => {
                const elements = document.querySelectorAll('ul.topic-list li a');
                let results = [];
                
                elements.forEach((el) => {
                    const titleText = el.childNodes[0] ? el.childNodes[0].textContent.trim() : el.innerText.trim();
                    const href = el.href;
                    // Başlığın yanındaki entry sayısını bul (<small> etiketi içinde yazar)
                    const smallEl = el.querySelector('small');
                    let entryCount = 0;
                    
                    if (smallEl) {
                        // "1,2b" (1200) veya "45" gibi sayıları parse et
                        let countStr = smallEl.innerText.trim().replace(/,/g, '.');
                        if (countStr.includes('b') || countStr.includes('k')) {
                            entryCount = parseFloat(countStr) * 1000;
                        } else {
                            entryCount = parseInt(countStr, 10);
                        }
                    }
                    
                    // Geçerli başlıkları listeye ekle
                    if(titleText && href) {
                         results.push({ title: titleText, link: href, count: entryCount });
                    }
                });
                
                return results;
            });
            
            allTopics = allTopics.concat(topicsOnPage);
            // Ekşisözlük bloklamaması için ufak bir bekleme (random 1-2 sn)
            await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000)); 
        }

        console.log(`Toplam ${allTopics.length} adet başlık bulundu. Entry sayısına göre sıralanıyor...`);

        // 2. ADIM: Entry sayısına göre büyükten küçüğe sırala ve İlk 50'yi al
        allTopics.sort((a, b) => b.count - a.count);
        
        // Sadece unique (benzersiz) başlıkları tut (sayfalar arası kayma ihtimaline karşı)
        const uniqueTopics = [];
        const seenLinks = new Set();
        
        for (const topic of allTopics) {
            // Şukela moduna yönlendirecek URL'yi hazırla (Örn: ?a=nice)
            const baseUrl = topic.link.split('?')[0]; 
            if (!seenLinks.has(baseUrl)) {
                seenLinks.add(baseUrl);
                uniqueTopics.push({
                    ...topic,
                    sukelaLink: `${baseUrl}?a=dailynice` // Tüm zamanların en iyisi şukela. (Günlük için: ?a=dailynice)
                });
            }
        }

        const top50Topics = uniqueTopics.slice(0, 50);
        console.log(`En popüler ilk ${top50Topics.length} başlık belirlendi. Şukela içerikleri çekiliyor...\n`);

        const scrapedData = [];

        // 3. ADIM: İlk 50 başlığı tek tek şukela modunda aç ve ilk entry'i çek
        for (let i = 0; i < top50Topics.length; i++) {
            const topic = top50Topics[i];
            console.log(`[${i + 1}/50] Çekiliyor: ${topic.title} (${topic.count} entry)`);
            
            try {
                await page.goto(topic.sukelaLink, { waitUntil: 'domcontentloaded', timeout: 30000 });
                
                // Sayfada entry listesinin (ul#entry-item-list) yüklenmesini bekle
                await page.waitForSelector('ul#entry-item-list li', { timeout: 10000 }).catch(() => null);
                
                const entryData = await page.evaluate(() => {
                    const firstEntryLi = document.querySelector('ul#entry-item-list li');
                    if (!firstEntryLi) return null;

                    const contentDiv = firstEntryLi.querySelector('div.content');
                    const authorA = firstEntryLi.querySelector('a.entry-author');
                    const dateA = firstEntryLi.querySelector('a.entry-date');

                    return {
                        content: contentDiv ? contentDiv.innerHTML.trim() : null,
                        author: authorA ? authorA.innerText.trim() : null,
                        date: dateA ? dateA.innerText.trim() : null,
                    };
                });

                if (entryData && entryData.content) {
                    const today = new Date().toISOString().split('T')[0];
                    const insertSql = `
                        INSERT INTO gundem_entries (date, rank, topic_title, topic_link, entry_content, entry_author, entry_date)
                        VALUES ($1, $2, $3, $4, $5, $6, $7)
                        ON CONFLICT (date, topic_title) DO NOTHING;
                    `;
                    await pool.query(insertSql, [
                        today,
                        i + 1,
                        topic.title,
                        topic.sukelaLink,
                        entryData.content,
                        entryData.author,
                        entryData.date
                    ]);

                    scrapedData.push({
                        rank: i + 1,
                        topicTitle: topic.title,
                        topicLink: topic.sukelaLink,
                        entryContent: entryData.content,
                        author: entryData.author,
                        entryDate: entryData.date
                    });
                    console.log(`   -> Başarılı: Yazar: ${entryData.author}, Tarih: ${entryData.date}`);
                } else {
                     console.log(`   -> Uyarı: Şukela entry'si bulunamadı.`);
                }

            } catch (error) {
                console.error(`   -> Hata: ${topic.title} çekilirken sorun oluştu - ${error.message}`);
            }

            // İstekler arası çok küçük bir bekleme süresi
            await new Promise(r => setTimeout(r, 500));
        }

        // 4. ADIM: Sonucu Ekrana Bas (Test Doğrulaması)
        console.log("\n--- TEST SONUCU: ÇEKİLEN VERİLER ---");
        console.log(JSON.stringify(scrapedData.slice(0, 3), null, 2)); // İlk 3 veriyi detaylı göster
        console.log(`\nToplam ${scrapedData.length} adet veri çekildi.`);
        console.log("------------------------------------\n");

    } catch (error) {
        console.error("Gündem scraper sırasında genel bir hata oluştu:", error);
    } finally {
        await browser.close();
        await pool.end();
        console.log("Tarayıcı ve veritabanı bağlantısı kapatıldı. İşlem sonlandı.");
    }
};

runGundemScraper();

const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
// 'pg' kütüphanesinden 'Pool' sınıfını import ediyoruz
const { Pool } = require('pg');

// ORTAM DEĞİŞKENLERİNE GÖRE BAĞLANTI KURULUMU
// Render'da DATABASE_URL değişkeni otomatik olarak sağlanır.
// Eğer bu değişken yoksa (yani yerelde çalışıyorsak), yerel ayarları kullanır.
const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:Psw1800S6!@localhost:5432/debe_reader',
    ssl: isProduction ? { rejectUnauthorized: false } : false
});
// Veritabanı bağlantısını test etme ve tabloyu oluşturma
const setupDatabase = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS debes (
                date DATE PRIMARY KEY,
                content JSONB NOT NULL,
                createdAt TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("'debes' tablosu başarıyla oluşturuldu veya zaten mevcuttu.");
    } catch (err) {
        console.error("Veritabanı kurulum hatası:", err.stack);
        // Hata durumunda uygulamayı sonlandırabiliriz çünkü veritabanı olmadan çalışamaz.
        process.exit(1);
    }
};

// Sunucu başlamadan önce veritabanı kurulumunu yap
setupDatabase();

const app = express();
const PORT = 3000;
app.use(cors());

// --- GÜNCELLENEN API ROTASI ---
app.get('/api/debe', async (req, res) => {
    // URL'den gelen tarih parametresini al, eğer yoksa bugünün tarihini kullan.
    const requestedDate = req.query.date || new Date().toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];

    try {
        // 1. VERİTABANINI İSTENEN TARİHE GÖRE KONTROL ET
        const sql = `SELECT content FROM debes WHERE date = $1`;
        const result = await pool.query(sql, [requestedDate]);

        // 2. VERİ VARSA, VERİTABANINDAN GÖNDER
        if (result.rows.length > 0) {
            console.log(`Veri bulundu (${requestedDate}). Veritabanından sunuluyor...`);
            return res.json(result.rows[0].content);
        }

        // 3. VERİ YOKSA...
        // Sadece istenen tarih BUGÜN ise ve veri yoksa kazıma yap.
        if (requestedDate === today) {
            console.log(`Veri bulunamadı (${today}). Ekşi Sözlük'ten çekiliyor...`);
            let browser = null;
            try {
                browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
                const page = await browser.newPage();
                await page.setViewport({ width: 1920, height: 1080 });
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');

                await page.goto('https://eksisozluk.com/debe', { waitUntil: 'networkidle2' });
                
                const entryLinks = await page.evaluate(() => {
                    const items = [];
                    document.querySelectorAll('ul.topic-list li a').forEach(el => items.push({ title: el.innerText.trim(), link: el.href }));
                    return items;
                });

                const finalDebeList = [];
                for (const entry of entryLinks) {
                    await page.goto(entry.link, { waitUntil: 'networkidle2' });
                    const entryContent = await page.evaluate(() => document.querySelector('div.content')?.innerHTML.trim() || "İçerik bulunamadı.");
                    finalDebeList.push({ ...entry, content: entryContent });
                }

                const insertSql = `INSERT INTO debes (date, content) VALUES ($1, $2)`;
                const contentString = JSON.stringify(finalDebeList);
                await pool.query(insertSql, [today, contentString]);
                console.log(`Yeni veri (${today}) başarıyla veritabanına kaydedildi.`);
                
                res.json(finalDebeList);

            } catch (puppeteerError) {
                console.error("Puppeteer veya veritabanı yazma hatası:", puppeteerError);
                res.status(500).json({ error: 'Veriler çekilirken veya kaydedilirken bir hata oluştu.' });
            } finally {
                if (browser) await browser.close();
            }
        } else {
            // İstenen tarih geçmiş bir tarihse ve DB'de yoksa, boş bir sonuç döndür.
            console.log(`Veri bulunamadı (${requestedDate}) ve geçmiş bir tarih olduğu için kazıma yapılmadı.`);
            return res.json([]);
        }

    } catch (dbError) {
        console.error("Veritabanı okuma hatası:", dbError);
        res.status(500).json({ error: 'Veritabanı işlemi sırasında bir hata oluştu.' });
    }
});

// --- YENİ EKLENEN TARİH ARŞİVİ ROTASI ---
app.get('/api/dates', async (req, res) => {
    try {
        // Veritabanındaki tüm tarihleri en yeniden eskiye doğru sıralayarak çek.
        // to_char ile formatı YYYY-MM-DD olarak garantiliyoruz.
        const sql = `SELECT to_char(date, 'YYYY-MM-DD') as date FROM debes ORDER BY date DESC`;
        const result = await pool.query(sql);
        
        // Gelen [{date: '...'}, {date: '...'}] formatındaki sonucu ['...', '...'] formatına çevir.
        const dates = result.rows.map(row => row.date);
        res.json(dates);

    } catch (dbError) {
        console.error("Tarih listesi çekme hatası:", dbError);
        res.status(500).json({ error: 'Tarih listesi çekilirken bir hata oluştu.' });
    }
});

app.listen(PORT, () => {
    console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor.`);
});

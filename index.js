// index.js
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { scrapeLinks, scrapeContent } = require('./scraper-logic.js');

const isProduction = process.env.NODE_ENV === 'production';
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isProduction ? { rejectUnauthorized: false } : false,
    family: 4, // IPv4 kullan   
});

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());

// --- STANDART ROTALAR ---
app.get('/api/debe', async (req, res) => {
    const requestedDate = req.query.date || new Date().toISOString().split('T')[0];
    try {
        const sql = `SELECT * FROM debes WHERE date = $1 ORDER BY "entryOrder" ASC`;
        const result = await pool.query(sql, [requestedDate]);
        
        if (result.rows.length > 0) {
            return res.json(result.rows);
        } else {
            return res.json([]);
        }
    } catch (dbError) {
        console.error("Veritabanı okuma hatası:", dbError);
        res.status(500).json({ error: 'Veritabanı işlemi sırasında bir hata oluştu.' });
    }
});

app.get('/api/dates', async (req, res) => {
    try {
        const sql = `SELECT DISTINCT to_char(date, 'YYYY-MM-DD') as date FROM debes ORDER BY date DESC`;
        const result = await pool.query(sql);
        const dates = result.rows.map(row => row.date);
        res.json(dates);
    } catch (dbError) {
        console.error("Tarih listesi çekme hatası:", dbError);
        res.status(500).json({ error: 'Tarih listesi çekilirken bir hata oluştu.' });
    }
});

// --- YÖNETİM ROTALARI ---
app.get('/api/scrape', async (req, res) => {
    if (req.query.secret !== 'halil') {
        return res.status(401).send('Yetkiniz yok.');
    }
    res.status(202).send('Kazıma işlemi kabul edildi. Faz 1 (Linkler) ve Faz 2 (İçerikler) arka planda başlatılacak.');
    
    console.log("Gizli rota üzerinden Faz 1 tetiklendi: Linkler çekiliyor...");
    const linkScrapeResult = await scrapeLinks();

    if (linkScrapeResult.success) {
        console.log("Linkler başarıyla çekildi. Faz 2 başlıyor: İçerikler dolduruluyor...");
        scrapeContent(); 
    } else {
        console.error("Link kazıma işlemi başarısız olduğu için içerik doldurma başlatılamadı.");
    }
});

// --- VERİTABANI YÖNETİMİ ---
const runMigration = async () => {
    const client = await pool.connect();
    try {
        // 1. Eski tablo adında bir tablo var mı diye kontrol et (debes_old olabilir)
        const checkOldTable = await client.query("SELECT to_regclass('public.debes_old')");
        if (checkOldTable.rows[0].to_regclass) {
            console.log("'debes_old' tablosu zaten mevcut. Migrasyon daha önce yapılmış olabilir. İşlem atlanıyor.");
            return;
        }

        console.log("Veritabanı migrasyonu başlıyor...");
        
        // 2. Mevcut tabloyu geçici olarak yeniden adlandır
        await client.query('ALTER TABLE debes RENAME TO debes_old');
        console.log("Mevcut 'debes' tablosu 'debes_old' olarak yeniden adlandırıldı.");

        // 3. Yeni yapıda tabloyu oluştur
        await client.query(`
            CREATE TABLE debes (
                id SERIAL PRIMARY KEY,
                date DATE NOT NULL,
                "entryOrder" INTEGER NOT NULL,
                title TEXT NOT NULL,
                link TEXT NOT NULL UNIQUE,
                content TEXT,
                createdAt TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("Yeni yapıda 'debes' tablosu oluşturuldu.");

        // 4. Eski tablodaki verileri oku
        const { rows: oldData } = await client.query('SELECT * FROM debes_old');
        console.log(`${oldData.length} adet eski kayıt bulundu. Yeni tabloya aktarılıyor...`);

        // 5. Verileri yeni tabloya aktar
        for (const row of oldData) {
            const date = row.date;
            const content = row.content; // Bu bir JSON string'i

            if (content && Array.isArray(content)) {
                for (let i = 0; i < content.length; i++) {
                    const entry = content[i];
                    await client.query(
                        `INSERT INTO debes (date, "entryOrder", title, link, content) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (link) DO NOTHING`,
                        [date, i + 1, entry.title, entry.link, entry.content]
                    );
                }
            }
        }
        console.log("Veri aktarımı tamamlandı.");
        console.log("Migrasyon başarılı! Artık eski 'debes_old' tablosunu Supabase arayüzünden güvenle silebilirsiniz.");

    } catch (error) {
        console.error("Migrasyon sırasında bir hata oluştu:", error);
    } finally {
        client.release();
    }
};

const startServer = async () => {
    try {
        // YENİ: Sunucu başlamadan önce migrasyonu çalıştır.
        // Bu sadece ilk seferde bir şeyler yapacak, sonrasında atlayacaktır.
        await runMigration();

        app.listen(PORT, () => {
            console.log(`Sunucu ${PORT} portunda çalışıyor.`);
        });
    } catch (error) {
        console.error("Sunucu başlatılırken bir hata oluştu:", error);
        process.exit(1);
    }
};

startServer();


// index.js
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
// Sadece yeni ana fonksiyonumuzu import ediyoruz
const { runScrapeProcess } = require('./scraper-logic.js');

const isProduction = process.env.NODE_ENV === 'production';
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isProduction ? { rejectUnauthorized: false } : false,
    family: 4, // IPv4 kullan
});

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());

// Sunucu başlamadan önce tabloyu kontrol et/oluştur
const setupDatabase = async () => {
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
        console.log("'debes' tablosu API sunucusu tarafından kontrol edildi/oluşturuldu.");
    } catch (error) {
        console.error("Veritabanı kurulumu sırasında hata:", error);
        process.exit(1);
    }
};

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

// --- YÖNETİM ROTASI (ARTIK DAHA AKILLI) ---
app.get('/api/scrape', (req, res) => {
    if (req.query.secret !== 'halil') {
        return res.status(401).send('Yetkiniz yok.');
    }
    res.status(202).send('Akıllı kazıma işlemi kabul edildi ve arka planda başlatıldı.');
    
    // Akıllı kazıyıcıyı beklemeden çalıştır (fire-and-forget)
    runScrapeProcess();
});


const startServer = async () => {
    await setupDatabase();
    app.listen(PORT, () => {
        console.log(`Sunucu ${PORT} portunda çalışıyor.`);
    });
};

startServer();


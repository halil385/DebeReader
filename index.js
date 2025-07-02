// index.js
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { scrapeAndSave } = require('./scraper-logic.js'); // Yeni fonksiyonu import et

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());

// SADECE VERİTABANINDAN OKUMA YAPAN API
app.get('/api/debe', async (req, res) => {
    const requestedDate = req.query.date || new Date().toISOString().split('T')[0];
    try {
        const sql = `SELECT content FROM debes WHERE date = $1`;
        const result = await pool.query(sql, [requestedDate]);
        if (result.rows.length > 0) {
            return res.json(result.rows[0].content);
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
        const sql = `SELECT to_char(date, 'YYYY-MM-DD') as date FROM debes ORDER BY date DESC`;
        const result = await pool.query(sql);
        const dates = result.rows.map(row => row.date);
        res.json(dates);
    } catch (dbError) {
        console.error("Tarih listesi çekme hatası:", dbError);
        res.status(500).json({ error: 'Tarih listesi çekilirken bir hata oluştu.' });
    }
});

// YENİ GİZLİ TETİKLEYİCİ ROTA
app.get('/api/scrape', async (req, res) => {
    // Basit bir güvenlik önlemi. Bu anahtarı daha karmaşık yapabilirsin.
    if (req.query.secret !== 'halil') {
        return res.status(401).send('Yetkiniz yok.');
    }

    // İsteği hemen yanıtla, kazıma işlemini arka planda başlat.
    res.status(202).send('Kazıma işlemi kabul edildi ve arka planda başlatıldı.');
    
    // Kazıma işlemini beklemeden çalıştır.
    console.log("Gizli rota üzerinden kazıma tetiklendi...");
    scrapeAndSave();
});

app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});


// bu geçmişi silmek için Gizli Yol 
app.get('/api/delete-record', async (req, res) => {
    if (req.query.secret !== 'xelle') { // Anahtarınızı değiştirin
        return res.status(401).send('Yetkiniz yok.');
    }
    const targetDate = req.query.date;
    if (!targetDate) {
        return res.status(400).send('Lütfen silmek için bir "date" parametresi belirtin.');
    }

    try {
        const sql = `DELETE FROM debes WHERE date = $1`;
        const result = await pool.query(sql, [targetDate]);
        
        if (result.rowCount > 0) {
            console.log(`${targetDate} tarihli kayıt başarıyla silindi.`);
            res.status(200).send(`${targetDate} tarihli kayıt başarıyla silindi.`);
        } else {
            console.log(`${targetDate} tarihli silinecek kayıt bulunamadı.`);
            res.status(404).send(`${targetDate} tarihli silinecek kayıt bulunamadı.`);
        }
    } catch (error) {
        console.error("Kayıt silme hatası:", error);
        res.status(500).send("Kayıt silinirken bir hata oluştu.");
    }
});
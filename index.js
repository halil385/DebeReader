// index.js
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { scrapeAndSave } = require('./scraper-logic.js');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    family: 4,
});

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());

// --- STANDART ROTALAR ---
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


// --- YÖNETİM ROTALARI ---

// GİZLİ TETİKLEYİCİ ROTA
app.get('/api/scrape', async (req, res) => {
    // Güvenlik anahtarını kendinize göre değiştirin
    if (req.query.secret !== 'halil') { 
        return res.status(401).send('Yetkiniz yok.');
    }
    // Eğer bir tarih belirtilmişse onu, belirtilmemişse bugünü kazı.
    const targetDate = req.query.date || new Date().toISOString().split('T')[0];
    
    res.status(202).send(`Kazıma işlemi ${targetDate} tarihi için kabul edildi ve arka planda başlatıldı.`);
    
    console.log(`Gizli rota üzerinden kazıma tetiklendi: ${targetDate}`);
    scrapeAndSave(targetDate);
});

// GİZLİ KAYIT SİLME ROTASI
app.get('/api/delete-record', async (req, res) => {
    // Güvenlik anahtarını kendinize göre değiştirin
    if (req.query.secret !== 'xelle') {
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


// Sunucuyu başlatmak için asenkron bir fonksiyon
const startServer = async () => {
    try {
        // Sunucu başlamadan önce tablonun var olduğundan emin ol
        await pool.query(`
            CREATE TABLE IF NOT EXISTS debes (
                date DATE PRIMARY KEY,
                content JSONB NOT NULL,
                createdAt TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("'debes' tablosu API sunucusu tarafından kontrol edildi/oluşturuldu.");

        app.listen(PORT, () => {
            console.log(`Sunucu ${PORT} portunda çalışıyor.`);
        });
    } catch (error) {
        console.error("Sunucu başlatılırken veritabanı hatası oluştu:", error);
        process.exit(1); // Veritabanı yoksa sunucu başlamasın
    }
};

startServer();

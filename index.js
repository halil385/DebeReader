const express = require('express');
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
const app = express();
// Render portu ortam değişkeninden okur
const PORT = process.env.PORT || 3000;
app.use(cors());

// SADECE VERİTABANINDAN OKUMA YAPAN API
app.get('/api/debe', async (req, res) => {
    const requestedDate = req.query.date || new Date().toISOString().split('T')[0];
    try {
        const sql = `SELECT content FROM debes WHERE date = $1`;
        const result = await pool.query(sql, [requestedDate]);

        if (result.rows.length > 0) {
            console.log(`Veri bulundu (${requestedDate}). Veritabanından sunuluyor...`);
            return res.json(result.rows[0].content);
        } else {
            console.log(`Veri bulunamadı (${requestedDate}).`);
            return res.json([]); // Veri yoksa boş dizi döndür
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

app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
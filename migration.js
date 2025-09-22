// migration.js
require('dotenv').config();
const { Pool } = require('pg');

// Lokal veritabanı için bağlantı havuzu
const localPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: false, // Lokal olduğu için SSL yok
});

// Supabase (canlı) veritabanı için bağlantı havuzu
const supabasePool = new Pool({
    connectionString: process.env.DATABASE_URL_SUPABASE,
    ssl: { rejectUnauthorized: false },
});

const migrateData = async () => {
    console.log("Veri taşıma işlemi başlıyor...");
    const localClient = await localPool.connect();
    const supabaseClient = await supabasePool.connect();

    try {
        // 1. Lokal veritabanından tüm verileri çek
        const { rows: localData } = await localClient.query('SELECT * FROM debes ORDER BY id ASC');
        console.log(`Lokal veritabanında ${localData.length} adet kayıt bulundu.`);

        if (localData.length === 0) {
            console.log("Taşınacak veri yok. İşlem sonlandırıldı.");
            return;
        }

        // 2. Verileri Supabase'e aktar
        console.log("Veriler Supabase'e aktarılıyor...");
        await supabaseClient.query('BEGIN'); // Toplu işlem başlat

        const insertSql = `
            INSERT INTO debes (date, "entryOrder", title, link, content, "createdAt")
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (link) DO NOTHING; 
        `;
        // ON CONFLICT... sayesinde, eğer aynı link zaten varsa hata vermeden atlar.

        let insertedCount = 0;
        for (const row of localData) {
            const result = await supabaseClient.query(insertSql, [
                row.date,
                row.entryOrder,
                row.title,
                row.link,
                row.content,
                row.createdAt
            ]);
            if (result.rowCount > 0) {
                insertedCount++;
            }
        }
        
        await supabaseClient.query('COMMIT'); // İşlemi onayla
        console.log(`Aktarım tamamlandı. Supabase'e ${insertedCount} adet yeni kayıt eklendi.`);

    } catch (error) {
        await supabaseClient.query('ROLLBACK'); // Hata olursa işlemi geri al
        console.error("Veri taşıma sırasında bir hata oluştu:", error);
    } finally {
        localClient.release();
        supabaseClient.release();
        await localPool.end();
        await supabasePool.end();
        console.log("Tüm veritabanı bağlantıları kapatıldı.");
    }
};

migrateData();

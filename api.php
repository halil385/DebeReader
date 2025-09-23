<?php
// Çıktının JSON formatında olacağını ve karakter setinin UTF-8 olacağını tarayıcıya bildiriyoruz.
header('Content-Type: application/json; charset=utf-8');
// Farklı domain'lerden (örn: netlify) gelen isteklere izin veriyoruz (CORS).
header('Access-Control-Allow-Origin: *');

// --- VERİTABANI BAĞLANTI BİLGİLERİ ---
// DİKKAT: Bu bilgileri Supabase projenizin Ayarlar > Database > Connection string (URI) bölümünden alın.
// "[YOUR-PASSWORD]" kısmını kendi şifrenizle değiştirmeyi unutmayın!
$connection_string = "postgresql://postgres.mehefgjesxrsvszhoega:nnzFrr6is5coHZMV@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";

// Veritabanına bağlan
// @ işareti, olası bağlantı uyarılarının ekrana basılmasını engeller, hatayı kendimiz yöneteceğiz.
$dbconn = @pg_connect($connection_string);

if (!$dbconn) {
    // Bağlantı başarısız olursa, 500 koduyla bir hata mesajı bas ve işlemi sonlandır.
    http_response_code(500);
    echo json_encode(['error' => 'Veritabanına bağlanılamadı.']);
    exit;
}

// --- API YÖNLENDİRME (ROUTING) ---
// Hangi endpoint'in istendiğini bir URL parametresi ile alıyoruz (örn: api.php?endpoint=debe)
// Eğer bir endpoint belirtilmemişse, varsayılan olarak 'debe' kabul edilecek.
$endpoint = $_GET['endpoint'] ?? 'debe';

if ($endpoint === 'debe') {
    handleDebeRequest($dbconn);
} elseif ($endpoint === 'dates') {
    handleDatesRequest($dbconn);
} else {
    // Geçersiz bir endpoint istenirse 404 hatası döndür.
    http_response_code(404);
    echo json_encode(['error' => 'Endpoint bulunamadı.']);
}

// İşimiz bittiğinde veritabanı bağlantısını güvenli bir şekilde kapat.
pg_close($dbconn);

// --- FONKSİYONLAR ---

/**
 * Belirli bir tarihe ait Debe listesini çeker ve JSON olarak basar.
 */
function handleDebeRequest($dbconn) {
    // Tarih parametresini URL'den al (?date=YYYY-MM-DD)
    // Eğer tarih belirtilmemişse, bugünün tarihini Türkiye saatine göre al.
    try {
        $timezone = new DateTimeZone('Europe/Istanbul');
        $date = new DateTime('now', $timezone);
        $requestedDate = $_GET['date'] ?? $date->format('Y-m-d');
    } catch (Exception $e) {
        $requestedDate = date('Y-m-d'); // Hata olursa standart tarih al
    }
    
    // SQL Injection saldırılarına karşı korumalı "prepared statement" hazırlıyoruz.
    $sql = 'SELECT * FROM debes WHERE date = $1 ORDER BY "entryOrder" ASC';
    
    // Sorguyu çalıştır
    $result = pg_query_params($dbconn, $sql, array($requestedDate));

    if (!$result) {
        http_response_code(500);
        echo json_encode(['error' => 'Sorgu çalıştırılırken bir hata oluştu.']);
        return;
    }

    // Sorgu sonucundaki tüm satırları bir diziye aktar
    $data = pg_fetch_all($result);
    
    // Eğer sorgu hiç sonuç döndürmezse, pg_fetch_all() false döner.
    // Bu durumu kontrol edip boş bir diziye çevirerek ön yüzün hata almasını engelliyoruz.
    if ($data === false) {
        $data = [];
    }

    // Sonucu JSON formatında, Türkçe karakterleri koruyarak ekrana basıyoruz.
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
}

/**
 * Veritabanında kayıtlı tüm tarihleri çeker ve JSON olarak basar.
 */
function handleDatesRequest($dbconn) {
    $sql = "SELECT DISTINCT to_char(date, 'YYYY-MM-DD') as date FROM debes ORDER BY date DESC";
    $result = pg_query($dbconn, $sql);

    if (!$result) {
        http_response_code(500);
        echo json_encode(['error' => 'Tarih listesi sorgusu çalıştırılırken bir hata oluştu.']);
        return;
    }

    // Sonucu ['YYYY-MM-DD', 'YYYY-MM-DD', ...] formatında basit bir diziye çeviriyoruz.
    $dates = [];
    while ($row = pg_fetch_assoc($result)) {
        $dates[] = $row['date'];
    }

    // Sonucu JSON formatında ekrana basıyoruz.
    echo json_encode($dates, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
}

/*

### Adım 3: Ön Yüzü (`index.html`) Güncelleme

Şimdi tek yapman gereken, `index.html` dosyanın içindeki `baseApiUrl` değişkenini bu yeni PHP dosyasını gösterecek şekilde güncellemek.

```javascript
// const baseApiUrl = 'https://debe-api.onrender.com'; // Render API
const baseApiUrl = 'https://halilurkmez.com/debe/api.php'; // Yeni PHP API
```

Ve `fetch` komutlarını, yeni endpoint yapımıza uygun hale getirmek:

```javascript
// Tarih arşivini çeken fetch
fetch(`${baseApiUrl}?endpoint=dates`)

// Debe listesini çeken fetch
let url = `${baseApiUrl}?endpoint=debe`;
if (date) {
    url += `&date=${date}`; // Tarih varsa, & ile ekliyoruz
}
*/
?>


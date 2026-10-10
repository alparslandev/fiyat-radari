# Fiyat Radarı

Amazon.com.tr, Trendyol ve Hepsiburada'da iPhone 17 Pro 256 GB fiyatlarını izler. Apple Türkiye garantili en ucuz teklif olağan fiyatın belirgin biçimde altına inince mail gönderir.

## Nasıl çalışır

- **GitHub Actions (`radar.yml`)**: görünür kipte gerçek Chrome ile 9 ürün sayfasını açar (3 site × 3 renk), teklifleri çıkarır ve sonucu Worker'a gönderir. Durum tutmaz, repoya yazmaz.
- **Cloudflare Worker (`worker/`)**: taramayı zamanında tetikler, durumu KV'de tutar, uyarı kuralını uygular, bildirimleri gönderir, bekçilik yapar ve her sabah özet maili atar.
- Yedek olarak GitHub'ın kendi zamanlayıcısı saatte iki kez çalışır.

Tarama sıklığı (Türkiye saati): Ekim'de 15 dakika, Kasım'da 5 dakika, 11.11 gecesi (10 Kas 23:00 - 12 Kas 03:00) ve Black Friday haftasında (26 Kas 23:00 - 1 Ara 03:00) 3 dakika. Dönemler `worker/src/cadence.ts` içinde.

## Hangi teklifler sayılır

- Yeni, stokta, 256 GB, Apple Türkiye Garantili; ürün kimliği (sayfa kimliği, barkod, hafıza) katalogla eşleşmeli.
- Fiyat 40.000 ile 200.000 TL arasında olmalı.
- Trendyol ve Hepsiburada'da satıcı puanı en az 8,5 olmalı; platformun kendisi her zaman sayılır.
- Amazon'da sayfada garanti bilgisi olmadığı için yalnızca Amazon.com.tr ve adında "Apple Premium Partner" geçen satıcılar sayılır.
- Sepette indirim, herkese açık kupon ve Amazon Prime fiyatı hesaba katılır. Trendyol Plus ve Hepsiburada Premium fiyatları sayılmaz, mailde bilgi olarak geçer.

Kurallar `radar/policy.py`, izlenen sayfalar `radar/catalog.py` içinde.

## Uyarı kuralı

- Olağan fiyat: son 7 günde 15 dakikalık dilimlerdeki en ucuz uygun fiyatların medyanı. İlk 24 saat veri birikir, fırsat uyarısı gelmez.
- En ucuz uygun teklif olağan fiyatın en az 500 TL altına iner ve hâlâ satışta olan, daha önce bildirilmiş fırsatlardan da en az 500 TL ucuzsa bildirilir.
- Bildirilen fırsat 1.000 TL pahalanır ya da satıştan kalkarsa biter; sonraki en iyi teklif yeniden bildirilebilir.
- Bir sitenin hiçbir sayfası Trendyol ve Hepsiburada'da 1 saat, Amazon'da 3 saat boyunca açılamazsa, Worker'a uzun süre veri gelmezse ya da GitHub tetiklenemezse ayrıca haber verilir. Amazon GitHub sunucularına zaman zaman ara sayfa gösterdiği için ona daha uzun süre tanınır.

## Kurulum

1. **GitHub reposu**: public bir repo aç (`fiyat-radari`) ve bu klasörü push et. Public repoda Actions dakikaları ücretsiz.
2. **Erişim testi**: Actions sekmesinde "Erisim testi" iş akışını çalıştır (ayrıca her gün 03:00, 13:00 ve 21:00'de kendiliğinden çalışır). Sonuç tablosu `ozet` işinin özet sayfasında. Her site için en az bir yapılandırmanın makinelerin büyük çoğunluğunda geçmesi gerekir. Test bitince `spike.yml` ve `radar/spike.py` silinebilir.
3. **GitHub token**: yalnızca bu repoya erişen, Actions izni "Read and write" olan ince ayarlı (fine-grained) bir kişisel erişim token'ı oluştur.
4. **Worker**:
   ```sh
   cd worker
   bun install
   bunx wrangler kv namespace create RADAR
   ```
   Çıkan kimliği `wrangler.jsonc` içindeki `KV_NAMESPACE_ID` yerine yaz. Sonra secret'ları gir ve yayınla:
   ```sh
   bunx wrangler secret put GH_TOKEN
   bunx wrangler secret put INGEST_TOKEN
   bun run deploy
   ```
   `INGEST_TOKEN` için uzun, rastgele bir değer üret (`openssl rand -hex 32`).
7. **GitHub ayarları** (Settings > Secrets and variables > Actions):
   - Variable `RADAR_INGEST_URL`: `https://fiyat-radari.<hesap>.workers.dev/ingest`
   - Secret `RADAR_INGEST_TOKEN`: Worker'daki `INGEST_TOKEN` ile aynı değer

`RADAR_INGEST_URL` tanımlı değilken tarama kuru çalışır: sonuçlar yalnızca Actions özet sayfasında görünür.

## Yerelde çalıştırma

Python 3.12 ve kurulu Google Chrome gerekir.

```sh
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m radar run --dry-run
.venv/bin/python -m pytest -q
```

- `python -m radar capture`: izlenen sayfaların ham verisini `tests/fixtures/` altına kaydeder (sayfa yapısı değişince testleri güncellemek için).
- `LIVE_TESTS=1 python -m pytest tests/test_live.py`: gerçek sayfalara karşı uçtan uca test.

## Sınırlar

- Amazon'da yalnızca sayfadaki ana teklif izlenir; "diğer satıcılar" listesi kapsam dışı.
- Bot korumasını aşmaya yönelik hiçbir şey (gizlenme eklentisi, captcha çözücü, proxy) kullanılmaz. Bir site taramayı engellerse bu bildirilir; o site için mağazanın kendi uygulamasındaki fiyat alarmını açmak gerekir.
- iPhone 17 Pro artık Apple tarafından satılmıyor; stoklar azaldıkça teklif sayısı düşebilir.

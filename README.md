# SAFA

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/marinemanagementsystem/SAFA2)

Trendyol siparislerini cekip kontrollu e-Arsiv fatura akisi olusturan yerel uygulama.

## Mevcut kapsam

- Trendyol `orders/stream` tabanli siparis senkronizasyonu
- `Delivered` siparislerden e-Arsiv taslagi olusturma
- Panelden Trendyol API ve e-Arsiv portal bilgilerinin sifreli kaydedilmesi
- Panelden Trendyol Partner ve e-Arsiv Portal pencerelerinin acilmasi
- Kullanici onayli fatura kesme akisi
- Taslak ve kesilmis faturalar icin PDF goruntuleme
- Kesilen/kesilmeyen, bugun kesilen/onceki fatura, durum, sehir, tarih ve metin filtreleri
- Siralanabilir liste ve satira tiklayinca siparis/fatura detay paneli
- Mock GIB e-Arsiv saglayici ile uctan uca test
- Resmi GIB "Bilgi Islem Sisteminin Entegrasyonu" akisi icin `gib-direct` saglayici iskeleti
- Fatura PDF dosyasini saklama ve Trendyol'a PDF yukleme altyapisi
- PostgreSQL + Redis + BullMQ job altyapisi

Gercek fatura kesimi icin ozel entegrator kullanilmiyor. Canli GIB entegrasyonu icin GIB test/onay sureci, web servis erisimi, mali muhur/NES imzalama altyapisi ve canli yetkilendirme tamamlanmalidir.

## Kurulum

```bash
cp .env.example .env
pnpm install
docker compose up -d
pnpm db:generate
pnpm db:migrate
pnpm dev
```

Panel: http://localhost:3000

API: http://localhost:4000/api

Swagger: http://localhost:4000/docs

## Baglanti bilgileri

Paneldeki `Baglantilar` bolumunden Trendyol API bilgileri ve e-Arsiv Portal kullanici bilgileri girilebilir. Bu bilgiler PostgreSQL icinde AES-GCM ile sifreli saklanir; sifreleme anahtari `.env` icindeki `APP_SECRET_KEY` degeridir.

Trendyol tarafinda uygulama kullanici adi/sifre ile degil, Partner API bilgileriyle siparis ceker. e-Arsiv Portal tarafinda portal penceresi kullanici tiklamasiyla acilir. Portal bilgileri kayitliysa backend GIB portalinin `assos-login` endpoint'i uzerinden oturum token'i alir ve popup'i tokenli URL'ye yonlendirir. Bilgiler kayitli degilse popup manuel giris ekrani olarak acilir.

Her hazir taslak ve kesilmis fatura icin panelde PDF linki bulunur. Teknik ihtiyac durumunda API tarafinda UBL/e-Arsiv XML endpoint'i de korunur.

## Aksam kullanim akisi

1. Docker servisleri calismiyorsa `docker compose up -d` calistirin.
2. API ve paneli baslatin:

```bash
pnpm start:api
pnpm start:web
```

3. http://localhost:3000 adresine girin.
4. `Baglantilar` bolumunde Trendyol API bilgilerini kaydedin.
5. `Baglantilar` bolumunde e-Arsiv Portal kullanici kodu ve sifresini kaydedin.
6. `Trendyol cek` ile teslim edilmis siparisleri cekin.
7. Taslaklari kontrol edip onaylayin.
8. `e-Arsiv ac` veya `Portal ac` ile tokenli portal oturumunu acin.
9. Gerekirse taslak kartindaki `e-Arsiv XML` ciktisini kullanin.

## Ucretsiz hosting

Repo kokunde `render.yaml` bulunur. Bu dosya Render uzerinde su kaynaklari olusturacak sekilde hazirlandi:

- `safa-web`: Next.js panel
- `safa-api`: NestJS API
- `safa-db`: PostgreSQL
- `safa-redis`: Redis uyumlu Render Key Value

Render ile yayinlama:

1. Projeyi GitHub reposuna push edin.
2. Render Dashboard icinde `New` -> `Blueprint` secin.
3. GitHub reposunu baglayin ve kokteki `render.yaml` dosyasini secin.
4. Render'in olusturacagi servisleri onaylayin.
5. Deploy bitince panel Render'in verdigi `safa-web` adresinden acilir.

`render.yaml` icinde gizli Trendyol veya GIB sifresi yoktur. Bu bilgiler canli ortamda paneldeki `Baglantilar` bolumunden girilebilir; PostgreSQL icinde `APP_SECRET_KEY` ile sifreli saklanir. Render'in ucretsiz servisleri test/hobi kullanim icindir; servisler uyuyabilir, aylik limitlere takilabilir ve canli ticari kullanim icin garanti vermez.

## Canli GIB entegrasyonuna gecis

1. `.env` icinde `USE_MOCK_INTEGRATIONS=false` yapin.
2. Trendyol `TRENDYOL_SELLER_ID`, `TRENDYOL_API_KEY`, `TRENDYOL_API_SECRET`, `TRENDYOL_USER_AGENT` alanlarini doldurun.
3. `INVOICE_PROVIDER=gib-direct` yapin.
4. GIB e-Arsiv test WSDL/servis, vergi kimlik, mali muhur/NES ve canli yetki bilgilerini `.env` icine ekleyin.
5. Muhasebeciyle KDV, fatura aciklamasi, teslim tarihine gore faturalandirma ve e-Arsiv kullanim statulerini netlestirin.

## GIB entegrasyon notu

GIB'in resmi kaynaklarinda e-Arsiv icin portal, ozel entegrasyon ve bilgi islem sistemi entegrasyonu yollari bulunur. Bu projede ozel entegrator yolu kullanilmaz. GIB portalinin gizli HTTP endpoint'lerine baglanan kirilgan bot yerine resmi entegrasyon yolu hedeflenir. Portal UI otomasyonu istenirse bu ayri bir risk karari olarak ele alinmalidir; varsayilan uygulama canli fatura icin resmi GIB web servis/onay surecini bekler.

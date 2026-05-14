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
- Harici e-Arsiv/Trendyol fatura sorgulama ve siparis eslestirme altyapisi
- GIB e-Arsiv Portal'a imzasiz taslak yukleme ve portaldan manuel toplu imza akisi
- Resmi GIB "Bilgi Islem Sisteminin Entegrasyonu" akisi icin `gib-direct` saglayici iskeleti
- Fatura PDF dosyasini saklama ve Trendyol'a PDF yukleme altyapisi
- PostgreSQL + Redis + BullMQ job altyapisi

Uygulama sahte siparis veya sahte fatura uretmez. Canli GIB entegrasyonu icin GIB test/onay sureci, web servis erisimi, mali muhur/NES imzalama altyapisi ve canli yetkilendirme tamamlanmalidir.

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
8. Fatura ekraninda secili taslaklari `GIB taslagina yukle` ile e-Arsiv Portal Duzenlenen Belgeler alanina taslak olarak aktarabilirsiniz.
9. `e-Arsiv ac` veya `Portal ac` ile tokenli portal oturumunu acin ve Duzenlenen Belgeler ekraninda taslaklari toplu imzalayin.
10. Imzadan sonra `e-Arsiv sorgula` ile kesilen resmi faturayi geri okuyup siparisle eslestirin.
11. Gerekirse taslak kartindaki `e-Arsiv XML` ciktisini kullanin.

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

## Firebase Hosting + Cloud Run

Kalici canli yayin hedefi Firebase Hosting arkasinda Cloud Run API'dir. Panel ayni Firebase linkinden acilir, `/api/**` istekleri Cloud Run'daki gercek Nest API servisi `safa-api` uzerinden calisir:

```bash
pnpm --filter @safa/web build:firebase
firebase deploy --only hosting --project safa-8f76e
```

Canli panel:

- https://safa-8f76e.web.app
- https://safa-8f76e.firebaseapp.com

Firebase Hosting yalnizca statik paneli yayinlar. Trendyol senkronizasyonu, PDF uretimi, sifreli baglanti kaydi ve veritabani islemleri Cloud Run'daki `apps/api` servisiyle, Firestore Native mode ve Cloud Storage mount'u ile calisir.

Cloud Run deploy hazirligi:

```bash
CONFIRM_DEPLOY=1 ./scripts/deploy-cloud-run-api.sh
```

Bu komut calistirilmadan once Cloud SQL verileri Firestore'a tasinmis ve Secret Manager degerleri hazir olmalidir. Ayrintili adimlar `docs/firebase-cloud-run.md` dosyasindadir.

Firebase build artik varsayilan olarak `NEXT_PUBLIC_API_BASE_URL=/api` kullanir; canli bundle icinde `http://localhost:4000/api` kalmamali. Bu nedenle arkadasiniz linkten girdiginde Chrome Local Network Access izni istememelidir.

Canli API public oldugu icin backend oturumu zorunludur. `/api/auth/login`, `/api/auth/logout` ve `/api/auth/session` disindaki API istekleri `HttpOnly`, `Secure`, `SameSite=Lax` session cookie olmadan `401` doner. Cloud Run'da `SAFA_ADMIN_PASSWORD` veya `SAFA_ADMIN_PASSWORD_HASH`, `SAFA_SESSION_SECRET` ve mevcut sifreli ayarlari korumak icin `APP_SECRET_KEY` Secret Manager'dan verilmelidir.

## Canli GIB entegrasyonu

1. Trendyol `TRENDYOL_SELLER_ID`, `TRENDYOL_API_KEY`, `TRENDYOL_API_SECRET`, `TRENDYOL_USER_AGENT` alanlarini doldurun veya panelden kaydedin.
2. `INVOICE_PROVIDER=gib-direct` canli saglayici yoludur.
3. Entegrasyonlar ekranindan GIB direct servis URL, VKN/TCKN, SOAP sablonu, fatura seri/sira, mali muhur/NES belge imzalama komutu, SOAP/WSS imzalama komutu ve GIB test/canli yetki teyitlerini kaydedin. Ayni bilgiler `.env` ile de verilebilir: `GIB_EARSIV_TAX_ID`, `GIB_EARSIV_SERVICE_URL`, `GIB_EARSIV_SIGNER_COMMAND`, `GIB_EARSIV_SOAP_SIGNER_COMMAND`, `GIB_EARSIV_SOAP_BODY_TEMPLATE` veya `GIB_EARSIV_SOAP_BODY_TEMPLATE_PATH`, `GIB_EARSIV_INVOICE_PREFIX`, `GIB_EARSIV_NEXT_SEQUENCE`, `GIB_EARSIV_TEST_ACCESS_CONFIRMED`, `GIB_EARSIV_PRODUCTION_ACCESS_CONFIRMED`, `GIB_EARSIV_AUTHORIZATION_REFERENCE`.
4. Imzalama komutlari `{input}` ve `{output}` alanlarini kullanir; SAFA once imzasiz UBL XML'i, sonra SOAP zarfini verir. Komutlar imzali UBL XML ve WSS imzali SOAP zarfini uretir.
5. Mevcut e-Arsiv portal erisimi harici fatura kayitlarini okumak ve siparislerle eslestirmek icin korunur; bu, daha once portalda kesilmis faturalar icin tekrar kesimi engeller.
6. GIB direct hazir degilken portal taslak yukleme akisi kullanilabilir: SAFA taslagi GIB portalina yukler, resmi imza ve onay portaldan manuel/toplu atilir.
7. Muhasebeciyle KDV, fatura aciklamasi, teslim tarihine gore faturalandirma, fatura seri/sira ve e-Arsiv kullanim statulerini netlestirin.

## GIB entegrasyon notu

GIB'in resmi kaynaklarinda e-Arsiv icin portal, ozel entegrasyon ve bilgi islem sistemi entegrasyonu yollari bulunur. Bu projede ozel entegrator yolu kullanilmaz. Canli fatura kesimi GIB direct servis + yerel mali muhur/NES/HSM belge ve SOAP/WSS imzalama komutlari uzerinden yapilir; eksik yetki veya imza varsa sistem sahte basarili sonuc uretmez, acik hata verir.

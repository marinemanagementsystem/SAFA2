# SAFA Arayüz İşlev ve Akış Rehberi

> Bu belge SAFA panelindeki **tüm sayfaların, sekmelerin, panellerin, filtrelerin, butonların ve satır
> aksiyonlarının** işlevini ve kullanım sırasını uçtan uca açıklar. Amaç: yeni bir kullanıcının paneli
> baştan sona anlayabilmesi. Etiketler arayüzde göründüğü şekliyle (Türkçe) yazılmıştır.

İçindekiler:
1. Genel kabuk (her sayfada görünen ortak alanlar)
2. Giriş ekranı
3. Genel (Operasyon merkezi)
4. Siparişler
5. Faturalar (3 sekme)
6. Entegrasyonlar
7. Kayıtlı Bilgiler
8. Operasyon
9. Ayarlar
10. Uçtan uca fatura akışı (sıra)
11. Kimlik bilgileri akışı (3 ekran ilişkisi)
12. Durum/renk sözlüğü

---

## 1. Genel kabuk (tüm sayfalarda ortak)

Her sayfa aynı çerçeve içinde açılır:

### Sol menü (yan navigasyon)
- Üstte marka kilidi: **S · SAFA · Commerce OS** (logoya tıklamak Genel sayfasına götürür).
- Menü öğeleri (sıra sabittir, her sayfada aynı isimle görünür):
  1. **Genel** → `/` — Canlı operasyon özeti
  2. **Siparişler** → `/orders` — Paket ve sipariş takibi
  3. **Faturalar** → `/invoices` — Taslak ve fatura akışı
  4. **Entegrasyonlar** → `/integrations` — Pazaryeri ve kargo bağlantıları
  5. **Kayıtlı Bilgiler** → `/saved-information` — Şifreli profil kasası
  6. **Operasyon** → `/operations` — Kuyruk, hata ve sync izleme
  7. **Ayarlar** → `/settings` — Runtime ve sağlayıcı durumu
- Altta **Bağlantı skoru**: API durumu ve kaç entegrasyonun canlı olduğunu (örn. "2/2 canlı" veya "API bekliyor") gösterir; yeşil/sarı nokta ile.

### Üst komut çubuğu (sağ üst, global aksiyonlar)
Her sayfada görünür ve şu butonları içerir:
1. **Yenile** — Tüm panel verisini sunucudan tazeler. (API yokken/yüklenirken devre dışı.)
2. **Trendyol çek** — Trendyol siparişlerini senkronize eder; ardından manuel fatura izlerini işler. (API yoksa "API bekleniyor" yazar.)
3. **e-Arşiv aç** — GIB e-Arşiv portalına oturumlu pencere açar.
4. **e-Arşiv çıkış** — GIB portal oturumunu güvenle kapatır.
5. **Çıkış** — Panel oturumunu kapatır (logout).

### Sistem şeridi
Komut çubuğunun altında bir bilgi şeridi: solda güncel durum mesajı, sağda mod rozeti
("Backend bağlantısı bekleniyor" / "Canlı entegrasyon modu" / "Canlı mod kontrol ediliyor").

### Mobil alt sekme çubuğu
Küçük ekranda alt kısımda 7 menü öğesi ikon + kısa etiketle (Genel, Sipariş, Fatura, Enteg., Kasa, Ops, Ayar).

---

## 2. Giriş ekranı (oturum açılmadıysa)

- Başlık: **Operasyon paneline giriş** (üst etiket: "Giriş gerekli").
- Alanlar: **Kullanıcı adı**, **Şifre**.
- Hatalı girişte kırmızı uyarı kutusu görünür.
- **Giriş yap** butonu (işlem sürerken devre dışı).

---

## 3. Genel (Operasyon merkezi) — `/`

Sayfa yukarıdan aşağıya:

### 3.1 Hero
- Başlık: **Bugünkü operasyon durumu**.
- Butonlar:
  - **Trendyol çek** — sipariş senkronizasyonu başlatır.
  - **Entegrasyonları gör** — `/integrations` sayfasına gider.
- **Operasyon akışı** görseli: Orders (sipariş sayısı) → Drafts (hazır+onaylı taslak) → Jobs
  (hata varsa "{n} hata" kırmızı, yoksa "Temiz").

### 3.2 Metrik kartları (4 adet)
1. **Teslim paket** — toplam sipariş sayısı.
2. **SAFA fatura kapsamı** — "{SAFA'da kesilen} / {harici bulunan}".
3. **Taslak kontrol** — "{hazır} / {onaylı}", ayrıca kaç tanesi harici kapalı.
4. **Sipariş hacmi** — filtrelenmemiş toplam tutar.

### 3.3 İki sütun
- **Canlı bağlantılar** (sol): aktif sağlayıcılar listesi + "Yönet" linki (→ /integrations).
- **Operasyon nabzı** (sağ): son iş olayı (durum + tip + hedef + zaman) + "Kuyruğa git" linki
  (→ /operations). Hiç iş yoksa "Kuyruk boş" boş durumu.

### 3.4 Fatura aksiyonları (hızlı yönlendirme şeritleri)
- **Bilinen faturası yok** ({sayı}) → /orders
- **Hazır taslak** ({sayı}) → /invoices
- **Hata sinyali** ({sayı}) → /operations

---

## 4. Siparişler — `/orders`

URL ile `?order=` / `?package=` verilirse ilgili sipariş otomatik seçilir.

### 4.1 Başlık
- "{gösterilen} kayıt gösteriliyor" + alt bilgi: toplam / portala aktarılabilir / kilitli sayıları.
- Sağda 3 buton:
  - **Toplu seçim** — satır seçim modunu açar/kapatır.
  - **Sütunlar** — sütun yönetimi panelini açar.
  - **Temizle** — tüm filtreleri sıfırlar.

### 4.2 Filtre çubuğu (6 kontrol)
1. **Arama** — sipariş, paket, alıcı, şehir, fatura no içinde arar.
2. **Fatura** (açılır): Tüm kayıtlar / SAFA'da kesilenler / Harici faturada bulunanlar /
   SAFA faturası bekleyenler / Bugün SAFA'da kesilenler / Önceki SAFA faturaları.
3. **Trendyol** (açılır): sipariş durumlarına göre (dinamik).
4. **Taslak** (açılır): Tüm taslaklar / Taslak yok / (dinamik taslak durumları).
5. **Tarih** (açılır): Tüm zamanlar / Bugün teslim / Son 7 gün / Son 30 gün.
6. **Şehir** (açılır): tüm şehirler (dinamik).

### 4.3 Sütun yönetimi paneli ("Sütunlar" ile açılır)
- **Görünüm profili**: profil seç (açılır) + **Görünümü kaydet** / **Yeni profil** / **Varsayılan**.
- **Sütun yönetimi**: her sütun için görünürlük onay kutusu, sürükleme tutamacı,
  **Yukarı taşı** / **Aşağı taşı**. Sütunlar: Seç, Paket, Sipariş, Teslim, Alıcı, Şehir, Tutar,
  Taslak, Fatura, PDF.

### 4.4 Toplu seçim çubuğu (seçim modunda)
- Sol: "{n} seçili" + "Toplu portal aktarımı" açıklaması (yalnız hazır/onaylı ve faturalanmamış seçilebilir).
- Sağ:
  - **Görünen aktarılabilirleri seç**
  - **Seçimi temizle**
  - **Seçilenleri portala aktar** — seçili taslakları e-Arşiv portalına yükler.

### 4.5 Liste (tablo) ve sütun bazlı filtreler
- Tablo başlıkları sıralanabilir (ok ikonu). İkinci satırda her sütun için ayrı filtre
  (şehir/taslak açılır, tutar için Min/Max, metin sütunları için arama kutusu).
- Sütun içerikleri:
  - **Seç**: onay kutusu (kilitliyse sebebi tooltipte).
  - **Paket / Sipariş / Teslim / Alıcı / Şehir / Tutar**: ilgili değer.
  - **Taslak**: durum rozeti (örn. "Fatura kesildi", "{kaynak} imzalı", taslak durumu).
  - **Fatura**: durum rozeti (örn. "{kaynak}: {no}", "Kesiliyor", "GIB imza bekliyor",
    "Kesim bekliyor", "Fatura hatası", "SAFA kaydı yok").
  - **PDF**: "PDF" (kesilen fatura) / "Taslak" (taslak PDF) / "PDF bekliyor" + "Fatura masası" linki.
- Mobilde kart listesi (aynı bilgiler kart halinde).
- Boş durumlar: hiç sipariş yoksa "Önce Trendyol çek işlemini çalıştırın."; filtreyle eşleşme
  yoksa "Bu filtrelerle kayıt bulunamadı."

### 4.6 Sağ detay paneli (satır seçilince)
- Üst: sipariş no + paket no.
- İstatistikler: **Alıcı**, **Fatura adresi**, **Toplam** (+indirim), **Teslim**, **Fatura**.
- Aksiyonlar: **Fatura masası** (→ /invoices), **Fatura PDF** / **Taslak PDF** (duruma göre), durum rozeti.
- Uyarılar (varsa), **Harici faturalar** listesi, **Ürün satırları** listesi, ham Trendyol verisi (açılır).

---

## 5. Faturalar — `/invoices`

En kapsamlı ekran. Üstte her zaman görünen ortak alanlar, altında **3 sekme** vardır.

### 5.1 Hero komut çubuğu (her sekmede görünür)
1. **Yenile** — fatura verisini tazeler.
2. **e-Arşiv aç** — GIB portalını oturumlu açar.
3. **Güvenli çıkış** — portal oturumunu kapatır.
4. **Kontrol et ve uygula** (birincil) — son 7 günün portalda imzalı faturalarını **sorgular ve
   güvenli eşleşenleri otomatik arşive uygular** (iki adımı tek tıkta birleştirir).

### 5.2 Uyarı şeridi + Otomasyon koruması
- Uyarı: "PDF arşivi boş çünkü resmi fatura henüz oluşmadı." + "{imza} imza · {pdf} PDF" rozeti.
- **Free-tier otomasyon koruması** paneli: güncellik durumu, bütçe ("{n}/{limit} otomatik çalışma"),
  son GIB/Trendyol kontrol zamanları, sonraki otomatik kontrol. **Şimdi güncelle** butonu manuel
  çalıştırır (bütçe dolduysa devre dışı).

### 5.3 Metrik / kuyruk kartları (5 adet — tıklanınca listeyi filtreler)
1. **Son 7 gün öncelik** — operatör aksiyonu bekleyen kayıt (kırmızı).
2. **Portal imza bekliyor** — GIB sorgusu/portal imzası gerekli (sarı).
3. **PDF arşivi boş** — arşive düşmeyen resmi PDF eksiği (kırmızı).
4. **Harici e-Arşiv eşleşti** — SAFA arşivine alınabilecek kayıt (nötr).
5. **Trendyol gönderimi** — PDF hazır veya pazaryeri hatası (yeşil).
Karta tekrar tıklamak filtreyi kaldırır (aç/kapa).

### 5.4 Sekme çubuğu
- **Liste / İş akışı**
- **Arşiv & İndirmeler** (bekleyen iş varsa sayı rozeti)
- **Dış kaynak faturalar**

---

### 5.5 SEKME 1 — Liste / İş akışı

Üç bölmeli çalışma alanı:

**Sol: İş kuyruğu**
- Ay göstergesi (salt görünüm), **Durum** ("Aksiyon bekleyenler"), **Arama** kutusu.
- Filtre varsa **Filtre temizle**.
- Kuyruk öğeleri (PDF eksik, Portal imza, Harici eşleşti, Trendyol) — tıklayınca listeyi filtreler.

**Orta: Birleşik fatura takibi tablosu**
- Başlık: "Taslak › GIB › PDF › Pazaryeri". Sağda **Son 7 gün eşleşenleri uygula**.
- Portal imza takip raporu (sorgu sonrası görünür): kaç kayıt kontrol edildi, imzalı bulundu,
  arşive alındı, PDF bekliyor, Trendyol'a gönderildi/hata.
- Araç çubuğu: **Arama**; segment filtre **Tümü / Eksik / Tamam**; ikon butonlar
  **Trendyol izi ara** ve **Tekrar eşleştir**.
- **Toplu işlem çubuğu**: "{n} seçili" durumu + yardım metni; butonlar:
  - **{n} taslağı seç** / **Seçilebilirleri bırak**
  - **Seçimi temizle**
  - **Seçiliyi onayla** (zaten onaylıysa "Zaten onaylı")
  - **Onaylıları GIB'e yükle** (duruma göre "Önce onay gerekli" / "{n} onaylıyı yükle")
- Tablo sütunları (sırayla): **Öncelik** (seçim kutusu + 1/2/3/OK), **Kayıt** (durum + sipariş +
  müşteri + paket + fatura no), **Akış** (Taslak→GIB→PDF→Pazaryeri rayı), **GIB / PDF** (iki rozet),
  **Pazaryeri** (rozet), **Tutar**.
- Satıra tıklamak detay panelini açar. Mobilde kart listesi.
- Boş durum: hiç hareket yoksa "Henüz fatura hareketi yok"; filtre boşsa "Filtreyle eşleşen kayıt yok".

**Satır başına tek kanonik aksiyon** (kaydın durumuna göre otomatik belirlenir):
| Aksiyon | Etiket | Ne zaman |
|---|---|---|
| approve | **Taslağı onayla** | Taslak hazır (READY) |
| portal | **GIB taslağına yükle** | Taslak onaylı (APPROVED) |
| retry | **Tekrar dene** | İş başarısız / hata |
| preview-signed | **İmzalıları sorgula** / **PDF'i tekrar kontrol et** | Portal taslağı / PDF eksik |
| promote/apply-external | **Arşive al** | Harici fatura eşleşti, arşive alınmadı |
| upload-pdf | **Resmi PDF yükle** | Harici kaydın PDF'i eksik |
| send-trendyol | **Trendyol'a gönder** | PDF hazır, gönderim bekliyor |
| open-portal | **Portalda aç** | Portal taslağı, manuel imza bekliyor |
| view-order | **Siparişe git** | Geçmiş kayıt |
| none | **Tamam** | Tüm adımlar tamam |

**Sağ: Detay paneli (slide-over)**
- Üst: durum rozeti + sipariş no + paket/müşteri + öncelik.
- **Zaman tüneli**: Taslak → GIB → PDF → Pazaryeri olaylarının açıklaması ve renkleri.
- "Bu kayıt neden böyle görünüyor?" açıklaması.
- Aksiyonlar: o kayda özel birincil aksiyon (yukarıdaki tablo) + **Portalda aç** + **Güvenli çıkış**
  + **Siparişe git**.
- Denetim bilgisi: **Kaynak** (Harici/Resmi fatura/Taslak), **Fatura no**, **Tutar**.
- PDF önizleme alanı (PDF hazır olunca dolar).
- Kayıt seçilmemişse: "Seçilecek fatura yok" boş durumu.

---

### 5.6 SEKME 2 — Arşiv & İndirmeler

- Başlık + **Temizle** (arşiv filtrelerini sıfırlar).
- Tasarım kararları açıklaması (3 madde).
- **Arşiv filtre çubuğu**:
  - **Aylık arşiv** (ay seçici).
  - **Aylık Excel indir** — seçili ayın Excel'ini indirir (ay seçilmemişse pasif).
  - **ZIP oluştur/indir** — seçili ayın arşiv ZIP'ini oluşturur ve indirir.
  - **Arama**, **Durum** (Tüm faturalar + durumlar), **Tarih** (Tüm zamanlar / Bugün kesilen / Son 7 gün / Son 30 gün).
- Aylık arşiv sonucu (oluşturulduysa): kaç resmi fatura, eksik PDF/XML, dosya adı.
- Uyarılar: portalda imzalı ama arşivlenmemiş kayıtlar; PDF bekleyen kayıtlar.
- **Fatura listeleri**:
  - **Bugün kesilenler**
  - **Önceki faturalar** (en fazla 12)
  - Her satır: durum rozeti, fatura no, sipariş/kaynak/tarih bilgisi, hata (varsa); satır aksiyonları:
    **PDF** (indir) / "PDF bekliyor", **Trendyol'a gönder** (PDF hazırsa), **Siparişe git**.
  - Boş bölüm: "Bu bölümde fatura yok."

---

### 5.7 SEKME 3 — Dış kaynak faturalar

- Başlık: "{n} dış fatura kaydı" + "{n} eşleşme" rozeti + **Temizle**.
- **Sorgu/işlem butonları**:
  - **Son 7 gün imzalılarını kontrol et** — GIB portalını sorgular.
  - **Son 7 gün güvenli olanları uygula** — doğrulanmış eşleşmeleri arşive alır.
  - **Trendyol fatura izi ara** — Trendyol sipariş verisinde fatura izi arar.
  - **Tekrar eşleştir** — tüm dış faturalar için eşleştirmeyi yeniden çalıştırır.
- **İçe aktarma formu**:
  - **Kaynak**: e-Arşiv Portal / Trendyol / Diğer gerçek kaynak.
  - **Gerçek fatura listesi (JSON veya CSV)** metin alanı (CSV: `faturaNo;tarih;alıcı;vknTckn;tutar;siparişNo`).
  - **Listeyi al ve eşleştir** — listeyi içe alır ve siparişlerle eşleştirir.
- **Dış fatura listesi** + filtreler (Arama / Kaynak: Tüm/e-Arşiv/Trendyol/Manuel / Eşleşme: Tüm/Eşleşenler/Açık kalanlar).
- Satır içeriği ve aksiyonları:
  - Durum rozeti: **Arşivde** / **Eşleşti** / **Açık**.
  - Eşleşmemişse: manuel eşleştirme kutusu + **Eşleştir**.
  - Eşleşmişse (GIB_PORTAL): **Arşive al**, **Trendyol'a gönder**, gerekiyorsa **Resmi PDF yükle**;
    ayrıca **Siparişe git**.
  - İlk 40 kayıt gösterilir; aramayla daraltılır.

---

### 5.8 (Faturalar) tipik kullanım sırası
Liste/İş akışı sekmesinde günlük iş yürür; Arşiv & İndirmeler ikincil kontrol/indirme; Dış kaynak
faturalar portal/Trendyol/manuel kayıt eşleştirme içindir. Uçtan uca sıra bölüm 10'da.

---

## 6. Entegrasyonlar — `/integrations`

### 6.1 Profil kasası (üst)
- "Kayıtlı profilden doldur": kasa kapalıysa **Kasa seç** + **Kasa şifresi** + **Kasayı aç** / **Yeni kasa**.
- Kasa açıkken: **Aktif kasa** (salt görünüm) + **Profil seç** (formları otomatik doldurur) + **Kilitle**.
- Hiç kasa yoksa "Kayıtlı Bilgiler'e git" yönlendirmesi.

### 6.2 Otomasyon güncelliği
Durum rozeti + bütçe açıklaması + **Şimdi çalıştır** (manuel otomasyon; bütçe dolduysa pasif).

### 6.3 Bağlantı kartları (4 adet — tıklayınca modal açılır)
1. **Trendyol** (Pazaryeri) — durum: Bağlı / Taslak kayıtlı / Bekliyor.
2. **Hepsiburada** (Pazaryeri).
3. **e-Arşiv Portal** (Fatura).
4. **GIB Direct** (Fatura) — durum: Bağlı / Eksik ayar.

### 6.4 Trendyol paneli (modal)
- Alanlar: **Satıcı ID**, **API Key**, **API Secret**, **Storefront**, **Gün** (1–90), **User-Agent**.
- Butonlar: **Partner aç** (Trendyol partner portalını açar), **Bağlan** (kaydeder).

### 6.5 Hepsiburada paneli (modal)
- Bağlantı: **Merchant ID**, **Ortam** (Test/Canlı), **User**, **Password**, **User-Agent**, **Gün**, **OMS URL** → **Bağlan**.
- Ürün formu: **Ürün adı**, **Merchant SKU**, **HB SKU**, **Barkod**, **Fiyat**, **Stok**, **Marka**,
  **Kategori** → **Ürün ekle** / **Ürünü güncelle** (+ **Yeni kayıt**).
- İş şeritleri:
  - **1 · Katalog**: **Katalog gönder** + (trackingId) **Sorgula**.
  - **2 · Stok / fiyat**: **Envanter**, **Fiyat**, **Stok**.
  - **3 · Sipariş**: **Test sipariş**, **Sipariş çek**.
- Ürün tablosu (Ürün / SKU / Fiyat / Stok / Durum + **Düzenle**).
- Sipariş kalemleri tablosu (Sipariş / Kalem / Müşteri / Paket + **Paketle**).

### 6.6 e-Arşiv Portal paneli (modal)
- Alanlar: **Kullanıcı**, **Şifre**, **Portal URL**, **PDF fallback** (GIB PDF alınamazsa imzalı
  kayıttan kopya üret) onay kutusu.
- Butonlar: **Portal aç**, **Güvenli çıkış**, **Bağlan**.

### 6.7 GIB Direct paneli (modal)
- Eksik alan varsa kırmızı uyarı.
- Alanlar: **Ortam**, **VKN/TCKN**, **GIB servis URL**, **WSDL URL**, **SOAP Action**,
  **SOAP gövde şablonu**, **SOAP şablon dosya yolu**, **Mali mühür/NES imzalama komutu**,
  **SOAP/WSS imzalama komutu**, **Fatura seri prefix**, **Sıradaki numara**, **Birim kodu**,
  **Varsayılan alıcı TCKN**, **mTLS PFX yolu**, **mTLS şifre**, **GIB izin referansı**,
  **Yetki teyitleri** (Test / Canlı).
- Buton: **GIB direct bağlan**.

### 6.8 Sağlayıcı bölümleri (alt)
Planlı adapterler: **Pazaryeri adaptörleri**, **Fatura sağlayıcıları**, **Kargo firmaları**
(Aktif / Adapter planlandı durumlarıyla).

---

## 7. Kayıtlı Bilgiler — `/saved-information`

Şifreli kasa/profil yönetimi. Bilgiler tarayıcıda **AES-256-GCM** ile şifrelenir (parola türevli
PBKDF2 anahtar) ve Firestore'a senkronlanır.

### 7.1 Kasa oluşturma
- **Kasa adı**, **Kasa şifresi** (min 8), **Şifre tekrar** → **Kasa oluştur** (+ "Kasa listesine dön").

### 7.2 Kasa kilitliyken
- **Kasa seç** + **Kasa şifresi** → **Kasayı aç**; **Yeni kasa**.
- **Seçili kasayı sıfırla** (şifre unutulduysa yalnız o kasayı siler; onay ister).

### 7.3 Kasa açıkken (iki sütun)
**Sol — Profil düzenleme**
- Üstte **Yeni kasa** / **Kilitle**.
- **Profil adı** + bloklar:
  - Trendyol: **Satıcı ID**, **API key**, **API secret**.
  - GIB Portal: **GIB kullanıcı**, **GIB şifre**, **GIB portal URL**.
  - GIB Direct: **VKN/TCKN**, **Fatura seri prefix**, **Servis URL**, **Mali mühür/NES imzalama
    komutu**, **SOAP/WSS imzalama komutu**, **GIB izin referansı**, **Yetki teyitleri** (Test/Canlı).
- **Formdan al** (mevcut form değerlerini taslağa kopyalar) + **Profili kaydet**.

**Sağ — Profil listesi**
- Her profil kartı: ad + özet (Trendyol/GIB/Direct) + **Aktif yap** (zaten aktifse "Aktif") + **Sil**.
- Boş durum: "Henüz profil yok. İlk profili soldaki formdan kaydedin."

---

## 8. Operasyon — `/operations`

### 8.1 Metrik şeridi (6 kart — tek kaynak)
**Hata** · **Bekleyen iş** · **Kontrol gerekli** · **Bilinen faturası yok** · **Portal takip** · **PDF bekleyen**.

### 8.2 İş kuyruğu (Son denemeler)
Son 16 iş zaman tünelinde: durum rozeti, "{sipariş} fatura süreci", müşteri/paket,
**Tekrar dene** (başarısız işte), süreç çubuğu, hata mesajı, zaman + deneme sayısı.
Boş durum: "Kuyruk boş".

### 8.3 Operasyon modeli notu
"Adapter-hazır operasyon modeli" açıklaması.

---

## 9. Ayarlar — `/settings`

Salt-okunur durum ekranı (giriş alanı yok).

### 9.1 Çalışma modu
**Backend API**, **Entegrasyon modu**, **Fatura sağlayıcı**, **Yükleme durumu**, **Saklama dizini**.

### 9.2 Bağlantı durumu (sağlık)
**Trendyol**, **GIB e-Arşiv Portal**, **GIB direct**, **Trendyol API** — her biri Bağlı / Taslak kayıtlı /
Bekliyor gibi durum gösterir.

### 9.3 Platform sınırı / İlk faz kararları
Yeni pazaryeri/kargo (katalogda görünür, canlı çağrı yok), mevcut yetenekler, auth kapsamı açıklamaları.

---

## 10. Uçtan uca fatura akışı (sıra)

1. **Taslak oluşma** — Sipariş gelince SAFA taslak üretir (READY/NEEDS_REVIEW).
2. **Onay** — Liste/İş akışında **Seçiliyi onayla** (veya satırda **Taslağı onayla**) → APPROVED.
3. **Portala yükleme** — **Onaylıları GIB'e yükle** (veya satırda **GIB taslağına yükle**) → PORTAL_DRAFTED.
4. **Portalda imza** — **e-Arşiv aç** → portalda "Düzenlenen Belgeler"de taslakları toplu imzala.
5. **Kontrol et ve uygula** — Hero'daki tek butonla (veya Dış kaynak sekmesinde sorgula + uygula)
   imzalı faturalar SAFA arşivine alınır.
6. **PDF gelmesi** — PDF hazır olunca kayıt "PDF alındı" olur (gerekirse **PDF'i tekrar kontrol et**).
7. **Trendyol'a gönderme** — PDF hazırsa **Trendyol'a gönder** → TRENDYOL_SENT (Tamam).
- **Hata** olursa kayıt kırmızı olur; sebebi detay panelinde görünür; **Tekrar dene** ile yeniden işlenir.
- **Harici fatura** zaten varsa SAFA yeniden kesmez; Dış kaynak sekmesinde eşleştirilip **Arşive al** ile arşive alınır.

---

## 11. Kimlik bilgileri akışı (3 ekranın ilişkisi)

- **Kayıtlı Bilgiler** = şifreli **depo**: profiller burada oluşturulup şifreli kasada saklanır.
- **Entegrasyonlar** = **canlı bağlantı**: kasadan profil seçilerek formlar otomatik dolar; **Bağlan**
  ile bilgiler backend'e kaydedilir. Portal/partner pencereleri buradan açılır.
- **Ayarlar** = **salt-okunur durum**: hangi bağlantının tanımlı/canlı olduğunu gösterir.

Tipik sıra: Kayıtlı Bilgiler'de kasa oluştur → profil kaydet → Entegrasyonlar'da kasayı aç, profili
seç, **Bağlan** → Ayarlar'da "Bağlı" durumunu doğrula.

---

## 12. Durum / renk sözlüğü

- **Yeşil (success)**: tamam, onaylı, imzalı, bağlı.
- **Sarı (warning)**: bekliyor, aksiyon gerekli, işleniyor.
- **Kırmızı (danger)**: hata, başarısız, eksik.
- **Gri (nötr)**: geçmiş kayıt, aksiyon gerekmez.

Para birimi Türk Lirası (TRY) varsayılır; tarih/saat Europe/Istanbul; "son 7 gün" öncelik penceresidir.

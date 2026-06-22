# SAFA UI v2 — Parity Matrix (islev koruma sozlesmesi)

Tarih: 2026-06-22
Branch: `redesign/safa-ui-v2` (taban `origin/main` @ 8ee6be2)
Kaynaklar: `docs/SAFA-arayuz-islev-rehberi.md` + `docs/safa-sayfa-islev-envanteri.md`

## Amac

Gorsel sifirdan yeniden tasarlanacak; **is mantigi degismeyecek.** Bu tablo, mevcut
arayuzdeki HER kullanici islevini, arkadaki handler/API'siyle birlikte listeler. Kural:

- UI implementasyonuna gecmeden once bu tablo eksiksiz olmali.
- Her satir v2'de bir yere oturmali (`Yeni yer (v2)` sutunu tasarim asamasinda dolar).
- Hicbir islev "korunacak" statusunu kaybetmeden silinemez. Silinmesi gerekiyorsa gerekce yazilir.
- `frozen` katman (degismez kontrat): `usePlatformData`, `api.ts`, endpoint sozlesmeleri,
  fatura state machine (`invoice-operation-model`, `invoice-bulk-selection`, `invoice-desk` mantigi),
  `automation-status-model`, `gib-portal-sync-window`, `order-view-state`, kasa/sifreleme mantigi.

Durum kodlari: `korunacak` (birebir) · `tasarlanacak` (yeni yer netlesecek) · `birlestir` (baska islevle) · `kaldir` (gerekce ile).

---

## 0. Oturum ve kabuk (her sayfa)

| # | Islev | Eski yer | Handler / API | Yeni yer (v2) | Durum |
|---|---|---|---|---|---|
| 0.1 | Giris yap | AuthGate login formu | `api.login` → `POST /api/auth/login` | — | korunacak |
| 0.2 | Oturum kontrol | uygulama acilisi | `api.authSession` → `GET /api/auth/session` | — | korunacak |
| 0.3 | Cikis | shell ust komut | `api.logout` → `POST /api/auth/logout` | — | korunacak |
| 0.4 | Offline dev session (sarper) | AuthGate (prod disi) | yerel state | — | korunacak |
| 0.5 | Sol navigasyon (7 oge) | shell | `NAV_ITEMS` route gecisi | — | korunacak |
| 0.6 | Logo → ana sayfa | shell brand-lockup | `Link href="/"` | — | korunacak |
| 0.7 | Baglanti skoru / Operasyon kilidi footer | shell alt | `connected/2`, apiAvailable | — | korunacak |
| 0.8 | Mobil tabbar (7 oge) | shell mobil | NAV_ITEMS mobileLabel | — | tasarlanacak |
| 0.9 | Sistem ribbon (mesaj + mod rozeti) | shell | `usePlatformData.message`, apiAvailable/isLiveMode | — | korunacak |
| 0.10 | Yenile (global) | shell ust komut | `fetchPlatformSnapshot` (coklu GET) | — | korunacak |
| 0.11 | Trendyol cek (global) | shell ust komut | `startTrendyolSyncJob` + polling → `POST /api/sync/trendyol/jobs`, `POST /api/jobs/:id/run-next` | — | korunacak |
| 0.12 | e-Arsiv ac (global) | shell ust komut | `openEarsivPortalSession` / `...ProxySession` → `POST /api/earsiv-portal/open-session`, `.../proxy-session` | — | korunacak |
| 0.13 | e-Arsiv cikis (global) | shell ust komut | `logoutEarsivPortalSession` → `POST /api/earsiv-portal/logout-session` | — | korunacak |
| 0.14 | Snapshot veri grubu (orders/invoices/drafts/settings/connections/external/jobs/automation/products/hb-order-lines) | usePlatformData | coklu GET | — | korunacak (frozen) |
| 0.15 | Offline/localStorage taslak davranisi | usePlatformData | localStorage | — | korunacak |

---

## 1. Genel / Operasyon merkezi (`/`)

| # | Islev | Eski yer | Handler / API | Yeni yer (v2) | Durum |
|---|---|---|---|---|---|
| 1.1 | Hero metrikleri (ready/approved/external/issued/failedJobs/revenue) | overview hero | turetilmis (snapshot) | — | korunacak |
| 1.2 | Trendyol cek | hero buton | `syncOrders` | — | korunacak |
| 1.3 | Entegrasyonlari gor | hero link | `/integrations` | — | korunacak |
| 1.4 | Platform metrik kartlari (4) | overview | turetilmis | — | tasarlanacak |
| 1.5 | Canli baglantilar + Yonet | overview | katalog + `/integrations` | — | korunacak |
| 1.6 | Operasyon nabzi + Kuyruga git | overview | son job + `/operations` | — | korunacak |
| 1.7 | Fatura aksiyon seritleri (Bilinen faturasi yok / Hazir taslak / Hata sinyali) | overview | `/orders`, `/invoices`, `/operations` | — | korunacak |

---

## 2. Siparisler (`/orders`)

| # | Islev | Eski yer | Handler / API | Yeni yer (v2) | Durum |
|---|---|---|---|---|---|
| 2.1 | URL ile otomatik odak (`?order=`, `?package=`) | orders | order-view-state | — | korunacak |
| 2.2 | Baslik sayaci (gosterilen/toplam/aktarilabilir/kilitli) | orders baslik | turetilmis | — | korunacak |
| 2.3 | Toplu secim modu | orders ust | selection state | — | korunacak |
| 2.4 | Sutunlar/gorunum profili paneli | orders ust | Firestore `safaOrderViewProfiles` + localStorage | — | korunacak |
| 2.5 | Temizle (filtre sifirla) | orders ust | order-view-state | — | korunacak |
| 2.6 | 6 ust filtre (arama/fatura/trendyol/taslak/tarih/sehir) | orders filtre dock | order-view-state | — | korunacak |
| 2.7 | Kolon yonetimi (gizle/sirala/drag/yukari-asagi) | sutun paneli | order-view-state | — | korunacak |
| 2.8 | Gorunum profili kaydet/yeni/varsayilan | sutun paneli | Firestore + localStorage | — | korunacak |
| 2.9 | Sortable kolonlar + kolon-bazli filtreler | tablo | order-view-state | — | korunacak |
| 2.10 | Taslak/Fatura durum etiketleri (pill) | tablo | turetilmis | — | korunacak |
| 2.11 | PDF / Taslak / Fatura masasi linkleri | tablo PDF kolon | `draftPdfUrl`, `invoicePdfUrl`, `/invoices?...` | — | korunacak |
| 2.12 | Mobil kart listesi | orders mobil | — | — | tasarlanacak |
| 2.13 | Bos durumlar (Once Trendyol cek / kayit bulunamadi) | tablo | — | — | korunacak |
| 2.14 | Toplu portal aktarim bar (sec/temizle/aktar) | selection bar | `uploadPortalDrafts` → `POST /api/invoice-drafts/gib-portal-drafts` | — | korunacak |
| 2.15 | Aktarilabilirlik kurallari + kilit nedenleri | selection | invoice-bulk-selection | — | korunacak (frozen) |
| 2.16 | Siparis detay paneli (alanlar + ham Trendyol) | orders sag panel | `api.order` → `GET /api/orders/:id` | — | korunacak |
| 2.17 | Detay aksiyonlari (Fatura masasi/PDF/Taslak PDF) | detay panel | linkler + PDF url | — | korunacak |

---

## 3. Faturalar (`/invoices`)

### 3.0 Hero ve sekmeler

| # | Islev | Eski yer | Handler / API | Yeni yer (v2) | Durum |
|---|---|---|---|---|---|
| 3.0.1 | Yenile | hero | `fetchPlatformSnapshot` | — | korunacak |
| 3.0.2 | e-Arsiv ac | hero | `openEarsivPortalSession` | — | korunacak |
| 3.0.3 | Guvenli cikis | hero | `logoutEarsivPortalSession` | — | korunacak |
| 3.0.4 | Kontrol et ve uygula (preview+apply) | hero primary | `previewGibExternalInvoices` + `startGibApplyJob` → `.../gib-portal/preview`, `.../gib-portal/apply/jobs` | — | korunacak |
| 3.0.5 | 3 sekme (Liste/Is akisi · Arsiv & Indirmeler · Dis kaynak) | tab bar | invoice-desk-tabs mantigi | — | tasarlanacak |
| 3.0.6 | Uyari bandi + imza/PDF sayaclari | hero alt | turetilmis | — | korunacak |
| 3.0.7 | Otomasyon koruma paneli + Simdi guncelle | hero alt | `runAutomationNow` → `POST /api/automation/run-now`; automation-status-model | — | korunacak |
| 3.0.8 | 5 metrik/kuyruk karti (filtre) | hero alt | invoice-operation-model | — | korunacak |

### 3.1 Liste / Is akisi sekmesi

| # | Islev | Eski yer | Handler / API | Yeni yer (v2) | Durum |
|---|---|---|---|---|---|
| 3.1.1 | Sol is kuyrugu (kapsam/durum/arama/temizle/kuyruk listesi) | tab1 sol | invoice-operation-model | — | korunacak |
| 3.1.2 | Birlesik takip tablosu (Taslak>GIB>PDF>Pazaryeri) | tab1 orta | invoice-operation-model | — | tasarlanacak |
| 3.1.3 | Son 7 gun eslesenleri uygula | tablo header | `startGibApplyJob` | — | korunacak |
| 3.1.4 | Segment filtre (Tumu/Eksik/Tamam) + arama | tablo | invoice-operation-model | — | korunacak |
| 3.1.5 | Toplu taslak bar (sec/temizle/onayla/GIB'e yukle) | tablo | `api.approve` → `POST /api/invoice-drafts/:id/approve`; `uploadPortalDrafts` | — | korunacak |
| 3.1.6 | Toplu secim kosullari + kilit nedenleri | tablo | invoice-bulk-selection | — | korunacak (frozen) |
| 3.1.7 | Satir tek-kanonik aksiyon (approve/portal/retry/preview-signed/promote/upload-pdf/send-trendyol/open-portal/view-order/none) | tablo satir | invoice-operation-model next-action | — | korunacak (frozen) |
| 3.1.8 | Satir tikla → detay; mobil kart | tablo | — | — | tasarlanacak |
| 3.1.9 | Bos durumlar (Henuz hareket yok / filtre bos) | tablo | — | — | korunacak |
| 3.1.10 | Detay paneli (timeline/neden/aksiyon/Portalda ac/Guvenli cikis/Siparise git/audit/PDF onizleme) | sag panel | invoice-operation-model | — | korunacak |
| 3.1.11 | Detay bos durum (Secilecek fatura yok) | sag panel | — | — | korunacak |
| 3.1.12 | Tekrar dene (failed) | satir/detay | `api.issue` → `POST /api/invoices/issue` | — | korunacak |

### 3.2 Arsiv & Indirmeler sekmesi

| # | Islev | Eski yer | Handler / API | Yeni yer (v2) | Durum |
|---|---|---|---|---|---|
| 3.2.1 | Temizle (arsiv filtre) | tab2 ust | local state | — | korunacak |
| 3.2.2 | Aylik arsiv (ay secici) | tab2 bar | — | — | korunacak |
| 3.2.3 | Aylik Excel indir | tab2 bar | `monthlyInvoiceExcelUrl` → `GET /api/invoices/monthly-export.xlsx` | — | korunacak |
| 3.2.4 | ZIP olustur/indir | tab2 bar | `createMonthlyInvoiceArchive` → `POST /api/invoices/monthly-archives`; download url | — | korunacak |
| 3.2.5 | Arama/Durum/Tarih filtreleri | tab2 bar | local state | — | korunacak |
| 3.2.6 | ZIP sonuc + imzali/PDF bekleyen uyarilari | tab2 | turetilmis | — | korunacak |
| 3.2.7 | Bugun kesilenler / Onceki faturalar listeleri | tab2 | snapshot | — | tasarlanacak |
| 3.2.8 | Satir aksiyonlari (PDF / Trendyol'a gonder / Siparise git) | tab2 satir | `invoicePdfUrl`; `sendInvoiceToTrendyol` → `POST /api/invoices/:id/send-to-trendyol`; `/orders?order=` | — | korunacak |

### 3.3 Dis kaynak faturalar sekmesi

| # | Islev | Eski yer | Handler / API | Yeni yer (v2) | Durum |
|---|---|---|---|---|---|
| 3.3.1 | Temizle (external filtre) | tab3 ust | local state | — | korunacak |
| 3.3.2 | Son 7 gun imzalilarini kontrol et | tab3 araclar | `previewGibExternalInvoices` → `.../gib-portal/preview` | — | korunacak |
| 3.3.3 | Son 7 gun guvenli olanlari uygula | tab3 araclar | `startGibApplyJob` → `.../gib-portal/apply/jobs` | — | korunacak |
| 3.3.4 | Trendyol fatura izi ara | tab3 araclar | `startTrendyolExternalInvoiceJob` → `.../trendyol/jobs` | — | korunacak |
| 3.3.5 | Tekrar eslestir | tab3 araclar | `reconcileExternalInvoices` → `POST /api/external-invoices/reconcile` | — | korunacak |
| 3.3.6 | Manuel import formu (kaynak + JSON/CSV) | tab3 form | `importExternalInvoices` → `POST /api/external-invoices/import` | — | korunacak |
| 3.3.7 | Harici liste filtreleri (arama/kaynak/eslesme) | tab3 | local state | — | korunacak |
| 3.3.8 | Manuel eslestir | tab3 satir | `matchExternalInvoice` → `POST /api/external-invoices/:id/match` | — | korunacak |
| 3.3.9 | Arsive al (promote) | tab3 satir | `promoteExternalInvoice` → `POST /api/external-invoices/:id/promote` | — | korunacak |
| 3.3.10 | Arsive al + Trendyol'a gonder | tab3 satir | `promoteAndSendExternalInvoice` → `.../promote-and-send-to-trendyol` | — | korunacak |
| 3.3.11 | Resmi PDF yukle | tab3 satir | `uploadExternalInvoicePdf` → `POST /api/external-invoices/:id/pdf` | — | korunacak |
| 3.3.12 | Siparise git | tab3 satir | `/orders?order=` | — | korunacak |

---

## 4. Entegrasyonlar (`/integrations`)

| # | Islev | Eski yer | Handler / API | Yeni yer (v2) | Durum |
|---|---|---|---|---|---|
| 4.1 | Profil kasasi picker (ac/kilitle/profil sec) | ust | kasa modeli (AES-GCM/Firestore) | — | korunacak (frozen) |
| 4.2 | Otomasyon guncelligi + Simdi guncelle | ust | `runAutomationNow` | — | korunacak |
| 4.3 | 4 baglanti karti → modal | kartlar | — | — | tasarlanacak |
| 4.4 | Trendyol baglan | modal | `connectTrendyol` → `PUT /api/settings/connections/trendyol/connect` | — | korunacak |
| 4.5 | Trendyol Partner ac | modal | popup | — | korunacak |
| 4.6 | Hepsiburada baglan | modal | `connectHepsiburada` → `PUT .../hepsiburada/connect` | — | korunacak |
| 4.7 | Hepsiburada urun ekle/guncelle | modal | `createProduct`/`updateProduct` → `POST/PUT /api/products` | — | korunacak |
| 4.8 | HB katalog gonder + status | modal | `hepsiburadaCatalogUpload`/`...Status` | — | korunacak |
| 4.9 | HB envanter/fiyat/stok | modal | `hepsiburadaListingSync`/`PriceUpload`/`StockUpload` | — | korunacak |
| 4.10 | HB siparis cek + test siparis | modal | `hepsiburadaOrdersSync`/`CreateTestOrder` | — | korunacak |
| 4.11 | HB paketle | modal tablo | `hepsiburadaPackageOrderLine` → `.../order-lines/:id/package` | — | korunacak |
| 4.12 | e-Arsiv Portal baglan + PDF fallback | modal | `connectGibPortal` → `PUT .../gib-portal/connect`; `saveSetting` → `PUT /api/settings` | — | korunacak |
| 4.13 | e-Arsiv Portal ac / Guvenli cikis | modal | portal session | — | korunacak |
| 4.14 | GIB Direct baglan (tum alanlar) | modal | `connectGibDirect` → `PUT .../gib-direct/connect` | — | korunacak |
| 4.15 | Adapter kataloglari (pazaryeri/fatura/kargo, aktif+planli) | alt | statik katalog | — | korunacak |

---

## 5. Kayitli Bilgiler (`/saved-information`)

| # | Islev | Eski yer | Handler / API | Yeni yer (v2) | Durum |
|---|---|---|---|---|---|
| 5.1 | Kasa olustur (ad/sifre/tekrar + validasyon) | olusturma | AES-GCM + Firestore `safaVaults` | — | korunacak (frozen) |
| 5.2 | Kasa ac (kilitli ekran) | kilitli | PBKDF2 cozme | — | korunacak (frozen) |
| 5.3 | Secili kasayi sifirla | kilitli | local + Firestore sil | — | korunacak |
| 5.4 | Yeni kasa / Kilitle | acik | session temizle | — | korunacak |
| 5.5 | Profil formu (tum alanlar) | acik sol | encrypted vault | — | korunacak |
| 5.6 | Formdan al / Profili kaydet | acik sol | vault + Firestore | — | korunacak |
| 5.7 | Profil listesi (Aktif yap/Aktif/Sil) | acik sag | vault | — | korunacak |
| 5.8 | Bos durum | acik sag | — | — | korunacak |

---

## 6. Operasyon (`/operations`)

| # | Islev | Eski yer | Handler / API | Yeni yer (v2) | Durum |
|---|---|---|---|---|---|
| 6.1 | 6 metrik karti (Hata/Bekleyen/Kontrol/Bilinen yok/Portal takip/PDF bekleyen) | metrik grid | turetilmis | — | korunacak |
| 6.2 | Son denemeler timeline (16 job, process bar, hata, deneme) | timeline | snapshot jobs | — | tasarlanacak |
| 6.3 | Tekrar dene (canRetryInvoiceProcess) | timeline satir | `issueDrafts` → `POST /api/invoices/issue` | — | korunacak |
| 6.4 | Bos durum (Kuyruk bos) | timeline | — | — | korunacak |
| 6.5 | Adapter-hazir operasyon modeli notu | alt | statik | — | tasarlanacak |

---

## 7. Ayarlar (`/settings`)

| # | Islev | Eski yer | Handler / API | Yeni yer (v2) | Durum |
|---|---|---|---|---|---|
| 7.1 | Calisma modu karti (API/mod/saglayici/yukleme/dizin) | salt-okunur | snapshot settings | — | korunacak |
| 7.2 | Baglanti durumu karti (Trendyol/GIB portal/GIB direct/Trendyol API) | salt-okunur | connections | — | korunacak |
| 7.3 | Platform siniri / ilk faz kararlari (3 kart) | salt-okunur | statik | — | tasarlanacak |

---

## Acik sorular (tasarim oncesi)

- Mobil operasyon akisi: masaustunun sikistirilmisi degil, gercek mobil oncelik sirasi nasil olmali?
- "Bugun ne yapmaliyim?" karar ekrani Genel mi olmali yoksa Faturalar Liste/Is akisi mi?
- 3 sekme korunacak mi, yoksa tek akisli "is kuyrugu + arsiv + dis kaynak" gorunumune mi inecek? (islev korunmak kosuluyla)
- Preview'da canli yazim icin gorunur "REDESIGN — canli veri" rozeti + opsiyonel READ_ONLY bayragi.

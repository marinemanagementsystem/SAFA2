# SAFA sayfa ve islev envanteri

Kaynak analizi tarihi: 2026-06-22
Kaynak surumu: `origin/main` (merge sonrasi canli arayuz; "arayuz sadelestirme" Faz A-D + 429 fix dahil).

Bu dokuman SAFA2 repo kodu uzerinden, kullanicinin gorebildigi tum web panel sayfalarini, ic bolumleri, tablari, filtreleri, butonlari, linkleri ve bu kontrollerin arkadaki islevlerini haritalar. Analiz statik kaynak koduna dayanir; canli browser smoke veya API cagri testi degildir.

Not: Bu surum `origin/main` koduna gore guncellendi. Onceki taslak, sadelestirme oncesi bir branch'i anlatiyordu; navigasyon tek isim setine indi, Faturalar ekraninin hero komutlari ve sekme adlari degisti, Operasyon ekranindaki cift metrik bloklari teke indirildi.

## Kaynak kapsam

Ana web girisleri:

- `apps/web/src/app/page.tsx` -> `/`
- `apps/web/src/app/orders/page.tsx` -> `/orders`
- `apps/web/src/app/invoices/page.tsx` -> `/invoices`
- `apps/web/src/app/integrations/page.tsx` -> `/integrations`
- `apps/web/src/app/saved-information/page.tsx` -> `/saved-information`
- `apps/web/src/app/operations/page.tsx` -> `/operations`
- `apps/web/src/app/settings/page.tsx` -> `/settings`

Ana UI bilesenleri:

- `PlatformApp`: rotadaki view secimini alir, `AuthGate` ve `PlatformShell` icinde ilgili sayfayi render eder.
- `AuthGate`: oturum kontrolu, giris formu ve cikis davranisini yonetir.
- `PlatformShell`: sol navigasyon, ust komut bar, sistem ribbon, mobil tabbar ve ortak sayfa basliklarini yonetir.
- `usePlatformData`: tum ekranlarin ortak snapshot, form state, busy state, mesaj, API cagri ve job polling davranisini yonetir.
- View bilesenleri: `OverviewView`, `OrdersView`, `InvoicesView`, `IntegrationsView`, `SavedInformationView`, `OperationsView`, `SettingsView`.

Backend/API baglantisi:

- Frontend API client: `apps/web/src/lib/api.ts`.
- Nest API global prefix: `/api`.
- Firebase Hosting rewrites: `/api/**` ve `/earsiv-services/**` Cloud Run `safa-api-live` servisine gider.
- API oturum cookie ile calisir; `auth/login`, `auth/logout`, `auth/session` disindaki endpointler oturum middleware'ine baglidir.

## Genel uygulama yapisi

### Oturum kapisi

`AuthGate` uygulama acilinca once `/api/auth/session` ile oturum kontrol eder.

- Oturum varsa kullanici adini ve `logout` fonksiyonunu `PlatformShell` altina tasir.
- Oturum yoksa giris ekrani acilir.
- Production disi API hatasinda `sarper` kullanicisiyle offline dev session acabilir.
- Cikis butonu `/api/auth/logout` cagrisi yapar, sonra yerel session state'i temizler.

Giris ekranindaki alanlar:

- `Kullanici adi`: text input, `autoComplete=username`.
- `Sifre`: password input, `autoComplete=current-password`.
- Hata alani: API hata mesajini veya `Kullanici adi veya sifre hatali.` metnini gosterir.
- `Giris yap`: form submit butonu. Busy iken disabled olur.

### Ortak shell ve navigasyon

Navigasyon tek ve tutarli `NAV_ITEMS` listesinden gelir (`apps/web/src/lib/platform/navigation.ts`); tum sayfalarda ayni isim seti gosterilir. Sayfaya ozel kisa navigasyon yoktur.

Marka kilidi (`brand-lockup`) bir link'tir; tiklayinca `/` (Genel) sayfasina gider. Marka alt basligi `/invoices` sayfasinda `Fatura Yonetimi`, diger sayfalarda `Commerce OS` olur.

Standart sol navigasyon sirasi:

1. `Genel` -> `/`, aciklama `Canli operasyon ozeti`, mobil etiket `Genel`
2. `Siparisler` -> `/orders`, aciklama `Paket ve siparis takibi`, mobil etiket `Siparis`
3. `Faturalar` -> `/invoices`, aciklama `Taslak ve fatura akisi`, mobil etiket `Fatura`
4. `Entegrasyonlar` -> `/integrations`, aciklama `Pazaryeri ve kargo baglantilari`, mobil etiket `Enteg.`
5. `Kayitli Bilgiler` -> `/saved-information`, aciklama `Sifreli profil kasasi`, mobil etiket `Kasa`
6. `Operasyon` -> `/operations`, aciklama `Kuyruk, hata ve sync izleme`, mobil etiket `Ops`
7. `Ayarlar` -> `/settings`, aciklama `Runtime ve saglayici durumu`, mobil etiket `Ayar`

### Sol menu alt bilgisi (baglanti skoru)

Sol navigasyonun altinda bir durum bilgisi vardir:

- `/invoices` disinda: micro-label `Baglanti skoru`; deger API varsa `{connected}/2 canli`, API yoksa `API bekliyor`.
- `/invoices` sayfasinda: micro-label `Operasyon kilidi`; deger `Bos arsiv yerine aksiyon`.

Mobil tabbar ayni 7 `NAV_ITEMS` ogesini mobil etiketleriyle gosterir: `Genel`, `Siparis`, `Fatura`, `Enteg.`, `Kasa`, `Ops`, `Ayar`.

### Ortak ust komutlar

`/invoices` disindaki sayfalarda ust komut bar:

- `Yenile`: `usePlatformData.refresh()` calistirir, snapshot'i API'den tekrar alir. API yoksa veya yukleme/busy durumunda disabled olabilir.
- `Trendyol cek`: `syncOrders()` calistirir. Trendyol sync job'i baslatir, job tamamlanana kadar polling yapar, sonra snapshot'i yeniler.
- `e-Arsiv ac`: `openGibPortal()` calistirir. GIB portal bilgisi varsa tokenli/proxy oturum, yoksa manuel portal URL'si acilir.
- `e-Arsiv cikis`: `logoutGibPortalSession()` ile portal oturumunu kapatmaya calisir.
- `Cikis`: `AuthGate.logout()` calistirir.

`/invoices` sayfasinda fatura operasyon masasi kendi ic hero header'inda su butonlari verir: `Yenile`, `e-Arsiv ac`, `Guvenli cikis`, `Kontrol et ve uygula`. `Kontrol et ve uygula` (primary) tek tikta son 7 gun imzalilarini sorgular ve guvenli eslesenleri otomatik uygular; yani onceki ayri `Imzalilari sorgula` + `Guvenli imzalilarini uygula` adimlarini birlestirir.

### Sistem ribbon

Her sayfada `system-ribbon` su iki bilgiyi gosterir:

- Sol taraf: `usePlatformData.message`, yani son operasyon mesaji.
- Sag taraf: API ve runtime modu. Olasiliklar:
  - `Backend baglantisi bekleniyor`
  - `Canli entegrasyon modu`
  - `Canli mod kontrol ediliyor`

### Ortak veri snapshot'i

`usePlatformData.fetchPlatformSnapshot()` su veri gruplarini alir:

- Siparisler: `/api/orders`
- Faturalar: `/api/invoices`
- Taslaklar: `/api/invoice-drafts`
- Runtime settings: `/api/settings`
- Baglantilar: `/api/settings/connections`
- Harici faturalar: `/api/external-invoices`
- Job listesi: `/api/jobs`
- Otomasyon durumu: `/api/automation/status`
- Hepsiburada urunleri: `/api/products`
- Hepsiburada siparis kalemleri: `/api/integrations/hepsiburada/order-lines`

API yoksa:

- Operasyon aksiyonlari gercek backend cagirmadan durur.
- Trendyol, Hepsiburada, GIB Portal ve GIB Direct formlari localStorage taslagi olarak saklanabilir.
- Snapshot icinde `settings.localConnectionDrafts=true` ve `connections.source=tarayici-taslak` uretilir.
- Mesaj: `Canli API bagli degil. Frontend yayinda; backend URL tanimlaninca operasyon aksiyonlari aktif olacak.`

## Sayfa 0: Giris ekrani

Giris ekrani uygulama view'lerinden once gelir ve `AuthGate` tarafindan render edilir.

Sira:

1. Marka lockup: `SAFA / Commerce OS`.
2. Bilgi alani: `Giris gerekli`, `Operasyon paneline giris`.
3. Kullanici adi inputu.
4. Sifre inputu.
5. Hata mesaji varsa form alert.
6. `Giris yap` butonu.

Buton/islev:

- `Giris yap`: `api.login({ username, password })` cagrisi yapar. Basariliysa session state olusur, sifre inputu temizlenir. Basarisizsa hata mesaji gosterilir.

## Sayfa 1: Genel operasyon merkezi (`/`)

Baslik:

- `Operasyon merkezi`
- Alt metin: siparis, fatura, e-Arsiv ve entegrasyon durumunu tek yerden takip etme.

Ana amac:

- Gunluk operasyonu ozetler.
- Siparis sayisi, taslak/fatura durumu, job hatasi ve entegrasyon sagligini tek ekranda verir.
- Kullaniciyi dogru aksiyon sayfasina yonlendirir.

### Hero bolumu: Bugunku operasyon durumu

Hesaplanan metrikler:

- `ready`: `READY` durumundaki ve harici faturasi olmayan taslak sayisi.
- `approved`: `APPROVED` durumundaki ve harici faturasi olmayan taslak sayisi.
- `externalDrafts`: harici faturayla kapanmis taslak sayisi.
- `issued`: SAFA fatura kaydi olan siparis sayisi.
- `externalMatched`: SAFA fatura kaydi olmayan ama harici fatura eslesmesi olan siparis sayisi.
- `unknownInvoice`: bilinen SAFA veya harici faturasi olmayan siparis sayisi.
- `failedJobs`: `FAILED` job sayisi.
- `totalRevenue`: tum siparislerin toplam odenebilir tutari.

Butonlar/linkler:

- `Trendyol cek`: `syncOrders()`; Trendyol siparislerini ve fatura izlerini job ile yeniler.
- `Entegrasyonlari gor`: `/integrations` linki.

Gorsel akis:

- `Orders`: toplam siparis sayisi.
- `Drafts`: hazir + onayli taslak sayisi.
- `Jobs`: hata varsa hata sayisi, yoksa `Temiz`.

### Platform metrikleri

Kartlar:

- `Teslim paket`: toplam siparis sayisi, yukleme sirasinda `Yenileniyor`.
- `SAFA fatura kapsami`: `SAFA'da kesilen / harici bulunan`.
- `Taslak kontrol`: `Hazir / onayli`, yaninda harici kapali sayisi.
- `Siparis hacmi`: filtrelenmemis toplam tutar.

### Canli baglantilar

Aktif entegrasyon katalogundan `availability=active` olanlari gosterir.

- Trendyol
- Hepsiburada
- GIB e-Arsiv

Link:

- `Yonet`: `/integrations` sayfasina gider.

### Operasyon nabzi

Son job varsa:

- Job status pill.
- Job type.
- Job target.
- Son guncelleme zamani.

Job yoksa:

- `Kuyruk bos` empty state.

Link:

- `Kuyruga git`: `/operations`.

### Fatura aksiyonlari

Uc aksiyon lane:

- `Bilinen faturasi yok`: `/orders`; SAFA veya harici eslesme bekleyen siparisler.
- `Hazir taslak`: `/invoices`; toplu onay ve fatura akisi.
- `Hata sinyali`: `/operations`; basarisiz job ve gonderim denemeleri.

## Sayfa 2: Siparisler (`/orders`)

Baslik:

- `Siparisler`
- Alt metin: teslim paketlerini filtreleme, fatura durumunu gorme ve detaya inme.

Ana amac:

- Trendyol kaynakli siparisleri listelemek.
- Fatura/taslak/harici eslesme durumunu gormek.
- Toplu olarak GIB portal taslagina aktarilabilecek siparisleri secmek.
- Siparis detay panelinden fatura masasi veya PDF aksiyonuna gecmek.

### URL ile otomatik odak

Sayfa acilinca query parametresi okunur:

- `?order=...`
- `?package=...`

Bu deger siparis no, paket no, draft id, invoice no veya external invoice no ile eslesirse ilgili satir otomatik secilir.

### Ust aksiyonlar

Baslik kartinda once bir sayac satiri gosterilir:

- `{filtrelenmis} kayit gosteriliyor` (h2).
- Alt satir: `{toplam} toplam · {n} portala aktarilabilir · {n} kilitli`.

Sayfa baslik kartindaki butonlar:

- `Toplu secim`: selection mode'u acar/kapatir. Acikken `Sec` kolonu ve toplu aktarim bar'i aktif olur.
- `Sutunlar`: kolon/profil ayar panelini acar/kapatir.
- `Temizle`: arama, ust filtreler, kolon filtreleri ve siralamayi varsayilana ceker.

### Ust filtre dock'u

Filtreler:

- `Arama`: siparis, paket, alici, sehir, fatura no, e-posta, Trendyol status, taslak status ve harici kaynak metni icinde arar.
- `Fatura` secimi:
  - `Tum kayitlar`
  - `SAFA'da kesilenler`
  - `Harici faturada bulunanlar`
  - `SAFA faturasi bekleyenler`
  - `Bugun SAFA'da kesilenler`
  - `Onceki SAFA faturalari`
- `Trendyol`: mevcut siparis status degerlerinden dinamik liste.
- `Taslak`:
  - `Tum taslaklar`
  - `Taslak yok`
  - mevcut taslak status degerleri.
- `Tarih`:
  - `Tum zamanlar`
  - `Bugun teslim edilen`
  - `Son 7 gun teslim`
  - `Son 30 gun teslim`
- `Sehir`: siparislerden dinamik sehir listesi.

### Sutun ve gorunum profili paneli

`Sutunlar` acilinca gorunen kontroller:

- `Gorunum profili` select'i: kayitli profil secilir, secilince kolon sirasi, gorunen kolonlar, kolon filtreleri, ust filtreler ve siralama uygulanir.
- `Gorunumu kaydet`: aktif profil varsa mevcut state'i onun ustune yazar; aktif profil yoksa `Yeni profil` akisina duser.
- `Yeni profil`: `window.prompt("Gorunum profili adi")` ile isim alir, yeni profil olusturur.
- `Varsayilan`: kolon sirasi, gorunen kolonlar, kolon filtreleri ve siralamayi varsayilana alir; profil kaydetmeden ezmez.

Kolon yonetimi:

- Her kolon icin checkbox: gorunur/gizli yapar.
- Drag/drop: kolon sirasi degisir.
- `Yukari tasi` icon butonu: kolonu bir uste alir.
- `Asagi tasi` icon butonu: kolonu bir alta alir.
- Selection mode acikken `Sec` kolonu zorunlu gorunur.

Profil saklama:

- Once Firestore `safaOrderViewProfiles/{ownerUsername}` okunur/yazilir.
- Firestore okunamaz/yazilamazsa localStorage yedegi kullanilir.

Kolonlar:

- `Sec`: toplu aktarim checkbox'i.
- `Paket`: `shipmentPackageId`, sortable, text filter.
- `Siparis`: `orderNumber`, sortable, text filter.
- `Teslim`: teslim tarihi, sortable.
- `Alici`: `customerName`, sortable, text filter.
- `Sehir`: sortable, sehir select filter.
- `Tutar`: sortable, min/max tutar filter.
- `Taslak`: status pill, sortable, taslak select filter. Olasi etiketler: `Fatura kesildi`, `{kaynak} imzali` (harici e-Arsiv eslesmesi), veya taslak status etiketi.
- `Fatura`: SAFA veya harici fatura status pill, sortable, text filter. Olasi etiketler: `{kaynak}: {fatura no}`, `{kaynak} faturasi var`, `Kesiliyor`, `GIB imza bekliyor`, `Kesim bekliyor`, `Fatura hatasi`, `SAFA kaydi yok`.
- `PDF`: PDF/taslak linkleri ve `Fatura masasi` linki.

### Toplu portal aktarim bar'i

Selection mode acikken gosterilir.

Durum:

- `Secim yok`
- `{n} secili`

Butonlar:

- `Gorunen aktarilabilirleri sec`: filtrelenmis gorunen ve aktarilabilir tum siparisleri secer.
- `Secimi temizle`: tum toplu secimi temizler.
- `Secilenleri portala aktar`: secili aktarilabilir draft id'lerini `uploadPortalDrafts()` ile `/api/invoice-drafts/gib-portal-drafts` endpointine gonderir.

Bir siparisin toplu portal aktarimina uygun olmasi icin:

- Draft olmasi gerekir.
- SAFA faturasi kesilmemis olmalidir.
- Harici fatura eslesmesi olmamalidir.
- Draft `PORTAL_DRAFTED` olmamalidir.
- Draft status `READY` veya `APPROVED` olmalidir.

Kilit nedenleri:

- `Taslak yok.`
- `Fatura zaten kesilmis.`
- `Harici fatura eslesmesi var.`
- `Taslak zaten portala aktarilmis.`
- `Taslak hazir veya onayli degil.`

### Tablo ve mobil liste

Desktop tablo:

- Header'daki sortable kolonlar `changeSort()` ile asc/desc toggle eder.
- Kolon filtre satiri ayrica calisir.
- Satir tiklama veya Enter/Space ile siparis secilir.
- `PDF` kolonu:
  - SAFA invoice ve PDF varsa `PDF` linki yeni sekmede acilir.
  - Invoice var ama PDF yoksa `PDF bekliyor` veya `portal imzali / PDF bekliyor`.
  - Draft varsa `Taslak` PDF linki.
  - Her durumda uygun kayitta `Fatura masasi` linki `/invoices?draft=...` veya `/invoices?order=...` ile fatura sayfasina gider.

Mobil liste:

- Kartlar paket no, alici, sehir, teslim tarihi, tutar ve draft status pill gosterir.
- Selection mode acikken kart ustunde checkbox ve kilit nedeni gorunur.

Empty state:

- Hic siparis yoksa: `Once Trendyol cek islemini calistirin.`
- Filtre sonucunda kayit yoksa: `Bu filtrelerle kayit bulunamadi.`

### Siparis detay paneli

Uc durum:

- Loading: `Detay yukleniyor`.
- Secim yok: `Siparis secin`.
- Secili siparis: detaylar acilir.

Detay alanlari:

- Siparis no ve paket no.
- Alici ve e-posta.
- Fatura adresi.
- Toplam ve indirim.
- Teslim tarihi.
- Fatura no veya harici eslesme bilgisi.
- Draft warnings varsa uyarilar.
- Harici faturalar listesi.
- Urun satirlari.
- `Ham Trendyol verisi` details/pre blogu.

Detay aksiyonlari:

- `Fatura masasi`: `/invoices?draft=...` veya `/invoices?order=...`.
- `Fatura PDF`: resmi invoice PDF'i acilir.
- `Taslak PDF`: draft PDF'i acilir.
- Status pill: invoice veya draft status label.

## Sayfa 3: Fatura Operasyon Masasi (`/invoices`)

Baslik:

- Micro-label: `Fatura operasyon masasi`
- `Fatura Operasyon Masasi`
- Alt metin: `PDF, GIB, harici fatura ve Trendyol tek ekranda.`

Ana amac:

- Taslak, GIB imzasi, PDF arsivi ve pazaryeri gonderim surecini tek satirlik operasyon modeliyle takip etmek.
- Fatura aksiyonlarini once islem kuyrugunda, sonra arsiv ve harici takipte toplamak.
- Cift fatura riskini harici fatura eslesmesi ile engellemek.

### Fatura masasi hero header'i

Butonlar:

- `Yenile`: snapshot refresh.
- `e-Arsiv ac`: GIB portal/proxy oturumunu acar.
- `Guvenli cikis`: GIB portal oturumunu kapatir.
- `Kontrol et ve uygula` (primary): son 7 gun GIB portal preview sorgusunu calistirir ve guvenli eslesenleri otomatik uygular. Arkada onceki `preview` ve `apply` adimlarini ardisik tetikler (`busyAction` once `external-gib-preview`, sonra `external-gib-apply`).

Tablar (role=tablist, `Liste / Is akisi` varsayilan aktif):

1. `Liste / Is akisi` (ikon ReceiptText)
   - Operator aksiyonu bekleyen kayitlar: onay, GIB, PDF veya Trendyol aksiyonu.
2. `Arsiv & Indirmeler` (ikon Archive)
   - PDF listesi, aylik Excel ve ZIP arsivi.
   - Dikkat gereken kayit (portalda imzali ama arsive alinmamis / PDF bekleyen) varsa sekmede sayi rozeti gosterilir.
3. `Dis kaynak faturalar` (ikon FileSearch)
   - e-Arsiv sorgu, Trendyol izi, import ve eslestirme.

### Tab 3.1: Liste / Is akisi

Bu tab `InvoiceOperationsDashboard` tarafindan render edilir.

#### Temel operasyon penceresi

Fatura operasyon modeli son 7 gunu onceliklendirir. Son 7 gun disindaki kayitlar yeniden GIB/PDF/Trendyol takibine alinmaz; sadece `Siparise git` gibi inceleme aksiyonu alir.

#### Uyari bandi

`PDF arsivi bos cunku resmi fatura henuz olusmadi.` mesajini gosterir.

Sayaclar:

- `{portalSignatureCount} imza`
- `{pdfMissingCount} PDF`

#### Otomasyon koruma paneli

`AutomationGuardPanel` otomasyon durumunu gosterir:

- Status pill: `Guncel` veya `Guncel degil`.
- `Free-tier otomasyon korumasi` metni.
- Son GIB kontrolu.
- Son Trendyol kontrolu.
- Sonraki otomatik kontrol.
- `autoRunsToday/dailyAutoRunLimit otomatik calisma`.

Buton:

- `Simdi guncelle`: `runAutomationNow()` ile `/api/automation/run-now` job'ini baslatir. `manualRunAllowed=false` ise disabled.

#### Metrik kartlari

Kartlar ayni zamanda filtre butonudur:

- `Son 7 gun oncelik`: `action` queue, operator aksiyonu bekleyen kayitlar.
- `Portal imza bekliyor`: `portal-signature` queue.
- `PDF arsivi bos`: `pdf-missing` queue.
- `Harici e-Arsiv eslesti`: `external-found` queue.
- `Trendyol gonderimi`: `marketplace` queue.

Kart tiklaninca ayni filtre aktifse `all` filtreye doner, degilse ilgili queue'ya gecer.

#### Sol is kuyrugu paneli

Kontroller:

- `Kapsam`: read-only `Son 7 gun oncelik`.
- `Durum`: `Aksiyon bekleyenler` butonu, queue'yu `action` yapar.
- `Arama`: fatura, siparis veya paket arar.
- `Filtre temizle`: arama ve queue filtresini sifirlar.
- Kuyruk listesi:
  - `PDF arsivi bos`
  - `Portal imza bekliyor`
  - `Harici e-Arsiv eslesti`
  - `Trendyol gonderimi`

#### Birlesik fatura takibi tablosu

Baslik: `Taslak > GIB > PDF > Pazaryeri`

Header aksiyonu:

- `Son 7 gun eslesenleri uygula`: son 7 gun GIB apply job'ini baslatir, guvenli eslesenleri arsive almaya ve gerekiyorsa Trendyol'a gondermeye calisir.

Tablo filtreleri:

- `Arama`: fatura no, siparis no, paket ve musteri icinde arar.
- Segment butonlari:
  - `Tumu` -> `all`
  - `Eksik` -> `pdf-missing`
  - `Tamam` -> `marketplace`

Toplu taslak bar'i:

- Durum: `Secim yok`, `{n} secili`, `Taslak yok`.
- `Secilebilirleri birak` veya `{n} taslagi sec`: gorunen secilebilir taslaklari toggle eder.
- `Secimi temizle`: secimi sifirlar.
- `Seciliyi onayla`: secili `READY` veya hatasiz `ERROR` taslaklari onaylar.
- `Onaylilari GIB'e yukle`: secili `APPROVED` taslaklari GIB portal taslagi olarak yukler.
- Secili taslaklar onayli degilse portal butonu `Once onay gerekli` metnine doner.

Toplu secime uygun draft kosullari:

- Status `READY`, `APPROVED` veya hatasiz `ERROR`.
- `externalInvoiceCount=0`.

Toplu secim kilit nedenleri:

- Harici e-Arsiv kaydi eslestigi icin dahil degil.
- Resmi fatura olustugu icin secim kapali.
- GIB portal taslagi olustugu icin sonraki adim satir aksiyonundan ilerler.
- Fatura kesimi devam ederken secim kapali.
- Hatali taslak once satir uzerinden kontrol edilmeli.

Tablo kolonlari:

- `Oncelik`: secim checkbox'i ve oncelik etiketi.
- `Kayit`: status, orderNumber, customerName, shipmentPackageId, varsa invoice/external invoice no.
- `Akis`: `Taslak`, `GIB`, `PDF`, `Pazaryeri` stage rail.
- `GIB / PDF`: GIB ve PDF stage detaylari.
- `Pazaryeri`: Trendyol/pazaryeri stage detayi.
- `Tutar`: para formati.

Satir tiklama:

- Secili row state'ini gunceller.
- Detail paneli acar.
- Mobilde kart tiklama ayni isi yapar.

Bos durumlar:

- Hic fatura hareketi yoksa: `Henuz fatura hareketi yok`.
- Filtre sonucunda kayit yoksa: `Filtreyle eslesen kayit yok`.

#### Stage ve next action mantigi

Stage'ler:

- `Taslak`
- `GIB`
- `PDF`
- `Pazaryeri`

Stage state'leri:

- `done`
- `waiting`
- `missing`
- `failed`
- `idle`

Oncelik ve aksiyon mantigi:

- Job failed veya draft `ERROR`: `Tekrar dene`.
- Invoice `TRENDYOL_SEND_FAILED`: `Trendyol'a tekrar gonder`.
- Harici fatura eslesmis ama arsive alinmamis: `Arsive al`.
- Harici fatura PDF eksikse: `Resmi PDF yukle`.
- Invoice PDF eksikse: `PDF'i tekrar kontrol et`.
- Portal drafted ve PDF/GIB bekliyorsa: `Imzalilari sorgula`.
- Invoice PDF hazir, marketplace waiting ise: `Trendyol'a gonder`.
- Draft `APPROVED`: `GIB taslagina yukle`.
- Draft `READY`: `Taslagi onayla`.
- Draft `PORTAL_DRAFTED`: `Portalda ac`.
- Eski veya tamamlanmis kayitlarda: `Siparise git` veya `Aksiyon yok`.

#### Detail paneli ve modal

Desktopta sag panel, mobil/kucuk durumda modal olarak acilir.

Icerik:

- Status pill, order no, paket, musteri.
- Oncelik etiketi.
- Timeline: `Taslak`, `GIB`, `PDF`, `Pazaryeri` olaylari.
- `Bu kayit neden boyle gorunuyor?` aciklamasi.
- Aksiyon butonu: row'un next action'una gore degisir.
- `Portalda ac`.
- `Guvenli cikis`.
- `Siparise git`.
- Audit alanlari:
  - Kaynak: `Harici fatura`, `Resmi fatura`, `Taslak`
  - Fatura no
  - Tutar
- PDF onizleme placeholder'i.

Kayit secili degilse panel bos durum gosterir: `Secilecek fatura yok`.

Detail modal kapatma:

- `Fatura detayini kapat` icon butonu.
- Backdrop'a tiklama.

### Tab 3.2: Arsiv & Indirmeler

Ana amac:

- Kesilmis resmi faturalarin PDF durumunu, aylik Excel ve ZIP arsivini yonetmek.

Ust aksiyon:

- `Temizle`: arsiv arama, status ve tarih filtrelerini sifirlar.

Filtre ve indirme bar'i:

- `Aylik arsiv`: `input type=month`, varsayilan current month.
- `Aylik Excel indir`: `/api/invoices/monthly-export.xlsx?year=YYYY&month=M` linki. Ay secilmemisse tiklama engellenir.
- `ZIP olustur/indir`: `/api/invoices/monthly-archives` POST ile arsiv olusturur, sonra download URL tetikler.
- `Arama`: fatura no, siparis ve paket icinde arar.
- `Durum`:
  - `Tum faturalar`
  - mevcut invoice status degerleri.
- `Tarih`:
  - `Tum zamanlar`
  - `Bugun kesilen`
  - `Son 7 gun`
  - `Son 30 gun`

Bilgi/uyari alanlari:

- Aylik ZIP sonucu: resmi fatura sayisi, eksik PDF, eksik resmi XML, dosya adi.
- Son 7 gunde portalda imzali ama SAFA arsivine alinmamis kayit sayisi.
- PDF bekleyen arsiv kaydi sayisi; PDF gelmeden Trendyol'a dosya gonderilmeyecegi belirtilir.

Liste bolumleri:

- `Bugun kesilenler`: bugun invoiceDate olan faturalar.
- `Onceki faturalar`: onceki faturalarin ilk 12 kaydi.

Fatura satiri:

- Status pill.
- Invoice number.
- Order number, source label, invoice date, delivery date, Trendyol status.
- Error varsa gosterilir.
- Aksiyonlar:
  - `PDF`: resmi PDF yeni sekmede.
  - `Trendyol'a gonder`: PDF mevcutsa ve Trendyol status `SENT` veya `ALREADY_SENT` degilse gosterilir.
  - `Siparise git`: `/orders?order=...`.

### Tab 3.3: Dis kaynak faturalar

Ana amac:

- GIB portal, Trendyol veya manuel gercek fatura kaynaklarini iceri almak.
- Harici faturalari siparislerle eslestirmek.
- Guvenli kayitlari SAFA arsivine almak.
- Gerekirse resmi PDF yuklemek ve Trendyol'a gondermek.

Ust durum:

- `{matchedExternalInvoices} eslesme` status pill.
- `Temizle`: external arama, kaynak ve eslesme filtrelerini sifirlar.

Harici arac butonlari:

- `Son 7 gun imzalilarini kontrol et`: GIB portal preview sorgusu. Son 7 gunluk pencere `recentGibPortalSyncRequest()` ile Istanbul saatine gore kurulur.
- `Son 7 gun guvenli olanlari uygula`: GIB apply job'i baslatir, guvenli eslesenleri uygular.
- `Trendyol fatura izi ara`: Trendyol siparis verisinden harici fatura izi arayan job'i baslatir.
- `Tekrar eslestir`: mevcut harici faturalar ile siparisleri tekrar eslestirir.

Manuel import formu:

- `Kaynak` select:
  - `e-Arsiv Portal`
  - `Trendyol`
  - `Diger gercek kaynak`
- `Gercek fatura listesi JSON veya CSV` textarea.
  - JSON array/object kabul eder.
  - CSV icin ilk satir baslik, sonraki satirlar kayit olmalidir.
  - Separator otomatik `;` veya `,` secilir.
- `Listeyi al ve eslestir`: parse edilen kayitlari `/api/external-invoices/import` endpointine gonderir.

Harici liste filtreleri:

- `Arama`: fatura no, alici, siparis, paket icinde arar.
- `Kaynak`:
  - `Tum kaynaklar`
  - `e-Arsiv`
  - `Trendyol`
  - `Manuel`
- `Eslesme`:
  - `Tum kayitlar`
  - `Eslesenler`
  - `Acik kalanlar`

Liste siniri:

- Filtrelenmis harici faturalardan ilk 40 kayit gosterilir.
- Daha fazla varsa aramayla daraltma mesaji gosterilir.

Harici fatura satiri:

- Status: `Arsivde`, `Eslesti` veya `Acik`.
- Fatura no.
- Kaynak, siparis veya eslesme, tarih.
- Promoted ise SAFA arsiv invoice no ve PDF bekleme bilgisi.
- Eslesmemisse acik kalma nedeni ve aday siparis/paket.
- Tutar.

Satir aksiyonlari:

- Acik kayitta `Siparis no veya paket no` inputu.
- `Eslestir`: manuel target ile `/api/external-invoices/:id/match`.
- Eslesmis kayitta `Siparise git`.
- GIB portal kaynakli ve eslesmis kayitta:
  - `Arsive al`: `/api/external-invoices/:id/promote`.
  - `Trendyol'a gonder`: `/api/external-invoices/:id/promote-and-send-to-trendyol`; `requiresPdfUpload=true` ise disabled.
  - `Resmi PDF yukle`: PDF file input, `/api/external-invoices/:id/pdf`.

## Sayfa 4: Entegrasyonlar (`/integrations`)

Baslik:

- `Entegrasyonlar`
- Alt metin: Trendyol, e-Arsiv ve GIB baglanti bilgilerini yonetme.

Ana amac:

- Pazaryeri ve fatura entegrasyon ayarlarini yonetmek.
- Profil kasasindan kayitli bilgileri formlara doldurmak.
- Hepsiburada katalog/stok/fiyat/siparis/paketleme aksiyonlarini calistirmak.
- Planli adapter katalogunu gormek.

### Profil kasasi paneli

Sayfanin en ustunde `IntegrationProfilePicker` vardir.

Durumlar:

- Loading: `Profiller okunuyor`.
- Kasa yok: `Henuz kasa yok`, `Kayitli Bilgiler'e git` linki.
- Kasa kilitli: kasa secimi, kasa sifresi, `Kasayi ac`.
- Kasa acik: aktif kasa read-only input, profil select, `Kilitle`.

Davranis:

- Kasa acilinca profil listesi localStorage ve Firestore birlesimiyle okunur.
- Profil secilince Trendyol, GIB Portal ve GIB Direct formlari doldurulur.
- Aktif profil secimi sifreli kasaya tekrar yazilir.
- Firestore yavas/yoksa yerel kasa kullanilir.

### Otomasyon guncelligi paneli

`IntegrationAutomationStatus` ile ayni otomasyon view modelini gosterir.

Alanlar:

- Status pill.
- `Otomasyon guncelligi`.
- Budget detail.
- Son GIB kontrolu, son Trendyol kontrolu, sonraki otomatik kontrol.
- Budget label.

Buton:

- `Simdi guncelle`: `runAutomationNow()`.

### Baglanti kartlari

Dort kart modal acmak icin kullanilir:

- `Trendyol`
  - Eyebrow: `Pazaryeri`
  - Status: `Bagli`, `Taslak kayitli` veya `Bekliyor`.
- `Hepsiburada`
  - Eyebrow: `Pazaryeri`
  - Status: `Bagli`, `Taslak kayitli` veya `Bekliyor`.
- `e-Arsiv Portal`
  - Eyebrow: `Fatura`
  - Status: `Bagli`, `Taslak kayitli` veya `Bekliyor`.
- `GIB Direct`
  - Eyebrow: `Fatura`
  - Status: `Bagli` veya `Eksik ayar`.

Modal davranisi:

- Kart tiklaninca `IntegrationModal` acilir.
- Backdrop tiklama kapatir.
- `Escape` kapatir.
- Header'daki `X` icon butonu kapatir.

### Trendyol modal paneli

Form alanlari:

- `Satici ID`
- `API Key`
- `API Secret`
- `Storefront`
- `Gun` (1-90)
- `User-Agent`

Butonlar:

- `Partner ac`: `https://partner.trendyol.com/` popup'i acar.
- `Baglan`: API varsa `/api/settings/connections/trendyol/connect`; API yoksa localStorage taslagi kaydeder.

### e-Arsiv Portal modal paneli

Form alanlari:

- `Kullanici`
- `Sifre`
- `Portal URL`
- `PDF fallback` checkbox:
  - `GIB PDF alinamazsa imzali kayittan pazaryeri PDF kopyasi uret ve otomatik gonder`
  - Ayar key'i: `feature.gibPortal.reconstructedPdfFallback`.

Butonlar:

- `Portal ac`: tokenli/proxy veya manuel GIB portal oturumu acar.
- `Guvenli cikis`: portal session logout.
- `Baglan`: API varsa `/api/settings/connections/gib-portal/connect`; API yoksa localStorage taslagi.

### Hepsiburada modal paneli

Baglanti formu:

- `Merchant ID`
- `Ortam`: `Test` veya `Canli`
- `User`
- `Password`
- `User-Agent`
- `Gun` (1-30)
- `OMS URL`

Baglanti butonu:

- `Baglan`: API varsa `/api/settings/connections/hepsiburada/connect`; API yoksa localStorage taslagi.

Urun formu:

- `Urun adi`
- `Merchant SKU`
- `HB SKU`
- `Barkod`
- `Fiyat`
- `Stok`
- `Marka`
- `Kategori`

Urun butonlari:

- `Urun ekle`: yeni product kaydi olusturur.
- `Urunu guncelle`: listeden `Duzenle` ile secilen product'i gunceller.
- `Yeni kayit`: edit modundan cikar.

Hepsiburada operasyon lane'leri:

1. `Katalog`
   - `{products.length} urun kayitli`.
   - `Katalog gonder`: `/api/integrations/hepsiburada/catalog/upload`.
   - `trackingId` inputu.
   - `Sorgula`: `/api/integrations/hepsiburada/catalog/status/:trackingId`.
2. `Stok / fiyat`
   - `Envanter`: listing sync.
   - `Fiyat`: price upload.
   - `Stok`: stock upload.
3. `Siparis`
   - `{orderLines.length} Hepsiburada kalemi takipte`.
   - `Test siparis`: test order create.
   - `Siparis cek`: Hepsiburada order sync.

Urun tablosu:

- Kolonlar: `Urun`, `SKU`, `Fiyat`, `Stok`, `Durum`, aksiyon.
- Ilk 8 urun gosterilir.
- `Duzenle`: urun formunu mevcut kayitla doldurur.

Siparis kalemi tablosu:

- Kolonlar: `Siparis`, `Kalem`, `Musteri`, `Paket`, aksiyon.
- Ilk 8 kalem gosterilir.
- `Paketle`: package number yoksa gosterilir, `/api/integrations/hepsiburada/order-lines/:id/package`.

### GIB Direct modal paneli

Eksik alan varsa ustte `Eksik: ...` uyarisi gosterir. Eksikler tamamlanmadan fatura kesimi sahte basarili sayilmaz, hata verir.

Form alanlari:

- `Ortam`: `Test` veya `Canli`
- `VKN/TCKN`
- `GIB servis URL`
- `WSDL URL`
- `SOAP Action`
- `SOAP govde sablonu`
- `SOAP sablon dosya yolu`
- `Mali muhur/NES imzalama komutu`
- `SOAP/WSS imzalama komutu`
- `Fatura seri prefix` (max 3)
- `Siradaki numara`
- `Birim kodu`
- `Varsayilan alici TCKN`
- `mTLS PFX yolu`
- `mTLS sifre`
- `GIB izin referansi`
- `Yetki teyitleri`: `Test`, `Canli`

Buton:

- `GIB direct baglan`: API varsa `/api/settings/connections/gib-direct/connect`; API yoksa localStorage taslagi.

### Adapter kataloglari

Alt bolumler:

- `Pazaryeri adaptorlari`: aktif olmayan planli pazaryerleri.
- `Fatura saglayicilari`: runtime invoice provider bilgisiyle planli saglayicilar.
- `Kargo firmalari`: planli kargo adapterleri.

Kart davranisi:

- Aktif itemlarda external link iconu gercek servis sayfasini acar.
- Planli itemlarda icon disabled ve `adapter planlandi` aria label'i vardir.

Katalog itemlari:

- Aktif pazaryeri: Trendyol, Hepsiburada.
- Planli pazaryeri: Amazon, N11, Ciceksepeti.
- Aktif fatura: GIB e-Arsiv.
- Planli fatura: Ozel Entegratorler.
- Planli kargo: Yurtici, Aras, MNG, Surat, PTT, HepsiJet, Trendyol Express.

## Sayfa 5: Kayitli Bilgiler (`/saved-information`)

Baslik:

- `Kayitli bilgiler`
- Alt metin: profil kasasindan API ve portal bilgilerini formlara aktarma.

Ana amac:

- Trendyol, GIB Portal ve GIB Direct bilgilerini sifreli kasalarda saklamak.
- Birden fazla kasa ve profil yonetmek.
- Profil secince entegrasyon formlarini doldurmak.

### Sifreleme ve saklama modeli

- Kasa payload'i AES-GCM ile sifrelenir.
- Anahtar PBKDF2 SHA-256, 140000 iteration ile turetilir.
- Kasa localStorage'da saklanir.
- Firestore `safaVaults/{ownerUsername}` altina da kaydedilmeye calisilir.
- Legacy kasa key'i de okunur.
- Aktif kasa oturumu localStorage ve sessionStorage icinde tutulur; `Kilitle` bunu temizler.
- Remote timeout 3500 ms; Firestore yavas/yoksa yerel kasa kullanilir.

### Loading durumu

`Kasalar okunuyor` ekrani:

- Kayitli kasa listesi tarayici ve Firestore uzerinden kontrol edilir.

### Kasa olusturma ekrani

Yeni kasa akisi:

- `Ilk kurulum` veya `Yeni kasa` micro label.
- `Sifreli bilgi kasasi olustur`.

Alanlar:

- `Kasa adi`
- `Kasa sifresi`
- `Sifre tekrar`

Validasyon:

- Kasa adi bos olamaz.
- Sifre en az 8 karakter olmali.
- Sifreler ayni olmali.

Butonlar:

- `Kasa listesine don`: mevcut kasa varsa olusturma akisini iptal eder.
- `Kasa olustur`: yeni encrypted vault olusturur, localStorage'a yazar, Firestore'a kaydetmeyi dener, aktif session acar.

### Kilitli kasa ekrani

Alanlar:

- `Kasa sec`: kasa listesi.
- `Kasa sifresi`: password input.

Butonlar:

- `Kasayi ac`: secili kasayi sifreyle acar.
- `Yeni kasa`: olusturma akisini baslatir.
- `Secili kasayi sifirla`: confirm ister; yalniz secili kasadaki profilleri siler, diger kasalar ve app girisi etkilenmez.

Sifirlama sonucu:

- Local kasa kaydi silinir.
- Aktif session temizlenir.
- Firestore kasa kaydi silinmeye calisilir.
- Kalan kasa varsa ona gecilir, yoksa yeni kasa akisi acilir.

### Acik kasa ekrani

Ust aksiyonlar:

- `Yeni kasa`: yeni kasa olusturma akisini baslatir.
- `Kilitle`: acik kasa session bilgisini temizler; kasa/profiller silinmez.

Profil formu alanlari:

- `Profil adi`
- `Trendyol satici ID`
- `Trendyol API key`
- `Trendyol API secret`
- `GIB kullanici`
- `GIB sifre`
- `GIB portal URL`
- `GIB direct VKN/TCKN`
- `Fatura seri prefix`
- `GIB direct servis URL`
- `Mali muhur/NES imzalama komutu`
- `SOAP/WSS imzalama komutu`
- `GIB izin referansi`
- `Yetki teyitleri`: `Test`, `Canli`

Profil formu butonlari:

- `Formdan al`: mevcut entegrasyon formlarindaki state'i profil taslagina kopyalar.
- `Profili kaydet`: ayni isimde profil varsa gunceller, yoksa yeni profil ekler. Aktif profil yoksa yeni profili aktif yapar. Local encrypted vault ve Firestore kaydi guncellenir.

Profil listesi:

- Kart basligi: profil adi, aktifse check iconu.
- Ozet: Trendyol seller id, GIB kullanici, Direct tax id.
- `Aktif yap`: profili entegrasyon formlarina aktarir ve aktif profile yazar.
- `Aktif`: zaten aktifse disabled metin.
- `Sil`: confirm ile profili siler. Aktif profil silinirse formlardaki mevcut bilgiler degismez, sadece aktif profil kaydi temizlenir.

Empty state:

- `Henuz profil yok. Ilk profili soldaki formdan kaydedin.`

## Sayfa 6: Operasyon izleme (`/operations`)

Baslik:

- `Operasyon izleme`
- Alt metin: sync, fatura ve Trendyol gonderim denemelerini izleme.

Ana amac:

- Job kuyrugu, hata sinyalleri, kontrol gereken taslaklar ve fatura/PDF/pazaryeri bekleyen kayitlari izlemek.
- Basarisiz fatura job'lari icin tekrar deneme butonu sunmak.

### Metrik kartlari (6 kart, tek kaynak)

Faz D ile cift metrik bloklari teke indirildi; tek bir metrik grid kalir:

- `Hata`: `FAILED` job sayisi (varsa danger tonu). Alt metin: manuel kontrol gerektiren job.
- `Bekleyen is`: `PENDING` veya `PROCESSING` job sayisi. Alt metin: kuyrukta veya isleniyor.
- `Kontrol gerekli`: `NEEDS_REVIEW` veya hata iceren draft sayisi. Alt metin: taslak uyarisi veya hata.
- `Bilinen faturasi yok`: SAFA veya harici fatura eslesmesi olmayan siparis sayisi.
- `Portal takip`: `PORTAL_DRAFTED` veya `GIB_PORTAL` kaynakli draft sayisi.
- `PDF bekleyen`: PDF'i hazir olmayan veya hata mesajinda "pdf bekliyor" gecen fatura sayisi. Alt metin: PDF gelmeden Trendyol'a dosya gonderilmez.

### Son denemeler timeline'i

Liste:

- Son 16 job gosterilir.
- Her satir status tone ile renklendirilir.
- Draft varsa baslik `{orderNumber} fatura sureci`, yoksa job type.
- Target veya musteri/paket bilgisi.
- `InvoiceProcessBar`: `Taslak`, `Onay`, `Kuyruk`, `Sonuc` adimlarini yuzde ve helper metinle gosterir.
- `lastError` varsa hata callout.
- Guncelleme zamani ve deneme sayisi.

Buton:

- `Tekrar dene`: sadece `canRetryInvoiceProcess()` true ise gorunur. Draft `ERROR` veya visible job `FAILED` ve harici fatura yoksa, `onRetryInvoice(draftId)` ile `issueDrafts([id])` calisir.

Empty state:

- `Kuyruk bos`: fatura kesme veya gonderim isi yoksa gosterilir.

### Operasyon modeli notu

Timeline'in altinda bir aciklama karti bulunur:

- `Adapter-hazir operasyon modeli`: yeni pazaryeri ve kargo adaptorleri eklendiginde ayni kuyruk, hata, deneme sayisi ve hedef alanlarinin bu ekranda ortak operasyon diliyle izlenecegini belirtir.

Not: Onceki surumdeki ayri `Aksiyon radar` sinyal blogu Faz D ile kaldirildi; ayni sayilar artik ust metrik gridinde tek kaynaktan gosterilir. Bu ekran uzerinde filtre veya navigasyon yoktur; izleme/teshis ekranidir.

## Sayfa 7: Ayarlar (`/settings`)

Baslik:

- `Ayarlar`
- Alt metin: runtime, saglayici ve saklama durumunu kontrol etme.

Ana amac:

- API, runtime, storage ve baglanti sagligini salt okunur sekilde gostermek.
- Ilk faz kararlarini belgelemek.

### Calisma modu karti

Satirlar:

- `Backend API`: `Bagli` veya `Frontend statik; API URL bekleniyor`.
- `Entegrasyon modu`: `Backend bekleniyor`, `Canli entegrasyon` veya `Canli mod kontrol ediliyor`.
- `Fatura saglayici`: `settings.invoiceProvider` veya `Bekleniyor`.
- `Yukleme durumu`: `Yenileniyor`, `Hazir` veya hata tonu.
- `Saklama dizini`: `settings.storageDir` veya `./storage`.

### Baglanti durumu karti

Satirlar:

- `Trendyol`: bagliysa source ile, API yokken tarayici taslagi, yoksa bilgi bekleniyor.
- `GIB e-Arsiv Portal`: bagliysa source ile, API yokken tarayici taslagi, yoksa portal bilgisi bekleniyor.
- `GIB direct`: servis ve imza bilgileri tanimli veya canli yetki/imza bekleniyor.
- `Trendyol API`: API bilgileri tanimli veya henuz tanimli degil.

### Platform siniri / Ilk faz kararlari

Uc bilgi karti:

- `Yeni pazaryeri ve kargo firmalari`: frontend adapter katalogunda gorunur; canli backend cagri yapmaz.
- `Mevcut yetenekler`: Trendyol sync, GIB portal, taslak onay, fatura kesme ve PDF akislari korunur.
- `Auth kapsami`: yerel operasyon paneli mantigi devam eder; role/auth modeli bu faza dahil degildir.

Bu sayfada mutasyon butonu yoktur.

## Backend endpoint eslesmesi

Sayfalardaki ana butonlarin endpoint baglantilari:

| UI aksiyonu | Frontend handler | API endpoint |
| --- | --- | --- |
| Giris yap | `api.login` | `POST /api/auth/login` |
| Cikis | `api.logout` | `POST /api/auth/logout` |
| Oturum kontrolu | `api.authSession` | `GET /api/auth/session` |
| Yenile | `fetchPlatformSnapshot` | coklu GET snapshot |
| Trendyol cek | `startTrendyolSyncJob` + polling | `POST /api/sync/trendyol/jobs`, `POST /api/jobs/:id/run-next` |
| Siparis detay | `api.order` | `GET /api/orders/:id` |
| Taslak onayla | `api.approve` | `POST /api/invoice-drafts/:id/approve` |
| Fatura kes / tekrar dene | `api.issue` | `POST /api/invoices/issue` |
| GIB taslagina yukle | `api.uploadPortalDrafts` | `POST /api/invoice-drafts/gib-portal-drafts` |
| Taslak PDF | `api.draftPdfUrl` | `GET /api/invoice-drafts/:id/pdf` |
| Fatura PDF | `api.invoicePdfUrl` | `GET /api/invoices/:id/pdf` |
| Aylik Excel indir | `api.monthlyInvoiceExcelUrl` | `GET /api/invoices/monthly-export.xlsx` |
| ZIP olustur | `api.createMonthlyInvoiceArchive` | `POST /api/invoices/monthly-archives` |
| ZIP indir | `api.monthlyInvoiceArchiveDownloadUrl` | `GET /api/invoices/monthly-archives/:year/:month/download` |
| Trendyol'a fatura gonder | `api.sendInvoiceToTrendyol` | `POST /api/invoices/:id/send-to-trendyol` |
| e-Arsiv ac | `api.openEarsivPortalSession` veya `api.openEarsivPortalProxySession` | `POST /api/earsiv-portal/open-session`, `POST /api/earsiv-portal/proxy-session` |
| e-Arsiv cikis | `api.logoutEarsivPortalSession` | `POST /api/earsiv-portal/logout-session` |
| Kontrol et ve uygula (hero) / Son 7 gun imzalilarini kontrol et (Tab 3.3) | `api.previewGibExternalInvoices` | `POST /api/external-invoices/sync/gib-portal/preview` |
| Kontrol et ve uygula (hero) / Son 7 gun guvenli olanlari uygula (Tab 3.3) | `api.startGibApplyJob` + polling | `POST /api/external-invoices/sync/gib-portal/apply/jobs` |
| Trendyol fatura izi ara | `api.startTrendyolExternalInvoiceJob` + polling | `POST /api/external-invoices/sync/trendyol/jobs` |
| Harici fatura import | `api.importExternalInvoices` | `POST /api/external-invoices/import` |
| Harici tekrar eslestir | `api.reconcileExternalInvoices` | `POST /api/external-invoices/reconcile` |
| Harici manuel eslestir | `api.matchExternalInvoice` | `POST /api/external-invoices/:id/match` |
| Harici arsive al | `api.promoteExternalInvoice` | `POST /api/external-invoices/:id/promote` |
| Harici arsiv + Trendyol | `api.promoteAndSendExternalInvoice` | `POST /api/external-invoices/:id/promote-and-send-to-trendyol` |
| Resmi PDF yukle | `api.uploadExternalInvoicePdf` | `POST /api/external-invoices/:id/pdf` |
| Otomasyon simdi guncelle | `api.startAutomationRunNowJob` + polling | `POST /api/automation/run-now` |
| Trendyol baglan | `api.connectTrendyol` | `PUT /api/settings/connections/trendyol/connect` |
| Hepsiburada baglan | `api.connectHepsiburada` | `PUT /api/settings/connections/hepsiburada/connect` |
| GIB Portal baglan | `api.connectGibPortal` | `PUT /api/settings/connections/gib-portal/connect` |
| GIB Direct baglan | `api.connectGibDirect` | `PUT /api/settings/connections/gib-direct/connect` |
| PDF fallback ayari | `api.saveSetting` | `PUT /api/settings` |
| Hepsiburada urun ekle | `api.createProduct` | `POST /api/products` |
| Hepsiburada urun guncelle | `api.updateProduct` | `PUT /api/products/:id` |
| Hepsiburada katalog gonder | `api.hepsiburadaCatalogUpload` | `POST /api/integrations/hepsiburada/catalog/upload` |
| Hepsiburada katalog status | `api.hepsiburadaCatalogStatus` | `GET /api/integrations/hepsiburada/catalog/status/:trackingId` |
| Hepsiburada envanter | `api.hepsiburadaListingSync` | `POST /api/integrations/hepsiburada/listings/sync` |
| Hepsiburada fiyat | `api.hepsiburadaPriceUpload` | `POST /api/integrations/hepsiburada/listings/price-upload` |
| Hepsiburada stok | `api.hepsiburadaStockUpload` | `POST /api/integrations/hepsiburada/listings/stock-upload` |
| Hepsiburada siparis cek | `api.hepsiburadaOrdersSync` | `POST /api/integrations/hepsiburada/orders/sync` |
| Hepsiburada test siparis | `api.hepsiburadaCreateTestOrder` | `POST /api/integrations/hepsiburada/test-orders/create` |
| Hepsiburada paketle | `api.hepsiburadaPackageOrderLine` | `POST /api/integrations/hepsiburada/order-lines/:id/package` |

## Temel is akisi sirasi

1. Kullanici giris yapar.
2. `Kayitli Bilgiler` ekraninda kasa/profil olusturur veya `Entegrasyonlar` ekraninda mevcut kasayi acar.
3. `Entegrasyonlar` ekraninda Trendyol, GIB Portal, GIB Direct ve gerekiyorsa Hepsiburada baglantilari kaydedilir.
4. `Genel` veya ust komutlardan `Trendyol cek` calistirilir.
5. `Siparisler` ekraninda teslim paketleri filtrelenir, detay ve taslak durumu incelenir.
6. `Faturalar > Liste / Is akisi` ekraninda secilebilir taslaklar onaylanir.
7. Onayli taslaklar `GIB taslagina yukle` / `Onaylilari GIB'e yukle` ile portala aktarilir.
8. `e-Arsiv ac` ile portalda manuel/toplu imza tamamlanir.
9. Hero'daki `Kontrol et ve uygula` (veya `Dis kaynak faturalar` sekmesinde ayri `Son 7 gun imzalilarini kontrol et` + `Son 7 gun guvenli olanlari uygula`) ile imzali kayitlar SAFA'ya geri okunur.
10. PDF hazirsa `Trendyol'a gonder` ile pazaryerine dosya aktarilir.
11. `Arsiv & Indirmeler` ekraninda PDF, aylik Excel ve ZIP arsiv kontrol edilir.
12. `Operasyon` ekraninda hata, kuyruk ve tekrar deneme ihtiyaci izlenir.
13. `Ayarlar` ekraninda runtime ve baglanti durumu okunur.

## Kritik davranis ve risk notlari

- SAFA sahte siparis veya sahte fatura uretmez; backend/API baglantisi yoksa operasyon aksiyonlari hata veya disabled state ile durur.
- Harici fatura eslesmesi olan siparislerde SAFA tekrar fatura kesimini kapatir; cift fatura riskini engellemek icin bu kayitlar toplu taslak secimine alinmaz.
- GIB Portal'a taslak yuklemek resmi fatura olusturmak degildir. Resmi fatura icin portalda imza atilmali, sonra imzali kayit SAFA'ya geri okunmalidir.
- Son 7 gun penceresi fatura operasyon masasi icin oncelikli canli takip penceresidir. Daha eski kayitlar yeniden otomasyon takibine alinmaz.
- PDF bekleyen kayitlarda Trendyol'a dosya gonderimi engellenir veya resmi PDF yukleme beklenir.
- Proxy 502/503/504 gibi durumlarda uzun job'lar hemen fatura hatasi sayilmaz; `runIntegrationJob` son job durumunu tekrar kontrol eder.
- GIB Direct hazir degilse sistem sahte basarili fatura sonucu uretmez; eksik servis/imza/yetki alanlarini hata olarak birakir.
- Sifreli kasa acik session bilgisini tarayici storage'inda tutar. `Kilitle` butonu bu acik session bilgisini temizler, kasayi silmez.

## Durum / renk sozlugu

Arayuzdeki status pill ve tone renkleri:

- Yesil (success): tamam, onayli, imzali, bagli, gonderildi.
- Sari (warning): bekliyor, aksiyon gerekli, isleniyor, imza bekliyor.
- Kirmizi (danger): hata, basarisiz, eksik PDF/fatura.
- Gri (neutral): gecmis kayit, aksiyon gerekmez.

Para birimi TRY varsayilir; tarih/saat Europe/Istanbul; "son 7 gun" fatura operasyon masasinin oncelikli canli takip penceresidir.

## Dogrulama notu

Bu dosya `origin/main` kaynak kodu okumasiyla hazirlandi (sadelestirme Faz A-D + 429 fix sonrasi canli surum). Calistirilan analiz yuzeyleri:

- Next route dosyalari.
- Platform shell ve view bilesenleri.
- Fatura operasyon modeli, tab modeli, bulk selection modeli.
- Entegrasyon katalogu ve saved-information kasa modeli.
- Ortak API client ve Nest controller endpointleri.
- Firebase Hosting ve Next config.

Bu dokuman icin uygulama baslatilmadi, browser smoke yapilmadi ve canli API'ye mutasyon cagrisi gonderilmedi.

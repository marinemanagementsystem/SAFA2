# SAFA frontend redesign dokuman dizini

Bu klasor SAFA arayuzunu sifirdan, islev kaybi olmadan yeniden tasarlamak icin
hazirlanan konu bazli dosyalari toplar. Uygulama kodu degistirilmeden once bu
dosyalar tasarim, kapsam ve yayin guvenligi icin ana referans olarak
kullanilmalidir.

## 1. Islev koruma ve parity

- `../safa-sayfa-islev-envanteri.md`
  - Mevcut SAFA web panelindeki sayfalar, ic bolumler, tablar, butonlar,
    filtreler, linkler ve bunlarin arkadaki API/handler karsiliklari.
  - Redesign sirasinda "eskiden yapiliyordu, artik yapilamiyor" riskini
    engelleyen ana envanter.

- `parity-matrix.md`
  - Redesign icin islev koruma sozlesmesi.
  - Her mevcut islevin eski yeri, API/handler karsiligi, yeni UI'daki yeri ve
    korunma durumu burada izlenecek.

## 2. Tasarim yonleri

- `claude-tasarim-yonleri-mockup.html`
  - Claude Opus tarafindan onerilen uc tasarim yonunun standalone HTML mockup'i.
  - Secenekler: Operasyon Komuta Merkezi, Fatura Kanban Akisi, Minimal
    Ledger/Inbox.

- `codex-modern-tum-sayfalar-mockup.html`
  - Codex tarafindan hazirlanan daha modern ve tum sayfalari kapsayan HTML
    mockup.
  - Kapsam: Giris, Genel, Siparisler, Faturalar, Entegrasyonlar, Kayitli
    Bilgiler, Operasyon ve Ayarlar.

## 3. Yayin ve veri guvenligi notu

Redesign farkli branch veya farkli Firebase Hosting adresinde yayinlansa bile
`/api` rewrite hedefi canli Cloud Run servisine gidiyorsa canli veri degisebilir.
Bu nedenle preview/redesign yayininda en az bir guvenlik siniri zorunludur:

- staging API / ayri Cloud Run hedefi,
- frontend read-only guard,
- canli API'de origin veya environment bazli server-side write guard.

Redesign production'a alinmadan once parity matrix tamamlanmali, read-only/staging
hedefi dogrulanmali ve kritik mutasyonlarin canli veri uzerinde calismadigi
kanitlanmalidir.

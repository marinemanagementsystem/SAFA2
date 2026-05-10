export type IntegrationCategory = "marketplace" | "cargo" | "invoice";
export type IntegrationAvailability = "active" | "planned";

export interface IntegrationCatalogItem {
  id: string;
  name: string;
  category: IntegrationCategory;
  availability: IntegrationAvailability;
  headline: string;
  description: string;
  accent: "teal" | "amber" | "blue" | "rose" | "slate";
  capabilities: string[];
}

export const integrationCatalog: IntegrationCatalogItem[] = [
  {
    id: "trendyol",
    name: "Trendyol",
    category: "marketplace",
    availability: "active",
    headline: "Canli siparis ve fatura PDF akisi",
    description: "Teslim edilen paketleri ceker, e-Arsiv PDF'lerini geri yukler.",
    accent: "teal",
    capabilities: ["orders/stream", "PDF upload", "storefront"]
  },
  {
    id: "hepsiburada",
    name: "Hepsiburada",
    category: "marketplace",
    availability: "planned",
    headline: "Adapter planlandi",
    description: "Ayni siparis, fatura ve durum modeline baglanacak pazaryeri saglayicisi.",
    accent: "amber",
    capabilities: ["siparis sync", "fatura esleme", "durum takibi"]
  },
  {
    id: "amazon",
    name: "Amazon",
    category: "marketplace",
    availability: "planned",
    headline: "Adapter planlandi",
    description: "Marketplace order ve settlement akislari icin genislemeye hazir.",
    accent: "blue",
    capabilities: ["order import", "tax docs", "settlement"]
  },
  {
    id: "n11",
    name: "N11",
    category: "marketplace",
    availability: "planned",
    headline: "Adapter planlandi",
    description: "Siparis cekme, fatura baglama ve kargo durumlarini ortak modele tasir.",
    accent: "rose",
    capabilities: ["siparis", "fatura", "kargo"]
  },
  {
    id: "ciceksepeti",
    name: "Ciceksepeti",
    category: "marketplace",
    availability: "planned",
    headline: "Adapter planlandi",
    description: "Coklu kanal satis gorunurlugu icin sonraki pazaryeri adaptoru.",
    accent: "slate",
    capabilities: ["kanal", "fatura", "rapor"]
  },
  {
    id: "gib-earsiv",
    name: "GIB e-Arsiv",
    category: "invoice",
    availability: "active",
    headline: "Portal ve direct entegrasyon merkezi",
    description: "Taslak onayi, PDF uretimi ve portal oturumu mevcut akislara bagli.",
    accent: "teal",
    capabilities: ["taslak", "PDF", "portal"]
  },
  {
    id: "ozel-entegrator",
    name: "Ozel Entegratorler",
    category: "invoice",
    availability: "planned",
    headline: "Adapter planlandi",
    description: "Logo, Mikro, Paraşut veya benzeri saglayicilar icin ortak fatura adaptoru.",
    accent: "blue",
    capabilities: ["UBL", "arsiv", "mutabakat"]
  },
  {
    id: "yurtici",
    name: "Yurtici Kargo",
    category: "cargo",
    availability: "planned",
    headline: "Adapter planlandi",
    description: "Kargo takip numarasi, teslimat durumu ve iade akislari icin hazir slot.",
    accent: "amber",
    capabilities: ["tracking", "teslimat", "iade"]
  },
  {
    id: "aras",
    name: "Aras Kargo",
    category: "cargo",
    availability: "planned",
    headline: "Adapter planlandi",
    description: "Operasyon ekraninda kargo SLA ve durum esleme icin temsil edilir.",
    accent: "rose",
    capabilities: ["tracking", "SLA", "bildirim"]
  },
  {
    id: "mng",
    name: "MNG Kargo",
    category: "cargo",
    availability: "planned",
    headline: "Adapter planlandi",
    description: "Kargo firma havuzunda aktiflestirilebilir saglayici olarak hazir.",
    accent: "slate",
    capabilities: ["tracking", "sube", "iade"]
  },
  {
    id: "surat",
    name: "Surat Kargo",
    category: "cargo",
    availability: "planned",
    headline: "Adapter planlandi",
    description: "Durum normalize etme ve teslimat uyarilari icin genisletilebilir.",
    accent: "blue",
    capabilities: ["tracking", "durum", "uyari"]
  },
  {
    id: "ptt",
    name: "PTT Kargo",
    category: "cargo",
    availability: "planned",
    headline: "Adapter planlandi",
    description: "Kamu kargo akislari ve takip kodu eslemeleri icin planli slot.",
    accent: "amber",
    capabilities: ["tracking", "teslimat", "rapor"]
  },
  {
    id: "hepsijet",
    name: "HepsiJet",
    category: "cargo",
    availability: "planned",
    headline: "Adapter planlandi",
    description: "Hepsiburada operasyonlariyla birlikte kargo katmanina baglanacak.",
    accent: "teal",
    capabilities: ["tracking", "SLA", "iade"]
  },
  {
    id: "trendyol-express",
    name: "Trendyol Express",
    category: "cargo",
    availability: "planned",
    headline: "Adapter planlandi",
    description: "Trendyol paketleri icin kargo sinyallerini ayri izleme katmanina tasir.",
    accent: "teal",
    capabilities: ["tracking", "paket", "teslimat"]
  }
];

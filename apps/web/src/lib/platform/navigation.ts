import type { PlatformView } from "./types";

export interface NavItem {
  view: PlatformView;
  href: string;
  label: string;
  mobileLabel: string;
  description: string;
}

export const NAV_ITEMS: NavItem[] = [
  { view: "overview", href: "/", label: "Genel", mobileLabel: "Genel", description: "Canli operasyon ozeti" },
  { view: "orders", href: "/orders", label: "Siparisler", mobileLabel: "Siparis", description: "Paket ve siparis takibi" },
  { view: "invoices", href: "/invoices", label: "Faturalar", mobileLabel: "Fatura", description: "Taslak ve fatura akisi" },
  {
    view: "integrations",
    href: "/integrations",
    label: "Entegrasyonlar",
    mobileLabel: "Enteg.",
    description: "Pazaryeri ve kargo baglantilari"
  },
  {
    view: "saved-information",
    href: "/saved-information",
    label: "Kayitli Bilgiler",
    mobileLabel: "Kasa",
    description: "Sifreli profil kasasi"
  },
  { view: "operations", href: "/operations", label: "Operasyon", mobileLabel: "Ops", description: "Kuyruk, hata ve sync izleme" },
  { view: "settings", href: "/settings", label: "Ayarlar", mobileLabel: "Ayar", description: "Runtime ve saglayici durumu" }
];

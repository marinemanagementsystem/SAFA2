import type { PlatformView } from "./types";

export type NavGroup = "islem" | "kurulum";

export interface NavItem {
  view: PlatformView;
  href: string;
  label: string;
  mobileLabel: string;
  description: string;
  group: NavGroup;
}

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  islem: "Islem",
  kurulum: "Kurulum"
};

export const NAV_ITEMS: NavItem[] = [
  { view: "overview", href: "/", label: "Genel", mobileLabel: "Genel", description: "Canli operasyon ozeti", group: "islem" },
  { view: "orders", href: "/orders", label: "Siparisler", mobileLabel: "Siparis", description: "Paket ve siparis takibi", group: "islem" },
  { view: "invoices", href: "/invoices", label: "Faturalar", mobileLabel: "Fatura", description: "Taslak ve fatura akisi", group: "islem" },
  {
    view: "integrations",
    href: "/integrations",
    label: "Entegrasyonlar",
    mobileLabel: "Enteg.",
    description: "Pazaryeri ve kargo baglantilari",
    group: "kurulum"
  },
  {
    view: "saved-information",
    href: "/saved-information",
    label: "Kayitli Bilgiler",
    mobileLabel: "Kasa",
    description: "Sifreli profil kasasi",
    group: "kurulum"
  },
  {
    view: "operations",
    href: "/operations",
    label: "Operasyon",
    mobileLabel: "Ops",
    description: "Kuyruk, hata ve sync izleme",
    group: "kurulum"
  },
  { view: "settings", href: "/settings", label: "Ayarlar", mobileLabel: "Ayar", description: "Runtime ve saglayici durumu", group: "kurulum" }
];

export const NAV_GROUP_ORDER: NavGroup[] = ["islem", "kurulum"];

export function navItemsByGroup(group: NavGroup): NavItem[] {
  return NAV_ITEMS.filter((item) => item.group === group);
}

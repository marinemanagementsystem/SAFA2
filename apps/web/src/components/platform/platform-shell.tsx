"use client";

import {
  Activity,
  Boxes,
  FileText,
  Home,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  PackageCheck,
  PlugZap,
  ReceiptText,
  RefreshCw,
  Send,
  Settings2,
  ShieldOff
} from "lucide-react";
import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { NAV_ITEMS } from "../../lib/platform/navigation";
import type { PlatformView } from "../../lib/platform/types";
import { cx } from "../../lib/platform/format";
import type { PlatformSnapshot } from "./use-platform-data";

const navIcons: Record<PlatformView, ComponentType<{ size?: number }>> = {
  overview: Home,
  orders: PackageCheck,
  invoices: ReceiptText,
  integrations: PlugZap,
  "saved-information": KeyRound,
  operations: Activity,
  settings: Settings2
};

const viewTitles: Record<PlatformView, { title: string; subtitle: string }> = {
  overview: {
    title: "Operasyon merkezi",
    subtitle: "Siparis, fatura, e-Arsiv ve entegrasyon durumunu tek yerden takip et."
  },
  orders: {
    title: "Siparisler",
    subtitle: "Teslim paketlerini filtrele, fatura durumunu gor ve detaya in."
  },
  invoices: {
    title: "Faturalar",
    subtitle: "Taslaklari onayla, portal imzasini takip et ve aylik arsivi indir."
  },
  integrations: {
    title: "Entegrasyonlar",
    subtitle: "Trendyol, e-Arsiv ve GIB baglanti bilgilerini yonet."
  },
  "saved-information": {
    title: "Kayitli bilgiler",
    subtitle: "Profil kasasindan API ve portal bilgilerini formlara aktar."
  },
  operations: {
    title: "Operasyon izleme",
    subtitle: "Sync, fatura ve Trendyol gonderim denemelerini izle."
  },
  settings: {
    title: "Ayarlar",
    subtitle: "Runtime, saglayici ve saklama durumunu kontrol et."
  }
};

interface PlatformShellProps {
  view: PlatformView;
  snapshot: PlatformSnapshot;
  loadState: "idle" | "loading" | "error";
  busyAction: string | null;
  message: string;
  apiAvailable: boolean;
  children: ReactNode;
  onRefresh: () => void;
  onSync: () => void;
  onOpenPortal: () => void;
  onClosePortalSession: () => void;
  onLogout: () => void;
}

function connectionScore(snapshot: PlatformSnapshot) {
  const trendyol = snapshot.connections?.trendyol.configured ? 1 : 0;
  const gib = snapshot.connections?.gibPortal.configured ? 1 : 0;
  return trendyol + gib;
}

export function PlatformShell({
  view,
  snapshot,
  loadState,
  busyAction,
  message,
  apiAvailable,
  children,
  onRefresh,
  onSync,
  onOpenPortal,
  onClosePortalSession,
  onLogout
}: PlatformShellProps) {
  const title = viewTitles[view];
  const connected = connectionScore(snapshot);
  const isLiveMode = apiAvailable && snapshot.settings.liveIntegrationsOnly === true;

  return (
    <main className="platform-shell">
      <aside className="side-nav" aria-label="SAFA navigasyon">
        <Link className="brand-lockup" href="/" aria-label="SAFA overview">
          <span className="brand-mark">S</span>
          <span>
            <strong>SAFA</strong>
            <small>Commerce OS</small>
          </span>
        </Link>

        <nav className="nav-list" aria-label="Ana sayfalar">
          {NAV_ITEMS.map((item) => {
            const Icon = navIcons[item.view];
            return (
              <Link className={cx("nav-item", item.view === view && "active")} href={item.href} key={item.view}>
                <Icon size={18} />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="nav-health">
          <div>
            <span className="micro-label">Baglanti skoru</span>
            <strong>{apiAvailable ? `${connected}/2 canli` : "API bekliyor"}</strong>
          </div>
          <span className={cx("status-dot", apiAvailable && connected === 2 ? "success" : "warning")} aria-hidden="true" />
        </div>
      </aside>

      <section className="workspace">
        <header className="top-command">
          <div className="mobile-brand" aria-hidden="true">
            <span className="brand-mark">S</span>
            <strong>SAFA</strong>
          </div>

          <div className="page-heading">
            <h1>{title.title}</h1>
            <p>{title.subtitle}</p>
          </div>

          <div className="command-actions" aria-label="Ana islemler">
            <button className="ui-button ghost" onClick={onRefresh} disabled={!apiAvailable || loadState === "loading" || busyAction === "refresh"}>
              {loadState === "loading" || busyAction === "refresh" ? <Loader2 size={18} className="spin" /> : <RefreshCw size={18} />}
              Yenile
            </button>
            <button className="ui-button primary" onClick={onSync} disabled={!apiAvailable || busyAction === "sync"}>
              {busyAction === "sync" ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
              {apiAvailable ? "Trendyol cek" : "API bekleniyor"}
            </button>
            <button className="ui-button ghost" onClick={onOpenPortal} disabled={busyAction === "open-gib"}>
              {busyAction === "open-gib" ? <Loader2 size={18} className="spin" /> : <LogIn size={18} />}
              e-Arsiv ac
            </button>
            <button className="ui-button ghost" onClick={onClosePortalSession} disabled={!apiAvailable || busyAction === "logout-gib"}>
              {busyAction === "logout-gib" ? <Loader2 size={18} className="spin" /> : <ShieldOff size={18} />}
              e-Arsiv cikis
            </button>
            <button className="ui-button ghost" onClick={onLogout}>
              <LogOut size={18} />
              Cikis
            </button>
          </div>
        </header>

        <div className="system-ribbon" role="status">
          <div className="ribbon-copy">
            <Boxes size={18} />
            <span>{message}</span>
          </div>
          <span className={cx("mode-pill", apiAvailable && isLiveMode ? "success" : "warning")}>
            {!apiAvailable ? "Backend baglantisi bekleniyor" : isLiveMode ? "Canli entegrasyon modu" : "Canli mod kontrol ediliyor"}
          </span>
        </div>

        {children}

        <nav className="mobile-tabbar" aria-label="Mobil navigasyon">
          {NAV_ITEMS.map((item) => {
            const Icon = navIcons[item.view];
            return (
              <Link className={cx("mobile-tab", item.view === view && "active")} href={item.href} key={item.view}>
                <Icon size={18} />
                <span>{item.mobileLabel}</span>
              </Link>
            );
          })}
        </nav>
      </section>

      <FileText className="watermark-icon" size={420} aria-hidden="true" />
    </main>
  );
}

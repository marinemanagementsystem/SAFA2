"use client";

import { ArrowRight, CheckCircle2, Clock3, Loader2, PackageCheck, ReceiptText, Send, ShieldCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { cx, formatDateTime, money, statusLabel, statusTone } from "../../lib/platform/format";
import { integrationCatalog } from "../../lib/platform/integration-catalog";
import type { PlatformSnapshot } from "./use-platform-data";

interface OverviewViewProps {
  snapshot: PlatformSnapshot;
  loadState: "idle" | "loading" | "error";
  busyAction: string | null;
  apiAvailable: boolean;
  onSync: () => void;
}

export function OverviewView({ snapshot, loadState, busyAction, apiAvailable, onSync }: OverviewViewProps) {
  const ready = snapshot.drafts.filter((draft) => draft.status === "READY" && draft.externalInvoiceCount === 0).length;
  const approved = snapshot.drafts.filter((draft) => draft.status === "APPROVED" && draft.externalInvoiceCount === 0).length;
  const externalDrafts = snapshot.drafts.filter((draft) => draft.externalInvoiceCount > 0).length;
  const issued = snapshot.orders.filter((order) => order.invoiceId).length;
  const externalMatched = snapshot.orders.filter((order) => !order.invoiceId && order.externalInvoiceCount > 0).length;
  const unknownInvoice = Math.max(snapshot.orders.length - issued - externalMatched, 0);
  const failedJobs = snapshot.jobs.filter((job) => job.status === "FAILED").length;
  const totalRevenue = snapshot.orders.reduce((sum, order) => sum + order.totalPayableCents, 0);
  const latestJob = snapshot.jobs[0];
  const activeIntegrations = integrationCatalog.filter((item) => item.availability === "active");

  return (
    <div className="view-stack">
      <section className="overview-hero">
        <div className="hero-copy">
          <h2>Bugunku operasyon durumu</h2>
          <p>
            Trendyol teslim paketleri, e-Arsiv taslaklari, PDF ciktilari ve entegrasyon sagligi burada ozetlenir.
          </p>
          <div className="hero-actions">
            <button className="ui-button primary" onClick={onSync} disabled={!apiAvailable || busyAction === "sync"}>
              {busyAction === "sync" ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
              {apiAvailable ? "Trendyol cek" : "API bekleniyor"}
            </button>
            <Link className="ui-button ghost" href="/integrations">
              Entegrasyonlari gor
              <ArrowRight size={18} />
            </Link>
          </div>
        </div>

        <div className="hero-orchestrator" aria-label="Operasyon akisi">
          <div className="flow-step active">
            <PackageCheck size={20} />
            <span>Orders</span>
            <strong>{snapshot.orders.length}</strong>
          </div>
          <div className="flow-line" />
          <div className="flow-step active">
            <ReceiptText size={20} />
            <span>Drafts</span>
            <strong>{ready + approved}</strong>
          </div>
          <div className="flow-line" />
          <div className={cx("flow-step", failedJobs > 0 ? "danger" : "active")}>
            {failedJobs > 0 ? <TriangleAlert size={20} /> : <ShieldCheck size={20} />}
            <span>Jobs</span>
            <strong>{failedJobs > 0 ? `${failedJobs} hata` : "Temiz"}</strong>
          </div>
        </div>
      </section>

      <section className="metric-grid" aria-label="Platform metrikleri">
        <article className="metric-card">
          <span className="micro-label">Teslim paket</span>
          <strong>{snapshot.orders.length}</strong>
          <small>{loadState === "loading" ? "Yenileniyor" : "Aktif liste"}</small>
        </article>
        <article className="metric-card">
          <span className="micro-label">SAFA fatura kapsami</span>
          <strong>
            {issued} / {externalMatched}
          </strong>
          <small>SAFA'da kesilen / harici bulunan</small>
        </article>
        <article className="metric-card">
          <span className="micro-label">Taslak kontrol</span>
          <strong>
            {ready} / {approved}
          </strong>
          <small>Hazir / onayli, {externalDrafts} harici kapali</small>
        </article>
        <article className="metric-card">
          <span className="micro-label">Siparis hacmi</span>
          <strong>{money(totalRevenue)}</strong>
          <small>Filtrelenmemis toplam</small>
        </article>
      </section>

      <section className="content-grid two-col">
        <article className="surface-panel">
          <div className="section-head">
            <div>
              <span className="micro-label">Aktif saglayicilar</span>
              <h2>Canli baglantilar</h2>
            </div>
            <Link className="text-link" href="/integrations">
              Yonet
            </Link>
          </div>

          <div className="provider-strip">
            {activeIntegrations.map((item) => (
              <div className={cx("provider-card compact", item.accent)} key={item.id}>
                <span className="provider-initial">{item.name.slice(0, 2).toLocaleUpperCase("tr-TR")}</span>
                <div>
                  <strong>{item.name}</strong>
                  <small>{item.headline}</small>
                </div>
                <span className="status-pill success">Aktif</span>
              </div>
            ))}
          </div>
        </article>

        <article className="surface-panel">
          <div className="section-head">
            <div>
              <span className="micro-label">Son olay</span>
              <h2>Operasyon nabzi</h2>
            </div>
            <Link className="text-link" href="/operations">
              Kuyruga git
            </Link>
          </div>

          {latestJob ? (
            <div className="event-card">
              <span className={cx("status-pill", statusTone(latestJob.status))}>{statusLabel(latestJob.status)}</span>
              <h3>{latestJob.type}</h3>
              <p className="mono">{latestJob.target}</p>
              <small>{formatDateTime(latestJob.updatedAt)}</small>
            </div>
          ) : (
            <div className="empty-state">
              <CheckCircle2 size={24} />
              <strong>Kuyruk bos</strong>
              <p>Henüz fatura veya gonderim isi olusmadi.</p>
            </div>
          )}
        </article>
      </section>

      <section className="surface-panel">
        <div className="section-head">
          <div>
            <span className="micro-label">Bugunun odagi</span>
            <h2>Fatura aksiyonlari</h2>
          </div>
          <Clock3 size={20} />
        </div>

        <div className="action-lanes">
          <Link className="action-lane" href="/orders">
            <span>{unknownInvoice}</span>
            <strong>Bilinen faturasi yok</strong>
            <small>SAFA veya harici eslesme bekleyenler</small>
          </Link>
          <Link className="action-lane" href="/invoices">
            <span>{ready}</span>
            <strong>Hazir taslak</strong>
            <small>Toplu onay ve fatura kesme akisi</small>
          </Link>
          <Link className="action-lane" href="/operations">
            <span>{failedJobs}</span>
            <strong>Hata sinyali</strong>
            <small>Basarisiz job ve gonderim denemeleri</small>
          </Link>
        </div>
      </section>
    </div>
  );
}

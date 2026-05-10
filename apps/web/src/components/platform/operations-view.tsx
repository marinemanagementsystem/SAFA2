"use client";

import type { IntegrationJobListItem, InvoiceDraftListItem, InvoiceListItem, OrderListItem } from "@safa/shared";
import { Activity, AlertTriangle, CheckCircle2, Clock3, PackageCheck } from "lucide-react";
import { cx, formatDateTime, statusTone } from "../../lib/platform/format";
import { FailedJobRetryButton, InvoiceProcessBar, JobStatusPill } from "./invoice-process";

interface OperationsViewProps {
  jobs: IntegrationJobListItem[];
  orders: OrderListItem[];
  drafts: InvoiceDraftListItem[];
  invoices: InvoiceListItem[];
  onRetryInvoice: (draftId: string) => void;
}

export function OperationsView({ jobs, orders, drafts, invoices, onRetryInvoice }: OperationsViewProps) {
  const failed = jobs.filter((job) => job.status === "FAILED");
  const processing = jobs.filter((job) => job.status === "PROCESSING" || job.status === "PENDING");
  const reviewDrafts = drafts.filter((draft) => draft.status === "NEEDS_REVIEW" || draft.errors.length > 0);
  const ordersWithoutKnownInvoice = orders.filter((order) => !order.invoiceId && order.externalInvoiceCount === 0);
  const draftById = new Map(drafts.map((draft) => [draft.id, draft]));
  const invoiceByDraftId = new Map(invoices.map((invoice) => [invoice.draftId, invoice]));

  return (
    <div className="view-stack">
      <section className="metric-grid operations-metrics" aria-label="Operasyon metrikleri">
        <article className="metric-card">
          <span className="micro-label">Bekleyen is</span>
          <strong>{processing.length}</strong>
          <small>Kuyrukta veya isleniyor</small>
        </article>
        <article className="metric-card">
          <span className="micro-label">Hata</span>
          <strong>{failed.length}</strong>
          <small>Manuel kontrol gerektiren job</small>
        </article>
        <article className="metric-card">
          <span className="micro-label">Kontrol gerekli</span>
          <strong>{reviewDrafts.length}</strong>
          <small>Taslak uyarisi veya hata</small>
        </article>
        <article className="metric-card">
          <span className="micro-label">Bilinen faturasi yok</span>
          <strong>{ordersWithoutKnownInvoice.length}</strong>
          <small>SAFA veya harici eslesmesi olmayan paket</small>
        </article>
      </section>

      <section className="content-grid two-col">
        <article className="surface-panel">
          <div className="section-head">
            <div>
              <span className="micro-label">Is kuyrugu</span>
              <h2>Son denemeler</h2>
            </div>
            <Activity size={20} />
          </div>

          <div className="timeline-list">
            {jobs.slice(0, 16).map((job) => {
              const draft = draftById.get(job.target);
              const invoice = invoiceByDraftId.get(job.target);
              const orderNumber = draft?.orderNumber ?? job.target;

              return (
              <div className={cx("timeline-row job-process-row", statusTone(job.status))} key={job.id}>
                <span className={cx("timeline-marker", statusTone(job.status))} />
                <div className="job-process-card">
                  <div className="job-process-head">
                    <div>
                      <JobStatusPill job={job} />
                      <h3>{draft ? `${draft.orderNumber} fatura sureci` : job.type}</h3>
                      <p className="mono">{draft ? `${draft.customerName} · ${draft.shipmentPackageId}` : job.target}</p>
                    </div>
                    <FailedJobRetryButton draft={draft} job={job} onRetry={onRetryInvoice} />
                  </div>
                  <InvoiceProcessBar draft={draft} invoice={invoice} job={job} compact />
                  {job.lastError ? (
                    <div className="job-error-callout">
                      <AlertTriangle size={16} />
                      <span>
                        {orderNumber}: {job.lastError}
                      </span>
                    </div>
                  ) : null}
                  <small>
                    {formatDateTime(job.updatedAt)} · {job.attempts} deneme
                  </small>
                </div>
              </div>
              );
            })}
            {jobs.length === 0 ? (
              <div className="empty-state">
                <CheckCircle2 size={24} />
                <strong>Kuyruk bos</strong>
                <p>Fatura kesme veya gonderim isi olustugunda burada gorunur.</p>
              </div>
            ) : null}
          </div>
        </article>

        <article className="surface-panel">
          <div className="section-head">
            <div>
              <span className="micro-label">Aksiyon radar</span>
              <h2>Oncelikli sinyaller</h2>
            </div>
            <AlertTriangle size={20} />
          </div>

          <div className="signal-stack">
            <SignalCard icon={<AlertTriangle size={20} />} title="Basarisiz job" value={failed.length} tone={failed.length > 0 ? "danger" : "success"} />
            <SignalCard icon={<Clock3 size={20} />} title="Bekleyen job" value={processing.length} tone={processing.length > 0 ? "warning" : "success"} />
            <SignalCard
              icon={<PackageCheck size={20} />}
              title="Bilinen faturasi yok"
              value={ordersWithoutKnownInvoice.length}
              tone={ordersWithoutKnownInvoice.length > 0 ? "warning" : "success"}
            />
          </div>

          <div className="operation-note">
            <strong>Adapter-hazir operasyon modeli</strong>
            <p>
              Yeni pazaryeri ve kargo adaptorleri eklendiginde ayni kuyruk, hata, deneme sayisi ve hedef alanlari bu ekranda
              ortak operasyon diliyle izlenecek.
            </p>
          </div>
        </article>
      </section>
    </div>
  );
}

function SignalCard({
  icon,
  title,
  value,
  tone
}: {
  icon: React.ReactNode;
  title: string;
  value: number;
  tone: "success" | "warning" | "danger";
}) {
  return (
    <div className={cx("signal-card", tone)}>
      {icon}
      <div>
        <strong>{value}</strong>
        <span>{title}</span>
      </div>
    </div>
  );
}

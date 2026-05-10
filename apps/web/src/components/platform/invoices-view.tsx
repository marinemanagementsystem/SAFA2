"use client";

import type { ExternalInvoiceListItem, ExternalInvoiceSource, InvoiceDraftListItem, InvoiceListItem } from "@safa/shared";
import { Check, CircleDollarSign, FileSearch, FileText, Link2, Loader2, RefreshCw, UploadCloud } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../../lib/api";
import { cx, formatDateTime, money, startOfToday, statusLabel, statusTone } from "../../lib/platform/format";

interface InvoicesViewProps {
  drafts: InvoiceDraftListItem[];
  invoices: InvoiceListItem[];
  externalInvoices: ExternalInvoiceListItem[];
  settings: Record<string, unknown>;
  busyAction: string | null;
  onApprove: (ids: string[]) => void;
  onIssue: (ids: string[]) => void;
  onUploadPortalDrafts: (ids: string[]) => void;
  onImportExternalInvoices: (source: ExternalInvoiceSource, records: Array<Record<string, unknown>>) => void;
  onSyncGibExternalInvoices: (days: number) => void;
  onSyncTrendyolExternalInvoices: () => void;
  onReconcileExternalInvoices: () => void;
  onMatchExternalInvoice: (id: string, target: string) => void;
}

export function InvoicesView({
  drafts,
  invoices,
  externalInvoices,
  busyAction,
  onApprove,
  onIssue,
  onUploadPortalDrafts,
  onImportExternalInvoices,
  onSyncGibExternalInvoices,
  onSyncTrendyolExternalInvoices,
  onReconcileExternalInvoices,
  onMatchExternalInvoice
}: InvoicesViewProps) {
  const [selectedDrafts, setSelectedDrafts] = useState<string[]>([]);
  const [externalSource, setExternalSource] = useState<ExternalInvoiceSource>("GIB_PORTAL");
  const [externalText, setExternalText] = useState("");
  const [externalDays, setExternalDays] = useState(30);
  const [externalError, setExternalError] = useState("");
  const externallyInvoicedDrafts = drafts.filter(
    (draft) => (draft.status === "READY" || draft.status === "APPROVED") && draft.externalInvoiceCount > 0
  );
  const readyOrApproved = drafts.filter(
    (draft) => (draft.status === "READY" || draft.status === "APPROVED") && draft.externalInvoiceCount === 0
  );
  const portalDraftedDrafts = drafts.filter((draft) => draft.status === "PORTAL_DRAFTED");
  const matchedExternalInvoices = externalInvoices.filter((invoice) => invoice.matchedOrderId).length;

  const invoiceGroups = useMemo(() => {
    const today = startOfToday();
    const newInvoices = invoices.filter((invoice) => new Date(invoice.invoiceDate) >= today);
    const previousInvoices = invoices.filter((invoice) => new Date(invoice.invoiceDate) < today);
    return { newInvoices, previousInvoices };
  }, [invoices]);

  function toggleDraft(id: string, checked: boolean) {
    setSelectedDrafts((current) => (checked ? [...current, id] : current.filter((draftId) => draftId !== id)));
  }

  function approveSelected() {
    onApprove(selectedDrafts);
    setSelectedDrafts([]);
  }

  function issueSelected() {
    onIssue(selectedDrafts);
    setSelectedDrafts([]);
  }

  function uploadPortalSelected() {
    onUploadPortalDrafts(selectedDrafts);
    setSelectedDrafts([]);
  }

  function importExternal() {
    try {
      const records = parseExternalInvoiceText(externalText);
      setExternalError("");
      onImportExternalInvoices(externalSource, records);
    } catch (error) {
      setExternalError(error instanceof Error ? error.message : "Harici fatura listesi okunamadi.");
    }
  }

  return (
    <div className="view-stack">
      <section className="content-grid invoice-grid">
        <article className="surface-panel">
          <div className="section-head">
            <div>
              <span className="micro-label">Onay masasi</span>
              <h2>{readyOrApproved.length} islenebilir taslak</h2>
            </div>
            <span className="mode-pill">{selectedDrafts.length} secili</span>
          </div>

          {externallyInvoicedDrafts.length > 0 ? (
            <div className="form-alert table-note">
              {externallyInvoicedDrafts.length} taslak harici e-Arsiv faturasiyla eslestigi icin tekrar fatura kesimine kapatildi.
              Bunlar siparis ekraninda "Harici bulundu" olarak gorunur.
            </div>
          ) : null}

          <div className="draft-stack">
            {portalDraftedDrafts.length > 0 ? (
              <div className="form-alert table-note">
                {portalDraftedDrafts.length} taslak GIB portalina yuklendi ve manuel imza bekliyor. Portalda Duzenlenen Belgeler
                ekranindan toplu imzalanacak.
              </div>
            ) : null}
            {readyOrApproved.map((draft) => (
              <label className="draft-card" key={draft.id}>
                <input
                  type="checkbox"
                  checked={selectedDrafts.includes(draft.id)}
                  onChange={(event) => toggleDraft(draft.id, event.target.checked)}
                />
                <span className="draft-body">
                  <span className={cx("status-pill", statusTone(draft.status))}>{statusLabel(draft.status)}</span>
                  <strong>{draft.orderNumber}</strong>
                  <small>
                    {draft.customerName} · {money(draft.totalPayableCents, draft.currency)} · {draft.lineCount} satir
                  </small>
                  {draft.warnings.length > 0 ? <em>{draft.warnings[0]}</em> : null}
                  <a className="text-link" href={api.draftPdfUrl(draft.id)} target="_blank" rel="noreferrer">
                    Taslak PDF
                  </a>
                </span>
              </label>
            ))}
            {readyOrApproved.length === 0 ? (
              <div className="empty-state">
                <FileText size={24} />
                <strong>Onaya hazir taslak yok</strong>
                <p>Trendyol cek sonrasi hazir taslaklar burada listelenir.</p>
              </div>
            ) : null}
          </div>

          <div className="sticky-actionbar">
            <button className="ui-button ghost" onClick={approveSelected} disabled={selectedDrafts.length === 0 || busyAction === "approve"}>
              {busyAction === "approve" ? <Loader2 size={18} className="spin" /> : <Check size={18} />}
              Seciliyi onayla
            </button>
            <button className="ui-button primary" onClick={issueSelected} disabled={selectedDrafts.length === 0 || busyAction === "issue"}>
              {busyAction === "issue" ? <Loader2 size={18} className="spin" /> : <CircleDollarSign size={18} />}
              Fatura kes
            </button>
            <button
              className="ui-button primary"
              onClick={uploadPortalSelected}
              disabled={selectedDrafts.length === 0 || busyAction === "portal-draft-upload"}
            >
              {busyAction === "portal-draft-upload" ? <Loader2 size={18} className="spin" /> : <UploadCloud size={18} />}
              GIB taslagina yukle
            </button>
          </div>
        </article>

        <article className="surface-panel">
          <div className="section-head">
            <div>
              <span className="micro-label">PDF arsivi</span>
              <h2>{invoices.length} kesilmis fatura</h2>
            </div>
            <FileText size={20} />
          </div>

          <InvoiceArchiveSection title="Bugun kesilenler" invoices={invoiceGroups.newInvoices} />
          <InvoiceArchiveSection title="Onceki faturalar" invoices={invoiceGroups.previousInvoices.slice(0, 12)} />
        </article>
      </section>

      <section className="surface-panel">
        <div className="section-head">
          <div>
            <span className="micro-label">Harici fatura sorgulama</span>
            <h2>{externalInvoices.length} dis fatura kaydi</h2>
            <p className="section-copy">
              e-Arsiv Portal'dan canli sorgula, Trendyol siparis verisinde fatura izi ara veya gercek dis fatura listesini aktar.
              Eslesen kayitlar siparis ekraninda "Harici bulundu" olarak gorunur.
            </p>
          </div>
          <span className={cx("status-pill", matchedExternalInvoices > 0 ? "success" : "warning")}>
            {matchedExternalInvoices} eslesme
          </span>
        </div>

        <div className="external-tools">
          <label className="field compact-field">
            <span>e-Arsiv gun araligi</span>
            <input
              type="number"
              min={1}
              max={90}
              value={externalDays}
              onChange={(event) => setExternalDays(Number(event.target.value))}
            />
          </label>
          <button
            className="ui-button primary"
            onClick={() => onSyncGibExternalInvoices(externalDays)}
            disabled={busyAction === "external-gib-sync"}
          >
            {busyAction === "external-gib-sync" ? <Loader2 size={18} className="spin" /> : <FileSearch size={18} />}
            e-Arsiv sorgula
          </button>
          <button
            className="ui-button ghost"
            onClick={onSyncTrendyolExternalInvoices}
            disabled={busyAction === "external-trendyol-sync"}
          >
            {busyAction === "external-trendyol-sync" ? <Loader2 size={18} className="spin" /> : <RefreshCw size={18} />}
            Trendyol fatura izi ara
          </button>
          <button className="ui-button ghost" onClick={onReconcileExternalInvoices} disabled={busyAction === "external-reconcile"}>
            {busyAction === "external-reconcile" ? <Loader2 size={18} className="spin" /> : <Check size={18} />}
            Tekrar eslestir
          </button>
        </div>

        <div className="external-import-grid">
          <div className="external-import-form">
            <label className="field">
              <span>Kaynak</span>
              <select value={externalSource} onChange={(event) => setExternalSource(event.target.value as ExternalInvoiceSource)}>
                <option value="GIB_PORTAL">e-Arsiv Portal</option>
                <option value="TRENDYOL">Trendyol</option>
                <option value="MANUAL">Diger gercek kaynak</option>
              </select>
            </label>
            <label className="field">
              <span>Gercek fatura listesi JSON veya CSV</span>
              <textarea
                value={externalText}
                onChange={(event) => setExternalText(event.target.value)}
                placeholder="faturaNo;tarih;alici;vknTckn;tutar;siparisNo"
                rows={7}
              />
            </label>
            {externalError ? <div className="form-alert danger">{externalError}</div> : null}
            <button className="ui-button primary" onClick={importExternal} disabled={!externalText.trim() || busyAction === "external-import"}>
              {busyAction === "external-import" ? <Loader2 size={18} className="spin" /> : <UploadCloud size={18} />}
              Listeyi al ve eslestir
            </button>
          </div>

          <div className="external-invoice-list">
            {externalInvoices.slice(0, 12).map((invoice) => (
              <ExternalInvoiceRow
                invoice={invoice}
                busy={busyAction === `external-match-${invoice.id}`}
                onMatch={(target) => onMatchExternalInvoice(invoice.id, target)}
                key={invoice.id}
              />
            ))}
            {externalInvoices.length === 0 ? <div className="mini-empty">Harici fatura kaydi yok.</div> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function ExternalInvoiceRow({
  invoice,
  busy,
  onMatch
}: {
  invoice: ExternalInvoiceListItem;
  busy: boolean;
  onMatch: (target: string) => void;
}) {
  const [target, setTarget] = useState("");

  return (
    <div className="external-invoice-row">
      <span className={cx("status-pill", invoice.matchedOrderId ? "success" : "warning")}>
        {invoice.matchedOrderId ? "Eslesti" : "Acik"}
      </span>
      <div>
        <strong>{invoice.invoiceNumber ?? "Fatura no yok"}</strong>
        <small>
          {sourceLabel(invoice.source)} · {invoice.matchedOrderNumber ?? invoice.orderNumber ?? "Siparis eslesmedi"} ·{" "}
          {invoice.invoiceDate ? formatDateTime(invoice.invoiceDate) : "Tarih yok"}
        </small>
        {!invoice.matchedOrderId ? (
          <div className="manual-match">
            <input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="Siparis no veya paket no" />
            <button className="ui-button ghost compact" onClick={() => onMatch(target)} disabled={!target.trim() || busy}>
              {busy ? <Loader2 size={16} className="spin" /> : <Link2 size={16} />}
              Eslestir
            </button>
          </div>
        ) : null}
      </div>
      <span>{invoice.totalPayableCents ? money(invoice.totalPayableCents, invoice.currency) : "-"}</span>
    </div>
  );
}

function InvoiceArchiveSection({ title, invoices }: { title: string; invoices: InvoiceListItem[] }) {
  return (
    <section className="archive-section">
      <div className="archive-head">
        <h3>{title}</h3>
        <span>{invoices.length}</span>
      </div>
      <div className="archive-list">
        {invoices.map((invoice) => (
          <a className="archive-row" href={api.invoicePdfUrl(invoice.id)} target="_blank" rel="noreferrer" key={invoice.id}>
            <span className={cx("status-pill", statusTone(invoice.status))}>{statusLabel(invoice.status)}</span>
            <strong>{invoice.invoiceNumber}</strong>
            <small>
              {invoice.orderNumber} · {formatDateTime(invoice.invoiceDate)}
            </small>
          </a>
        ))}
        {invoices.length === 0 ? <div className="mini-empty">Bu bolumde fatura yok.</div> : null}
      </div>
    </section>
  );
}

function sourceLabel(source: ExternalInvoiceSource) {
  if (source === "GIB_PORTAL") return "e-Arsiv";
  if (source === "TRENDYOL") return "Trendyol";
  return "Diger";
}

function parseExternalInvoiceText(text: string): Array<Record<string, unknown>> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Liste bos. e-Arsiv/Trendyol'dan aldiginiz gercek kayitlari yapistirin.");

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as unknown;
    const records = extractRecords(parsed);
    if (records.length === 0) throw new Error("JSON icinde fatura listesi bulunamadi.");
    return records;
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) throw new Error("CSV icin ilk satir baslik, sonraki satirlar fatura kaydi olmalidir.");

  const separator = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const headers = splitCsvLine(lines[0], separator);

  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line, separator);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function extractRecords(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];

  for (const key of ["invoices", "data", "rows", "items", "content"]) {
    const child = value[key];
    if (Array.isArray(child)) return child.filter(isRecord);
  }

  return [value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function splitCsvLine(line: string, separator: string) {
  return line
    .split(separator)
    .map((item) => item.trim().replace(/^"|"$/g, "").replace(/""/g, '"'));
}

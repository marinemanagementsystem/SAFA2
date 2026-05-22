import type {
  ExternalInvoiceListItem,
  IntegrationJobListItem,
  InvoiceDraftListItem,
  InvoiceListItem
} from "@safa/shared";

export type InvoiceOperationSourceKind = "draft" | "invoice" | "external";
export type InvoiceOperationStageKey = "draft" | "gib" | "pdf" | "marketplace";
export type InvoiceOperationStageState = "done" | "waiting" | "missing" | "failed" | "idle";
export type InvoiceOperationTone = "success" | "warning" | "danger" | "neutral";
export type InvoiceOperationQueueKey = "all" | "action" | "pdf-missing" | "portal-signature" | "external-found" | "marketplace";
export type InvoiceOperationActionKind =
  | "approve"
  | "portal"
  | "retry"
  | "preview-signed"
  | "apply-external"
  | "promote-external"
  | "upload-pdf"
  | "send-trendyol"
  | "open-portal"
  | "view-order"
  | "none";

export interface InvoiceOperationStage {
  key: InvoiceOperationStageKey;
  label: string;
  state: InvoiceOperationStageState;
  detail: string;
}

export interface InvoiceOperationNextAction {
  kind: InvoiceOperationActionKind;
  label: string;
  detail: string;
  tone: InvoiceOperationTone;
}

export interface InvoiceOperationDetailEvent {
  key: InvoiceOperationStageKey;
  title: string;
  detail: string;
  tone: InvoiceOperationTone;
  at?: string;
}

export interface InvoiceOperationRow {
  id: string;
  sourceKind: InvoiceOperationSourceKind;
  orderNumber: string;
  shipmentPackageId: string;
  customerName: string;
  amountCents: number;
  currency: string;
  priority: number;
  priorityLabel: string;
  statusLabel: string;
  statusTone: InvoiceOperationTone;
  draft?: InvoiceDraftListItem;
  invoice?: InvoiceListItem;
  externalInvoice?: ExternalInvoiceListItem;
  job?: IntegrationJobListItem;
  stages: Record<InvoiceOperationStageKey, InvoiceOperationStage>;
  nextAction: InvoiceOperationNextAction;
  detailEvents: InvoiceOperationDetailEvent[];
  queueKeys: InvoiceOperationQueueKey[];
  sortTime: number;
  searchText: string;
}

export interface InvoiceOperationMetrics {
  actionCount: number;
  portalSignatureCount: number;
  pdfMissingCount: number;
  externalFoundCount: number;
  marketplaceCount: number;
}

export interface InvoiceOperationBuildInput {
  drafts: InvoiceDraftListItem[];
  invoices: InvoiceListItem[];
  externalInvoices: ExternalInvoiceListItem[];
  jobs: IntegrationJobListItem[];
}

const stageLabels: Record<InvoiceOperationStageKey, string> = {
  draft: "Taslak",
  gib: "GIB",
  pdf: "PDF",
  marketplace: "Pazaryeri"
};

const operationTimeZone = "Europe/Istanbul";

export function buildInvoiceOperationRows(input: InvoiceOperationBuildInput): InvoiceOperationRow[] {
  const invoiceByDraftId = new Map(input.invoices.map((invoice) => [invoice.draftId, invoice]));
  const externalById = new Map(input.externalInvoices.map((invoice) => [invoice.id, invoice]));
  const externalByOrderKey = new Map<string, ExternalInvoiceListItem>();
  const consumedInvoiceIds = new Set<string>();
  const consumedExternalIds = new Set<string>();

  for (const externalInvoice of input.externalInvoices) {
    for (const key of externalOrderKeys(externalInvoice)) {
      if (!externalByOrderKey.has(key)) externalByOrderKey.set(key, externalInvoice);
    }
  }

  const rows: InvoiceOperationRow[] = input.drafts.map((draft) => {
    const invoice = invoiceByDraftId.get(draft.id);
    if (invoice) consumedInvoiceIds.add(invoice.id);
    const externalInvoice =
      (invoice?.externalInvoiceId ? externalById.get(invoice.externalInvoiceId) : undefined) ??
      findExternalForDraft(draft, externalByOrderKey);
    if (externalInvoice) consumedExternalIds.add(externalInvoice.id);
    return buildInvoiceOperationRow({
      sourceKind: "draft",
      draft,
      invoice,
      externalInvoice,
      job: latestInvoiceJob(input.jobs, draft.id)
    });
  });

  for (const invoice of input.invoices) {
    if (consumedInvoiceIds.has(invoice.id)) continue;
    const externalInvoice = invoice.externalInvoiceId ? externalById.get(invoice.externalInvoiceId) : undefined;
    if (externalInvoice) consumedExternalIds.add(externalInvoice.id);
    rows.push(buildInvoiceOperationRow({ sourceKind: "invoice", invoice, externalInvoice }));
  }

  for (const externalInvoice of input.externalInvoices) {
    if (consumedExternalIds.has(externalInvoice.id)) continue;
    rows.push(buildInvoiceOperationRow({ sourceKind: "external", externalInvoice }));
  }

  return rows.sort((left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority;
    if (right.sortTime !== left.sortTime) return right.sortTime - left.sortTime;
    return left.orderNumber.localeCompare(right.orderNumber, "tr-TR");
  });
}

export function filterInvoiceOperationRows(
  rows: InvoiceOperationRow[],
  input: { query: string; queue: InvoiceOperationQueueKey }
) {
  const search = normalizeSearch(input.query);
  return rows.filter((row) => {
    if (input.queue !== "all" && !row.queueKeys.includes(input.queue)) return false;
    if (search && !row.searchText.includes(search)) return false;
    return true;
  });
}

export function buildInvoiceOperationMetrics(rows: InvoiceOperationRow[]): InvoiceOperationMetrics {
  return {
    actionCount: rows.filter((row) => row.queueKeys.includes("action")).length,
    portalSignatureCount: rows.filter((row) => row.queueKeys.includes("portal-signature")).length,
    pdfMissingCount: rows.filter((row) => row.queueKeys.includes("pdf-missing")).length,
    externalFoundCount: rows.filter((row) => row.queueKeys.includes("external-found")).length,
    marketplaceCount: rows.filter((row) => row.queueKeys.includes("marketplace")).length
  };
}

function buildInvoiceOperationRow(input: {
  sourceKind: InvoiceOperationSourceKind;
  draft?: InvoiceDraftListItem;
  invoice?: InvoiceListItem;
  externalInvoice?: ExternalInvoiceListItem;
  job?: IntegrationJobListItem;
}): InvoiceOperationRow {
  const { draft, invoice, externalInvoice, job, sourceKind } = input;
  const visibleJob = visibleInvoiceJob(draft, job);
  const orderNumber = draft?.orderNumber ?? invoice?.orderNumber ?? externalInvoice?.matchedOrderNumber ?? externalInvoice?.orderNumber ?? "-";
  const shipmentPackageId =
    draft?.shipmentPackageId ?? invoice?.shipmentPackageId ?? externalInvoice?.matchedShipmentPackageId ?? externalInvoice?.shipmentPackageId ?? "-";
  const customerName = draft?.customerName ?? externalInvoice?.buyerName ?? "Alici bilinmiyor";
  const amountCents = draft?.totalPayableCents ?? externalInvoice?.totalPayableCents ?? 0;
  const currency = draft?.currency ?? externalInvoice?.currency ?? "TRY";
  const historical = isBeforeTodayOperation(draft, invoice, externalInvoice);
  const baseStages = buildStages(draft, invoice, externalInvoice, visibleJob);
  const stages = historical ? maskHistoricalStages(baseStages) : baseStages;
  const nextAction = historical
    ? historicalNextAction(draft, invoice, externalInvoice)
    : buildNextAction(draft, invoice, externalInvoice, visibleJob, stages);
  const queueKeys = historical ? (["all"] as InvoiceOperationQueueKey[]) : buildQueueKeys(draft, invoice, externalInvoice, visibleJob, stages);
  const priority = historical ? 8 : buildPriority(draft, invoice, externalInvoice, visibleJob, stages, queueKeys);
  const detailEvents = buildDetailEvents(draft, invoice, externalInvoice, visibleJob, stages);
  const statusTone = historical ? historicalTone(invoice, stages) : rowTone(priority, stages);
  const statusLabel = historical ? historicalStatusLabel(invoice, stages) : buildStatusLabel(draft, invoice, externalInvoice, visibleJob, stages);

  return {
    id: draft?.id ?? invoice?.id ?? externalInvoice?.id ?? `${orderNumber}-${shipmentPackageId}`,
    sourceKind,
    orderNumber,
    shipmentPackageId,
    customerName,
    amountCents,
    currency,
    priority,
    priorityLabel: priority <= 1 ? "1" : priority <= 3 ? "2" : priority <= 5 ? "3" : "OK",
    statusLabel,
    statusTone,
    draft,
    invoice,
    externalInvoice,
    job: visibleJob,
    stages,
    nextAction,
    detailEvents,
    queueKeys,
    sortTime: latestTime(draft?.deliveredAt, invoice?.invoiceDate, invoice?.deliveredAt, externalInvoice?.invoiceDate, externalInvoice?.updatedAt),
    searchText: normalizeSearch(
      [
        orderNumber,
        shipmentPackageId,
        customerName,
        draft?.id,
        draft?.status,
        draft?.portalDraftNumber,
        draft?.portalDraftUuid,
        invoice?.invoiceNumber,
        invoice?.status,
        invoice?.trendyolStatus,
        externalInvoice?.invoiceNumber,
        externalInvoice?.source,
        externalInvoice?.buyerIdentifier,
        externalInvoice?.matchReason,
        nextAction.label,
        statusLabel
      ]
        .filter(Boolean)
        .join(" ")
    )
  };
}

function buildStages(
  draft?: InvoiceDraftListItem,
  invoice?: InvoiceListItem,
  externalInvoice?: ExternalInvoiceListItem,
  job?: IntegrationJobListItem
): Record<InvoiceOperationStageKey, InvoiceOperationStage> {
  return {
    draft: buildDraftStage(draft, invoice, externalInvoice, job),
    gib: buildGibStage(draft, invoice, externalInvoice, job),
    pdf: buildPdfStage(draft, invoice, externalInvoice),
    marketplace: buildMarketplaceStage(invoice, externalInvoice)
  };
}

function maskHistoricalStages(
  stages: Record<InvoiceOperationStageKey, InvoiceOperationStage>
): Record<InvoiceOperationStageKey, InvoiceOperationStage> {
  return {
    draft:
      stages.draft.state === "done"
        ? stages.draft
        : stage("draft", "idle", "Bugunden onceki kayit; taslak islemi tekrar takip edilmiyor."),
    gib:
      stages.gib.state === "done"
        ? stages.gib
        : stage("gib", "idle", "Bugunden onceki kayit GIB takibine tekrar alinmiyor."),
    pdf:
      stages.pdf.state === "done"
        ? stages.pdf
        : stage("pdf", "idle", "Bugunden onceki kayit PDF eksigi icin tekrar kuyruga alinmiyor."),
    marketplace:
      stages.marketplace.state === "done"
        ? stages.marketplace
        : stage("marketplace", "idle", "Bugunden onceki kayit Trendyol icin tekrar islenmiyor.")
  };
}

function historicalNextAction(
  draft: InvoiceDraftListItem | undefined,
  invoice: InvoiceListItem | undefined,
  externalInvoice: ExternalInvoiceListItem | undefined
): InvoiceOperationNextAction {
  if (draft?.orderNumber || invoice?.orderNumber || externalInvoice?.matchedOrderNumber || externalInvoice?.orderNumber) {
    return action(
      "view-order",
      "Siparise git",
      "Bugunden onceki faturalar yeniden GIB/PDF/Trendyol takibine alinmaz; sadece kayit incelemesi yapilir.",
      "neutral"
    );
  }
  return action("none", "Eski kayit", "Bugunden onceki fatura hareketi tekrar islenmiyor.", "neutral");
}

function historicalStatusLabel(invoice: InvoiceListItem | undefined, stages: Record<InvoiceOperationStageKey, InvoiceOperationStage>) {
  if (invoice?.status === "TRENDYOL_SENT" || stages.marketplace.state === "done") return "Tamam";
  return "Eski kayit";
}

function historicalTone(invoice: InvoiceListItem | undefined, stages: Record<InvoiceOperationStageKey, InvoiceOperationStage>): InvoiceOperationTone {
  if (invoice?.status === "TRENDYOL_SENT" || stages.marketplace.state === "done") return "success";
  return "neutral";
}

function buildDraftStage(
  draft?: InvoiceDraftListItem,
  invoice?: InvoiceListItem,
  externalInvoice?: ExternalInvoiceListItem,
  job?: IntegrationJobListItem
): InvoiceOperationStage {
  if (job?.status === "FAILED" || draft?.status === "ERROR") return stage("draft", "failed", "Taslak tekrar deneme bekliyor.");
  if (draft) {
    if (draft.status === "NEEDS_REVIEW") return stage("draft", "waiting", "Taslak eksik bilgi kontrolu bekliyor.");
    if (draft.status === "READY") return stage("draft", "waiting", "Taslak hazir, onay bekliyor.");
    return stage("draft", "done", draft.status === "PORTAL_DRAFTED" ? "Taslak GIB portalina yuklendi." : "Taslak olustu.");
  }
  if (invoice || externalInvoice) return stage("draft", "done", "Kayit harici/resmi fatura uzerinden izleniyor.");
  return stage("draft", "idle", "Taslak kaydi yok.");
}

function buildGibStage(
  draft?: InvoiceDraftListItem,
  invoice?: InvoiceListItem,
  externalInvoice?: ExternalInvoiceListItem,
  job?: IntegrationJobListItem
): InvoiceOperationStage {
  if (job?.status === "FAILED") return stage("gib", "failed", job.lastError ?? "GIB akisi hata verdi.");
  if (invoice) return stage("gib", "done", invoice.invoiceNumber ? `${invoice.invoiceNumber} resmi fatura.` : "Resmi fatura olustu.");
  if (externalInvoice?.invoiceNumber) return stage("gib", "done", `${externalInvoice.invoiceNumber} harici e-Arsiv kaydi bulundu.`);
  if (draft?.status === "PORTAL_DRAFTED") return stage("gib", "waiting", "Portalda manuel imza bekliyor.");
  if (draft?.status === "APPROVED") return stage("gib", "waiting", "GIB portalina yukleme bekliyor.");
  if (draft?.status === "ISSUING") return stage("gib", "waiting", "Fatura islemi kuyrukta/isleniyor.");
  if (draft?.status === "READY") return stage("gib", "idle", "Onay sonrasi GIB adimi baslayacak.");
  if (draft?.status === "NEEDS_REVIEW") return stage("gib", "idle", "Taslak hazir olunca GIB adimi acilir.");
  return stage("gib", "idle", "GIB kaydi yok.");
}

function buildPdfStage(
  draft?: InvoiceDraftListItem,
  invoice?: InvoiceListItem,
  externalInvoice?: ExternalInvoiceListItem
): InvoiceOperationStage {
  if (invoice?.pdfAvailable) return stage("pdf", "done", "Resmi PDF arsivde.");
  if (invoice && !invoice.pdfAvailable) return stage("pdf", "missing", "Resmi fatura var ama PDF baglantisi yok.");
  if (externalInvoice?.requiresPdfUpload) return stage("pdf", "missing", "Portal imzali fatura icin resmi PDF yuklenmeli.");
  if (externalInvoice?.pdfUrl) return stage("pdf", "done", "Harici PDF kaynagi bulundu.");
  if (externalInvoice?.invoiceNumber) return stage("pdf", "missing", "Fatura bulundu, PDF arsiv baglantisi eksik.");
  if (draft?.status === "PORTAL_DRAFTED") return stage("pdf", "missing", "Imza ve resmi PDF bekleniyor.");
  if (draft) return stage("pdf", "idle", "Fatura kesilince PDF durumu gorunecek.");
  return stage("pdf", "idle", "PDF kaydi yok.");
}

function buildMarketplaceStage(invoice?: InvoiceListItem, externalInvoice?: ExternalInvoiceListItem): InvoiceOperationStage {
  if (invoice?.status === "TRENDYOL_SEND_FAILED") return stage("marketplace", "failed", invoice.error ?? "Trendyol gonderimi basarisiz.");
  if (invoice?.status === "TRENDYOL_SENT" || invoice?.trendyolStatus === "SENT" || invoice?.trendyolStatus === "ALREADY_SENT") {
    return stage("marketplace", "done", "Trendyol'a gonderildi.");
  }
  if (invoice?.pdfAvailable) return stage("marketplace", "waiting", "PDF hazir, Trendyol gonderimi bekliyor.");
  if (externalInvoice?.promotedInvoiceStatus === "TRENDYOL_SENT") return stage("marketplace", "done", "Harici fatura Trendyol'a gonderildi.");
  if (externalInvoice?.promotedInvoiceId && !externalInvoice.requiresPdfUpload) {
    return stage("marketplace", "waiting", "Arsiv kaydi hazir, pazaryeri gonderimi bekliyor.");
  }
  return stage("marketplace", "idle", "PDF hazir olunca pazaryeri adimi acilir.");
}

function buildNextAction(
  draft: InvoiceDraftListItem | undefined,
  invoice: InvoiceListItem | undefined,
  externalInvoice: ExternalInvoiceListItem | undefined,
  job: IntegrationJobListItem | undefined,
  stages: Record<InvoiceOperationStageKey, InvoiceOperationStage>
): InvoiceOperationNextAction {
  if (job?.status === "FAILED" || draft?.status === "ERROR") {
    return action("retry", "Tekrar dene", "Hata giderildiyse taslagi yeniden kuyruga al.", "danger");
  }
  if (invoice?.status === "TRENDYOL_SEND_FAILED") {
    return action("send-trendyol", "Trendyol'a tekrar gonder", "PDF hazirsa pazaryeri aktarimini yeniden dene.", "danger");
  }
  if (externalInvoice?.matchedOrderId && !externalInvoice.promotedInvoiceId) {
    return action("promote-external", "Arsive al", "Eslestirilen e-Arsiv kaydini SAFA arsivine al.", "warning");
  }
  if (stages.pdf.state === "missing" && externalInvoice?.id) {
    return action(
      "upload-pdf",
      "Resmi PDF yukle",
      "Fatura GIB'de bulundu; resmi PDF yuklenince arsiv ve Trendyol adimi acilir.",
      "danger"
    );
  }
  if (stages.pdf.state === "missing" && invoice) {
    return action(
      "preview-signed",
      "PDF'i tekrar kontrol et",
      "Fatura bulundu; SAFA resmi PDF'i GIB'den tekrar sorgulamali veya manuel PDF yuklenmeli.",
      "danger"
    );
  }
  if (stages.pdf.state === "missing" && draft?.status === "PORTAL_DRAFTED") {
    return action("preview-signed", "Imzalilari sorgula", "Portal imzasini ve resmi PDF durumunu GIB'den sorgula.", "warning");
  }
  if (invoice?.pdfAvailable && stages.marketplace.state === "waiting") {
    return action("send-trendyol", "Trendyol'a gonder", "Hazir PDF dosyasini pazaryerine aktar.", "warning");
  }
  if (draft?.status === "APPROVED") {
    return action("portal", "GIB taslagina yukle", "Onayli taslagi GIB portal imzasina tasir.", "warning");
  }
  if (draft?.status === "READY") {
    return action("approve", "Taslagi onayla", "Portal yukleme veya fatura islemi icin once onay gerekir.", "success");
  }
  if (draft?.status === "PORTAL_DRAFTED") {
    return action("open-portal", "Portalda ac", "Imzayi portalda tamamlayip sonra imzalilari sorgula.", "warning");
  }
  if (draft?.orderNumber || invoice?.orderNumber || externalInvoice?.matchedOrderNumber || externalInvoice?.orderNumber) {
    return action("view-order", "Siparise git", "Kaydin siparis detayini ac.", "neutral");
  }
  return action("none", "Aksiyon yok", "Bu kayit icin yapilacak is yok.", "neutral");
}

function buildQueueKeys(
  draft: InvoiceDraftListItem | undefined,
  invoice: InvoiceListItem | undefined,
  externalInvoice: ExternalInvoiceListItem | undefined,
  job: IntegrationJobListItem | undefined,
  stages: Record<InvoiceOperationStageKey, InvoiceOperationStage>
) {
  const keys: InvoiceOperationQueueKey[] = ["all"];
  if (job?.status === "FAILED" || draft?.status === "ERROR" || invoice?.status === "TRENDYOL_SEND_FAILED") keys.push("action");
  if (stages.pdf.state === "missing") keys.push("pdf-missing", "action");
  if (draft?.status === "PORTAL_DRAFTED" && !externalInvoice?.promotedInvoiceId) keys.push("portal-signature", "action");
  if (externalInvoice?.matchedOrderId && !externalInvoice.promotedInvoiceId) keys.push("external-found", "action");
  if (stages.marketplace.state === "waiting" || stages.marketplace.state === "failed") keys.push("marketplace", "action");
  if (draft?.status === "READY" || draft?.status === "APPROVED") keys.push("action");
  return Array.from(new Set(keys));
}

function buildPriority(
  draft: InvoiceDraftListItem | undefined,
  invoice: InvoiceListItem | undefined,
  externalInvoice: ExternalInvoiceListItem | undefined,
  job: IntegrationJobListItem | undefined,
  stages: Record<InvoiceOperationStageKey, InvoiceOperationStage>,
  queueKeys: InvoiceOperationQueueKey[]
) {
  if (job?.status === "FAILED" || draft?.status === "ERROR" || invoice?.status === "TRENDYOL_SEND_FAILED") return 0;
  if (stages.pdf.state === "missing") return 1;
  if (draft?.status === "PORTAL_DRAFTED") return 2;
  if (externalInvoice?.matchedOrderId && !externalInvoice.promotedInvoiceId) return 3;
  if (queueKeys.includes("marketplace")) return 4;
  if (draft?.status === "READY" || draft?.status === "APPROVED") return 5;
  return 8;
}

function buildDetailEvents(
  draft: InvoiceDraftListItem | undefined,
  invoice: InvoiceListItem | undefined,
  externalInvoice: ExternalInvoiceListItem | undefined,
  job: IntegrationJobListItem | undefined,
  stages: Record<InvoiceOperationStageKey, InvoiceOperationStage>
): InvoiceOperationDetailEvent[] {
  return (["draft", "gib", "pdf", "marketplace"] as InvoiceOperationStageKey[]).map((key) => ({
    key,
    title: stageLabels[key],
    detail: stages[key].detail,
    tone: toneForStage(stages[key].state),
    at:
      key === "draft"
        ? draft?.approvedAt ?? draft?.portalDraftUploadedAt
        : key === "gib"
          ? invoice?.invoiceDate ?? externalInvoice?.invoiceDate
          : key === "pdf"
            ? invoice?.invoiceDate ?? externalInvoice?.updatedAt
            : invoice?.status === "TRENDYOL_SENT"
              ? invoice.invoiceDate
              : job?.updatedAt
  }));
}

function buildStatusLabel(
  draft: InvoiceDraftListItem | undefined,
  invoice: InvoiceListItem | undefined,
  externalInvoice: ExternalInvoiceListItem | undefined,
  job: IntegrationJobListItem | undefined,
  stages: Record<InvoiceOperationStageKey, InvoiceOperationStage>
) {
  if (job?.status === "FAILED" || draft?.status === "ERROR") return "Hata / tekrar dene";
  if (invoice?.status === "TRENDYOL_SEND_FAILED") return "Pazaryeri hatasi";
  if (draft?.status === "PORTAL_DRAFTED") return "Portal imza bekliyor";
  if (externalInvoice?.matchedOrderId && !externalInvoice.promotedInvoiceId) return "Harici bulundu";
  if (stages.pdf.state === "missing") return "PDF eksik";
  if (stages.marketplace.state === "waiting") return "Pazaryeri bekliyor";
  if (invoice?.status === "TRENDYOL_SENT" || stages.marketplace.state === "done") return "Tamam";
  if (draft?.status === "READY") return "Onay bekliyor";
  if (draft?.status === "APPROVED") return "GIB'e hazir";
  return "Izleniyor";
}

function rowTone(priority: number, stages: Record<InvoiceOperationStageKey, InvoiceOperationStage>): InvoiceOperationTone {
  if (priority <= 1 || stages.marketplace.state === "failed" || stages.draft.state === "failed") return "danger";
  if (priority <= 5) return "warning";
  if (stages.marketplace.state === "done" || stages.pdf.state === "done") return "success";
  return "neutral";
}

function toneForStage(state: InvoiceOperationStageState): InvoiceOperationTone {
  if (state === "done") return "success";
  if (state === "failed" || state === "missing") return "danger";
  if (state === "waiting") return "warning";
  return "neutral";
}

function action(
  kind: InvoiceOperationActionKind,
  label: string,
  detail: string,
  tone: InvoiceOperationTone
): InvoiceOperationNextAction {
  return { kind, label, detail, tone };
}

function stage(key: InvoiceOperationStageKey, state: InvoiceOperationStageState, detail: string): InvoiceOperationStage {
  return { key, label: stageLabels[key], state, detail };
}

function latestInvoiceJob(jobs: IntegrationJobListItem[], draftId: string) {
  return jobs.find((job) => job.type === "invoice.issue" && job.target === draftId);
}

function visibleInvoiceJob(draft?: InvoiceDraftListItem, job?: IntegrationJobListItem) {
  if (!draft || !job) return undefined;
  if (draft.status === "PORTAL_DRAFTED" || draft.status === "ISSUED" || draft.externalInvoiceCount > 0) return undefined;
  if (job.status === "FAILED" && draft.status === "APPROVED" && draft.approvedAt) {
    const message = (job.lastError ?? "").toLocaleLowerCase("tr-TR");
    const staleApprovalFailure = message.includes("onaylanmali") || message.includes("onaylanmalı");
    if (staleApprovalFailure && new Date(job.updatedAt).getTime() <= new Date(draft.approvedAt).getTime()) return undefined;
  }
  return job;
}

function findExternalForDraft(draft: InvoiceDraftListItem, byOrderKey: Map<string, ExternalInvoiceListItem>) {
  for (const key of [orderKey(draft.orderNumber), packageKey(draft.shipmentPackageId)]) {
    const externalInvoice = byOrderKey.get(key);
    if (externalInvoice) return externalInvoice;
  }
  return undefined;
}

function externalOrderKeys(invoice: ExternalInvoiceListItem) {
  return [
    orderKey(invoice.matchedOrderNumber),
    orderKey(invoice.orderNumber),
    packageKey(invoice.matchedShipmentPackageId),
    packageKey(invoice.shipmentPackageId)
  ].filter(Boolean);
}

function orderKey(value?: string) {
  return value ? `order:${value}` : "";
}

function packageKey(value?: string) {
  return value ? `package:${value}` : "";
}

function latestTime(...values: Array<string | undefined>) {
  return values.reduce((latest, value) => {
    if (!value) return latest;
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? Math.max(latest, time) : latest;
  }, 0);
}

function isBeforeTodayOperation(
  draft?: InvoiceDraftListItem,
  invoice?: InvoiceListItem,
  externalInvoice?: ExternalInvoiceListItem
) {
  const date =
    invoice?.invoiceDate ??
    invoice?.deliveredAt ??
    draft?.deliveredAt ??
    draft?.externalInvoiceDate ??
    externalInvoice?.invoiceDate ??
    externalInvoice?.updatedAt ??
    externalInvoice?.createdAt;
  const dateKey = date ? dateKeyInOperationTimeZone(date) : undefined;
  const todayKey = dateKeyInOperationTimeZone(new Date());
  return Boolean(dateKey && todayKey && dateKey < todayKey);
}

function dateKeyInOperationTimeZone(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: operationTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function normalizeSearch(value: string) {
  return value.toLocaleLowerCase("tr-TR").trim();
}

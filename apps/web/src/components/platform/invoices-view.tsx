"use client";

import type {
  ExternalInvoiceListItem,
  ExternalInvoiceSource,
  ExternalInvoiceSyncResult,
  GibPortalTimelineEvent,
  IntegrationJobListItem,
  InvoiceDraftListItem,
  InvoiceListItem,
  InvoiceStatus,
  MonthlyInvoiceArchiveResult
} from "@safa/shared";
import {
  AlertTriangle,
  Archive,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  FileSearch,
  FileText,
  Link2,
  ListFilter,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldOff,
  UploadCloud,
  X
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "../../lib/api";
import { cx, dateMatches, formatDateTime, money, numberValue, startOfToday, statusLabel, statusTone, stringValue } from "../../lib/platform/format";
import { isInRecentGibPortalSyncWindow, recentGibPortalSyncRequest } from "./gib-portal-sync-window";
import {
  buildInvoiceOperationMetrics,
  buildInvoiceOperationRows,
  filterInvoiceOperationRows,
  type InvoiceOperationQueueKey,
  type InvoiceOperationRow,
  type InvoiceOperationStage
} from "./invoice-operation-model";
import { InvoiceProcessBar, latestInvoiceJob, visibleInvoiceJob } from "./invoice-process";

type DraftDeskFilter = "actionable" | "all" | "ready" | "approved" | "failed" | "issuing" | "portal" | "external" | "issued";
type DraftExternalFilter = "all" | "no-external" | "external" | ExternalInvoiceSource;
type DraftSortField = "delivered-desc" | "delivered-asc" | "process" | "order" | "customer" | "status" | "amount-desc" | "amount-asc";
type DateFilter = "all" | "today" | "last7" | "last30";
type ArchiveStatusFilter = "all" | InvoiceStatus;
type ExternalMatchFilter = "all" | "matched" | "unmatched";
type ExternalListSourceFilter = "all" | ExternalInvoiceSource;
type DraftActionKind = "approve" | "portal" | "issue" | "retry";
type NoticeTone = "success" | "warning" | "danger" | "neutral";

interface DeskNotice {
  action: DraftActionKind;
  title: string;
  detail: string;
  draftIds: string[];
  pending: boolean;
  tone: NoticeTone;
  nextAction: string;
}

interface DraftActionTrace {
  action: DraftActionKind;
  title: string;
  detail: string;
  tone: NoticeTone;
  at: string;
  nextAction: string;
  contextLabel?: string;
  history?: boolean;
}

interface RealStatusCheck {
  tone: NoticeTone;
  actual: string;
  safa: string;
  gib: string;
  nextAction: string;
  source: string;
}

interface InvoicesViewProps {
  drafts: InvoiceDraftListItem[];
  invoices: InvoiceListItem[];
  externalInvoices: ExternalInvoiceListItem[];
  jobs: IntegrationJobListItem[];
  settings: Record<string, unknown>;
  busyAction: string | null;
  onApprove: (ids: string[]) => Promise<string>;
  onIssue: (ids: string[]) => Promise<string>;
  onUploadPortalDrafts: (ids: string[]) => Promise<string>;
  onImportExternalInvoices: (source: ExternalInvoiceSource, records: Array<Record<string, unknown>>) => void;
  onPreviewGibExternalInvoices: (
    input: number | { days?: number; startDate?: string; endDate?: string; repairMissingDrafts?: boolean; repairOrderNumber?: string }
  ) => Promise<ExternalInvoiceSyncResult | null>;
  onApplyGibExternalInvoices: (
    input: number | { days?: number; startDate?: string; endDate?: string; repairMissingDrafts?: boolean; repairOrderNumber?: string }
  ) => Promise<ExternalInvoiceSyncResult | null>;
  onSyncTrendyolExternalInvoices: () => void;
  onReconcileExternalInvoices: () => void;
  onMatchExternalInvoice: (id: string, target: string) => void;
  onPromoteExternalInvoice: (id: string, sendToTrendyol: boolean) => void;
  onUploadExternalInvoicePdf: (id: string, file: File) => void;
  onSendInvoiceToTrendyol: (id: string) => void;
  onCreateMonthlyArchive: (year: number, month: number) => Promise<MonthlyInvoiceArchiveResult | null>;
  onRefresh: () => void;
  onOpenGibPortal: () => void;
  onCloseGibPortalSession: () => void;
}

function initialInvoiceDeskQuery() {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("draft") ?? params.get("order") ?? params.get("package") ?? "";
}

function dateTimeValue(value?: string) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function draftDeliveryTime(draft: InvoiceDraftListItem) {
  return dateTimeValue(draft.deliveredAt);
}

function invoiceDeliveryTime(invoice: InvoiceListItem) {
  return dateTimeValue(invoice.deliveredAt ?? invoice.invoiceDate);
}

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function parseMonthValue(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

function triggerDownload(url: string) {
  if (typeof document === "undefined") return;
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function orderDeskHref(orderNumber: string) {
  return `/orders?order=${encodeURIComponent(orderNumber)}`;
}

function isSelectableDraft(draft: InvoiceDraftListItem) {
  return (
    (draft.status === "READY" || draft.status === "APPROVED" || (draft.status === "ERROR" && draft.errors.length === 0)) &&
    draft.externalInvoiceCount === 0
  );
}

function matchesDraftDeskFilter(
  draft: InvoiceDraftListItem,
  filter: DraftDeskFilter,
  job?: IntegrationJobListItem,
  invoice?: InvoiceListItem
) {
  const effectiveJob = visibleInvoiceJob(draft, job);

  if (filter === "all") return true;
  if (filter === "actionable") return isSelectableDraft(draft);
  if (filter === "ready") return draft.status === "READY";
  if (filter === "approved") return draft.status === "APPROVED";
  if (filter === "failed") return draft.status === "ERROR" || effectiveJob?.status === "FAILED";
  if (filter === "issuing") return draft.status === "ISSUING" || effectiveJob?.status === "PENDING" || effectiveJob?.status === "PROCESSING";
  if (filter === "portal") return draft.status === "PORTAL_DRAFTED";
  if (filter === "external") return draft.externalInvoiceCount > 0;
  if (filter === "issued") return draft.status === "ISSUED" || Boolean(invoice);
  return true;
}

function matchesDraftExternalFilter(draft: InvoiceDraftListItem, filter: DraftExternalFilter) {
  if (filter === "all") return true;
  if (filter === "no-external") return draft.externalInvoiceCount === 0;
  if (filter === "external") return draft.externalInvoiceCount > 0;
  return draft.externalInvoiceSources.includes(filter);
}

function draftProcessPriority(draft: InvoiceDraftListItem, job?: IntegrationJobListItem, invoice?: InvoiceListItem) {
  const effectiveJob = visibleInvoiceJob(draft, job);

  if (effectiveJob?.status === "FAILED" || draft.status === "ERROR") return 0;
  if (effectiveJob?.status === "PROCESSING" || draft.status === "ISSUING") return 1;
  if (effectiveJob?.status === "PENDING") return 2;
  if (draft.status === "READY") return 3;
  if (draft.status === "APPROVED") return 4;
  if (draft.status === "PORTAL_DRAFTED") return 5;
  if (draft.externalInvoiceCount > 0) return 6;
  if (invoice || draft.status === "ISSUED") return 7;
  return 8;
}

function draftStatusView(draft: InvoiceDraftListItem) {
  if (draft.externalInvoiceCount > 0) {
    const source = draft.externalInvoiceSources[0] ? sourceLabel(draft.externalInvoiceSources[0]) : "Harici";
    return {
      label: draft.externalInvoiceNumber ? `${source}: ${draft.externalInvoiceNumber}` : `${source} faturasi var`,
      tone: statusTone("ISSUED")
    };
  }

  return {
    label: statusLabel(draft.status),
    tone: statusTone(draft.status)
  };
}

function actionCopy(action: DraftActionKind, count: number) {
  const suffix = `${count} taslak`;

  if (action === "approve") {
    return {
      startedTitle: "Onay islemi basladi",
      startedDetail: `${suffix} onay icin gonderildi. Kart durumlari guncellenince burada sonuc gorunecek.`,
      cardTitle: "Onay bekleniyor",
      cardDetail: "SAFA bu taslagi onay durumuna aliyor.",
      resultTitle: "Onay sonucu"
    };
  }

  if (action === "portal") {
    return {
      startedTitle: "GIB taslak yukleme basladi",
      startedDetail: `${suffix} GIB portal taslagi olarak yukleniyor. Imza resmi portalda toplu atilacak.`,
      cardTitle: "Portal yukleme suruyor",
      cardDetail: "Taslak GIB portalina imza bekleyen belge olarak tasiniyor.",
      resultTitle: "Portal yukleme sonucu"
    };
  }

  if (action === "retry") {
    return {
      startedTitle: "Tekrar deneme basladi",
      startedDetail: `${suffix} icin fatura isi tekrar kuyruga aliniyor.`,
      cardTitle: "Tekrar deneniyor",
      cardDetail: "Onceki hata sonrasi fatura islemi tekrar baslatildi.",
      resultTitle: "Tekrar deneme sonucu"
    };
  }

  return {
    startedTitle: "Fatura kesimi basladi",
    startedDetail: `${suffix} once onaylanacak, sonra fatura kuyruguna alinacak. Sonucu kart surec cubugunda izleyin.`,
    cardTitle: "Fatura islemi basladi",
    cardDetail: "Taslak onay ve fatura kesim asamalarindan geciyor.",
    resultTitle: "Fatura kesim sonucu"
  };
}

function toneFromMessage(message: string): NoticeTone {
  const normalized = stringValue(message);
  if (
    normalized.includes("basarisiz") ||
    normalized.includes("başarısız") ||
    normalized.includes("hata") ||
    normalized.includes("yuklenemedi") ||
    normalized.includes("yüklenemedi") ||
    normalized.includes("alinamadi") ||
    normalized.includes("alınamadı") ||
    normalized.includes("engellendi")
  ) {
    return "danger";
  }
  if (normalized.includes("kontrol") || normalized.includes("bekleniyor") || normalized.includes("baslatildi")) return "warning";
  return "success";
}

function busyKeyForAction(action: DraftActionKind) {
  if (action === "approve") return "approve";
  if (action === "portal") return "portal-draft-upload";
  return "issue";
}

function actionSteps(action: DraftActionKind, pending: boolean, tone: NoticeTone) {
  const failedStep = action === "portal" ? "Yuklenemedi" : action === "approve" ? "Onaylanamadi" : "Hata";
  const resultStep = tone === "danger" ? failedStep : pending ? "Bekle" : "Sonuc";

  if (action === "approve") {
    return ["Secildi", "Onay istegi", pending ? "Onay bekliyor" : resultStep, tone === "danger" ? "Kontrol et" : "Hazir"];
  }

  if (action === "portal") {
    return ["Secildi", "Taslak yukle", pending ? "Portal isliyor" : resultStep, tone === "success" ? "Imza portalda" : "Tekrar dene"];
  }

  if (action === "retry") {
    return ["Secildi", "Tekrar dene", pending ? "Kuyruk" : resultStep, "Sonuc"];
  }

  return ["Secildi", "Onay", pending ? "Kuyruk" : resultStep, "Sonuc"];
}

function actionStateLabel(tone: NoticeTone, pending: boolean) {
  if (pending) return "ISLENIYOR";
  if (tone === "danger") return "BASARISIZ";
  if (tone === "warning") return "KONTROL GEREKLI";
  if (tone === "success") return "BASARILI";
  return "BILGI";
}

function nextActionFor(action: DraftActionKind, tone: NoticeTone, pending: boolean) {
  if (pending) {
    if (action === "portal") return "Bekleyin. SAFA taslagi GIB portalina yuklemeyi deniyor.";
    if (action === "approve") return "Bekleyin. Taslak onay durumuna aliniyor.";
    return "Bekleyin. Islem kuyruga aliniyor veya sonuc bekleniyor.";
  }

  if (tone === "danger") {
    if (action === "portal") return "Bu fatura henuz GIB portalda imza beklemiyor. Karttaki hata sebebini okuyun, sorunu giderin ve tekrar GIB taslagina yukleyin.";
    if (action === "approve") return "Taslak onaylanmadi. Karttaki hata sebebini kontrol edin, sonra yeniden onaylayin.";
    return "Fatura kesimi baslamadi veya tamamlanmadi. Karttaki hata sebebini kontrol edip Tekrar dene butonunu kullanin.";
  }

  if (tone === "warning") return "Kismi veya kontrol gerektiren sonuc var. Basarisiz kartlari filtreleyip tek tek tekrar deneyin.";
  if (action === "portal") return "Taslak GIB portalina gitti. Resmi fatura sayilmasi icin GIB portalinda Duzenlenen Belgeler ekranindan imzalayin.";
  if (action === "approve") return "Taslak onaylandi ve Onayli filtresine tasindi. Normal akis icin GIB taslagina yukleyin; imza ve Trendyol aktarimi portal takip akisiyle izlenir.";
  return "Islem baslatildi. Son resmi sonucu karttaki surec cubugundan ve PDF arsivinden takip edin.";
}

function isDraftStillProcessable(draft: InvoiceDraftListItem, invoice?: InvoiceListItem) {
  return (
    !invoice &&
    draft.externalInvoiceCount === 0 &&
    !draft.portalDraftUuid &&
    draft.status !== "PORTAL_DRAFTED" &&
    (draft.status === "READY" || draft.status === "APPROVED")
  );
}

function processableStatusSummary(drafts: InvoiceDraftListItem[]) {
  const readyCount = drafts.filter((draft) => draft.status === "READY").length;
  const approvedCount = drafts.filter((draft) => draft.status === "APPROVED").length;
  const parts = [
    readyCount > 0 ? `${readyCount} hazir` : undefined,
    approvedCount > 0 ? `${approvedCount} onayli` : undefined
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : `${drafts.length} islenebilir`;
}

function resolveVisibleDeskNotice(
  notice: DeskNotice,
  draftById: Map<string, InvoiceDraftListItem>,
  invoiceByDraftId: Map<string, InvoiceListItem>
): DeskNotice {
  if (notice.pending || notice.tone !== "danger") return notice;

  const processableDrafts = notice.draftIds
    .map((id) => draftById.get(id))
    .filter((draft): draft is InvoiceDraftListItem => Boolean(draft))
    .filter((draft) => isDraftStillProcessable(draft, invoiceByDraftId.get(draft.id)));

  if (processableDrafts.length === 0) return notice;

  if (notice.action === "portal") {
    return {
      ...notice,
      tone: "warning",
      title: "Portal yuklenemedi, taslak kaybolmadi",
      detail: `${processableDrafts.length} taslak GIB portalda imza beklemiyor; SAFA'da ${processableStatusSummary(processableDrafts)} olarak duruyor. Son hata: ${notice.detail}`,
      nextAction:
        "Sorun giderildiyse GIB taslagina yukle ile tekrar deneyin. Portalda imza bekleyen belge ancak yukleme basarili olunca olusur."
    };
  }

  return {
    ...notice,
    tone: "warning",
    title: "Son deneme basarisiz, taslak hala islenebilir",
    detail: `${processableDrafts.length} taslak SAFA'da ${processableStatusSummary(processableDrafts)} olarak duruyor. Son hata: ${notice.detail}`,
    nextAction: "Karttaki gercek duruma gore devam edin; hazirsa onaylayin, onayliysa GIB taslagina yukleyin."
  };
}

function resolveVisibleDraftActionTrace(
  draft: InvoiceDraftListItem,
  trace: DraftActionTrace | undefined,
  realStatusCheck: RealStatusCheck,
  invoice?: InvoiceListItem
): DraftActionTrace | undefined {
  if (!trace) return undefined;
  if (trace.tone !== "danger" || realStatusCheck.tone === "danger") return trace;

  if (!isDraftStillProcessable(draft, invoice)) {
    return {
      ...trace,
      tone: "neutral",
      title: "Eski deneme kaydi",
      detail: trace.detail,
      nextAction: `Guncel durum: ${realStatusCheck.actual}. ${realStatusCheck.nextAction}`,
      contextLabel: "Islem gecmisi",
      history: true
    };
  }

  const actionName =
    trace.action === "portal" ? "Portal yukleme" : trace.action === "approve" ? "Onay" : trace.action === "retry" ? "Tekrar deneme" : "Fatura kesim";

  return {
    ...trace,
    tone: "warning",
    title: `${actionName} son denemesi basarisiz`,
    detail: `${trace.detail} SAFA gercek durum kontrolu bu karti "${realStatusCheck.actual}" olarak goruyor.`,
    nextAction:
      trace.action === "portal"
        ? "Bu kart henuz portalda imza beklemiyor; taslak SAFA'da duruyor. Sorun giderildiyse GIB taslagina yukle ile tekrar deneyin."
        : realStatusCheck.nextAction,
    contextLabel: "Son deneme kaydi",
    history: true
  };
}

function noticeIcon(tone: NoticeTone, pending: boolean) {
  if (pending) return <Loader2 size={20} className="spin" />;
  if (tone === "danger") return <AlertTriangle size={20} />;
  if (tone === "warning") return <Clock3 size={20} />;
  if (tone === "success") return <CheckCircle2 size={20} />;
  return <Bell size={20} />;
}

function portalDraftSummary(draft: InvoiceDraftListItem) {
  const parts = [
    draft.portalDraftNumber ? `No: ${draft.portalDraftNumber}` : undefined,
    draft.portalDraftUuid ? `UUID: ${draft.portalDraftUuid}` : undefined,
    draft.portalDraftStatus ? `Durum: ${draft.portalDraftStatus}` : undefined,
    draft.portalDraftUploadedAt ? `Yukleme: ${formatDateTime(draft.portalDraftUploadedAt)}` : undefined
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : "Portal taslak kaydi var.";
}

function externalInvoiceSummary(draft: InvoiceDraftListItem) {
  const sources = draft.externalInvoiceSources.length > 0 ? draft.externalInvoiceSources.map(sourceLabel).join(", ") : "Harici kaynak";
  const parts = [
    `${sources} kaydi bulundu`,
    draft.externalInvoiceNumber ? `No: ${draft.externalInvoiceNumber}` : undefined,
    draft.externalInvoiceDate ? `Tarih: ${formatDateTime(draft.externalInvoiceDate)}` : undefined
  ].filter(Boolean);

  return `${parts.join(" · ")}.`;
}

function resolveRealStatusCheck(
  draft: InvoiceDraftListItem,
  invoice?: InvoiceListItem,
  job?: IntegrationJobListItem
): RealStatusCheck {
  if (invoice || draft.status === "ISSUED") {
    return {
      tone: "success",
      actual: "SAFA'da kesildi",
      safa: invoice?.invoiceNumber
        ? `SAFA fatura kaydi var: ${invoice.invoiceNumber} (${statusLabel(invoice.status)}).`
        : "SAFA resmi fatura kaydi olustu.",
      gib: "PDF arsivinde resmi fatura kaydi var. Harici e-Arsiv eslesmesi gerekiyorsa Imzalananlari kontrol et ile kontrol edilir.",
      nextAction: "PDF arsivinden belgeyi acin; Trendyol bildirimi gerekiyorsa arsiv durumunu takip edin.",
      source: "Kontrol: SAFA fatura arsivi + taslak durumu."
    };
  }

  if (draft.externalInvoiceCount > 0) {
    const hasPortalDraft = draft.status === "PORTAL_DRAFTED";
    const hasGibExternal = draft.externalInvoiceSources.includes("GIB_PORTAL");
    return {
      tone: hasGibExternal ? "success" : "warning",
      actual: hasGibExternal ? "Imzali e-Arsiv bulundu" : "Harici fatura bulundu",
      safa: hasPortalDraft && hasGibExternal
        ? "GIB portalinda imzali kayit bulundu; SAFA bu siparisi tekrar fatura kesimine kapatti ve arsiv eslesmesini takip ediyor."
        : hasPortalDraft
        ? "Harici fatura bulundu. SAFA bu siparisi tekrar fatura kesimine kapatti; portaldaki taslak tekrar imzalanmamali."
        : "SAFA bu siparisi tekrar fatura kesimine kapatti; cift fatura riski engellendi.",
      gib: externalInvoiceSummary(draft),
      nextAction: hasPortalDraft && hasGibExternal
        ? "Imzalananlari kontrol et tamamlandiginda kayit PDF arsivi ve aylik Excel'de resmi fatura olarak gorunmeli."
        : hasPortalDraft
        ? "GIB portalinda bu taslagi tekrar imzalamayin. Harici fatura eslesmesini kontrol edin."
        : "Bu sipariste yeniden fatura kesmeyin. Gerekirse harici fatura listesinden eslesmeyi kontrol edin.",
      source: "Kontrol: SAFA harici fatura eslesmesi."
    };
  }

  if (draft.status === "PORTAL_DRAFTED") {
    return {
      tone: "warning",
      actual: "Portal imza bekliyor",
      safa: "SAFA resmi fatura kesildi saymiyor; taslak GIB portalina imza bekleyen belge olarak tasindi.",
      gib: portalDraftSummary(draft),
      nextAction: "GIB portalinda Duzenlenen Belgeler ekranindan toplu imza atin, sonra Imzalananlari kontrol et ile belgeyi eslestirin.",
      source: "Kontrol: SAFA portal taslak kaydi."
    };
  }

  if (job?.status === "FAILED" || draft.status === "ERROR") {
    return {
      tone: "danger",
      actual: "Basarisiz / tekrar dene",
      safa: job?.lastError ?? draft.errors[0] ?? "SAFA son denemede hata kaydetti.",
      gib: "Bu kart icin SAFA'da tamamlanmis portal taslagi veya resmi fatura kaydi yok.",
      nextAction: "Hata sebebini duzeltin; sonra bu karttaki Tekrar dene veya ana islem butonunu kullanin.",
      source: "Kontrol: SAFA son kuyruk sonucu + taslak hata durumu."
    };
  }

  if (job?.status === "PROCESSING" || draft.status === "ISSUING") {
    return {
      tone: "warning",
      actual: "Islem suruyor",
      safa: "Fatura isi su anda SAFA kuyrugunda isleniyor.",
      gib: "Son GIB/e-Arsiv sonucu henuz SAFA'ya donmedi.",
      nextAction: "Bekleyin veya Yenile'ye basin; tamamlaninca karttaki durum otomatik netlesir.",
      source: "Kontrol: SAFA is kuyrugu."
    };
  }

  if (job?.status === "PENDING") {
    return {
      tone: "warning",
      actual: "Kuyrukta bekliyor",
      safa: "Fatura isi SAFA kuyruguna alindi, isleyici baslamadi.",
      gib: "GIB/e-Arsiv tarafina tamamlanmis sonuc yazilmadi.",
      nextAction: "Kuyrugun islenmesini bekleyin; uzun surerse Tekrar dene yerine once Yenile ile durumu kontrol edin.",
      source: "Kontrol: SAFA is kuyrugu."
    };
  }

  if (job?.status === "SUCCESS") {
    return {
      tone: "warning",
      actual: "Kuyruk basarili, arsiv bekleniyor",
      safa: "Son kuyruk isi basarili gorunuyor; ancak bu kart icin PDF arsivinde fatura kaydi henuz gorunmuyor.",
      gib: "GIB/e-Arsiv kaydi SAFA listesinden dogrulanmadi.",
      nextAction: "Yenile'ye basin; kayit gelmezse Imzalananlari kontrol et ile harici kaydi eslestirin.",
      source: "Kontrol: SAFA son kuyruk sonucu."
    };
  }

  if (draft.status === "APPROVED") {
    const lastPortalUploadFailed = draft.portalDraftStatus === "YUKLEME_HATASI";

    return {
      tone: "success",
      actual: "Onayli / kesime hazir",
      safa: draft.approvedAt
        ? `Taslak onayli. Onay zamani: ${formatDateTime(draft.approvedAt)}.`
        : "Taslak onayli; tekrar onay gerekmez.",
      gib: lastPortalUploadFailed
        ? "Son GIB portal yukleme denemesi basarisiz oldu; portalda imza bekleyen belge olusmadi."
        : "Bu kart icin henuz portal taslagi, harici e-Arsiv eslesmesi veya SAFA resmi fatura kaydi yok.",
      nextAction: lastPortalUploadFailed
        ? "Ayar/hata sebebi giderildiyse GIB taslagina yukle ile tekrar deneyin."
        : "Normal akis icin GIB taslagina yukleyin; imza GIB portalinda tamamlanacak.",
      source: lastPortalUploadFailed ? "Kontrol: SAFA taslak durumu + son portal sonucu." : "Kontrol: SAFA taslak durumu."
    };
  }

  if (draft.status === "READY") {
    const lastPortalUploadFailed = draft.portalDraftStatus === "YUKLEME_HATASI";

    return {
      tone: "success",
      actual: "Hazir",
      safa: "Taslak olusturuldu ve isleme hazir. Kesimden once onay adimi gerekir.",
      gib: lastPortalUploadFailed
        ? "Son GIB portal yukleme denemesi basarisiz oldu; portalda imza bekleyen belge olusmadi."
        : "Bu kart icin GIB/e-Arsiv kaydi yok; bu normal, henuz gonderim baslatilmadi.",
      nextAction: lastPortalUploadFailed
        ? "Ayar/hata sebebi giderildiyse tekrar GIB taslagina yukleyin veya once onay adimini calistirin."
        : "Normal akis icin once seciliyi onaylayin, sonra GIB taslagina yukleyin.",
      source: lastPortalUploadFailed ? "Kontrol: SAFA taslak durumu + son portal sonucu." : "Kontrol: SAFA taslak durumu."
    };
  }

  return {
    tone: "warning",
    actual: "Kontrol gerekli",
    safa: draft.warnings[0] ?? "Taslak otomatik kesime hazir degil.",
    gib: "Bu kart icin GIB/e-Arsiv kaydi yok.",
    nextAction: "Taslak uyarilarini kontrol edin; eksik bilgi giderilince tekrar deneyin.",
    source: "Kontrol: SAFA taslak uyarilari."
  };
}

function RealStatusCheckPanel({ check }: { check: RealStatusCheck }) {
  return (
    <div className={cx("real-status-check", check.tone)} aria-label="Gercek durum kontrolu">
      <div className="real-status-head">
        {noticeIcon(check.tone, false)}
        <div>
          <span>Gercek durum kontrolu</span>
          <strong>{check.actual}</strong>
        </div>
      </div>
      <div className="real-status-grid">
        <div>
          <span>SAFA kaydi</span>
          <p>{check.safa}</p>
        </div>
        <div>
          <span>GIB/e-Arsiv</span>
          <p>{check.gib}</p>
        </div>
        <div>
          <span>Yapilacak islem</span>
          <p>{check.nextAction}</p>
        </div>
      </div>
      <small>{check.source}</small>
    </div>
  );
}

function isSignedPortalExternal(invoice: ExternalInvoiceListItem) {
  if (invoice.source !== "GIB_PORTAL") return false;
  const normalized = stringValue(invoice.status)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i");
  return /onaylandi|imzalandi|imzali|kesildi|duzenlendi|basarili/.test(normalized);
}

function followupEventsForOrder(result: ExternalInvoiceSyncResult | null, orderNumber: string, shipmentPackageId: string) {
  const events = result?.followup?.timelineEvents ?? result?.timelineEvents ?? [];
  return events.filter(
    (event) =>
      event.orderNumber === orderNumber ||
      event.shipmentPackageId === shipmentPackageId ||
      stringValue(event.message).includes(stringValue(orderNumber)) ||
      stringValue(event.message).includes(stringValue(shipmentPackageId))
  );
}

function followupTone(severity: GibPortalTimelineEvent["severity"]): NoticeTone {
  if (severity === "danger") return "danger";
  if (severity === "warning") return "warning";
  if (severity === "success") return "success";
  return "neutral";
}

function nextFollowupCheckLabel(result: ExternalInvoiceSyncResult | null) {
  const events = result?.followup?.timelineEvents ?? result?.timelineEvents ?? [];
  const latest = events
    .map((event) => new Date(event.at).getTime())
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0];
  if (!latest) return "Otomatik takip aciksa backend 10 dakikada bir kontrol eder.";
  return `Son kontrol: ${formatDateTime(new Date(latest).toISOString())}. Otomatik takip aciksa sonraki kontrol yaklasik 10 dakika icinde.`;
}

function GibFollowupPanel({ result }: { result: ExternalInvoiceSyncResult | null }) {
  if (!result) return null;
  const followup = result.followup;
  const events = followup?.timelineEvents ?? result.timelineEvents ?? [];
  const unmatched = followup?.unmatchedReasons ?? result.unmatchedReasons ?? [];

  return (
    <div className="form-alert table-note">
      <strong>Portal imza takip raporu</strong>
      <span>
        {result.checkedCount ?? followup?.checkedCount ?? 0} kayit kontrol edildi · {result.signedFound ?? followup?.signedFound ?? 0} imzali bulundu ·{" "}
        {result.promoted ?? followup?.promoted ?? 0} arsive alindi · {result.pdfMissing ?? followup?.pdfMissing ?? 0} PDF bekliyor ·{" "}
        {result.trendyolSent ?? followup?.trendyolSent ?? 0} Trendyol'a gonderildi · {result.trendyolFailed ?? followup?.trendyolFailed ?? 0} Trendyol hatasi
      </span>
      <span>{nextFollowupCheckLabel(result)}</span>
      {unmatched.length > 0 ? (
        <div className="portal-draft-finder-list">
          {unmatched.slice(0, 6).map((item, index) => (
            <div key={`${item.externalInvoiceId ?? item.invoiceNumber ?? index}`}>
              <strong>{item.invoiceNumber ?? item.externalKey ?? "Fatura"}</strong>
              <span>
                {item.reason}
                {item.candidateOrderNumber ? ` · Aday siparis: ${item.candidateOrderNumber}` : ""}
                {item.candidateShipmentPackageId ? ` · Paket: ${item.candidateShipmentPackageId}` : ""}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {events.length > 0 ? (
        <div className="draft-action-trace neutral history" role="status">
          <Clock3 size={18} />
          <div>
            <strong>Son olaylar</strong>
            {events.slice(0, 5).map((event, index) => (
              <span key={`${event.type}-${event.at}-${index}`}>
                {event.message} {event.nextAction ? `· ${event.nextAction}` : ""}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function longJobTitle(job: IntegrationJobListItem) {
  if (job.type === "trendyol.sync") return "Trendyol yenileme ve fatura izi";
  if (job.type === "gib-portal.apply") return "e-Arsiv guvenli uygulama";
  return job.type;
}

function longJobTone(job: IntegrationJobListItem): NoticeTone {
  if (job.status === "FAILED") return "danger";
  if (job.status === "SUCCESS") return "success";
  if (job.status === "PROCESSING" || job.status === "PENDING") return "warning";
  return "neutral";
}

function longJobMessage(job: IntegrationJobListItem) {
  const message = typeof job.response?.message === "string" ? job.response.message : "";
  if (message) return message;
  if (job.status === "SUCCESS") return "Islem tamamlandi; liste canli veriden yenilendi.";
  if (job.status === "FAILED") return job.lastError ?? "Islem tamamlanamadi.";
  return "Islem parca parca suruyor; proxy 502 gelse bile fatura basarisiz sayilmaz.";
}

function LongJobPanel({ jobs }: { jobs: IntegrationJobListItem[] }) {
  const visibleJobs = jobs.filter((job) => job.type === "trendyol.sync" || job.type === "gib-portal.apply").slice(0, 3);
  if (visibleJobs.length === 0) return null;

  return (
    <div className="form-alert table-note">
      <strong>Uzun islem takibi</strong>
      <span>GIB/Trendyol islemleri arka plan job mantigiyla parca parca izleniyor; proxy 502 fatura hatasi sayilmaz.</span>
      <div className="portal-draft-finder-list">
        {visibleJobs.map((job) => (
          <div key={job.id}>
            <strong>
              {job.status === "SUCCESS" ? <CheckCircle2 size={14} /> : job.status === "FAILED" ? <AlertTriangle size={14} /> : <Loader2 size={14} className="spin" />}
              {longJobTitle(job)} · {statusLabel(job.status)}
            </strong>
            <span>
              {longJobMessage(job)} · Son guncelleme {formatDateTime(job.updatedAt)}
            </span>
            <span className={cx("status-pill", longJobTone(job))}>{job.attempts} parca</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DraftFollowupTimeline({
  draft,
  invoice,
  events
}: {
  draft: InvoiceDraftListItem;
  invoice?: InvoiceListItem;
  events: GibPortalTimelineEvent[];
}) {
  const signedFound = draft.externalInvoiceSources.includes("GIB_PORTAL") || events.some((event) => event.type === "signed_found");
  const pdfWaiting = Boolean(invoice && !invoice.pdfAvailable) || events.some((event) => event.type === "pdf_missing");
  const trendyolSent = invoice?.trendyolStatus === "SENT" || invoice?.trendyolStatus === "ALREADY_SENT" || events.some((event) => event.type === "trendyol_sent");
  const trendyolFailed = invoice?.trendyolStatus === "SEND_FAILED" || events.some((event) => event.type === "trendyol_failed");
  const lastEvent = events[0];

  const steps = [
    draft.portalDraftUploadedAt
      ? { label: "GIB taslagi yuklendi", detail: `Portal yukleme zamani: ${formatDateTime(draft.portalDraftUploadedAt)}`, tone: "success" as NoticeTone }
      : undefined,
    draft.status === "PORTAL_DRAFTED" && !signedFound
      ? { label: "Imza bekliyor", detail: draft.portalDraftStatus ?? "Portalda manuel imza bekleniyor.", tone: "warning" as NoticeTone }
      : undefined,
    lastEvent ? { label: "Son kontrol", detail: `${formatDateTime(lastEvent.at)} · ${lastEvent.message}`, tone: followupTone(lastEvent.severity) } : undefined,
    signedFound ? { label: "Imzali fatura bulundu", detail: draft.externalInvoiceNumber ?? invoice?.invoiceNumber ?? "GIB portal kaydi bulundu.", tone: "success" as NoticeTone } : undefined,
    invoice
      ? {
          label: invoice.pdfAvailable ? "PDF alindi" : invoice.sourceLabel?.includes("e-Arsiv") ? "Portal imzali / PDF bekliyor" : "PDF bekliyor",
          detail: invoice.pdfAvailable ? "Resmi PDF arsivde." : invoice.error ?? "Resmi PDF bekleniyor; Trendyol'a gonderilmedi.",
          tone: invoice.pdfAvailable ? ("success" as NoticeTone) : ("warning" as NoticeTone)
        }
      : pdfWaiting
        ? { label: "Portal imzali / PDF bekliyor", detail: "Imzali kayit bulundu ama resmi PDF henuz yok.", tone: "warning" as NoticeTone }
        : undefined,
    trendyolFailed
      ? { label: "Trendyol hata", detail: invoice?.error ?? "Trendyol dosya gonderimi basarisiz.", tone: "danger" as NoticeTone }
      : trendyolSent
        ? { label: "Trendyol'a gonderildi", detail: invoice?.trendyolStatus === "ALREADY_SENT" ? "Trendyol'da zaten vardi." : "PDF Trendyol'a gonderildi.", tone: "success" as NoticeTone }
        : undefined
  ].filter((step): step is { label: string; detail: string; tone: NoticeTone } => Boolean(step));

  if (steps.length === 0) return null;

  return (
    <div className="draft-action-trace neutral history" role="status">
      <Clock3 size={18} />
      <div>
        <span>Portal takip timeline</span>
        {steps.map((step) => (
          <em key={step.label}>
            {step.label}: {step.detail}
          </em>
        ))}
      </div>
    </div>
  );
}

function DeskOperationPanel({ notice }: { notice: DeskNotice }) {
  const steps = actionSteps(notice.action, notice.pending, notice.tone);
  const currentIndex = notice.pending ? Math.max(1, steps.length - 2) : notice.tone === "success" ? steps.length : Math.max(1, steps.length - 2);

  return (
    <div className={cx("desk-operation-panel", notice.tone)} role="status" aria-live="polite">
      <div className="desk-operation-head">
        <div className="desk-operation-icon">{noticeIcon(notice.tone, notice.pending)}</div>
        <div className="desk-operation-copy">
          <span>{actionStateLabel(notice.tone, notice.pending)}</span>
          <strong>{notice.title}</strong>
          <p>{notice.detail}</p>
        </div>
        <span className="mode-pill">{notice.draftIds.length} taslak</span>
      </div>
      <div className="desk-next-action">
        <strong>Ne yapmam gerek?</strong>
        <span>{notice.nextAction}</span>
      </div>
      <div className="desk-operation-steps" aria-label="Secili islem adimlari">
        {steps.map((step, index) => (
          <span key={step} className={cx(index < currentIndex && "done", index === currentIndex && "current")}>
            {index < currentIndex ? <CheckCircle2 size={13} /> : index === currentIndex && notice.tone === "danger" ? <AlertTriangle size={13} /> : <Clock3 size={13} />}
            {step}
          </span>
        ))}
      </div>
    </div>
  );
}

function ActionButtonCopy({ title, helper }: { title: string; helper: string }) {
  return (
    <span className="button-copy">
      <strong>{title}</strong>
      <small>{helper}</small>
    </span>
  );
}

export function InvoicesView({
  drafts,
  invoices,
  externalInvoices,
  jobs,
  busyAction,
  onApprove,
  onIssue,
  onUploadPortalDrafts,
  onImportExternalInvoices,
  onPreviewGibExternalInvoices,
  onApplyGibExternalInvoices,
  onSyncTrendyolExternalInvoices,
  onReconcileExternalInvoices,
  onMatchExternalInvoice,
  onPromoteExternalInvoice,
  onUploadExternalInvoicePdf,
  onSendInvoiceToTrendyol,
  onCreateMonthlyArchive,
  onRefresh,
  onOpenGibPortal,
  onCloseGibPortalSession
}: InvoicesViewProps) {
  const initialDeskQuery = initialInvoiceDeskQuery();
  const [selectedDrafts, setSelectedDrafts] = useState<string[]>([]);
  const [operationQuery, setOperationQuery] = useState(initialDeskQuery);
  const [operationQueue, setOperationQueue] = useState<InvoiceOperationQueueKey>("all");
  const [selectedOperationId, setSelectedOperationId] = useState("");
  const [draftQuery, setDraftQuery] = useState(initialDeskQuery);
  const [draftDeskFilter, setDraftDeskFilter] = useState<DraftDeskFilter>(initialDeskQuery ? "all" : "actionable");
  const [draftExternalFilter, setDraftExternalFilter] = useState<DraftExternalFilter>("all");
  const [draftSort, setDraftSort] = useState<DraftSortField>("delivered-desc");
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [archiveQuery, setArchiveQuery] = useState("");
  const [archiveStatusFilter, setArchiveStatusFilter] = useState<ArchiveStatusFilter>("all");
  const [archiveDateFilter, setArchiveDateFilter] = useState<DateFilter>("all");
  const [monthlyArchiveMonth, setMonthlyArchiveMonth] = useState(currentMonthValue);
  const [monthlyArchiveResult, setMonthlyArchiveResult] = useState<MonthlyInvoiceArchiveResult | null>(null);
  const [externalQuery, setExternalQuery] = useState("");
  const [externalListSource, setExternalListSource] = useState<ExternalListSourceFilter>("all");
  const [externalMatchFilter, setExternalMatchFilter] = useState<ExternalMatchFilter>("all");
  const [deskNotice, setDeskNotice] = useState<DeskNotice | null>(null);
  const [draftActionTraces, setDraftActionTraces] = useState<Record<string, DraftActionTrace>>({});
  const [externalSource, setExternalSource] = useState<ExternalInvoiceSource>("GIB_PORTAL");
  const [externalText, setExternalText] = useState("");
  const [externalError, setExternalError] = useState("");
  const [gibFollowupResult, setGibFollowupResult] = useState<ExternalInvoiceSyncResult | null>(null);
  const externallyInvoicedDrafts = drafts.filter(
    (draft) => (draft.status === "READY" || draft.status === "APPROVED") && draft.externalInvoiceCount > 0
  );
  const actionableDrafts = drafts.filter(isSelectableDraft);
  const portalDraftedDrafts = drafts.filter((draft) => draft.status === "PORTAL_DRAFTED" && draft.externalInvoiceCount === 0);
  const portalDraftsWithExternalInvoices = drafts.filter((draft) => draft.status === "PORTAL_DRAFTED" && draft.externalInvoiceCount > 0);
  const matchedExternalInvoices = externalInvoices.filter((invoice) => invoice.matchedOrderId).length;
  const recentSignedUnarchivedPortalInvoices = externalInvoices.filter(
    (invoice) => isSignedPortalExternal(invoice) && !invoice.promotedInvoiceId && isInRecentGibPortalSyncWindow(invoice.invoiceDate)
  );
  const recentPdfWaitingInvoices = invoices.filter(
    (invoice) => isInRecentGibPortalSyncWindow(invoice.invoiceDate) && (!invoice.pdfAvailable || stringValue(invoice.error).includes("pdf bekliyor"))
  );
  const draftById = useMemo(() => new Map(drafts.map((draft) => [draft.id, draft])), [drafts]);
  const invoiceByDraftId = useMemo(() => new Map(invoices.map((invoice) => [invoice.draftId, invoice])), [invoices]);
  const selectedDraftItems = selectedDrafts.map((id) => draftById.get(id)).filter((draft): draft is InvoiceDraftListItem => Boolean(draft));
  const selectedReadyCount = selectedDraftItems.filter((draft) => draft.status === "READY").length;
  const selectedRetryCount = selectedDraftItems.filter((draft) => draft.status === "ERROR").length;
  const selectedApprovedCount = selectedDraftItems.filter((draft) => draft.status === "APPROVED").length;
  const selectedNeedsApprovalCount = selectedReadyCount + selectedRetryCount;
  const archiveStatuses = useMemo(() => Array.from(new Set(invoices.map((invoice) => invoice.status))).sort(), [invoices]);
  const selectedArchiveMonth = parseMonthValue(monthlyArchiveMonth);
  const operationRows = useMemo(
    () => buildInvoiceOperationRows({ drafts, invoices, externalInvoices, jobs }),
    [drafts, externalInvoices, invoices, jobs]
  );
  const operationMetrics = useMemo(() => buildInvoiceOperationMetrics(operationRows), [operationRows]);
  const filteredOperationRows = useMemo(
    () => filterInvoiceOperationRows(operationRows, { query: operationQuery, queue: operationQueue }),
    [operationQuery, operationQueue, operationRows]
  );
  const visibleOperationSelectableDraftIds = useMemo(
    () => Array.from(new Set(filteredOperationRows.flatMap((row) => (row.draft && isSelectableDraft(row.draft) ? [row.draft.id] : [])))),
    [filteredOperationRows]
  );
  const selectedOperation =
    filteredOperationRows.find((row) => row.id === selectedOperationId) ??
    operationRows.find((row) => row.id === selectedOperationId) ??
    filteredOperationRows[0] ??
    operationRows[0];
  const selectionAdvice =
    selectedDrafts.length === 0
      ? ""
      : selectedRetryCount > 0
        ? "Basarisiz taslak secili. Karttaki kirmizi hata sebebini okuyun; sonra Tekrar dene veya uygun ana islemi yeniden calistirin."
        : selectedApprovedCount === selectedDrafts.length
          ? "Bu taslak onayli. Normal akis: GIB taslagina yukle, imzayi portalda at, sonra imzalananlari kontrol et."
          : selectedReadyCount > 0
            ? "Hazir taslak secili. Once onaylayin; sonra GIB taslagina yukleyip portal imzasini takip edin."
            : "Secili taslaklar icin kartlardaki durum ve uyariyi kontrol edin.";
  const visibleDeskNotice = useMemo(
    () => (deskNotice ? resolveVisibleDeskNotice(deskNotice, draftById, invoiceByDraftId) : null),
    [deskNotice, draftById, invoiceByDraftId]
  );

  const filteredDrafts = useMemo(() => {
    const search = stringValue(draftQuery);

    const filtered = drafts.filter((draft) => {
      const latestJob = latestInvoiceJob(jobs, draft.id);
      const invoice = invoiceByDraftId.get(draft.id);
      const haystack = [
        draft.id,
        draft.shipmentPackageId,
        draft.orderNumber,
        draft.customerName,
        draft.deliveredAt,
        draft.status,
        statusLabel(draft.status),
        draft.externalInvoiceNumber,
        draft.externalInvoiceSources.join(" "),
        draft.portalDraftNumber,
        draft.portalDraftUuid,
        latestJob?.lastError,
        invoice?.invoiceNumber
      ]
        .map(stringValue)
        .join(" ");

      if (search && !haystack.includes(search)) return false;
      if (showSelectedOnly && !selectedDrafts.includes(draft.id)) return false;
      if (!matchesDraftDeskFilter(draft, draftDeskFilter, latestJob, invoice)) return false;
      if (!matchesDraftExternalFilter(draft, draftExternalFilter)) return false;
      return true;
    });

    return [...filtered].sort((left, right) => {
      const leftJob = latestInvoiceJob(jobs, left.id);
      const rightJob = latestInvoiceJob(jobs, right.id);
      const leftInvoice = invoiceByDraftId.get(left.id);
      const rightInvoice = invoiceByDraftId.get(right.id);

      if (draftSort === "process") {
        const priority = draftProcessPriority(left, leftJob, leftInvoice) - draftProcessPriority(right, rightJob, rightInvoice);
        if (priority !== 0) return priority;
        return stringValue(left.orderNumber).localeCompare(stringValue(right.orderNumber), "tr-TR");
      }

      if (draftSort === "delivered-desc") return draftDeliveryTime(right) - draftDeliveryTime(left);
      if (draftSort === "delivered-asc") return draftDeliveryTime(left) - draftDeliveryTime(right);
      if (draftSort === "amount-desc") return numberValue(right.totalPayableCents) - numberValue(left.totalPayableCents);
      if (draftSort === "amount-asc") return numberValue(left.totalPayableCents) - numberValue(right.totalPayableCents);
      if (draftSort === "customer") return stringValue(left.customerName).localeCompare(stringValue(right.customerName), "tr-TR");
      if (draftSort === "status") return stringValue(statusLabel(left.status)).localeCompare(stringValue(statusLabel(right.status)), "tr-TR");
      return stringValue(left.orderNumber).localeCompare(stringValue(right.orderNumber), "tr-TR");
    });
  }, [draftDeskFilter, draftExternalFilter, draftQuery, draftSort, drafts, invoiceByDraftId, jobs, selectedDrafts, showSelectedOnly]);

  const filteredSelectableDrafts = filteredDrafts.filter(isSelectableDraft);

  async function createMonthlyArchive() {
    if (!selectedArchiveMonth) return;
    const result = await onCreateMonthlyArchive(selectedArchiveMonth.year, selectedArchiveMonth.month);
    if (!result) return;
    setMonthlyArchiveResult(result);
    triggerDownload(api.monthlyInvoiceArchiveDownloadUrl(result.year, result.month));
  }

  const filteredInvoices = useMemo(() => {
    const search = stringValue(archiveQuery);

    return invoices
      .filter((invoice) => {
        const haystack = [invoice.invoiceNumber, invoice.orderNumber, invoice.shipmentPackageId, invoice.status, invoice.trendyolStatus]
          .map(stringValue)
          .join(" ");

        if (search && !haystack.includes(search)) return false;
        if (archiveStatusFilter !== "all" && invoice.status !== archiveStatusFilter) return false;
        if (!dateMatches(invoice.invoiceDate, archiveDateFilter)) return false;
        return true;
      })
      .sort((left, right) => invoiceDeliveryTime(right) - invoiceDeliveryTime(left));
  }, [archiveDateFilter, archiveQuery, archiveStatusFilter, invoices]);

  const filteredExternalInvoices = useMemo(() => {
    const search = stringValue(externalQuery);

    return externalInvoices
      .filter((invoice) => {
        const haystack = [
          invoice.invoiceNumber,
          invoice.buyerName,
          invoice.buyerIdentifier,
          invoice.orderNumber,
          invoice.shipmentPackageId,
          invoice.matchedOrderNumber,
          invoice.matchedShipmentPackageId,
          invoice.source,
          sourceLabel(invoice.source),
          invoice.matchReason
        ]
          .map(stringValue)
          .join(" ");

        if (search && !haystack.includes(search)) return false;
        if (externalListSource !== "all" && invoice.source !== externalListSource) return false;
        if (externalMatchFilter === "matched" && !invoice.matchedOrderId) return false;
        if (externalMatchFilter === "unmatched" && invoice.matchedOrderId) return false;
        return true;
      })
      .sort((left, right) => new Date(right.invoiceDate ?? right.updatedAt).getTime() - new Date(left.invoiceDate ?? left.updatedAt).getTime());
  }, [externalInvoices, externalListSource, externalMatchFilter, externalQuery]);

  const visibleExternalInvoices = filteredExternalInvoices.slice(0, 40);

  const invoiceGroups = useMemo(() => {
    const today = startOfToday();
    const newInvoices = filteredInvoices.filter((invoice) => new Date(invoice.invoiceDate) >= today);
    const previousInvoices = filteredInvoices.filter((invoice) => new Date(invoice.invoiceDate) < today);
    return { newInvoices, previousInvoices };
  }, [filteredInvoices]);

  function toggleDraft(id: string, checked: boolean) {
    setSelectedDrafts((current) => (checked ? [...current, id] : current.filter((draftId) => draftId !== id)));
  }

  function selectVisibleDrafts() {
    const visibleIds = filteredSelectableDrafts.map((draft) => draft.id);
    setSelectedDrafts((current) => Array.from(new Set([...current, ...visibleIds])));
  }

  function selectVisibleOperationDrafts() {
    setSelectedDrafts((current) => Array.from(new Set([...current, ...visibleOperationSelectableDraftIds])));
  }

  function resetDraftFilters() {
    setDraftQuery("");
    setDraftDeskFilter("actionable");
    setDraftExternalFilter("all");
    setDraftSort("delivered-desc");
    setShowSelectedOnly(false);
  }

  function resetOperationFilters() {
    setOperationQuery("");
    setOperationQueue("all");
  }

  function resetArchiveFilters() {
    setArchiveQuery("");
    setArchiveStatusFilter("all");
    setArchiveDateFilter("all");
  }

  function resetExternalFilters() {
    setExternalQuery("");
    setExternalListSource("all");
    setExternalMatchFilter("all");
  }

  function startDraftOperation(action: DraftActionKind, ids: string[]) {
    if (ids.length === 0) return;

    const copy = actionCopy(action, ids.length);
    const tone: NoticeTone = "warning";
    setDeskNotice({
      action,
      title: copy.startedTitle,
      detail: copy.startedDetail,
      draftIds: ids,
      pending: true,
      tone,
      nextAction: nextActionFor(action, tone, true)
    });
    setDraftActionTraces((current) => {
      const next = { ...current };
      for (const id of ids) {
        next[id] = {
          action,
          title: copy.cardTitle,
          detail: copy.cardDetail,
          tone,
          at: new Date().toISOString(),
          nextAction: nextActionFor(action, tone, true)
        };
      }
      return next;
    });
  }

  function finishDraftOperation(action: DraftActionKind, ids: string[], resultMessage: string) {
    const tone = toneFromMessage(resultMessage);
    const copy = actionCopy(action, ids.length);
    setDeskNotice({
      action,
      title: copy.resultTitle,
      detail: resultMessage,
      draftIds: ids,
      pending: false,
      tone,
      nextAction: nextActionFor(action, tone, false)
    });
    setDraftActionTraces((current) => {
      const next = { ...current };
      for (const id of ids) {
        next[id] = {
          action,
          title: copy.resultTitle,
          detail: resultMessage,
          tone,
          at: new Date().toISOString(),
          nextAction: nextActionFor(action, tone, false)
        };
      }
      return next;
    });
    if (tone === "danger") {
      setSelectedDrafts(ids);
      return;
    }

    if (action === "approve" && tone === "success") {
      setDraftDeskFilter("approved");
      setDraftExternalFilter("all");
      setShowSelectedOnly(false);
      setSelectedDrafts(ids);
    }
  }

  async function runDraftOperation(action: DraftActionKind, ids: string[], runner: (draftIds: string[]) => Promise<string>) {
    if (ids.length === 0) return;

    startDraftOperation(action, ids);
    setSelectedDrafts([]);
    let resultMessage: string;
    try {
      resultMessage = await runner(ids);
    } catch (error) {
      resultMessage = error instanceof Error ? error.message : "Islem sonucu alinamadi.";
    }
    finishDraftOperation(action, ids, resultMessage);
  }

  function approveSelected() {
    const ids = selectedDraftItems.filter((draft) => draft.status !== "APPROVED").map((draft) => draft.id);
    void runDraftOperation("approve", ids, onApprove);
  }

  function uploadPortalSelected() {
    void runDraftOperation("portal", [...selectedDrafts], onUploadPortalDrafts);
  }

  async function previewSignedPortalInvoices() {
    const result = await onPreviewGibExternalInvoices(recentGibPortalSyncRequest());
    if (result) setGibFollowupResult(result);
  }

  async function applySignedPortalInvoices() {
    const result = await onApplyGibExternalInvoices(recentGibPortalSyncRequest());
    if (result) setGibFollowupResult(result);
  }

  function retryDraft(id: string) {
    void runDraftOperation("retry", [id], onIssue);
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

  function runOperationAction(row: InvoiceOperationRow) {
    const draftId = row.draft?.id;
    const externalInvoiceId = row.externalInvoice?.id;
    const invoiceId = row.invoice?.id;

    if (row.nextAction.kind === "approve" && draftId) {
      void runDraftOperation("approve", [draftId], onApprove);
      return;
    }

    if (row.nextAction.kind === "portal" && draftId) {
      void runDraftOperation("portal", [draftId], onUploadPortalDrafts);
      return;
    }

    if (row.nextAction.kind === "retry" && draftId) {
      void runDraftOperation("retry", [draftId], onIssue);
      return;
    }

    if (row.nextAction.kind === "preview-signed") {
      void previewSignedPortalInvoices();
      return;
    }

    if ((row.nextAction.kind === "apply-external" || row.nextAction.kind === "promote-external") && externalInvoiceId) {
      onPromoteExternalInvoice(externalInvoiceId, false);
      return;
    }

    if (row.nextAction.kind === "send-trendyol") {
      if (invoiceId) onSendInvoiceToTrendyol(invoiceId);
      else if (externalInvoiceId) onPromoteExternalInvoice(externalInvoiceId, true);
      return;
    }

    if (row.nextAction.kind === "open-portal") {
      onOpenGibPortal();
    }
  }

  function uploadOperationPdf(row: InvoiceOperationRow, file: File) {
    if (!row.externalInvoice?.id) return;
    onUploadExternalInvoicePdf(row.externalInvoice.id, file);
  }

  function toggleOperationDraftSelection(row: InvoiceOperationRow, checked: boolean) {
    if (!row.draft || !isSelectableDraft(row.draft)) return;
    toggleDraft(row.draft.id, checked);
  }

  return (
    <div className="view-stack">
      <InvoiceOperationsDashboard
        rows={operationRows}
        filteredRows={filteredOperationRows}
        selectedRow={selectedOperation}
        metrics={operationMetrics}
        query={operationQuery}
        queue={operationQueue}
        busyAction={busyAction}
        archiveQuery={archiveQuery}
        archiveStatusFilter={archiveStatusFilter}
        archiveDateFilter={archiveDateFilter}
        archiveStatuses={archiveStatuses}
        selectedArchiveMonth={selectedArchiveMonth}
        monthlyArchiveMonth={monthlyArchiveMonth}
        monthlyArchiveResult={monthlyArchiveResult}
        invoiceGroups={invoiceGroups}
        selectedDraftIds={selectedDrafts}
        selectedReadyCount={selectedReadyCount}
        selectedRetryCount={selectedRetryCount}
        selectedApprovedCount={selectedApprovedCount}
        selectedNeedsApprovalCount={selectedNeedsApprovalCount}
        selectionAdvice={selectionAdvice}
        visibleSelectableDraftCount={visibleOperationSelectableDraftIds.length}
        signedUnarchivedPortalInvoices={recentSignedUnarchivedPortalInvoices.length}
        pdfWaitingInvoices={recentPdfWaitingInvoices.length}
        onQueryChange={setOperationQuery}
        onQueueChange={setOperationQueue}
        onSelectRow={(row) => setSelectedOperationId(row.id)}
        onToggleDraftSelection={toggleOperationDraftSelection}
        onSelectVisibleDrafts={selectVisibleOperationDrafts}
        onClearSelectedDrafts={() => setSelectedDrafts([])}
        onApproveSelected={approveSelected}
        onUploadPortalSelected={uploadPortalSelected}
        onResetOperationFilters={resetOperationFilters}
        onRunAction={runOperationAction}
        onUploadPdf={uploadOperationPdf}
        onRefresh={onRefresh}
        onOpenGibPortal={onOpenGibPortal}
        onCloseGibPortalSession={onCloseGibPortalSession}
        onPreviewSignedPortalInvoices={previewSignedPortalInvoices}
        onApplySignedPortalInvoices={applySignedPortalInvoices}
        onSyncTrendyolExternalInvoices={onSyncTrendyolExternalInvoices}
        onReconcileExternalInvoices={onReconcileExternalInvoices}
        onArchiveMonthChange={setMonthlyArchiveMonth}
        onArchiveQueryChange={setArchiveQuery}
        onArchiveStatusChange={setArchiveStatusFilter}
        onArchiveDateChange={setArchiveDateFilter}
        onResetArchiveFilters={resetArchiveFilters}
        onCreateMonthlyArchive={createMonthlyArchive}
        onSendInvoiceToTrendyol={onSendInvoiceToTrendyol}
      />
      <section className="content-grid invoice-grid legacy-invoice-grid" aria-hidden="true">
        <article className="surface-panel">
          <div className="section-head">
            <div>
              <span className="micro-label">Onay masasi</span>
              <h2>{filteredDrafts.length} taslak gosteriliyor</h2>
              <p>
                {actionableDrafts.length} islenebilir taslak · {filteredSelectableDrafts.length} bu filtrede secilebilir
              </p>
            </div>
            <div className="section-actions">
              <span className="mode-pill">{selectedDrafts.length} secili</span>
              <button className="ui-button ghost compact" onClick={resetDraftFilters}>
                <X size={16} />
                Filtre temizle
              </button>
            </div>
          </div>

          <div className="filter-dock draft-filter-dock" aria-label="Taslak filtreleri">
            <label className="field search-field">
              <span>
                <Search size={17} />
                Arama
              </span>
              <input
                value={draftQuery}
                onChange={(event) => setDraftQuery(event.target.value)}
                placeholder="Siparis, paket, alici, fatura no, hata"
              />
            </label>
            <label className="field">
              <span>
                <ListFilter size={17} />
                Surec
              </span>
              <select value={draftDeskFilter} onChange={(event) => setDraftDeskFilter(event.target.value as DraftDeskFilter)}>
                <option value="actionable">Islenebilir</option>
                <option value="all">Tum taslaklar</option>
                <option value="failed">Hata / tekrar dene</option>
                <option value="ready">Hazir</option>
                <option value="approved">Onayli</option>
                <option value="issuing">Kuyruk / kesiliyor</option>
                <option value="portal">Portal imza bekliyor</option>
                <option value="external">Harici faturali</option>
                <option value="issued">SAFA'da kesilen</option>
              </select>
            </label>
            <label className="field">
              <span>
                <ListFilter size={17} />
                Harici
              </span>
              <select value={draftExternalFilter} onChange={(event) => setDraftExternalFilter(event.target.value as DraftExternalFilter)}>
                <option value="all">Tum kaynaklar</option>
                <option value="no-external">Harici fatura yok</option>
                <option value="external">Harici fatura var</option>
                <option value="GIB_PORTAL">e-Arsiv eslesen</option>
                <option value="TRENDYOL">Trendyol eslesen</option>
                <option value="MANUAL">Manuel eslesen</option>
              </select>
            </label>
            <label className="field">
              <span>
                <ListFilter size={17} />
                Siralama
              </span>
              <select value={draftSort} onChange={(event) => setDraftSort(event.target.value as DraftSortField)}>
                <option value="delivered-desc">Teslim yeni-eski</option>
                <option value="delivered-asc">Teslim eski-yeni</option>
                <option value="process">Surec onceligi</option>
                <option value="order">Siparis no</option>
                <option value="customer">Alici adi</option>
                <option value="status">Durum</option>
                <option value="amount-desc">Tutar yuksek</option>
                <option value="amount-asc">Tutar dusuk</option>
              </select>
            </label>
            <label className="field check-field">
              <span>Secim</span>
              <div className="check-row">
                <label>
                  <input type="checkbox" checked={showSelectedOnly} onChange={(event) => setShowSelectedOnly(event.target.checked)} />
                  Yalniz secililer
                </label>
              </div>
            </label>
          </div>

          {externallyInvoicedDrafts.length > 0 ? (
            <div className="form-alert table-note">
              {externallyInvoicedDrafts.length} taslak harici e-Arsiv faturasiyla eslestigi icin tekrar fatura kesimine kapatildi.
              Bunlar siparis ekraninda "Harici bulundu" olarak gorunur.
            </div>
          ) : null}

          <div className="form-alert table-note">
            Fatura masasi varsayilan olarak Trendyol teslim tarihine gore yeniden eskiye siralanir. Siparis ekranindaki teslim tarihiyle
            ayni kayit kullanilir.
          </div>

          {selectedDrafts.length > 0 ? (
            <div className="form-alert table-note invoice-selection-note">
              <strong>{selectedDrafts.length} taslak secildi.</strong>
              <span>
                {selectedReadyCount > 0 ? `${selectedReadyCount} hazir taslak once onaylanmali. ` : ""}
                {selectedApprovedCount > 0 ? `${selectedApprovedCount} taslak GIB taslagina yuklenebilir. ` : ""}
                {selectedRetryCount > 0 ? `${selectedRetryCount} basarisiz taslak tekrar denenecek. ` : ""}
                Sonucu her karttaki surec cubugundan takip edebilirsiniz.
              </span>
              <span className="invoice-selection-advice">{selectionAdvice}</span>
            </div>
          ) : null}

          <div className="sticky-actionbar invoice-actionbar">
            <div className="actionbar-tools">
              <button className="ui-button ghost compact" onClick={selectVisibleDrafts} disabled={filteredSelectableDrafts.length === 0}>
                <Check size={18} />
                Gorunenleri sec
              </button>
              {selectedDrafts.length > 0 ? (
                <button className="ui-button ghost compact" onClick={() => setSelectedDrafts([])}>
                  <X size={18} />
                  Secimi temizle
                </button>
              ) : null}
            </div>
            <div className="actionbar-primary-actions">
              <button
                className="ui-button action-button approve-action"
                onClick={approveSelected}
                disabled={selectedDrafts.length === 0 || selectedNeedsApprovalCount === 0 || busyAction === busyKeyForAction("approve")}
              >
                {busyAction === busyKeyForAction("approve") ? <Loader2 size={20} className="spin" /> : <Check size={20} />}
                <ActionButtonCopy
                  title={
                    busyAction === busyKeyForAction("approve")
                      ? "Onaylaniyor"
                      : selectedDrafts.length > 0 && selectedNeedsApprovalCount === 0
                        ? "Zaten onayli"
                        : "Seciliyi onayla"
                  }
                  helper={selectedDrafts.length > 0 && selectedNeedsApprovalCount === 0 ? "Sonraki adimi sec" : "Portal yukleme icin hazirlar"}
                />
              </button>
              <button
                className="ui-button action-button primary portal-action"
                onClick={uploadPortalSelected}
                disabled={selectedDrafts.length === 0 || busyAction === busyKeyForAction("portal")}
              >
                {busyAction === busyKeyForAction("portal") ? <Loader2 size={20} className="spin" /> : <UploadCloud size={20} />}
                <ActionButtonCopy
                  title={busyAction === busyKeyForAction("portal") ? "Yukleniyor" : "GIB taslagina yukle"}
                  helper="Portal imzaya tasir"
                />
              </button>
            </div>
          </div>

          {visibleDeskNotice ? <DeskOperationPanel notice={visibleDeskNotice} /> : null}

          <div className="draft-stack">
            {portalDraftedDrafts.length > 0 ? (
              <div className="form-alert table-note portal-draft-finder">
                <strong>{portalDraftedDrafts.length} taslak GIB portalina yuklendi ve manuel imza bekliyor.</strong>
                <span>Portalda Duzenlenen Belgeler ekraninda son 7 gun araligini, alici adi ve tutarla bulun.</span>
                <div className="portal-draft-finder-actions">
                  <button className="ui-button ghost compact" type="button" onClick={onOpenGibPortal} disabled={busyAction === "open-gib"}>
                    {busyAction === "open-gib" ? <Loader2 size={16} className="spin" /> : <Link2 size={16} />}
                    e-Arsiv'de ac
                  </button>
                  <button className="ui-button ghost compact" type="button" onClick={onCloseGibPortalSession} disabled={busyAction === "logout-gib"}>
                    {busyAction === "logout-gib" ? <Loader2 size={16} className="spin" /> : <ShieldOff size={16} />}
                    Guvenli cikis
                  </button>
                  <button className="ui-button primary compact" type="button" onClick={() => void previewSignedPortalInvoices()} disabled={busyAction === "external-gib-preview"}>
                    {busyAction === "external-gib-preview" ? <Loader2 size={16} className="spin" /> : <FileSearch size={16} />}
                    Son 7 gun imzalilarini kontrol et
                  </button>
                  <button className="ui-button ghost compact" type="button" onClick={() => void applySignedPortalInvoices()} disabled={busyAction === "external-gib-apply"}>
                    {busyAction === "external-gib-apply" ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
                    Son 7 gun guvenli olanlari uygula
                  </button>
                </div>
                <div className="portal-draft-finder-list">
                  {portalDraftedDrafts.slice(0, 5).map((draft) => (
                    <div key={draft.id}>
                      <strong>{draft.orderNumber}</strong>
                      <span>
                        {draft.customerName} · {money(draft.totalPayableCents, draft.currency)} · Paket {draft.shipmentPackageId}
                        {draft.deliveredAt ? ` · Teslim tarihi: ${formatDateTime(draft.deliveredAt)}` : ""}
                        {draft.portalDraftUploadedAt ? ` · Portal yukleme zamani: ${formatDateTime(draft.portalDraftUploadedAt)}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {portalDraftsWithExternalInvoices.length > 0 ? (
              <div className="form-alert table-note portal-draft-finder">
                <strong>{portalDraftsWithExternalInvoices.length} portal taslaginda resmi/harici fatura kaydi bulundu.</strong>
                <span>Bu kayitlar tekrar imza bekliyor gibi islenmeyecek; imza takip/apply akisi arsiv ve Excel durumunu onarir.</span>
                <div className="portal-draft-finder-list">
                  {portalDraftsWithExternalInvoices.slice(0, 5).map((draft) => (
                    <div key={draft.id}>
                      <strong>{draft.orderNumber}</strong>
                      <span>
                        {draft.customerName} · {money(draft.totalPayableCents, draft.currency)} · Paket {draft.shipmentPackageId}
                        {draft.deliveredAt ? ` · Teslim ${formatDateTime(draft.deliveredAt)}` : ""}
                        {draft.externalInvoiceNumber ? ` · ${draft.externalInvoiceNumber}` : " · Trendyol faturasi bulundu"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <LongJobPanel jobs={jobs} />
            <GibFollowupPanel result={gibFollowupResult} />
            {filteredDrafts.map((draft) => {
              const latestJob = latestInvoiceJob(jobs, draft.id);
              const visibleJob = visibleInvoiceJob(draft, latestJob);
              const invoice = invoiceByDraftId.get(draft.id);
              const failed = visibleJob?.status === "FAILED" || draft.status === "ERROR";
              const selectable = isSelectableDraft(draft);
              const selected = selectedDrafts.includes(draft.id);
              const realStatusCheck = resolveRealStatusCheck(draft, invoice, visibleJob);
              const actionTrace = resolveVisibleDraftActionTrace(draft, draftActionTraces[draft.id], realStatusCheck, invoice);
              const draftStatus = draftStatusView(draft);
              const followupEvents = followupEventsForOrder(gibFollowupResult, draft.orderNumber, draft.shipmentPackageId);

              return (
              <div className={cx("draft-card", selected && "selected", failed && "needs-action", !selectable && "locked")} key={draft.id}>
                <input
                  type="checkbox"
                  aria-label={`${draft.orderNumber} taslagini sec`}
                  checked={selected}
                  disabled={!selectable}
                  onChange={(event) => toggleDraft(draft.id, event.target.checked)}
                />
                <div className="draft-body">
                  <span className={cx("status-pill", draftStatus.tone)}>{draftStatus.label}</span>
                  <strong>{draft.orderNumber}</strong>
                  <small>
                    {draft.customerName} · Teslim {draft.deliveredAt ? formatDateTime(draft.deliveredAt) : "-"} ·{" "}
                    {money(draft.totalPayableCents, draft.currency)} · {draft.lineCount} satir
                  </small>
                  {draft.externalInvoiceCount > 0 ? (
                    <em>
                      Harici fatura: {draft.externalInvoiceSources.map(sourceLabel).join(", ")}
                      {draft.externalInvoiceNumber ? ` · ${draft.externalInvoiceNumber}` : ""}
                    </em>
                  ) : null}
                  {draft.status === "PORTAL_DRAFTED" && draft.externalInvoiceCount === 0 ? (
                    <em>
                      GIB portal taslagi yuklendi
                      {draft.portalDraftNumber ? ` · ${draft.portalDraftNumber}` : ""}
                    </em>
                  ) : null}
                  {invoice ? <em>SAFA faturasi: {invoice.invoiceNumber}</em> : null}
                  {draft.warnings.length > 0 ? <em>{draft.warnings[0]}</em> : null}
                  {failed ? (
                    <div className="draft-warning">
                      <AlertTriangle size={16} />
                      <span>{visibleJob?.lastError ?? draft.errors[0] ?? "Son fatura denemesi basarisiz oldu."}</span>
                      <button
                        className="ui-button ghost compact"
                        type="button"
                        onClick={() => retryDraft(draft.id)}
                        disabled={busyAction === busyKeyForAction("retry")}
                      >
                        {busyAction === busyKeyForAction("retry") ? <Loader2 size={16} className="spin" /> : <RotateCcw size={16} />}
                        {busyAction === busyKeyForAction("retry") ? "Deneniyor" : "Tekrar dene"}
                      </button>
                    </div>
                  ) : null}
                  <RealStatusCheckPanel check={realStatusCheck} />
                  <DraftFollowupTimeline draft={draft} invoice={invoice} events={followupEvents} />
                  {actionTrace ? (
                    <div className={cx("draft-action-trace", actionTrace.tone, actionTrace.history && "history")} role="status">
                      {noticeIcon(actionTrace.tone, false)}
                      <div>
                        {actionTrace.contextLabel ? <span className="draft-action-trace-label">{actionTrace.contextLabel}</span> : null}
                        <strong>{actionTrace.title}</strong>
                        <span>{actionTrace.detail}</span>
                        <em>{actionTrace.nextAction}</em>
                        <small>{formatDateTime(actionTrace.at)}</small>
                      </div>
                    </div>
                  ) : null}
                  <InvoiceProcessBar draft={draft} invoice={invoice} job={visibleJob} compact />
                  <a className="text-link" href={api.draftPdfUrl(draft.id)} target="_blank" rel="noreferrer">
                    Taslak PDF
                  </a>
                  {draft.status === "PORTAL_DRAFTED" && draft.externalInvoiceCount === 0 ? (
                    <button
                      className="ui-button ghost compact draft-inline-action"
                      type="button"
                      onClick={onOpenGibPortal}
                      disabled={busyAction === "open-gib"}
                    >
                      {busyAction === "open-gib" ? <Loader2 size={16} className="spin" /> : <Link2 size={16} />}
                      e-Arsiv'de ac
                    </button>
                  ) : null}
                  {draft.status === "PORTAL_DRAFTED" && draft.externalInvoiceCount === 0 ? (
                    <button
                      className="ui-button ghost compact draft-inline-action"
                      type="button"
                      onClick={onCloseGibPortalSession}
                      disabled={busyAction === "logout-gib"}
                    >
                      {busyAction === "logout-gib" ? <Loader2 size={16} className="spin" /> : <ShieldOff size={16} />}
                      Guvenli cikis
                    </button>
                  ) : null}
                  <Link className="text-link route-link" href={orderDeskHref(draft.orderNumber)}>
                    Siparise git
                  </Link>
                </div>
              </div>
              );
            })}
            {filteredDrafts.length === 0 ? (
              <div className="empty-state">
                <FileText size={24} />
                <strong>Taslak bulunamadi</strong>
                <p>Arama veya filtreleri temizleyin; Trendyol cek sonrasi yeni taslaklar burada listelenir.</p>
              </div>
            ) : null}
          </div>

        </article>

        <article className="surface-panel">
          <div className="section-head">
            <div>
              <span className="micro-label">PDF arsivi</span>
              <h2>{filteredInvoices.length} kesilmis fatura</h2>
              <p>{invoices.length} toplam resmi fatura icinde filtreleniyor</p>
            </div>
            <div className="section-actions">
              <FileText size={20} />
              <button className="ui-button ghost compact" onClick={resetArchiveFilters}>
                <X size={16} />
                Temizle
              </button>
            </div>
          </div>

          <div className="archive-filter-bar" aria-label="PDF arsivi filtreleri">
            <label className="field">
              <span>
                <CalendarDays size={17} />
                Aylik arsiv
              </span>
              <input type="month" value={monthlyArchiveMonth} onChange={(event) => setMonthlyArchiveMonth(event.target.value)} />
            </label>
            <a
              className="ui-button ghost"
              aria-disabled={selectedArchiveMonth ? undefined : true}
              href={
                selectedArchiveMonth
                  ? api.monthlyInvoiceExcelUrl(selectedArchiveMonth.year, selectedArchiveMonth.month)
                  : "#"
              }
              onClick={(event) => {
                if (!selectedArchiveMonth) event.preventDefault();
              }}
            >
              <Download size={17} />
              Aylik Excel indir
            </a>
            <button
              className="ui-button primary"
              type="button"
              onClick={() => void createMonthlyArchive()}
              disabled={!selectedArchiveMonth || busyAction === "monthly-archive"}
            >
              {busyAction === "monthly-archive" ? <Loader2 size={17} className="spin" /> : <Archive size={17} />}
              ZIP olustur/indir
            </button>
            <label className="field search-field">
              <span>
                <Search size={17} />
                Arama
              </span>
              <input
                value={archiveQuery}
                onChange={(event) => setArchiveQuery(event.target.value)}
                placeholder="Fatura no, siparis, paket"
              />
            </label>
            <label className="field">
              <span>
                <ListFilter size={17} />
                Durum
              </span>
              <select value={archiveStatusFilter} onChange={(event) => setArchiveStatusFilter(event.target.value as ArchiveStatusFilter)}>
                <option value="all">Tum faturalar</option>
                {archiveStatuses.map((status) => (
                  <option value={status} key={status}>
                    {statusLabel(status)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>
                <ListFilter size={17} />
                Tarih
              </span>
              <select value={archiveDateFilter} onChange={(event) => setArchiveDateFilter(event.target.value as DateFilter)}>
                <option value="all">Tum zamanlar</option>
                <option value="today">Bugun kesilen</option>
                <option value="last7">Son 7 gun</option>
                <option value="last30">Son 30 gun</option>
              </select>
            </label>
          </div>

          {monthlyArchiveResult ? (
            <div className="form-alert table-note">
              Aylik arsiv hazir: {monthlyArchiveResult.invoiceCount} resmi fatura. Eksik PDF: {monthlyArchiveResult.missingPdfCount}; eksik resmi XML:{" "}
              {monthlyArchiveResult.missingXmlCount}. Dosya: {monthlyArchiveResult.archiveFileName}
            </div>
          ) : null}

          {recentSignedUnarchivedPortalInvoices.length > 0 || recentPdfWaitingInvoices.length > 0 ? (
            <div className="form-alert table-note">
              {recentSignedUnarchivedPortalInvoices.length > 0 ? (
                <span>{recentSignedUnarchivedPortalInvoices.length} son 7 gunde portalda imzali ama SAFA arsivine alinmamis kayit var. Son 7 gun guvenli olanlari uygula ile onarilir.</span>
              ) : null}
              {recentPdfWaitingInvoices.length > 0 ? (
                <span>{recentPdfWaitingInvoices.length} son 7 gun arsiv kaydi portal imzali / PDF bekliyor; PDF gelmeden Trendyol'a dosya gonderilmez.</span>
              ) : null}
            </div>
          ) : null}

          <InvoiceArchiveSection
            title="Bugun kesilenler"
            invoices={invoiceGroups.newInvoices}
            busyAction={busyAction}
            onSendInvoiceToTrendyol={onSendInvoiceToTrendyol}
          />
          <InvoiceArchiveSection
            title="Onceki faturalar"
            invoices={invoiceGroups.previousInvoices.slice(0, 12)}
            busyAction={busyAction}
            onSendInvoiceToTrendyol={onSendInvoiceToTrendyol}
          />
        </article>
      </section>

      <section className="surface-panel">
        <div className="section-head">
          <div>
            <span className="micro-label">Harici fatura sorgulama</span>
            <h2>{filteredExternalInvoices.length} dis fatura kaydi</h2>
            <p className="section-copy">
              e-Arsiv Portal'dan canli sorgula, Trendyol siparis verisinde fatura izi ara veya gercek dis fatura listesini aktar.
              Eslesen kayitlar siparis ekraninda "Harici bulundu" olarak gorunur.
            </p>
          </div>
          <div className="section-actions">
            <span className={cx("status-pill", matchedExternalInvoices > 0 ? "success" : "warning")}>
              {matchedExternalInvoices} eslesme
            </span>
            <button className="ui-button ghost compact" onClick={resetExternalFilters}>
              <X size={16} />
              Temizle
            </button>
          </div>
        </div>

        <div className="external-tools">
          <div className="field compact-field readonly-field">
            <span>e-Arsiv kapsam</span>
            <strong>Son 7 gun</strong>
          </div>
          <button
            className="ui-button primary"
            onClick={() => void previewSignedPortalInvoices()}
            disabled={busyAction === "external-gib-preview"}
          >
            {busyAction === "external-gib-preview" ? <Loader2 size={18} className="spin" /> : <FileSearch size={18} />}
            Son 7 gun imzalilarini kontrol et
          </button>
          <button
            className="ui-button ghost"
            onClick={() => void applySignedPortalInvoices()}
            disabled={busyAction === "external-gib-apply"}
          >
            {busyAction === "external-gib-apply" ? <Loader2 size={18} className="spin" /> : <CheckCircle2 size={18} />}
            Son 7 gun guvenli olanlari uygula
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

          <div className="external-list-panel">
            <div className="external-list-tools" aria-label="Harici fatura filtreleri">
              <label className="field search-field">
                <span>
                  <Search size={17} />
                  Arama
                </span>
                <input
                  value={externalQuery}
                  onChange={(event) => setExternalQuery(event.target.value)}
                  placeholder="Fatura no, alici, siparis, paket"
                />
              </label>
              <label className="field">
                <span>
                  <ListFilter size={17} />
                  Kaynak
                </span>
                <select value={externalListSource} onChange={(event) => setExternalListSource(event.target.value as ExternalListSourceFilter)}>
                  <option value="all">Tum kaynaklar</option>
                  <option value="GIB_PORTAL">e-Arsiv</option>
                  <option value="TRENDYOL">Trendyol</option>
                  <option value="MANUAL">Manuel</option>
                </select>
              </label>
              <label className="field">
                <span>
                  <ListFilter size={17} />
                  Eslesme
                </span>
                <select value={externalMatchFilter} onChange={(event) => setExternalMatchFilter(event.target.value as ExternalMatchFilter)}>
                  <option value="all">Tum kayitlar</option>
                  <option value="matched">Eslesenler</option>
                  <option value="unmatched">Acik kalanlar</option>
                </select>
              </label>
            </div>
            <div className="external-invoice-list">
              {visibleExternalInvoices.map((invoice) => (
                <ExternalInvoiceRow
                  invoice={invoice}
                  busy={busyAction === `external-match-${invoice.id}`}
                  actionBusy={
                    busyAction === `external-promote-${invoice.id}` ||
                    busyAction === `external-pdf-${invoice.id}`
                  }
                  onMatch={(target) => onMatchExternalInvoice(invoice.id, target)}
                  onPromote={(sendToTrendyol) => onPromoteExternalInvoice(invoice.id, sendToTrendyol)}
                  onUploadPdf={(file) => onUploadExternalInvoicePdf(invoice.id, file)}
                  key={invoice.id}
                />
              ))}
              {externalInvoices.length === 0 ? <div className="mini-empty">Harici fatura kaydi yok.</div> : null}
              {externalInvoices.length > 0 && filteredExternalInvoices.length === 0 ? (
                <div className="mini-empty">Bu filtrelerle harici fatura bulunamadi.</div>
              ) : null}
              {filteredExternalInvoices.length > visibleExternalInvoices.length ? (
                <div className="mini-empty">Ilk 40 kayit gosteriliyor; aramayla listeyi daraltabilirsiniz.</div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function InvoiceOperationsDashboard({
  rows,
  filteredRows,
  selectedRow,
  metrics,
  query,
  queue,
  busyAction,
  archiveQuery,
  archiveStatusFilter,
  archiveDateFilter,
  archiveStatuses,
  selectedArchiveMonth,
  monthlyArchiveMonth,
  monthlyArchiveResult,
  invoiceGroups,
  selectedDraftIds,
  selectedReadyCount,
  selectedRetryCount,
  selectedApprovedCount,
  selectedNeedsApprovalCount,
  selectionAdvice,
  visibleSelectableDraftCount,
  signedUnarchivedPortalInvoices,
  pdfWaitingInvoices,
  onQueryChange,
  onQueueChange,
  onSelectRow,
  onToggleDraftSelection,
  onSelectVisibleDrafts,
  onClearSelectedDrafts,
  onApproveSelected,
  onUploadPortalSelected,
  onResetOperationFilters,
  onRunAction,
  onUploadPdf,
  onRefresh,
  onOpenGibPortal,
  onCloseGibPortalSession,
  onPreviewSignedPortalInvoices,
  onApplySignedPortalInvoices,
  onSyncTrendyolExternalInvoices,
  onReconcileExternalInvoices,
  onArchiveMonthChange,
  onArchiveQueryChange,
  onArchiveStatusChange,
  onArchiveDateChange,
  onResetArchiveFilters,
  onCreateMonthlyArchive,
  onSendInvoiceToTrendyol
}: {
  rows: InvoiceOperationRow[];
  filteredRows: InvoiceOperationRow[];
  selectedRow?: InvoiceOperationRow;
  metrics: ReturnType<typeof buildInvoiceOperationMetrics>;
  query: string;
  queue: InvoiceOperationQueueKey;
  busyAction: string | null;
  archiveQuery: string;
  archiveStatusFilter: ArchiveStatusFilter;
  archiveDateFilter: DateFilter;
  archiveStatuses: InvoiceStatus[];
  selectedArchiveMonth: { year: number; month: number } | null;
  monthlyArchiveMonth: string;
  monthlyArchiveResult: MonthlyInvoiceArchiveResult | null;
  invoiceGroups: { newInvoices: InvoiceListItem[]; previousInvoices: InvoiceListItem[] };
  selectedDraftIds: string[];
  selectedReadyCount: number;
  selectedRetryCount: number;
  selectedApprovedCount: number;
  selectedNeedsApprovalCount: number;
  selectionAdvice: string;
  visibleSelectableDraftCount: number;
  signedUnarchivedPortalInvoices: number;
  pdfWaitingInvoices: number;
  onQueryChange: (value: string) => void;
  onQueueChange: (value: InvoiceOperationQueueKey) => void;
  onSelectRow: (row: InvoiceOperationRow) => void;
  onToggleDraftSelection: (row: InvoiceOperationRow, checked: boolean) => void;
  onSelectVisibleDrafts: () => void;
  onClearSelectedDrafts: () => void;
  onApproveSelected: () => void;
  onUploadPortalSelected: () => void;
  onResetOperationFilters: () => void;
  onRunAction: (row: InvoiceOperationRow) => void;
  onUploadPdf: (row: InvoiceOperationRow, file: File) => void;
  onRefresh: () => void;
  onOpenGibPortal: () => void;
  onCloseGibPortalSession: () => void;
  onPreviewSignedPortalInvoices: () => Promise<void>;
  onApplySignedPortalInvoices: () => Promise<void>;
  onSyncTrendyolExternalInvoices: () => void;
  onReconcileExternalInvoices: () => void;
  onArchiveMonthChange: (value: string) => void;
  onArchiveQueryChange: (value: string) => void;
  onArchiveStatusChange: (value: ArchiveStatusFilter) => void;
  onArchiveDateChange: (value: DateFilter) => void;
  onResetArchiveFilters: () => void;
  onCreateMonthlyArchive: () => Promise<void>;
  onSendInvoiceToTrendyol: (id: string) => void;
}) {
  const queueCards: Array<{ key: InvoiceOperationQueueKey; title: string; count: number; detail: string; tone: NoticeTone }> = [
    { key: "action", title: "Son 7 gun oncelik", count: metrics.actionCount, detail: "Operator aksiyonu bekleyen kayit", tone: "danger" },
    { key: "portal-signature", title: "Portal imza bekliyor", count: metrics.portalSignatureCount, detail: "GIB sorgusu veya portal imzasi gerekli", tone: "warning" },
    { key: "pdf-missing", title: "PDF arsivi bos", count: metrics.pdfMissingCount, detail: "Arsive dusmeyen resmi PDF eksikleri", tone: "danger" },
    { key: "external-found", title: "Harici e-Arsiv eslesti", count: metrics.externalFoundCount, detail: "SAFA arsivine alinabilecek kayit", tone: "neutral" },
    { key: "marketplace", title: "Trendyol gonderimi", count: metrics.marketplaceCount, detail: "PDF hazir veya pazaryeri hatasi var", tone: "success" }
  ];
  const workQueueCards = [queueCards[2], queueCards[1], queueCards[3], queueCards[4]];
  const hasSelectableDrafts = visibleSelectableDraftCount > 0;
  const showBulkActions = selectedDraftIds.length > 0 || hasSelectableDrafts;
  const selectedDraftSummary =
    selectedDraftIds.length > 0
      ? [
          selectedReadyCount > 0 ? `${selectedReadyCount} hazir` : "",
          selectedApprovedCount > 0 ? `${selectedApprovedCount} onayli` : "",
          selectedRetryCount > 0 ? `${selectedRetryCount} hatali` : ""
        ]
          .filter(Boolean)
          .join(" · ") || `${selectedDraftIds.length} taslak secili`
      : hasSelectableDrafts
        ? `${visibleSelectableDraftCount} gorunur taslak secilebilir`
        : "Secilebilir taslak yok. Filtreyi degistirin veya senkronizasyon calistirin.";

  return (
    <section className="invoice-ops-page" aria-label="Fatura operasyon masasi">
      <article className="invoice-ops-hero surface-panel">
        <div className="invoice-ops-title">
          <span className="micro-label">Fatura operasyon masasi</span>
          <h2>Fatura Operasyon Masasi</h2>
          <p>PDF, GIB, harici fatura ve Trendyol tek ekranda.</p>
        </div>
        <div className="invoice-ops-hero-actions">
          <button className="ui-button ghost" type="button" onClick={onRefresh} disabled={busyAction === "refresh"}>
            {busyAction === "refresh" ? <Loader2 size={18} className="spin" /> : <RefreshCw size={18} />}
            Yenile
          </button>
          <button className="ui-button ghost" type="button" onClick={onOpenGibPortal} disabled={busyAction === "open-gib"}>
            {busyAction === "open-gib" ? <Loader2 size={18} className="spin" /> : <Link2 size={18} />}
            e-Arsiv ac
          </button>
          <button
            className="ui-button primary"
            type="button"
            onClick={() => void onPreviewSignedPortalInvoices()}
            disabled={busyAction === "external-gib-preview"}
          >
            {busyAction === "external-gib-preview" ? <Loader2 size={18} className="spin" /> : <FileSearch size={18} />}
            Imzalilari sorgula
          </button>
        </div>
      </article>

      <div className="invoice-ops-warning">
        <AlertTriangle size={20} />
        <div>
          <strong>PDF arsivi bos cunku resmi fatura henuz olusmadi.</strong>
          <span>
            Taslak, GIB imzasi, harici e-Arsiv ve PDF eksigi ayni satirda izlenir.
          </span>
        </div>
        <span className="mode-pill danger">
          {metrics.portalSignatureCount} imza · {metrics.pdfMissingCount} PDF
        </span>
      </div>

      <div className="invoice-ops-metrics">
        {queueCards.map((card) => (
          <button
            className={cx("invoice-ops-metric", card.tone, queue === card.key && "active")}
            type="button"
            onClick={() => onQueueChange(queue === card.key ? "all" : card.key)}
            key={card.key}
          >
            <span>{card.title}</span>
            <strong>{card.count}</strong>
            <em>{card.detail}</em>
          </button>
        ))}
      </div>

      <div className="invoice-ops-workspace">
        <aside className="surface-panel invoice-ops-queue">
          <div className="section-head">
            <div>
              <span className="micro-label">Is kuyrugu</span>
              <h2>Is kuyrugu</h2>
              <p>Oncelik kulvarini secerek aksiyona goturur.</p>
            </div>
            <span className="mode-pill">{filteredRows.length} kayit</span>
          </div>
          <div className="invoice-ops-mock-fields">
            <label className="field">
              <span>
                <CalendarDays size={17} />
                Ay
              </span>
              <div className="invoice-ops-control">
                <strong>{monthlyArchiveMonth ? monthLabel(monthlyArchiveMonth) : "Ay secilmedi"}</strong>
                <CalendarDays size={15} />
              </div>
            </label>
            <label className="field">
              <span>
                <ListFilter size={17} />
                Durum
              </span>
              <button className="invoice-ops-control" type="button" onClick={() => onQueueChange("action")}>
                <strong>Aksiyon bekleyenler</strong>
                <span>Ac</span>
              </button>
            </label>
            <label className="field search-field">
              <span>
                <Search size={17} />
                Arama
              </span>
              <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Fatura, siparis, paket" />
            </label>
          </div>
          {query || queue !== "all" ? (
            <div className="invoice-ops-filter-stack">
              <button className="ui-button ghost compact" type="button" onClick={onResetOperationFilters}>
                <X size={16} />
                Filtre temizle
              </button>
            </div>
          ) : null}
          <div className="invoice-ops-queue-list">
            {workQueueCards.map((card) => (
              <button
                className={cx("invoice-ops-queue-item", card.tone, queue === card.key && "active")}
                type="button"
                onClick={() => onQueueChange(card.key)}
                key={card.key}
              >
                <strong>{card.title}</strong>
                <span>{card.count}</span>
                <em>{card.detail}</em>
              </button>
            ))}
          </div>
        </aside>

        <article className="surface-panel invoice-ops-table-panel">
          <div className="section-head">
            <div>
              <span className="micro-label">Birlesik fatura takibi</span>
              <h2>Taslak {">"} GIB {">"} PDF {">"} Pazaryeri</h2>
              <p>Tek satirda resmi fatura, harici kayit ve pazaryeri durumu.</p>
            </div>
            <div className="section-actions">
              <button
                className="ui-button primary compact"
                type="button"
                onClick={() => void onApplySignedPortalInvoices()}
                disabled={busyAction === "external-gib-apply"}
              >
                {busyAction === "external-gib-apply" ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
                Son 7 gun eslesenleri uygula
              </button>
            </div>
          </div>

          <div className="invoice-ops-table-toolbar">
            <label className="field search-field">
              <span>
                <Search size={17} />
                Arama
              </span>
              <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Fatura no, siparis no, paket, musteri ara" />
            </label>
            <div className="invoice-ops-segmented" aria-label="Tablo durumu">
              <button className={cx(queue === "all" && "active")} type="button" onClick={() => onQueueChange("all")}>
                Tumu
              </button>
              <button className={cx(queue === "pdf-missing" && "active")} type="button" onClick={() => onQueueChange("pdf-missing")}>
                Eksik
              </button>
              <button className={cx(queue === "marketplace" && "active")} type="button" onClick={() => onQueueChange("marketplace")}>
                Tamam
              </button>
            </div>
            <div className="invoice-ops-icon-actions">
              <button className="icon-button" type="button" onClick={onSyncTrendyolExternalInvoices} disabled={busyAction === "external-trendyol-sync"} title="Trendyol izi ara">
                {busyAction === "external-trendyol-sync" ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
              </button>
              <button className="icon-button" type="button" onClick={onReconcileExternalInvoices} disabled={busyAction === "external-reconcile"} title="Tekrar eslestir">
                {busyAction === "external-reconcile" ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
              </button>
            </div>
          </div>

          <div className={cx("invoice-ops-bulkbar", selectedDraftIds.length > 0 && "active", !showBulkActions && "empty")} aria-label="Toplu taslak islemleri">
            <div className="invoice-ops-bulkbar-copy">
              <span className={cx("mode-pill", selectedDraftIds.length > 0 && "success")}>
                {selectedDraftIds.length > 0 ? `${selectedDraftIds.length} secili` : showBulkActions ? "Secim yok" : "Taslak yok"}
              </span>
              <div>
                <strong>{showBulkActions ? "Toplu taslak islemleri" : "Secilecek taslak yok"}</strong>
                <small>{selectionAdvice || selectedDraftSummary}</small>
              </div>
            </div>
            {showBulkActions ? (
              <div className="invoice-ops-bulkbar-actions">
                <button className="ui-button ghost compact" type="button" onClick={onSelectVisibleDrafts} disabled={visibleSelectableDraftCount === 0}>
                  <Check size={16} />
                  Gorunenleri sec
                </button>
                <button className="ui-button ghost compact" type="button" onClick={onClearSelectedDrafts} disabled={selectedDraftIds.length === 0}>
                  <X size={16} />
                  Secimi temizle
                </button>
                <button
                  className="ui-button ghost compact"
                  type="button"
                  onClick={onApproveSelected}
                  disabled={selectedDraftIds.length === 0 || selectedNeedsApprovalCount === 0 || busyAction === busyKeyForAction("approve")}
                >
                  {busyAction === busyKeyForAction("approve") ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
                  {selectedDraftIds.length > 0 && selectedNeedsApprovalCount === 0 ? "Zaten onayli" : "Seciliyi onayla"}
                </button>
                <button
                  className="ui-button primary compact"
                  type="button"
                  onClick={onUploadPortalSelected}
                  disabled={selectedDraftIds.length === 0 || busyAction === busyKeyForAction("portal")}
                >
                  {busyAction === busyKeyForAction("portal") ? <Loader2 size={16} className="spin" /> : <UploadCloud size={16} />}
                  GIB taslagina yukle
                </button>
              </div>
            ) : null}
          </div>

          <div className="invoice-ops-table-wrap">
            <table className="invoice-ops-table">
              <thead>
                <tr>
                  <th>Oncelik</th>
                  <th>Kayit</th>
                  <th>Akis</th>
                  <th>GIB / PDF</th>
                  <th>Pazaryeri</th>
                  <th style={{ textAlign: "right" }}>Tutar</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length > 0 ? (
                  filteredRows.map((row) => (
                    <tr
                      className={cx(selectedRow?.id === row.id && "selected", row.draft?.id && selectedDraftIds.includes(row.draft.id) && "bulk-selected")}
                      key={row.id}
                      onClick={() => onSelectRow(row)}
                    >
                      <td>
                        <div className="invoice-op-priority-cell">
                          <DraftSelectionControl
                            row={row}
                            checked={Boolean(row.draft?.id && selectedDraftIds.includes(row.draft.id))}
                            onToggle={onToggleDraftSelection}
                          />
                          <span className={cx("invoice-priority", row.statusTone)}>{row.priorityLabel}</span>
                        </div>
                      </td>
                      <td>
                        <div className="invoice-op-record">
                          <span className={cx("status-pill", row.statusTone)}>{row.statusLabel}</span>
                          <strong>{row.orderNumber}</strong>
                          <small>
                            {row.customerName} · Paket {row.shipmentPackageId}
                          </small>
                          {row.invoice?.invoiceNumber ? <em>{row.invoice.invoiceNumber}</em> : row.externalInvoice?.invoiceNumber ? <em>{row.externalInvoice.invoiceNumber}</em> : null}
                        </div>
                      </td>
                      <td>
                        <InvoiceOperationStageRail row={row} />
                      </td>
                      <td>
                        <div className="invoice-op-cell-stack">
                          <span className={cx("status-pill", toneForOperationStage(row.stages.gib))}>{row.stages.gib.detail}</span>
                          <span className={cx("status-pill", toneForOperationStage(row.stages.pdf))}>{row.stages.pdf.detail}</span>
                        </div>
                      </td>
                      <td>
                        <span className={cx("status-pill", toneForOperationStage(row.stages.marketplace))}>{row.stages.marketplace.detail}</span>
                      </td>
                      <td className="invoice-op-amount">{row.amountCents ? money(row.amountCents, row.currency) : "-"}</td>
                    </tr>
                  ))
                ) : (
                  <tr className="invoice-op-empty-row">
                    <td colSpan={6}>
                      <div className="empty-state invoice-ops-empty">
                        <FileText size={24} />
                        <strong>{rows.length === 0 ? "Henuz fatura hareketi yok" : "Filtreyle eslesen kayit yok"}</strong>
                        <p>{rows.length === 0 ? "Siparis veya e-Arsiv senkronizasyonu calistiginda akis burada gorunur." : "Arama/filtreyi temizleyip tekrar deneyin."}</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="invoice-ops-mobile-list">
            {filteredRows.map((row) => (
              <article
                className={cx(
                  "invoice-ops-mobile-card",
                  selectedRow?.id === row.id && "selected",
                  row.draft?.id && selectedDraftIds.includes(row.draft.id) && "bulk-selected"
                )}
                role="button"
                tabIndex={0}
                onClick={() => onSelectRow(row)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onSelectRow(row);
                }}
                key={row.id}
              >
                <div className="invoice-ops-mobile-card-head">
                  <span className={cx("status-pill", row.statusTone)}>{row.statusLabel}</span>
                  <DraftSelectionControl row={row} checked={Boolean(row.draft?.id && selectedDraftIds.includes(row.draft.id))} onToggle={onToggleDraftSelection} />
                </div>
                <strong>{row.orderNumber}</strong>
                <small>
                  {row.customerName} · Paket {row.shipmentPackageId} · {row.amountCents ? money(row.amountCents, row.currency) : "-"}
                </small>
                <InvoiceOperationStageRail row={row} />
                <em>{row.nextAction.detail}</em>
              </article>
            ))}
            {filteredRows.length === 0 ? (
              <div className="empty-state invoice-ops-empty">
                <FileText size={24} />
                <strong>Henuz fatura hareketi yok</strong>
                <p>Arama/filtreyi temizleyin veya siparis ve e-Arsiv senkronizasyonunu calistirin.</p>
              </div>
            ) : null}
          </div>
        </article>

        <InvoiceOperationDetailPanel
          row={selectedRow}
          busyAction={busyAction}
          onRunAction={onRunAction}
          onUploadPdf={onUploadPdf}
          onOpenGibPortal={onOpenGibPortal}
          onCloseGibPortalSession={onCloseGibPortalSession}
        />

        <article className="surface-panel invoice-archive-panel">
        <div className="section-head">
          <div>
            <span className="micro-label">Codex tasarim karari</span>
            <h2>PDF arsivi tek basina bos ekran degil</h2>
            <p>Operator once eksigi gorur; aylik Excel ve ZIP arsivi ikincil kontrol olarak korunur.</p>
          </div>
          <div className="section-actions">
            <FileText size={20} />
            <button className="ui-button ghost compact" type="button" onClick={onResetArchiveFilters}>
              <X size={16} />
              Temizle
            </button>
          </div>
        </div>
        <div className="invoice-decision-grid" aria-label="Tasarim kararlari">
          <div>
            <strong>Bos durum yok</strong>
            <span>Her bosluk sebep ve aksiyona baglanir.</span>
          </div>
          <div>
            <strong>Tek gercek satir</strong>
            <span>Taslak, GIB, PDF ve Trendyol ayni kayitta birlesir.</span>
          </div>
          <div>
            <strong>Operator onceligi</strong>
            <span>Son 7 gunde yapilacak isler otomatik uste tasinir.</span>
          </div>
        </div>
        <div className="archive-filter-bar" aria-label="PDF arsivi filtreleri">
          <label className="field">
            <span>
              <CalendarDays size={17} />
              Aylik arsiv
            </span>
            <input type="month" value={monthlyArchiveMonth} onChange={(event) => onArchiveMonthChange(event.target.value)} />
          </label>
          <a
            className="ui-button ghost"
            aria-disabled={selectedArchiveMonth ? undefined : true}
            href={selectedArchiveMonth ? api.monthlyInvoiceExcelUrl(selectedArchiveMonth.year, selectedArchiveMonth.month) : "#"}
            onClick={(event) => {
              if (!selectedArchiveMonth) event.preventDefault();
            }}
          >
            <Download size={17} />
            Aylik Excel indir
          </a>
          <button
            className="ui-button primary"
            type="button"
            onClick={() => void onCreateMonthlyArchive()}
            disabled={!selectedArchiveMonth || busyAction === "monthly-archive"}
          >
            {busyAction === "monthly-archive" ? <Loader2 size={17} className="spin" /> : <Archive size={17} />}
            ZIP olustur/indir
          </button>
          <label className="field search-field">
            <span>
              <Search size={17} />
              Arama
            </span>
            <input value={archiveQuery} onChange={(event) => onArchiveQueryChange(event.target.value)} placeholder="Fatura no, siparis, paket" />
          </label>
          <label className="field">
            <span>
              <ListFilter size={17} />
              Durum
            </span>
            <select value={archiveStatusFilter} onChange={(event) => onArchiveStatusChange(event.target.value as ArchiveStatusFilter)}>
              <option value="all">Tum faturalar</option>
              {archiveStatuses.map((status) => (
                <option value={status} key={status}>
                  {statusLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>
              <ListFilter size={17} />
              Tarih
            </span>
            <select value={archiveDateFilter} onChange={(event) => onArchiveDateChange(event.target.value as DateFilter)}>
              <option value="all">Tum zamanlar</option>
              <option value="today">Bugun kesilen</option>
              <option value="last7">Son 7 gun</option>
              <option value="last30">Son 30 gun</option>
            </select>
          </label>
        </div>
        {monthlyArchiveResult ? (
          <div className="form-alert table-note">
            Aylik arsiv hazir: {monthlyArchiveResult.invoiceCount} resmi fatura. Eksik PDF: {monthlyArchiveResult.missingPdfCount}; eksik resmi XML:{" "}
            {monthlyArchiveResult.missingXmlCount}. Dosya: {monthlyArchiveResult.archiveFileName}
          </div>
        ) : null}
        {signedUnarchivedPortalInvoices > 0 || pdfWaitingInvoices > 0 ? (
          <div className="form-alert table-note invoice-archive-warning">
            {signedUnarchivedPortalInvoices > 0 ? <span>{signedUnarchivedPortalInvoices} portalda imzali ama SAFA arsivine alinmamis kayit var.</span> : null}
            {pdfWaitingInvoices > 0 ? <span>{pdfWaitingInvoices} arsiv kaydi PDF bekliyor; PDF gelmeden Trendyol'a dosya gonderilmez.</span> : null}
          </div>
        ) : null}
        <div className="invoice-archive-grid">
          <InvoiceArchiveSection title="Bugun kesilenler" invoices={invoiceGroups.newInvoices} busyAction={busyAction} onSendInvoiceToTrendyol={onSendInvoiceToTrendyol} />
          <InvoiceArchiveSection
            title="Onceki faturalar"
            invoices={invoiceGroups.previousInvoices.slice(0, 12)}
            busyAction={busyAction}
            onSendInvoiceToTrendyol={onSendInvoiceToTrendyol}
          />
        </div>
      </article>
      </div>
    </section>
  );
}

function DraftSelectionControl({
  row,
  checked,
  onToggle
}: {
  row: InvoiceOperationRow;
  checked: boolean;
  onToggle: (row: InvoiceOperationRow, checked: boolean) => void;
}) {
  const selectable = Boolean(row.draft && isSelectableDraft(row.draft));

  return (
    <label className={cx("invoice-op-select", !selectable && "disabled")} onClick={(event) => event.stopPropagation()}>
      <input
        type="checkbox"
        checked={checked}
        disabled={!selectable}
        onChange={(event) => onToggle(row, event.target.checked)}
        aria-label={`${row.orderNumber} taslagini sec`}
      />
      <span aria-hidden="true">{checked ? <Check size={12} /> : null}</span>
    </label>
  );
}

function InvoiceOperationStageRail({ row }: { row: InvoiceOperationRow }) {
  const stages = [row.stages.draft, row.stages.gib, row.stages.pdf, row.stages.marketplace];
  return (
    <div className="invoice-op-stage-rail" aria-label={`${row.orderNumber} fatura akisi`}>
      {stages.map((stageItem) => (
        <span className={cx("invoice-op-stage", stageItem.state)} title={stageItem.detail} key={stageItem.key}>
          {stageItem.label}
        </span>
      ))}
    </div>
  );
}

function InvoiceOperationDetailPanel({
  row,
  busyAction,
  onRunAction,
  onUploadPdf,
  onOpenGibPortal,
  onCloseGibPortalSession
}: {
  row?: InvoiceOperationRow;
  busyAction: string | null;
  onRunAction: (row: InvoiceOperationRow) => void;
  onUploadPdf: (row: InvoiceOperationRow, file: File) => void;
  onOpenGibPortal: () => void;
  onCloseGibPortalSession: () => void;
}) {
  if (!row) {
    return <InvoiceOperationEmptyDetailPanel />;
  }

  return (
    <aside className="surface-panel invoice-ops-detail">
      <div className="invoice-ops-detail-head">
        <div>
          <span className={cx("status-pill", row.statusTone)}>{row.statusLabel}</span>
          <h2>{row.orderNumber}</h2>
          <p>
            Paket {row.shipmentPackageId} · {row.customerName}
          </p>
        </div>
        <span className={cx("invoice-priority", row.statusTone)}>{row.priorityLabel}</span>
      </div>
      <div className="invoice-ops-detail-timeline">
        {row.detailEvents.map((event) => (
          <div className={cx("invoice-ops-timeline-item", event.tone)} key={event.key}>
            <span />
            <div>
              <strong>{event.title}</strong>
              <p>{event.detail}</p>
              {event.at ? <small>{formatDateTime(event.at)}</small> : null}
            </div>
          </div>
        ))}
      </div>
      <div className="invoice-ops-reason">
        <strong>Bu kayit neden boyle gorunuyor?</strong>
        <p>{row.nextAction.detail}</p>
      </div>
      <div className="invoice-ops-detail-actions">
        <InvoiceOperationAction row={row} busyAction={busyAction} onRunAction={onRunAction} onUploadPdf={onUploadPdf} />
        <button className="ui-button ghost compact" type="button" onClick={onOpenGibPortal} disabled={busyAction === "open-gib"}>
          {busyAction === "open-gib" ? <Loader2 size={16} className="spin" /> : <Link2 size={16} />}
          Portalda ac
        </button>
        <button className="ui-button ghost compact" type="button" onClick={onCloseGibPortalSession} disabled={busyAction === "logout-gib"}>
          {busyAction === "logout-gib" ? <Loader2 size={16} className="spin" /> : <ShieldOff size={16} />}
          Guvenli cikis
        </button>
        {row.orderNumber !== "-" ? (
          <Link className="ui-button ghost compact" href={orderDeskHref(row.orderNumber)}>
            <Link2 size={16} />
            Siparise git
          </Link>
        ) : null}
      </div>
      <div className="invoice-ops-audit">
        <div>
          <span>Kaynak</span>
          <strong>{row.sourceKind === "external" ? "Harici fatura" : row.sourceKind === "invoice" ? "Resmi fatura" : "Taslak"}</strong>
        </div>
        <div>
          <span>Fatura no</span>
          <strong>{row.invoice?.invoiceNumber ?? row.externalInvoice?.invoiceNumber ?? row.draft?.portalDraftNumber ?? "-"}</strong>
        </div>
        <div>
          <span>Tutar</span>
          <strong>{row.amountCents ? money(row.amountCents, row.currency) : "-"}</strong>
        </div>
      </div>
      <InvoiceOperationPdfPreview row={row} />
    </aside>
  );
}

function InvoiceOperationEmptyDetailPanel() {
  return (
    <aside className="surface-panel invoice-ops-detail empty">
      <div className="empty-state invoice-ops-empty-detail">
        <FileText size={26} />
        <strong>Secilecek fatura yok</strong>
        <p>Gercek fatura hareketi geldikce timeline, sebep ve belge aksiyonlari burada acilir.</p>
      </div>
    </aside>
  );
}

function InvoiceOperationPdfPreview({ row }: { row?: InvoiceOperationRow }) {
  return (
    <div className="invoice-ops-doc-preview" aria-label="PDF onizleme">
      <div>
        <strong>PDF onizleme yeri</strong>
        <span>{row?.invoice?.pdfAvailable ? "Resmi PDF arsivde goruntulenebilir." : "PDF hazir olunca kucuk onizleme ve belge aksiyonlari burada gorunur."}</span>
      </div>
      <div className="invoice-ops-doc-paper">
        <span className="skeleton-line wide" />
        <span className="skeleton-line medium" />
        <span className="skeleton-line wide" />
        <span className="skeleton-line short" />
        <span className="skeleton-line medium" />
      </div>
      <div className="invoice-ops-doc-total">
        <span>Odenecek</span>
        <strong>{row?.amountCents ? money(row.amountCents, row.currency) : "-"}</strong>
      </div>
    </div>
  );
}

function InvoiceOperationAction({
  row,
  busyAction,
  onRunAction,
  onUploadPdf,
  compact = false
}: {
  row: InvoiceOperationRow;
  busyAction: string | null;
  onRunAction: (row: InvoiceOperationRow) => void;
  onUploadPdf: (row: InvoiceOperationRow, file: File) => void;
  compact?: boolean;
}) {
  const busy = isOperationBusy(row, busyAction);
  const className = cx("ui-button", row.nextAction.tone === "danger" || row.nextAction.tone === "warning" ? "primary" : "ghost", compact && "compact");

  if (row.nextAction.kind === "view-order" && row.orderNumber !== "-") {
    return (
      <Link className={className} href={orderDeskHref(row.orderNumber)} onClick={(event) => event.stopPropagation()}>
        <Link2 size={compact ? 15 : 17} />
        {row.nextAction.label}
      </Link>
    );
  }

  if (row.nextAction.kind === "upload-pdf" && row.externalInvoice?.id) {
    return (
      <label className={cx(className, "file-action")} onClick={(event) => event.stopPropagation()}>
        {busy ? <Loader2 size={compact ? 15 : 17} className="spin" /> : <UploadCloud size={compact ? 15 : 17} />}
        {row.nextAction.label}
        <input
          type="file"
          accept="application/pdf"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onUploadPdf(row, file);
            event.currentTarget.value = "";
          }}
        />
      </label>
    );
  }

  if (row.nextAction.kind === "none") {
    return (
      <button className="ui-button ghost compact" type="button" disabled>
        <CheckCircle2 size={compact ? 15 : 17} />
        Tamam
      </button>
    );
  }

  return (
    <button
      className={className}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onRunAction(row);
      }}
      disabled={busy}
    >
      {busy ? <Loader2 size={compact ? 15 : 17} className="spin" /> : actionIcon(row.nextAction.kind, compact ? 15 : 17)}
      {busy ? "Isleniyor" : row.nextAction.label}
    </button>
  );
}

function actionIcon(kind: InvoiceOperationRow["nextAction"]["kind"], size: number) {
  if (kind === "approve") return <Check size={size} />;
  if (kind === "portal" || kind === "upload-pdf") return <UploadCloud size={size} />;
  if (kind === "retry") return <RotateCcw size={size} />;
  if (kind === "preview-signed") return <FileSearch size={size} />;
  if (kind === "send-trendyol") return <UploadCloud size={size} />;
  if (kind === "open-portal" || kind === "view-order") return <Link2 size={size} />;
  return <CheckCircle2 size={size} />;
}

function isOperationBusy(row: InvoiceOperationRow, busyAction: string | null) {
  if (!busyAction) return false;
  if (row.nextAction.kind === "approve") return busyAction === "approve";
  if (row.nextAction.kind === "portal") return busyAction === "portal-draft-upload";
  if (row.nextAction.kind === "retry") return busyAction === "issue";
  if (row.nextAction.kind === "preview-signed") return busyAction === "external-gib-preview";
  if (row.nextAction.kind === "promote-external" || row.nextAction.kind === "apply-external") return busyAction === `external-promote-${row.externalInvoice?.id}`;
  if (row.nextAction.kind === "upload-pdf") return busyAction === `external-pdf-${row.externalInvoice?.id}`;
  if (row.nextAction.kind === "send-trendyol") return busyAction === `invoice-send-${row.invoice?.id}` || busyAction === `external-promote-${row.externalInvoice?.id}`;
  if (row.nextAction.kind === "open-portal") return busyAction === "open-gib";
  return false;
}

function toneForOperationStage(stageItem: InvoiceOperationStage): NoticeTone {
  if (stageItem.state === "done") return "success";
  if (stageItem.state === "failed" || stageItem.state === "missing") return "danger";
  if (stageItem.state === "waiting") return "warning";
  return "neutral";
}

function monthLabel(value: string) {
  const parsed = parseMonthValue(value);
  if (!parsed) return value;
  return new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(new Date(parsed.year, parsed.month - 1, 1));
}

function ExternalInvoiceRow({
  invoice,
  busy,
  actionBusy,
  onMatch,
  onPromote,
  onUploadPdf
}: {
  invoice: ExternalInvoiceListItem;
  busy: boolean;
  actionBusy: boolean;
  onMatch: (target: string) => void;
  onPromote: (sendToTrendyol: boolean) => void;
  onUploadPdf: (file: File) => void;
}) {
  const [target, setTarget] = useState("");
  const promoted = Boolean(invoice.promotedInvoiceId);

  return (
    <div className="external-invoice-row">
      <span className={cx("status-pill", invoice.matchedOrderId ? "success" : "warning")}>
        {promoted ? "Arsivde" : invoice.matchedOrderId ? "Eslesti" : "Acik"}
      </span>
      <div>
        <strong>{invoice.invoiceNumber ?? "Fatura no yok"}</strong>
        <small>
          {sourceLabel(invoice.source)} · {invoice.matchedOrderNumber ?? invoice.orderNumber ?? "Siparis eslesmedi"} ·{" "}
          {invoice.invoiceDate ? formatDateTime(invoice.invoiceDate) : "Tarih yok"}
        </small>
        {promoted ? (
          <em>
            SAFA arsivi: {invoice.promotedInvoiceNumber}
            {invoice.requiresPdfUpload ? " · portal imzali / PDF bekliyor" : ""}
          </em>
        ) : null}
        {!invoice.matchedOrderId && invoice.matchReason ? (
          <em>
            Neden acik: {invoice.matchReason}
            {invoice.suggestedOrderNumber ? ` · Aday siparis: ${invoice.suggestedOrderNumber}` : ""}
            {invoice.suggestedShipmentPackageId ? ` · Paket: ${invoice.suggestedShipmentPackageId}` : ""}
          </em>
        ) : null}
        {!invoice.matchedOrderId ? (
          <div className="manual-match">
            <input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="Siparis no veya paket no" />
            <button className="ui-button ghost compact" onClick={() => onMatch(target)} disabled={!target.trim() || busy}>
              {busy ? <Loader2 size={16} className="spin" /> : <Link2 size={16} />}
              Eslestir
            </button>
          </div>
        ) : invoice.matchedOrderNumber ? (
          <Link className="text-link route-link" href={orderDeskHref(invoice.matchedOrderNumber)}>
            Siparise git
          </Link>
        ) : null}
        {invoice.source === "GIB_PORTAL" && invoice.matchedOrderId ? (
          <div className="manual-match external-actions">
            <button className="ui-button ghost compact" onClick={() => onPromote(false)} disabled={promoted || actionBusy}>
              {actionBusy ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
              Arsive al
            </button>
            <button className="ui-button primary compact" onClick={() => onPromote(true)} disabled={actionBusy || invoice.requiresPdfUpload}>
              {actionBusy ? <Loader2 size={16} className="spin" /> : <UploadCloud size={16} />}
              Trendyol'a gonder
            </button>
            {invoice.requiresPdfUpload ? (
              <label className="ui-button ghost compact file-action">
                <UploadCloud size={16} />
                Resmi PDF yukle
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onUploadPdf(file);
                    event.currentTarget.value = "";
                  }}
                  disabled={actionBusy}
                />
              </label>
            ) : null}
          </div>
        ) : null}
      </div>
      <span>{invoice.totalPayableCents ? money(invoice.totalPayableCents, invoice.currency) : "-"}</span>
    </div>
  );
}

function InvoiceArchiveSection({
  title,
  invoices,
  busyAction,
  onSendInvoiceToTrendyol
}: {
  title: string;
  invoices: InvoiceListItem[];
  busyAction: string | null;
  onSendInvoiceToTrendyol: (id: string) => void;
}) {
  return (
    <section className="archive-section">
      <div className="archive-head">
        <h3>{title}</h3>
        <span>{invoices.length}</span>
      </div>
      <div className="archive-list">
        {invoices.map((invoice) => (
          <div className="archive-row" key={invoice.id}>
            <span className={cx("status-pill", statusTone(invoice.status))}>{statusLabel(invoice.status)}</span>
            <strong>{invoice.invoiceNumber}</strong>
            <small>
              {invoice.orderNumber} · {invoice.sourceLabel ?? "SAFA"} · Fatura {formatDateTime(invoice.invoiceDate)}
              {invoice.deliveredAt ? ` · Teslim ${formatDateTime(invoice.deliveredAt)}` : ""}
              {invoice.trendyolStatus ? ` · Trendyol ${statusLabel(invoice.trendyolStatus)}` : ""}
            </small>
            {invoice.error ? <em>{invoice.error}</em> : null}
            <div className="inline-link-row">
              {invoice.pdfAvailable ? (
                <a className="text-link" href={api.invoicePdfUrl(invoice.id)} target="_blank" rel="noreferrer">
                  PDF
                </a>
              ) : (
                <span className="muted">{invoice.sourceLabel?.includes("e-Arsiv") ? "portal imzali / PDF bekliyor" : "PDF bekliyor"}</span>
              )}
              {invoice.pdfAvailable && invoice.trendyolStatus !== "SENT" && invoice.trendyolStatus !== "ALREADY_SENT" ? (
                <button
                  className="text-link button-link"
                  type="button"
                  onClick={() => onSendInvoiceToTrendyol(invoice.id)}
                  disabled={busyAction === `invoice-send-${invoice.id}`}
                >
                  {busyAction === `invoice-send-${invoice.id}` ? "Gonderiliyor" : "Trendyol'a gonder"}
                </button>
              ) : null}
              <Link className="text-link route-link" href={orderDeskHref(invoice.orderNumber)}>
                Siparise git
              </Link>
            </div>
          </div>
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

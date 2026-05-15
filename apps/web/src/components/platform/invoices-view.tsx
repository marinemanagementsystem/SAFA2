"use client";

import type {
  ExternalInvoiceListItem,
  ExternalInvoiceSource,
  IntegrationJobListItem,
  InvoiceDraftListItem,
  InvoiceListItem,
  InvoiceStatus
} from "@safa/shared";
import {
  AlertTriangle,
  Bell,
  Check,
  CheckCircle2,
  Clock3,
  CircleDollarSign,
  FileSearch,
  FileText,
  Link2,
  ListFilter,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  UploadCloud,
  X
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "../../lib/api";
import { cx, dateMatches, formatDateTime, money, numberValue, startOfToday, statusLabel, statusTone, stringValue } from "../../lib/platform/format";
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
  onSyncGibExternalInvoices: (days: number) => void;
  onSyncTrendyolExternalInvoices: () => void;
  onReconcileExternalInvoices: () => void;
  onMatchExternalInvoice: (id: string, target: string) => void;
  onPromoteExternalInvoice: (id: string, sendToTrendyol: boolean) => void;
  onUploadExternalInvoicePdf: (id: string, file: File) => void;
  onSendInvoiceToTrendyol: (id: string) => void;
  onOpenGibPortal: () => void;
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
  if (action === "approve") return "Taslak onaylandi ve Onayli filtresine tasindi. Simdi GIB taslagina yukleyebilir veya SAFA uzerinden fatura kesimini baslatabilirsiniz.";
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
    nextAction: "Karttaki gercek duruma gore devam edin; hazirsa onaylayin, onayliysa GIB taslagina yukleyin veya fatura kesimini yeniden baslatin."
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
      gib: "PDF arsivinde resmi fatura kaydi var. Harici e-Arsiv eslesmesi gerekiyorsa e-Arsiv sorgula ile kontrol edilir.",
      nextAction: "PDF arsivinden belgeyi acin; Trendyol bildirimi gerekiyorsa arsiv durumunu takip edin.",
      source: "Kontrol: SAFA fatura arsivi + taslak durumu."
    };
  }

  if (draft.externalInvoiceCount > 0) {
    const hasPortalDraft = draft.status === "PORTAL_DRAFTED";
    return {
      tone: "warning",
      actual: "Harici fatura bulundu",
      safa: hasPortalDraft
        ? "Trendyol faturasi bulundu. SAFA bu siparisi tekrar fatura kesimine kapatti; portaldaki taslak imzalanmamali."
        : "SAFA bu siparisi tekrar fatura kesimine kapatti; cift fatura riski engellendi.",
      gib: externalInvoiceSummary(draft),
      nextAction: hasPortalDraft
        ? "GIB portalinda bu taslagi imzalamayin. Duzenlenen Belgeler/Taslaklar ekranindan taslagi silin veya isleme almayin; Trendyol faturasini harici eslesme olarak takip edin."
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
      nextAction: "GIB portalinda Duzenlenen Belgeler ekranindan toplu imza atin, sonra e-Arsiv sorgula ile belgeyi eslestirin.",
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
      nextAction: "Yenile'ye basin; kayit gelmezse e-Arsiv sorgula ile harici kaydi eslestirin.",
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
        ? "Ayar/hata sebebi giderildiyse GIB taslagina yukle ile tekrar deneyin; SAFA'da resmi kesim istiyorsaniz Onayla ve fatura kes."
        : "Portal imzasi istiyorsaniz GIB taslagina yukle; SAFA'da resmi kesim istiyorsaniz Onayla ve fatura kes.",
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
        : "Fatura kesmek icin Seciliyi onayla ya da Onayla ve fatura kes ile onay + kesim akisini baslatin.",
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
  onSyncGibExternalInvoices,
  onSyncTrendyolExternalInvoices,
  onReconcileExternalInvoices,
  onMatchExternalInvoice,
  onPromoteExternalInvoice,
  onUploadExternalInvoicePdf,
  onSendInvoiceToTrendyol,
  onOpenGibPortal
}: InvoicesViewProps) {
  const initialDeskQuery = initialInvoiceDeskQuery();
  const [selectedDrafts, setSelectedDrafts] = useState<string[]>([]);
  const [draftQuery, setDraftQuery] = useState(initialDeskQuery);
  const [draftDeskFilter, setDraftDeskFilter] = useState<DraftDeskFilter>(initialDeskQuery ? "all" : "actionable");
  const [draftExternalFilter, setDraftExternalFilter] = useState<DraftExternalFilter>("all");
  const [draftSort, setDraftSort] = useState<DraftSortField>("delivered-desc");
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [archiveQuery, setArchiveQuery] = useState("");
  const [archiveStatusFilter, setArchiveStatusFilter] = useState<ArchiveStatusFilter>("all");
  const [archiveDateFilter, setArchiveDateFilter] = useState<DateFilter>("all");
  const [externalQuery, setExternalQuery] = useState("");
  const [externalListSource, setExternalListSource] = useState<ExternalListSourceFilter>("all");
  const [externalMatchFilter, setExternalMatchFilter] = useState<ExternalMatchFilter>("all");
  const [deskNotice, setDeskNotice] = useState<DeskNotice | null>(null);
  const [draftActionTraces, setDraftActionTraces] = useState<Record<string, DraftActionTrace>>({});
  const [externalSource, setExternalSource] = useState<ExternalInvoiceSource>("GIB_PORTAL");
  const [externalText, setExternalText] = useState("");
  const [externalDays, setExternalDays] = useState(30);
  const [externalError, setExternalError] = useState("");
  const externallyInvoicedDrafts = drafts.filter(
    (draft) => (draft.status === "READY" || draft.status === "APPROVED") && draft.externalInvoiceCount > 0
  );
  const actionableDrafts = drafts.filter(isSelectableDraft);
  const portalDraftedDrafts = drafts.filter((draft) => draft.status === "PORTAL_DRAFTED" && draft.externalInvoiceCount === 0);
  const portalDraftsWithExternalInvoices = drafts.filter((draft) => draft.status === "PORTAL_DRAFTED" && draft.externalInvoiceCount > 0);
  const matchedExternalInvoices = externalInvoices.filter((invoice) => invoice.matchedOrderId).length;
  const draftById = useMemo(() => new Map(drafts.map((draft) => [draft.id, draft])), [drafts]);
  const invoiceByDraftId = useMemo(() => new Map(invoices.map((invoice) => [invoice.draftId, invoice])), [invoices]);
  const selectedDraftItems = selectedDrafts.map((id) => draftById.get(id)).filter((draft): draft is InvoiceDraftListItem => Boolean(draft));
  const selectedReadyCount = selectedDraftItems.filter((draft) => draft.status === "READY").length;
  const selectedRetryCount = selectedDraftItems.filter((draft) => draft.status === "ERROR").length;
  const selectedApprovedCount = selectedDraftItems.filter((draft) => draft.status === "APPROVED").length;
  const selectedNeedsApprovalCount = selectedReadyCount + selectedRetryCount;
  const archiveStatuses = useMemo(() => Array.from(new Set(invoices.map((invoice) => invoice.status))).sort(), [invoices]);
  const selectionAdvice =
    selectedDrafts.length === 0
      ? ""
      : selectedRetryCount > 0
        ? "Basarisiz taslak secili. Karttaki kirmizi hata sebebini okuyun; sonra Tekrar dene veya uygun ana islemi yeniden calistirin."
        : selectedApprovedCount === selectedDrafts.length
          ? "Bu taslak onayli. Portalda imzalayacaksaniz GIB taslagina yukle; SAFA'da resmi kesim kuyrugu istiyorsaniz Onayla ve fatura kes."
          : selectedReadyCount > 0
            ? "Hazir taslak secili. Fatura kes derseniz SAFA once onaylar, sonra kuyruga alir; portal secerseniz imza GIB portalinda kalir."
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

  function resetDraftFilters() {
    setDraftQuery("");
    setDraftDeskFilter("actionable");
    setDraftExternalFilter("all");
    setDraftSort("delivered-desc");
    setShowSelectedOnly(false);
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

  function issueSelected() {
    void runDraftOperation("issue", [...selectedDrafts], onIssue);
  }

  function uploadPortalSelected() {
    void runDraftOperation("portal", [...selectedDrafts], onUploadPortalDrafts);
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

  return (
    <div className="view-stack">
      <section className="content-grid invoice-grid">
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
                {selectedReadyCount > 0 ? `${selectedReadyCount} hazir taslak fatura keserken otomatik onaylanacak. ` : ""}
                {selectedApprovedCount > 0 ? `${selectedApprovedCount} taslak dogrudan kuyruga alinabilir. ` : ""}
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
                  helper={selectedDrafts.length > 0 && selectedNeedsApprovalCount === 0 ? "Sonraki adimi sec" : "Kesim icin hazirlar"}
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
              <button
                className="ui-button action-button issue-action"
                onClick={issueSelected}
                disabled={selectedDrafts.length === 0 || busyAction === busyKeyForAction("issue")}
              >
                {busyAction === busyKeyForAction("issue") ? <Loader2 size={20} className="spin" /> : <CircleDollarSign size={20} />}
                <ActionButtonCopy
                  title={busyAction === busyKeyForAction("issue") ? "Kuyruga aliniyor" : "Onayla ve fatura kes"}
                  helper="Onay + resmi kesim"
                />
              </button>
            </div>
          </div>

          {visibleDeskNotice ? <DeskOperationPanel notice={visibleDeskNotice} /> : null}

          <div className="draft-stack">
            {portalDraftedDrafts.length > 0 ? (
              <div className="form-alert table-note portal-draft-finder">
                <strong>{portalDraftedDrafts.length} taslak GIB portalina yuklendi ve manuel imza bekliyor.</strong>
                <span>Portalda Duzenlenen Belgeler ekraninda bugunun tarihi, alici adi ve tutarla bulun.</span>
                <div className="portal-draft-finder-actions">
                  <button className="ui-button ghost compact" type="button" onClick={onOpenGibPortal} disabled={busyAction === "open-gib"}>
                    {busyAction === "open-gib" ? <Loader2 size={16} className="spin" /> : <Link2 size={16} />}
                    e-Arsiv'de ac
                  </button>
                  <button className="ui-button primary compact" type="button" onClick={() => onSyncGibExternalInvoices(externalDays)} disabled={busyAction === "external-gib-sync"}>
                    {busyAction === "external-gib-sync" ? <Loader2 size={16} className="spin" /> : <FileSearch size={16} />}
                    Sorgula ve Trendyol'a gonder
                  </button>
                </div>
                <div className="portal-draft-finder-list">
                  {portalDraftedDrafts.slice(0, 5).map((draft) => (
                    <div key={draft.id}>
                      <strong>{draft.orderNumber}</strong>
                      <span>
                        {draft.customerName} · {money(draft.totalPayableCents, draft.currency)} · Paket {draft.shipmentPackageId}
                        {draft.deliveredAt ? ` · Teslim ${formatDateTime(draft.deliveredAt)}` : ""}
                        {draft.portalDraftUploadedAt ? ` · ${formatDateTime(draft.portalDraftUploadedAt)}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {portalDraftsWithExternalInvoices.length > 0 ? (
              <div className="form-alert danger table-note portal-draft-finder">
                <strong>{portalDraftsWithExternalInvoices.length} portal taslaginda Trendyol faturasi zaten var.</strong>
                <span>Bu kayitlari GIB portalinda imzalamayin; Trendyol faturasi harici fatura olarak takip edilmeli.</span>
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
                  {draft.status === "PORTAL_DRAFTED" ? (
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
                  {draft.status === "PORTAL_DRAFTED" ? (
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
            {invoice.requiresPdfUpload ? " · resmi PDF bekliyor" : ""}
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
                <span className="muted">PDF bekliyor</span>
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

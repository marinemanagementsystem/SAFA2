"use client";

import type { IntegrationJobListItem, InvoiceDraftListItem, InvoiceListItem } from "@safa/shared";
import { AlertTriangle, CheckCircle2, Clock3, RotateCcw } from "lucide-react";
import { cx, formatDateTime, statusLabel, statusTone } from "../../lib/platform/format";

type ProcessTone = "success" | "warning" | "danger" | "neutral";

interface InvoiceProcess {
  percent: number;
  tone: ProcessTone;
  title: string;
  helper: string;
  currentStep: number;
}

const processSteps = ["Taslak", "Onay", "Kuyruk", "Sonuc"];

export function latestInvoiceJob(jobs: IntegrationJobListItem[], draftId: string) {
  return jobs.find((job) => job.type === "invoice.issue" && job.target === draftId);
}

export function canRetryInvoiceProcess(draft?: InvoiceDraftListItem, job?: IntegrationJobListItem) {
  return Boolean(draft && (draft.status === "ERROR" || (job?.status === "FAILED" && !isStaleApprovalFailure(draft, job))) && draft.externalInvoiceCount === 0);
}

export function isStaleApprovalFailure(draft?: InvoiceDraftListItem, job?: IntegrationJobListItem) {
  if (!draft || !job || job.status !== "FAILED" || draft.status !== "APPROVED") return false;

  const message = (job.lastError ?? "").toLocaleLowerCase("tr-TR");
  if (!message.includes("onaylanmali") && !message.includes("onaylanmalı")) return false;
  if (!draft.approvedAt) return true;

  return new Date(job.updatedAt).getTime() <= new Date(draft.approvedAt).getTime();
}

export function resolveInvoiceProcess(
  draft?: InvoiceDraftListItem,
  invoice?: InvoiceListItem,
  job?: IntegrationJobListItem
): InvoiceProcess {
  if (!draft) {
    return {
      percent: 10,
      tone: "danger",
      title: "Taslak bulunamadi",
      helper: "Bu is eski veya silinmis bir taslaga bagli. Yeni taslak olusturun.",
      currentStep: 0
    };
  }

  if (invoice || draft.status === "ISSUED") {
    return {
      percent: 100,
      tone: "success",
      title: "Fatura tamamlandi",
      helper: invoice?.invoiceNumber ? `${invoice.invoiceNumber} numarali fatura olustu.` : "Resmi fatura olustu.",
      currentStep: 3
    };
  }

  if (draft.status === "PORTAL_DRAFTED") {
    return {
      percent: 82,
      tone: "warning",
      title: "Portal imzasi bekliyor",
      helper: "Taslak GIB portalina yuklendi. Duzenlenen Belgeler ekraninda toplu imza atin, sonra e-Arsiv sorgula.",
      currentStep: 3
    };
  }

  const effectiveJob = isStaleApprovalFailure(draft, job) ? undefined : job;

  if (effectiveJob?.status === "FAILED" || draft.status === "ERROR") {
    return {
      percent: 62,
      tone: "danger",
      title: "Tekrar deneme gerekli",
      helper: effectiveJob?.lastError ?? draft.errors[0] ?? "Son fatura denemesi basarisiz oldu. Duzeltip tekrar deneyin.",
      currentStep: 2
    };
  }

  if (effectiveJob?.status === "PROCESSING" || draft.status === "ISSUING") {
    return {
      percent: 78,
      tone: "warning",
      title: "Fatura kesiliyor",
      helper: "SAFA su anda resmi fatura islemini yurutuyor. Birazdan sonuc burada gorunecek.",
      currentStep: 2
    };
  }

  if (effectiveJob?.status === "PENDING") {
    return {
      percent: 64,
      tone: "warning",
      title: "Kuyrukta bekliyor",
      helper: "Fatura isi siraya alindi. Isleyici baslayinca durum otomatik guncellenecek.",
      currentStep: 2
    };
  }

  if (draft.status === "APPROVED") {
    return {
      percent: 50,
      tone: "neutral",
      title: "Kesime hazir",
      helper: "Bu taslak onayli. Fatura kes veya GIB taslagina yukle aksiyonunu kullanabilirsiniz.",
      currentStep: 1
    };
  }

  return {
    percent: 25,
    tone: "neutral",
    title: "Onay bekliyor",
    helper: "Fatura kes dediginizde SAFA once bu taslagi onaylar, sonra kuyruga alir.",
    currentStep: 0
  };
}

export function InvoiceProcessBar({
  draft,
  invoice,
  job,
  compact = false
}: {
  draft?: InvoiceDraftListItem;
  invoice?: InvoiceListItem;
  job?: IntegrationJobListItem;
  compact?: boolean;
}) {
  const process = resolveInvoiceProcess(draft, invoice, job);
  const visibleJob = isStaleApprovalFailure(draft, job) ? undefined : job;

  return (
    <div className={cx("invoice-process", compact && "compact", process.tone)}>
      <div className="invoice-process-head">
        <span>{process.title}</span>
        <strong>{process.percent}%</strong>
      </div>
      <div className="invoice-progress-track" aria-label={`Fatura sureci yuzde ${process.percent}`}>
        <span style={{ width: `${process.percent}%` }} />
      </div>
      <div className="invoice-process-steps" aria-label="Fatura sureci adimlari">
        {processSteps.map((step, index) => {
          const done = index < process.currentStep || process.percent === 100;
          const current = index === process.currentStep && process.percent < 100;
          return (
            <span key={step} className={cx(done && "done", current && "current")}>
              {done ? <CheckCircle2 size={13} /> : current && process.tone === "danger" ? <AlertTriangle size={13} /> : <Clock3 size={13} />}
              {step}
            </span>
          );
        })}
      </div>
      <p>{process.helper}</p>
      {visibleJob ? (
        <small>
          {statusLabel(visibleJob.status)} · {visibleJob.attempts} deneme · {formatDateTime(visibleJob.updatedAt)}
        </small>
      ) : null}
    </div>
  );
}

export function FailedJobRetryButton({
  draft,
  job,
  onRetry
}: {
  draft?: InvoiceDraftListItem;
  job: IntegrationJobListItem;
  onRetry: (draftId: string) => void;
}) {
  if (!canRetryInvoiceProcess(draft, job)) return null;

  return (
    <button className="ui-button ghost compact" type="button" onClick={() => onRetry(job.target)}>
      <RotateCcw size={16} />
      Tekrar dene
    </button>
  );
}

export function JobStatusPill({ job }: { job: IntegrationJobListItem }) {
  return <span className={cx("status-pill", statusTone(job.status))}>{statusLabel(job.status)}</span>;
}

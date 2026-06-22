import { describe, expect, it } from "vitest";
import { buildInvoiceDeskTabs, invoiceDeskFeaturesFor, type InvoiceDeskFeature } from "./invoice-desk-tabs";

describe("invoice desk tabs", () => {
  it("keeps the invoice desk split into the three approved sections", () => {
    const tabs = buildInvoiceDeskTabs({
      actionCount: 4,
      invoiceCount: 11,
      externalInvoiceCount: 3,
      archiveWarningCount: 1
    });

    expect(tabs.map((tab) => tab.key)).toEqual(["queue", "archive", "external"]);
    expect(tabs.map((tab) => tab.label)).toEqual(["Islem Kuyrugu", "Arsiv / Indirme", "Harici & GIB"]);
    expect(tabs.map((tab) => tab.count)).toEqual([4, 11, 3]);
    expect(tabs.map((tab) => tab.tone)).toEqual(["danger", "warning", "warning"]);
  });

  it("maps every required invoice function to a visible section", () => {
    const allFeatures = new Set<InvoiceDeskFeature>([
      ...invoiceDeskFeaturesFor("queue"),
      ...invoiceDeskFeaturesFor("archive"),
      ...invoiceDeskFeaturesFor("external")
    ]);

    expect([...allFeatures].sort()).toEqual(
      [
        "apply-signed",
        "close-portal",
        "draft-approve",
        "import-external",
        "invoice-list",
        "invoice-pdf",
        "manual-match",
        "monthly-excel",
        "monthly-zip",
        "open-portal",
        "portal-draft-upload",
        "preview-signed",
        "promote-external",
        "reconcile-external",
        "retry-draft",
        "row-next-action",
        "send-trendyol",
        "sync-trendyol-trace",
        "upload-official-pdf"
      ].sort()
    );
  });
});

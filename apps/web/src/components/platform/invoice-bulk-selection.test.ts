import type { InvoiceDraftListItem } from "@safa/shared";
import { describe, expect, it } from "vitest";
import { approvedSelectedDraftIds, toggleDraftSelection, toggleVisibleDraftSelection } from "./invoice-bulk-selection";

function draft(id: string, status: InvoiceDraftListItem["status"]): InvoiceDraftListItem {
  return {
    id,
    orderId: `order-${id}`,
    shipmentPackageId: `package-${id}`,
    orderNumber: `order-number-${id}`,
    customerName: "Test Musteri",
    status,
    warnings: [],
    errors: [],
    lineCount: 1,
    totalPayableCents: 10000,
    currency: "TRY",
    deliveredAt: "2026-05-22T09:00:00.000Z",
    externalInvoiceCount: 0,
    externalInvoiceSources: []
  };
}

describe("invoice bulk selection", () => {
  it("does not duplicate a draft when the same checkbox is selected again", () => {
    expect(toggleDraftSelection(["draft-1"], "draft-1", true)).toEqual(["draft-1"]);
  });

  it("toggles only visible selected drafts off when all visible rows are already selected", () => {
    expect(toggleVisibleDraftSelection(["hidden-1", "draft-1", "draft-2"], ["draft-1", "draft-2"])).toEqual(["hidden-1"]);
  });

  it("keeps portal upload scoped to approved selected drafts", () => {
    const draftById = new Map([
      ["ready-1", draft("ready-1", "READY")],
      ["approved-1", draft("approved-1", "APPROVED")],
      ["error-1", draft("error-1", "ERROR")]
    ]);

    expect(approvedSelectedDraftIds(["ready-1", "approved-1", "error-1"], draftById)).toEqual(["approved-1"]);
  });
});

import type { OrderListItem } from "@safa/shared";
import { describe, expect, it } from "vitest";
import {
  defaultOrderColumnOrder,
  defaultOrderVisibleColumnIds,
  filterOrdersByColumnFilters,
  getPortalTransferBlockReason,
  isPortalTransferableOrder,
  normalizeOrderColumnOrder,
  normalizeOrderViewProfileVault,
  normalizeVisibleOrderColumnIds
} from "./order-view-state";

const timestamp = "2026-05-22T09:00:00.000Z";

function order(input: Partial<OrderListItem> = {}): OrderListItem {
  return {
    id: "order-1",
    shipmentPackageId: "3847145278",
    orderNumber: "11232094353",
    status: "Delivered",
    customerName: "Test Musteri",
    customerEmail: "test@example.com",
    city: "Istanbul",
    district: "Kadikoy",
    totalGrossCents: 25000,
    totalDiscountCents: 0,
    totalPayableCents: 25000,
    currency: "TRY",
    lastModifiedAt: timestamp,
    deliveredAt: timestamp,
    updatedAt: timestamp,
    createdAt: timestamp,
    draftId: "draft-1",
    draftStatus: "READY",
    externalInvoiceCount: 0,
    externalInvoiceSources: [],
    ...input
  };
}

describe("order portal transfer selection", () => {
  it("allows only ready or approved draft orders without existing invoice signals", () => {
    expect(isPortalTransferableOrder(order({ draftStatus: "READY" }))).toBe(true);
    expect(isPortalTransferableOrder(order({ draftStatus: "APPROVED" }))).toBe(true);

    expect(isPortalTransferableOrder(order({ draftId: undefined }))).toBe(false);
    expect(isPortalTransferableOrder(order({ draftStatus: "NEEDS_REVIEW" }))).toBe(false);
    expect(isPortalTransferableOrder(order({ draftStatus: "PORTAL_DRAFTED" }))).toBe(false);
    expect(isPortalTransferableOrder(order({ draftStatus: "ERROR" }))).toBe(false);
    expect(isPortalTransferableOrder(order({ draftStatus: "ISSUING" }))).toBe(false);
    expect(isPortalTransferableOrder(order({ invoiceId: "invoice-1" }))).toBe(false);
    expect(isPortalTransferableOrder(order({ externalInvoiceCount: 1 }))).toBe(false);
  });

  it("returns specific block reasons for disabled selection controls", () => {
    expect(getPortalTransferBlockReason(order({ draftId: undefined }))).toBe("Taslak yok.");
    expect(getPortalTransferBlockReason(order({ invoiceId: "invoice-1" }))).toBe("Fatura zaten kesilmis.");
    expect(getPortalTransferBlockReason(order({ externalInvoiceCount: 1 }))).toBe("Harici fatura eslesmesi var.");
    expect(getPortalTransferBlockReason(order({ draftStatus: "PORTAL_DRAFTED" }))).toBe("Taslak zaten portala aktarilmis.");
    expect(getPortalTransferBlockReason(order({ draftStatus: "NEEDS_REVIEW" }))).toBe("Taslak hazir veya onayli degil.");
    expect(getPortalTransferBlockReason(order())).toBe("");
  });
});

describe("order column preferences", () => {
  it("normalizes column order by dropping unknown ids and appending missing defaults", () => {
    expect(normalizeOrderColumnOrder(["city", "unknown", "orderNumber", "city"])).toEqual([
      "city",
      "orderNumber",
      ...defaultOrderColumnOrder.filter((id) => id !== "city" && id !== "orderNumber")
    ]);
  });

  it("keeps at least one data column visible and forces select column in selection mode", () => {
    expect(normalizeVisibleOrderColumnIds([], false)).toEqual(defaultOrderVisibleColumnIds);
    expect(normalizeVisibleOrderColumnIds(["select"], false)).toEqual(defaultOrderVisibleColumnIds);
    expect(normalizeVisibleOrderColumnIds(["orderNumber"], true)).toEqual(["select", "orderNumber"]);
    expect(normalizeVisibleOrderColumnIds(["select"], true)).toEqual(["select", "orderNumber"]);
  });
});

describe("order column filtering", () => {
  it("applies text, select, and amount filters together", () => {
    const orders = [
      order({ id: "order-1", customerName: "Ali Veli", city: "Istanbul", status: "Delivered", totalPayableCents: 25000 }),
      order({ id: "order-2", customerName: "Ayse Kaya", city: "Ankara", status: "Delivered", totalPayableCents: 15000 }),
      order({ id: "order-3", customerName: "Mehmet Can", city: "Istanbul", status: "Cancelled", totalPayableCents: 40000 })
    ];

    const filtered = filterOrdersByColumnFilters(orders, {
      customerName: "ali",
      city: "Istanbul",
      status: "Delivered",
      totalPayableMin: "200",
      totalPayableMax: "300"
    });

    expect(filtered.map((item) => item.id)).toEqual(["order-1"]);
  });
});

describe("order view profile parsing", () => {
  it("falls back to a safe default vault when payload is malformed", () => {
    expect(normalizeOrderViewProfileVault({ profiles: "bad", activeProfileId: 123 })).toEqual({
      profiles: [],
      activeProfileId: null
    });
  });

  it("normalizes valid profiles without trusting unknown columns", () => {
    const vault = normalizeOrderViewProfileVault({
      profiles: [
        {
          id: "profile-1",
          name: "Operasyon",
          columnOrder: ["invoiceNumber", "missing", "orderNumber"],
          visibleColumnIds: ["missing", "invoiceNumber"],
          columnFilters: { city: "istanbul", totalPayableMin: "100" },
          topFilters: { invoiceFilter: "unissued" },
          sort: { field: "totalPayableCents", direction: "asc" },
          createdAt: timestamp,
          updatedAt: timestamp
        }
      ],
      activeProfileId: "profile-1"
    });

    expect(vault.activeProfileId).toBe("profile-1");
    expect(vault.profiles[0]?.columnOrder.slice(0, 2)).toEqual(["invoiceNumber", "orderNumber"]);
    expect(vault.profiles[0]?.visibleColumnIds).toEqual(["invoiceNumber"]);
    expect(vault.profiles[0]?.columnFilters.city).toBe("istanbul");
    expect(vault.profiles[0]?.sort).toEqual({ field: "totalPayableCents", direction: "asc" });
  });
});

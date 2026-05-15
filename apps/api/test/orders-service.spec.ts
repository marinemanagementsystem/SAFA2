import { DraftStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { OrdersService } from "../src/orders/orders.service";

const deliveredPackage = {
  shipmentPackageId: 45,
  orderNumber: "TY-45",
  shipmentPackageStatus: "Delivered",
  customerFirstName: "Ali",
  customerLastName: "Kaya",
  taxNumber: "11111111111",
  invoiceAddress: { address1: "Adres", district: "Besiktas", city: "Istanbul" },
  grossAmount: 240,
  totalPrice: 240,
  lines: [{ productName: "Urun", quantity: 2, amount: 120, vatBaseAmount: 20 }]
};

const staleDraft = {
  id: "draft-1",
  portalDraftUuid: null,
  validation: { errors: [], warnings: ["Satir toplamlari Trendyol toplamiyla tam eslesmiyor; indirim/kargo kurali kontrol edilmeli."] },
  lines: [
    {
      description: "Urun",
      quantity: 2,
      unitPriceCents: 6000,
      grossCents: 12000,
      discountCents: 0,
      payableCents: 12000,
      vatRate: 20
    }
  ],
  totals: {
    grossCents: 24000,
    discountCents: 0,
    payableCents: 24000,
    currency: "TRY",
    buyerIdentifier: "11111111111"
  },
  invoice: null
};

function serviceWith(existingDraft: Record<string, unknown> | null) {
  const prisma = {
    order: {
      upsert: vi.fn(async () => ({ id: "order-1" }))
    },
    invoiceDraft: {
      findUnique: vi.fn(async () => existingDraft),
      create: vi.fn(),
      update: vi.fn()
    },
    auditLog: {
      create: vi.fn()
    }
  };
  const trendyol = {
    fetchDeliveredPackages: vi.fn(async () => [deliveredPackage])
  };
  const externalInvoices = {
    syncTrendyolMetadata: vi.fn(async () => ({ imported: 0, matched: 0 }))
  };

  return {
    service: new OrdersService(prisma as any, trendyol as any, externalInvoices as any),
    prisma,
    trendyol,
    externalInvoices
  };
}

describe("OrdersService", () => {
  it.each([DraftStatus.READY, DraftStatus.APPROVED, DraftStatus.ERROR])(
    "refreshes open %s invoice drafts from recalculated order amounts",
    async (status) => {
      const approvedAt = new Date("2026-05-15T09:00:00.000Z");
      const { service, prisma } = serviceWith({ ...staleDraft, status, approvedAt });

      const result = await service.syncDeliveredOrders();

      expect(result.draftsUpdated).toBe(1);
      expect(prisma.invoiceDraft.update).toHaveBeenCalledTimes(1);
      const update = prisma.invoiceDraft.update.mock.calls[0][0];
      expect(update.where).toEqual({ id: "draft-1" });
      expect(update.data.status).toBe(DraftStatus.READY);
      expect(update.data.approvedAt).toBeNull();
      expect(update.data.lines[0]).toMatchObject({
        quantity: 2,
        unitPriceCents: 12000,
        grossCents: 24000,
        payableCents: 24000
      });
      expect(update.data.totals.payableCents).toBe(24000);
      expect(update.data.validation.errors).toEqual([]);
      expect(update.data.validation.warnings).toEqual([]);
    }
  );

  it.each([
    { status: DraftStatus.PORTAL_DRAFTED, portalDraftUuid: "portal-uuid", invoice: null },
    { status: DraftStatus.READY, portalDraftUuid: null, invoice: { id: "invoice-1" } }
  ])("does not refresh protected drafts %#", async (protectedFields) => {
    const { service, prisma } = serviceWith({ ...staleDraft, ...protectedFields });

    const result = await service.syncDeliveredOrders();

    expect(result.draftsUpdated).toBe(0);
    expect(prisma.invoiceDraft.update).not.toHaveBeenCalled();
    expect(prisma.invoiceDraft.create).not.toHaveBeenCalled();
  });
});

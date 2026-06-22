import { describe, expect, it } from "vitest";
import { fetchPlatformSnapshot } from "./use-platform-data";

describe("fetchPlatformSnapshot", () => {
  it("loads platform data in request waves with at most four concurrent calls", async () => {
    const calls: string[] = [];
    const activeCounts: number[] = [];
    let active = 0;

    function request<T>(name: string, value: T) {
      return async () => {
        active += 1;
        calls.push(name);
        activeCounts.push(active);
        await Promise.resolve();
        active -= 1;
        return value;
      };
    }

    const apiClient = {
      orders: request("orders", [{ id: "order-1" }]),
      invoices: request("invoices", [{ id: "invoice-1" }]),
      drafts: request("drafts", [{ id: "draft-1" }]),
      settings: request("settings", { runtime: { live: true } }),
      connections: request("connections", { gibDirect: { ready: true } }),
      externalInvoices: request("externalInvoices", [{ id: "external-1" }]),
      jobs: request("jobs", [{ id: "job-1" }]),
      automationStatus: request("automationStatus", { isStale: false }),
      products: request("products", [{ id: "product-1" }]),
      hepsiburadaOrderLines: request("hepsiburadaOrderLines", [{ id: "line-1" }])
    } as unknown as Parameters<typeof fetchPlatformSnapshot>[0];

    const snapshot = await fetchPlatformSnapshot(apiClient);

    expect(calls).toEqual([
      "orders",
      "invoices",
      "drafts",
      "settings",
      "connections",
      "externalInvoices",
      "jobs",
      "automationStatus",
      "products",
      "hepsiburadaOrderLines"
    ]);
    expect(Math.max(...activeCounts)).toBe(4);
    expect(snapshot).toEqual({
      orders: [{ id: "order-1" }],
      invoices: [{ id: "invoice-1" }],
      drafts: [{ id: "draft-1" }],
      settings: { runtime: { live: true } },
      connections: { gibDirect: { ready: true } },
      externalInvoices: [{ id: "external-1" }],
      jobs: [{ id: "job-1" }],
      automationStatus: { isStale: false },
      hepsiburadaProducts: [{ id: "product-1" }],
      hepsiburadaOrderLines: [{ id: "line-1" }]
    });
  });
});

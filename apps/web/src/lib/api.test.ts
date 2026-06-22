import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type HepsiburadaProductInput } from "./api";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return new Response(JSON.stringify(body), {
    ...init,
    headers
  });
}

function productInput(): HepsiburadaProductInput {
  return {
    name: "Test Product",
    merchantSku: "SKU-1",
    brand: "SAFA",
    categoryName: "Marine",
    vatRate: 20,
    priceCents: 1000,
    stock: 5,
    dispatchTime: 1,
    active: true
  };
}

describe("api request retry policy", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("retries a GET once after a 429 Retry-After response and returns the successful body", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          statusText: "Too Many Requests",
          headers: { "retry-after": "1" }
        })
      )
      .mockResolvedValueOnce(jsonResponse([{ id: "order-1" }]));
    vi.stubGlobal("fetch", fetchMock);

    const result = api.orders();
    await vi.advanceTimersByTimeAsync(1000);

    await expect(result).resolves.toEqual([{ id: "order-1" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a POST after a 429 response", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        { message: "too many writes" },
        {
          status: 429,
          statusText: "Too Many Requests"
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.createProduct(productInput())).rejects.toThrow("too many writes");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a GET after a network failure", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("socket reset"))
      .mockResolvedValueOnce(jsonResponse([{ id: "order-1" }]));
    vi.stubGlobal("fetch", fetchMock);

    const result = api.orders();
    await vi.advanceTimersByTimeAsync(1000);

    await expect(result).resolves.toEqual([{ id: "order-1" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

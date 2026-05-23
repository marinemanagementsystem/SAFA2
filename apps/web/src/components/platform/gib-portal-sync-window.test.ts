import { describe, expect, it } from "vitest";
import { recentGibPortalSyncRequest } from "./gib-portal-sync-window";

describe("recentGibPortalSyncRequest", () => {
  it("scopes portal sync to the current 7-day Europe/Istanbul calendar window", () => {
    expect(recentGibPortalSyncRequest(new Date("2026-05-22T21:30:00.000Z"))).toEqual({
      days: 7,
      startDate: "2026-05-17T00:00:00+03:00",
      endDate: "2026-05-23T23:59:59+03:00"
    });
  });
});

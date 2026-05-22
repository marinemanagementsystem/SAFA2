import { describe, expect, it } from "vitest";
import { todayGibPortalSyncRequest } from "./gib-portal-sync-window";

describe("todayGibPortalSyncRequest", () => {
  it("scopes portal sync to the current Europe/Istanbul calendar day", () => {
    expect(todayGibPortalSyncRequest(new Date("2026-05-21T21:30:00.000Z"))).toEqual({
      days: 1,
      startDate: "2026-05-22T00:00:00+03:00",
      endDate: "2026-05-22T23:59:59+03:00"
    });
  });
});

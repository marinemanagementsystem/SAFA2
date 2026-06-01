import { describe, expect, it } from "vitest";
import { buildAutomationStatusView } from "./automation-status-model";

describe("buildAutomationStatusView", () => {
  it("marks recent automation status as current and keeps manual catch-up visible", () => {
    const view = buildAutomationStatusView({
      budgetGuardMode: "free-tier-guard",
      lastGibFollowupAt: "2026-06-01T06:10:00.000Z",
      lastTrendyolSyncAt: "2026-06-01T05:40:00.000Z",
      nextGibFollowupAt: "2026-06-01T13:00:00+03:00",
      isStale: false,
      staleReason: null,
      autoRunsToday: 2,
      dailyAutoRunLimit: 4,
      manualRunAllowed: true
    });

    expect(view.tone).toBe("success");
    expect(view.statusLabel).toBe("Guncel");
    expect(view.budgetLabel).toBe("2/4 otomatik calisma");
    expect(view.manualActionLabel).toBe("Simdi guncelle");
    expect(view.lines).toEqual(
      expect.arrayContaining([
        "Son GIB kontrolu: 01.06.2026 09:10",
        "Son Trendyol kontrolu: 01.06.2026 08:40",
        "Sonraki otomatik kontrol: 01.06.2026 13:00"
      ])
    );
  });

  it("shows stale reason and preserves manual run when automatic guard is exhausted", () => {
    const view = buildAutomationStatusView({
      budgetGuardMode: "free-tier-guard",
      lastGibFollowupAt: undefined,
      lastTrendyolSyncAt: "2026-06-01T05:40:00.000Z",
      nextGibFollowupAt: "2026-06-01T13:00:00+03:00",
      isStale: true,
      staleReason: "GIB otomatik takip henuz basarili tamamlanmadi.",
      autoRunsToday: 4,
      dailyAutoRunLimit: 4,
      manualRunAllowed: true
    });

    expect(view.tone).toBe("warning");
    expect(view.statusLabel).toBe("Guncel degil");
    expect(view.budgetLabel).toBe("4/4 otomatik calisma");
    expect(view.budgetDetail).toContain("Butce koruma");
    expect(view.manualActionDisabled).toBe(false);
    expect(view.lines[0]).toContain("GIB otomatik takip");
  });
});

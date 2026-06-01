import type { AutomationStatusSnapshot } from "@safa/shared";
import { formatDateTime } from "../../lib/platform/format";

export type AutomationStatusTone = "success" | "warning" | "danger" | "neutral";

export interface AutomationStatusViewModel {
  tone: AutomationStatusTone;
  statusLabel: string;
  budgetLabel: string;
  budgetDetail: string;
  manualActionLabel: string;
  manualActionDisabled: boolean;
  lines: string[];
}

function line(label: string, value?: string) {
  return `${label}: ${value ? formatDateTime(value) : "Henuz yok"}`;
}

export function buildAutomationStatusView(status?: AutomationStatusSnapshot | null): AutomationStatusViewModel {
  if (!status) {
    return {
      tone: "warning",
      statusLabel: "Guncel degil",
      budgetLabel: "Otomasyon durumu bekleniyor",
      budgetDetail: "Canli API otomasyon durumunu henuz dondurmedi.",
      manualActionLabel: "Simdi guncelle",
      manualActionDisabled: true,
      lines: ["Otomasyon durumu alinamadi."]
    };
  }

  const autoRunsToday = Math.max(0, status.autoRunsToday);
  const dailyAutoRunLimit = Math.max(0, status.dailyAutoRunLimit);
  const automaticGuardExhausted = autoRunsToday >= dailyAutoRunLimit;
  const staleLine = status.isStale && status.staleReason ? status.staleReason : "Otomasyon son kontrolleri guncel.";

  return {
    tone: status.isStale ? "warning" : "success",
    statusLabel: status.isStale ? "Guncel degil" : "Guncel",
    budgetLabel: `${autoRunsToday}/${dailyAutoRunLimit} otomatik calisma`,
    budgetDetail: automaticGuardExhausted
      ? "Butce koruma otomatik calismayi bekletebilir; manuel guncelleme acik kalir."
      : "Free-tier guard otomatik calisma sayisini sinirli tutuyor.",
    manualActionLabel: "Simdi guncelle",
    manualActionDisabled: !status.manualRunAllowed,
    lines: [
      staleLine,
      line("Son GIB kontrolu", status.lastGibFollowupAt),
      line("Son Trendyol kontrolu", status.lastTrendyolSyncAt),
      line("Sonraki otomatik kontrol", status.nextGibFollowupAt)
    ]
  };
}

export interface GibPortalSyncRequest {
  days?: number;
  startDate?: string;
  endDate?: string;
  repairMissingDrafts?: boolean;
  repairOrderNumber?: string;
}

function istanbulDateParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: value("year"),
    month: value("month"),
    day: value("day")
  };
}

export function todayGibPortalSyncRequest(now = new Date()): GibPortalSyncRequest {
  const { year, month, day } = istanbulDateParts(now);
  const date = `${year}-${month}-${day}`;

  return {
    days: 1,
    startDate: `${date}T00:00:00+03:00`,
    endDate: `${date}T23:59:59+03:00`
  };
}

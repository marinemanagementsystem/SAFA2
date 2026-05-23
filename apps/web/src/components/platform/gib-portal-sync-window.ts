export interface GibPortalSyncRequest {
  days?: number;
  startDate?: string;
  endDate?: string;
  repairMissingDrafts?: boolean;
  repairOrderNumber?: string;
}

const GIB_PORTAL_SYNC_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

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

function istanbulDateKey(now: Date) {
  const { year, month, day } = istanbulDateParts(now);
  return `${year}-${month}-${day}`;
}

export function recentGibPortalSyncRequest(now = new Date()): GibPortalSyncRequest {
  const endDate = istanbulDateKey(now);
  const endStart = new Date(`${endDate}T00:00:00+03:00`);
  const startDate = istanbulDateKey(new Date(endStart.getTime() - (GIB_PORTAL_SYNC_WINDOW_DAYS - 1) * DAY_MS));

  return {
    days: GIB_PORTAL_SYNC_WINDOW_DAYS,
    startDate: `${startDate}T00:00:00+03:00`,
    endDate: `${endDate}T23:59:59+03:00`
  };
}

export function isInRecentGibPortalSyncWindow(value: string | undefined, now = new Date()) {
  if (!value) return false;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return false;
  const range = recentGibPortalSyncRequest(now);
  const start = range.startDate ? new Date(range.startDate) : undefined;
  const end = range.endDate ? new Date(range.endDate) : undefined;
  return Boolean(start && end && date >= start && date <= end);
}

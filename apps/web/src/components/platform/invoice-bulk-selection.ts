import type { InvoiceDraftListItem } from "@safa/shared";

export function toggleDraftSelection(current: string[], id: string, checked: boolean) {
  if (!checked) return current.filter((draftId) => draftId !== id);
  return Array.from(new Set([...current, id]));
}

export function toggleVisibleDraftSelection(current: string[], visibleIds: string[]) {
  const visibleSet = new Set(visibleIds);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => current.includes(id));

  if (allVisibleSelected) {
    return current.filter((id) => !visibleSet.has(id));
  }

  return Array.from(new Set([...current, ...visibleIds]));
}

export function approvedSelectedDraftIds(selectedIds: string[], draftById: Map<string, InvoiceDraftListItem>) {
  return selectedIds
    .map((id) => draftById.get(id))
    .filter((draft): draft is InvoiceDraftListItem => draft !== undefined)
    .filter((draft) => draft.status === "APPROVED")
    .map((draft) => draft.id);
}

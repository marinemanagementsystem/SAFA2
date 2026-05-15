"use client";

import type { PlatformView } from "../../lib/platform/types";
import { AuthGate } from "./auth-gate";
import { IntegrationsView } from "./integrations-view";
import { InvoicesView } from "./invoices-view";
import { OperationsView } from "./operations-view";
import { OrdersView } from "./orders-view";
import { OverviewView } from "./overview-view";
import { PlatformShell } from "./platform-shell";
import { SavedInformationView } from "./saved-information-view";
import { SettingsView } from "./settings-view";
import { usePlatformData } from "./use-platform-data";

interface PlatformAppProps {
  view: PlatformView;
}

export function PlatformApp({ view }: PlatformAppProps) {
  const platform = usePlatformData();
  const { snapshot } = platform;

  return (
    <AuthGate>
      {(session) => (
        <PlatformShell
          view={view}
          snapshot={snapshot}
          loadState={platform.loadState}
          busyAction={platform.busyAction}
          message={platform.message}
          apiAvailable={platform.apiAvailable}
          onRefresh={() => void platform.refresh()}
          onSync={() => void platform.syncOrders()}
          onOpenPortal={() => void platform.openGibPortal()}
          onLogout={session.logout}
        >
          {view === "overview" ? (
            <OverviewView
              snapshot={snapshot}
              loadState={platform.loadState}
              busyAction={platform.busyAction}
              apiAvailable={platform.apiAvailable}
              onSync={() => void platform.syncOrders()}
            />
          ) : null}
          {view === "orders" ? (
            <OrdersView
              orders={snapshot.orders}
              selectedOrderId={platform.selectedOrderId}
              selectedOrder={platform.selectedOrder}
              detailState={platform.detailState}
              onSelectOrder={platform.setSelectedOrderId}
            />
          ) : null}
          {view === "invoices" ? (
            <InvoicesView
              drafts={snapshot.drafts}
              invoices={snapshot.invoices}
              externalInvoices={snapshot.externalInvoices}
              jobs={snapshot.jobs}
              settings={snapshot.settings}
              busyAction={platform.busyAction}
              onApprove={platform.approveDrafts}
              onIssue={platform.issueDrafts}
              onUploadPortalDrafts={platform.uploadPortalDrafts}
              onImportExternalInvoices={(source, records) => void platform.importExternalInvoices(source, records)}
              onSyncGibExternalInvoices={(days) => void platform.syncGibExternalInvoices(days)}
              onSyncTrendyolExternalInvoices={() => void platform.syncTrendyolExternalInvoices()}
              onReconcileExternalInvoices={() => void platform.reconcileExternalInvoices()}
              onMatchExternalInvoice={(id, target) => void platform.matchExternalInvoice(id, target)}
              onOpenGibPortal={() => void platform.openGibPortal()}
            />
          ) : null}
          {view === "integrations" ? (
            <IntegrationsView
              ownerUsername={session.username}
              connections={snapshot.connections}
              settings={snapshot.settings}
              draftCount={snapshot.drafts.length}
              busyAction={platform.busyAction}
              apiAvailable={platform.apiAvailable}
              trendyolForm={platform.trendyolForm}
              gibPortalForm={platform.gibPortalForm}
              gibDirectForm={platform.gibDirectForm}
              setTrendyolForm={platform.setTrendyolForm}
              setGibPortalForm={platform.setGibPortalForm}
              setGibDirectForm={platform.setGibDirectForm}
              onSaveTrendyol={() => void platform.saveTrendyol()}
              onSaveGibPortal={() => void platform.saveGibPortal()}
              onSaveGibDirect={() => void platform.saveGibDirect()}
              onOpenGibPortal={() => void platform.openGibPortal()}
              onOpenTrendyolPartner={platform.openTrendyolPartner}
              setMessage={platform.setMessage}
            />
          ) : null}
          {view === "saved-information" ? (
            <SavedInformationView
              trendyolForm={platform.trendyolForm}
              gibPortalForm={platform.gibPortalForm}
              gibDirectForm={platform.gibDirectForm}
              setTrendyolForm={platform.setTrendyolForm}
              setGibPortalForm={platform.setGibPortalForm}
              setGibDirectForm={platform.setGibDirectForm}
              setMessage={platform.setMessage}
              ownerUsername={session.username}
            />
          ) : null}
          {view === "operations" ? (
            <OperationsView
              jobs={snapshot.jobs}
              orders={snapshot.orders}
              drafts={snapshot.drafts}
              invoices={snapshot.invoices}
              onRetryInvoice={(id) => void platform.issueDrafts([id])}
            />
          ) : null}
          {view === "settings" ? (
            <SettingsView snapshot={snapshot} loadState={platform.loadState} apiAvailable={platform.apiAvailable} />
          ) : null}
        </PlatformShell>
      )}
    </AuthGate>
  );
}

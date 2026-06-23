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

const CANCELLED_MESSAGE = "Islem iptal edildi; canli sistemde hicbir sey degismedi.";

function confirmLiveAction(message: string) {
  if (typeof window === "undefined") return true;
  return window.confirm(`CANLI ISLEM — geri alinamaz.\n\n${message}\n\nDevam edilsin mi?`);
}

export function PlatformApp({ view }: PlatformAppProps) {
  const platform = usePlatformData();
  const { snapshot } = platform;

  const issueDraftsConfirmed = (ids: string[]) =>
    confirmLiveAction(`${ids.length} taslak icin GERCEK fatura kesilecek.`)
      ? platform.issueDrafts(ids)
      : Promise.resolve(CANCELLED_MESSAGE);

  const uploadPortalDraftsConfirmed = (ids: string[]) =>
    confirmLiveAction(`${ids.length} taslak GIB e-Arsiv portaline imza bekleyen belge olarak yuklenecek.`)
      ? platform.uploadPortalDrafts(ids)
      : Promise.resolve(CANCELLED_MESSAGE);

  const sendInvoiceToTrendyolConfirmed = (id: string) => {
    if (!confirmLiveAction("Fatura PDF'i Trendyol'a GERCEKTEN gonderilecek.")) return;
    void platform.sendInvoiceToTrendyol(id);
  };

  const promoteExternalInvoiceConfirmed = (id: string, sendToTrendyol: boolean) => {
    const message = sendToTrendyol
      ? "e-Arsiv faturasi arsive alinacak ve Trendyol'a GERCEKTEN gonderilecek."
      : "e-Arsiv faturasi GERCEKTEN arsive alinacak ve taslak fatura kesildi olarak isaretlenecek.";
    if (!confirmLiveAction(message)) return;
    void platform.promoteExternalInvoice(id, sendToTrendyol);
  };

  const applyGibExternalInvoicesConfirmed = (
    input: Parameters<typeof platform.applyGibExternalInvoices>[0]
  ) =>
    confirmLiveAction("Son donem imzali e-Arsiv kayitlari GERCEKTEN uygulanacak (arsive alma + gerekirse Trendyol gonderimi).")
      ? platform.applyGibExternalInvoices(input)
      : Promise.resolve(null);

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
          onClosePortalSession={() => void platform.logoutGibPortalSession()}
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
              ownerUsername={session.username}
              orders={snapshot.orders}
              selectedOrderId={platform.selectedOrderId}
              selectedOrder={platform.selectedOrder}
              detailState={platform.detailState}
              busyAction={platform.busyAction ?? ""}
              onSelectOrder={platform.setSelectedOrderId}
              onUploadPortalDrafts={uploadPortalDraftsConfirmed}
            />
          ) : null}
          {view === "invoices" ? (
            <InvoicesView
              drafts={snapshot.drafts}
              invoices={snapshot.invoices}
              externalInvoices={snapshot.externalInvoices}
              jobs={snapshot.jobs}
              settings={snapshot.settings}
              automationStatus={snapshot.automationStatus}
              busyAction={platform.busyAction}
              onApprove={platform.approveDrafts}
              onIssue={issueDraftsConfirmed}
              onUploadPortalDrafts={uploadPortalDraftsConfirmed}
              onImportExternalInvoices={(source, records) => void platform.importExternalInvoices(source, records)}
              onPreviewGibExternalInvoices={platform.previewGibExternalInvoices}
              onApplyGibExternalInvoices={applyGibExternalInvoicesConfirmed}
              onSyncTrendyolExternalInvoices={() => void platform.syncTrendyolExternalInvoices()}
              onRunAutomationNow={() => void platform.runAutomationNow()}
              onReconcileExternalInvoices={() => void platform.reconcileExternalInvoices()}
              onMatchExternalInvoice={(id, target) => void platform.matchExternalInvoice(id, target)}
              onPromoteExternalInvoice={promoteExternalInvoiceConfirmed}
              onUploadExternalInvoicePdf={(id, file) => void platform.uploadExternalInvoicePdf(id, file)}
              onSendInvoiceToTrendyol={sendInvoiceToTrendyolConfirmed}
              onCreateMonthlyArchive={platform.createMonthlyInvoiceArchive}
              onRefresh={() => void platform.refresh()}
              onOpenGibPortal={() => void platform.openGibPortal()}
              onCloseGibPortalSession={() => void platform.logoutGibPortalSession()}
            />
          ) : null}
          {view === "integrations" ? (
            <IntegrationsView
              ownerUsername={session.username}
              connections={snapshot.connections}
              settings={snapshot.settings}
              automationStatus={snapshot.automationStatus}
              busyAction={platform.busyAction}
              apiAvailable={platform.apiAvailable}
              trendyolForm={platform.trendyolForm}
              hepsiburadaForm={platform.hepsiburadaForm}
              hepsiburadaProducts={snapshot.hepsiburadaProducts}
              hepsiburadaOrderLines={snapshot.hepsiburadaOrderLines}
              gibPortalForm={platform.gibPortalForm}
              gibDirectForm={platform.gibDirectForm}
              setTrendyolForm={platform.setTrendyolForm}
              setHepsiburadaForm={platform.setHepsiburadaForm}
              setGibPortalForm={platform.setGibPortalForm}
              setGibDirectForm={platform.setGibDirectForm}
              onSaveTrendyol={() => void platform.saveTrendyol()}
              onSaveHepsiburada={() => void platform.saveHepsiburada()}
              onSaveHepsiburadaProduct={(input, id) => void platform.saveHepsiburadaProduct(input, id)}
              onUploadHepsiburadaCatalog={() => void platform.uploadHepsiburadaCatalog()}
              onCheckHepsiburadaCatalogStatus={(trackingId) => void platform.checkHepsiburadaCatalogStatus(trackingId)}
              onSyncHepsiburadaInventory={() => void platform.syncHepsiburadaInventory()}
              onUploadHepsiburadaPrices={() => void platform.uploadHepsiburadaPrices()}
              onUploadHepsiburadaStocks={() => void platform.uploadHepsiburadaStocks()}
              onSyncHepsiburadaOrders={() => void platform.syncHepsiburadaOrders()}
              onCreateHepsiburadaTestOrder={() => void platform.createHepsiburadaTestOrder()}
              onPackageHepsiburadaOrderLine={(id) => void platform.packageHepsiburadaOrderLine(id)}
              onSaveGibPortal={() => void platform.saveGibPortal()}
              onSaveGibDirect={() => void platform.saveGibDirect()}
              onSetReconstructedPdfFallback={(enabled) => void platform.saveReconstructedPdfFallback(enabled)}
              onOpenGibPortal={() => void platform.openGibPortal()}
              onCloseGibPortalSession={() => void platform.logoutGibPortalSession()}
              onOpenTrendyolPartner={platform.openTrendyolPartner}
              onRunAutomationNow={() => void platform.runAutomationNow()}
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
              onRetryInvoice={(id) => void issueDraftsConfirmed([id])}
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

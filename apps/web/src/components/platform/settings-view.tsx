"use client";

import { Database, FileArchive, PlugZap, ServerCog, ShieldCheck } from "lucide-react";
import { cx } from "../../lib/platform/format";
import type { LoadState } from "../../lib/platform/types";
import type { PlatformSnapshot } from "./use-platform-data";

interface SettingsViewProps {
  snapshot: PlatformSnapshot;
  loadState: LoadState;
  apiAvailable: boolean;
}

export function SettingsView({ snapshot, loadState, apiAvailable }: SettingsViewProps) {
  const settings = snapshot.settings;
  const connections = snapshot.connections;
  const isLiveMode = apiAvailable && settings.liveIntegrationsOnly === true;
  const integrationModeLabel = !apiAvailable ? "Backend bekleniyor" : isLiveMode ? "Canli entegrasyon" : "Canli mod kontrol ediliyor";

  return (
    <div className="view-stack">
      <section className="content-grid settings-grid">
        <article className="surface-panel">
          <div className="section-head">
            <div>
              <span className="micro-label">Runtime</span>
              <h2>Calisma modu</h2>
            </div>
            <ServerCog size={20} />
          </div>

          <div className="settings-list">
            <SettingRow
              icon={<ServerCog size={20} />}
              label="Backend API"
              value={apiAvailable ? "Bagli" : "Frontend statik; API URL bekleniyor"}
              tone={apiAvailable ? "success" : "warning"}
            />
            <SettingRow
              icon={<ShieldCheck size={20} />}
              label="Entegrasyon modu"
              value={integrationModeLabel}
              tone={apiAvailable && isLiveMode ? "success" : "warning"}
            />
            <SettingRow icon={<PlugZap size={20} />} label="Fatura saglayici" value={String(settings.invoiceProvider ?? "Bekleniyor")} tone="neutral" />
            <SettingRow icon={<Database size={20} />} label="Yukleme durumu" value={loadState === "loading" ? "Yenileniyor" : "Hazir"} tone={loadState === "error" ? "danger" : "success"} />
            <SettingRow icon={<FileArchive size={20} />} label="Saklama dizini" value={String(settings.storageDir ?? "./storage")} tone="neutral" />
          </div>
        </article>

        <article className="surface-panel">
          <div className="section-head">
            <div>
              <span className="micro-label">Saglik</span>
              <h2>Baglanti durumu</h2>
            </div>
            <PlugZap size={20} />
          </div>

          <div className="settings-list">
            <SettingRow
              icon={<PlugZap size={20} />}
              label="Trendyol"
              value={
                connections?.trendyol.configured
                  ? apiAvailable
                    ? `Bagli · ${connections.trendyol.source}`
                    : "Tarayicida taslak kayitli"
                  : "Canli bilgi bekleniyor"
              }
              tone={apiAvailable && connections?.trendyol.configured ? "success" : "warning"}
            />
            <SettingRow
              icon={<ShieldCheck size={20} />}
              label="GIB e-Arsiv Portal"
              value={
                connections?.gibPortal.configured
                  ? apiAvailable
                    ? `Bagli · ${connections.gibPortal.source}`
                    : "Tarayicida taslak kayitli"
                  : "Portal bilgisi bekleniyor"
              }
              tone={apiAvailable && connections?.gibPortal.configured ? "success" : "warning"}
            />
            <SettingRow
              icon={<ServerCog size={20} />}
              label="GIB direct"
              value={settings.gibDirectConfigured ? "Servis ve imza bilgileri tanimli" : "Canli yetki ve imza bekleniyor"}
              tone={settings.gibDirectConfigured ? "success" : "warning"}
            />
            <SettingRow
              icon={<Database size={20} />}
              label="Trendyol API"
              value={settings.trendyolConfigured ? "API bilgileri tanimli" : "API bilgileri henuz tanimli degil"}
              tone={settings.trendyolConfigured ? "success" : "warning"}
            />
          </div>
        </article>
      </section>

      <section className="surface-panel">
        <div className="section-head">
          <div>
            <span className="micro-label">Platform siniri</span>
            <h2>Ilk faz kararları</h2>
          </div>
        </div>
        <div className="decision-grid">
          <div>
            <strong>Yeni pazaryeri ve kargo firmalari</strong>
            <p>Frontend adapter katalogunda gorunur; canli backend cagri yapmaz.</p>
          </div>
          <div>
            <strong>Mevcut yetenekler</strong>
            <p>Trendyol sync, GIB portal, taslak onay, fatura kesme ve PDF akislari korunur.</p>
          </div>
          <div>
            <strong>Auth kapsami</strong>
            <p>Yerel operasyon paneli mantigi devam eder; role/auth modeli bu faza dahil degildir.</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function SettingRow({
  icon,
  label,
  value,
  tone
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "success" | "warning" | "danger" | "neutral";
}) {
  return (
    <div className="setting-row">
      <span className={cx("setting-icon", tone)}>{icon}</span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

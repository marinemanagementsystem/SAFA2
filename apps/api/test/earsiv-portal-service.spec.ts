import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EarsivPortalService } from "../src/earsiv-portal/earsiv-portal.service";
import type { GibPortalInvoiceDraftPayload } from "../src/earsiv-portal/portal-draft-payload";
import type { SettingsService } from "../src/settings/settings.service";

vi.mock("axios", () => ({
  default: {
    post: vi.fn()
  }
}));

const post = vi.mocked(axios.post);
const launchSessionKey = "session.gibPortal.launch";

function settings() {
  const store = new Map<string, unknown>();
  const readEncryptedSetting = vi.fn(async (key: string) => store.get(key)) as unknown as SettingsService["readEncryptedSetting"];
  const writeEncryptedSetting = vi.fn(async (key: string, value: unknown) => {
    store.set(key, value);
  }) as unknown as SettingsService["writeEncryptedSetting"];

  return {
    getGibPortalConnection: vi.fn(async () => ({
      username: "user",
      password: "pass",
      portalUrl: "https://earsivportal.efatura.gov.tr/intragiris.html"
    })),
    readEncryptedSetting,
    writeEncryptedSetting
  } satisfies Partial<SettingsService>;
}

const payload: GibPortalInvoiceDraftPayload = {
  faturaUuid: "11111111-1111-4111-8111-111111111111",
  belgeNumarasi: "",
  faturaTarihi: "11/05/2026",
  saat: "14:30:00",
  paraBirimi: "TRY",
  dovzTLkur: "0",
  faturaTipi: "SATIS",
  hangiTip: "5000/30000",
  vknTckn: "11111111111",
  aliciUnvan: "",
  aliciAdi: "Nihan",
  aliciSoyadi: "Ozdemir",
  binaAdi: "",
  binaNo: "",
  kapiNo: "",
  kasabaKoy: "",
  vergiDairesi: "",
  ulke: "Turkiye",
  bulvarcaddesokak: "Adres",
  mahalleSemtIlce: "",
  sehir: "Istanbul",
  postaKodu: "",
  tel: "",
  fax: "",
  eposta: "",
  websitesi: "",
  komisyonOrani: 0,
  navlunOrani: 0,
  hammaliyeOrani: 0,
  nakliyeOrani: 0,
  komisyonTutari: "0",
  navlunTutari: "0",
  hammaliyeTutari: "0",
  nakliyeTutari: "0",
  komisyonKDVOrani: 0,
  navlunKDVOrani: 0,
  hammaliyeKDVOrani: 0,
  nakliyeKDVOrani: 0,
  komisyonKDVTutari: "0",
  navlunKDVTutari: "0",
  hammaliyeKDVTutari: "0",
  nakliyeKDVTutari: "0",
  gelirVergisiOrani: 0,
  bagkurTevkifatiOrani: 0,
  gelirVergisiTevkifatiTutari: "0",
  bagkurTevkifatiTutari: "0",
  halRusumuOrani: 0,
  ticaretBorsasiOrani: 0,
  milliSavunmaFonuOrani: 0,
  digerOrani: 0,
  halRusumuTutari: "0",
  ticaretBorsasiTutari: "0",
  milliSavunmaFonuTutari: "0",
  digerTutari: "0",
  halRusumuKDVOrani: 0,
  ticaretBorsasiKDVOrani: 0,
  milliSavunmaFonuKDVOrani: 0,
  digerKDVOrani: 0,
  halRusumuKDVTutari: "0",
  ticaretBorsasiKDVTutari: "0",
  milliSavunmaFonuKDVTutari: "0",
  digerKDVTutari: "0",
  iadeTable: [],
  ozelMatrahTutari: "0",
  ozelMatrahOrani: 0,
  ozelMatrahVergiTutari: "0.00",
  vergiCesidi: " ",
  malHizmetTable: [
    {
      malHizmet: "Urun",
      miktar: 1,
      birim: "C62",
      birimFiyat: "100.00",
      fiyat: "100.00",
      iskontoArttm: "Iskonto",
      iskontoOrani: 0,
      iskontoTutari: "0.00",
      iskontoNedeni: "",
      malHizmetTutari: "100.00",
      kdvOrani: "20",
      vergiOrani: 0,
      kdvTutari: "20.00",
      vergininKdvTutari: "0.00"
    }
  ],
  tip: "Iskonto",
  matrah: "100.00",
  malhizmetToplamTutari: "100.00",
  toplamIskonto: "0.00",
  hesaplanankdv: "20.00",
  vergilerToplami: "20.00",
  vergilerDahilToplamTutar: "120.00",
  toplamMasraflar: "0",
  odenecekTutar: "120.00",
  not: "",
  siparisNumarasi: "11149505395",
  siparisTarihi: "",
  irsaliyeNumarasi: "",
  irsaliyeTarihi: "",
  fisNo: "",
  fisTarihi: "",
  fisSaati: " ",
  fisTipi: " ",
  zRaporNo: "",
  okcSeriNo: ""
};

describe("EarsivPortalService", () => {
  beforeEach(() => {
    post.mockReset();
  });

  it("caches fresh tokenized portal launch sessions", async () => {
    const settingsMock = settings();
    post.mockResolvedValueOnce({
      status: 200,
      data: {
        token: "portal-token",
        redirectUrl: "/intragiris.html"
      }
    });

    const service = new EarsivPortalService(settingsMock as unknown as SettingsService);
    const result = await service.openSession();

    expect(result).toMatchObject({
      portalUrl: "https://earsivportal.efatura.gov.tr/intragiris.html",
      tokenReceived: true,
      source: "fresh"
    });
    expect(result.launchUrl).toContain("token=portal-token");
    expect(settingsMock.writeEncryptedSetting).toHaveBeenCalledWith(
      launchSessionKey,
      expect.objectContaining({
        launchUrl: expect.stringContaining("token=portal-token"),
        token: "portal-token",
        source: "fresh"
      })
    );
  });

  it("logs out a cached portal token and expires the local launch session", async () => {
    const settingsMock = settings();
    vi.mocked(settingsMock.readEncryptedSetting).mockResolvedValueOnce({
      portalUrl: "https://earsivportal.efatura.gov.tr/intragiris.html",
      launchUrl: "https://earsivportal.efatura.gov.tr/intragiris.html?token=cached-token",
      token: "cached-token",
      tokenReceived: true,
      openedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      source: "fresh",
      message: "cached"
    });
    post.mockResolvedValueOnce({ status: 200, data: { data: "logout ok" } });

    const service = new EarsivPortalService(settingsMock as unknown as SettingsService);
    const result = await service.logoutSession();

    expect(result).toMatchObject({
      attempted: true,
      ok: true,
      source: "cached-token"
    });

    const body = new URLSearchParams(String(post.mock.calls[0][1]));
    expect(body.get("assoscmd")).toBe("logout");
    expect(body.get("token")).toBe("cached-token");
    expect(settingsMock.writeEncryptedSetting).toHaveBeenCalledWith(
      launchSessionKey,
      expect.objectContaining({
        launchUrl: "",
        tokenReceived: false
      })
    );
  });

  it("falls back to anologin logout when GIB rejects logout command", async () => {
    const settingsMock = settings();
    vi.mocked(settingsMock.readEncryptedSetting).mockResolvedValueOnce({
      portalUrl: "https://earsivportal.efatura.gov.tr/intragiris.html",
      launchUrl: "https://earsivportal.efatura.gov.tr/intragiris.html?token=fallback-token",
      tokenReceived: true,
      openedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      source: "fresh",
      message: "cached"
    });
    post
      .mockResolvedValueOnce({ status: 200, data: { error: true, messages: [{ text: "unsupported" }] } })
      .mockResolvedValueOnce({ status: 200, data: { data: "logout ok" } });

    const service = new EarsivPortalService(settingsMock as unknown as SettingsService);
    const result = await service.logoutSession();

    expect(result.ok).toBe(true);
    expect(new URLSearchParams(String(post.mock.calls[0][1])).get("assoscmd")).toBe("logout");
    expect(new URLSearchParams(String(post.mock.calls[1][1])).get("assoscmd")).toBe("anologin");
    expect(new URLSearchParams(String(post.mock.calls[1][1])).get("token")).toBe("fallback-token");
  });

  it("reports when there is no SAFA-owned portal token to close", async () => {
    const settingsMock = settings();
    vi.mocked(settingsMock.readEncryptedSetting).mockResolvedValueOnce(undefined);

    const service = new EarsivPortalService(settingsMock as unknown as SettingsService);
    const result = await service.logoutSession();

    expect(result).toMatchObject({
      attempted: false,
      ok: false,
      source: "none"
    });
    expect(post).not.toHaveBeenCalled();
    expect(settingsMock.writeEncryptedSetting).toHaveBeenCalledWith(
      launchSessionKey,
      expect.objectContaining({
        launchUrl: "",
        tokenReceived: false
      })
    );
  });

  it("uses a valid cached portal launch session without a new login", async () => {
    const settingsMock = settings();
    vi.mocked(settingsMock.readEncryptedSetting).mockResolvedValueOnce({
      portalUrl: "https://earsivportal.efatura.gov.tr/intragiris.html",
      launchUrl: "https://earsivportal.efatura.gov.tr/intragiris.html?token=cached",
      tokenReceived: true,
      openedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      source: "fresh",
      message: "cached"
    });

    const service = new EarsivPortalService(settingsMock as unknown as SettingsService);
    const result = await service.openSession();

    expect(result).toMatchObject({
      launchUrl: "https://earsivportal.efatura.gov.tr/intragiris.html?token=cached",
      source: "cached"
    });
    expect(post).not.toHaveBeenCalled();
  });

  it("ignores expired cached portal launch sessions", async () => {
    const settingsMock = settings();
    vi.mocked(settingsMock.readEncryptedSetting).mockResolvedValueOnce({
      portalUrl: "https://earsivportal.efatura.gov.tr/intragiris.html",
      launchUrl: "https://earsivportal.efatura.gov.tr/intragiris.html?token=expired",
      tokenReceived: true,
      openedAt: new Date(Date.now() - 120_000).toISOString(),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      source: "fresh",
      message: "expired"
    });
    post.mockResolvedValueOnce({
      status: 200,
      data: {
        token: "fresh-token",
        redirectUrl: "/intragiris.html"
      }
    });

    const service = new EarsivPortalService(settingsMock as unknown as SettingsService);
    const result = await service.openSession();

    expect(result.source).toBe("fresh");
    expect(result.launchUrl).toContain("token=fresh-token");
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("returns a cached launch link when GIB reports an active concurrent session", async () => {
    const settingsMock = settings();
    vi.mocked(settingsMock.readEncryptedSetting)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        portalUrl: "https://earsivportal.efatura.gov.tr/intragiris.html",
        launchUrl: "https://earsivportal.efatura.gov.tr/intragiris.html?token=cached-after-conflict",
        tokenReceived: true,
        openedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        source: "fresh",
        message: "cached"
      });
    post.mockResolvedValueOnce({
      status: 200,
      data: {
        error: true,
        messages: [{ text: "Birden fazla oturum acilamaz. Lutfen Guvenli Cikis yapin." }]
      }
    });

    const service = new EarsivPortalService(settingsMock as unknown as SettingsService);
    const result = await service.openSession();

    expect(result).toMatchObject({
      launchUrl: "https://earsivportal.efatura.gov.tr/intragiris.html?token=cached-after-conflict",
      source: "cached",
      lastPortalMessage: "Birden fazla oturum acilamaz. Lutfen Guvenli Cikis yapin."
    });
  });

  it("returns a clear error when GIB reports an active session and there is no cached link", async () => {
    const settingsMock = settings();
    vi.mocked(settingsMock.readEncryptedSetting).mockResolvedValue(undefined);
    post.mockResolvedValueOnce({
      status: 200,
      data: {
        error: true,
        messages: [{ text: "Birden fazla oturum acilamaz. Lutfen Guvenli Cikis yapin." }]
      }
    });

    const service = new EarsivPortalService(settingsMock as unknown as SettingsService);
    await expect(service.openSession()).rejects.toThrow("SAFA'da kullanilabilir tokenli link yok");
  });

  it("collects issued invoice rows across supported portal list commands", async () => {
    post
      .mockResolvedValueOnce({ status: 200, data: { token: "portal-token" } })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: [
            {
              uuid: "11111111-1111-4111-8111-111111111111",
              faturaNo: "TMP2026001",
              durum: "Onaylanmadı"
            }
          ]
        }
      })
      .mockResolvedValueOnce({ status: 200, data: { data: [] } })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: [
            {
              uuid: "22222222-2222-4222-8222-222222222222",
              faturaNo: "GIB2026001",
              durum: "Onaylandı"
            }
          ]
        }
      });

    const service = new EarsivPortalService(settings() as unknown as SettingsService);
    const result = await service.listIssuedInvoices(new Date("2026-05-01T00:00:00.000Z"), new Date("2026-05-15T00:00:00.000Z"));

    expect(result).toHaveLength(2);
    expect(result.map((row) => row.faturaNo)).toEqual(["TMP2026001", "GIB2026001"]);
    expect(result[1]).toMatchObject({
      kaynakKomut: "EARSIV_PORTAL_ADIMA_KESILEN_BELGELERI_GETIR",
      kaynakSayfa: "RG_ALICI_TASLAKLAR"
    });
    expect(post).toHaveBeenCalledTimes(4);
  });

  it("lets the 5000/30000 portal create request generate its own ETTN", async () => {
    post
      .mockResolvedValueOnce({ status: 200, data: { token: "portal-token" } })
      .mockResolvedValueOnce({ status: 200, data: { data: "Faturanız başarıyla oluşturulmuştur." } });

    const service = new EarsivPortalService(settings() as unknown as SettingsService);
    const result = await service.createInvoiceDrafts([{ localDraftId: "draft-1", payload }]);

    expect(result[0]).toMatchObject({
      ok: true
    });
    expect(result[0].uuid).toBeUndefined();
    expect(post).toHaveBeenCalledTimes(2);

    const createBody = new URLSearchParams(String(post.mock.calls[1][1]));
    const createPayload = JSON.parse(createBody.get("jp") ?? "{}") as Partial<GibPortalInvoiceDraftPayload>;
    expect(createBody.get("cmd")).toBe("EARSIV_PORTAL_FATURA_OLUSTUR");
    expect(createPayload.faturaUuid).toBeUndefined();
  });

  it("gets the portal-issued ETTN before creating non-5000/30000 draft invoices", async () => {
    post
      .mockResolvedValueOnce({ status: 200, data: { token: "portal-token" } })
      .mockResolvedValueOnce({ status: 200, data: { data: "6f0fdc0f-d6a7-4d1a-b4dd-ea1fd9d2da53" } })
      .mockResolvedValueOnce({ status: 200, data: { data: "Faturanız başarıyla oluşturulmuştur." } });

    const service = new EarsivPortalService(settings() as unknown as SettingsService);
    const result = await service.createInvoiceDrafts([
      { localDraftId: "draft-1", payload: { ...payload, faturaTipi: "5000/30000", hangiTip: "Buyuk" } }
    ]);

    expect(result[0]).toMatchObject({
      ok: true,
      uuid: "6f0fdc0f-d6a7-4d1a-b4dd-ea1fd9d2da53",
      attemptedUuid: "6f0fdc0f-d6a7-4d1a-b4dd-ea1fd9d2da53"
    });

    const uuidBody = new URLSearchParams(String(post.mock.calls[1][1]));
    expect(uuidBody.get("cmd")).toBe("EARSIV_PORTAL_UUID_GETIR");
    expect(uuidBody.has("pageName")).toBe(false);

    const createBody = new URLSearchParams(String(post.mock.calls[2][1]));
    const createPayload = JSON.parse(createBody.get("jp") ?? "{}") as GibPortalInvoiceDraftPayload;
    expect(createBody.get("cmd")).toBe("EARSIV_PORTAL_FATURA_OLUSTUR");
    expect(createPayload.faturaUuid).toBe("6f0fdc0f-d6a7-4d1a-b4dd-ea1fd9d2da53");
  });
});

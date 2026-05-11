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

function settings() {
  return {
    getGibPortalConnection: vi.fn(async () => ({
      username: "user",
      password: "pass",
      portalUrl: "https://earsivportal.efatura.gov.tr/intragiris.html"
    }))
  } satisfies Partial<SettingsService>;
}

const payload: GibPortalInvoiceDraftPayload = {
  faturaUuid: "11111111-1111-4111-8111-111111111111",
  belgeNumarasi: "",
  faturaTarihi: "11/05/2026",
  saat: "14:30:00",
  paraBirimi: "TRY",
  dovzTLkur: 0,
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
  iadeTable: [],
  ozelMatrahTutari: 0,
  ozelMatrahOrani: 0,
  ozelMatrahVergiTutari: 0,
  vergiCesidi: "",
  malHizmetTable: [
    {
      malHizmet: "Urun",
      miktar: 1,
      birim: "C62",
      birimFiyat: 100,
      fiyat: 100,
      iskontoArttm: "Iskonto",
      iskontoOrani: 0,
      iskontoTutari: 0,
      iskontoNedeni: "",
      malHizmetTutari: 100,
      kdvOrani: 20,
      kdvTutari: 20,
      tevkifatKodu: 0,
      ozelMatrahNedeni: 0,
      ozelMatrahTutari: 0,
      gtip: ""
    }
  ],
  tip: "Iskonto",
  matrah: 100,
  malhizmetToplamTutari: 100,
  toplamIskonto: 0,
  hesaplanankdv: 20,
  vergilerToplami: 20,
  vergilerDahilToplamTutar: 120,
  toplamMasraflar: 0,
  odenecekTutar: 120,
  not: "",
  siparisNumarasi: "11149505395",
  siparisTarihi: "",
  irsaliyeNumarasi: "",
  irsaliyeTarihi: "",
  fisNo: "",
  fisTarihi: "",
  fisSaati: "",
  fisTipi: "",
  zRaporNo: "",
  okcSeriNo: ""
};

describe("EarsivPortalService", () => {
  beforeEach(() => {
    post.mockReset();
  });

  it("gets the portal-issued ETTN before creating a draft invoice", async () => {
    post
      .mockResolvedValueOnce({ status: 200, data: { token: "portal-token" } })
      .mockResolvedValueOnce({ status: 200, data: { data: "6f0fdc0f-d6a7-4d1a-b4dd-ea1fd9d2da53" } })
      .mockResolvedValueOnce({ status: 200, data: { data: "Faturanız başarıyla oluşturulmuştur." } });

    const service = new EarsivPortalService(settings() as unknown as SettingsService);
    const result = await service.createInvoiceDrafts([{ localDraftId: "draft-1", payload }]);

    expect(result[0]).toMatchObject({
      ok: true,
      uuid: "6f0fdc0f-d6a7-4d1a-b4dd-ea1fd9d2da53"
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

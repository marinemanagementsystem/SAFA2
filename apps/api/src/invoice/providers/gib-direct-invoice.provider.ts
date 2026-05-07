import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ArchiveInvoicePayload, ArchiveInvoiceResult, InvoiceProvider } from "../invoice-provider";
import { buildGibDraftInvoiceXml } from "../ubl/gib-draft-invoice-xml";

const REQUIRED_GIB_ENV = [
  "GIB_EARSIV_WSDL_URL",
  "GIB_EARSIV_SERVICE_URL",
  "GIB_EARSIV_TAX_ID",
  "GIB_EARSIV_CERT_PATH",
  "GIB_EARSIV_CERT_PASSWORD"
] as const;

@Injectable()
export class GibDirectInvoiceProvider implements InvoiceProvider {
  async issueArchiveInvoice(payload: ArchiveInvoicePayload): Promise<ArchiveInvoiceResult> {
    const missing = REQUIRED_GIB_ENV.filter((key) => !process.env[key]);

    if (missing.length > 0) {
      throw new ServiceUnavailableException({
        message: "GIB direct e-Arsiv integration is not ready.",
        detail:
          "Ozel entegrator kullanilmiyor. Canli fatura icin GIB test/onay, servis adresi ve mali muhur/NES imzalama bilgileri tamamlanmali.",
        missing,
        mode: process.env.GIB_EARSIV_ENV ?? "test"
      });
    }

    const draftXml = buildGibDraftInvoiceXml(payload);

    throw new ServiceUnavailableException({
      message: "GIB direct e-Arsiv SOAP submit is not implemented yet.",
      detail:
        "UBL taslak XML olusturuldu; sonraki adim GIB teknik kilavuzundaki guncel web servis metoduna gore imzalama ve SOAP gonderimini baglamak.",
      draftXmlBytes: Buffer.byteLength(draftXml, "utf8"),
      wsdlUrl: process.env.GIB_EARSIV_WSDL_URL,
      serviceUrl: process.env.GIB_EARSIV_SERVICE_URL
    });
  }
}

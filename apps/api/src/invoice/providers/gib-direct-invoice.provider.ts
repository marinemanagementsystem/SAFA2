import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { SettingsService } from "../../settings/settings.service";
import { ArchiveInvoicePayload, ArchiveInvoiceResult, InvoiceProvider } from "../invoice-provider";
import { buildInvoicePdf } from "../pdf/simple-invoice-pdf";
import { buildGibDraftInvoiceXml } from "../ubl/gib-draft-invoice-xml";
import { signXmlWithExternalCommand, submitSignedXmlToGib } from "./gib-direct-runtime";

function sha256(content: string | Buffer) {
  return createHash("sha256").update(content).digest("hex");
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      response: "response" in error ? (error as { response?: unknown }).response : undefined
    };
  }

  return { message: String(error) };
}

async function prepareGibTrace(invoiceNumber: string) {
  const root = path.resolve(process.env.STORAGE_DIR ?? "./storage", "gib-direct", invoiceNumber);
  await fs.mkdir(root, { recursive: true });
  return root;
}

async function writeGibTrace(root: string, files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(root, name), content, "utf8");
  }
}

@Injectable()
export class GibDirectInvoiceProvider implements InvoiceProvider {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  async issueArchiveInvoice(payload: ArchiveInvoicePayload): Promise<ArchiveInvoiceResult> {
    const connection = await this.settings.getGibDirectConnection();
    const readiness = await this.settings.gibDirectReadiness();

    if (!connection || !readiness.ready) {
      throw new ServiceUnavailableException({
        message: "GIB direct canli fatura kesimi hazir degil.",
        detail: readiness.message,
        missing: readiness.missing,
        mode: readiness.mode
      });
    }

    const invoiceDate = new Date();
    const invoiceNumber = await this.settings.reserveGibDirectInvoiceNumber(connection);
    const uuid = randomUUID();
    const traceRoot = await prepareGibTrace(invoiceNumber);
    const unsignedXml = buildGibDraftInvoiceXml(payload, {
      invoiceId: invoiceNumber,
      uuid,
      issueDate: invoiceDate,
      sellerTaxId: connection.taxId,
      unitCode: connection.unitCode,
      defaultBuyerTckn: connection.defaultBuyerTckn
    });

    try {
      await writeGibTrace(traceRoot, { "unsigned.xml": unsignedXml });
      const signature = await signXmlWithExternalCommand({ xml: unsignedXml, connection, invoiceNumber, uuid });
      const submit = await submitSignedXmlToGib({
        xml: unsignedXml,
        signedXml: signature.signedXml,
        connection,
        invoiceNumber,
        uuid
      });

      await writeGibTrace(traceRoot, {
        "signed.xml": signature.signedXml,
        "soap-request-unsigned.xml": submit.unsignedSoapXml,
        "soap-request-signed.xml": submit.signedSoapXml,
        "gib-response.xml": submit.responseText,
        "manifest.json": JSON.stringify(
          {
            invoiceNumber,
            uuid,
            providerInvoiceId: submit.providerInvoiceId,
            providerInvoiceIdSource: submit.providerInvoiceIdSource,
            environment: connection.environment,
            taxId: connection.taxId,
            serviceUrl: connection.serviceUrl,
            soapAction: connection.soapAction,
            httpStatus: submit.httpStatus,
            issuedAt: invoiceDate.toISOString(),
            hashes: {
              unsignedXml: sha256(unsignedXml),
              signedXml: sha256(signature.signedXml),
              unsignedSoapXml: sha256(submit.unsignedSoapXml),
              signedSoapXml: sha256(submit.signedSoapXml),
              gibResponseXml: sha256(submit.responseText)
            },
            commands: {
              documentSigner: signature.command,
              soapSigner: submit.soapSigner
            }
          },
          null,
          2
        )
      });

      return {
        provider: "gib-direct",
        providerInvoiceId: submit.providerInvoiceId,
        invoiceNumber,
        invoiceDate,
        pdf: buildInvoicePdf(payload, {
          title: "e-Arşiv Fatura",
          documentNumber: invoiceNumber,
          documentDate: invoiceDate
        })
      };
    } catch (error) {
      await writeGibTrace(traceRoot, {
        "error.json": JSON.stringify(
          {
            invoiceNumber,
            uuid,
            environment: connection.environment,
            failedAt: new Date().toISOString(),
            unsignedXmlHash: sha256(unsignedXml),
            error: serializeError(error)
          },
          null,
          2
        )
      }).catch(() => undefined);

      throw error;
    }
  }
}

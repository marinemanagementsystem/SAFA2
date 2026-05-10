import { ServiceUnavailableException } from "@nestjs/common";
import axios from "axios";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { GibDirectConnection } from "../../settings/connection-types";

const execFileAsync = promisify(execFile);

interface SignInput {
  xml: string;
  connection: GibDirectConnection;
  invoiceNumber: string;
  uuid: string;
}

interface SubmitInput extends SignInput {
  signedXml: string;
}

export interface ExternalCommandTrace {
  commandHash: string;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export interface SignedXmlResult {
  signedXml: string;
  command: ExternalCommandTrace;
}

interface SubmitResult {
  providerInvoiceId: string;
  providerInvoiceIdSource: "gib-response" | "invoice-uuid";
  responseText: string;
  unsignedSoapXml: string;
  signedSoapXml: string;
  soapSigner: ExternalCommandTrace;
  httpStatus: number;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cdata(value: string) {
  return `<![CDATA[${value.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]>`;
}

function fillTemplate(template: string, input: SubmitInput) {
  const replacements: Record<string, string> = {
    signedXml: input.signedXml,
    signedXmlEscaped: xmlEscape(input.signedXml),
    signedXmlCdata: cdata(input.signedXml),
    signedXmlBase64: Buffer.from(input.signedXml, "utf8").toString("base64"),
    unsignedXmlBase64: Buffer.from(input.xml, "utf8").toString("base64"),
    invoiceNumber: input.invoiceNumber,
    uuid: input.uuid,
    taxId: input.connection.taxId,
    environment: input.connection.environment
  };

  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_, key: string) => replacements[key] ?? "");
}

async function readTemplate(connection: GibDirectConnection) {
  if (connection.soapBodyTemplate?.trim()) return connection.soapBodyTemplate;
  if (connection.soapBodyTemplatePath?.trim()) return fs.readFile(connection.soapBodyTemplatePath, "utf8");
  throw new ServiceUnavailableException({
    message: "GIB direct SOAP sablonu yok.",
    detail:
      "GIB teknik kilavuzundaki guncel web servis metoduna gore SOAP govde sablonu girilmeli. Sablonda {signedXmlBase64}, {invoiceNumber}, {uuid}, {taxId} alanlari kullanilabilir."
  });
}

async function writeTempXml(invoiceNumber: string, xml: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `safa-gib-${invoiceNumber}-`));
  const inputPath = path.join(dir, "unsigned.xml");
  const outputPath = path.join(dir, "signed.xml");
  await fs.writeFile(inputPath, xml, "utf8");
  return { dir, inputPath, outputPath };
}

function buildSignerCommand(template: string, input: SignInput, paths: { inputPath: string; outputPath: string }) {
  if (!template.includes("{input}") || !template.includes("{output}")) {
    throw new ServiceUnavailableException({
      message: "GIB direct imzalama komutu eksik.",
      detail: "Imzalama komutu mutlaka {input} ve {output} yer tutucularini icermeli."
    });
  }

  const replacements: Record<string, string> = {
    input: paths.inputPath,
    output: paths.outputPath,
    invoiceNumber: input.invoiceNumber,
    uuid: input.uuid,
    taxId: input.connection.taxId
  };

  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_, key: string) => shellQuote(replacements[key] ?? ""));
}

function commandHash(template: string) {
  return createHash("sha256").update(template).digest("hex");
}

function trimCommandOutput(value: unknown) {
  return String(value ?? "").slice(-20_000);
}

async function runXmlCommand(input: SignInput, xml: string, template: string, label: string) {
  const paths = await writeTempXml(input.invoiceNumber, xml);
  const command = buildSignerCommand(template, input, paths);
  const startedAt = Date.now();

  try {
    const result = await execFileAsync("/bin/sh", ["-lc", command], {
      timeout: Number(process.env.GIB_EARSIV_SIGN_TIMEOUT_MS ?? 120_000),
      maxBuffer: 10 * 1024 * 1024
    });
    const outputXml = await fs.readFile(paths.outputPath, "utf8");
    return {
      outputXml,
      command: {
        commandHash: commandHash(template),
        durationMs: Date.now() - startedAt,
        stdout: trimCommandOutput(result.stdout),
        stderr: trimCommandOutput(result.stderr)
      } satisfies ExternalCommandTrace
    };
  } catch (error) {
    if (error instanceof ServiceUnavailableException) throw error;
    const message = error instanceof Error ? error.message : "Bilinmeyen imzalama hatasi";
    throw new ServiceUnavailableException({
      message: `${label} komutu basarisiz.`,
      detail: message
    });
  } finally {
    await fs.rm(paths.dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function assertSignedXml(xml: string) {
  if (/<(?:[A-Za-z0-9_-]+:)?Signature[\s>]/.test(xml)) return;

  throw new ServiceUnavailableException({
    message: "GIB direct imzalama sonucu gecersiz.",
    detail:
      "Imzalama komutu cikti uretmis gorunuyor ancak XML icinde Signature elemani yok. Mali muhur/NES/HSM imzalama aracinin XAdES/UBL imzali XML urettigini kontrol edin."
  });
}

export async function signXmlWithExternalCommand(input: SignInput) {
  const result = await runXmlCommand(input, input.xml, input.connection.signerCommand, "GIB direct mali muhur/NES imzalama");
  assertSignedXml(result.outputXml);
  return {
    signedXml: result.outputXml,
    command: result.command
  } satisfies SignedXmlResult;
}

function assertSignedSoapEnvelope(xml: string) {
  if (!/<(?:[A-Za-z0-9_-]+:)?Security[\s>]/.test(xml)) {
    throw new ServiceUnavailableException({
      message: "GIB SOAP/WSS imzalama sonucu gecersiz.",
      detail: "SOAP zarfi icinde WS-Security Security elemani yok. GIB direct servis icin Timestamp ve Body mali muhur/NES ile imzalanmali."
    });
  }

  if (!/<(?:[A-Za-z0-9_-]+:)?Timestamp[\s>]/.test(xml)) {
    throw new ServiceUnavailableException({
      message: "GIB SOAP/WSS imzalama sonucu gecersiz.",
      detail: "SOAP zarfi icinde WSS Timestamp elemani yok."
    });
  }

  if (!/<(?:[A-Za-z0-9_-]+:)?Signature[\s>]/.test(xml)) {
    throw new ServiceUnavailableException({
      message: "GIB SOAP/WSS imzalama sonucu gecersiz.",
      detail: "SOAP zarfi icinde XML Signature elemani yok."
    });
  }
}

async function signSoapEnvelopeWithExternalCommand(input: SubmitInput, unsignedSoapXml: string) {
  const result = await runXmlCommand(input, unsignedSoapXml, input.connection.soapSignerCommand, "GIB SOAP/WSS imzalama");
  assertSignedSoapEnvelope(result.outputXml);
  return {
    signedSoapXml: result.outputXml,
    command: result.command
  };
}

async function buildHttpsAgent(connection: GibDirectConnection) {
  if (connection.clientPfxPath) {
    return new https.Agent({
      pfx: await fs.readFile(connection.clientPfxPath),
      passphrase: connection.clientCertPassword
    });
  }

  if (connection.clientCertPath && connection.clientKeyPath) {
    return new https.Agent({
      cert: await fs.readFile(connection.clientCertPath),
      key: await fs.readFile(connection.clientKeyPath),
      passphrase: connection.clientCertPassword
    });
  }

  return undefined;
}

function extract(text: string, names: string[]) {
  for (const name of names) {
    const pattern = new RegExp(`<(?:[A-Za-z0-9_-]+:)?${name}[^>]*>([^<]+)</(?:[A-Za-z0-9_-]+:)?${name}>`, "i");
    const match = text.match(pattern);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return undefined;
}

function assertSoapSuccess(status: number, body: string) {
  const fault = extract(body, ["faultstring", "FaultString", "message", "hata", "error"]);
  if (!body.trim()) {
    throw new ServiceUnavailableException({
      message: "GIB direct servis bos cevap dondu.",
      detail: `HTTP ${status}`,
      status
    });
  }

  if (status < 200 || status >= 300 || /<(?:[A-Za-z0-9_-]+:)?Fault[\s>]/i.test(body)) {
    throw new ServiceUnavailableException({
      message: "GIB direct servis gonderimi basarisiz.",
      detail: fault ?? `HTTP ${status}`,
      status
    });
  }
}

export async function submitSignedXmlToGib(input: SubmitInput): Promise<SubmitResult> {
  const template = await readTemplate(input.connection);
  const unsignedSoapXml = fillTemplate(template, input);
  const soapSignature = await signSoapEnvelopeWithExternalCommand(input, unsignedSoapXml);
  const httpsAgent = await buildHttpsAgent(input.connection);
  const response = await axios.post<string>(input.connection.serviceUrl, soapSignature.signedSoapXml, {
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      ...(input.connection.soapAction ? { SOAPAction: input.connection.soapAction } : {})
    },
    httpsAgent,
    responseType: "text",
    transformResponse: (value) => value,
    timeout: Number(process.env.GIB_EARSIV_SUBMIT_TIMEOUT_MS ?? 60_000),
    validateStatus: () => true
  });

  const responseText = String(response.data ?? "");
  assertSoapSuccess(response.status, responseText);
  const responseInvoiceId = extract(responseText, ["providerInvoiceId", "invoiceId", "belgeNo", "faturaNo", "documentId", "uuid", "ettn", "ETTN"]);

  return {
    providerInvoiceId: responseInvoiceId ?? input.uuid,
    providerInvoiceIdSource: responseInvoiceId ? "gib-response" : "invoice-uuid",
    responseText,
    unsignedSoapXml,
    signedSoapXml: soapSignature.signedSoapXml,
    soapSigner: soapSignature.command,
    httpStatus: response.status
  };
}

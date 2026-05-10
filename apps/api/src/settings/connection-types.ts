export interface TrendyolConnection {
  sellerId: string;
  apiKey: string;
  apiSecret: string;
  userAgent: string;
  baseUrl: string;
  storefrontCode: string;
  lookbackDays: number;
}

export interface GibPortalConnection {
  username: string;
  password: string;
  portalUrl: string;
}

export type GibDirectEnvironment = "test" | "prod";
export type GibDirectSignerMode = "external-command";

export interface GibDirectConnection {
  environment: GibDirectEnvironment;
  taxId: string;
  serviceUrl: string;
  wsdlUrl?: string;
  soapAction?: string;
  soapBodyTemplate?: string;
  soapBodyTemplatePath?: string;
  signerMode: GibDirectSignerMode;
  signerCommand: string;
  soapSignerCommand: string;
  invoicePrefix: string;
  nextInvoiceSequence: number;
  unitCode: string;
  defaultBuyerTckn: string;
  testAccessConfirmed: boolean;
  productionAccessConfirmed: boolean;
  authorizationReference?: string;
  clientCertPath?: string;
  clientKeyPath?: string;
  clientPfxPath?: string;
  clientCertPassword?: string;
}

export interface StoredSecret<T> {
  encrypted: true;
  version: 1;
  iv: string;
  tag: string;
  data: string;
  updatedAt: string;
}

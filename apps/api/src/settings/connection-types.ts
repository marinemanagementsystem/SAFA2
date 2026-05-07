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

export interface StoredSecret<T> {
  encrypted: true;
  version: 1;
  iv: string;
  tag: string;
  data: string;
  updatedAt: string;
}

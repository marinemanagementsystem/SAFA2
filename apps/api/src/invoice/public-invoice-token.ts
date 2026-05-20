import { createHash, randomBytes } from "node:crypto";

export function createPublicInvoiceToken() {
  return randomBytes(32).toString("base64url");
}

export function hashPublicInvoiceToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function publicInvoiceUrl(token: string) {
  const configured = process.env.PUBLIC_API_BASE_URL?.trim().replace(/\/+$/, "");
  const baseUrl = configured || "http://localhost:4000/api";
  return `${baseUrl}/public/invoices/${token}.pdf`;
}

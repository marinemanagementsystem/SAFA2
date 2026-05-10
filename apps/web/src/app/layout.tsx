import type { Metadata } from "next";
import { DM_Sans, Instrument_Serif } from "next/font/google";
import { Suspense } from "react";
import { RouteConsoleLogger } from "../components/route-console-logger";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans"
});

const instrument = Instrument_Serif({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-serif",
  weight: "400"
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://safa-8f76e.web.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "SAFA — Commerce Operations Platform",
  description: "Pazaryeri siparisleri, e-Arsiv faturalar, PDF gonderimleri ve entegrasyon sagligi icin modern operasyon platformu.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "SAFA — Commerce Operations Platform",
    description: "Trendyol siparislerini izleyin, e-Arsiv taslaklarini onaylayin ve yeni pazaryeri/kargo adaptorlerine hazir kalin.",
    url: siteUrl,
    siteName: "SAFA",
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "SAFA — Commerce Operations Platform",
    description: "Pazaryeri ve e-Arsiv operasyon merkezi."
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr" data-theme="light">
      <body className={`${dmSans.variable} ${instrument.variable}`}>
        <Suspense fallback={null}>
          <RouteConsoleLogger />
        </Suspense>
        {children}
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { DM_Sans, Instrument_Serif } from "next/font/google";
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

export const metadata: Metadata = {
  metadataBase: new URL("http://localhost:3000"),
  title: "SAFA — Trendyol e-Arsiv Paneli",
  description: "Trendyol teslim edilmis siparislerinden kontrollu e-Arsiv fatura akisi yoneten yerel operasyon paneli.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "SAFA — Trendyol e-Arsiv Paneli",
    description: "Trendyol siparislerini izleyin, e-Arsiv taslaklarini onaylayin ve fatura PDF'lerini Trendyol'a gonderin.",
    url: "http://localhost:3000",
    siteName: "SAFA",
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "SAFA — Trendyol e-Arsiv Paneli",
    description: "Yerel Trendyol e-Arsiv faturalandirma paneli."
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr" data-theme="light">
      <body className={`${dmSans.variable} ${instrument.variable}`}>{children}</body>
    </html>
  );
}

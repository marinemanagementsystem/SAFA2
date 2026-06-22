import type { NextConfig } from "next";

const apiProxyOrigin = process.env.API_PROXY_ORIGIN
  ?? (process.env.API_PROXY_HOSTPORT ? `http://${process.env.API_PROXY_HOSTPORT}` : "http://localhost:4000");
const isFirebaseStaticExport = process.env.FIREBASE_STATIC_EXPORT === "true";
const publicApiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? (isFirebaseStaticExport ? "/api" : undefined);
const configuredBasePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);

function normalizeBasePath(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "/") return undefined;

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, "");
}

const nextConfig: NextConfig = {
  devIndicators: false,
  ...(configuredBasePath ? { basePath: configuredBasePath } : {}),
  env: {
    NEXT_PUBLIC_STATIC_EXPORT: isFirebaseStaticExport ? "true" : process.env.NEXT_PUBLIC_STATIC_EXPORT ?? "false",
    ...(configuredBasePath ? { NEXT_PUBLIC_BASE_PATH: configuredBasePath } : {}),
    ...(publicApiBase ? { NEXT_PUBLIC_API_BASE_URL: publicApiBase } : {})
  },
  ...(isFirebaseStaticExport
    ? {
        output: "export" as const,
        images: { unoptimized: true }
      }
    : {}),
  transpilePackages: ["@safa/shared"],
  ...(!isFirebaseStaticExport
    ? {
        async rewrites() {
          return [
            {
              source: "/api/:path*",
              destination: `${apiProxyOrigin}/api/:path*`
            }
          ];
        },
        async headers() {
          return [
            {
              source: "/(.*)",
              headers: [
                { key: "X-Frame-Options", value: "DENY" },
                { key: "X-Content-Type-Options", value: "nosniff" },
                { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }
              ]
            }
          ];
        }
      }
    : {})
};

export default nextConfig;

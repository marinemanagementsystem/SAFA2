import type { NextConfig } from "next";

const apiProxyOrigin = process.env.API_PROXY_ORIGIN
  ?? (process.env.API_PROXY_HOSTPORT ? `http://${process.env.API_PROXY_HOSTPORT}` : "http://localhost:4000");
const isFirebaseStaticExport = process.env.FIREBASE_STATIC_EXPORT === "true";

const nextConfig: NextConfig = {
  ...(isFirebaseStaticExport
    ? {
        output: "export" as const,
        images: { unoptimized: true }
      }
    : {}),
  transpilePackages: ["@safa/shared"],
  async rewrites() {
    if (isFirebaseStaticExport) return [];

    return [
      {
        source: "/api/:path*",
        destination: `${apiProxyOrigin}/api/:path*`
      }
    ];
  },
  async headers() {
    if (isFirebaseStaticExport) return [];

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
};

export default nextConfig;

import { describe, expect, it } from "vitest";
import { proxiedPortalUrl, rewritePortalHtml, rewritePortalText } from "../src/earsiv-portal/portal-proxy-rewrite";

const context = {
  sessionId: "session-1",
  portalOrigin: "https://earsivportal.efatura.gov.tr",
  proxyPrefix: "/api/earsiv-portal/proxy/session-1"
};

describe("portal proxy rewrite", () => {
  it("keeps the proxy restricted to the configured GIB origin", () => {
    expect(proxiedPortalUrl(context, "/earsiv-services/dispatch?x=1", "https://earsivportal.efatura.gov.tr/intragiris.html")).toBe(
      "/api/earsiv-portal/proxy/session-1/earsiv-services/dispatch?x=1"
    );
    expect(proxiedPortalUrl(context, "https://example.com/logout", "https://earsivportal.efatura.gov.tr/intragiris.html")).toBe(
      "https://example.com/logout"
    );
  });

  it("rewrites html navigation, form, asset, and injects the proxy runtime", () => {
    const html = `
      <html>
        <head><style>.logo{background:url('/img/logo.png')}</style></head>
        <body>
          <a href="/portal/home">Home</a>
          <form action="/earsiv-services/dispatch" method="post"></form>
          <script>fetch("/earsiv-services/dispatch")</script>
        </body>
      </html>
    `;

    const rewritten = rewritePortalHtml(context, html, "https://earsivportal.efatura.gov.tr/intragiris.html");

    expect(rewritten).toContain('href="/api/earsiv-portal/proxy/session-1/portal/home"');
    expect(rewritten).toContain('action="/api/earsiv-portal/proxy/session-1/earsiv-services/dispatch"');
    expect(rewritten).toContain("/api/earsiv-portal/proxy/session-1/img/logo.png");
    expect(rewritten).toContain('fetch("/earsiv-services/dispatch")');
    expect(rewritten).toContain('data-safa-proxy-runtime="true"');
    expect(rewritten).toContain("XMLHttpRequest.prototype.open");
  });

  it("rewrites CSS urls inside text responses", () => {
    const rewritten = rewritePortalText(
      context,
      '@import "/css/base.css"; .logo{background:url("https://earsivportal.efatura.gov.tr/img/logo.png")}',
      "https://earsivportal.efatura.gov.tr/css/app.css"
    );

    expect(rewritten).toContain('@import "/api/earsiv-portal/proxy/session-1/css/base.css"');
    expect(rewritten).toContain('url("/api/earsiv-portal/proxy/session-1/img/logo.png")');
  });

  it("does not rewrite JavaScript-looking strings or regex literals", () => {
    const source =
      'const re = /https:\\/\\/earsivportal\\.efatura\\.gov\\.tr\\/index\\.jsp/g; switch(operator){case "/": total = left / right;}';
    const rewritten = rewritePortalText(context, source, "https://earsivportal.efatura.gov.tr/intragiris.html");

    expect(rewritten).toContain("/https:\\/\\/earsivportal\\.efatura\\.gov\\.tr\\/index\\.jsp/g");
    expect(rewritten).toContain('case "/"');
  });
});

import * as cheerio from "cheerio";

export interface PortalProxyRewriteContext {
  sessionId: string;
  portalOrigin: string;
  proxyPrefix: string;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function proxiedPortalUrl(context: PortalProxyRewriteContext, value: string, baseUrl: string) {
  if (!value.trim()) return value;
  if (/^(?:mailto|tel|javascript|data):/i.test(value)) return value;

  try {
    const target = new URL(value, baseUrl);
    if (target.origin !== context.portalOrigin) return value;
    return `${context.proxyPrefix}${target.pathname}${target.search}${target.hash}`;
  } catch {
    return value;
  }
}

function rewriteRefreshContent(context: PortalProxyRewriteContext, content: string, baseUrl: string) {
  return content.replace(/url=([^;]+)/i, (match, target: string) => `url=${proxiedPortalUrl(context, target.trim(), baseUrl)}`);
}

export function rewritePortalHtml(context: PortalProxyRewriteContext, html: string, baseUrl: string) {
  const $ = cheerio.load(html);
  const urlAttributes = ["href", "src", "action", "data", "poster"];

  for (const attribute of urlAttributes) {
    $(`[${attribute}]`).each((_, element) => {
      const current = $(element).attr(attribute);
      if (!current) return;
      $(element).attr(attribute, proxiedPortalUrl(context, current, baseUrl));
    });
  }

  $("[srcset]").each((_, element) => {
    const current = $(element).attr("srcset");
    if (!current) return;
    const next = current
      .split(",")
      .map((entry) => {
        const parts = entry.trim().split(/\s+/);
        if (!parts[0]) return entry;
        return [proxiedPortalUrl(context, parts[0], baseUrl), ...parts.slice(1)].join(" ");
      })
      .join(", ");
    $(element).attr("srcset", next);
  });

  $('meta[http-equiv="refresh" i]').each((_, element) => {
    const current = $(element).attr("content");
    if (!current) return;
    $(element).attr("content", rewriteRefreshContent(context, current, baseUrl));
  });

  $("style").each((_, element) => {
    const current = $(element).html();
    if (!current) return;
    $(element).text(rewritePortalText(context, current, baseUrl));
  });

  $("script").each((_, element) => {
    const current = $(element).html();
    if (!current) return;
    $(element).text(rewritePortalText(context, current, baseUrl));
  });

  return $.html();
}

export function rewritePortalText(context: PortalProxyRewriteContext, text: string, baseUrl: string) {
  const originPattern = new RegExp(escapeRegExp(context.portalOrigin), "g");
  const rootPathPattern = /(["'`])\/(?!\/|api\/)([^"'`<>\s)]*)/g;
  const cssUrlPattern = /url\((['"]?)([^)'"]+)\1\)/g;

  return text
    .replace(originPattern, context.proxyPrefix)
    .replace(cssUrlPattern, (match, quote: string, target: string) => {
      const proxied = proxiedPortalUrl(context, target.trim(), baseUrl);
      return `url(${quote}${proxied}${quote})`;
    })
    .replace(rootPathPattern, (match, quote: string, path: string) => `${quote}${context.proxyPrefix}/${path}`);
}

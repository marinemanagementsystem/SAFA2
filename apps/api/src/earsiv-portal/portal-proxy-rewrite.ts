import * as cheerio from "cheerio";

export interface PortalProxyRewriteContext {
  sessionId: string;
  portalOrigin: string;
  proxyPrefix: string;
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

function portalProxyRuntimeScript(context: PortalProxyRewriteContext) {
  const proxyPrefix = JSON.stringify(context.proxyPrefix);
  const portalOrigin = JSON.stringify(context.portalOrigin);

  return `
(function () {
  var proxyPrefix = ${proxyPrefix};
  var portalOrigin = ${portalOrigin};

  function proxifyUrl(input) {
    if (typeof input !== "string" || !input) return input;
    if (/^(?:mailto|tel|javascript|data|blob):/i.test(input)) return input;

    try {
      var target = new URL(input, window.location.href);
      if (target.origin === window.location.origin && target.pathname.indexOf(proxyPrefix) === 0) {
        return input;
      }

      if (
        target.origin === portalOrigin ||
        (target.origin === window.location.origin && target.pathname.indexOf("/api/") !== 0)
      ) {
        return proxyPrefix + target.pathname + target.search + target.hash;
      }
    } catch (error) {
      return input;
    }

    return input;
  }

  var nativeXhrOpen = window.XMLHttpRequest && window.XMLHttpRequest.prototype.open;
  if (nativeXhrOpen) {
    window.XMLHttpRequest.prototype.open = function (method, url) {
      arguments[1] = proxifyUrl(url);
      return nativeXhrOpen.apply(this, arguments);
    };
  }

  var nativeFetch = window.fetch;
  if (nativeFetch) {
    window.fetch = function (input, init) {
      if (window.Request && input instanceof window.Request) {
        var nextUrl = proxifyUrl(input.url);
        if (nextUrl !== input.url) input = new window.Request(nextUrl, input);
      } else {
        input = proxifyUrl(input);
      }
      return nativeFetch.call(this, input, init);
    };
  }

  var nativeOpen = window.open;
  if (nativeOpen) {
    window.open = function (url, target, features) {
      return nativeOpen.call(window, proxifyUrl(url), target, features);
    };
  }

  var nativeAssign = window.Location && window.Location.prototype.assign;
  if (nativeAssign) {
    window.Location.prototype.assign = function (url) {
      return nativeAssign.call(this, proxifyUrl(url));
    };
  }

  var nativeReplace = window.Location && window.Location.prototype.replace;
  if (nativeReplace) {
    window.Location.prototype.replace = function (url) {
      return nativeReplace.call(this, proxifyUrl(url));
    };
  }
})();`.trim();
}

function injectPortalProxyRuntime($: cheerio.CheerioAPI, context: PortalProxyRewriteContext) {
  const runtime = `<script data-safa-proxy-runtime="true">${portalProxyRuntimeScript(context)}</script>`;
  const head = $("head").first();
  if (head.length > 0) {
    head.prepend(runtime);
    return;
  }

  const html = $("html").first();
  if (html.length > 0) {
    html.prepend(runtime);
    return;
  }

  $.root().prepend(runtime);
}

function rewriteRefreshContent(context: PortalProxyRewriteContext, content: string, baseUrl: string) {
  return content.replace(/url=([^;]+)/i, (match, target: string) => `url=${proxiedPortalUrl(context, target.trim(), baseUrl)}`);
}

export function rewritePortalHtml(context: PortalProxyRewriteContext, html: string, baseUrl: string) {
  const $ = cheerio.load(html);
  injectPortalProxyRuntime($, context);
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

  return $.html();
}

export function rewritePortalText(context: PortalProxyRewriteContext, text: string, baseUrl: string) {
  const cssUrlPattern = /url\((['"]?)([^)'"]+)\1\)/g;
  const importPattern = /(@import\s+)(["'])([^"']+)\2/gi;

  return text
    .replace(cssUrlPattern, (match, quote: string, target: string) => {
      const proxied = proxiedPortalUrl(context, target.trim(), baseUrl);
      return `url(${quote}${proxied}${quote})`;
    })
    .replace(importPattern, (match, prefix: string, quote: string, target: string) => {
      return `${prefix}${quote}${proxiedPortalUrl(context, target, baseUrl)}${quote}`;
    });
}

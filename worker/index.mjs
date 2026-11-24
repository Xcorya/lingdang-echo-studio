import { createHub } from "../lib/hub.mjs";
import { assets } from "./assets.generated.mjs";

const types = {
  html: "text/html; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
  json: "application/json; charset=utf-8",
};
const csp =
  "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; worker-src 'self' blob: https://cdn.jsdelivr.net; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (!env.DB)
        return Response.json(
          {
            error: "请先为 Worker 绑定 D1 数据库 DB 并执行 migration。",
            code: "database_not_configured",
          },
          { status: 503 },
        );
      // Tables are created by a deployment migration, never by a public request.
      return createHub({
        db: env.DB,
        mode: "cloudflare",
        allowedOrigin: env.ECHO_ALLOWED_ORIGIN || "https://xcorya.github.io",
      })(request);
    }
    if (!["GET", "HEAD"].includes(request.method))
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const asset = assets[path] ?? assets[path.replace(/^\//, "")];
    if (asset == null) return new Response("Not found", { status: 404 });
    const body = typeof asset === "string" ? asset : asset.body;
    const contentType =
      typeof asset === "object" && asset.contentType
        ? asset.contentType
        : types[path.split(".").at(-1)] || "application/octet-stream";
    return new Response(request.method === "HEAD" ? null : body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": csp,
      },
    });
  },
};

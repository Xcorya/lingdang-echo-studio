import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import { createHub } from "./lib/hub.mjs";

const root = dirname(fileURLToPath(import.meta.url));

// Match D1's statement API so the exact same router runs in both environments.
export function openSqliteDatabase(
  filename = resolve(
    process.env.ECHO_DATA_DIR || resolve(process.cwd(), ".echo"),
    "hub.sqlite",
  ),
) {
  if (filename !== ":memory:")
    mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const connection = new DatabaseSync(filename);
  connection.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
  );
  const migration = readFileSync(
    resolve(root, "db/migrations/0001_hub.sql"),
    "utf8",
  );
  connection.exec(migration);
  function statement(sql, values = []) {
    const prepared = connection.prepare(sql);
    return {
      bind(...parameters) {
        return statement(sql, parameters);
      },
      first(column) {
        const row = prepared.get(...values);
        return row ? (column ? row[column] : row) : null;
      },
      all() {
        return { success: true, results: prepared.all(...values), meta: {} };
      },
      run() {
        const result = prepared.run(...values);
        return {
          success: true,
          results: [],
          meta: {
            changes: Number(result.changes),
            last_row_id: Number(result.lastInsertRowid),
          },
        };
      },
    };
  }
  return {
    prepare: statement,
    batch(statements) {
      connection.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((item) => item.run());
        connection.exec("COMMIT");
        return results;
      } catch (error) {
        connection.exec("ROLLBACK");
        throw error;
      }
    },
    close() {
      connection.close();
    },
  };
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".ico": "image/x-icon",
};
const csp =
  "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; worker-src 'self' blob: https://cdn.jsdelivr.net; connect-src 'self' blob: data: https: http://localhost:* http://127.0.0.1:*; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'";

export function createLocalServer({
  db = openSqliteDatabase(),
  host = process.env.ECHO_HOST || "127.0.0.1",
  port = Number(process.env.ECHO_PORT || process.env.PORT || 4173),
  allowedOrigin = process.env.ECHO_ALLOWED_ORIGIN || "",
} = {}) {
  const hub = createHub({ db, mode: "local", allowedOrigin });
  const publicRoot = resolve(root, "dist/public");
  const server = createServer(async (incoming, outgoing) => {
    outgoing.setHeader("X-Content-Type-Options", "nosniff");
    outgoing.setHeader("Referrer-Policy", "no-referrer");
    outgoing.setHeader("Content-Security-Policy", csp);
    try {
      const authority = incoming.headers.host || `${host}:${port}`;
      if (["127.0.0.1", "localhost", "::1"].includes(host)) {
        const allowedHosts = new Set([
          `127.0.0.1:${port}`,
          `localhost:${port}`,
          `[::1]:${port}`,
        ]);
        if (!allowedHosts.has(authority)) {
          outgoing.writeHead(403, { "Content-Type": "application/json" });
          outgoing.end(
            JSON.stringify({
              error: "本地服务仅接受本机地址。",
              code: "invalid_host",
            }),
          );
          return;
        }
      }
      const url = new URL(
        incoming.url,
        `${incoming.socket.encrypted || (host === "0.0.0.0" && incoming.headers["x-forwarded-proto"] === "https") ? "https" : "http"}://${authority}`,
      );
      if (url.pathname.startsWith("/api/")) {
        const init = { method: incoming.method, headers: incoming.headers };
        if (!["GET", "HEAD"].includes(incoming.method)) {
          init.body = Readable.toWeb(incoming);
          init.duplex = "half";
        }
        const response = await hub(new Request(url, init));
        outgoing.writeHead(
          response.status,
          Object.fromEntries(response.headers),
        );
        outgoing.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      if (!["GET", "HEAD"].includes(incoming.method)) {
        outgoing.writeHead(405, { Allow: "GET, HEAD" });
        outgoing.end();
        return;
      }
      let path;
      try {
        path = decodeURIComponent(url.pathname);
      } catch {
        outgoing.writeHead(400);
        outgoing.end();
        return;
      }
      const filename = resolve(
        publicRoot,
        `.${path === "/" ? "/index.html" : path}`,
      );
      if (
        !filename.startsWith(`${publicRoot}${sep}`) ||
        !Object.hasOwn(types, extname(filename))
      ) {
        outgoing.writeHead(404);
        outgoing.end("Not found");
        return;
      }
      let bytes;
      try {
        bytes = readFileSync(filename);
      } catch {
        outgoing.writeHead(404);
        outgoing.end("Not found");
        return;
      }
      outgoing.writeHead(200, {
        "Content-Type": types[extname(filename)],
        "Cache-Control": "no-cache",
      });
      outgoing.end(incoming.method === "HEAD" ? undefined : bytes);
    } catch (error) {
      console.error("Request failed:", error?.message || error);
      if (!outgoing.headersSent)
        outgoing.writeHead(500, {
          "Content-Type": "application/json; charset=utf-8",
        });
      outgoing.end(
        JSON.stringify({
          error: "服务暂时无法处理请求。",
          code: "internal_error",
        }),
      );
    }
  });
  server.on("close", () => db.close?.());
  return { server, host, port };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { server, host, port } = createLocalServer();
  server.listen(port, host, () =>
    console.log(
      `聆荡回声 → http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`,
    ),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => server.close(() => process.exit(0)));
}

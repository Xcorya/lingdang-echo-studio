import { build } from "esbuild";
import { cp, mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist/public/assets", { recursive: true });
await cp("public", "dist/public", {
  recursive: true,
  filter: (p) => !p.endsWith(".mjs") && !p.endsWith(".DS_Store"),
});
await build({
  entryPoints: ["public/app.mjs"],
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  outfile: "dist/public/assets/app.js",
  external: ["https://*"],
  logLevel: "info",
  legalComments: "linked",
});
await cp("public/web-worker.mjs", "dist/public/web-worker.mjs");
const assets = {};
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};
async function walk(dir, prefix = "") {
  for (const file of await readdir(dir, { withFileTypes: true })) {
    const full = `${dir}/${file.name}`,
      rel = `${prefix}/${file.name}`;
    if (file.isDirectory()) await walk(full, rel);
    else
      assets[rel] = {
        body: await readFile(full, "utf8"),
        contentType:
          types["." + file.name.split(".").pop()] ||
          "text/plain; charset=utf-8",
      };
  }
}
await walk("dist/public");
await writeFile(
  "worker/assets.generated.mjs",
  `export const assets=${JSON.stringify(assets)};\n`,
);
await mkdir("dist/server", { recursive: true });
await build({
  entryPoints: ["worker/index.mjs"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  outfile: "dist/server/index.js",
  logLevel: "info",
});
await mkdir("dist/.openai/drizzle/meta", { recursive: true });
await cp(".openai/hosting.json", "dist/.openai/hosting.json");
await mkdir("drizzle/meta", { recursive: true });
const raw = await readFile("db/migrations/0001_hub.sql", "utf8");
const sql =
  raw
    .replace(/^PRAGMA[^;]+;/gm, "")
    .trim()
    .split(/;\s*\n/)
    .map((x) => x.trim().replace(/;$/, ""))
    .filter(Boolean)
    .map((x) => x + ";")
    .join("\n--> statement-breakpoint\n") + "\n";
await writeFile("drizzle/0000_hub.sql", sql);
await writeFile(
  "drizzle/meta/_journal.json",
  JSON.stringify({
    version: "7",
    dialect: "sqlite",
    entries: [
      {
        idx: 0,
        version: "6",
        when: 1795480000000,
        tag: "0000_hub",
        breakpoints: true,
      },
    ],
  }),
);
await cp("drizzle", "dist/.openai/drizzle", { recursive: true });
console.log("Built browser app, Node static assets, and D1-backed Worker.");

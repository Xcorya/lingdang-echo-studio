import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const folders = ["public", "lib", "worker", "scripts"];
const files = ["server.mjs"];
for (const folder of folders)
  for (const file of await readdir(folder).catch(() => []))
    if (/\.m?js$/.test(file)) files.push(`${folder}/${file}`);
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Checked ${files.length} JavaScript modules.`);

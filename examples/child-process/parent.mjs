import { spawnSync } from "node:child_process";

const child = spawnSync(process.execPath, ["child.mjs"], {
  encoding: "utf8",
  stdio: "inherit",
});
if (child.status !== 0) process.exit(child.status ?? 1);

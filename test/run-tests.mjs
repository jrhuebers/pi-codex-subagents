import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const storage = mkdtempSync(join(tmpdir(), "pi-codex-subagents-tests-"));
const localBun = join(root, "node_modules", ".bin", process.platform === "win32" ? "bun.exe" : "bun");
const bun = process.env.BUN_BIN || (existsSync(localBun) ? localBun : "bun");
try {
  // One sequential Bun process; fake RPC fixtures never request a model.
  const result = spawnSync(bun, ["test", "./core.test.ts", "./peek.test.ts", "./picker.test.ts", "./wait.test.ts", "./transcript.test.ts"], {
    cwd: root,
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: storage,
      PI_SUBAGENT_TEMP_DIR: join(storage, "temp"),
      PI_SUBAGENT_PI_BIN: "",
    },
    stdio: "inherit",
    timeout: 120_000,
  });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(storage, { recursive: true, force: true });
}

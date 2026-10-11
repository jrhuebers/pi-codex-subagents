import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const agentPackage = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
const cli = join(agentPackage, "bundle", "cli.js");
const storage = mkdtempSync(join(tmpdir(), "pi-codex-subagents-rpc-smoke-"));
let child;
let timer;
let stderr = "";
try {
  child = spawn(process.execPath, [cli, "--mode", "rpc", "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "-e", join(root, "index.ts")], {
    cwd: storage,
    env: { ...process.env, PI_CODING_AGENT_DIR: storage, PI_SUBAGENT_TEMP_DIR: join(storage, "temp"), PI_SUBAGENT_PI_BIN: "" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  const responses = new Map();
  const completion = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("RPC smoke exceeded 30 seconds."));
    }, 30_000);
    child.on("error", reject);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (text) => { stderr += text; });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (text) => {
      buffer += text;
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const record = JSON.parse(line);
          if (record.type === "response") responses.set(record.id, record);
          if (responses.has("state") && responses.has("commands")) child.stdin.end();
        } catch (error) {
          child.kill("SIGKILL");
          reject(error);
        }
      }
    });
    child.stdin.on("error", reject);
    child.on("close", (code, signal) => {
      if (code !== 0) reject(new Error(`Pi exited ${code ?? signal}: ${stderr}`));
      else resolve();
    });
  });
  // Read-only protocol commands only: no prompt or model request is sent.
  child.stdin.write(`${JSON.stringify({ id: "state", type: "get_state" })}\n`);
  child.stdin.write(`${JSON.stringify({ id: "commands", type: "get_commands" })}\n`);
  await completion;
  assert.equal(responses.get("state")?.success, true, "get_state must succeed");
  assert.equal(responses.get("state").data.isStreaming, false);
  assert.equal(responses.get("commands")?.success, true);
  assert.ok(responses.get("commands").data.commands.some((command) => command.name === "subagents" && command.source === "extension"), "standalone extension must register /subagents");
  assert.ok(existsSync(join(storage, "pi-codex-subagents", "runs")), "extension must use isolated run storage");
  console.log("PASS: real Pi RPC get_state, standalone /subagents registration, isolated storage, orderly stdin-EOF shutdown; no model request.");
  if (stderr.trim()) console.error(stderr.trim());
} finally {
  clearTimeout(timer);
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("close", resolve));
  }
  rmSync(storage, { recursive: true, force: true });
}

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manager = path.join(repoRoot, "scripts", "manage.mjs");

function run(command, agentDir, stateDir, ...args) {
  const result = spawnSync(process.execPath, [manager, command, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: agentDir,
      XDG_STATE_HOME: stateDir,
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

test("install preserves unrelated settings and backs up changed files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-dotfiles-test-"));
  const agentDir = path.join(root, "agent");
  const stateDir = path.join(root, "state");

  try {
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, "settings.json"),
      `${JSON.stringify({
        theme: "light",
        lastChangelogVersion: "machine-state",
        customSetting: { preserved: true },
      }, null, 2)}\n`,
    );

    const stdout = run("install", agentDir, stateDir);
    assert.match(stdout, /Updated 3 Pi configuration file/);

    const installed = JSON.parse(fs.readFileSync(path.join(agentDir, "settings.json"), "utf8"));
    assert.equal(installed.theme, "dark");
    assert.equal(installed.lastChangelogVersion, "machine-state");
    assert.deepEqual(installed.customSetting, { preserved: true });
    assert.deepEqual(installed.packages, [
      "npm:pi-powerline-footer@0.16.0",
      "npm:pi-mcp-adapter@2.31.0",
    ]);
    assert.ok(fs.existsSync(path.join(agentDir, "keybindings.json")));
    assert.ok(fs.existsSync(path.join(agentDir, "extensions", "pi-tool-display", "config.json")));

    const backups = path.join(stateDir, "pi-dotfiles", "backups");
    const backupEntries = fs.readdirSync(backups);
    assert.equal(backupEntries.length, 1);
    assert.ok(fs.existsSync(path.join(backups, backupEntries[0], "settings.json")));

    assert.match(run("install", agentDir, stateDir), /already current/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("dry-run does not create an agent directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-dotfiles-test-"));
  const agentDir = path.join(root, "missing-agent");

  try {
    assert.match(run("install", agentDir, path.join(root, "state"), "--dry-run"), /Would update 3 file/);
    assert.equal(fs.existsSync(agentDir), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

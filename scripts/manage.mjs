#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const configRoot = path.join(repoRoot, "config");
const versionsPath = path.join(repoRoot, "versions.env");

const managedFiles = [
  "settings.json",
  "keybindings.json",
  "models.json",
  "web-search.json",
  path.join("extensions", "pi-tool-display", "config.json"),
];

const trackedFiles = managedFiles.filter((relative) => relative !== "settings.json");

const exportOnlyOmittedSettings = new Set([
  "lastChangelogVersion",
  "trackingId",
  "httpProxy",
  "sessionDir",
]);

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { dryRun: false };
  for (const arg of argv) {
    if (arg === "--dry-run") options.dryRun = true;
    else fail(`unknown option: ${arg}`);
  }
  return options;
}

function piDir() {
  return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`cannot parse ${file}: ${error.message}`);
  }
}

function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readVersions() {
  const result = {};
  for (const rawLine of fs.readFileSync(versionsPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) fail(`invalid versions.env line: ${rawLine}`);
    result[line.slice(0, index)] = line.slice(index + 1);
  }
  return result;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, overlay) {
  if (!isPlainObject(base) || !isPlainObject(overlay)) return structuredClone(overlay);
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(overlay)) {
    result[key] = isPlainObject(value) && isPlainObject(result[key])
      ? deepMerge(result[key], value)
      : structuredClone(value);
  }
  return result;
}

function assertNoSecrets(value, label, keyPath = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecrets(entry, label, [...keyPath, String(index)]));
    return;
  }

  if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      const fullPath = [...keyPath, key];
      const isCommandReference = typeof entry === "string" && /^!\S/.test(entry);
      if (/(?:^|[_-])(password|passwd|secret|access[_-]?token|refresh[_-]?token|api[_-]?key|private[_-]?key|credential|cookie)(?:$|[_-])/i.test(key) && !isCommandReference) {
        fail(`${label} contains a secret-like key at ${fullPath.join(".")}`);
      }
      assertNoSecrets(entry, label, fullPath);
    }
    return;
  }

  if (typeof value !== "string") return;
  const location = keyPath.length ? ` at ${keyPath.join(".")}` : "";
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value)) {
    fail(`${label} contains a private key${location}`);
  }
  if (/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i.test(value)) {
    fail(`${label} contains a URL with embedded credentials${location}`);
  }
  if (/\b(?:sk-ant-|sk-proj-|ghp_|github_pat_|glpat-|xox[baprs]-)[A-Za-z0-9_-]{12,}/.test(value)) {
    fail(`${label} contains a token-like value${location}`);
  }
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, content, { mode: 0o644 });
  fs.renameSync(temporary, file);
}

function changed(file, content) {
  return !fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content;
}

function backupFiles(targetRoot, relativeFiles) {
  const existing = relativeFiles.filter((relative) => fs.existsSync(path.join(targetRoot, relative)));
  if (existing.length === 0) return null;

  const stateRoot = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.join(stateRoot, "pi-dotfiles", "backups", stamp);
  for (const relative of existing) {
    const source = path.join(targetRoot, relative);
    const destination = path.join(backupRoot, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  return backupRoot;
}

function install(options) {
  validateRepository();
  const targetRoot = piDir();
  const templateSettings = readJson(path.join(configRoot, "settings.json"));
  const existingSettingsPath = path.join(targetRoot, "settings.json");
  const existingSettings = fs.existsSync(existingSettingsPath) ? readJson(existingSettingsPath) : {};
  const mergedValues = deepMerge(existingSettings, templateSettings);
  const managedKeys = Object.keys(templateSettings);
  const mergedSettings = Object.fromEntries([
    ...managedKeys.map((key) => [key, mergedValues[key]]),
    ...Object.entries(mergedValues).filter(([key]) => !managedKeys.includes(key)),
  ]);

  const outputs = new Map([
    ["settings.json", formatJson(mergedSettings)],
    ...trackedFiles.map((relative) => [
      relative,
      fs.readFileSync(path.join(configRoot, relative), "utf8"),
    ]),
  ]);

  for (const [relative, content] of outputs) {
    if (relative.endsWith(".json")) assertNoSecrets(JSON.parse(content), relative);
  }

  const changes = [...outputs].filter(([relative, content]) => changed(path.join(targetRoot, relative), content));
  if (changes.length === 0) {
    console.log(`Pi configuration is already current in ${targetRoot}`);
    return;
  }

  if (options.dryRun) {
    console.log(`Would update ${changes.length} file(s) in ${targetRoot}:`);
    changes.forEach(([relative]) => console.log(`  ${relative}`));
    return;
  }

  const backupRoot = backupFiles(targetRoot, changes.map(([relative]) => relative));
  for (const [relative, content] of changes) atomicWrite(path.join(targetRoot, relative), content);

  console.log(`Updated ${changes.length} Pi configuration file(s) in ${targetRoot}`);
  if (backupRoot) console.log(`Backup: ${backupRoot}`);
}

function exportConfig(options) {
  const sourceRoot = piDir();
  const sourceSettings = readJson(path.join(sourceRoot, "settings.json"));
  const exportedSettings = Object.fromEntries(
    Object.entries(sourceSettings).filter(([key]) => !exportOnlyOmittedSettings.has(key)),
  );

  const candidates = new Map([
    ["settings.json", formatJson(exportedSettings)],
    ...trackedFiles.map((relative) => {
      const source = path.join(sourceRoot, relative);
      if (!fs.existsSync(source)) fail(`missing ${relative} in ${sourceRoot}`);
      return [relative, fs.readFileSync(source, "utf8")];
    }),
  ]);

  for (const [relative, content] of candidates) {
    const parsed = JSON.parse(content);
    assertNoSecrets(parsed, relative);
  }

  const changes = [...candidates].filter(([relative, content]) => changed(path.join(configRoot, relative), content));
  if (changes.length === 0) {
    console.log("Tracked configuration already matches this machine");
    return;
  }

  if (options.dryRun) {
    console.log(`Would export ${changes.length} file(s):`);
    changes.forEach(([relative]) => console.log(`  config/${relative}`));
    return;
  }

  for (const [relative, content] of changes) atomicWrite(path.join(configRoot, relative), content);
  console.log(`Exported ${changes.length} configuration file(s)`);
  validateRepository();
}

function walkFiles(root, relative = "") {
  const output = [];
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) output.push(...walkFiles(root, child));
    else if (entry.isFile()) output.push(child);
  }
  return output;
}

function validateRepository() {
  const versions = readVersions();
  const settings = readJson(path.join(configRoot, "settings.json"));
  const expectedPackages = [
    `npm:pi-powerline-footer@${versions.PI_POWERLINE_VERSION}`,
    `npm:pi-web-search@${versions.PI_WEB_SEARCH_VERSION}`,
  ];

  if (JSON.stringify(settings.packages) !== JSON.stringify(expectedPackages)) {
    fail(`config/settings.json package pins do not match versions.env`);
  }
  for (const forbidden of exportOnlyOmittedSettings) {
    if (Object.hasOwn(settings, forbidden)) fail(`config/settings.json must not contain ${forbidden}`);
  }

  for (const source of settings.packages) {
    if (!/^npm:(?:@[^/]+\/[^@]+|[^@]+)@\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(source)) {
      fail(`package is not pinned to an exact semantic version: ${source}`);
    }
  }

  const files = walkFiles(repoRoot);
  const forbiddenBasenames = new Set([
    "auth.json",
    "trust.json",
    "mcp-cache.json",
    "models-store.json",
    "context.db",
  ]);

  for (const relative of files) {
    const basename = path.basename(relative);
    if (forbiddenBasenames.has(basename) || /(^|\/)(sessions|structured-returns|node_modules)(\/|$)/.test(relative)) {
      fail(`runtime or credential file must not be tracked: ${relative}`);
    }
    const file = path.join(repoRoot, relative);
    if (relative.endsWith(".json")) {
      const parsed = readJson(file);
      assertNoSecrets(parsed, relative);
    } else {
      const text = fs.readFileSync(file, "utf8");
      if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) {
        fail(`${relative} contains a private key`);
      }
      if (/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i.test(text)) {
        fail(`${relative} contains a URL with embedded credentials`);
      }
      if (/\b(?:sk-ant-|sk-proj-|ghp_|github_pat_|glpat-|xox[baprs]-)[A-Za-z0-9_-]{12,}/.test(text)) {
        fail(`${relative} contains a token-like value`);
      }
    }
  }

  for (const relative of managedFiles) {
    if (!fs.existsSync(path.join(configRoot, relative))) fail(`missing managed file: config/${relative}`);
    if (relative.endsWith(".json")) assertNoSecrets(readJson(path.join(configRoot, relative)), `config/${relative}`);
  }

  console.log(`Validated ${files.length} repository files; no secret-like content found`);
}

const [command, ...argv] = process.argv.slice(2);
const options = parseArgs(argv);
if (command === "install") install(options);
else if (command === "export") exportConfig(options);
else if (command === "validate") validateRepository();
else fail("usage: manage.mjs <install|export|validate> [--dry-run]");

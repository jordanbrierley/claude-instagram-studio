import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const ENV_PATH = path.join(os.homedir(), ".config", "instagram-studio", "env");
// Every secret key the plugin knows about, and the subsets each command requires.
// This is the single source of truth: ig.mjs imports these rather than repeating
// key names, so adding or renaming a secret is a one-file change.
export const SECRET_KEYS = ["IG_APP_ID", "IG_APP_SECRET", "IG_USER_ID", "IG_ACCESS_TOKEN", "IG_TOKEN_EXPIRES_AT", "BLOB_READ_WRITE_TOKEN"];

const pick = (...keys) => keys.map((key) => {
  if (!SECRET_KEYS.includes(key)) throw new Error(`${key} is not a known secret key`);
  return key;
});

export const PUBLISH_KEYS = pick("IG_USER_ID", "IG_ACCESS_TOKEN", "BLOB_READ_WRITE_TOKEN");
export const EXCHANGE_KEYS = pick("IG_APP_SECRET", "IG_ACCESS_TOKEN");
export const REFRESH_KEYS = pick("IG_ACCESS_TOKEN");

const DEFAULTS = { root: "content", slots: [], timezone: "Europe/London", maxLateMinutes: null };

export function findRepo(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (existsSync(path.join(dir, "instagram", "config.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function parseConfig(text) {
  let raw;
  try { raw = JSON.parse(text); } catch (e) { throw new Error(`instagram/config.json is not valid JSON: ${e.message}`); }
  const cfg = { ...DEFAULTS, ...raw };
  if (typeof cfg.root !== "string" || cfg.root.length === 0) throw new Error("config.root must be a non-empty directory name");
  if (!Array.isArray(cfg.slots) || cfg.slots.length === 0) throw new Error("config.slots must list at least one HH:MM time");
  for (const slot of cfg.slots) {
    if (typeof slot !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot)) throw new Error(`config.slots: "${slot}" is not HH:MM`);
  }
  if (typeof cfg.timezone !== "string" || cfg.timezone.length === 0) throw new Error("config.timezone must be an IANA timezone such as Europe/London");
  if (cfg.maxLateMinutes !== null && !(Number.isInteger(cfg.maxLateMinutes) && cfg.maxLateMinutes >= 0)) {
    throw new Error("config.maxLateMinutes must be null or a non-negative whole number of minutes");
  }
  cfg.slots = [...cfg.slots].sort();
  return cfg;
}

export function loadConfig(repoDir) {
  return parseConfig(readFileSync(path.join(repoDir, "instagram", "config.json"), "utf8"));
}

export function paths(repoDir, config) {
  return {
    configPath: path.join(repoDir, "instagram", "config.json"),
    logPath: path.join(repoDir, "instagram", "log.jsonl"),
    rootDir: path.resolve(repoDir, config.root),
  };
}

export function parseEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = trimmed.slice(eq + 1).trim();
    const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

// Only used to create the file from scratch. An existing file is patched line by
// line by updateEnv so a user's comments and layout survive a token refresh.
export function serializeEnv(vars) {
  return Object.entries(vars).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
}

export function readEnv(envPath = ENV_PATH) {
  if (!existsSync(envPath)) return {};
  return parseEnv(readFileSync(envPath, "utf8"));
}

export function writeEnv(vars, envPath = ENV_PATH) {
  mkdirSync(path.dirname(envPath), { recursive: true, mode: 0o700 });
  writeFileSync(envPath, serializeEnv(vars), { mode: 0o600 });
  chmodSync(envPath, 0o600); // an existing file keeps its old mode without this
}

export function updateEnv(patch, envPath = ENV_PATH) {
  const merged = { ...readEnv(envPath), ...patch };
  if (!existsSync(envPath)) {
    writeEnv(merged, envPath);
    return merged;
  }

  // Patch in place. A token refresh must not eat the comments, blank lines or
  // unrelated keys the user wrote into their own secrets file.
  const pending = new Map(Object.entries(patch));
  const lines = readFileSync(envPath, "utf8").split("\n").map((line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) return line;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return line;
    const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, "");
    if (!pending.has(key)) return line;
    const value = pending.get(key);
    pending.delete(key);
    return `${key}=${value}`;
  });

  let insertAt = lines.length;
  while (insertAt > 0 && lines[insertAt - 1].trim().length === 0) insertAt -= 1; // keep new keys above any trailing blank
  lines.splice(insertAt, 0, ...[...pending].map(([key, value]) => `${key}=${value}`));

  const text = lines.join("\n");
  mkdirSync(path.dirname(envPath), { recursive: true, mode: 0o700 });
  writeFileSync(envPath, text.endsWith("\n") ? text : `${text}\n`, { mode: 0o600 });
  chmodSync(envPath, 0o600);
  return merged;
}

export function requireSecrets(env, keys) {
  const missing = keys.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`missing ${missing.join(", ")} in ${ENV_PATH}. Run /ig-setup to create them.`);
  }
}

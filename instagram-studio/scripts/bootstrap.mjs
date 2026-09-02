#!/usr/bin/env node
// SessionStart bootstrap: sync the engine tree from the (versioned, replaced-on-update)
// plugin cache into the persistent data dir, and `npm ci` its deps there. Zero external
// deps: this script is what installs deps.
// Concurrency: mkdir lock per tree. Crash safety: install into a tmp dir, atomic rename,
// fingerprint written inside tmp BEFORE the swap.
// Failure policy: a SessionStart hook must exit 0, so every step runs inside one outer
// try/catch that logs a single line to stderr and stops. An unsynced engine is retried by
// the next session; a non-zero exit here would surface as a hook error in every session.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

const ROOT = process.env.CLAUDE_PLUGIN_ROOT;
const DATA = process.env.CLAUDE_PLUGIN_DATA;
if (!ROOT || !DATA) process.exit(0); // not running inside a plugin context

const COPY_EXCLUDE = new Set(["node_modules", "tests", "fixtures", ".env", ".fingerprint"]);
const LOCK_STALE_MS = 10 * 60 * 1000;
const trees = [{ key: "engine", src: "engine" }];

function listFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (COPY_EXCLUDE.has(name)) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, base));
    else out.push(path.relative(base, p));
  }
  return out;
}

function fingerprint(dir) {
  const h = createHash("sha256");
  for (const rel of listFiles(dir)) {
    h.update(rel).update("\0").update(readFileSync(path.join(dir, rel)));
  }
  return h.digest("hex");
}

function syncTree({ key, src }) {
  const srcDir = path.join(ROOT, src);
  const destDir = path.join(DATA, key);
  if (!existsSync(srcDir)) {
    console.log(`instagram-studio: ${key} source missing, skipping`);
    return;
  }
  const fp = fingerprint(srcDir);
  const fpFile = path.join(destDir, ".fingerprint");
  if (existsSync(fpFile) && readFileSync(fpFile, "utf8") === fp) {
    console.log(`instagram-studio: ${key} up to date`);
    return;
  }

  const lockDir = `${destDir}.lock`;
  try {
    mkdirSync(lockDir, { recursive: false });
  } catch (err) {
    // EEXIST is the only expected failure here: another session holds the lock.
    // Anything else (a permission problem, a missing parent) is a real failure and
    // belongs to the outer catch, not to a stale-lock recovery.
    if (err.code !== "EEXIST") throw err;
    const age = Date.now() - statSync(lockDir).mtimeMs;
    if (age < LOCK_STALE_MS) { console.log(`instagram-studio: ${key}, another session is installing, skipping`); return; }
    rmSync(lockDir, { recursive: true, force: true });
    mkdirSync(lockDir, { recursive: false });
  }

  const tmp = `${destDir}.tmp-${process.pid}`;
  try {
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    for (const rel of listFiles(srcDir)) {
      const to = path.join(tmp, rel);
      mkdirSync(path.dirname(to), { recursive: true });
      copyFileSync(path.join(srcDir, rel), to);
    }
    if (existsSync(path.join(tmp, "package-lock.json"))) {
      // A failing or offline npm throws out to the outer catch: the swap never happens,
      // the data dir keeps whatever it had, and the next session tries again.
      execFileSync("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], { cwd: tmp, stdio: ["ignore", "ignore", "inherit"] });
    }
    writeFileSync(path.join(tmp, ".fingerprint"), fp);
    const old = `${destDir}.old-${process.pid}`;
    if (existsSync(destDir)) renameSync(destDir, old);
    renameSync(tmp, destDir);
    rmSync(old, { recursive: true, force: true });
    console.log(`instagram-studio: ${key} deps installed`);
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
    rmSync(tmp, { recursive: true, force: true });
  }
}

function main() {
  mkdirSync(DATA, { recursive: true }); // before any lock: the lock directory lives inside it
  for (const tree of trees) syncTree(tree);
}

try {
  main();
} catch (err) {
  console.error(`instagram-studio: bootstrap skipped, ${err.message}`);
}

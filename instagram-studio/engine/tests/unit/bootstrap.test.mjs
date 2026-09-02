import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP = path.resolve(here, "../../../scripts/bootstrap.mjs");
const FIXTURE = path.resolve(here, "../fixtures/fake-plugin");

function makeCase() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "ig-bootstrap-"));
  const root = path.join(tmp, "root");
  const data = path.join(tmp, "data");
  cpSync(FIXTURE, root, { recursive: true });
  mkdirSync(data, { recursive: true });
  return { tmp, root, data };
}

function run({ root, data }, extraEnv = {}) {
  return execFileSync(process.execPath, [BOOTSTRAP], {
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: root, CLAUDE_PLUGIN_DATA: data, ...extraEnv },
    encoding: "utf8",
  });
}

test("first run copies the engine, installs deps and writes a fingerprint", () => {
  const c = makeCase();
  const out = run(c);
  assert.match(out, /deps installed/);
  assert.ok(existsSync(path.join(c.data, "engine", "ig.mjs")));
  assert.ok(existsSync(path.join(c.data, "engine", ".fingerprint")));
  rmSync(c.tmp, { recursive: true, force: true });
});

test("second run with unchanged source is a no-op", () => {
  const c = makeCase();
  run(c);
  const out = run(c);
  assert.match(out, /up to date/);
  rmSync(c.tmp, { recursive: true, force: true });
});

test("a changed source re-installs", () => {
  const c = makeCase();
  run(c);
  const before = readFileSync(path.join(c.data, "engine", ".fingerprint"), "utf8");
  writeFileSync(path.join(c.root, "engine", "ig.mjs"), 'console.log("fake engine v2");\n');
  const out = run(c);
  assert.match(out, /deps installed/);
  const after = readFileSync(path.join(c.data, "engine", ".fingerprint"), "utf8");
  assert.notEqual(before, after);
  assert.match(readFileSync(path.join(c.data, "engine", "ig.mjs"), "utf8"), /v2/);
  rmSync(c.tmp, { recursive: true, force: true });
});

test("tests and node_modules are never copied into the data dir", () => {
  const c = makeCase();
  mkdirSync(path.join(c.root, "engine", "tests"), { recursive: true });
  writeFileSync(path.join(c.root, "engine", "tests", "x.test.mjs"), "// nothing\n");
  run(c);
  assert.equal(existsSync(path.join(c.data, "engine", "tests")), false);
  rmSync(c.tmp, { recursive: true, force: true });
});

test("a missing source tree is skipped, not fatal", () => {
  const c = makeCase();
  rmSync(path.join(c.root, "engine"), { recursive: true, force: true });
  const out = run(c);
  assert.match(out, /source missing/);
  rmSync(c.tmp, { recursive: true, force: true });
});

test("a fresh lock directory makes the run stand down", () => {
  const c = makeCase();
  mkdirSync(path.join(c.data, "engine.lock"), { recursive: true });
  const out = run(c);
  assert.match(out, /another session is installing/);
  assert.equal(existsSync(path.join(c.data, "engine", "ig.mjs")), false);
  rmSync(c.tmp, { recursive: true, force: true });
});

test("no plugin context exits 0 and does nothing", () => {
  const out = execFileSync(process.execPath, [BOOTSTRAP], {
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: "", CLAUDE_PLUGIN_DATA: "" },
    encoding: "utf8",
  });
  assert.equal(out, "");
});

test("a data dir that cannot be created is logged and still exits 0", () => {
  const c = makeCase();
  const blocker = path.join(c.tmp, "not-a-directory");
  writeFileSync(blocker, "a file where the data dir should be\n");
  // execFileSync throws on a non-zero exit, so reaching the assertions proves exit 0.
  const out = execFileSync(process.execPath, [BOOTSTRAP], {
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: c.root, CLAUDE_PLUGIN_DATA: path.join(blocker, "data") },
    encoding: "utf8",
  });
  assert.equal(out, "");
  rmSync(c.tmp, { recursive: true, force: true });
});

test("a failing npm is logged, exits 0 and leaves the engine unsynced", () => {
  const c = makeCase();
  const bin = path.join(c.tmp, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, "npm"), "#!/bin/sh\necho 'npm failed on purpose' >&2\nexit 1\n", { mode: 0o755 });
  const out = run(c, { PATH: `${bin}:${process.env.PATH}` });
  assert.equal(out.includes("deps installed"), false);
  assert.equal(existsSync(path.join(c.data, "engine", ".fingerprint")), false);
  rmSync(c.tmp, { recursive: true, force: true });
});

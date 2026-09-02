import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  findRepo, parseConfig, parseEnv, serializeEnv, readEnv, writeEnv, updateEnv, requireSecrets, paths,
  SECRET_KEYS, PUBLISH_KEYS, EXCHANGE_KEYS, REFRESH_KEYS,
} from "../../lib/config.mjs";

const tmpdir = () => mkdtempSync(path.join(os.tmpdir(), "ig-config-"));

test("findRepo walks up to the nearest instagram/config.json", () => {
  const tmp = tmpdir();
  const repo = path.join(tmp, "repo");
  const deep = path.join(repo, "content", "2026-09-02", "post-1");
  mkdirSync(deep, { recursive: true });
  mkdirSync(path.join(repo, "instagram"), { recursive: true });
  writeFileSync(path.join(repo, "instagram", "config.json"), "{}");
  assert.equal(findRepo(deep), repo);
  assert.equal(findRepo(tmp), null);
  rmSync(tmp, { recursive: true, force: true });
});

test("parseConfig fills defaults and sorts slots", () => {
  const cfg = parseConfig('{"slots":["17:30","08:30"]}');
  assert.deepEqual(cfg.slots, ["08:30", "17:30"]);
  assert.equal(cfg.root, "content");
  assert.equal(cfg.timezone, "Europe/London");
  assert.equal(cfg.maxLateMinutes, null);
});

test("parseConfig rejects a bad slot, empty slots, bad timezone and bad maxLateMinutes", () => {
  assert.throws(() => parseConfig('{"slots":["8:30"]}'), /not HH:MM/);
  assert.throws(() => parseConfig('{"slots":[]}'), /at least one/);
  assert.throws(() => parseConfig('{"slots":["08:30"],"timezone":""}'), /timezone/);
  assert.throws(() => parseConfig('{"slots":["08:30"],"maxLateMinutes":-5}'), /maxLateMinutes/);
  assert.throws(() => parseConfig("not json"), /not valid JSON/);
});

test("paths resolve the queue root and the log", () => {
  const p = paths("/repo", { root: "content" });
  assert.equal(p.rootDir, path.join("/repo", "content"));
  assert.equal(p.logPath, path.join("/repo", "instagram", "log.jsonl"));
});

test("env round trips and ignores comments, blanks, quotes and export", () => {
  const vars = parseEnv('# secrets\n\nexport IG_USER_ID=123\nIG_ACCESS_TOKEN="abc=def"\n');
  assert.deepEqual(vars, { IG_USER_ID: "123", IG_ACCESS_TOKEN: "abc=def" });
  assert.deepEqual(parseEnv(serializeEnv(vars)), vars);
});

test("writeEnv creates the file mode 600 and updateEnv merges", () => {
  const tmp = tmpdir();
  const envPath = path.join(tmp, "cfg", "env");
  writeEnv({ IG_USER_ID: "123" }, envPath);
  assert.equal(statSync(envPath).mode & 0o777, 0o600);
  const merged = updateEnv({ IG_ACCESS_TOKEN: "t" }, envPath);
  assert.deepEqual(merged, { IG_USER_ID: "123", IG_ACCESS_TOKEN: "t" });
  assert.equal(statSync(envPath).mode & 0o777, 0o600);
  assert.deepEqual(readEnv(envPath), merged);
  rmSync(tmp, { recursive: true, force: true });
});

test("updateEnv patches in place and leaves comments, blanks and unrelated lines alone", () => {
  const tmp = tmpdir();
  const envPath = path.join(tmp, "env");
  writeFileSync(envPath, "# instagram-studio secrets\n\nIG_USER_ID=123\nIG_ACCESS_TOKEN=short-lived\n", { mode: 0o600 });
  updateEnv({ IG_ACCESS_TOKEN: "long-lived", IG_TOKEN_EXPIRES_AT: "2026-11-01T00:00:00.000Z" }, envPath);
  assert.equal(
    readFileSync(envPath, "utf8"),
    "# instagram-studio secrets\n\nIG_USER_ID=123\nIG_ACCESS_TOKEN=long-lived\nIG_TOKEN_EXPIRES_AT=2026-11-01T00:00:00.000Z\n",
  );
  assert.equal(statSync(envPath).mode & 0o777, 0o600);
  rmSync(tmp, { recursive: true, force: true });
});

test("readEnv on a missing file is empty, requireSecrets names what is missing", () => {
  assert.deepEqual(readEnv("/nope/does/not/exist"), {});
  assert.throws(() => requireSecrets({ IG_USER_ID: "1" }, ["IG_USER_ID", "IG_ACCESS_TOKEN"]), /IG_ACCESS_TOKEN/);
  assert.doesNotThrow(() => requireSecrets({ IG_USER_ID: "1" }, ["IG_USER_ID"]));
});

test("every command key list is a subset of SECRET_KEYS", () => {
  assert.equal(SECRET_KEYS.length, 6);
  for (const list of [PUBLISH_KEYS, EXCHANGE_KEYS, REFRESH_KEYS]) {
    assert.ok(list.length > 0);
    for (const key of list) assert.ok(SECRET_KEYS.includes(key), `${key} is not a known secret key`);
  }
});

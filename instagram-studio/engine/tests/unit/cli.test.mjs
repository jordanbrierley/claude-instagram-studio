import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { main } from "../../ig.mjs";
import { makeRepo, ready } from "../helpers/tmp-repo.mjs";
import { createGraphClient } from "../../lib/graph.mjs";
import { createBlobStore } from "../../lib/blob.mjs";
import { readLog } from "../../lib/queue.mjs";
import { SPACING_MS } from "../../lib/publish.mjs";
import { makeFakeGraph, noSleep } from "../helpers/fake-graph.mjs";
import { makeFakeBlob } from "../helpers/fake-blob.mjs";

// Photos, not reels: the CLI builds a real `makeFfprobe()`, and a stub mp4 is an
// error on any machine that has ffprobe installed (Task 5). An image needs no probe,
// so these tests behave the same with ffmpeg installed and without it.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
// Every test pins the clock to 13:00 on a BST day: two of the three slots have
// passed, so counts, ordering and the candidate list are asserted unconditionally
// rather than "if the suite happens to run after 08:30".
const NOW = new Date("2026-09-02T13:00:00+01:00");

function capture(now = NOW) {
  const lines = [];
  return {
    io: { log: (m) => lines.push(String(m)), error: (m) => lines.push(String(m)), now: () => now },
    text: () => lines.join("\n"),
  };
}

const twoReady = () => makeRepo(
  { "2026-09-01/a": ready({ media: ["photo.jpg"] }), "2026-09-02/b": ready({ media: ["photo.jpg"] }) },
  {},
  { "2026-09-01/a/photo.jpg": JPEG, "2026-09-02/b/photo.jpg": JPEG },
);

test("due --json reports the counts and the ordered candidates", async () => {
  const repo = twoReady();
  const out = capture();
  const code = await main(["due", "--repo", repo, "--json"], out.io);
  assert.equal(code, 0);
  const report = JSON.parse(out.text());
  assert.equal(report.readyCount, 2);
  assert.equal(report.slotsPassed, 2);
  assert.equal(report.publishedToday, 0);
  assert.equal(report.dueCount, 2);
  assert.deepEqual(report.candidates.map((c) => c.rel), ["2026-09-01/a", "2026-09-02/b"]);
  assert.match(report.engine, /ig\.mjs$/);
  rmSync(repo, { recursive: true, force: true });
});

test("due prints the engine path first, then the repo, the timezone and the queue", async () => {
  const repo = twoReady();
  const out = capture();
  await main(["due", "--repo", repo], out.io);
  const lines = out.text().split("\n");
  assert.match(lines[0], /^engine: .*ig\.mjs$/);
  assert.match(out.text(), /slots passed today: 2 of 3/);
  assert.match(out.text(), /Europe\/London/);
  assert.match(out.text(), /1\. 2026-09-01\/a/);
  assert.match(out.text(), /2\. 2026-09-02\/b/);
  rmSync(repo, { recursive: true, force: true });
});

test("validate exits 1 and names the broken post", async () => {
  const repo = makeRepo({ "2026-09-01/a": ready({ media: ["photo.jpg"] }) }); // the file is missing
  const out = capture();
  const code = await main(["validate", "--repo", repo], out.io);
  assert.equal(code, 1);
  assert.match(out.text(), /2026-09-01\/a/);
  assert.match(out.text(), /not found/);
  rmSync(repo, { recursive: true, force: true });
});

test("validate exits 0 on a clean queue", async () => {
  const repo = twoReady();
  const out = capture();
  assert.equal(await main(["validate", "--repo", repo], out.io), 0);
  assert.match(out.text(), /2 ok, 0 to fix/);
  rmSync(repo, { recursive: true, force: true });
});

test("publish --dry-run lists the candidates it would publish and needs no secrets", async () => {
  const repo = twoReady();
  const out = capture();
  const code = await main(["publish", "--repo", repo, "--dry-run"], out.io);
  assert.equal(code, 0);
  assert.match(out.text(), /dry run: 2 post\(s\) would publish/);
  assert.match(out.text(), /2026-09-01\/a {2}photo/);
  assert.match(out.text(), /2026-09-02\/b {2}photo/);
  rmSync(repo, { recursive: true, force: true });
});

test("publish --now resolves one folder and dry runs just that post", async () => {
  const repo = twoReady();
  const out = capture();
  const code = await main(["publish", "--repo", repo, "--now", path.join(repo, "content", "2026-09-02", "b"), "--dry-run"], out.io);
  assert.equal(code, 0);
  assert.match(out.text(), /dry run: 1 post\(s\) would publish/);
  assert.match(out.text(), /2026-09-02\/b/);
  assert.equal(out.text().includes("2026-09-01/a"), false);
  rmSync(repo, { recursive: true, force: true });
});

test("publish --now on a post that is not ready fails before any secrets are read", async () => {
  // No IG_ENV_FILE is set for this test: the status guard in cmdPublish runs before
  // readEnv/needSecrets, so this fails on the status check alone, secrets file or not.
  const repo = makeRepo(
    { "2026-09-01/a": ready({ media: ["photo.jpg"], status: "posted" }) },
    {},
    { "2026-09-01/a/photo.jpg": JPEG },
  );
  const out = capture();
  const code = await main(["publish", "--repo", repo, "--now", path.join(repo, "content", "2026-09-01", "a")], out.io);
  assert.equal(code, 2);
  assert.match(out.text(), /2026-09-01\/a/);
  assert.match(out.text(), /posted/);
  assert.match(out.text(), /ready/);
  rmSync(repo, { recursive: true, force: true });
});

test("publish with no secrets file exits 2 with a clean ig-setup message, no stack trace", async () => {
  const repo = twoReady();
  const dir = mkdtempSync(path.join(os.tmpdir(), "ig-nosecrets-"));
  const envFile = path.join(dir, "env"); // fresh dir, file itself does not exist
  const previous = process.env.IG_ENV_FILE;
  process.env.IG_ENV_FILE = envFile;
  const out = capture();
  const code = await main(["publish", "--repo", repo], out.io);
  process.env.IG_ENV_FILE = previous;
  assert.equal(code, 2);
  assert.match(out.text(), /^ig: missing/m);
  assert.match(out.text(), /\/ig-setup/);
  assert.doesNotMatch(out.text(), /^ {4}at /m);
  rmSync(dir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

test("no repo above the cwd is a run-level failure", async () => {
  const empty = mkdtempSync(path.join(os.tmpdir(), "ig-empty-"));
  const out = capture();
  assert.equal(await main(["due", "--repo", empty], out.io), 2);
  assert.match(out.text(), /instagram\/config\.json/);
  rmSync(empty, { recursive: true, force: true });
});

test("a broken config is a run-level failure with a readable message", async () => {
  const repo = makeRepo({}, { slots: ["8:30"] });
  const out = capture();
  assert.equal(await main(["due", "--repo", repo], out.io), 2);
  assert.match(out.text(), /not HH:MM/);
  rmSync(repo, { recursive: true, force: true });
});

test("token status reads the secrets file named by IG_ENV_FILE and never prints the token", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ig-token-"));
  const envFile = path.join(dir, "env");
  writeFileSync(envFile, "IG_USER_ID=123\nIG_ACCESS_TOKEN=secret-token-abc123\nIG_TOKEN_EXPIRES_AT=2026-11-01T00:00:00.000Z\n", { mode: 0o600 });
  const previous = process.env.IG_ENV_FILE;
  process.env.IG_ENV_FILE = envFile;
  const out = capture();
  const code = await main(["token", "status"], out.io);
  process.env.IG_ENV_FILE = previous;
  assert.equal(code, 0);
  assert.match(out.text(), /2026-11-01/);
  assert.equal(out.text().includes("secret-token-abc123"), false);
  rmSync(dir, { recursive: true, force: true });
});

test("ig launchd prints a plist for the repo slots", async () => {
  const repo = makeRepo({});
  const out = capture();
  assert.equal(await main(["launchd", "--repo", repo, "--log-dir", "/tmp/ig-logs"], out.io), 0);
  assert.match(out.text(), /<key>StartCalendarInterval<\/key>/);
  assert.equal((out.text().match(/<key>Hour<\/key>/g) ?? []).length, 3);
  assert.match(out.text(), /\/tmp\/ig-logs\/out\.log/);
  assert.match(out.text(), /ig\.mjs<\/string>/); // the plist points at this engine
  rmSync(repo, { recursive: true, force: true });
});

test("ig launchd takes the node path from --node when it is given", async () => {
  const repo = makeRepo({});
  const out = capture();
  assert.equal(await main(["launchd", "--repo", repo, "--node", "/opt/homebrew/bin/node"], out.io), 0);
  assert.match(out.text(), /<string>\/opt\/homebrew\/bin\/node<\/string>/);
  rmSync(repo, { recursive: true, force: true });
});

test("publish runs the real (non-dry-run) path end to end through io.makeDeps", async () => {
  const repo = twoReady();
  const dir = mkdtempSync(path.join(os.tmpdir(), "ig-publish-real-"));
  const envFile = path.join(dir, "env");
  writeFileSync(envFile, [
    "IG_USER_ID=17841400000000000",
    "IG_ACCESS_TOKEN=tok",
    "BLOB_READ_WRITE_TOKEN=blob-tok",
    "IG_TOKEN_EXPIRES_AT=2099-01-01T00:00:00.000Z", // far future: ensureToken never refreshes
  ].join("\n") + "\n", { mode: 0o600 });
  const previous = process.env.IG_ENV_FILE;
  process.env.IG_ENV_FILE = envFile;

  const fakeGraph = makeFakeGraph();
  const fakeBlob = makeFakeBlob();
  const slept = [];
  const out = capture();
  out.io.makeDeps = async ({ env, probe }) => ({
    graph: createGraphClient({ fetch: fakeGraph.fetchImpl, userId: env.IG_USER_ID, accessToken: env.IG_ACCESS_TOKEN, sleep: noSleep }),
    blob: createBlobStore({ put: fakeBlob.put, del: fakeBlob.del, token: env.BLOB_READ_WRITE_TOKEN }),
    probe,
    sleep: async (ms) => { slept.push(ms); },
    now: () => NOW,
  });

  const code = await main(["publish", "--repo", repo], out.io);
  process.env.IG_ENV_FILE = previous;

  assert.equal(code, 0);
  const postA = JSON.parse(readFileSync(path.join(repo, "content", "2026-09-01", "a", "post.json"), "utf8"));
  const postB = JSON.parse(readFileSync(path.join(repo, "content", "2026-09-02", "b", "post.json"), "utf8"));
  assert.equal(postA.status, "posted");
  assert.equal(postB.status, "posted");
  assert.equal(readLog(path.join(repo, "instagram", "log.jsonl")).length, 2);
  assert.deepEqual(slept, [SPACING_MS]);

  rmSync(dir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

test("an unknown command prints usage and exits 2", async () => {
  const out = capture();
  assert.equal(await main(["frobnicate"], out.io), 2);
  assert.match(out.text(), /Usage: ig/);
});

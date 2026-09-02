import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { publishOne, runPublish, SPACING_MS, RATE_LIMIT } from "../../lib/publish.mjs";
import { createGraphClient } from "../../lib/graph.mjs";
import { createBlobStore } from "../../lib/blob.mjs";
import { findPosts, readLog, appendLog } from "../../lib/queue.mjs";
import { makeQueue, ready } from "../helpers/tmp-repo.mjs";
import { makeFakeGraph, noSleep } from "../helpers/fake-graph.mjs";
import { makeFakeBlob } from "../helpers/fake-blob.mjs";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const MP4 = Buffer.alloc(64);
const goodProbe = async () => ({ durationSec: 30, width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac" });

function harness(rootDir, { graphOptions = {}, blobOptions = {} } = {}) {
  const fakeGraph = makeFakeGraph(graphOptions);
  const fakeBlob = makeFakeBlob(blobOptions);
  const slept = [];
  const deps = {
    graph: createGraphClient({ fetch: fakeGraph.fetchImpl, userId: "1784140", accessToken: "tok", sleep: noSleep }),
    blob: createBlobStore({ put: fakeBlob.put, del: fakeBlob.del, token: "blob" }),
    probe: goodProbe,
    logPath: path.join(rootDir, "instagram", "log.jsonl"),
    sleep: async (ms) => { slept.push(ms); },
    now: () => new Date("2026-09-02T08:31:00+01:00"),
    pollIntervalMs: 1,
  };
  return { deps, fakeGraph, fakeBlob, slept };
}

test("a reel publishes, writes back, logs and cleans up its blob", async () => {
  const rootDir = makeQueue({ "a/1": ready() }, { "a/1/asset.mp4": MP4 });
  const [entry] = findPosts(rootDir);
  const { deps, fakeBlob } = harness(rootDir);

  const result = await publishOne(entry, deps);
  assert.equal(result.result, "posted");
  assert.equal(result.kind, "reel");
  assert.equal(result.url, "https://www.instagram.com/reel/ABC/");

  const post = JSON.parse(readFileSync(entry.jsonPath, "utf8"));
  assert.equal(post.status, "posted");
  assert.equal(post.url, "https://www.instagram.com/reel/ABC/");
  assert.equal(post.postedAt, "2026-09-02T07:31:00.000Z");
  assert.equal(post.error, null);

  const log = readLog(deps.logPath);
  assert.equal(log.length, 1);
  assert.equal(log[0].result, "posted");
  assert.equal(log[0].kind, "reel");
  assert.equal(log[0].mediaId, "media-1");
  assert.equal(log[0].pinned, false);

  assert.equal(fakeBlob.uploads.length, 1);
  assert.equal(fakeBlob.deletes.length, 1);
  rmSync(rootDir, { recursive: true, force: true });
});

test("a pinned post logs pinned true, so it does not spend a slot next run", async () => {
  const rootDir = makeQueue({ "a/1": ready({ scheduledFor: "2026-09-02T08:00:00+01:00" }) }, { "a/1/asset.mp4": MP4 });
  const [entry] = findPosts(rootDir);
  const { deps } = harness(rootDir);

  const result = await publishOne(entry, deps);
  assert.equal(result.result, "posted");
  assert.equal(readLog(deps.logPath)[0].pinned, true);
  rmSync(rootDir, { recursive: true, force: true });
});

test("a carousel creates one child per slide then a parent with the children", async () => {
  const rootDir = makeQueue({ "a/1": ready({ media: ["a.jpg", "b.jpg"] }) }, { "a/1/a.jpg": JPEG, "a/1/b.jpg": JPEG });
  const [entry] = findPosts(rootDir);
  const { deps, fakeGraph, fakeBlob } = harness(rootDir);

  const result = await publishOne(entry, deps);
  assert.equal(result.result, "posted");
  assert.equal(result.kind, "carousel");
  const creates = fakeGraph.calls.filter((c) => c.method === "POST" && c.path.endsWith("/media"));
  assert.equal(creates.length, 3);
  assert.equal(creates[0].params.is_carousel_item, "true");
  assert.equal(creates[2].params.media_type, "CAROUSEL");
  assert.equal(creates[2].params.children, "container-1,container-2");
  assert.equal(fakeBlob.uploads.length, 2);
  assert.equal(fakeBlob.deletes.length, 2);
  rmSync(rootDir, { recursive: true, force: true });
});

test("a container that errors marks the post failed, keeps the run alive and still deletes the blob", async () => {
  const rootDir = makeQueue({ "a/1": ready() }, { "a/1/asset.mp4": MP4 });
  const [entry] = findPosts(rootDir);
  const { deps, fakeBlob } = harness(rootDir, { graphOptions: { statusSequence: ["ERROR"] } });

  const result = await publishOne(entry, deps);
  assert.equal(result.result, "failed");
  assert.match(result.error, /ERROR/);
  const post = JSON.parse(readFileSync(entry.jsonPath, "utf8"));
  assert.equal(post.status, "failed");
  assert.match(post.error, /ERROR/);
  assert.equal(post.url, null);
  assert.equal(fakeBlob.deletes.length, 1);
  assert.equal(readLog(deps.logPath)[0].result, "failed");
  rmSync(rootDir, { recursive: true, force: true });
});

test("a failed upload cleans up whatever landed first", async () => {
  const rootDir = makeQueue({ "a/1": ready({ media: ["a.jpg", "b.jpg"] }) }, { "a/1/a.jpg": JPEG, "a/1/b.jpg": JPEG });
  const [entry] = findPosts(rootDir);
  const { deps, fakeBlob } = harness(rootDir, { blobOptions: { failOn: "b.jpg" } });

  const result = await publishOne(entry, deps);
  assert.equal(result.result, "failed");
  assert.match(result.error, /blob upload failed/);
  assert.equal(fakeBlob.deletes.length, 1);
  rmSync(rootDir, { recursive: true, force: true });
});

test("an invalid post fails without uploading anything", async () => {
  const rootDir = makeQueue({ "a/1": ready() }); // asset.mp4 missing
  const [entry] = findPosts(rootDir);
  const { deps, fakeBlob } = harness(rootDir);

  const result = await publishOne(entry, deps);
  assert.equal(result.result, "failed");
  assert.match(result.error, /not found/);
  assert.equal(fakeBlob.uploads.length, 0);
  assert.equal(JSON.parse(readFileSync(entry.jsonPath, "utf8")).status, "failed");
  rmSync(rootDir, { recursive: true, force: true });
});

test("runPublish waits 60 seconds between publishes and never before the first", async () => {
  const rootDir = makeQueue(
    { "a/1": ready(), "a/2": ready(), "a/3": ready() },
    { "a/1/asset.mp4": MP4, "a/2/asset.mp4": MP4, "a/3/asset.mp4": MP4 },
  );
  const candidates = findPosts(rootDir);
  const { deps, slept } = harness(rootDir);

  const results = await runPublish({ candidates, deps });
  assert.deepEqual(results.map((r) => r.result), ["posted", "posted", "posted"]);
  assert.deepEqual(slept, [SPACING_MS, SPACING_MS]);
  assert.equal(readLog(deps.logPath).length, 3);
  rmSync(rootDir, { recursive: true, force: true });
});

test("one bad post does not stop the ones behind it", async () => {
  const rootDir = makeQueue({ "a/1": ready(), "a/2": ready() }, { "a/2/asset.mp4": MP4 }); // a/1 media missing
  const candidates = findPosts(rootDir);
  const { deps } = harness(rootDir);

  const results = await runPublish({ candidates, deps });
  assert.deepEqual(results.map((r) => r.result), ["failed", "posted"]);
  rmSync(rootDir, { recursive: true, force: true });
});

test("an unwritable post.json is an io-error event, not a dead run", async () => {
  const rootDir = makeQueue({ "a/1": ready(), "a/2": ready() }, { "a/1/asset.mp4": MP4, "a/2/asset.mp4": MP4 });
  const [first, second] = findPosts(rootDir);
  const events = [];
  const { deps } = harness(rootDir);
  // Point the write-back at the post directory itself: writing there throws EISDIR.
  const unwritable = { ...first, jsonPath: first.dir };

  const results = await runPublish({ candidates: [unwritable, second], deps: { ...deps, onEvent: (e) => events.push(e) } });
  assert.deepEqual(results.map((r) => r.result), ["posted", "posted"]);
  assert.equal(events.filter((e) => e.type === "io-error").length, 1);
  assert.equal(events.find((e) => e.type === "io-error").path, first.dir);
  assert.equal(JSON.parse(readFileSync(second.jsonPath, "utf8")).status, "posted");
  rmSync(rootDir, { recursive: true, force: true });
});

test("25 posts in the trailing 24 hours stops the run and leaves the queue ready", async () => {
  const rootDir = makeQueue({ "a/1": ready(), "a/2": ready() }, { "a/1/asset.mp4": MP4, "a/2/asset.mp4": MP4 });
  const candidates = findPosts(rootDir);
  const events = [];
  const { deps, fakeBlob } = harness(rootDir);
  for (let i = 0; i < RATE_LIMIT; i += 1) {
    appendLog(deps.logPath, { ts: "2026-09-02T02:00:00+01:00", postDir: `old/${i}`, kind: "photo", result: "posted", pinned: false });
  }

  const results = await runPublish({ candidates, deps: { ...deps, onEvent: (e) => events.push(e) } });
  assert.deepEqual(results, []);
  assert.equal(fakeBlob.uploads.length, 0);
  assert.equal(events.filter((e) => e.type === "rate-limit-guard").length, 1);
  const log = readLog(deps.logPath);
  assert.equal(log.at(-1).result, "skipped-rate-limit");
  assert.equal(JSON.parse(readFileSync(candidates[0].jsonPath, "utf8")).status, "ready");
  rmSync(rootDir, { recursive: true, force: true });
});

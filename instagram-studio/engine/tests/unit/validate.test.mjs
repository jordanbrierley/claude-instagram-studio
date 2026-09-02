import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { postKind, validatePost, validateAll, makeFfprobe, LIMITS } from "../../lib/validate.mjs";
import { findPosts } from "../../lib/queue.mjs";
import { makeQueue, ready } from "../helpers/tmp-repo.mjs";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const MP4 = Buffer.alloc(1024);
const goodProbe = async () => ({ durationSec: 30, width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac" });
const noProbe = async () => null; // ffprobe is not installed
const brokenFileProbe = async (file) => { throw new Error(`ffprobe could not read ${path.basename(file)}`); };

test("postKind maps media lists to container kinds", () => {
  assert.equal(postKind(["a.mp4"]), "reel");
  assert.equal(postKind(["a.jpg"]), "photo");
  assert.equal(postKind(["a.png"]), "photo");
  assert.equal(postKind(["a.jpg", "b.png"]), "carousel");
  assert.equal(postKind(Array.from({ length: 10 }, (_, i) => `${i}.jpg`)), "carousel");
  assert.equal(postKind(Array.from({ length: 11 }, (_, i) => `${i}.jpg`)), null);
  assert.equal(postKind(["a.mp4", "b.jpg"]), null);
  assert.equal(postKind(["a.mp4", "b.mp4"]), null);
  assert.equal(postKind(["a.gif"]), null);
  assert.equal(postKind([]), null);
});

test("a valid reel passes", async () => {
  const rootDir = makeQueue({ "a/1": ready() }, { "a/1/asset.mp4": MP4 });
  const [entry] = findPosts(rootDir);
  const result = await validatePost(entry, { probe: goodProbe });
  assert.equal(result.ok, true);
  assert.equal(result.kind, "reel");
  assert.deepEqual(result.errors, []);
  rmSync(rootDir, { recursive: true, force: true });
});

test("a missing media file fails", async () => {
  const rootDir = makeQueue({ "a/1": ready() });
  const [entry] = findPosts(rootDir);
  const result = await validatePost(entry, { probe: goodProbe });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /asset\.mp4.*not found/);
  rmSync(rootDir, { recursive: true, force: true });
});

test("an unparseable post.json fails with the parse error", async () => {
  const rootDir = makeQueue({ "a/1": "{ nope" });
  const [entry] = findPosts(rootDir);
  const result = await validatePost(entry, { probe: goodProbe });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /post\.json does not parse/);
  rmSync(rootDir, { recursive: true, force: true });
});

test("caption limits are enforced", async () => {
  const long = "x".repeat(LIMITS.caption + 1);
  const tags = Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(" ");
  const rootDir = makeQueue(
    { "a/1": ready({ caption: long }), "a/2": ready({ caption: tags }) },
    { "a/1/asset.mp4": MP4, "a/2/asset.mp4": MP4 },
  );
  const results = await validateAll(findPosts(rootDir), { probe: goodProbe });
  assert.match(results[0].errors.join(" "), /caption is 2201 characters/);
  assert.match(results[1].errors.join(" "), /31 hashtags/);
  rmSync(rootDir, { recursive: true, force: true });
});

test("video rules come from the probe, and a missing probe warns instead of failing", async () => {
  const rootDir = makeQueue({ "a/1": ready() }, { "a/1/asset.mp4": MP4 });
  const [entry] = findPosts(rootDir);

  const square = await validatePost(entry, { probe: async () => ({ durationSec: 30, width: 1080, height: 1080, videoCodec: "h264", audioCodec: "aac" }) });
  assert.match(square.errors.join(" "), /9:16/);

  const long = await validatePost(entry, { probe: async () => ({ durationSec: 1200, width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac" }) });
  assert.match(long.errors.join(" "), /longer than 15 minutes/);

  const codec = await validatePost(entry, { probe: async () => ({ durationSec: 30, width: 1080, height: 1920, videoCodec: "hevc", audioCodec: "aac" }) });
  assert.match(codec.errors.join(" "), /H\.264/);

  const skipped = await validatePost(entry, { probe: noProbe });
  assert.equal(skipped.ok, true);
  assert.match(skipped.warnings.join(" "), /ffprobe unavailable, skipped the video checks/);
  rmSync(rootDir, { recursive: true, force: true });
});

test("a video ffprobe cannot read is an error, not a skipped check", async () => {
  const rootDir = makeQueue({ "a/1": ready() }, { "a/1/asset.mp4": MP4 });
  const [entry] = findPosts(rootDir);
  const result = await validatePost(entry, { probe: brokenFileProbe });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /ffprobe could not read asset\.mp4/);
  assert.deepEqual(result.warnings, []);
  rmSync(rootDir, { recursive: true, force: true });
});

test("makeFfprobe returns null for a missing ffprobe and rejects when ffprobe fails on the file", async () => {
  const missing = makeFfprobe((cmd, args, cb) => cb(Object.assign(new Error("spawn ffprobe ENOENT"), { code: "ENOENT" })));
  assert.equal(await missing("/tmp/asset.mp4"), null);

  const failed = makeFfprobe((cmd, args, cb) => cb(Object.assign(new Error("ffprobe exited 1"), { code: 1 })));
  await assert.rejects(() => failed("/tmp/asset.mp4"), /ffprobe could not read asset\.mp4/);

  const garbage = makeFfprobe((cmd, args, cb) => cb(null, "not json"));
  await assert.rejects(() => garbage("/tmp/asset.mp4"), /ffprobe could not read asset\.mp4/);

  const pathLeak = makeFfprobe((cmd, args, cb) => cb(Object.assign(new Error("Command failed: ffprobe -v error /private/tmp/secret-dir/asset.mp4"), { code: 1 })));
  try {
    await pathLeak("/tmp/asset.mp4");
    throw new Error("should have rejected");
  } catch (err) {
    assert.match(err.message, /ffprobe could not read asset\.mp4/);
    assert(!err.message.includes("secret-dir"), "path should not leak into error message");
  }
});

test("images must really be JPEG or PNG and within the size limit", async () => {
  const rootDir = makeQueue(
    { "a/1": ready({ media: ["a.jpg", "b.png"] }), "a/2": ready({ media: ["fake.jpg"] }) },
    { "a/1/a.jpg": JPEG, "a/1/b.png": PNG, "a/2/fake.jpg": Buffer.from("this is not an image") },
  );
  const results = await validateAll(findPosts(rootDir), { probe: goodProbe });
  assert.equal(results[0].ok, true);
  assert.equal(results[0].kind, "carousel");
  assert.match(results[1].errors.join(" "), /not a JPEG or PNG/);
  rmSync(rootDir, { recursive: true, force: true });
});

test("an oversized image fails", async () => {
  const rootDir = makeQueue({ "a/1": ready({ media: ["big.jpg"] }) });
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(LIMITS.imageBytes)]);
  writeFileSync(path.join(rootDir, "a/1/big.jpg"), big);
  const [entry] = findPosts(rootDir);
  const result = await validatePost(entry, { probe: goodProbe });
  assert.match(result.errors.join(" "), /larger than 8 MB/);
  rmSync(rootDir, { recursive: true, force: true });
});

test("bad status, bad scheduledFor and a bad media combination all fail", async () => {
  const rootDir = makeQueue(
    {
      "a/1": ready({ status: "pending" }),
      "a/2": ready({ scheduledFor: "next tuesday" }),
      "a/3": ready({ media: ["a.mp4", "b.jpg"] }),
    },
    { "a/1/asset.mp4": MP4, "a/2/asset.mp4": MP4, "a/3/a.mp4": MP4, "a/3/b.jpg": JPEG },
  );
  const results = await validateAll(findPosts(rootDir), { probe: goodProbe, statuses: null });
  assert.match(results[0].errors.join(" "), /status must be one of/);
  assert.match(results[1].errors.join(" "), /scheduledFor/);
  assert.match(results[2].errors.join(" "), /one mp4/);
  rmSync(rootDir, { recursive: true, force: true });
});

test("a post.json with no status is reported as status missing, by default too", async () => {
  const rootDir = makeQueue(
    { "a/1": { media: ["asset.mp4"], caption: "hello" }, "a/2": ready({ status: null }) },
    { "a/1/asset.mp4": MP4, "a/2/asset.mp4": MP4 },
  );
  const results = await validateAll(findPosts(rootDir), { probe: goodProbe });
  assert.equal(results.length, 2);
  assert.equal(results[0].ok, false);
  assert.match(results[0].errors.join(" "), /status missing/);
  assert.equal(results[1].ok, false);
  assert.match(results[1].errors.join(" "), /status missing/);
  rmSync(rootDir, { recursive: true, force: true });
});

test("a media path that escapes the post folder is rejected", async () => {
  const rootDir = makeQueue({ "a/1": ready({ media: ["../outside.jpg"] }) });
  const [entry] = findPosts(rootDir);
  const result = await validatePost(entry, { probe: goodProbe });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /escapes the post folder/);
  rmSync(rootDir, { recursive: true, force: true });
});

test("validateAll checks ready posts only by default", async () => {
  const rootDir = makeQueue({ "a/1": ready({ status: "posted", media: ["gone.mp4"] }), "a/2": ready() }, { "a/2/asset.mp4": MP4 });
  const results = await validateAll(findPosts(rootDir), { probe: goodProbe });
  assert.deepEqual(results.map((r) => r.rel), ["a/2"]);
  rmSync(rootDir, { recursive: true, force: true });
});

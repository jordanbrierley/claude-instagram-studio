import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { findPosts, readLog, appendLog, writePost, slotsPassedToday, publishedToday, selectCandidates, zonedParts } from "../../lib/queue.mjs";
import { makeQueue, ready } from "../helpers/tmp-repo.mjs";

const CONFIG = { root: "content", slots: ["08:30", "12:30", "17:30"], timezone: "Europe/London", maxLateMinutes: null };
// 2026-09-02 is BST, so Europe/London is UTC+1.
const at = (hhmm) => new Date(`2026-09-02T${hhmm}:00+01:00`);

test("zonedParts reports the local day and minutes past midnight", () => {
  const p = zonedParts(new Date("2026-09-02T23:30:00Z"), "Europe/London");
  assert.equal(p.day, "2026-09-03");
  assert.equal(p.minutes, 30);
});

test("slotsPassedToday counts slots at or before now", () => {
  const args = { slots: CONFIG.slots, timeZone: CONFIG.timezone, maxLateMinutes: null };
  assert.equal(slotsPassedToday({ ...args, now: at("08:00") }), 0);
  assert.equal(slotsPassedToday({ ...args, now: at("08:30") }), 1);
  assert.equal(slotsPassedToday({ ...args, now: at("13:00") }), 2);
  assert.equal(slotsPassedToday({ ...args, now: at("23:00") }), 3);
});

test("maxLateMinutes drops slots that passed too long ago", () => {
  const args = { slots: CONFIG.slots, timeZone: CONFIG.timezone, maxLateMinutes: 90 };
  assert.equal(slotsPassedToday({ ...args, now: at("09:30") }), 1);
  assert.equal(slotsPassedToday({ ...args, now: at("13:00") }), 1); // 08:30 is 4.5 h late, dropped
  assert.equal(slotsPassedToday({ ...args, now: at("23:00") }), 0);
});

test("publishedToday counts only unpinned posted lines from today in the configured zone", () => {
  const log = [
    { ts: "2026-09-02T07:45:00+01:00", result: "posted", pinned: false },
    { ts: "2026-09-02T09:00:00+01:00", result: "failed", pinned: false },
    { ts: "2026-09-02T10:15:00+01:00", result: "posted", pinned: true },
    { ts: "2026-09-01T18:00:00+01:00", result: "posted", pinned: false },
  ];
  assert.equal(publishedToday({ log, now: at("12:00"), timeZone: CONFIG.timezone }), 1);
});

test("findPosts finds every post.json, sorted by path, tolerating a broken file", () => {
  const rootDir = makeQueue({
    "2026-09-02/post-2": ready(),
    "2026-09-01/post-1": ready(),
    "2026-09-03/broken": "{ this is not json",
  });
  const posts = findPosts(rootDir);
  assert.deepEqual(posts.map((p) => p.rel), ["2026-09-01/post-1", "2026-09-02/post-2", "2026-09-03/broken"]);
  assert.equal(posts[2].post, null);
  assert.match(posts[2].parseError, /JSON/);
  rmSync(rootDir, { recursive: true, force: true });
});

test("one slot passed and nothing published yet picks the oldest ready post", () => {
  const rootDir = makeQueue({ "2026-09-01/post-1": ready(), "2026-09-02/post-2": ready() });
  const r = selectCandidates({ posts: findPosts(rootDir), config: CONFIG, now: at("09:00"), log: [] });
  assert.equal(r.slotsPassed, 1);
  assert.equal(r.dueCount, 1);
  assert.deepEqual(r.candidates.map((c) => c.rel), ["2026-09-01/post-1"]);
  rmSync(rootDir, { recursive: true, force: true });
});

test("waking after one missed slot publishes the backlog for both slots", () => {
  const rootDir = makeQueue({ "a/1": ready(), "a/2": ready(), "a/3": ready() });
  const r = selectCandidates({ posts: findPosts(rootDir), config: CONFIG, now: at("13:00"), log: [] });
  assert.deepEqual(r.candidates.map((c) => c.rel), ["a/1", "a/2"]);
  rmSync(rootDir, { recursive: true, force: true });
});

test("waking after three missed slots publishes three in one run", () => {
  const rootDir = makeQueue({ "a/1": ready(), "a/2": ready(), "a/3": ready(), "a/4": ready() });
  const r = selectCandidates({ posts: findPosts(rootDir), config: CONFIG, now: at("22:00"), log: [] });
  assert.equal(r.dueCount, 3);
  assert.deepEqual(r.candidates.map((c) => c.rel), ["a/1", "a/2", "a/3"]);
  rmSync(rootDir, { recursive: true, force: true });
});

test("already published today is subtracted, so a re-run is idempotent", () => {
  const rootDir = makeQueue({ "a/1": ready(), "a/2": ready() });
  const log = [
    { ts: "2026-09-02T08:31:00+01:00", result: "posted", pinned: false },
    { ts: "2026-09-02T12:31:00+01:00", result: "posted", pinned: false },
  ];
  const r = selectCandidates({ posts: findPosts(rootDir), config: CONFIG, now: at("13:00"), log });
  assert.equal(r.dueCount, 0);
  assert.deepEqual(r.candidates, []);
  rmSync(rootDir, { recursive: true, force: true });
});

test("a pinned publish in the log does not spend a slot", () => {
  const rootDir = makeQueue({ "a/1": ready(), "a/2": ready() });
  const log = [{ ts: "2026-09-02T08:45:00+01:00", result: "posted", postDir: "a/9", pinned: true }];
  const r = selectCandidates({ posts: findPosts(rootDir), config: CONFIG, now: at("13:00"), log });
  assert.equal(r.publishedToday, 0);
  assert.equal(r.slotDue, 2); // both slots still owe a post
  assert.deepEqual(r.candidates.map((c) => c.rel), ["a/1", "a/2"]);
  rmSync(rootDir, { recursive: true, force: true });
});

test("the due count never exceeds the ready posts on hand", () => {
  const rootDir = makeQueue({ "a/1": ready(), "a/2": ready({ status: "posted" }) });
  const r = selectCandidates({ posts: findPosts(rootDir), config: CONFIG, now: at("22:00"), log: [] });
  assert.equal(r.readyCount, 1);
  assert.equal(r.dueCount, 1);
  rmSync(rootDir, { recursive: true, force: true });
});

test("a due pinned post jumps the queue and is extra to the slot count", () => {
  const rootDir = makeQueue({
    "a/1": ready(),
    "a/2": ready({ scheduledFor: "2026-09-02T08:45:00+01:00" }),
    "a/3": ready({ scheduledFor: "2026-09-02T23:00:00+01:00" }),
  });
  const r = selectCandidates({ posts: findPosts(rootDir), config: CONFIG, now: at("09:00"), log: [] });
  assert.deepEqual(r.candidates.map((c) => c.rel), ["a/2", "a/1"]);
  assert.equal(r.pinnedDueCount, 1);
  assert.equal(r.slotDue, 1);
  rmSync(rootDir, { recursive: true, force: true });
});

test("a post with an unparseable scheduledFor is never a candidate", () => {
  const rootDir = makeQueue({ "a/1": ready({ scheduledFor: "next tuesday" }) });
  const r = selectCandidates({ posts: findPosts(rootDir), config: CONFIG, now: at("22:00"), log: [] });
  assert.deepEqual(r.candidates, []);
  rmSync(rootDir, { recursive: true, force: true });
});

test("a post.json with no status is not a candidate, nothing defaults to ready", () => {
  const rootDir = makeQueue({ "a/1": { media: ["asset.mp4"], caption: "hello" } });
  const posts = findPosts(rootDir);
  assert.equal(posts[0].post.status, undefined);
  const r = selectCandidates({ posts, config: CONFIG, now: at("22:00"), log: [] });
  assert.equal(r.readyCount, 0);
  assert.deepEqual(r.candidates, []);
  rmSync(rootDir, { recursive: true, force: true });
});

test("a post folder is a leaf, so a nested post.json is not a second post", () => {
  const rootDir = makeQueue({ "a/1": ready(), "a/1/drafts/old": ready() });
  assert.deepEqual(findPosts(rootDir).map((p) => p.rel), ["a/1"]);
  rmSync(rootDir, { recursive: true, force: true });
});

test("writePost merges and preserves unknown keys", () => {
  const rootDir = makeQueue({ "a/1": { ...ready(), notes: "keep me" } });
  const jsonPath = path.join(rootDir, "a/1/post.json");
  writePost(jsonPath, { status: "posted", url: "https://instagram.com/p/x" });
  const after = JSON.parse(readFileSync(jsonPath, "utf8"));
  assert.equal(after.status, "posted");
  assert.equal(after.notes, "keep me");
  assert.equal(after.caption, "hello");
  rmSync(rootDir, { recursive: true, force: true });
});

test("the log appends one JSON object per line and skips corrupt lines on read", () => {
  const rootDir = makeQueue({});
  const logPath = path.join(rootDir, "instagram", "log.jsonl");
  appendLog(logPath, { ts: "2026-09-02T08:31:00+01:00", result: "posted" });
  appendLog(logPath, { ts: "2026-09-02T12:31:00+01:00", result: "failed" });
  const entries = readLog(logPath);
  assert.equal(entries.length, 2);
  assert.equal(readLog(path.join(rootDir, "nope.jsonl")).length, 0);
  rmSync(rootDir, { recursive: true, force: true });
});

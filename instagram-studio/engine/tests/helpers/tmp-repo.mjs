import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Builds a throwaway queue root. `posts` maps a relative folder to either a
// post object or the literal string to write as post.json.
export function makeQueue(posts, files = {}) {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "ig-queue-"));
  for (const [rel, post] of Object.entries(posts)) {
    const dir = path.join(rootDir, rel);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "post.json"), typeof post === "string" ? post : JSON.stringify(post, null, 2) + "\n");
  }
  for (const [rel, contents] of Object.entries(files)) {
    const file = path.join(rootDir, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }
  return rootDir;
}

export const ready = (over = {}) => ({ media: ["asset.mp4"], caption: "hello", scheduledFor: null, status: "ready", postedAt: null, url: null, error: null, ...over });

// The same queue, wrapped in a repo: content/<rel> for every post and file, plus
// instagram/config.json. The CLI tests (Task 10) use this so there is one fixture
// builder in the suite, not two that can drift.
export function makeRepo(posts = {}, config = {}, files = {}) {
  const underRoot = (map) => Object.fromEntries(Object.entries(map).map(([rel, value]) => [path.join("content", rel), value]));
  const repoDir = makeQueue(underRoot(posts), underRoot(files));
  mkdirSync(path.join(repoDir, "instagram"), { recursive: true });
  writeFileSync(path.join(repoDir, "instagram", "config.json"), JSON.stringify({
    root: "content", slots: ["08:30", "12:30", "17:30"], timezone: "Europe/London", maxLateMinutes: null, ...config,
  }, null, 2) + "\n");
  return repoDir;
}

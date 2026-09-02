import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readEnv, ENV_PATH, PUBLISH_KEYS } from "../../lib/config.mjs";
import { createGraphClient, needsRefresh } from "../../lib/graph.mjs";
import { createBlobStore, loadVercelBlob } from "../../lib/blob.mjs";
import { makeFfprobe } from "../../lib/validate.mjs";
import { publishOne } from "../../lib/publish.mjs";
import { findPosts, readLog } from "../../lib/queue.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const enabled = process.env.IG_INTEGRATION === "1";

test("publishes a fixture photo to the real account", { skip: enabled ? false : "set IG_INTEGRATION=1 to run" }, async (t) => {
  const env = readEnv(process.env.IG_ENV_FILE || ENV_PATH);
  for (const key of PUBLISH_KEYS) {
    assert.ok(env[key], `${key} missing from the secrets file`);
  }
  // A token inside the refresh window is an environment condition, not a defect in
  // the code under test, so it skips with a message rather than failing the suite.
  if (needsRefresh(env.IG_TOKEN_EXPIRES_AT)) {
    t.skip("token is inside the 10 day refresh window, run ig token refresh first");
    return;
  }

  const rootDir = mkdtempSync(path.join(os.tmpdir(), "ig-integration-"));
  const postDir = path.join(rootDir, "integration-check");
  mkdirSync(postDir, { recursive: true });
  copyFileSync(path.join(here, "fixtures", "square.jpg"), path.join(postDir, "square.jpg"));
  writeFileSync(path.join(postDir, "post.json"), JSON.stringify({
    media: ["square.jpg"],
    caption: `instagram-studio integration check ${new Date().toISOString()}`,
    scheduledFor: null, status: "ready", postedAt: null, url: null, error: null,
  }, null, 2));

  const [entry] = findPosts(rootDir);
  const { put, del } = await loadVercelBlob();
  const logPath = path.join(rootDir, "log.jsonl");
  const result = await publishOne(entry, {
    graph: createGraphClient({ userId: env.IG_USER_ID, accessToken: env.IG_ACCESS_TOKEN }),
    blob: createBlobStore({ put, del, token: env.BLOB_READ_WRITE_TOKEN }),
    probe: makeFfprobe(), // the real one: a photo never invokes it, and nothing is stubbed here
    logPath,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    onEvent: (event) => console.error(`[${event.type}] ${event.rel} ${event.url ?? event.message ?? ""}`),
  });

  assert.equal(result.result, "posted", result.error ?? "");
  assert.match(result.url, /^https:\/\/www\.instagram\.com\//);
  assert.equal(JSON.parse(readFileSync(entry.jsonPath, "utf8")).status, "posted");
  assert.equal(readLog(logPath)[0].result, "posted");
  assert.equal(readLog(logPath)[0].pinned, false);

  // Cleanup is best effort: see the plan's Open Questions, the Instagram API with
  // Instagram Login has no documented endpoint for deleting or archiving a post.
  console.error(`\nDelete this test post by hand in the Instagram app: ${result.url}\n`);
  rmSync(rootDir, { recursive: true, force: true });
});

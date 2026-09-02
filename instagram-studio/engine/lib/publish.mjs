import path from "node:path";
import { validatePost } from "./validate.mjs";
import { writePost as writePostToDisk, appendLog as appendLogToDisk, readLog as readLogFromDisk } from "./queue.mjs";

export const SPACING_MS = 60 * 1000;
// Instagram's published-media limit: 25 per account per rolling 24 hours.
export const RATE_LIMIT = 25;
export const RATE_WINDOW_MS = 24 * 60 * 60 * 1000;

const isPinned = (entry) => Boolean(entry.post?.scheduledFor);

export function postedInLast24h({ log, now }) {
  const cutoff = now.getTime() - RATE_WINDOW_MS;
  return log.filter((line) => {
    if (!line || line.result !== "posted" || !line.ts) return false;
    const when = new Date(line.ts).getTime();
    return !Number.isNaN(when) && when >= cutoff;
  }).length;
}

export async function publishOne(entry, deps) {
  const {
    graph, blob, probe, logPath,
    now = () => new Date(),
    pollIntervalMs = 5000,
    pollTimeoutMs = 10 * 60 * 1000,
    onEvent = () => {},
    writePostFn = writePostToDisk,
    appendLogFn = appendLogToDisk,
  } = deps;

  // Both writes are guarded: a per-post IO failure is reported and the run carries on.
  const finish = ({ kind, result, mediaId = null, url = null, error = null }) => {
    const ts = now().toISOString();
    const outcome = { rel: entry.rel, kind, result, mediaId, url, error };
    try {
      if (entry.post) {
        writePostFn(entry.jsonPath, result === "posted"
          ? { status: "posted", postedAt: ts, url, error: null }
          : { status: "failed", error });
      }
    } catch (err) {
      onEvent({ type: "io-error", rel: entry.rel, path: entry.jsonPath, message: err.message });
      return outcome;
    }
    try {
      appendLogFn(logPath, { ts, postDir: entry.rel, kind, result, pinned: isPinned(entry), mediaId, url, error });
    } catch (err) {
      onEvent({ type: "io-error", rel: entry.rel, path: logPath, message: err.message });
    }
    return outcome;
  };

  const check = await validatePost(entry, { probe });
  for (const warning of check.warnings) onEvent({ type: "warning", rel: entry.rel, message: warning });
  if (!check.ok) {
    onEvent({ type: "invalid", rel: entry.rel, errors: check.errors });
    return finish({ kind: check.kind, result: "failed", error: check.errors.join("; ") });
  }

  const kind = check.kind;
  const caption = entry.post.caption ?? "";
  const uploaded = [];
  try {
    onEvent({ type: "start", rel: entry.rel, kind });
    for (const file of entry.post.media) {
      const local = path.resolve(entry.dir, file);
      uploaded.push(await blob.upload(local, [path.basename(entry.dir), path.basename(file)]));
    }

    let creationId;
    if (kind === "reel") {
      creationId = await graph.createReelContainer({ videoUrl: uploaded[0].url, caption });
    } else if (kind === "photo") {
      creationId = await graph.createImageContainer({ imageUrl: uploaded[0].url, caption });
    } else {
      const children = [];
      for (const item of uploaded) children.push(await graph.createCarouselItem({ imageUrl: item.url }));
      creationId = await graph.createCarouselContainer({ children, caption });
    }

    await graph.waitForFinished(creationId, { intervalMs: pollIntervalMs, timeoutMs: pollTimeoutMs });
    const mediaId = await graph.publish(creationId);
    const url = await graph.getPermalink(mediaId);
    onEvent({ type: "posted", rel: entry.rel, url });
    return finish({ kind, result: "posted", mediaId, url });
  } catch (err) {
    onEvent({ type: "failed", rel: entry.rel, message: err.message });
    return finish({ kind, result: "failed", error: err.message });
  } finally {
    // Always, on both paths: Instagram has ingested the media by the time the
    // container reports FINISHED, so the blobs are disposable from here on.
    const failures = await blob.remove(uploaded.map((item) => item.url));
    for (const failure of failures) onEvent({ type: "warning", rel: entry.rel, message: `blob cleanup failed for ${failure.url}` });
  }
}

export async function runPublish({ candidates, deps }) {
  const spacingMs = deps.spacingMs ?? SPACING_MS;
  const now = deps.now ?? (() => new Date());
  const onEvent = deps.onEvent ?? (() => {});
  const readLogFn = deps.readLogFn ?? readLogFromDisk;
  const appendLogFn = deps.appendLogFn ?? appendLogToDisk;
  const results = [];

  for (const [index, entry] of candidates.entries()) {
    // Re-read the log every time: this run has been adding to it, and a stale count
    // is exactly how a catch-up burst walks into the limit.
    const recent = postedInLast24h({ log: readLogFn(deps.logPath), now: now() });
    if (recent >= RATE_LIMIT) {
      const message = `${recent} posts in the last 24 hours, the Instagram limit is ${RATE_LIMIT}`;
      onEvent({ type: "rate-limit-guard", rel: entry.rel, posted: recent, message });
      appendLogFn(deps.logPath, {
        ts: now().toISOString(), postDir: entry.rel, kind: null,
        result: "skipped-rate-limit", pinned: isPinned(entry), mediaId: null, url: null, error: message,
      });
      break; // the rest of the queue stays ready and goes out on the next run
    }
    if (index > 0) await deps.sleep(spacingMs);
    results.push(await publishOne(entry, deps));
  }
  return results;
}

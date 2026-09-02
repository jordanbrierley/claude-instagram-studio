import { existsSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";

export const LIMITS = {
  caption: 2200,
  hashtags: 30,
  videoBytes: 1024 * 1024 * 1024,
  videoSeconds: 15 * 60,
  imageBytes: 8 * 1024 * 1024,
  aspectTolerance: 0.03,
};

const STATUSES = ["ready", "posted", "skipped", "failed"];
const IMAGE_EXT = [".jpg", ".jpeg", ".png"];
const TARGET_ASPECT = 9 / 16;

export function postKind(media) {
  if (!Array.isArray(media) || media.length === 0) return null;
  const ext = (file) => path.extname(String(file)).toLowerCase();
  const videos = media.filter((f) => ext(f) === ".mp4");
  const images = media.filter((f) => IMAGE_EXT.includes(ext(f)));
  if (videos.length + images.length !== media.length) return null;
  if (videos.length === 1 && images.length === 0) return "reel";
  if (videos.length === 0 && images.length === 1) return "photo";
  if (videos.length === 0 && images.length >= 2 && images.length <= 10) return "carousel";
  return null;
}

function magic(file) {
  const fd = openSync(file, "r");
  const buf = Buffer.alloc(8);
  try { readSync(fd, buf, 0, 8, 0); } finally { closeSync(fd); }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  return null;
}

// Two different outcomes, deliberately not collapsed into one:
//   resolve(null) means ffprobe is not installed, so the video checks are skipped
//                 with a warning and the post can still publish.
//   reject means ffprobe ran and could not read this file, which is an error about
//                 the post: a truncated or corrupt mp4 must not pass as "no tool".
export function makeFfprobe(execFileImpl = execFile) {
  return (file) => new Promise((resolve, reject) => {
    const unreadable = (why) => reject(new Error(`ffprobe could not read ${path.basename(file)}: ${why}`));
    execFileImpl("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file], (err, stdout) => {
      if (err && err.code === "ENOENT") return resolve(null); // ffprobe is not on PATH
      if (err) {
        let why = "unknown error";
        if (typeof err.code === "number") why = `exit ${err.code}`;
        else if (err.signal) why = `signal ${err.signal}`;
        return unreadable(why);
      }
      try {
        const data = JSON.parse(stdout);
        const video = (data.streams ?? []).find((s) => s.codec_type === "video");
        const audio = (data.streams ?? []).find((s) => s.codec_type === "audio");
        if (!video) return unreadable("no video stream");
        resolve({
          durationSec: Number(data.format?.duration ?? video.duration ?? 0),
          width: Number(video.width ?? 0),
          height: Number(video.height ?? 0),
          videoCodec: String(video.codec_name ?? ""),
          audioCodec: audio ? String(audio.codec_name ?? "") : null,
        });
      } catch { unreadable("ffprobe output did not parse"); }
    });
  });
}

const mb = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export async function validatePost(entry, { probe } = {}) {
  const errors = [];
  const warnings = [];
  const base = { rel: entry.rel, dir: entry.dir, kind: null };

  if (!entry.post) {
    return { ...base, ok: false, errors: [`post.json does not parse: ${entry.parseError}`], warnings };
  }
  const post = entry.post;

  if (post.status === undefined || post.status === null) {
    errors.push(`status missing, add "status": "ready" to publish this post`);
  } else if (!STATUSES.includes(post.status)) {
    errors.push(`status must be one of ${STATUSES.join(", ")}, found "${post.status}"`);
  }
  if (post.scheduledFor !== null && post.scheduledFor !== undefined) {
    if (typeof post.scheduledFor !== "string" || Number.isNaN(new Date(post.scheduledFor).getTime())) {
      errors.push(`scheduledFor must be null or an ISO datetime with an offset, found "${post.scheduledFor}"`);
    }
  }

  const caption = typeof post.caption === "string" ? post.caption : "";
  if (typeof post.caption !== "string") errors.push("caption must be a string");
  if (caption.length > LIMITS.caption) errors.push(`caption is ${caption.length} characters, the limit is ${LIMITS.caption}`);
  const hashtags = caption.match(/#[^\s#]+/g) ?? [];
  if (hashtags.length > LIMITS.hashtags) errors.push(`caption has ${hashtags.length} hashtags, the limit is ${LIMITS.hashtags}`);

  const kind = postKind(post.media);
  base.kind = kind;
  if (!kind) {
    errors.push("media must be exactly one mp4 (reel), one image (photo), or 2 to 10 images (carousel)");
    return { ...base, ok: false, errors, warnings };
  }

  for (const file of post.media) {
    const abs = path.resolve(entry.dir, file);
    if (!existsSync(abs)) { errors.push(`media file ${file} not found`); continue; }
    const size = statSync(abs).size;

    if (path.extname(file).toLowerCase() === ".mp4") {
      if (size > LIMITS.videoBytes) errors.push(`${file} is ${mb(size)}, the limit is 1 GB`);
      let info = null;
      if (probe) {
        try {
          info = await probe(abs);
        } catch (err) {
          errors.push(err.message); // ffprobe ran and rejected this file
          continue;
        }
      }
      if (!info) {
        warnings.push(`${file}: ffprobe unavailable, skipped the video checks`);
        continue;
      }
      if (info.durationSec > LIMITS.videoSeconds) errors.push(`${file} is ${Math.round(info.durationSec)}s, longer than 15 minutes`);
      const aspect = info.height > 0 ? info.width / info.height : 0;
      if (Math.abs(aspect - TARGET_ASPECT) > LIMITS.aspectTolerance) {
        errors.push(`${file} is ${info.width}x${info.height}, not 9:16 within tolerance`);
      }
      if (!/^(h264|avc1)$/i.test(info.videoCodec)) errors.push(`${file} video codec is ${info.videoCodec}, Instagram wants H.264`);
      if (info.audioCodec && !/^aac$/i.test(info.audioCodec)) errors.push(`${file} audio codec is ${info.audioCodec}, Instagram wants AAC`);
      if (!info.audioCodec) warnings.push(`${file} has no audio stream`);
    } else {
      if (size > LIMITS.imageBytes) errors.push(`${file} is ${mb(size)}, larger than 8 MB`);
      if (!magic(abs)) errors.push(`${file} is not a JPEG or PNG`);
    }
  }

  return { ...base, ok: errors.length === 0, errors, warnings };
}

export async function validateAll(entries, { probe, statuses = ["ready"] } = {}) {
  // A post with no status is always reported: it is invisible to the publisher, and
  // silently skipping it here is how a queued post never goes out and nobody notices.
  const selected = statuses
    ? entries.filter((e) => !e.post || e.post.status === undefined || statuses.includes(e.post.status))
    : entries;
  const results = [];
  for (const entry of selected) results.push(await validatePost(entry, { probe }));
  return results;
}

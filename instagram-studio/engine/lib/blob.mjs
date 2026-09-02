import { createReadStream } from "node:fs";
import path from "node:path";

const TYPES = { ".mp4": "video/mp4", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" };

export function contentTypeFor(file) {
  return TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

export function createBlobStore({ put, del, token, prefix = "instagram-studio" }) {
  if (typeof put !== "function" || typeof del !== "function") throw new Error("createBlobStore needs put and del");
  return {
    // Streamed, never buffered: a reel is allowed up to 1 GB and this runs in a
    // background launchd job, so the file must not be resident in memory.
    async upload(localPath, keyParts) {
      const key = [prefix, ...keyParts].join("/");
      const result = await put(key, createReadStream(localPath), {
        access: "public",
        addRandomSuffix: true,
        contentType: contentTypeFor(localPath),
        multipart: true,
        token,
      });
      return { url: result.url, pathname: result.pathname ?? key };
    },
    // Best effort by contract: a failed delete leaves an orphan blob, it never
    // fails a publish that already succeeded.
    async remove(urls) {
      const failures = [];
      for (const url of urls) {
        try { await del(url, { token }); } catch (err) { failures.push({ url, error: err.message }); }
      }
      return failures;
    },
  };
}

export async function loadVercelBlob() {
  const mod = await import("@vercel/blob");
  return { put: mod.put, del: mod.del };
}

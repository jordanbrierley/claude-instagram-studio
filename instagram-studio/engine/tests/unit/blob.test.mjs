import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBlobStore, contentTypeFor } from "../../lib/blob.mjs";
import { makeFakeBlob } from "../helpers/fake-blob.mjs";

test("contentTypeFor covers the supported media", () => {
  assert.equal(contentTypeFor("a.mp4"), "video/mp4");
  assert.equal(contentTypeFor("a.JPG"), "image/jpeg");
  assert.equal(contentTypeFor("a.jpeg"), "image/jpeg");
  assert.equal(contentTypeFor("a.png"), "image/png");
  assert.equal(contentTypeFor("a.bin"), "application/octet-stream");
});

test("upload streams the file under the plugin prefix, public with a random suffix", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ig-blob-"));
  const file = path.join(dir, "asset.mp4");
  writeFileSync(file, Buffer.alloc(32));
  const fake = makeFakeBlob();
  const store = createBlobStore({ put: fake.put, del: fake.del, token: "blob-token" });

  const result = await store.upload(file, ["post-1", "asset.mp4"]);
  assert.equal(fake.uploads.length, 1);
  assert.equal(fake.uploads[0].key, "instagram-studio/post-1/asset.mp4");
  assert.equal(fake.uploads[0].options.access, "public");
  assert.equal(fake.uploads[0].options.addRandomSuffix, true);
  assert.equal(fake.uploads[0].options.contentType, "video/mp4");
  assert.equal(fake.uploads[0].options.token, "blob-token");
  assert.equal(fake.uploads[0].options.multipart, true);
  assert.equal(fake.uploads[0].bodyType, "stream"); // never a Buffer: a reel can be 1 GB
  assert.match(result.url, /^https:\/\/blob\.example\//);
  rmSync(dir, { recursive: true, force: true });
});

test("remove deletes every url and reports failures without throwing", async () => {
  const fake = makeFakeBlob({ deleteFailsFor: "second" });
  const store = createBlobStore({ put: fake.put, del: fake.del, token: "t" });
  const failures = await store.remove(["https://blob.example/first", "https://blob.example/second", "https://blob.example/third"]);
  assert.deepEqual(fake.deletes.length, 3);
  assert.equal(failures.length, 1);
  assert.match(failures[0].url, /second/);
});

test("creating a store without a client is a programming error", () => {
  assert.throws(() => createBlobStore({ token: "t" }), /put and del/);
});

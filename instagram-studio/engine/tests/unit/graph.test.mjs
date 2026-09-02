import test from "node:test";
import assert from "node:assert/strict";
import { createGraphClient, exchangeToken, refreshToken, needsRefresh } from "../../lib/graph.mjs";
import { makeFakeGraph, noSleep } from "../helpers/fake-graph.mjs";

// A distinctive token: the leak assertion below has to fail on a real leak and not
// pass by accident because a 3-character string turns up inside the word "token".
const TOKEN = "secret-token-abc123";

const client = (fake, over = {}) => createGraphClient({
  fetch: fake.fetchImpl, userId: "17841400000000000", accessToken: TOKEN, sleep: noSleep, ...over,
});

test("a reel container posts the documented fields", async () => {
  const fake = makeFakeGraph();
  const id = await client(fake).createReelContainer({ videoUrl: "https://blob.example/a.mp4", caption: "hi" });
  assert.equal(id, "container-1");
  const call = fake.calls[0];
  assert.equal(call.method, "POST");
  assert.equal(call.path, "/17841400000000000/media");
  assert.equal(call.params.media_type, "REELS");
  assert.equal(call.params.video_url, "https://blob.example/a.mp4");
  assert.equal(call.params.caption, "hi");
  assert.equal(call.params.share_to_feed, "true");
  assert.equal(call.params.access_token, TOKEN);
});

test("photo, carousel item and carousel parent containers post the documented fields", async () => {
  const fake = makeFakeGraph();
  const c = client(fake);
  await c.createImageContainer({ imageUrl: "https://blob.example/a.jpg", caption: "hi" });
  assert.equal(fake.calls[0].params.media_type, "IMAGE");
  assert.equal(fake.calls[0].params.image_url, "https://blob.example/a.jpg");

  await c.createCarouselItem({ imageUrl: "https://blob.example/b.jpg" });
  assert.equal(fake.calls[1].params.is_carousel_item, "true");
  assert.equal(fake.calls[1].params.caption, undefined);

  await c.createCarouselContainer({ children: ["c1", "c2"], caption: "deck" });
  assert.equal(fake.calls[2].params.media_type, "CAROUSEL");
  assert.equal(fake.calls[2].params.children, "c1,c2");
  assert.equal(fake.calls[2].params.caption, "deck");
});

test("waitForFinished polls until FINISHED", async () => {
  const fake = makeFakeGraph({ statusSequence: ["IN_PROGRESS", "IN_PROGRESS", "FINISHED"] });
  const slept = [];
  const c = client(fake, { sleep: async (ms) => { slept.push(ms); } });
  await c.waitForFinished("container-1", { intervalMs: 5000, timeoutMs: 600000 });
  assert.equal(fake.calls.filter((x) => x.params.fields === "status_code,status").length, 3);
  assert.deepEqual(slept, [5000, 5000]);
});

test("waitForFinished throws on ERROR and on EXPIRED", async () => {
  for (const code of ["ERROR", "EXPIRED"]) {
    const fake = makeFakeGraph({ statusSequence: [code] });
    await assert.rejects(() => client(fake).waitForFinished("container-1", { intervalMs: 1, timeoutMs: 1000 }), new RegExp(code));
  }
});

test("waitForFinished gives up after the timeout", async () => {
  const fake = makeFakeGraph({ statusSequence: ["IN_PROGRESS"] });
  let clock = 0;
  const c = client(fake, { sleep: async (ms) => { clock += ms; }, now: () => clock });
  await assert.rejects(
    () => c.waitForFinished("container-1", { intervalMs: 5000, timeoutMs: 20000 }),
    /still IN_PROGRESS after/,
  );
});

test("the client survives destructuring, so no method leans on `this`", async () => {
  const fake = makeFakeGraph({ statusSequence: ["FINISHED"] });
  const { waitForFinished } = client(fake);
  await waitForFinished("container-1", { intervalMs: 1, timeoutMs: 1000 });
  assert.equal(fake.calls.filter((x) => x.params.fields === "status_code,status").length, 1);
});

test("publish returns the media id and getPermalink returns the url", async () => {
  const fake = makeFakeGraph();
  const c = client(fake);
  const mediaId = await c.publish("container-1");
  assert.equal(mediaId, "media-1");
  assert.equal(fake.calls[0].path, "/17841400000000000/media_publish");
  assert.equal(fake.calls[0].params.creation_id, "container-1");
  assert.equal(await c.getPermalink(mediaId), "https://www.instagram.com/reel/ABC/");
});

test("an API error surfaces the message and never the access token", async () => {
  const fake = makeFakeGraph({ failOn: "/media" });
  await assert.rejects(
    () => client(fake).createReelContainer({ videoUrl: "https://blob.example/a.mp4", caption: "hi" }),
    (err) => {
      assert.match(err.message, /Simulated Instagram failure/);
      assert.equal(err.message.includes(TOKEN), false);
      return true;
    },
  );
});

test("token exchange and refresh return the token and an exact expiry from the injected clock", async () => {
  const fake = makeFakeGraph();
  const nowMs = Date.parse("2026-09-02T12:00:00.000Z");
  const exchanged = await exchangeToken({ fetch: fake.fetchImpl, appSecret: "secret", shortLivedToken: "short", now: () => nowMs });
  assert.equal(exchanged.accessToken, "long-lived-token");
  assert.equal(fake.calls[0].params.grant_type, "ig_exchange_token");
  assert.equal(fake.calls[0].params.client_secret, "secret");
  assert.equal(exchanged.expiresAt, "2026-11-01T12:00:00.000Z"); // 5184000s after the injected now

  const refreshed = await refreshToken({ fetch: fake.fetchImpl, accessToken: "long-lived-token", now: () => nowMs });
  assert.equal(refreshed.accessToken, "refreshed-token");
  assert.equal(refreshed.expiresAt, "2026-11-01T12:00:00.000Z");
  assert.equal(fake.calls[1].params.grant_type, "ig_refresh_token");
});

test("needsRefresh fires inside the 10 day window and on a missing or unparseable expiry", () => {
  const now = new Date("2026-09-02T12:00:00Z");
  assert.equal(needsRefresh("2026-11-01T12:00:00Z", now), false);
  assert.equal(needsRefresh("2026-09-09T12:00:00Z", now), true);
  assert.equal(needsRefresh("2026-08-01T12:00:00Z", now), true);
  assert.equal(needsRefresh(null, now), true);
  assert.equal(needsRefresh("whenever", now), true);
});

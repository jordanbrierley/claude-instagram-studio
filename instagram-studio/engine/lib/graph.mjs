export const GRAPH_BASE = "https://graph.instagram.com";
export const REFRESH_WINDOW_DAYS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

// One request helper for every call. The access token goes in the query string
// or the form body, never into an error message: errors quote the path and the
// API message only.
async function request({ fetchImpl, baseUrl, method, pathname, params }) {
  const url = new URL(baseUrl + pathname);
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) form.set(key, String(value));
  }
  let response;
  if (method === "GET") {
    url.search = form.toString();
    response = await fetchImpl(url.toString(), { method });
  } else {
    response = await fetchImpl(url.toString(), {
      method,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
  }
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!response.ok || !body || body.error) {
    // A non-JSON error body (a proxy's HTML page, say) can echo the request URL back,
    // and GET requests and token calls carry access_token / client_secret in that URL.
    // Redact every secret value before it can reach an error message.
    const secrets = [params.access_token, params.client_secret].filter(Boolean);
    const redact = (s) => secrets.reduce((t, v) => t.split(v).join("[redacted]"), s);
    const message = body?.error?.message ?? redact(text).slice(0, 300);
    throw new Error(`Instagram API ${method} ${pathname} failed (${response.status}): ${message}`);
  }
  return body;
}

export function createGraphClient({
  fetch: fetchImpl = fetch,
  baseUrl = GRAPH_BASE,
  userId,
  accessToken,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
}) {
  if (!userId) throw new Error("createGraphClient needs an IG_USER_ID");
  if (!accessToken) throw new Error("createGraphClient needs an IG_ACCESS_TOKEN");
  const call = (method, pathname, params = {}) =>
    request({ fetchImpl, baseUrl, method, pathname, params: { ...params, access_token: accessToken } });

  const createContainer = async (params) => (await call("POST", `/${userId}/media`, params)).id;

  // Closures, not methods: nothing here reads `this`, so `const { waitForFinished } =
  // createGraphClient(...)` keeps working.
  const getContainerStatus = async (id) => {
    const body = await call("GET", `/${id}`, { fields: "status_code,status" });
    return { statusCode: body.status_code, status: body.status };
  };

  const waitForFinished = async (id, { intervalMs = 5000, timeoutMs = 10 * 60 * 1000 } = {}) => {
    const started = now();
    for (;;) {
      const { statusCode, status } = await getContainerStatus(id);
      if (statusCode === "FINISHED") return;
      if (statusCode === "ERROR" || statusCode === "EXPIRED") {
        throw new Error(`container ${id} came back ${statusCode}: ${status}`);
      }
      if (now() - started >= timeoutMs) {
        throw new Error(`container ${id} still ${statusCode} after ${Math.round(timeoutMs / 1000)}s, giving up`);
      }
      await sleep(intervalMs);
    }
  };

  return {
    createReelContainer: ({ videoUrl, caption }) =>
      createContainer({ media_type: "REELS", video_url: videoUrl, caption, share_to_feed: "true" }),
    createImageContainer: ({ imageUrl, caption }) =>
      createContainer({ media_type: "IMAGE", image_url: imageUrl, caption }),
    createCarouselItem: ({ imageUrl }) =>
      createContainer({ media_type: "IMAGE", image_url: imageUrl, is_carousel_item: "true" }),
    createCarouselContainer: ({ children, caption }) =>
      createContainer({ media_type: "CAROUSEL", children: children.join(","), caption }),
    getContainerStatus,
    waitForFinished,
    publish: async (creationId) => (await call("POST", `/${userId}/media_publish`, { creation_id: creationId })).id,
    getPermalink: async (mediaId) => (await call("GET", `/${mediaId}`, { fields: "permalink" })).permalink,
  };
}

const expiryFrom = (expiresIn, nowMs) => new Date(nowMs + Number(expiresIn ?? 0) * 1000).toISOString();

// Both token endpoints are the same GET with different parameters, so they share one
// body. The clock is injected so the expiry a test asserts is exact.
async function tokenCall({ fetchImpl, baseUrl, pathname, params, nowMs }) {
  const body = await request({ fetchImpl, baseUrl, method: "GET", pathname, params });
  return { accessToken: body.access_token, expiresAt: expiryFrom(body.expires_in, nowMs) };
}

export async function exchangeToken({ fetch: fetchImpl = fetch, baseUrl = GRAPH_BASE, appSecret, shortLivedToken, now = () => Date.now() }) {
  return tokenCall({
    fetchImpl, baseUrl, pathname: "/access_token", nowMs: now(),
    params: { grant_type: "ig_exchange_token", client_secret: appSecret, access_token: shortLivedToken },
  });
}

export async function refreshToken({ fetch: fetchImpl = fetch, baseUrl = GRAPH_BASE, accessToken, now = () => Date.now() }) {
  return tokenCall({
    fetchImpl, baseUrl, pathname: "/refresh_access_token", nowMs: now(),
    params: { grant_type: "ig_refresh_token", access_token: accessToken },
  });
}

// Instagram only honours a long-lived refresh once the token is at least 24 hours old.
// There is no separate guard for that here and none is needed: this fires only inside
// the last 10 days of a 60 day token, so any token it refreshes is 50 days old. A token
// minutes old (straight after /ig-setup) has 60 days left and never reaches a refresh.
export function needsRefresh(expiresAt, now = new Date()) {
  if (!expiresAt) return true;
  const at = new Date(expiresAt).getTime();
  if (Number.isNaN(at)) return true;
  return at - now.getTime() <= REFRESH_WINDOW_DAYS * DAY_MS;
}

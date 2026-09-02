// A fetch-shaped fake for graph.instagram.com. `statusSequence` is walked one
// entry per container status poll; `failOn` fails the first request whose path
// contains that string.
export function makeFakeGraph({ statusSequence = ["FINISHED"], failOn = null, permalink = "https://www.instagram.com/reel/ABC/" } = {}) {
  const calls = [];
  let statusIndex = 0;
  let containerSeq = 0;

  const json = (body, status = 200) => ({
    ok: status < 400,
    status,
    text: async () => JSON.stringify(body),
  });

  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    const method = options.method ?? "GET";
    const params = method === "GET" ? parsed.searchParams : new URLSearchParams(options.body ?? "");
    const entry = { method, path: parsed.pathname, params: Object.fromEntries(params) };
    calls.push(entry);

    if (failOn && parsed.pathname.includes(failOn)) {
      return json({ error: { message: "Simulated Instagram failure", code: 100 } }, 400);
    }
    if (method === "POST" && parsed.pathname.endsWith("/media")) return json({ id: `container-${++containerSeq}` });
    if (method === "POST" && parsed.pathname.endsWith("/media_publish")) return json({ id: "media-1" });
    // entry.params, not params: params is a URLSearchParams, so `params.fields` is
    // always undefined and every route below it would fall through to the 500.
    if (method === "GET" && entry.params.fields === "status_code,status") {
      const code = statusSequence[Math.min(statusIndex++, statusSequence.length - 1)];
      return json({ status_code: code, status: `status is ${code}` });
    }
    if (method === "GET" && entry.params.fields === "permalink") return json({ permalink });
    if (parsed.pathname === "/access_token") return json({ access_token: "long-lived-token", expires_in: 5184000 });
    if (parsed.pathname === "/refresh_access_token") return json({ access_token: "refreshed-token", expires_in: 5184000 });
    return json({ error: { message: `unexpected ${method} ${parsed.pathname}` } }, 500);
  };

  return { fetchImpl, calls };
}

export const noSleep = async () => {};

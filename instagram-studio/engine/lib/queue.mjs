import { existsSync, readFileSync, writeFileSync, appendFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import path from "node:path";

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Local wall-clock day and minutes past midnight in an IANA zone, with no
// dependency and no offset arithmetic of our own.
export function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  const hour = parts.hour === "24" ? "00" : parts.hour; // some ICU builds render midnight as 24
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(hour) * 60 + Number(parts.minute) };
}

export function slotMinutes(slot) {
  const [h, m] = slot.split(":").map(Number);
  return h * 60 + m;
}

export function slotsPassedToday({ slots, now, timeZone, maxLateMinutes }) {
  const { minutes } = zonedParts(now, timeZone);
  return slots.filter((slot) => {
    const start = slotMinutes(slot);
    if (start > minutes) return false;
    if (maxLateMinutes === null || maxLateMinutes === undefined) return true;
    return minutes - start <= maxLateMinutes;
  }).length;
}

// Only unpinned publishes spend a slot. A pinned post goes out in addition to the
// slot budget, so counting it here would silently take a slot away tomorrow.
export function publishedToday({ log, now, timeZone }) {
  const today = zonedParts(now, timeZone).day;
  return log.filter((entry) => {
    if (!entry || entry.result !== "posted" || entry.pinned !== false || !entry.ts) return false;
    const when = new Date(entry.ts);
    if (Number.isNaN(when.getTime())) return false;
    return zonedParts(when, timeZone).day === today;
  }).length;
}

export function readPost(jsonPath, rootDir) {
  const dir = path.dirname(jsonPath);
  const rel = rootDir ? path.relative(rootDir, dir) : dir;
  try {
    const raw = JSON.parse(readFileSync(jsonPath, "utf8"));
    // No default for status on purpose: a post opts in to publishing by saying
    // "ready". A missing status stays undefined and Task 5 reports it.
    const post = { media: [], caption: "", scheduledFor: null, postedAt: null, url: null, error: null, ...raw };
    return { dir, rel, jsonPath, post, parseError: null };
  } catch (err) {
    return { dir, rel, jsonPath, post: null, parseError: err.message };
  }
}

export function findPosts(rootDir) {
  const found = [];
  if (!existsSync(rootDir)) return found;
  const walk = (dir) => {
    const jsonPath = path.join(dir, "post.json");
    // A folder with a post.json is a post, and a post is a leaf: drafts, archives
    // and working copies inside it are its own business, never separate posts.
    if (existsSync(jsonPath)) { found.push(readPost(jsonPath, rootDir)); return; }
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith(".") || name === "node_modules") continue;
      const child = path.join(dir, name);
      if (statSync(child).isDirectory()) walk(child);
    }
  };
  walk(rootDir);
  return found.sort((a, b) => compare(a.rel, b.rel));
}

export function writePost(jsonPath, patch) {
  const current = JSON.parse(readFileSync(jsonPath, "utf8"));
  const next = { ...current, ...patch };
  writeFileSync(jsonPath, JSON.stringify(next, null, 2) + "\n");
  return next;
}

export function readLog(logPath) {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

export function appendLog(logPath, entry) {
  mkdirSync(path.dirname(logPath), { recursive: true });
  appendFileSync(logPath, JSON.stringify(entry) + "\n");
}

const pinnedAt = (entry) => {
  const raw = entry.post?.scheduledFor;
  if (!raw) return null;
  const when = new Date(raw);
  return Number.isNaN(when.getTime()) ? "invalid" : when;
};

export function selectCandidates({ posts, config, now, log }) {
  const ready = posts.filter((p) => p.post && p.post.status === "ready");
  const pinnedDue = ready
    .filter((p) => { const when = pinnedAt(p); return when instanceof Date && when.getTime() <= now.getTime(); })
    .sort((a, b) => pinnedAt(a) - pinnedAt(b) || compare(a.rel, b.rel));
  const unpinned = ready.filter((p) => pinnedAt(p) === null);

  const slotsPassed = slotsPassedToday({ slots: config.slots, now, timeZone: config.timezone, maxLateMinutes: config.maxLateMinutes });
  const posted = publishedToday({ log, now, timeZone: config.timezone });
  const slotDue = Math.max(0, Math.min(slotsPassed - posted, unpinned.length));

  return {
    slotsPassed,
    publishedToday: posted,
    readyCount: ready.length,
    pinnedDueCount: pinnedDue.length,
    slotDue,
    dueCount: pinnedDue.length + slotDue,
    candidates: [...pinnedDue, ...unpinned.slice(0, slotDue)],
  };
}

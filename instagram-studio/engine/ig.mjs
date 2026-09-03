#!/usr/bin/env node
import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ENV_PATH, PUBLISH_KEYS, EXCHANGE_KEYS, REFRESH_KEYS,
  findRepo, loadConfig, paths, readEnv, updateEnv, requireSecrets,
} from "./lib/config.mjs";
import { findPosts, readPost, readLog, selectCandidates, zonedParts } from "./lib/queue.mjs";
import { validateAll, validatePost, postKind, makeFfprobe } from "./lib/validate.mjs";
import { createGraphClient, exchangeToken, refreshToken, adoptToken, needsRefresh } from "./lib/graph.mjs";
import { createBlobStore, loadVercelBlob } from "./lib/blob.mjs";
import { runPublish } from "./lib/publish.mjs";
import { renderPlist, DEFAULT_LABEL } from "./lib/launchd.mjs";

const ENGINE_PATH = fileURLToPath(import.meta.url);

const USAGE = `Usage: ig <command> [options]

  due                                      what would publish right now, no side effects
  publish [--now <post-dir>] [--dry-run]   publish everything due
  validate [<post-dir>]                    check the queue against the contract
  token status | adopt | exchange | refresh   adopt keeps a long-lived dashboard token, exchange swaps a
                                           short-lived one; both read it from the secrets file
  launchd [--label <label>] [--log-dir <dir>] [--node <path>]   print the LaunchAgent plist

Options:
  --repo <dir>   repo holding instagram/config.json (default: nearest above the cwd)
  --json         machine-readable output for due and validate
`;

// io carries the clock as well as the streams: every command reads "now" from it, so
// the suite runs at a fixed time and the CLI is not a wall-clock coin toss.
const DEFAULT_IO = { log: console.log, error: console.error, now: () => new Date() };
const envPath = () => process.env.IG_ENV_FILE || ENV_PATH;
const firstLine = (caption) => String(caption ?? "").split("\n")[0].slice(0, 60);

class RunError extends Error {}

function openRepo(values) {
  const start = values.repo ? path.resolve(values.repo) : process.cwd();
  const repoDir = findRepo(start);
  if (!repoDir) throw new RunError(`no instagram/config.json found at or above ${start}. Run /ig-setup.`);
  let config;
  try { config = loadConfig(repoDir); } catch (err) { throw new RunError(err.message); }
  return { repoDir, config, ...paths(repoDir, config) };
}

// The one place a folder argument becomes a PostEntry.
function resolvePostDir(arg, repo) {
  const dir = path.resolve(arg);
  const jsonPath = path.join(dir, "post.json");
  if (!existsSync(jsonPath)) throw new RunError(`${jsonPath} does not exist`);
  return readPost(jsonPath, repo.rootDir);
}

// The one place a new token is written back. It reports the expiry, never the token.
function persistToken({ accessToken, expiresAt }, envFile, io) {
  const merged = updateEnv({ IG_ACCESS_TOKEN: accessToken, IG_TOKEN_EXPIRES_AT: expiresAt }, envFile);
  io.log(`token stored in ${envFile}, expires ${expiresAt}`);
  return merged;
}

// requireSecrets throws a plain Error; wrap it so a missing secret is a clean
// RunError like every other controlled exit-2 case, not a raw stack trace.
function needSecrets(env, keys) {
  try { requireSecrets(env, keys); } catch (err) { throw new RunError(err.message); }
}

function report({ repoDir, config, rootDir, logPath }, now) {
  const posts = findPosts(rootDir);
  const selection = selectCandidates({ posts, config, now, log: readLog(logPath) });
  return {
    engine: ENGINE_PATH,
    repo: repoDir,
    now: now.toISOString(),
    timezone: config.timezone,
    localTime: (() => { const p = zonedParts(now, config.timezone); return `${p.day} ${String(Math.floor(p.minutes / 60)).padStart(2, "0")}:${String(p.minutes % 60).padStart(2, "0")}`; })(),
    slots: config.slots,
    ...selection,
    candidates: selection.candidates.map((c) => ({ rel: c.rel, dir: c.dir, kind: postKind(c.post.media), caption: firstLine(c.post.caption) })),
    posts,
  };
}

async function cmdDue(values, io) {
  const repo = openRepo(values);
  const data = report(repo, io.now());
  const { posts, ...printable } = data;
  if (values.json) { io.log(JSON.stringify(printable, null, 2)); return 0; }
  io.log(`engine: ${data.engine}`);
  io.log(`repo: ${data.repo}`);
  io.log(`now:  ${data.localTime} ${data.timezone}`);
  io.log(`slots passed today: ${data.slotsPassed} of ${data.slots.length} (${data.slots.join(", ")})`);
  io.log(`published today:    ${data.publishedToday}`);
  io.log(`ready posts:        ${data.readyCount}`);
  io.log(`due now:            ${data.dueCount}`);
  if (data.candidates.length === 0) { io.log("\nnothing to publish."); return 0; }
  io.log("");
  data.candidates.forEach((c, i) => io.log(`  ${i + 1}. ${c.rel}  ${c.kind}  "${c.caption}"`));
  return 0;
}

async function cmdValidate(values, positionals, io) {
  const repo = openRepo(values);
  const probe = makeFfprobe();
  const target = positionals[0];
  const results = target
    ? [await validatePost(resolvePostDir(target, repo), { probe })]
    : await validateAll(findPosts(repo.rootDir), { probe });
  if (values.json) { io.log(JSON.stringify(results, null, 2)); return results.every((r) => r.ok) ? 0 : 1; }
  if (results.length === 0) { io.log("no ready posts to check."); return 0; }
  for (const result of results) {
    io.log(`${result.ok ? "OK  " : "FAIL"}  ${result.rel}  ${result.kind ?? "unknown kind"}`);
    for (const error of result.errors) io.log(`        error: ${error}`);
    for (const warning of result.warnings) io.log(`        warning: ${warning}`);
  }
  const bad = results.filter((r) => !r.ok).length;
  io.log(`\n${results.length - bad} ok, ${bad} to fix.`);
  return bad === 0 ? 0 : 1; // spec: validate exits 1 when the queue has a problem
}

async function ensureToken(env, io) {
  if (!needsRefresh(env.IG_TOKEN_EXPIRES_AT, io.now())) return env;
  try {
    const refreshed = await refreshToken({ accessToken: env.IG_ACCESS_TOKEN });
    return persistToken(refreshed, envPath(), io);
  } catch (err) {
    const stillValid = env.IG_TOKEN_EXPIRES_AT && new Date(env.IG_TOKEN_EXPIRES_AT).getTime() > io.now().getTime();
    if (stillValid) { io.error(`token refresh failed (${err.message}), continuing with the current token`); return env; }
    throw new RunError(`token refresh failed and the token has expired: ${err.message}. Run /ig-setup to re-authorise.`);
  }
}

// The default publish deps: a real graph client, a real @vercel/blob store, and the
// clock the run was invoked with. io.makeDeps (Task I5's seam) replaces this whole
// factory for a test, without changing what a normal run builds.
async function defaultPublishDeps({ env, probe }, io) {
  const { put, del } = await loadVercelBlob();
  return {
    graph: createGraphClient({ userId: env.IG_USER_ID, accessToken: env.IG_ACCESS_TOKEN }),
    blob: createBlobStore({ put, del, token: env.BLOB_READ_WRITE_TOKEN }),
    probe,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: io.now,
  };
}

async function cmdPublish(values, io) {
  const repo = openRepo(values);
  const now = io.now();
  const probe = makeFfprobe();

  const candidates = values.now
    ? [resolvePostDir(values.now, repo)]
    : report(repo, now).candidates.map((c) => readPost(path.join(c.dir, "post.json"), repo.rootDir));

  if (values.now) {
    const [entry] = candidates;
    const status = entry.post?.status ?? "missing";
    if (status !== "ready") {
      throw new RunError(`${entry.rel} has status "${status}", not "ready". Set its post.json status back to "ready" to publish it again.`);
    }
  }

  if (values["dry-run"]) {
    io.log(`dry run: ${candidates.length} post(s) would publish`);
    for (const entry of candidates) {
      const check = await validatePost(entry, { probe });
      io.log(`  ${check.ok ? "OK  " : "FAIL"}  ${entry.rel}  ${check.kind ?? "unknown kind"}`);
      for (const error of check.errors) io.log(`        error: ${error}`);
    }
    return 0;
  }
  if (candidates.length === 0) { io.log("nothing due."); return 0; }

  let env = readEnv(envPath());
  needSecrets(env, PUBLISH_KEYS);
  env = await ensureToken(env, io);

  const built = io.makeDeps
    ? await io.makeDeps({ env, config: repo.config, logPath: repo.logPath, probe })
    : await defaultPublishDeps({ env, probe }, io);

  const deps = {
    ...built,
    logPath: repo.logPath,
    onEvent: (event) => {
      if (event.type === "start") io.log(`publishing ${event.rel} (${event.kind})`);
      if (event.type === "posted") io.log(`  posted: ${event.url}`);
      if (event.type === "failed") io.error(`  failed: ${event.message}`);
      if (event.type === "invalid") io.error(`  invalid: ${event.errors.join("; ")}`);
      if (event.type === "warning") io.error(`  warning: ${event.message}`);
      if (event.type === "io-error") io.error(`  could not write ${event.path}: ${event.message}`);
      if (event.type === "rate-limit-guard") io.error(`stopping: ${event.message}. The rest of the queue stays ready.`);
    },
  };

  const results = await runPublish({ candidates, deps });
  const posted = results.filter((r) => r.result === "posted").length;
  io.log(`\n${posted} posted, ${results.length - posted} failed.`);
  return 0; // per-post failures are recorded, not fatal
}

async function cmdToken(values, positionals, io) {
  const action = positionals[0] ?? "status";
  const env = readEnv(envPath());
  if (action === "status") {
    if (!env.IG_ACCESS_TOKEN) { io.log(`no token in ${envPath()}. Run /ig-setup.`); return 2; }
    const expiresAt = env.IG_TOKEN_EXPIRES_AT ?? "unknown";
    const days = env.IG_TOKEN_EXPIRES_AT ? Math.round((new Date(env.IG_TOKEN_EXPIRES_AT).getTime() - Date.now()) / 86400000) : "unknown";
    io.log(`user:    ${env.IG_USER_ID ?? "unset"}`);
    io.log(`expires: ${expiresAt} (${days} days)`);
    io.log(`refresh due: ${needsRefresh(env.IG_TOKEN_EXPIRES_AT) ? "yes" : "no"}`);
    return 0;
  }
  if (action === "exchange") {
    // No argument by design: the short-lived token is read from the secrets file the
    // user wrote, so it never appears on a command line or in `ps`.
    needSecrets(env, EXCHANGE_KEYS);
    let result;
    try {
      result = await exchangeToken({ appSecret: env.IG_APP_SECRET, shortLivedToken: env.IG_ACCESS_TOKEN });
    } catch (err) {
      // "Failed to decode" is the exchange endpoint refusing a token that is already
      // long-lived, which is what the App Dashboard's "Generate token" button hands out.
      if (/Failed to decode/.test(err.message)) throw new RunError(`${err.message}. That is Instagram refusing a token that is already long-lived: run \`ig token adopt\` instead.`);
      throw new RunError(err.message);
    }
    persistToken(result, envPath(), io);
    return 0;
  }
  if (action === "adopt") {
    needSecrets(env, REFRESH_KEYS);
    let result;
    try {
      result = await adoptToken({ accessToken: env.IG_ACCESS_TOKEN });
    } catch (err) {
      // "Failed to decode" is a stray character, "Failed to decrypt" a truncated paste.
      throw new RunError(`${err.message}. Instagram could not read the token: copy it again from the dashboard's Generate token dialog with its copy button and rewrite the IG_ACCESS_TOKEN line.`);
    }
    if (env.IG_USER_ID && env.IG_USER_ID !== result.userId) {
      throw new RunError(`token belongs to @${result.username} (${result.userId}) but IG_USER_ID is ${env.IG_USER_ID}. Fix one of them in ${envPath()}.`);
    }
    io.log(`token works for @${result.username} (${result.userId})`);
    persistToken(result, envPath(), io);
    return 0;
  }
  if (action === "refresh") {
    needSecrets(env, REFRESH_KEYS);
    let result;
    try { result = await refreshToken({ accessToken: env.IG_ACCESS_TOKEN }); } catch (err) { throw new RunError(err.message); }
    persistToken(result, envPath(), io);
    return 0;
  }
  throw new RunError(`unknown token action "${action}", expected status, adopt, exchange or refresh`);
}

async function cmdLaunchd(values, io) {
  const repo = openRepo(values);
  io.log(renderPlist({
    label: values.label ?? DEFAULT_LABEL,
    nodePath: values.node ?? process.execPath,
    cliPath: ENGINE_PATH,
    repoDir: repo.repoDir,
    slots: repo.config.slots,
    logDir: values["log-dir"] ?? path.join(os.homedir(), "Library", "Logs", "instagram-studio"),
  }));
  return 0;
}

export async function main(argv, io = {}) {
  const ctx = { ...DEFAULT_IO, ...io };
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        repo: { type: "string" },
        now: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        label: { type: "string" },
        "log-dir": { type: "string" },
        node: { type: "string" },
      },
    });
  } catch (err) { ctx.error(err.message); ctx.error(USAGE); return 2; }

  const [command, ...positionals] = parsed.positionals;
  try {
    switch (command) {
      case "due": return await cmdDue(parsed.values, ctx);
      case "publish": return await cmdPublish(parsed.values, ctx);
      case "validate": return await cmdValidate(parsed.values, positionals, ctx);
      case "token": return await cmdToken(parsed.values, positionals, ctx);
      case "launchd": return await cmdLaunchd(parsed.values, ctx);
      default: ctx.error(USAGE); return 2;
    }
  } catch (err) {
    ctx.error(err instanceof RunError ? `ig: ${err.message}` : `ig: unexpected failure: ${err.stack ?? err.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

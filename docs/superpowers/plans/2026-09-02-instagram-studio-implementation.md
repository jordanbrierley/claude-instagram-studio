# instagram-studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the instagram-studio Claude Code plugin: a queue-driven Instagram publisher (reels, photos, carousels) that runs unattended from a launchd job on a Mac, hosting media on Vercel Blob, leaving only `instagram/config.json` plus `post.json` files in the user's repo.

**Architecture:** The plugin (`instagram-studio/` in this repo) ships commands, skills, an `engine/` with a zero-framework Node CLI (`ig.mjs`), and a SessionStart bootstrap that syncs the engine into `${CLAUDE_PLUGIN_DATA}` and runs `npm ci --omit=dev` there. The engine is split into small pure-ish modules behind injected collaborators (`fetch`, blob `put`/`del`, `sleep`, `probe`), so every rule (due-count math, ordering, validation, the publish loop, blob cleanup) is unit-testable with `node:test` and fakes, with a single opt-in integration test that touches the real account.

**Tech Stack:** Node >= 22.18.0, ESM `.mjs` everywhere, `node:test` + `node:assert/strict` (no test framework dependency), `@vercel/blob` as the only engine runtime dependency, Instagram Graph API over `https://graph.instagram.com`, launchd for scheduling.

**Spec:** `docs/superpowers/specs/2026-08-25-instagram-studio-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- Repo root: `/Users/jordanbrierley/Sites/startups/instagram-studio`. All paths below are relative to it. All commits happen on `main` in this repo. Never push.
- Node floor exactly `>=22.18.0` in every `package.json` (`engines.node`).
- Engine runtime dependencies: `@vercel/blob` only. No devDependencies: tests use the built-in `node:test` runner. Versions pinned exact (no `^`, no `~`), `package-lock.json` committed, production installs use `npm ci --omit=dev`.
- Nothing mutable is ever written into `${CLAUDE_PLUGIN_ROOT}` (the versioned plugin cache). All installs and copies go to `${CLAUDE_PLUGIN_DATA}`.
- Secrets live only in `~/.config/instagram-studio/env`, file mode `600`, directory mode `700`. Never in the repo, never in a plist, never printed to stdout, never included in an error message or a log line. Error text from the Graph API is built from the request path and the API error message, never from the full URL (the URL carries the access token).
- Per-post failures are recorded, never fatal: a bad post writes `status: failed` plus `error` to its `post.json`, appends a log line, and the run continues to the next candidate. The `publish` process exits non-zero only when the run itself could not start (no config, no token, unreadable config); `validate` exits 1 when any post is invalid.
- Instagram allows 25 published posts per account per 24 hours. Before every publish the run counts `result: "posted"` lines in the trailing 24 hours and stands down at 25, leaving the rest of the queue `ready`.
- When a run publishes more than one post, it waits 60 seconds between publishes.
- Blob cleanup is best effort and always runs, on success and on failure: whatever was uploaded for a post is deleted before the next post starts.
- The plugin ships zero content: no captions, no example posts, no Cyted references. `grep -ri cyted instagram-studio/` must return nothing.
- No em dashes anywhere: not in the plan, not in code, not in comments, not in skills, not in the README, not in commit messages, not in any copy this plan specifies. Use commas, colons, and full stops.
- `plugin.json` carries no `version` field during development (git SHA updates), matching the sibling video-studio plugin.
- Marketplace name is `jordanbrierley-instagram`, plugin name is `instagram-studio` (install: `/plugin install instagram-studio@jordanbrierley-instagram`). See Open Questions: the sibling repo already publishes a marketplace named `jordanbrierley`, and two marketplaces cannot share a name on one machine.

## File Structure (target)

```
.
├── .claude-plugin/marketplace.json      # marketplace entry (name: jordanbrierley-instagram)
├── .gitignore
├── package.json                         # repo-root dev scripts only (private)
├── scripts/validate.mjs                 # manifest validation (dev check)
├── README.md
├── instagram-studio/                    # THE PLUGIN (this dir is what gets installed)
│   ├── .claude-plugin/plugin.json
│   ├── hooks/hooks.json                 # SessionStart -> scripts/bootstrap.mjs
│   ├── scripts/bootstrap.mjs            # zero-dep dependency bootstrap into CLAUDE_PLUGIN_DATA
│   ├── commands/{ig-setup.md, ig-post.md, ig-queue.md}
│   ├── skills/{ig-setup, ig-post, ig-queue}/SKILL.md
│   └── engine/
│       ├── package.json / package-lock.json
│       ├── ig.mjs                       # CLI: due | publish | validate | token | launchd
│       ├── lib/config.mjs               # repo resolution, config.json, secrets file read/write
│       ├── lib/queue.mjs                # post discovery, ordering, due-count math, post.json + log IO
│       ├── lib/validate.mjs             # post kind detection, contract and media checks
│       ├── lib/blob.mjs                 # Vercel Blob upload/delete behind an injectable client
│       ├── lib/graph.mjs                # Graph API: containers, status poll, publish, permalink, tokens
│       ├── lib/publish.mjs              # the per-post publish sequence and the run loop
│       ├── lib/launchd.mjs              # renders the LaunchAgent plist
│       └── tests/
│           ├── helpers/{fake-graph.mjs, fake-blob.mjs, tmp-repo.mjs}
│           ├── fixtures/fake-plugin/engine/{package.json, package-lock.json}
│           ├── unit/*.test.mjs
│           └── integration/publish.integration.test.mjs
└── docs/superpowers/{specs,plans}/
```

Three additions to the spec's layout, all deliberate and all accepted (Open Question 17):

- `lib/config.mjs`: the spec lists four lib modules but never says who resolves the repo, parses `config.json`, or reads and writes the secrets file. Those three jobs are one responsibility (where things live and what the secrets are) and are needed by `ig.mjs`, by the token refresh, and by the tests, so they get their own module rather than being duplicated.
- `lib/publish.mjs` and `lib/launchd.mjs`: the spec puts the publish loop and the plist inside `ig.mjs` and inside the setup skill. Both carry real logic (blob cleanup ordering, 60 second spacing, slot-to-plist mapping) that is only testable if it is a function, so `ig.mjs` stays thin wiring plus output formatting.

---

### Task 1: Repo scaffold, manifests, validation script

**Files:**
- Create: `.gitignore`, `package.json`, `.claude-plugin/marketplace.json`, `instagram-studio/.claude-plugin/plugin.json`, `scripts/validate.mjs`

**Interfaces:**
- Produces: `node scripts/validate.mjs` exits 0 when every manifest parses and every path they reference exists, non-zero with a message otherwise. Tasks 2 and 11 re-run it after adding `hooks/hooks.json` and the command files.
- Produces: `npm test` at the repo root runs the engine unit suite. It is wired here, red until Task 2 creates the engine, and green from Task 2 onward.

- [ ] **Step 1: Write `.gitignore`**

```gitignore
node_modules/
out/
*.log
.DS_Store
```

- [ ] **Step 2: Write `.claude-plugin/marketplace.json`**

```json
{
  "name": "jordanbrierley-instagram",
  "owner": { "name": "Jordan Brierley" },
  "plugins": [
    {
      "name": "instagram-studio",
      "source": "./instagram-studio",
      "description": "Unattended Instagram posting from a queue of post.json folders: reels, photos and carousels via the Instagram Graph API, media hosted on Vercel Blob, scheduled by a local launchd job.",
      "keywords": ["instagram", "reels", "publishing", "scheduling", "graph-api"]
    }
  ],
  "metadata": { "description": "Jordan Brierley's Claude Code plugins" }
}
```

- [ ] **Step 3: Write `instagram-studio/.claude-plugin/plugin.json`** (no `version` field, see Global Constraints)

```json
{
  "name": "instagram-studio",
  "description": "Post to Instagram from a queue, unattended. Drop a post.json next to your media, and a local scheduled job publishes reels, photos and carousels at your daily slots. Ships the engine and the know-how, your project keeps only content.",
  "author": { "name": "Jordan Brierley" }
}
```

- [ ] **Step 4: Write the repo-root `package.json`**

```json
{
  "name": "instagram-studio-repo",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.18.0" },
  "scripts": {
    "validate": "node scripts/validate.mjs",
    "test": "npm --prefix instagram-studio/engine test",
    "test:integration": "npm --prefix instagram-studio/engine run test:integration"
  }
}
```

- [ ] **Step 5: Write `scripts/validate.mjs`**

```js
#!/usr/bin/env node
// Validates plugin manifests parse and every path they reference exists.
// Run: node scripts/validate.mjs   (exit 0 = OK)
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fail = (msg) => { console.error(`validate: ${msg}`); process.exit(1); };
const readJson = (rel) => {
  const p = path.join(root, rel);
  if (!existsSync(p)) fail(`${rel} missing`);
  try { return JSON.parse(readFileSync(p, "utf8")); } catch (e) { fail(`${rel} invalid JSON: ${e.message}`); }
};

const marketplace = readJson(".claude-plugin/marketplace.json");
if (marketplace.name !== "jordanbrierley-instagram") fail("marketplace name changed unexpectedly");
for (const plugin of marketplace.plugins) {
  if (!existsSync(path.join(root, plugin.source))) fail(`plugin source ${plugin.source} missing`);
}

const pluginDir = "instagram-studio";
const manifest = readJson(`${pluginDir}/.claude-plugin/plugin.json`);
if (manifest.name !== "instagram-studio") fail("plugin name changed unexpectedly");
if ("version" in manifest) fail("plugin.json must not pin a version during development");

const hooksRel = `${pluginDir}/hooks/hooks.json`;
if (existsSync(path.join(root, hooksRel))) {
  const hooks = readJson(hooksRel);
  for (const group of hooks.hooks?.SessionStart ?? []) {
    for (const hook of group.hooks ?? []) {
      const match = /\$\{CLAUDE_PLUGIN_ROOT\}\/?"?([^"\s]+)/.exec(hook.command ?? "");
      if (match && !existsSync(path.join(root, pluginDir, match[1]))) fail(`hook target ${match[1]} missing`);
    }
  }
}

// Every skill has frontmatter with a name that matches its directory.
const skillsDir = path.join(root, pluginDir, "skills");
if (existsSync(skillsDir)) {
  for (const name of readdirSync(skillsDir)) {
    const skill = path.join(skillsDir, name, "SKILL.md");
    if (!existsSync(skill)) fail(`skills/${name}/SKILL.md missing`);
    const text = readFileSync(skill, "utf8");
    if (!text.startsWith("---\n")) fail(`skills/${name}/SKILL.md has no frontmatter`);
    if (!new RegExp(`^name:\\s*${name}\\s*$`, "m").test(text)) fail(`skills/${name}/SKILL.md name does not match its directory`);
  }
}

// House style: no em dashes in the plugin tree, in scripts/, or in the README.
// Dot directories are walked too, so .claude-plugin/plugin.json is covered, and
// scripts/ means this file checks itself. The character is written as an escape so
// the check can never trip on its own source.
const EM_DASH = "\u2014";
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  if (d.name === "node_modules") return [];
  const p = path.join(dir, d.name);
  return d.isDirectory() ? walk(p) : [p];
});
const styleRoots = [path.join(root, pluginDir), path.join(root, "scripts")];
const styleFiles = [...styleRoots.filter((dir) => existsSync(dir)).flatMap(walk), path.join(root, "README.md")];
for (const file of styleFiles) {
  if (!existsSync(file)) continue; // README.md arrives in Task 13
  if (!/\.(mjs|md|json)$/.test(file)) continue;
  if (readFileSync(file, "utf8").includes(EM_DASH)) fail(`${path.relative(root, file)} contains an em dash`);
}

console.log("validate: OK");
```

- [ ] **Step 6: Run it, expect PASS**

Run: `node scripts/validate.mjs`
Expected: `validate: OK`, exit 0. (`skills/`, `hooks/` and `README.md` do not exist yet, so those checks are skipped. `instagram-studio/.claude-plugin/plugin.json` and `scripts/validate.mjs` itself are already covered by the house-style walk.)

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: repo scaffold, plugin manifests, manifest validation"
```

---

### Task 2: Dependency bootstrap (SessionStart hook)

**Files:**
- Create: `instagram-studio/scripts/bootstrap.mjs`, `instagram-studio/hooks/hooks.json`, `instagram-studio/engine/package.json`, `instagram-studio/engine/package-lock.json`, `instagram-studio/engine/tests/fixtures/fake-plugin/engine/package.json`, `instagram-studio/engine/tests/fixtures/fake-plugin/engine/package-lock.json`
- Test: `instagram-studio/engine/tests/unit/bootstrap.test.mjs`

**Interfaces:**
- Produces: `node instagram-studio/scripts/bootstrap.mjs` copies `${CLAUDE_PLUGIN_ROOT}/engine` into `${CLAUDE_PLUGIN_DATA}/engine`, runs `npm ci --omit=dev` there when a lockfile exists, and writes `${CLAUDE_PLUGIN_DATA}/engine/.fingerprint`. Exits 0 in every case: no plugin context, a missing source tree, a lock another session holds, a data directory it cannot create, and a failing `npm ci` are each logged and skipped.
- Produces: `npm --prefix instagram-studio/engine test` runs `node --test tests/unit`.
- Consumes: nothing.

- [ ] **Step 1: Write `instagram-studio/engine/package.json`**

```json
{
  "name": "instagram-studio-engine",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=22.18.0" },
  "dependencies": {},
  "scripts": {
    "test": "node --test tests/unit",
    "test:integration": "node --test tests/integration"
  }
}
```

`@vercel/blob` is added in Task 6, when the module that needs it exists. Leave `dependencies` empty for now.

- [ ] **Step 2: Create the lockfile**

```bash
npm --prefix instagram-studio/engine install --package-lock-only
```

Expected: `instagram-studio/engine/package-lock.json` appears with `lockfileVersion: 3` and no packages beyond the root entry.

- [ ] **Step 3: Create the bootstrap test fixture** (zero-dependency package so `npm ci` is fast and works offline)

`instagram-studio/engine/tests/fixtures/fake-plugin/engine/package.json`:

```json
{ "name": "fake-engine", "version": "0.0.0", "private": true, "type": "module", "dependencies": {} }
```

`instagram-studio/engine/tests/fixtures/fake-plugin/engine/package-lock.json`:

```json
{
  "name": "fake-engine",
  "version": "0.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": { "name": "fake-engine", "version": "0.0.0" }
  }
}
```

Also add `instagram-studio/engine/tests/fixtures/fake-plugin/engine/ig.mjs` containing exactly:

```js
console.log("fake engine");
```

- [ ] **Step 4: Write the failing test, `instagram-studio/engine/tests/unit/bootstrap.test.mjs`**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP = path.resolve(here, "../../../scripts/bootstrap.mjs");
const FIXTURE = path.resolve(here, "../fixtures/fake-plugin");

function makeCase() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "ig-bootstrap-"));
  const root = path.join(tmp, "root");
  const data = path.join(tmp, "data");
  cpSync(FIXTURE, root, { recursive: true });
  mkdirSync(data, { recursive: true });
  return { tmp, root, data };
}

function run({ root, data }, extraEnv = {}) {
  return execFileSync(process.execPath, [BOOTSTRAP], {
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: root, CLAUDE_PLUGIN_DATA: data, ...extraEnv },
    encoding: "utf8",
  });
}

test("first run copies the engine, installs deps and writes a fingerprint", () => {
  const c = makeCase();
  const out = run(c);
  assert.match(out, /deps installed/);
  assert.ok(existsSync(path.join(c.data, "engine", "ig.mjs")));
  assert.ok(existsSync(path.join(c.data, "engine", ".fingerprint")));
  rmSync(c.tmp, { recursive: true, force: true });
});

test("second run with unchanged source is a no-op", () => {
  const c = makeCase();
  run(c);
  const out = run(c);
  assert.match(out, /up to date/);
  rmSync(c.tmp, { recursive: true, force: true });
});

test("a changed source re-installs", () => {
  const c = makeCase();
  run(c);
  const before = readFileSync(path.join(c.data, "engine", ".fingerprint"), "utf8");
  writeFileSync(path.join(c.root, "engine", "ig.mjs"), 'console.log("fake engine v2");\n');
  const out = run(c);
  assert.match(out, /deps installed/);
  const after = readFileSync(path.join(c.data, "engine", ".fingerprint"), "utf8");
  assert.notEqual(before, after);
  assert.match(readFileSync(path.join(c.data, "engine", "ig.mjs"), "utf8"), /v2/);
  rmSync(c.tmp, { recursive: true, force: true });
});

test("tests and node_modules are never copied into the data dir", () => {
  const c = makeCase();
  mkdirSync(path.join(c.root, "engine", "tests"), { recursive: true });
  writeFileSync(path.join(c.root, "engine", "tests", "x.test.mjs"), "// nothing\n");
  run(c);
  assert.equal(existsSync(path.join(c.data, "engine", "tests")), false);
  rmSync(c.tmp, { recursive: true, force: true });
});

test("a missing source tree is skipped, not fatal", () => {
  const c = makeCase();
  rmSync(path.join(c.root, "engine"), { recursive: true, force: true });
  const out = run(c);
  assert.match(out, /source missing/);
  rmSync(c.tmp, { recursive: true, force: true });
});

test("a fresh lock directory makes the run stand down", () => {
  const c = makeCase();
  mkdirSync(path.join(c.data, "engine.lock"), { recursive: true });
  const out = run(c);
  assert.match(out, /another session is installing/);
  assert.equal(existsSync(path.join(c.data, "engine", "ig.mjs")), false);
  rmSync(c.tmp, { recursive: true, force: true });
});

test("no plugin context exits 0 and does nothing", () => {
  const out = execFileSync(process.execPath, [BOOTSTRAP], {
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: "", CLAUDE_PLUGIN_DATA: "" },
    encoding: "utf8",
  });
  assert.equal(out, "");
});

test("a data dir that cannot be created is logged and still exits 0", () => {
  const c = makeCase();
  const blocker = path.join(c.tmp, "not-a-directory");
  writeFileSync(blocker, "a file where the data dir should be\n");
  // execFileSync throws on a non-zero exit, so reaching the assertions proves exit 0.
  const out = execFileSync(process.execPath, [BOOTSTRAP], {
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: c.root, CLAUDE_PLUGIN_DATA: path.join(blocker, "data") },
    encoding: "utf8",
  });
  assert.equal(out, "");
  rmSync(c.tmp, { recursive: true, force: true });
});

test("a failing npm is logged, exits 0 and leaves the engine unsynced", () => {
  const c = makeCase();
  const bin = path.join(c.tmp, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, "npm"), "#!/bin/sh\necho 'npm failed on purpose' >&2\nexit 1\n", { mode: 0o755 });
  const out = run(c, { PATH: `${bin}:${process.env.PATH}` });
  assert.equal(out.includes("deps installed"), false);
  assert.equal(existsSync(path.join(c.data, "engine", ".fingerprint")), false);
  rmSync(c.tmp, { recursive: true, force: true });
});
```

- [ ] **Step 5: Run the test, expect FAIL**

Run: `npm --prefix instagram-studio/engine test`
Expected: FAIL, `Cannot find module .../scripts/bootstrap.mjs`.

- [ ] **Step 6: Write `instagram-studio/scripts/bootstrap.mjs`**

```js
#!/usr/bin/env node
// SessionStart bootstrap: sync the engine tree from the (versioned, replaced-on-update)
// plugin cache into the persistent data dir, and `npm ci` its deps there. Zero external
// deps: this script is what installs deps.
// Concurrency: mkdir lock per tree. Crash safety: install into a tmp dir, atomic rename,
// fingerprint written inside tmp BEFORE the swap.
// Failure policy: a SessionStart hook must exit 0, so every step runs inside one outer
// try/catch that logs a single line to stderr and stops. An unsynced engine is retried by
// the next session; a non-zero exit here would surface as a hook error in every session.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

const ROOT = process.env.CLAUDE_PLUGIN_ROOT;
const DATA = process.env.CLAUDE_PLUGIN_DATA;
if (!ROOT || !DATA) process.exit(0); // not running inside a plugin context

const COPY_EXCLUDE = new Set(["node_modules", "tests", "fixtures", ".env", ".fingerprint"]);
const LOCK_STALE_MS = 10 * 60 * 1000;
const trees = [{ key: "engine", src: "engine" }];

function listFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (COPY_EXCLUDE.has(name)) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, base));
    else out.push(path.relative(base, p));
  }
  return out;
}

function fingerprint(dir) {
  const h = createHash("sha256");
  for (const rel of listFiles(dir)) {
    h.update(rel).update("\0").update(readFileSync(path.join(dir, rel)));
  }
  return h.digest("hex");
}

function syncTree({ key, src }) {
  const srcDir = path.join(ROOT, src);
  const destDir = path.join(DATA, key);
  if (!existsSync(srcDir)) {
    console.log(`instagram-studio: ${key} source missing, skipping`);
    return;
  }
  const fp = fingerprint(srcDir);
  const fpFile = path.join(destDir, ".fingerprint");
  if (existsSync(fpFile) && readFileSync(fpFile, "utf8") === fp) {
    console.log(`instagram-studio: ${key} up to date`);
    return;
  }

  const lockDir = `${destDir}.lock`;
  try {
    mkdirSync(lockDir, { recursive: false });
  } catch (err) {
    // EEXIST is the only expected failure here: another session holds the lock.
    // Anything else (a permission problem, a missing parent) is a real failure and
    // belongs to the outer catch, not to a stale-lock recovery.
    if (err.code !== "EEXIST") throw err;
    const age = Date.now() - statSync(lockDir).mtimeMs;
    if (age < LOCK_STALE_MS) { console.log(`instagram-studio: ${key}, another session is installing, skipping`); return; }
    rmSync(lockDir, { recursive: true, force: true });
    mkdirSync(lockDir, { recursive: false });
  }

  const tmp = `${destDir}.tmp-${process.pid}`;
  try {
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    for (const rel of listFiles(srcDir)) {
      const to = path.join(tmp, rel);
      mkdirSync(path.dirname(to), { recursive: true });
      copyFileSync(path.join(srcDir, rel), to);
    }
    if (existsSync(path.join(tmp, "package-lock.json"))) {
      // A failing or offline npm throws out to the outer catch: the swap never happens,
      // the data dir keeps whatever it had, and the next session tries again.
      execFileSync("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], { cwd: tmp, stdio: ["ignore", "ignore", "inherit"] });
    }
    writeFileSync(path.join(tmp, ".fingerprint"), fp);
    const old = `${destDir}.old-${process.pid}`;
    if (existsSync(destDir)) renameSync(destDir, old);
    renameSync(tmp, destDir);
    rmSync(old, { recursive: true, force: true });
    console.log(`instagram-studio: ${key} deps installed`);
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
    rmSync(tmp, { recursive: true, force: true });
  }
}

function main() {
  mkdirSync(DATA, { recursive: true }); // before any lock: the lock directory lives inside it
  for (const tree of trees) syncTree(tree);
}

try {
  main();
} catch (err) {
  console.error(`instagram-studio: bootstrap skipped, ${err.message}`);
}
```

Note: unlike video-studio there is nothing to preserve across updates. The secrets file lives in `~/.config/instagram-studio/env` and the queue lives in the user's repo, so a wiped data dir costs only an `npm ci`.

- [ ] **Step 7: Run the test, expect PASS**

Run: `npm --prefix instagram-studio/engine test`
Expected: 9 passing tests.

- [ ] **Step 8: Write `instagram-studio/hooks/hooks.json`**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}\"/scripts/bootstrap.mjs" }
        ]
      }
    ]
  }
}
```

- [ ] **Step 9: Validate and commit**

```bash
node scripts/validate.mjs
git add -A && git commit -m "feat: engine package, SessionStart bootstrap into the plugin data dir"
```

---

### Task 3: lib/config.mjs (repo resolution, config.json, secrets file)

**Files:**
- Create: `instagram-studio/engine/lib/config.mjs`
- Test: `instagram-studio/engine/tests/unit/config.test.mjs`

**Interfaces:**
- Produces:
  - `ENV_PATH: string` (`~/.config/instagram-studio/env`)
  - `SECRET_KEYS: string[]` the six keys the secrets file can hold, and the three named subsets built from it: `PUBLISH_KEYS`, `EXCHANGE_KEYS`, `REFRESH_KEYS`. This module is the only place a key list is written down: `ig.mjs` (Task 10) imports these and never types a key literal.
  - `findRepo(startDir: string): string | null` walks up to the nearest dir containing `instagram/config.json`
  - `parseConfig(text: string): Config` where `Config = { root: string, slots: string[], timezone: string, maxLateMinutes: number | null }`, throws `Error` with a human message on any violation
  - `loadConfig(repoDir: string): Config`
  - `paths(repoDir, config): { rootDir: string, logPath: string, configPath: string }`
  - `parseEnv(text): Record<string,string>`, `serializeEnv(vars): string`
  - `readEnv(envPath?): Record<string,string>`, `writeEnv(vars, envPath?): void`
  - `updateEnv(patch, envPath?): Record<string,string>` patches the file line by line: an existing `KEY=value` line for a patched key is rewritten in place, a new key is appended after the last non-blank line, and every other line (comments, blanks, unrelated keys) survives verbatim. `serializeEnv` is used only when the file does not exist yet.
  - `requireSecrets(env, keys: string[]): void` throws naming the missing keys and pointing at `/ig-setup`
- Consumes: nothing.

- [ ] **Step 1: Write the failing test, `instagram-studio/engine/tests/unit/config.test.mjs`**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  findRepo, parseConfig, parseEnv, serializeEnv, readEnv, writeEnv, updateEnv, requireSecrets, paths,
  SECRET_KEYS, PUBLISH_KEYS, EXCHANGE_KEYS, REFRESH_KEYS,
} from "../../lib/config.mjs";

const tmpdir = () => mkdtempSync(path.join(os.tmpdir(), "ig-config-"));

test("findRepo walks up to the nearest instagram/config.json", () => {
  const tmp = tmpdir();
  const repo = path.join(tmp, "repo");
  const deep = path.join(repo, "content", "2026-09-02", "post-1");
  mkdirSync(deep, { recursive: true });
  mkdirSync(path.join(repo, "instagram"), { recursive: true });
  writeFileSync(path.join(repo, "instagram", "config.json"), "{}");
  assert.equal(findRepo(deep), repo);
  assert.equal(findRepo(tmp), null);
  rmSync(tmp, { recursive: true, force: true });
});

test("parseConfig fills defaults and sorts slots", () => {
  const cfg = parseConfig('{"slots":["17:30","08:30"]}');
  assert.deepEqual(cfg.slots, ["08:30", "17:30"]);
  assert.equal(cfg.root, "content");
  assert.equal(cfg.timezone, "Europe/London");
  assert.equal(cfg.maxLateMinutes, null);
});

test("parseConfig rejects a bad slot, empty slots, bad timezone and bad maxLateMinutes", () => {
  assert.throws(() => parseConfig('{"slots":["8:30"]}'), /not HH:MM/);
  assert.throws(() => parseConfig('{"slots":[]}'), /at least one/);
  assert.throws(() => parseConfig('{"slots":["08:30"],"timezone":""}'), /timezone/);
  assert.throws(() => parseConfig('{"slots":["08:30"],"maxLateMinutes":-5}'), /maxLateMinutes/);
  assert.throws(() => parseConfig("not json"), /not valid JSON/);
});

test("paths resolve the queue root and the log", () => {
  const p = paths("/repo", { root: "content" });
  assert.equal(p.rootDir, path.join("/repo", "content"));
  assert.equal(p.logPath, path.join("/repo", "instagram", "log.jsonl"));
});

test("env round trips and ignores comments, blanks, quotes and export", () => {
  const vars = parseEnv('# secrets\n\nexport IG_USER_ID=123\nIG_ACCESS_TOKEN="abc=def"\n');
  assert.deepEqual(vars, { IG_USER_ID: "123", IG_ACCESS_TOKEN: "abc=def" });
  assert.deepEqual(parseEnv(serializeEnv(vars)), vars);
});

test("writeEnv creates the file mode 600 and updateEnv merges", () => {
  const tmp = tmpdir();
  const envPath = path.join(tmp, "cfg", "env");
  writeEnv({ IG_USER_ID: "123" }, envPath);
  assert.equal(statSync(envPath).mode & 0o777, 0o600);
  const merged = updateEnv({ IG_ACCESS_TOKEN: "t" }, envPath);
  assert.deepEqual(merged, { IG_USER_ID: "123", IG_ACCESS_TOKEN: "t" });
  assert.equal(statSync(envPath).mode & 0o777, 0o600);
  assert.deepEqual(readEnv(envPath), merged);
  rmSync(tmp, { recursive: true, force: true });
});

test("updateEnv patches in place and leaves comments, blanks and unrelated lines alone", () => {
  const tmp = tmpdir();
  const envPath = path.join(tmp, "env");
  writeFileSync(envPath, "# instagram-studio secrets\n\nIG_USER_ID=123\nIG_ACCESS_TOKEN=short-lived\n", { mode: 0o600 });
  updateEnv({ IG_ACCESS_TOKEN: "long-lived", IG_TOKEN_EXPIRES_AT: "2026-11-01T00:00:00.000Z" }, envPath);
  assert.equal(
    readFileSync(envPath, "utf8"),
    "# instagram-studio secrets\n\nIG_USER_ID=123\nIG_ACCESS_TOKEN=long-lived\nIG_TOKEN_EXPIRES_AT=2026-11-01T00:00:00.000Z\n",
  );
  assert.equal(statSync(envPath).mode & 0o777, 0o600);
  rmSync(tmp, { recursive: true, force: true });
});

test("readEnv on a missing file is empty, requireSecrets names what is missing", () => {
  assert.deepEqual(readEnv("/nope/does/not/exist"), {});
  assert.throws(() => requireSecrets({ IG_USER_ID: "1" }, ["IG_USER_ID", "IG_ACCESS_TOKEN"]), /IG_ACCESS_TOKEN/);
  assert.doesNotThrow(() => requireSecrets({ IG_USER_ID: "1" }, ["IG_USER_ID"]));
});

test("every command key list is a subset of SECRET_KEYS", () => {
  assert.equal(SECRET_KEYS.length, 6);
  for (const list of [PUBLISH_KEYS, EXCHANGE_KEYS, REFRESH_KEYS]) {
    assert.ok(list.length > 0);
    for (const key of list) assert.ok(SECRET_KEYS.includes(key), `${key} is not a known secret key`);
  }
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `npm --prefix instagram-studio/engine test`
Expected: FAIL, `Cannot find module '../../lib/config.mjs'`.

- [ ] **Step 3: Write `instagram-studio/engine/lib/config.mjs`**

```js
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const ENV_PATH = path.join(os.homedir(), ".config", "instagram-studio", "env");
// Every secret key the plugin knows about, and the subsets each command requires.
// This is the single source of truth: ig.mjs imports these rather than repeating
// key names, so adding or renaming a secret is a one-file change.
export const SECRET_KEYS = ["IG_APP_ID", "IG_APP_SECRET", "IG_USER_ID", "IG_ACCESS_TOKEN", "IG_TOKEN_EXPIRES_AT", "BLOB_READ_WRITE_TOKEN"];

const pick = (...keys) => keys.map((key) => {
  if (!SECRET_KEYS.includes(key)) throw new Error(`${key} is not a known secret key`);
  return key;
});

export const PUBLISH_KEYS = pick("IG_USER_ID", "IG_ACCESS_TOKEN", "BLOB_READ_WRITE_TOKEN");
export const EXCHANGE_KEYS = pick("IG_APP_SECRET", "IG_ACCESS_TOKEN");
export const REFRESH_KEYS = pick("IG_ACCESS_TOKEN");

const DEFAULTS = { root: "content", slots: [], timezone: "Europe/London", maxLateMinutes: null };

export function findRepo(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (existsSync(path.join(dir, "instagram", "config.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function parseConfig(text) {
  let raw;
  try { raw = JSON.parse(text); } catch (e) { throw new Error(`instagram/config.json is not valid JSON: ${e.message}`); }
  const cfg = { ...DEFAULTS, ...raw };
  if (typeof cfg.root !== "string" || cfg.root.length === 0) throw new Error("config.root must be a non-empty directory name");
  if (!Array.isArray(cfg.slots) || cfg.slots.length === 0) throw new Error("config.slots must list at least one HH:MM time");
  for (const slot of cfg.slots) {
    if (typeof slot !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot)) throw new Error(`config.slots: "${slot}" is not HH:MM`);
  }
  if (typeof cfg.timezone !== "string" || cfg.timezone.length === 0) throw new Error("config.timezone must be an IANA timezone such as Europe/London");
  if (cfg.maxLateMinutes !== null && !(Number.isInteger(cfg.maxLateMinutes) && cfg.maxLateMinutes >= 0)) {
    throw new Error("config.maxLateMinutes must be null or a non-negative whole number of minutes");
  }
  cfg.slots = [...cfg.slots].sort();
  return cfg;
}

export function loadConfig(repoDir) {
  return parseConfig(readFileSync(path.join(repoDir, "instagram", "config.json"), "utf8"));
}

export function paths(repoDir, config) {
  return {
    configPath: path.join(repoDir, "instagram", "config.json"),
    logPath: path.join(repoDir, "instagram", "log.jsonl"),
    rootDir: path.resolve(repoDir, config.root),
  };
}

export function parseEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = trimmed.slice(eq + 1).trim();
    const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

// Only used to create the file from scratch. An existing file is patched line by
// line by updateEnv so a user's comments and layout survive a token refresh.
export function serializeEnv(vars) {
  return Object.entries(vars).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
}

export function readEnv(envPath = ENV_PATH) {
  if (!existsSync(envPath)) return {};
  return parseEnv(readFileSync(envPath, "utf8"));
}

export function writeEnv(vars, envPath = ENV_PATH) {
  mkdirSync(path.dirname(envPath), { recursive: true, mode: 0o700 });
  writeFileSync(envPath, serializeEnv(vars), { mode: 0o600 });
  chmodSync(envPath, 0o600); // an existing file keeps its old mode without this
}

export function updateEnv(patch, envPath = ENV_PATH) {
  const merged = { ...readEnv(envPath), ...patch };
  if (!existsSync(envPath)) {
    writeEnv(merged, envPath);
    return merged;
  }

  // Patch in place. A token refresh must not eat the comments, blank lines or
  // unrelated keys the user wrote into their own secrets file.
  const pending = new Map(Object.entries(patch));
  const lines = readFileSync(envPath, "utf8").split("\n").map((line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) return line;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return line;
    const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, "");
    if (!pending.has(key)) return line;
    const value = pending.get(key);
    pending.delete(key);
    return `${key}=${value}`;
  });

  let insertAt = lines.length;
  while (insertAt > 0 && lines[insertAt - 1].trim().length === 0) insertAt -= 1; // keep new keys above any trailing blank
  lines.splice(insertAt, 0, ...[...pending].map(([key, value]) => `${key}=${value}`));

  const text = lines.join("\n");
  mkdirSync(path.dirname(envPath), { recursive: true, mode: 0o700 });
  writeFileSync(envPath, text.endsWith("\n") ? text : `${text}\n`, { mode: 0o600 });
  chmodSync(envPath, 0o600);
  return merged;
}

export function requireSecrets(env, keys) {
  const missing = keys.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`missing ${missing.join(", ")} in ${ENV_PATH}. Run /ig-setup to create them.`);
  }
}
```

- [ ] **Step 4: Run the test, expect PASS**

Run: `npm --prefix instagram-studio/engine test`
Expected: all config tests pass alongside the bootstrap tests.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(engine): repo resolution, config parsing, mode-600 secrets file"
```

---

### Task 4: lib/queue.mjs (discovery, ordering, due-count math, post.json and log IO)

**Files:**
- Create: `instagram-studio/engine/lib/queue.mjs`, `instagram-studio/engine/tests/helpers/tmp-repo.mjs`
- Test: `instagram-studio/engine/tests/unit/queue.test.mjs`

**Interfaces:**
- Consumes: `Config` from `lib/config.mjs` (`{ root, slots, timezone, maxLateMinutes }`).
- Produces:
  - `PostEntry = { dir: string, rel: string, jsonPath: string, post: object | null, parseError: string | null }`
  - `findPosts(rootDir: string): PostEntry[]` sorted by `rel` ascending
  - `readPost(jsonPath, rootDir): PostEntry`
  - `writePost(jsonPath, patch: object): object` merges into the file on disk, preserving unknown keys
  - `readLog(logPath): object[]`, `appendLog(logPath, entry: object): void`
  - `zonedParts(date, timeZone): { day: "YYYY-MM-DD", minutes: number }`
  - `slotsPassedToday({ slots, now, timeZone, maxLateMinutes }): number`
  - `publishedToday({ log, now, timeZone }): number`
  - `selectCandidates({ posts, config, now, log }): { slotsPassed, publishedToday, readyCount, pinnedDueCount, slotDue, dueCount, candidates: PostEntry[] }`
  - test helper `tests/helpers/tmp-repo.mjs`: `makeQueue(posts, files)` builds a throwaway queue root, `ready(over)` builds a post object, and `makeRepo(posts, config, files)` wraps `makeQueue` with an `instagram/config.json` so the CLI tests in Task 10 have a repo without a second fixture builder.

**Rules this task locks in** (all from the spec, the two resolutions are flagged in Open Questions):

- A slot counts as passed when its local time today is at or before now and, when `maxLateMinutes` is set, now is not more than that many minutes past it.
- `publishedToday` counts log lines with `result === "posted"` and `pinned === false` whose `ts` falls on today's local date. Failures never consume a slot, and neither do pinned publishes: a pinned post is extra to the slot budget when it goes out, so it must not shrink that budget on the next run. Every log line carries `pinned`, written by Task 8.
- Ready posts split in two: pinned (a `scheduledFor` that parses) and unpinned (`scheduledFor` null or absent).
- Pinned and due (`scheduledFor <= now`) are always candidates, earliest `scheduledFor` first, ties broken by `rel`. Pinned and not yet due are not candidates at all.
- `slotDue = clamp(slotsPassed - publishedToday, 0, unpinnedCount)`: the slot-driven count is capped at the number of unpinned ready posts, and pinned posts whose time has come are added on top. The first `slotDue` unpinned posts by `rel` ascending follow the pinned ones.
- A post whose `post.json` does not parse, or whose `scheduledFor` does not parse, is never a candidate. Task 5 reports it.
- A `post.json` with no `status` key is not a candidate either: `readPost` leaves `status` undefined and Task 5 reports `status missing`. Nothing defaults to `ready`, so a post has to opt in to publishing.
- A directory containing `post.json` is a leaf. `findPosts` does not descend into it, so a `post.json` nested inside a post folder (a draft, an archive) is never picked up as a second post.

- [ ] **Step 1: Write the fixture helper, `instagram-studio/engine/tests/helpers/tmp-repo.mjs`**

```js
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Builds a throwaway queue root. `posts` maps a relative folder to either a
// post object or the literal string to write as post.json.
export function makeQueue(posts, files = {}) {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "ig-queue-"));
  for (const [rel, post] of Object.entries(posts)) {
    const dir = path.join(rootDir, rel);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "post.json"), typeof post === "string" ? post : JSON.stringify(post, null, 2) + "\n");
  }
  for (const [rel, contents] of Object.entries(files)) {
    const file = path.join(rootDir, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }
  return rootDir;
}

export const ready = (over = {}) => ({ media: ["asset.mp4"], caption: "hello", scheduledFor: null, status: "ready", postedAt: null, url: null, error: null, ...over });

// The same queue, wrapped in a repo: content/<rel> for every post and file, plus
// instagram/config.json. The CLI tests (Task 10) use this so there is one fixture
// builder in the suite, not two that can drift.
export function makeRepo(posts = {}, config = {}, files = {}) {
  const underRoot = (map) => Object.fromEntries(Object.entries(map).map(([rel, value]) => [path.join("content", rel), value]));
  const repoDir = makeQueue(underRoot(posts), underRoot(files));
  mkdirSync(path.join(repoDir, "instagram"), { recursive: true });
  writeFileSync(path.join(repoDir, "instagram", "config.json"), JSON.stringify({
    root: "content", slots: ["08:30", "12:30", "17:30"], timezone: "Europe/London", maxLateMinutes: null, ...config,
  }, null, 2) + "\n");
  return repoDir;
}
```

- [ ] **Step 2: Write the failing test, `instagram-studio/engine/tests/unit/queue.test.mjs`**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { findPosts, readLog, appendLog, writePost, slotsPassedToday, publishedToday, selectCandidates, zonedParts } from "../../lib/queue.mjs";
import { makeQueue, ready } from "../helpers/tmp-repo.mjs";

const CONFIG = { root: "content", slots: ["08:30", "12:30", "17:30"], timezone: "Europe/London", maxLateMinutes: null };
// 2026-09-02 is BST, so Europe/London is UTC+1.
const at = (hhmm) => new Date(`2026-09-02T${hhmm}:00+01:00`);

test("zonedParts reports the local day and minutes past midnight", () => {
  const p = zonedParts(new Date("2026-09-02T23:30:00Z"), "Europe/London");
  assert.equal(p.day, "2026-09-03");
  assert.equal(p.minutes, 30);
});

test("slotsPassedToday counts slots at or before now", () => {
  const args = { slots: CONFIG.slots, timeZone: CONFIG.timezone, maxLateMinutes: null };
  assert.equal(slotsPassedToday({ ...args, now: at("08:00") }), 0);
  assert.equal(slotsPassedToday({ ...args, now: at("08:30") }), 1);
  assert.equal(slotsPassedToday({ ...args, now: at("13:00") }), 2);
  assert.equal(slotsPassedToday({ ...args, now: at("23:00") }), 3);
});

test("maxLateMinutes drops slots that passed too long ago", () => {
  const args = { slots: CONFIG.slots, timeZone: CONFIG.timezone, maxLateMinutes: 90 };
  assert.equal(slotsPassedToday({ ...args, now: at("09:30") }), 1);
  assert.equal(slotsPassedToday({ ...args, now: at("13:00") }), 1); // 08:30 is 4.5 h late, dropped
  assert.equal(slotsPassedToday({ ...args, now: at("23:00") }), 0);
});

test("publishedToday counts only unpinned posted lines from today in the configured zone", () => {
  const log = [
    { ts: "2026-09-02T07:45:00+01:00", result: "posted", pinned: false },
    { ts: "2026-09-02T09:00:00+01:00", result: "failed", pinned: false },
    { ts: "2026-09-02T10:15:00+01:00", result: "posted", pinned: true },
    { ts: "2026-09-01T18:00:00+01:00", result: "posted", pinned: false },
  ];
  assert.equal(publishedToday({ log, now: at("12:00"), timeZone: CONFIG.timezone }), 1);
});

test("findPosts finds every post.json, sorted by path, tolerating a broken file", () => {
  const rootDir = makeQueue({
    "2026-09-02/post-2": ready(),
    "2026-09-01/post-1": ready(),
    "2026-09-03/broken": "{ this is not json",
  });
  const posts = findPosts(rootDir);
  assert.deepEqual(posts.map((p) => p.rel), ["2026-09-01/post-1", "2026-09-02/post-2", "2026-09-03/broken"]);
  assert.equal(posts[2].post, null);
  assert.match(posts[2].parseError, /JSON/);
  rmSync(rootDir, { recursive: true, force: true });
});

test("one slot passed and nothing published yet picks the oldest ready post", () => {
  const rootDir = makeQueue({ "2026-09-01/post-1": ready(), "2026-09-02/post-2": ready() });
  const r = selectCandidates({ posts: findPosts(rootDir), config: CONFIG, now: at("09:00"), log: [] });
  assert.equal(r.slotsPassed, 1);
  assert.equal(r.dueCount, 1);
  assert.deepEqual(r.candidates.map((c) => c.rel), ["2026-09-01/post-1"]);
  rmSync(rootDir, { recursive: true, force: true });
});

test("waking after one missed slot publishes the backlog for both slots", () => {
  const rootDir = makeQueue({ "a/1": ready(), "a/2": ready(), "a/3": ready() });
  const r = selectCandidates({ posts: findPosts(rootDir), config: CONFIG, now: at("13:00"), log: [] });
  assert.deepEqual(r.candidates.map((c) => c.rel), ["a/1", "a/2"]);
  rmSync(rootDir, { recursive: true, force: true });
});

test("waking after three missed slots publishes three in one run", () => {
  const rootDir = makeQueue({ "a/1": ready(), "a/2": ready(), "a/3": ready(), "a/4": ready() });
  const r = selectCandidates({ posts: findPosts(rootDir), config: CONFIG, now: at("22:00"), log: [] });
  assert.equal(r.dueCount, 3);
  assert.deepEqual(r.candidates.map((c) => c.rel), ["a/1", "a/2", "a/3"]);
  rmSync(rootDir, { recursive: true, force: true });
});

test("already published today is subtracted, so a re-run is idempotent", () => {
  const rootDir = makeQueue({ "a/1": ready(), "a/2": ready() });
  const log = [
    { ts: "2026-09-02T08:31:00+01:00", result: "posted", pinned: false },
    { ts: "2026-09-02T12:31:00+01:00", result: "posted", pinned: false },
  ];
  const r = selectCandidates({ posts: findPosts(rootDir), config: CONFIG, now: at("13:00"), log });
  assert.equal(r.dueCount, 0);
  assert.deepEqual(r.candidates, []);
  rmSync(rootDir, { recursive: true, force: true });
});

test("a pinned publish in the log does not spend a slot", () => {
  const rootDir = makeQueue({ "a/1": ready(), "a/2": ready() });
  const log = [{ ts: "2026-09-02T08:45:00+01:00", result: "posted", postDir: "a/9", pinned: true }];
  const r = selectCandidates({ posts: findPosts(rootDir), config: CONFIG, now: at("13:00"), log });
  assert.equal(r.publishedToday, 0);
  assert.equal(r.slotDue, 2); // both slots still owe a post
  assert.deepEqual(r.candidates.map((c) => c.rel), ["a/1", "a/2"]);
  rmSync(rootDir, { recursive: true, force: true });
});

test("the due count never exceeds the ready posts on hand", () => {
  const rootDir = makeQueue({ "a/1": ready(), "a/2": ready({ status: "posted" }) });
  const r = selectCandidates({ posts: findPosts(rootDir), config: CONFIG, now: at("22:00"), log: [] });
  assert.equal(r.readyCount, 1);
  assert.equal(r.dueCount, 1);
  rmSync(rootDir, { recursive: true, force: true });
});

test("a due pinned post jumps the queue and is extra to the slot count", () => {
  const rootDir = makeQueue({
    "a/1": ready(),
    "a/2": ready({ scheduledFor: "2026-09-02T08:45:00+01:00" }),
    "a/3": ready({ scheduledFor: "2026-09-02T23:00:00+01:00" }),
  });
  const r = selectCandidates({ posts: findPosts(rootDir), config: CONFIG, now: at("09:00"), log: [] });
  assert.deepEqual(r.candidates.map((c) => c.rel), ["a/2", "a/1"]);
  assert.equal(r.pinnedDueCount, 1);
  assert.equal(r.slotDue, 1);
  rmSync(rootDir, { recursive: true, force: true });
});

test("a post with an unparseable scheduledFor is never a candidate", () => {
  const rootDir = makeQueue({ "a/1": ready({ scheduledFor: "next tuesday" }) });
  const r = selectCandidates({ posts: findPosts(rootDir), config: CONFIG, now: at("22:00"), log: [] });
  assert.deepEqual(r.candidates, []);
  rmSync(rootDir, { recursive: true, force: true });
});

test("a post.json with no status is not a candidate, nothing defaults to ready", () => {
  const rootDir = makeQueue({ "a/1": { media: ["asset.mp4"], caption: "hello" } });
  const posts = findPosts(rootDir);
  assert.equal(posts[0].post.status, undefined);
  const r = selectCandidates({ posts, config: CONFIG, now: at("22:00"), log: [] });
  assert.equal(r.readyCount, 0);
  assert.deepEqual(r.candidates, []);
  rmSync(rootDir, { recursive: true, force: true });
});

test("a post folder is a leaf, so a nested post.json is not a second post", () => {
  const rootDir = makeQueue({ "a/1": ready(), "a/1/drafts/old": ready() });
  assert.deepEqual(findPosts(rootDir).map((p) => p.rel), ["a/1"]);
  rmSync(rootDir, { recursive: true, force: true });
});

test("writePost merges and preserves unknown keys", () => {
  const rootDir = makeQueue({ "a/1": { ...ready(), notes: "keep me" } });
  const jsonPath = path.join(rootDir, "a/1/post.json");
  writePost(jsonPath, { status: "posted", url: "https://instagram.com/p/x" });
  const after = JSON.parse(readFileSync(jsonPath, "utf8"));
  assert.equal(after.status, "posted");
  assert.equal(after.notes, "keep me");
  assert.equal(after.caption, "hello");
  rmSync(rootDir, { recursive: true, force: true });
});

test("the log appends one JSON object per line and skips corrupt lines on read", () => {
  const rootDir = makeQueue({});
  const logPath = path.join(rootDir, "instagram", "log.jsonl");
  appendLog(logPath, { ts: "2026-09-02T08:31:00+01:00", result: "posted" });
  appendLog(logPath, { ts: "2026-09-02T12:31:00+01:00", result: "failed" });
  const entries = readLog(logPath);
  assert.equal(entries.length, 2);
  assert.equal(readLog(path.join(rootDir, "nope.jsonl")).length, 0);
  rmSync(rootDir, { recursive: true, force: true });
});
```

- [ ] **Step 3: Run the test, expect FAIL**

Run: `npm --prefix instagram-studio/engine test`
Expected: FAIL, `Cannot find module '../../lib/queue.mjs'`.

- [ ] **Step 4: Write `instagram-studio/engine/lib/queue.mjs`**

```js
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
```

- [ ] **Step 5: Run the test, expect PASS**

Run: `npm --prefix instagram-studio/engine test`
Expected: every queue test passes.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(engine): post discovery, ordering and due-count math"
```

---

### Task 5: lib/validate.mjs (post kind, contract and media checks)

**Files:**
- Create: `instagram-studio/engine/lib/validate.mjs`
- Test: `instagram-studio/engine/tests/unit/validate.test.mjs`

**Interfaces:**
- Consumes: `PostEntry` from `lib/queue.mjs`.
- Produces:
  - `LIMITS = { caption: 2200, hashtags: 30, videoBytes: 1073741824, videoSeconds: 900, imageBytes: 8388608, aspectTolerance: 0.03 }`
  - `postKind(media: string[]): "reel" | "photo" | "carousel" | null`
  - `Probe = (absolutePath: string) => Promise<{ durationSec: number, width: number, height: number, videoCodec: string, audioCodec: string | null } | null>`
  - `makeFfprobe(execFileImpl?): Probe` resolves `null` only when ffprobe is not installed (a spawn `ENOENT`), which becomes the warning `ffprobe unavailable, skipped the video checks`. When ffprobe runs and fails on the file (a non-zero exit, unreadable output, no video stream) it rejects, and `validatePost` turns that into the error `ffprobe could not read <file>`: a corrupt video is a problem with the post, not a missing tool.
  - `validatePost(entry: PostEntry, { probe }?): Promise<{ rel, dir, ok: boolean, kind, errors: string[], warnings: string[] }>`
  - `validateAll(entries: PostEntry[], { probe, statuses }?): Promise<Result[]>`, default `statuses = ["ready"]`

- [ ] **Step 1: Write the failing test, `instagram-studio/engine/tests/unit/validate.test.mjs`**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { postKind, validatePost, validateAll, makeFfprobe, LIMITS } from "../../lib/validate.mjs";
import { findPosts } from "../../lib/queue.mjs";
import { makeQueue, ready } from "../helpers/tmp-repo.mjs";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const MP4 = Buffer.alloc(1024);
const goodProbe = async () => ({ durationSec: 30, width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac" });
const noProbe = async () => null; // ffprobe is not installed
const brokenFileProbe = async (file) => { throw new Error(`ffprobe could not read ${path.basename(file)}`); };

test("postKind maps media lists to container kinds", () => {
  assert.equal(postKind(["a.mp4"]), "reel");
  assert.equal(postKind(["a.jpg"]), "photo");
  assert.equal(postKind(["a.png"]), "photo");
  assert.equal(postKind(["a.jpg", "b.png"]), "carousel");
  assert.equal(postKind(Array.from({ length: 10 }, (_, i) => `${i}.jpg`)), "carousel");
  assert.equal(postKind(Array.from({ length: 11 }, (_, i) => `${i}.jpg`)), null);
  assert.equal(postKind(["a.mp4", "b.jpg"]), null);
  assert.equal(postKind(["a.mp4", "b.mp4"]), null);
  assert.equal(postKind(["a.gif"]), null);
  assert.equal(postKind([]), null);
});

test("a valid reel passes", async () => {
  const rootDir = makeQueue({ "a/1": ready() }, { "a/1/asset.mp4": MP4 });
  const [entry] = findPosts(rootDir);
  const result = await validatePost(entry, { probe: goodProbe });
  assert.equal(result.ok, true);
  assert.equal(result.kind, "reel");
  assert.deepEqual(result.errors, []);
  rmSync(rootDir, { recursive: true, force: true });
});

test("a missing media file fails", async () => {
  const rootDir = makeQueue({ "a/1": ready() });
  const [entry] = findPosts(rootDir);
  const result = await validatePost(entry, { probe: goodProbe });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /asset\.mp4.*not found/);
  rmSync(rootDir, { recursive: true, force: true });
});

test("an unparseable post.json fails with the parse error", async () => {
  const rootDir = makeQueue({ "a/1": "{ nope" });
  const [entry] = findPosts(rootDir);
  const result = await validatePost(entry, { probe: goodProbe });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /post\.json does not parse/);
  rmSync(rootDir, { recursive: true, force: true });
});

test("caption limits are enforced", async () => {
  const long = "x".repeat(LIMITS.caption + 1);
  const tags = Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(" ");
  const rootDir = makeQueue(
    { "a/1": ready({ caption: long }), "a/2": ready({ caption: tags }) },
    { "a/1/asset.mp4": MP4, "a/2/asset.mp4": MP4 },
  );
  const results = await validateAll(findPosts(rootDir), { probe: goodProbe });
  assert.match(results[0].errors.join(" "), /caption is 2201 characters/);
  assert.match(results[1].errors.join(" "), /31 hashtags/);
  rmSync(rootDir, { recursive: true, force: true });
});

test("video rules come from the probe, and a missing probe warns instead of failing", async () => {
  const rootDir = makeQueue({ "a/1": ready() }, { "a/1/asset.mp4": MP4 });
  const [entry] = findPosts(rootDir);

  const square = await validatePost(entry, { probe: async () => ({ durationSec: 30, width: 1080, height: 1080, videoCodec: "h264", audioCodec: "aac" }) });
  assert.match(square.errors.join(" "), /9:16/);

  const long = await validatePost(entry, { probe: async () => ({ durationSec: 1200, width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac" }) });
  assert.match(long.errors.join(" "), /longer than 15 minutes/);

  const codec = await validatePost(entry, { probe: async () => ({ durationSec: 30, width: 1080, height: 1920, videoCodec: "hevc", audioCodec: "aac" }) });
  assert.match(codec.errors.join(" "), /H\.264/);

  const skipped = await validatePost(entry, { probe: noProbe });
  assert.equal(skipped.ok, true);
  assert.match(skipped.warnings.join(" "), /ffprobe unavailable, skipped the video checks/);
  rmSync(rootDir, { recursive: true, force: true });
});

test("a video ffprobe cannot read is an error, not a skipped check", async () => {
  const rootDir = makeQueue({ "a/1": ready() }, { "a/1/asset.mp4": MP4 });
  const [entry] = findPosts(rootDir);
  const result = await validatePost(entry, { probe: brokenFileProbe });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /ffprobe could not read asset\.mp4/);
  assert.deepEqual(result.warnings, []);
  rmSync(rootDir, { recursive: true, force: true });
});

test("makeFfprobe returns null for a missing ffprobe and rejects when ffprobe fails on the file", async () => {
  const missing = makeFfprobe((cmd, args, cb) => cb(Object.assign(new Error("spawn ffprobe ENOENT"), { code: "ENOENT" })));
  assert.equal(await missing("/tmp/asset.mp4"), null);

  const failed = makeFfprobe((cmd, args, cb) => cb(Object.assign(new Error("ffprobe exited 1"), { code: 1 })));
  await assert.rejects(() => failed("/tmp/asset.mp4"), /ffprobe could not read asset\.mp4/);

  const garbage = makeFfprobe((cmd, args, cb) => cb(null, "not json"));
  await assert.rejects(() => garbage("/tmp/asset.mp4"), /ffprobe could not read asset\.mp4/);
});

test("images must really be JPEG or PNG and within the size limit", async () => {
  const rootDir = makeQueue(
    { "a/1": ready({ media: ["a.jpg", "b.png"] }), "a/2": ready({ media: ["fake.jpg"] }) },
    { "a/1/a.jpg": JPEG, "a/1/b.png": PNG, "a/2/fake.jpg": Buffer.from("this is not an image") },
  );
  const results = await validateAll(findPosts(rootDir), { probe: goodProbe });
  assert.equal(results[0].ok, true);
  assert.equal(results[0].kind, "carousel");
  assert.match(results[1].errors.join(" "), /not a JPEG or PNG/);
  rmSync(rootDir, { recursive: true, force: true });
});

test("an oversized image fails", async () => {
  const rootDir = makeQueue({ "a/1": ready({ media: ["big.jpg"] }) });
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(LIMITS.imageBytes)]);
  writeFileSync(path.join(rootDir, "a/1/big.jpg"), big);
  const [entry] = findPosts(rootDir);
  const result = await validatePost(entry, { probe: goodProbe });
  assert.match(result.errors.join(" "), /larger than 8 MB/);
  rmSync(rootDir, { recursive: true, force: true });
});

test("bad status, bad scheduledFor and a bad media combination all fail", async () => {
  const rootDir = makeQueue(
    {
      "a/1": ready({ status: "pending" }),
      "a/2": ready({ scheduledFor: "next tuesday" }),
      "a/3": ready({ media: ["a.mp4", "b.jpg"] }),
    },
    { "a/1/asset.mp4": MP4, "a/2/asset.mp4": MP4, "a/3/a.mp4": MP4, "a/3/b.jpg": JPEG },
  );
  const results = await validateAll(findPosts(rootDir), { probe: goodProbe, statuses: null });
  assert.match(results[0].errors.join(" "), /status must be one of/);
  assert.match(results[1].errors.join(" "), /scheduledFor/);
  assert.match(results[2].errors.join(" "), /one mp4/);
  rmSync(rootDir, { recursive: true, force: true });
});

test("a post.json with no status is reported as status missing, by default too", async () => {
  const rootDir = makeQueue({ "a/1": { media: ["asset.mp4"], caption: "hello" } }, { "a/1/asset.mp4": MP4 });
  const results = await validateAll(findPosts(rootDir), { probe: goodProbe });
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  assert.match(results[0].errors.join(" "), /status missing/);
  rmSync(rootDir, { recursive: true, force: true });
});

test("validateAll checks ready posts only by default", async () => {
  const rootDir = makeQueue({ "a/1": ready({ status: "posted", media: ["gone.mp4"] }), "a/2": ready() }, { "a/2/asset.mp4": MP4 });
  const results = await validateAll(findPosts(rootDir), { probe: goodProbe });
  assert.deepEqual(results.map((r) => r.rel), ["a/2"]);
  rmSync(rootDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `npm --prefix instagram-studio/engine test`
Expected: FAIL, `Cannot find module '../../lib/validate.mjs'`.

- [ ] **Step 3: Write `instagram-studio/engine/lib/validate.mjs`**

```js
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
      if (err) return unreadable(String(err.message ?? err).split("\n")[0]);
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
```

- [ ] **Step 4: Run the test, expect PASS**

Run: `npm --prefix instagram-studio/engine test`
Expected: every validate test passes.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(engine): post.json and media validation with optional ffprobe checks"
```

---

### Task 6: lib/blob.mjs (Vercel Blob upload and delete)

**Files:**
- Create: `instagram-studio/engine/lib/blob.mjs`, `instagram-studio/engine/tests/helpers/fake-blob.mjs`
- Modify: `instagram-studio/engine/package.json` (add the one runtime dependency), `instagram-studio/engine/package-lock.json`
- Test: `instagram-studio/engine/tests/unit/blob.test.mjs`

**Interfaces:**
- Produces:
  - `contentTypeFor(file: string): string`
  - `createBlobStore({ put, del, token, prefix? }): { upload(localPath, keyParts: string[]): Promise<{ url, pathname }>, remove(urls: string[]): Promise<{ url, error }[]> }`. `upload` streams the file: it hands `put` a `fs.createReadStream(localPath)` with `multipart: true`, never a Buffer, because a reel is allowed up to 1 GB (`LIMITS.videoBytes`) and a launchd job must not hold that in memory.
  - `loadVercelBlob(): Promise<{ put, del }>` dynamic import of `@vercel/blob`, so unit tests never touch the package
- Consumes: nothing.

- [ ] **Step 1: Add the dependency, pinned exact**

```bash
npm --prefix instagram-studio/engine install --save-exact @vercel/blob
```

Then confirm `instagram-studio/engine/package.json` has `"@vercel/blob": "<resolved version>"` with no `^` or `~`, and that `package-lock.json` changed. Do not hand-write a version number: record whatever npm resolved.

Before writing `lib/blob.mjs`, check what body types `put` accepts in the version npm just resolved (use the `find-docs` skill, or `npx ctx7@latest library "@vercel/blob"` then `npx ctx7@latest docs <id> "put body types stream multipart"`). The plan streams the file. If that version does not accept a Node readable stream, fall back to `multipart: true` with a `Blob` built from the stream, keep the "never read the whole file into a Buffer" rule, and record the swap in the implementation report.

- [ ] **Step 2: Write the fake, `instagram-studio/engine/tests/helpers/fake-blob.mjs`**

```js
// Stands in for @vercel/blob. `failOn` matches against the key being uploaded,
// `deleteFailsFor` against the url being deleted. `bodyType` records how the body
// arrived, so the suite can prove the file was streamed and not buffered.
export function makeFakeBlob({ failOn = null, deleteFailsFor = null } = {}) {
  const uploads = [];
  const deletes = [];
  const put = async (key, body, options) => {
    const streamed = Boolean(body && typeof body[Symbol.asyncIterator] === "function");
    let size = 0;
    // Drain it like the real client would: a stream that is never read leaves the
    // file open and the test's tmp dir is deleted underneath it.
    if (streamed) { for await (const chunk of body) size += chunk.length; }
    else size = body?.length ?? 0;
    uploads.push({ key, bodyType: streamed ? "stream" : Buffer.isBuffer(body) ? "buffer" : typeof body, size, options });
    if (failOn && key.includes(failOn)) throw new Error(`blob upload failed for ${key}`);
    return { url: `https://blob.example/${key}-abc123`, pathname: `${key}-abc123` };
  };
  const del = async (url) => {
    deletes.push(url);
    if (deleteFailsFor && url.includes(deleteFailsFor)) throw new Error(`blob delete failed for ${url}`);
  };
  return { put, del, uploads, deletes };
}
```

- [ ] **Step 3: Write the failing test, `instagram-studio/engine/tests/unit/blob.test.mjs`**

```js
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
```

- [ ] **Step 4: Run the test, expect FAIL**

Run: `npm --prefix instagram-studio/engine test`
Expected: FAIL, `Cannot find module '../../lib/blob.mjs'`.

- [ ] **Step 5: Write `instagram-studio/engine/lib/blob.mjs`**

```js
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
```

- [ ] **Step 6: Run the test, expect PASS**

Run: `npm --prefix instagram-studio/engine test`

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(engine): Vercel Blob upload and best-effort cleanup"
```

---

### Task 7: lib/graph.mjs (containers, status poll, publish, permalink, tokens)

**Files:**
- Create: `instagram-studio/engine/lib/graph.mjs`, `instagram-studio/engine/tests/helpers/fake-graph.mjs`
- Test: `instagram-studio/engine/tests/unit/graph.test.mjs`

**Interfaces:**
- Produces:
  - `GRAPH_BASE = "https://graph.instagram.com"`, `REFRESH_WINDOW_DAYS = 10`
  - `createGraphClient({ fetch?, baseUrl?, userId, accessToken, sleep?, now? })` returning:
    - `createReelContainer({ videoUrl, caption }): Promise<string>`
    - `createImageContainer({ imageUrl, caption }): Promise<string>`
    - `createCarouselItem({ imageUrl }): Promise<string>`
    - `createCarouselContainer({ children: string[], caption }): Promise<string>`
    - `getContainerStatus(id): Promise<{ statusCode: string, status: string }>`
    - `waitForFinished(id, { intervalMs?, timeoutMs? }): Promise<void>`
    - `publish(creationId): Promise<string>` returns the media id
    - `getPermalink(mediaId): Promise<string>`
  - `exchangeToken({ fetch?, baseUrl?, appSecret, shortLivedToken, now? }): Promise<{ accessToken, expiresAt }>`
  - `refreshToken({ fetch?, baseUrl?, accessToken, now? }): Promise<{ accessToken, expiresAt }>`
  - `needsRefresh(expiresAt: string | null, now?: Date): boolean`
- Consumes: nothing. Every call goes through the injected `fetch`, so no test touches the network.

Shape rules for this module: `createGraphClient` is a factory that returns an object of closures, with no `this` anywhere, so a caller can destructure it safely. `exchangeToken` and `refreshToken` are two parameter sets over one private `tokenCall(pathname, params)`, not two copies of the same body. `expiryFrom` takes the injected clock, so the computed `expiresAt` is an exact assertion in tests rather than a "greater than now" hedge.

Endpoint shapes are taken verbatim from the spec (unversioned paths on `graph.instagram.com`, which is the Instagram API with Instagram Login host). See Open Questions on API version pinning.

- [ ] **Step 1: Write the fake, `instagram-studio/engine/tests/helpers/fake-graph.mjs`**

```js
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
```

- [ ] **Step 2: Write the failing test, `instagram-studio/engine/tests/unit/graph.test.mjs`**

```js
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
```

- [ ] **Step 3: Run the test, expect FAIL**

Run: `npm --prefix instagram-studio/engine test`
Expected: FAIL, `Cannot find module '../../lib/graph.mjs'`.

- [ ] **Step 4: Write `instagram-studio/engine/lib/graph.mjs`**

```js
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
    const message = body?.error?.message ?? text.slice(0, 300);
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
```

- [ ] **Step 5: Run the test, expect PASS**

Run: `npm --prefix instagram-studio/engine test`

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(engine): Instagram Graph API client, container polling and token lifecycle"
```

---

### Task 8: lib/publish.mjs (the per-post sequence and the run loop)

**Files:**
- Create: `instagram-studio/engine/lib/publish.mjs`
- Test: `instagram-studio/engine/tests/unit/publish.test.mjs`

**Interfaces:**
- Consumes: `validatePost` (Task 5), `writePost` and `appendLog` (Task 4), a graph client (Task 7), a blob store (Task 6).
- Produces:
  - `SPACING_MS = 60000`, `RATE_LIMIT = 25`, `RATE_WINDOW_MS = 86400000`
  - `postedInLast24h({ log, now }): number`
  - `publishOne(entry, deps): Promise<Result>` where `Result = { rel, kind, result: "posted" | "failed", mediaId: string | null, url: string | null, error: string | null }`
  - `runPublish({ candidates, deps }): Promise<Result[]>`
  - `deps = { graph, blob, probe, logPath, sleep, now, spacingMs?, pollIntervalMs?, pollTimeoutMs?, onEvent?, writePostFn?, appendLogFn?, readLogFn? }`
  - Log lines: `{ ts, postDir, kind, result, pinned, mediaId, url, error }`. `pinned` comes from the entry's `scheduledFor` and is what keeps a pinned publish out of tomorrow's slot arithmetic (Task 4).

**The sequence, per post** (spec, "ig publish", step 3):

1. Validate. Invalid: write `status: failed` plus `error`, log it, return, do not upload anything.
2. Upload every media file to `instagram-studio/<post dir basename>/<file name>`.
3. Create the container or containers for the kind.
4. Poll the parent container to FINISHED.
5. Publish, then read the permalink.
6. Write `status: posted`, `postedAt`, `url` (and clear `error`) back to `post.json`.
7. Append the log line `{ts, postDir, kind, result, pinned, mediaId, url, error}`.
8. Delete every uploaded blob, best effort, in a `finally` so failures clean up too.

Steps 6 and 7 are themselves guarded: an unwritable `post.json` or log path emits an `io-error` event with the path and the message and returns the result anyway. A per-post IO failure is a per-post failure, never a reason to abort the run (Global Constraints).

`runPublish` sleeps `SPACING_MS` before each publish after the first, including after a failed one, so a catch-up burst never lands as a block.

**The rate-limit guard.** Instagram allows 25 published posts per account per 24 hours, and an account that trips it is blocked for the rest of the window. Before each publish, `runPublish` re-reads the log and counts `result === "posted"` lines whose `ts` is inside the trailing 24 hours. At `RATE_LIMIT` or more it emits `rate-limit-guard`, appends one `result: "skipped-rate-limit"` line, leaves every remaining candidate `ready`, and ends the run cleanly. A post slips to the next run; an API ban would cost far more. Pinned publishes count here, unlike the slot arithmetic: this guard is about the account limit, not about slot bookkeeping.

- [ ] **Step 1: Write the failing test, `instagram-studio/engine/tests/unit/publish.test.mjs`**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { publishOne, runPublish, SPACING_MS, RATE_LIMIT } from "../../lib/publish.mjs";
import { createGraphClient } from "../../lib/graph.mjs";
import { createBlobStore } from "../../lib/blob.mjs";
import { findPosts, readLog, appendLog } from "../../lib/queue.mjs";
import { makeQueue, ready } from "../helpers/tmp-repo.mjs";
import { makeFakeGraph, noSleep } from "../helpers/fake-graph.mjs";
import { makeFakeBlob } from "../helpers/fake-blob.mjs";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const MP4 = Buffer.alloc(64);
const goodProbe = async () => ({ durationSec: 30, width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac" });

function harness(rootDir, { graphOptions = {}, blobOptions = {} } = {}) {
  const fakeGraph = makeFakeGraph(graphOptions);
  const fakeBlob = makeFakeBlob(blobOptions);
  const slept = [];
  const deps = {
    graph: createGraphClient({ fetch: fakeGraph.fetchImpl, userId: "1784140", accessToken: "tok", sleep: noSleep }),
    blob: createBlobStore({ put: fakeBlob.put, del: fakeBlob.del, token: "blob" }),
    probe: goodProbe,
    logPath: path.join(rootDir, "instagram", "log.jsonl"),
    sleep: async (ms) => { slept.push(ms); },
    now: () => new Date("2026-09-02T08:31:00+01:00"),
    pollIntervalMs: 1,
  };
  return { deps, fakeGraph, fakeBlob, slept };
}

test("a reel publishes, writes back, logs and cleans up its blob", async () => {
  const rootDir = makeQueue({ "a/1": ready() }, { "a/1/asset.mp4": MP4 });
  const [entry] = findPosts(rootDir);
  const { deps, fakeBlob } = harness(rootDir);

  const result = await publishOne(entry, deps);
  assert.equal(result.result, "posted");
  assert.equal(result.kind, "reel");
  assert.equal(result.url, "https://www.instagram.com/reel/ABC/");

  const post = JSON.parse(readFileSync(entry.jsonPath, "utf8"));
  assert.equal(post.status, "posted");
  assert.equal(post.url, "https://www.instagram.com/reel/ABC/");
  assert.equal(post.postedAt, "2026-09-02T07:31:00.000Z");
  assert.equal(post.error, null);

  const log = readLog(deps.logPath);
  assert.equal(log.length, 1);
  assert.equal(log[0].result, "posted");
  assert.equal(log[0].kind, "reel");
  assert.equal(log[0].mediaId, "media-1");
  assert.equal(log[0].pinned, false);

  assert.equal(fakeBlob.uploads.length, 1);
  assert.equal(fakeBlob.deletes.length, 1);
  rmSync(rootDir, { recursive: true, force: true });
});

test("a pinned post logs pinned true, so it does not spend a slot next run", async () => {
  const rootDir = makeQueue({ "a/1": ready({ scheduledFor: "2026-09-02T08:00:00+01:00" }) }, { "a/1/asset.mp4": MP4 });
  const [entry] = findPosts(rootDir);
  const { deps } = harness(rootDir);

  const result = await publishOne(entry, deps);
  assert.equal(result.result, "posted");
  assert.equal(readLog(deps.logPath)[0].pinned, true);
  rmSync(rootDir, { recursive: true, force: true });
});

test("a carousel creates one child per slide then a parent with the children", async () => {
  const rootDir = makeQueue({ "a/1": ready({ media: ["a.jpg", "b.jpg"] }) }, { "a/1/a.jpg": JPEG, "a/1/b.jpg": JPEG });
  const [entry] = findPosts(rootDir);
  const { deps, fakeGraph, fakeBlob } = harness(rootDir);

  const result = await publishOne(entry, deps);
  assert.equal(result.result, "posted");
  assert.equal(result.kind, "carousel");
  const creates = fakeGraph.calls.filter((c) => c.method === "POST" && c.path.endsWith("/media"));
  assert.equal(creates.length, 3);
  assert.equal(creates[0].params.is_carousel_item, "true");
  assert.equal(creates[2].params.media_type, "CAROUSEL");
  assert.equal(creates[2].params.children, "container-1,container-2");
  assert.equal(fakeBlob.uploads.length, 2);
  assert.equal(fakeBlob.deletes.length, 2);
  rmSync(rootDir, { recursive: true, force: true });
});

test("a container that errors marks the post failed, keeps the run alive and still deletes the blob", async () => {
  const rootDir = makeQueue({ "a/1": ready() }, { "a/1/asset.mp4": MP4 });
  const [entry] = findPosts(rootDir);
  const { deps, fakeBlob } = harness(rootDir, { graphOptions: { statusSequence: ["ERROR"] } });

  const result = await publishOne(entry, deps);
  assert.equal(result.result, "failed");
  assert.match(result.error, /ERROR/);
  const post = JSON.parse(readFileSync(entry.jsonPath, "utf8"));
  assert.equal(post.status, "failed");
  assert.match(post.error, /ERROR/);
  assert.equal(post.url, null);
  assert.equal(fakeBlob.deletes.length, 1);
  assert.equal(readLog(deps.logPath)[0].result, "failed");
  rmSync(rootDir, { recursive: true, force: true });
});

test("a failed upload cleans up whatever landed first", async () => {
  const rootDir = makeQueue({ "a/1": ready({ media: ["a.jpg", "b.jpg"] }) }, { "a/1/a.jpg": JPEG, "a/1/b.jpg": JPEG });
  const [entry] = findPosts(rootDir);
  const { deps, fakeBlob } = harness(rootDir, { blobOptions: { failOn: "b.jpg" } });

  const result = await publishOne(entry, deps);
  assert.equal(result.result, "failed");
  assert.match(result.error, /blob upload failed/);
  assert.equal(fakeBlob.deletes.length, 1);
  rmSync(rootDir, { recursive: true, force: true });
});

test("an invalid post fails without uploading anything", async () => {
  const rootDir = makeQueue({ "a/1": ready() }); // asset.mp4 missing
  const [entry] = findPosts(rootDir);
  const { deps, fakeBlob } = harness(rootDir);

  const result = await publishOne(entry, deps);
  assert.equal(result.result, "failed");
  assert.match(result.error, /not found/);
  assert.equal(fakeBlob.uploads.length, 0);
  assert.equal(JSON.parse(readFileSync(entry.jsonPath, "utf8")).status, "failed");
  rmSync(rootDir, { recursive: true, force: true });
});

test("runPublish waits 60 seconds between publishes and never before the first", async () => {
  const rootDir = makeQueue(
    { "a/1": ready(), "a/2": ready(), "a/3": ready() },
    { "a/1/asset.mp4": MP4, "a/2/asset.mp4": MP4, "a/3/asset.mp4": MP4 },
  );
  const candidates = findPosts(rootDir);
  const { deps, slept } = harness(rootDir);

  const results = await runPublish({ candidates, deps });
  assert.deepEqual(results.map((r) => r.result), ["posted", "posted", "posted"]);
  assert.deepEqual(slept, [SPACING_MS, SPACING_MS]);
  assert.equal(readLog(deps.logPath).length, 3);
  rmSync(rootDir, { recursive: true, force: true });
});

test("one bad post does not stop the ones behind it", async () => {
  const rootDir = makeQueue({ "a/1": ready(), "a/2": ready() }, { "a/2/asset.mp4": MP4 }); // a/1 media missing
  const candidates = findPosts(rootDir);
  const { deps } = harness(rootDir);

  const results = await runPublish({ candidates, deps });
  assert.deepEqual(results.map((r) => r.result), ["failed", "posted"]);
  rmSync(rootDir, { recursive: true, force: true });
});

test("an unwritable post.json is an io-error event, not a dead run", async () => {
  const rootDir = makeQueue({ "a/1": ready(), "a/2": ready() }, { "a/1/asset.mp4": MP4, "a/2/asset.mp4": MP4 });
  const [first, second] = findPosts(rootDir);
  const events = [];
  const { deps } = harness(rootDir);
  // Point the write-back at the post directory itself: writing there throws EISDIR.
  const unwritable = { ...first, jsonPath: first.dir };

  const results = await runPublish({ candidates: [unwritable, second], deps: { ...deps, onEvent: (e) => events.push(e) } });
  assert.deepEqual(results.map((r) => r.result), ["posted", "posted"]);
  assert.equal(events.filter((e) => e.type === "io-error").length, 1);
  assert.equal(events.find((e) => e.type === "io-error").path, first.dir);
  assert.equal(JSON.parse(readFileSync(second.jsonPath, "utf8")).status, "posted");
  rmSync(rootDir, { recursive: true, force: true });
});

test("25 posts in the trailing 24 hours stops the run and leaves the queue ready", async () => {
  const rootDir = makeQueue({ "a/1": ready(), "a/2": ready() }, { "a/1/asset.mp4": MP4, "a/2/asset.mp4": MP4 });
  const candidates = findPosts(rootDir);
  const events = [];
  const { deps, fakeBlob } = harness(rootDir);
  for (let i = 0; i < RATE_LIMIT; i += 1) {
    appendLog(deps.logPath, { ts: "2026-09-02T02:00:00+01:00", postDir: `old/${i}`, kind: "photo", result: "posted", pinned: false });
  }

  const results = await runPublish({ candidates, deps: { ...deps, onEvent: (e) => events.push(e) } });
  assert.deepEqual(results, []);
  assert.equal(fakeBlob.uploads.length, 0);
  assert.equal(events.filter((e) => e.type === "rate-limit-guard").length, 1);
  const log = readLog(deps.logPath);
  assert.equal(log.at(-1).result, "skipped-rate-limit");
  assert.equal(JSON.parse(readFileSync(candidates[0].jsonPath, "utf8")).status, "ready");
  rmSync(rootDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `npm --prefix instagram-studio/engine test`
Expected: FAIL, `Cannot find module '../../lib/publish.mjs'`.

- [ ] **Step 3: Write `instagram-studio/engine/lib/publish.mjs`**

```js
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
```

- [ ] **Step 4: Run the test, expect PASS**

Run: `npm --prefix instagram-studio/engine test`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(engine): publish sequence, run loop, 60s spacing and blob cleanup"
```

---

### Task 9: lib/launchd.mjs (render the LaunchAgent plist)

**Files:**
- Create: `instagram-studio/engine/lib/launchd.mjs`
- Test: `instagram-studio/engine/tests/unit/launchd.test.mjs`

**Interfaces:**
- Produces:
  - `DEFAULT_LABEL = "com.jordanbrierley.instagram-studio"`
  - `renderPlist({ label?, nodePath, cliPath, repoDir, slots: string[], logDir, startInterval?, pathEnv? }): string`
- Consumes: `Config.slots` from `lib/config.mjs`, passed in by the caller. This module reads nothing from disk and knows nothing about the CLI.

This module comes before the CLI on purpose. `ig.mjs` (Task 10) imports `renderPlist` and `DEFAULT_LABEL` for its `launchd` command, so the module has to exist and be green first, and nothing in this task edits `ig.mjs`.

The plist is a rendered template rather than a static file with placeholders, because the slot list becomes one `StartCalendarInterval` dict per slot and that mapping deserves a test.

`nodePath` is a parameter, never a lookup: launchd needs an absolute interpreter path, and Task 10 passes `--node <path>` when the user gives one and `process.execPath` otherwise. See Open Question 14: a node version-manager upgrade moves that path and the job then dies quietly until `/ig-setup` stage 5 is re-run.

- [ ] **Step 1: Write the failing test, `instagram-studio/engine/tests/unit/launchd.test.mjs`**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { renderPlist, DEFAULT_LABEL } from "../../lib/launchd.mjs";

const base = {
  nodePath: "/opt/homebrew/bin/node",
  cliPath: "/Users/x/.claude/plugins/data/instagram-studio/engine/ig.mjs",
  repoDir: "/Users/x/Sites/my repo",
  slots: ["08:30", "12:30", "17:30"],
  logDir: "/Users/x/Library/Logs/instagram-studio",
};

test("the plist runs ig publish for the repo with an absolute node path", () => {
  const xml = renderPlist(base);
  assert.match(xml, /<key>Label<\/key>\s*<string>com\.jordanbrierley\.instagram-studio<\/string>/);
  assert.match(xml, /<string>\/opt\/homebrew\/bin\/node<\/string>/);
  assert.match(xml, /<string>publish<\/string>/);
  assert.match(xml, /<string>--repo<\/string>/);
  assert.match(xml, /<string>\/Users\/x\/Sites\/my repo<\/string>/);
});

test("one StartCalendarInterval dict per slot, plus the catch-up interval and RunAtLoad", () => {
  const xml = renderPlist(base);
  const dicts = xml.match(/<key>Hour<\/key>/g) ?? [];
  assert.equal(dicts.length, 3);
  assert.match(xml, /<key>Hour<\/key><integer>8<\/integer><key>Minute<\/key><integer>30<\/integer>/);
  assert.match(xml, /<key>Hour<\/key><integer>17<\/integer><key>Minute<\/key><integer>30<\/integer>/);
  assert.match(xml, /<key>StartInterval<\/key>\s*<integer>1800<\/integer>/);
  assert.match(xml, /<key>RunAtLoad<\/key>\s*<true\/>/);
});

test("stdout and stderr go to absolute log paths and PATH is set for ffprobe", () => {
  const xml = renderPlist(base);
  assert.match(xml, /<key>StandardOutPath<\/key>\s*<string>\/Users\/x\/Library\/Logs\/instagram-studio\/out\.log<\/string>/);
  assert.match(xml, /<key>StandardErrorPath<\/key>\s*<string>\/Users\/x\/Library\/Logs\/instagram-studio\/err\.log<\/string>/);
  assert.match(xml, /\/opt\/homebrew\/bin/);
  assert.equal(xml.includes("~"), false); // launchd does not expand a tilde
});

test("a caller-supplied node path and label are rendered verbatim", () => {
  const xml = renderPlist({ ...base, nodePath: "/Users/x/.nvm/versions/node/v22.18.0/bin/node", label: "com.example.ig-test" });
  assert.match(xml, /<string>\/Users\/x\/\.nvm\/versions\/node\/v22\.18\.0\/bin\/node<\/string>/);
  assert.match(xml, /<key>Label<\/key>\s*<string>com\.example\.ig-test<\/string>/);
  assert.equal(xml.includes(DEFAULT_LABEL), false);
});

test("XML special characters in a path are escaped", () => {
  const xml = renderPlist({ ...base, repoDir: "/Users/x/a&b" });
  assert.match(xml, /<string>\/Users\/x\/a&amp;b<\/string>/);
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `npm --prefix instagram-studio/engine test`
Expected: FAIL, `Cannot find module '../../lib/launchd.mjs'`.

- [ ] **Step 3: Write `instagram-studio/engine/lib/launchd.mjs`**

```js
import path from "node:path";

export const DEFAULT_LABEL = "com.jordanbrierley.instagram-studio";
const DEFAULT_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";

const esc = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderPlist({
  label = DEFAULT_LABEL,
  nodePath,
  cliPath,
  repoDir,
  slots,
  logDir,
  startInterval = 1800,
  pathEnv = DEFAULT_PATH,
}) {
  const calendar = slots.map((slot) => {
    const [hour, minute] = slot.split(":").map(Number);
    return `    <dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${esc(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(nodePath)}</string>
    <string>${esc(cliPath)}</string>
    <string>publish</string>
    <string>--repo</string>
    <string>${esc(repoDir)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${esc(pathEnv)}</string>
  </dict>
  <key>StartCalendarInterval</key>
  <array>
${calendar}
  </array>
  <key>StartInterval</key>
  <integer>${startInterval}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${esc(path.join(logDir, "out.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${esc(path.join(logDir, "err.log"))}</string>
</dict>
</plist>
`;
}
```

Why both keys: `StartCalendarInterval` fires at each slot, and launchd runs a missed calendar job once on wake. `StartInterval` of 1800 is the safety net for a Mac that wakes between slots. Both are safe because a run is idempotent: `publishedToday` comes from `log.jsonl`, not from launchd.

- [ ] **Step 4: Run the test, expect PASS**

Run: `npm --prefix instagram-studio/engine test`
Expected: 5 passing launchd tests alongside everything before them.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(engine): render the LaunchAgent plist from the configured slots"
```

---

### Task 10: ig.mjs (the CLI: due, publish, validate, token, launchd)

**Files:**
- Create: `instagram-studio/engine/ig.mjs`
- Test: `instagram-studio/engine/tests/unit/cli.test.mjs`

**Interfaces:**
- Consumes: every lib module from Tasks 3 to 9, including `renderPlist` and `DEFAULT_LABEL` from `lib/launchd.mjs` (Task 9) and `makeRepo` from `tests/helpers/tmp-repo.mjs` (Task 4) in the tests.
- Produces:
  - `main(argv: string[], io?): Promise<number>` returns the exit code. `io = { log, error, now }` defaults to `console.log`, `console.error` and `() => new Date()`. Exported so tests drive the CLI in-process with a pinned clock.
  - Executable behaviour: `node ig.mjs <command> [options]`, auto-running `main(process.argv.slice(2))` only when the file is the entry point.
  - Commands: `due`, `publish [--now <post-dir>] [--dry-run]`, `validate [<post-dir>]`, `token status|exchange|refresh`, `launchd [--label <label>] [--log-dir <dir>] [--node <path>]`.
  - Global options: `--repo <dir>` (defaults to walking up from cwd), `--json` on `due` and `validate`.
  - Exit codes: `0` success (per-post failures included, they are recorded not fatal), `1` `validate` found an invalid post, `2` the run could not start (no repo, bad config, missing secrets, dead token).
  - Secrets file path override for tests and the integration test: `IG_ENV_FILE`.
  - `ig token exchange` takes no argument: it reads the short-lived `IG_ACCESS_TOKEN` out of the secrets file and writes the long-lived one back. No token ever appears on a command line. `ig token status` prints the expiry, never the token. See Open Question 13.
  - `ig due` prints the engine path it is running from as its first line, and carries it as `engine` in `--json`, so a stale plist pointing at an old data directory is visible at a glance.

- [ ] **Step 1: Write the failing test, `instagram-studio/engine/tests/unit/cli.test.mjs`**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { main } from "../../ig.mjs";
import { makeRepo, ready } from "../helpers/tmp-repo.mjs";

// Photos, not reels: the CLI builds a real `makeFfprobe()`, and a stub mp4 is an
// error on any machine that has ffprobe installed (Task 5). An image needs no probe,
// so these tests behave the same with ffmpeg installed and without it.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
// Every test pins the clock to 13:00 on a BST day: two of the three slots have
// passed, so counts, ordering and the candidate list are asserted unconditionally
// rather than "if the suite happens to run after 08:30".
const NOW = new Date("2026-09-02T13:00:00+01:00");

function capture(now = NOW) {
  const lines = [];
  return {
    io: { log: (m) => lines.push(String(m)), error: (m) => lines.push(String(m)), now: () => now },
    text: () => lines.join("\n"),
  };
}

const twoReady = () => makeRepo(
  { "2026-09-01/a": ready({ media: ["photo.jpg"] }), "2026-09-02/b": ready({ media: ["photo.jpg"] }) },
  {},
  { "2026-09-01/a/photo.jpg": JPEG, "2026-09-02/b/photo.jpg": JPEG },
);

test("due --json reports the counts and the ordered candidates", async () => {
  const repo = twoReady();
  const out = capture();
  const code = await main(["due", "--repo", repo, "--json"], out.io);
  assert.equal(code, 0);
  const report = JSON.parse(out.text());
  assert.equal(report.readyCount, 2);
  assert.equal(report.slotsPassed, 2);
  assert.equal(report.publishedToday, 0);
  assert.equal(report.dueCount, 2);
  assert.deepEqual(report.candidates.map((c) => c.rel), ["2026-09-01/a", "2026-09-02/b"]);
  assert.match(report.engine, /ig\.mjs$/);
  rmSync(repo, { recursive: true, force: true });
});

test("due prints the engine path first, then the repo, the timezone and the queue", async () => {
  const repo = twoReady();
  const out = capture();
  await main(["due", "--repo", repo], out.io);
  const lines = out.text().split("\n");
  assert.match(lines[0], /^engine: .*ig\.mjs$/);
  assert.match(out.text(), /slots passed today: 2 of 3/);
  assert.match(out.text(), /Europe\/London/);
  assert.match(out.text(), /1\. 2026-09-01\/a/);
  assert.match(out.text(), /2\. 2026-09-02\/b/);
  rmSync(repo, { recursive: true, force: true });
});

test("validate exits 1 and names the broken post", async () => {
  const repo = makeRepo({ "2026-09-01/a": ready({ media: ["photo.jpg"] }) }); // the file is missing
  const out = capture();
  const code = await main(["validate", "--repo", repo], out.io);
  assert.equal(code, 1);
  assert.match(out.text(), /2026-09-01\/a/);
  assert.match(out.text(), /not found/);
  rmSync(repo, { recursive: true, force: true });
});

test("validate exits 0 on a clean queue", async () => {
  const repo = twoReady();
  const out = capture();
  assert.equal(await main(["validate", "--repo", repo], out.io), 0);
  assert.match(out.text(), /2 ok, 0 to fix/);
  rmSync(repo, { recursive: true, force: true });
});

test("publish --dry-run lists the candidates it would publish and needs no secrets", async () => {
  const repo = twoReady();
  const out = capture();
  const code = await main(["publish", "--repo", repo, "--dry-run"], out.io);
  assert.equal(code, 0);
  assert.match(out.text(), /dry run: 2 post\(s\) would publish/);
  assert.match(out.text(), /2026-09-01\/a {2}photo/);
  assert.match(out.text(), /2026-09-02\/b {2}photo/);
  rmSync(repo, { recursive: true, force: true });
});

test("publish --now resolves one folder and dry runs just that post", async () => {
  const repo = twoReady();
  const out = capture();
  const code = await main(["publish", "--repo", repo, "--now", path.join(repo, "content", "2026-09-02", "b"), "--dry-run"], out.io);
  assert.equal(code, 0);
  assert.match(out.text(), /dry run: 1 post\(s\) would publish/);
  assert.match(out.text(), /2026-09-02\/b/);
  assert.equal(out.text().includes("2026-09-01/a"), false);
  rmSync(repo, { recursive: true, force: true });
});

test("no repo above the cwd is a run-level failure", async () => {
  const empty = mkdtempSync(path.join(os.tmpdir(), "ig-empty-"));
  const out = capture();
  assert.equal(await main(["due", "--repo", empty], out.io), 2);
  assert.match(out.text(), /instagram\/config\.json/);
  rmSync(empty, { recursive: true, force: true });
});

test("a broken config is a run-level failure with a readable message", async () => {
  const repo = makeRepo({}, { slots: ["8:30"] });
  const out = capture();
  assert.equal(await main(["due", "--repo", repo], out.io), 2);
  assert.match(out.text(), /not HH:MM/);
  rmSync(repo, { recursive: true, force: true });
});

test("token status reads the secrets file named by IG_ENV_FILE and never prints the token", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ig-token-"));
  const envFile = path.join(dir, "env");
  writeFileSync(envFile, "IG_USER_ID=123\nIG_ACCESS_TOKEN=secret-token-abc123\nIG_TOKEN_EXPIRES_AT=2026-11-01T00:00:00.000Z\n", { mode: 0o600 });
  const previous = process.env.IG_ENV_FILE;
  process.env.IG_ENV_FILE = envFile;
  const out = capture();
  const code = await main(["token", "status"], out.io);
  process.env.IG_ENV_FILE = previous;
  assert.equal(code, 0);
  assert.match(out.text(), /2026-11-01/);
  assert.equal(out.text().includes("secret-token-abc123"), false);
  rmSync(dir, { recursive: true, force: true });
});

test("ig launchd prints a plist for the repo slots", async () => {
  const repo = makeRepo({});
  const out = capture();
  assert.equal(await main(["launchd", "--repo", repo, "--log-dir", "/tmp/ig-logs"], out.io), 0);
  assert.match(out.text(), /<key>StartCalendarInterval<\/key>/);
  assert.equal((out.text().match(/<key>Hour<\/key>/g) ?? []).length, 3);
  assert.match(out.text(), /\/tmp\/ig-logs\/out\.log/);
  assert.match(out.text(), /ig\.mjs<\/string>/); // the plist points at this engine
  rmSync(repo, { recursive: true, force: true });
});

test("ig launchd takes the node path from --node when it is given", async () => {
  const repo = makeRepo({});
  const out = capture();
  assert.equal(await main(["launchd", "--repo", repo, "--node", "/opt/homebrew/bin/node"], out.io), 0);
  assert.match(out.text(), /<string>\/opt\/homebrew\/bin\/node<\/string>/);
  rmSync(repo, { recursive: true, force: true });
});

test("an unknown command prints usage and exits 2", async () => {
  const out = capture();
  assert.equal(await main(["frobnicate"], out.io), 2);
  assert.match(out.text(), /Usage: ig/);
});
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `npm --prefix instagram-studio/engine test`
Expected: FAIL, `Cannot find module '../../ig.mjs'`.

- [ ] **Step 3: Write `instagram-studio/engine/ig.mjs`**

```js
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
import { createGraphClient, exchangeToken, refreshToken, needsRefresh } from "./lib/graph.mjs";
import { createBlobStore, loadVercelBlob } from "./lib/blob.mjs";
import { runPublish } from "./lib/publish.mjs";
import { renderPlist, DEFAULT_LABEL } from "./lib/launchd.mjs";

const ENGINE_PATH = fileURLToPath(import.meta.url);

const USAGE = `Usage: ig <command> [options]

  due                                      what would publish right now, no side effects
  publish [--now <post-dir>] [--dry-run]   publish everything due
  validate [<post-dir>]                    check the queue against the contract
  token status | exchange | refresh        exchange reads the short-lived token from the secrets file
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
  if (!needsRefresh(env.IG_TOKEN_EXPIRES_AT)) return env;
  try {
    const refreshed = await refreshToken({ accessToken: env.IG_ACCESS_TOKEN });
    return persistToken(refreshed, envPath(), io);
  } catch (err) {
    const stillValid = env.IG_TOKEN_EXPIRES_AT && new Date(env.IG_TOKEN_EXPIRES_AT).getTime() > Date.now();
    if (stillValid) { io.error(`token refresh failed (${err.message}), continuing with the current token`); return env; }
    throw new RunError(`token refresh failed and the token has expired: ${err.message}. Run /ig-setup to re-authorise.`);
  }
}

async function cmdPublish(values, io) {
  const repo = openRepo(values);
  const now = io.now();
  const probe = makeFfprobe();

  const candidates = values.now
    ? [resolvePostDir(values.now, repo)]
    : report(repo, now).candidates.map((c) => readPost(path.join(c.dir, "post.json"), repo.rootDir));

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
  requireSecrets(env, PUBLISH_KEYS);
  env = await ensureToken(env, io);

  const { put, del } = await loadVercelBlob();
  const deps = {
    graph: createGraphClient({ userId: env.IG_USER_ID, accessToken: env.IG_ACCESS_TOKEN }),
    blob: createBlobStore({ put, del, token: env.BLOB_READ_WRITE_TOKEN }),
    probe,
    logPath: repo.logPath,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => new Date(),
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
    requireSecrets(env, EXCHANGE_KEYS);
    const result = await exchangeToken({ appSecret: env.IG_APP_SECRET, shortLivedToken: env.IG_ACCESS_TOKEN });
    persistToken(result, envPath(), io);
    return 0;
  }
  if (action === "refresh") {
    requireSecrets(env, REFRESH_KEYS);
    const result = await refreshToken({ accessToken: env.IG_ACCESS_TOKEN });
    persistToken(result, envPath(), io);
    return 0;
  }
  throw new RunError(`unknown token action "${action}", expected status, exchange or refresh`);
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
```

- [ ] **Step 4: Run the test, expect PASS**

Run: `npm --prefix instagram-studio/engine test`
Expected: every CLI test passes, including the two `launchd` ones, because `lib/launchd.mjs` landed in Task 9.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(engine): ig CLI with due, publish, validate, token and launchd commands"
```

---

### Task 11: Skills and commands (ig-setup, ig-post, ig-queue)

**Files:**
- Create: `instagram-studio/skills/ig-setup/SKILL.md`, `instagram-studio/skills/ig-post/SKILL.md`, `instagram-studio/skills/ig-queue/SKILL.md`, `instagram-studio/commands/ig-setup.md`, `instagram-studio/commands/ig-post.md`, `instagram-studio/commands/ig-queue.md`

**Interfaces:**
- Consumes: the CLI surface from Task 10 (which includes the `launchd` command built on Task 9), exactly as written there. Every command in these files is `node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" <command>`.
- Produces: nothing other tasks consume. `scripts/validate.mjs` (Task 1) checks that each skill has frontmatter whose `name` matches its directory.

Copy rules for every file in this task: no em dashes, no Cyted references, no invented Instagram behaviour. Secrets are never echoed back to the user and never printed by a command the skill runs, and no command a skill runs carries a secret as an argument.

Two rules about who runs what, because getting them wrong breaks the setup silently:

- A block the USER pastes into their own terminal must not use `${CLAUDE_PLUGIN_DATA}`: it is unset there, and `node "/engine/ig.mjs"` is the result. Heredocs in those blocks are written flush left, terminator included, because an indented `EOF` never closes the heredoc on paste.
- A block YOU run may use `${CLAUDE_PLUGIN_DATA}` and must never carry a token, an app secret or a blob token as an argument.

- [ ] **Step 1: Write `instagram-studio/skills/ig-setup/SKILL.md`**

````markdown
---
name: ig-setup
description: Use for the one-time instagram-studio setup in a repo, "set up Instagram posting", "connect my Instagram account", first run of /ig-setup, or when instagram/config.json or the secrets file is missing. Walks the Meta app, the token exchange, the config and the launchd job.
---

# Instagram setup

One-time setup per machine and repo. Five stages: engine check, Meta app, token, config, scheduler.
Stop at the first stage that fails and fix it before moving on.

## Rules

- You never invent, guess or store a secret. The user creates every credential in their browser and
  writes it to the secrets file themselves, with the command block you hand them.
- The secrets file is `~/.config/instagram-studio/env`, mode 600. Nothing secret is ever written into
  the repo, into `instagram/config.json`, or into the plist.
- Never run a command that prints a token, and never put a token on a command line. `ig token status`
  prints the expiry only, use that.
- A block the user runs never mentions `${CLAUDE_PLUGIN_DATA}`: that variable exists in your
  environment, not in their login shell. A block you run never contains a secret.

## Stage 1: engine

Run `test -f "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" && echo ok`. If it is not there the SessionStart
bootstrap has not finished: tell the user to run `/reload-plugins` or restart Claude Code, then stop.

Run `node --version`. It must be 22.18.0 or higher.

Run `command -v ffprobe`. If it is missing, say that video checks will be skipped with a warning and
that `brew install ffmpeg` turns them on. This never blocks setup.

## Stage 2: the Meta app (the user does this in their browser)

Give the user these steps, one at a time, and wait after each:

1. Go to https://developers.facebook.com/apps and create an app. When asked what the app does, pick
   the option for Instagram, then add the product "Instagram API with Instagram Login".
2. In the app, open the Instagram product settings and add their Instagram account as an Instagram
   Tester, then accept the tester invitation in the Instagram app under Settings, Website Permissions,
   Tester Invites.
3. In the Instagram product settings, copy the Instagram App ID and the Instagram App Secret.
4. Use the Business Login link in the same settings page, log in as their account, approve the
   permissions, and copy the short-lived access token and the Instagram user id that come back.

If the account is not a Creator or Business account, stop: publishing needs one. Point them at the
account type switch in the Instagram app.

## Stage 3A: the secrets file (THE USER runs this, in their own terminal)

Hand the user this block with the five values filled in. Do not run it yourself, and do not ask them
to paste the values back to you. It must be pasted exactly as it is: the `EOF` line has to start in
column 1 or the shell will sit on a continuation prompt.

```bash
mkdir -p ~/.config/instagram-studio && chmod 700 ~/.config/instagram-studio
cat > ~/.config/instagram-studio/env <<'EOF'
IG_APP_ID=paste-app-id
IG_APP_SECRET=paste-app-secret
IG_USER_ID=paste-instagram-user-id
IG_ACCESS_TOKEN=paste-short-lived-token
BLOB_READ_WRITE_TOKEN=paste-vercel-blob-token
EOF
chmod 600 ~/.config/instagram-studio/env
```

Five values, no sixth: `IG_TOKEN_EXPIRES_AT` is written by the CLI in stage 3B, not by hand.

The Vercel Blob token comes from a Vercel project, Storage, a Blob store, then the read-write token.
It is what hosts the media while Instagram fetches it.

Ask the user to confirm the file exists before you continue:
`ls -l ~/.config/instagram-studio/env` should show `-rw-------`.

## Stage 3B: the token exchange (YOU run this)

Swap the short-lived token for the 60 day one. The command takes no argument: it reads
`IG_ACCESS_TOKEN` out of the secrets file, so no token ever reaches a command line or `ps`.

```bash
node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" token exchange
node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" token status
```

`token status` should print an expiry about 60 days out. If it says the token is missing, the file
was not written where the CLI reads it: check the path in stage 3A.

## Stage 4: the repo config

Ask which directory holds the posts and which daily times to publish at. Write
`instagram/config.json` in the repo root:

```json
{
  "root": "content",
  "slots": ["08:30", "12:30", "17:30"],
  "timezone": "Europe/London",
  "maxLateMinutes": 240
}
```

`maxLateMinutes: 240` means a slot whose time passed more than four hours ago is skipped for the day
rather than published late, so a Mac that wakes at 22:00 posts once rather than emptying the day's
slots at night. `null` is the code default and means always catch up: offer it if the user would
rather never miss a slot.

Add `instagram/log.jsonl` to the repo `.gitignore`.

## Stage 5: the scheduler

```bash
node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" launchd --repo "$PWD" > ~/Library/LaunchAgents/com.jordanbrierley.instagram-studio.plist
mkdir -p ~/Library/Logs/instagram-studio
launchctl unload ~/Library/LaunchAgents/com.jordanbrierley.instagram-studio.plist 2>/dev/null
launchctl load ~/Library/LaunchAgents/com.jordanbrierley.instagram-studio.plist
launchctl list | grep instagram-studio
```

The plist bakes in absolute paths for node, the CLI and the repo. `ig launchd` uses the node that is
running it; pass `--node /path/to/node` to pin a different one. Re-run this stage whenever the plugin
is reinstalled to a different data directory, the repo moves, or node is upgraded by a version
manager such as nvm or fnm, because each of those changes one of those absolute paths.

## Smoke test

Run `node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" due`. Show the output. Setup is done when it prints
the engine path, the slot counts and the candidate list without an error.

Tell the user what happens next in one or two sentences: the job runs at each slot and on wake, one
post per slot, and `/ig-queue` shows what is waiting.
````

- [ ] **Step 2: Write `instagram-studio/skills/ig-post/SKILL.md`**

````markdown
---
name: ig-post
description: Use to publish Instagram posts from the queue now, "post to Instagram", "publish the next post", "post this one now", /ig-post. Shows what is due and publishes only after an explicit yes.
---

# Publish now

The scheduler already posts at each slot. This skill is for publishing on demand, with a human
looking at it.

## Never publish without a yes

Publishing is irreversible from here: the API has no unpublish. Always show the candidates and wait
for the user to say yes. A vague "sounds good" about something else is not a yes.

## Flow

1. `node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" due --json`. If the CLI is missing, tell the user to
   run `/reload-plugins` and stop. If it exits non-zero, show the message: it means no config or a
   broken config, and `/ig-setup` is the fix.
2. Show the user the candidate list: folder, kind, first line of the caption, and how the count was
   reached (slots passed today, published today, due now).
3. If the user named a specific post, resolve it to its folder and use `--now <folder>` instead. That
   bypasses the slot maths for that one post.
4. Run `node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" publish --dry-run` first when anything looks off,
   it validates without uploading.
5. On an explicit yes, run the real command:
   - everything due: `node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" publish`
   - one post: `node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" publish --now <folder>`
   A reel takes a minute or two: the media uploads, Instagram transcodes, then it publishes. More
   than one post in a run waits 60 seconds between publishes, so allow for that.
6. Report the permalinks. For anything that failed, read the error out of the post folder's
   `post.json` and say what to fix. Nothing needs resetting by hand except the status: a failed post
   stays `failed` until someone sets it back to `ready`.

## What "due" means

`due = slots passed today - posts published today`, capped at the number of unpinned ready posts;
pinned posts whose time has come are added on top. Published-today comes from `instagram/log.jsonl`
and counts unpinned publishes only, so running this twice in a row does not double post and a pinned
post never eats a slot.

If a run stops with a rate-limit message, that is the guard: Instagram allows 25 posts per account
per 24 hours, the queue is left `ready`, and the next run carries on.
````

- [ ] **Step 3: Write `instagram-studio/skills/ig-queue/SKILL.md`**

````markdown
---
name: ig-queue
description: Use to inspect the Instagram queue, "what is queued", "when does this post go out", "check my posts", /ig-queue. Validates every ready post and projects the slot each one lands in.
---

# Queue and projection

Read-only. This skill never publishes.

## Flow

1. `node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" validate --json`, and
   `node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" due --json`.
2. Show validation first: every post that is not ok, with its errors, most broken first. A post that
   fails validation will be marked failed the moment the scheduler reaches it, so fixing it now is
   the whole point of this skill. A post reported as `status missing` is not queued at all until
   someone adds `"status": "ready"`.
3. Project the schedule. The slots come from `instagram/config.json`. Walk forward from now: fill
   today's remaining slots, then each following day, one post per slot, in the queue order the `due`
   output reports (pinned posts first at their own time, then folder path ascending). Print it as a
   short table of date, time, folder, kind.
4. Close with the drain date. Count the unpinned ready posts as N, the slots left today as R, and the
   slots per day as S: the last unpinned post lands `ceil(max(0, N - R) / S)` days out. Say the date,
   not just the number of days. List pinned posts separately with their own `scheduledFor` dates:
   they publish at their own time, in addition to the slots, so they are not part of that arithmetic.

## Reading the ledger

`instagram/log.jsonl` is the append-only record: one JSON object per publish attempt with `ts`,
`postDir`, `kind`, `result`, `pinned`, `mediaId`, `url` and `error`. Use it to answer "what went out
today" and "why did that one fail". A `skipped-rate-limit` line means the run stood down at
Instagram's 25 posts per 24 hours. Never edit the file: the due maths counts published-today from it.
````

- [ ] **Step 4: Write the three command files**

`instagram-studio/commands/ig-setup.md`:

```markdown
---
description: One-time setup for unattended Instagram posting: Meta app, access token, queue config and the scheduled job
---

Invoke the instagram-studio:ig-setup skill and work through it stage by stage.

If `instagram/config.json` already exists in this repo and
`node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" token status` reports a live token, setup is already done:
say so, show `node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" due`, and ask whether the user wants to
change slots, re-authorise the token, or reinstall the scheduled job, rather than starting again.

$ARGUMENTS may name the posts directory or the daily slots. Carry it into the config stage.
```

`instagram-studio/commands/ig-post.md`:

```markdown
---
description: Show what is due on Instagram and publish it after an explicit yes
---

Invoke the instagram-studio:ig-post skill.

If `${CLAUDE_PLUGIN_DATA}/engine/ig.mjs` is missing, the plugin is still bootstrapping: tell the user
to run /reload-plugins or restart Claude Code, and stop. If the repo has no `instagram/config.json`,
invoke the instagram-studio:ig-setup skill instead.

$ARGUMENTS may name one post folder to publish now, in which case use `publish --now <folder>` after
confirming with the user.
```

`instagram-studio/commands/ig-queue.md`:

```markdown
---
description: Validate the Instagram queue and project when each post goes out
---

Invoke the instagram-studio:ig-queue skill.

If `${CLAUDE_PLUGIN_DATA}/engine/ig.mjs` is missing, tell the user to run /reload-plugins or restart
Claude Code, and stop. If the repo has no `instagram/config.json`, invoke the
instagram-studio:ig-setup skill instead.

$ARGUMENTS may narrow the listing to one folder or one date.
```

- [ ] **Step 5: Review against the spec**

Confirm each of these, and fix any gap now rather than later:
- `/ig-setup` covers the Meta app with Instagram Login, the tester role, the Business Login consent, the token exchange, the blob token, the config, the plist with `StartCalendarInterval` per slot plus `RunAtLoad` and `StartInterval 1800`, the log paths, and `ig due` as the smoke test.
- Stage 3 is split: 3A is the user's own terminal, with a flush-left heredoc, five values, and no `${CLAUDE_PLUGIN_DATA}`; 3B is yours, `token exchange` then `token status`, with no token on either command line.
- Stage 4 writes `maxLateMinutes: 240`, and says what `null` would mean instead.
- `/ig-post` runs `ig due`, shows candidates, publishes only after an explicit yes, supports `--now`, and reports permalinks. Its "what due means" paragraph matches Task 4: capped at the number of unpinned ready posts, pinned posts added on top.
- `/ig-queue` runs `ig validate`, projects slot times, and its drain arithmetic is `ceil(max(0, N - R) / S)` over unpinned posts with pinned posts listed separately.
- No file mentions Cyted. No file contains an em dash.

- [ ] **Step 6: Validate and commit**

```bash
node scripts/validate.mjs
grep -ri cyted instagram-studio/ ; echo "expect no matches above"
git add -A && git commit -m "feat: ig-setup, ig-post and ig-queue skills and commands"
```

---

### Task 12: Integration test against the real account

**Files:**
- Create: `instagram-studio/engine/tests/integration/publish.integration.test.mjs`, `instagram-studio/engine/tests/integration/fixtures/square.jpg` (a generated 1080x1080 JPEG, see Step 1)

**Interfaces:**
- Consumes: the real `lib/graph.mjs`, `lib/blob.mjs`, `lib/publish.mjs` and `makeFfprobe()`, plus `PUBLISH_KEYS` and real credentials from `IG_ENV_FILE` or `~/.config/instagram-studio/env`. Nothing is stubbed: a photo never invokes ffprobe anyway, so the real probe costs nothing and the test stays honest.
- Produces: nothing other tasks consume. It proves the token, the host and the publish path end to end.

Gating: the whole file skips unless `IG_INTEGRATION=1`. It never runs in the unit suite (`npm test` points at `tests/unit`).

- [ ] **Step 1: Create the fixture**

The fixture is generated, not vendored, and the step fails loudly rather than leaving Step 2 to
trip over a missing file. Two sources are tried in order, then the result is measured.

```bash
mkdir -p instagram-studio/engine/tests/integration/fixtures
OUT=instagram-studio/engine/tests/integration/fixtures/square.jpg
rm -f "$OUT"

# 1. ImageMagick if it is installed (v7 ships `magick`, v6 ships `convert`).
if command -v magick >/dev/null 2>&1; then
  magick -size 1080x1080 xc:'#222222' "$OUT"
elif command -v convert >/dev/null 2>&1; then
  convert -size 1080x1080 xc:'#222222' "$OUT"
fi

# 2. Otherwise resize a stock macOS desktop picture with sips.
if [ ! -s "$OUT" ]; then
  SRC=$(find "/System/Library/Desktop Pictures" -maxdepth 2 \( -iname '*.heic' -o -iname '*.jpg' -o -iname '*.png' \) 2>/dev/null | head -1)
  if [ -n "$SRC" ]; then
    sips -s format jpeg -z 1080 1080 "$SRC" --out "$OUT" >/dev/null
  fi
fi

# 3. Measure it. No fixture, no integration test.
WIDTH=$(sips -g pixelWidth "$OUT" 2>/dev/null | awk '/pixelWidth/ {print $2}')
if [ "$WIDTH" != "1080" ]; then
  echo "could not build a 1080x1080 JPEG at $OUT. Install ImageMagick (brew install imagemagick) or copy a 1080x1080 JPEG there, then re-run this step." >&2
  exit 1
fi
ls -l "$OUT"
```

Expected: the step prints a JPEG of a few tens of KB, well under the 8 MB image limit.

- [ ] **Step 2: Write `instagram-studio/engine/tests/integration/publish.integration.test.mjs`**

```js
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
```

- [ ] **Step 3: Confirm it skips by default**

Run: `npm --prefix instagram-studio/engine test`
Expected: unchanged, the integration file is not in `tests/unit`.

Run: `npm --prefix instagram-studio/engine run test:integration`
Expected: 1 skipped test, exit 0, no network traffic.

- [ ] **Step 4: Run it for real, once**

Run: `IG_INTEGRATION=1 npm --prefix instagram-studio/engine run test:integration`
Expected: a photo appears on the account, the test passes, and the console names the post to delete
by hand. Delete it in the Instagram app.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "test: opt-in integration test that publishes a fixture photo end to end"
```

---

### Task 13: README, licence, manual acceptance

**Files:**
- Create: `README.md`, `LICENSE`
- Modify: none

**Interfaces:**
- Consumes: the finished CLI, skills and commands.
- Produces: the install and usage documentation, plus the acceptance run that gates calling this done.

- [ ] **Step 1: Write `README.md`**

```markdown
# instagram-studio

Post to Instagram from a queue, unattended.

Drop a `post.json` next to your media, and a scheduled job on your Mac publishes reels, photos and
carousels at your daily slots. No browser, no Claude session open, no Instagram scheduling tools.

## Install

Clone the repo, then add it as a local marketplace:

    /plugin marketplace add /absolute/path/to/instagram-studio
    /plugin install instagram-studio@jordanbrierley-instagram

Once the repo is published on GitHub, `/plugin marketplace add jordanbrierley/instagram-studio` does
the same thing without a clone.

Restart Claude Code once so the SessionStart bootstrap can install the engine dependencies into the
plugin data directory. Nothing is installed into your repo.

Then run `/ig-setup` and follow it.

## Requirements

- macOS with launchd (the scheduler is a LaunchAgent), and a Mac that sleeps rather than shuts down.
- Node 22.18.0 or newer.
- An Instagram Creator or Business account, and a Meta app with the "Instagram API with Instagram
  Login" product, with your account added as an Instagram Tester.
- A Vercel Blob store. Media is uploaded there while Instagram fetches it, then deleted.
- Optional: `ffmpeg` for `ffprobe`, which turns on the video duration, aspect ratio and codec checks.

## What lands in your repo

    instagram/
    ├── config.json      # posts directory, daily slots, timezone
    └── log.jsonl        # append-only run log, gitignore this

`config.json`, as `/ig-setup` writes it:

    {
      "root": "content",
      "slots": ["08:30", "12:30", "17:30"],
      "timezone": "Europe/London",
      "maxLateMinutes": 240
    }

Any folder under `root` that contains a `post.json` is a post, and a post folder is a leaf: a
`post.json` nested inside one is never a second post.

    {
      "media": ["asset.mp4"],
      "caption": "...",
      "scheduledFor": null,
      "status": "ready",
      "postedAt": null,
      "url": null,
      "error": null
    }

- `media` paths are relative to the post folder. One mp4 is a reel, one image is a photo, 2 to 10
  images are a carousel. Anything else fails validation.
- `scheduledFor` is optional. An ISO datetime with an offset pins the post: it publishes at the first
  run at or after that time, ahead of everything else.
- `status` is `ready`, `posted`, `skipped` or `failed`. Only `ready` posts are candidates, and there
  is no default: a `post.json` with no `status` is reported by `/ig-queue` as `status missing` rather
  than published, so a post has to opt in.
- `postedAt`, `url` and `error` are written by the publisher.

## Commands

- `/ig-setup` one-time setup: Meta app, token, config, scheduled job.
- `/ig-queue` validate the queue and see when each post goes out.
- `/ig-post` show what is due and publish it after you say yes.

Under the hood everything is one CLI:

    node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" due
    node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" validate
    node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" publish [--now <post-dir>] [--dry-run]
    node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" token status | exchange | refresh
    node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" launchd [--label <label>] [--log-dir <dir>] [--node <path>]

`token exchange` takes no argument: it reads the short-lived token out of the secrets file and writes
the long-lived one back, so no token is ever typed on a command line. `token status` prints the
expiry, never the token. `due` prints the engine path it is running from, which is the quickest way
to spot a stale LaunchAgent pointing at an old plugin data directory.

## How the scheduling works

Instagram has no scheduled publishing for Instagram accounts, so the schedule is local. The
LaunchAgent fires at each slot, on load, and every 30 minutes as a safety net. Each run works out
`slots passed today - posts published today`, capped at the number of unpinned ready posts; pinned
posts whose time has come are added on top. It publishes that many, oldest first, waiting 60 seconds
between posts. Published-today comes from `instagram/log.jsonl` and counts unpinned publishes only,
so a run is idempotent: a Mac that wakes at 22:00 after missing three slots publishes three posts
once, not three times, and a pinned post never quietly spends a slot.

Instagram allows 25 published posts per account per 24 hours. Before each publish the run counts what
went out in the trailing 24 hours and stands down at 25, leaving the rest of the queue `ready` for the
next run.

Set `maxLateMinutes` to skip a slot that passed a long time ago instead of publishing it late.
`/ig-setup` writes 240, so a slot more than four hours stale is skipped for the day; `null` means
always catch up.

The plist holds absolute paths for node, the CLI and your repo. Re-run `/ig-setup` stage 5 after the
repo moves, the plugin is reinstalled, or a version manager such as nvm or fnm upgrades node, because
each of those moves a path the job depends on.

## Secrets

Credentials live only in `~/.config/instagram-studio/env`, mode 600:

    IG_APP_ID, IG_APP_SECRET, IG_USER_ID, IG_ACCESS_TOKEN, IG_TOKEN_EXPIRES_AT, BLOB_READ_WRITE_TOKEN

You write the first five yourself during `/ig-setup`; the CLI writes `IG_TOKEN_EXPIRES_AT` and
replaces `IG_ACCESS_TOKEN` with the long-lived token. Comments and layout in that file are preserved
when it does.

Nothing secret is written into your repo or into the plist. The 60 day token refreshes itself when a
run finds it inside 10 days of expiry. Instagram only allows a long-lived refresh once the token is
at least 24 hours old, and that 10 day window means any token being refreshed is about 50 days old,
so no extra guard is needed. If the Mac is away for more than 60 days the token dies and `/ig-setup`
re-authorises it.

## Failures

A post that fails is marked `status: failed` with the reason in `error`, and the run moves on. Fix
the file, set `status` back to `ready`, and it rejoins the queue. Failures never block the posts
behind them, and they never consume a slot.

## Development

    npm test               # unit suite, node:test, no network
    npm run validate       # manifests and house style
    IG_INTEGRATION=1 npm run test:integration   # publishes a real photo, then tells you to delete it
```

- [ ] **Step 2: Write `LICENSE`**

Exactly this, no template placeholders left behind:

```text
MIT License

Copyright (c) 2026 Jordan Brierley

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 3: Full check**

```bash
node scripts/validate.mjs
npm test
# validate.mjs already walks instagram-studio/ (dot directories included), scripts/ and
# README.md for em dashes. This is the independent second opinion.
grep -rn "$(printf '\xe2\x80\x94')" README.md scripts/ instagram-studio/ ; echo "expect no matches above"
```

- [ ] **Step 4: Manual acceptance on the Mac** (this is the gate, not the unit suite)

- [ ] `rm -rf ~/.claude/plugins/data/instagram-studio*`, then `/plugin marketplace add /Users/jordanbrierley/Sites/startups/instagram-studio` and `/plugin install instagram-studio@jordanbrierley-instagram`, restart Claude Code.
- [ ] `${CLAUDE_PLUGIN_DATA}/engine/ig.mjs` exists and `node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" due` runs. Its first line, `engine: ...`, matches the path the loaded plist runs (`grep -A2 ProgramArguments ~/Library/LaunchAgents/com.jordanbrierley.instagram-studio.plist`).
- [ ] `/ig-setup` end to end in a real repo: Meta app, token exchange, config, plist loaded, `launchctl list | grep instagram-studio` shows the job.
- [ ] `ls -l ~/.config/instagram-studio/env` shows `-rw-------`.
- [ ] `/ig-queue` validates the real queue and projects slot times that match `config.json`.
- [ ] `/ig-post` publishes one real post after an explicit yes, and the permalink opens.
- [ ] Leave a reel `ready`, close the laptop until after the next slot, open it: the reel is posted, `post.json` says `posted` with a url, and `instagram/log.jsonl` has exactly one line for it.
- [ ] Run the job twice in the same slot window (`launchctl kickstart -k gui/$(id -u)/com.jordanbrierley.instagram-studio`): nothing double posts.
- [ ] Break one post on purpose (rename its mp4): the run marks it `failed`, logs it, and still publishes the next candidate.
- [ ] The Vercel Blob store is empty after a successful run.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "docs: README, licence and the acceptance checklist"
```

---

## Plan Self-Review Notes

**Spec coverage.** Repo layout and manifests (T1), bootstrap in the video-studio shape with an
exit-0-always failure policy (T2), the secrets file, the key lists and `config.json` contract (T3),
the queue contract, ordering and the whole due-count section including every scenario the spec's
Testing list names (T4), `ig validate` rules including caption, hashtags, mp4 size, duration, aspect,
codecs, image type and size, with ffprobe optional but never silently excusing a corrupt file (T5),
streamed Vercel Blob upload and delete after FINISHED (T6), every Graph API call the spec lists plus
the token exchange and refresh with the 10 day window (T7), the publish sequence, per-post failure
semantics, 60 second spacing, the 25-per-24-hours guard and blob cleanup on failure (T8), the plist
with `StartCalendarInterval` per slot, `RunAtLoad`, `StartInterval` and the log paths (T9), the CLI
commands and their exit code contract (T10), the three skills and three commands with the setup
stages the spec describes (T11), the `IG_INTEGRATION=1` test (T12), the README, the licence and the
manual acceptance the spec's Testing section ends with (T13). Two spec items are deliberately not
tasks: the Cyted integration (it edits a different repo, see Open Questions) and Instagram-side
scheduling (a stated non-goal).

**Task order.** `lib/launchd.mjs` (T9) lands before `ig.mjs` (T10) because the CLI imports
`renderPlist` and `DEFAULT_LABEL` from it. Every task therefore ends with a green suite and a
complete artifact: there is no point in the plan where a committed file imports a module that does
not exist yet.

**Type consistency.** `PostEntry` is produced by `findPosts` and `readPost` in T4 and consumed
unchanged by T5, T8, T10 and T12. `validatePost` returns `{rel, dir, ok, kind, errors, warnings}` in
T5 and is destructured that way in T8 and T10. The graph client's method names in T7 are the ones T8
calls, and the fake in T7 answers exactly those paths. The blob store's `upload`/`remove` shapes in
T6 match T8's use, including `remove` returning failures rather than throwing. `renderPlist`'s
parameter names in T9 match the call in `cmdLaunchd` in T10, which imports `renderPlist` and
`DEFAULT_LABEL` and nothing else. `deps` keys in T8 match the object T10 builds and the object T12
builds. The log line shape `{ts, postDir, kind, result, pinned, mediaId, url, error}` is written in
T8 and read by `publishedToday` in T4 and by the `ig-queue` skill in T11. `SECRET_KEYS` and its three
subsets are defined once in T3 and imported by T10 and T12: no key list is written twice.

**Known judgment calls.** The slot pool excludes pinned posts and pinned publishes do not consume a
slot (T4, T8), the launchd plist bakes absolute paths resolved at setup time (T9), carousel children
are not individually polled (T8), `ig token exchange` reads the token from the secrets file rather
than an argument (T10), and the integration test cannot clean up after itself (T12). Each is in Open
Questions below.

---

## Open Questions (spec ambiguities, each recorded with its resolution)

These were found while planning. Every one now carries the controller's ruling from the preflight
review, so nothing here is unresolved in the code: what remains open is flagged as open.

1. **Marketplace name collides with the sibling repo.** `video-studio` already publishes a
   marketplace named `jordanbrierley`, and the spec's layout says this repo also gets a
   "jordanbrierley marketplace entry". Two marketplaces cannot share a name on one machine.
   **Resolution:** name this one `jordanbrierley-instagram` (Global Constraints, T1). Still worth
   Jordan's confirmation: the alternative is to add `instagram-studio` as a second plugin inside the
   video-studio marketplace and drop the marketplace file here.
2. **What `readyCount` covers in the due formula.** The spec gives
   `due = min(slotsPassedToday - publishedToday, readyCount)` and separately says pinned posts are
   always due "in addition to the slot count". **Resolution, ACCEPTED deviation from the spec:** the
   slot-driven part is capped at the number of unpinned ready posts and pinned-and-due posts are
   added on top. Ruling R5: "every user-facing statement reads 'capped at the number of unpinned
   ready posts; pinned posts whose time has come are added on top'", which the `ig-post` skill (T11)
   and the README (T13) now say verbatim.
3. **Pinned posts versus the rate-limit claim.** The spec says `ig due` "caps catch-up bursts at the
   slot count so a stale queue cannot exceed" 25 posts per 24 hours, which pinned posts break by
   construction. **Resolution:** ruling R8 puts the cap where it belongs, in the publisher: before
   each publish the run counts `posted` lines in the trailing 24 hours, and "at 25 or more, emit
   `rate-limit-guard`, append a log line with `result: 'skipped-rate-limit'`, leave the remaining
   candidates `ready`, and end the run cleanly". Cost if it fires: a post slips a day. Cost if it did
   not: an API ban.
4. **The integration test's cleanup step.** The spec says the test "archives it via the API". The
   Instagram API with Instagram Login has no documented endpoint for deleting or archiving published
   media. **Resolution, ACCEPTED deviation from the spec:** the test publishes, asserts, and prints
   the permalink for manual deletion (T12 Step 2 is the one place to change if an endpoint appears).
   Ruling R28 also settles the two smaller points there: the test uses the real `makeFfprobe()`, and
   "a token inside the refresh window makes the test `skip` with a message, never fail".
5. **Graph API version.** The spec uses unversioned paths on `graph.instagram.com`, which works, but
   pins nothing. **Still open, by design:** follow the spec exactly, with the base URL as a single
   constant in `lib/graph.mjs`. Confirm against Meta's current documentation during T7 and pin a
   version there if the unversioned host is deprecated.
6. **Carousel child containers are not polled.** The spec describes polling "the container",
   singular. **Resolution, ACCEPTED:** create every child, then create the parent and poll only the
   parent. If Instagram rejects a parent whose children are still processing, T8 gains a per-child
   wait.
7. **Catch-up size on wake.** With `maxLateMinutes: null`, a Mac waking at 22:00 having missed three
   slots publishes three posts in one run, three minutes apart, which reads differently on the
   account than three posts across a day. **Resolution:** ruling R24, "the code default for
   `maxLateMinutes` stays `null` per spec; the config the setup skill WRITES uses `240`". So the
   library keeps the spec's behaviour and a real installation skips a slot that is more than four
   hours stale. Cost: a missed slot is skipped rather than caught up.
8. **The plist points into the plugin data directory.** `ig launchd` bakes
   `${CLAUDE_PLUGIN_DATA}/engine/ig.mjs` in as an absolute path resolved at setup time, so a plugin
   uninstall, a data directory change or a moved repo breaks the job with an empty log as the only
   symptom. **Resolution:** ruling R21, "`ig due` prints the engine path it is running from as its
   first line", so the mismatch is visible in one command; re-running `/ig-setup` stage 5 is the fix,
   and the manual acceptance checks `launchctl list`. A wrapper script in
   `~/.config/instagram-studio/` that resolves the engine at run time remains the sturdier option.
9. **Who types the secrets.** The spec says the setup skill "never types secrets itself" but also
   that "tokens are pasted by the user", which in a Claude Code session means pasted into the
   transcript. **Resolution:** ruling R25 splits stage 3 in two. Half A is run by the user in their
   own terminal: an unindented heredoc, terminator in column 1, writing five values into a mode 600
   file inside a mode 700 directory, with no `${CLAUDE_PLUGIN_DATA}` anywhere in it. Half B is run by
   the agent: `token exchange` then `token status`. No secret passes through the conversation and no
   token appears on a command line.
10. **Cyted integration is out of scope here.** The spec's "Cyted integration" section (emitting
    `post.json` from `cyted-content-daily`, the one-off backfill script, the `QUEUE.md` ledger
    change) edits the Cyted repo, not this one. **Resolution:** it needs its own small plan in that
    repo once this plugin works. It is the reason this plugin exists, so do not lose it.
11. **`maxLateMinutes` semantics near midnight.** Slots and lateness are compared as minutes past
    local midnight, so a slot at 23:50 with `maxLateMinutes: 30` is never late-skipped after
    midnight, it simply stops counting as passed once the day rolls over. **Resolution:** that
    matches "skipped for today" and is the documented behaviour; the spec never states it, so it is
    written down here.
12. **The 24 hour precondition on a token refresh.** The spec says the long-lived refresh is "only
    valid once the token is at least 24 h old", and the plan encodes no such guard. **Resolution,
    ACCEPTED:** ruling R16, "no new key and no guard: `needsRefresh` only fires inside the last 10
    days of a 60-day token, so a token is always older than 24 h when refresh runs". That reasoning
    is a comment above `needsRefresh` (T7) and a line in the README (T13).
13. **`ig token exchange` takes no argument.** The spec writes it as
    `exchange <short-lived-token>`. **Resolution, ACCEPTED deviation from the spec:** ruling R22,
    "`ig token exchange` takes NO argument; it reads `IG_ACCESS_TOKEN` (the short-lived token the
    user wrote) from the env file, exchanges it, and writes back the long-lived token and
    `IG_TOKEN_EXPIRES_AT`. `ig token status` prints expiry only, never the token." Reason: security.
    No token on a command line, and nothing for `ps` to show.
14. **The node path in the plist.** **Resolution, ACCEPTED:** ruling R23, "`renderPlist` takes
    `nodePath` from `--node` if given, else `process.execPath`; README states that a node
    version-manager upgrade requires re-running setup stage 5 to re-render the plist". Cost if it
    goes wrong: the job dies silently after an nvm or fnm upgrade, fixed by re-running setup.
15. **A fifth CLI command the spec does not list.** The spec defines `due | publish | token |
    validate`. **Resolution, ACCEPTED:** ruling R30, the `launchd` command "is ACCEPTED: it is the
    testable plist renderer and the setup skill's only way to get a plist". Cost: one extra command.
16. **`ig validate` prints lines, not a table.** The spec says it "Prints a table".
    **Resolution, ACCEPTED:** ruling R31, "`ig validate` prints per-post lines with indented errors
    and warnings rather than a table; ACCEPTED as more readable in a terminal".
17. **Three lib modules the spec's layout does not list.** The spec names `graph`, `blob`, `queue`
    and `validate`. **Resolution, ACCEPTED:** ruling R32, "`lib/config.mjs`, `lib/publish.mjs`,
    `lib/launchd.mjs` additions are ACCEPTED (already justified in the plan)". The justification is
    under File Structure above: each holds real logic that is only testable as a function.
18. **Task order: launchd before the CLI.** The first draft of this plan built `ig.mjs` in Task 9
    with an import of a module Task 10 created, which left the committed artifact undefined.
    **Resolution:** ruling R1, "swap Tasks 9 and 10. New Task 9 = `lib/launchd.mjs` +
    `tests/unit/launchd.test.mjs` only, no edit to `ig.mjs`. New Task 10 = the complete `ig.mjs` CLI
    with all five commands and the whole `tests/unit/cli.test.mjs`, importing `renderPlist` and
    `DEFAULT_LABEL` only." `plistPathFor` is deleted: nothing consumed it.

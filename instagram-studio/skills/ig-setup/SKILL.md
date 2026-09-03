---
name: ig-setup
description: Use for the one-time instagram-studio setup in a repo, "set up Instagram posting", "connect my Instagram account", first run of /ig-setup, or when instagram/config.json or the secrets file is missing. Walks the Meta app, the token exchange, the config and the launchd job.
---

# Instagram setup

One-time setup per machine and repo. Five stages: engine check, Meta app, token, config, scheduler.
Stop at the first stage that fails and fix it before moving on.

## Rules

- You never invent, guess or store a secret. The user creates every Instagram credential in their
  browser and writes it to the secrets file themselves, with the command block you hand them. The one
  exception is the Vercel Blob token, which the Vercel CLI can create and move into the file without
  it ever being printed.
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
   the use case "Manage messaging & content on Instagram".
2. In the app dashboard, click "Use cases" in the left sidebar, then "Customize" on that use case,
   then "API setup with Instagram login" in the column on the left. There is no separate "Instagram"
   product entry in the main sidebar: this page is where the rest of the stage happens. If "Use cases"
   shows a different use case (for example Facebook Login for Business), "Add use cases" on that page
   adds the Instagram one.
3. Click "Permissions and features" in the same left column and add `instagram_business_content_publish`.
   The "Add all required permissions" button on the setup page adds basic, comments and messages, not
   publish, and a token generated without it cannot post.
4. Give their Instagram account the tester role: main sidebar, "App roles", "Roles", "Add people",
   pick "Instagram Tester", enter the Instagram username. Then accept the invitation from the
   Instagram account: the reliable place is https://www.instagram.com/accounts/manage_access/ on the
   web, "Tester Invites" tab. The phone app path (Settings, Website permissions, Apps and websites,
   Tester Invites) is not always visible. Until the invite is accepted, "Add account" in the next
   step fails with "Insufficient developer role".
5. Back on "API setup with Instagram login", copy the Instagram app ID (shown in plain text) and the
   Instagram app secret (behind the "Show" button).
6. In section 2, "Generate access tokens", the account is usually listed already once the invite is
   accepted; if not, "Add account" and log in as it. Click "Generate token", approve the permissions,
   and copy the token with the dialog's copy button, not by selecting the text. The Instagram user id
   is the number under the username. Leave the webhook toggle off, the engine does not use webhooks.
   A token from this button is already long-lived (60 days). The Business Login link further down the
   page is not the route: it returns an authorization code, not a token.

If the account is not a Creator or Business account, stop: publishing needs one. Point them at the
account type switch in the Instagram app.

## Stage 3A: the secrets file

Five values go into `~/.config/instagram-studio/env`, no sixth: `IG_TOKEN_EXPIRES_AT` is written by
the CLI in stage 3B, not by hand. The four Instagram values are always written by the user. The Blob
token is fetched by you when the Vercel CLI is set up, and by the user otherwise.

### The Blob token (YOU run this, when `vercel whoami` succeeds)

The store must be public: the engine uploads with public access, Instagram fetches the media with no
credentials, and the engine deletes the file afterwards. A private store rejects the upload.

Ask which Vercel project the store should live under and where its linked checkout is (a directory
with `.vercel/project.json`). Create the store connected to the development environment only, pull
that environment into a scratch file, and move the one line across. Nothing prints the token: the
scratch file is mode 600 and deleted at the end. Pick the region nearest the Mac that will upload.

```bash
vercel blob create-store instagram-studio --access public --region lhr1 --environment development --yes --cwd <project-dir>
( umask 077; vercel env pull <scratch>/vercel-dev.env --environment development --yes --cwd <project-dir> )
mkdir -p ~/.config/instagram-studio && chmod 700 ~/.config/instagram-studio
( umask 077; grep '^BLOB_READ_WRITE_TOKEN=' <scratch>/vercel-dev.env >> ~/.config/instagram-studio/env )
chmod 600 ~/.config/instagram-studio/env && rm -f <scratch>/vercel-dev.env
```

`create-store` also rewrites that project's own `.env.local`, which Vercel gitignores: say so.

### The Blob token by hand (otherwise)

Vercel dashboard, a project, Storage, create a Blob store with public access, copy its read-write
token. The user adds it to the block below as a fifth line, `BLOB_READ_WRITE_TOKEN=paste-vercel-blob-token`.

### The Instagram values (THE USER runs this, in their own terminal)

Hand the user this block with the values filled in. Do not run it yourself, and do not ask them to
paste the values back to you. It must be pasted exactly as it is: the `EOF` line has to start in
column 1 or the shell will sit on a continuation prompt. `>>` appends, so a Blob line already in the
file survives.

```bash
mkdir -p ~/.config/instagram-studio && chmod 700 ~/.config/instagram-studio
cat >> ~/.config/instagram-studio/env <<'EOF'
IG_APP_ID=paste-app-id
IG_APP_SECRET=paste-app-secret
IG_USER_ID=paste-instagram-user-id
IG_ACCESS_TOKEN=paste-token-from-generate-token
EOF
chmod 600 ~/.config/instagram-studio/env
```

Ask the user to confirm before you continue: `ls -l ~/.config/instagram-studio/env` should show
`-rw-------`, and `cut -d= -f1 ~/.config/instagram-studio/env` lists the five keys without values.

## Stage 3B: the token (YOU run this)

A token from the dashboard's "Generate token" button is already long-lived, so adopt it. The command
takes no argument: it reads `IG_ACCESS_TOKEN` out of the secrets file, proves it works against the
API, checks it belongs to `IG_USER_ID`, and records the 60 day expiry. No token reaches a command
line or `ps`.

```bash
node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" token adopt
node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" token status
```

Adopt straight after generating: the expiry is dated from the adopt, not from the generation.
If adopt reports "Failed to decode" or "Failed to decrypt", the pasted token is not what the dashboard
issued (a stray character, or a truncated copy): have the user copy it again with the dialog's copy
button and rewrite the `IG_ACCESS_TOKEN` line, then adopt again.
`token exchange` is the equivalent for a one-hour short-lived token from a Business Login flow; given
a long-lived token it fails with "Failed to decode" and says to adopt instead.

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
node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" launchd --repo "<posts-repo>" --node "$(command -v node)" > /tmp/ig-launchd.plist && mv /tmp/ig-launchd.plist ~/Library/LaunchAgents/com.jordanbrierley.instagram-studio.plist
mkdir -p ~/Library/Logs/instagram-studio
launchctl unload ~/Library/LaunchAgents/com.jordanbrierley.instagram-studio.plist 2>/dev/null
launchctl load ~/Library/LaunchAgents/com.jordanbrierley.instagram-studio.plist
launchctl list | grep instagram-studio
```

The plist bakes in absolute paths for node, the CLI and the repo. Without `--node`, `ig launchd`
bakes in the real path of the node running it, which for a Homebrew node is the versioned Cellar
directory that vanishes on the next upgrade; `$(command -v node)` is the stable symlink. Re-run this stage whenever the plugin
is reinstalled to a different data directory, the repo moves, or node is upgraded by a version
manager such as nvm or fnm, because each of those changes one of those absolute paths.

## Smoke test

Run `node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" due`. Show the output. Setup is done when it prints
the engine path, the slot counts and the candidate list without an error.

Tell the user what happens next in one or two sentences: the job runs at each slot and on wake, one
post per slot, and `/ig-queue` shows what is waiting.

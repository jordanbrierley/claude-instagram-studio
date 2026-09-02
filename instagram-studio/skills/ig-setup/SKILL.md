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

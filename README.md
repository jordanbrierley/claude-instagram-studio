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
    node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" validate [<post-dir>]
    node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" publish [--now <post-dir>] [--dry-run]
    node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" token status | exchange | refresh
    node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" launchd [--label <label>] [--log-dir <dir>] [--node <path>]

`${CLAUDE_PLUGIN_DATA}` is set inside Claude Code sessions and hooks, not in a login shell, so these
lines expand to `/engine/ig.mjs` and fail if pasted straight into a plain terminal. Run `due` from
inside Claude Code first; its output starts with `engine: <path>`, the real absolute path to use
from a terminal.

Global options are `--repo <dir>` to specify the repo holding `instagram/config.json` (defaults to the nearest directory above the current directory containing it) and `--json` for machine-readable output on `due` and `validate`. Exit codes are 0 for success (per-post failures are recorded, not fatal), 1 when `validate` finds an invalid post, and 2 when the run cannot start (no repo, bad config, or missing secrets).

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

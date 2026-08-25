# instagram-studio: scheduled Instagram posting as a Claude Code plugin

Date: 2026-08-25
Status: approved design, pre-implementation

## Why

Cyted generates 3 ready-to-post Instagram posts a day (`cyted-content-daily`) but posting is manual.
Browser automation (claude-in-chrome) works for carousels and photos but cannot post reels: Instagram's
web uploader decodes video in a `<video>` element and the extension tab never becomes visible to
Chrome, so the crop step never appears (verified 2026-08-24). Instagram's Graph API publishes reels,
carousels and photos from public URLs with no browser, and the account is already a Creator account.

Instagram has no scheduled-publish for Instagram accounts (only Facebook Pages), so the scheduler is ours.

## Goals

- Unattended posting from a queue of post folders at fixed daily slots, from Jordan's Mac, with no Claude
  session open.
- One contract (`post.json`) any repo can emit; Cyted emits it from `cyted-content-daily`.
- Ships as a Claude Code plugin in the same shape as `video-studio`: engine + skills + commands, nothing
  installed into the user's repo beyond a config file and their post folders.

## Non-goals (deliberately skipped)

- Instagram-side scheduling (unsupported for IG accounts).
- S3/R2 media hosting (Vercel Blob only; add an adapter when a second user needs it).
- Automatic retries of failed posts (a failed reel is almost always a bad file; a human resets it).
- Facebook Login path (Instagram Login needs no Facebook Page).
- Stories, comments, insights, a web UI.

## Decisions taken with Jordan

| Question | Decision |
|---|---|
| Runner | Local launchd job on the Mac, no Claude in the loop. The Mac sleeps but is never shut down. |
| Media host | Vercel Blob, uploaded per publish and deleted after Instagram reports FINISHED. |
| Queue contract | Plugin-owned `post.json` per post folder. |
| Cadence | Daily slots from config, oldest-ready first; optional `scheduledFor` pins a post. |

## Repo layout

```
instagram-studio/                      # this repo, marketplace root
├── .claude-plugin/marketplace.json    # jordanbrierley marketplace entry
├── instagram-studio/                  # the plugin
│   ├── .claude-plugin/plugin.json
│   ├── engine/
│   │   ├── package.json               # deps: @vercel/blob only
│   │   ├── ig.mjs                     # CLI entry: due | publish | token | validate
│   │   ├── lib/graph.mjs              # Graph API calls (container, status poll, publish, permalink, token)
│   │   ├── lib/blob.mjs               # upload/delete on Vercel Blob
│   │   ├── lib/queue.mjs              # find post.json files, order, due-count math, write-back
│   │   ├── lib/validate.mjs           # post.json + media checks
│   │   └── tests/                     # node:test, fake Graph API + fake blob
│   ├── commands/ig-setup.md, ig-post.md, ig-queue.md
│   ├── skills/ig-setup/SKILL.md, ig-post/SKILL.md, ig-queue/SKILL.md
│   └── scripts/bootstrap.mjs          # npm install into plugin data dir on first run (as video-studio)
├── docs/superpowers/{specs,plans}/
└── README.md
```

## Contract in the user's repo

```
instagram/
├── config.json
└── log.jsonl            # append-only run log, gitignored
```

`config.json`:
```json
{
  "root": "content",
  "slots": ["08:30", "12:30", "17:30"],
  "timezone": "Europe/London",
  "maxLateMinutes": null
}
```
- `root`: directory searched recursively for `post.json` files.
- `slots`: local times, one publish per slot per day.
- `maxLateMinutes`: if set, a slot whose time passed more than this many minutes ago is skipped for
  today rather than published late. `null` = always catch up.

Any folder under `root` containing `post.json` is a post:
```json
{
  "media": ["asset.mp4"],
  "caption": "…",
  "scheduledFor": null,
  "status": "ready",
  "postedAt": null,
  "url": null,
  "error": null
}
```
- `media`: paths relative to the post folder. Exactly one `.mp4` = reel; one image = photo;
  2 to 10 images = carousel. Mixed or other combinations fail validation.
- `scheduledFor`: optional ISO datetime with offset. A pinned post is published at the first run at or
  after that time and takes precedence over oldest-ready ordering.
- `status`: `ready` | `posted` | `skipped` | `failed`. Only `ready` posts are candidates.
- `postedAt`, `url`, `error`: written by the CLI.

Ordering among `ready` posts: pinned-and-due first (earliest `scheduledFor`), then unpinned by folder
path ascending (Cyted's `YYYY-MM-DD/post-N-…` layout makes that chronological).

Secrets live in `~/.config/instagram-studio/env` (mode 600), never in the repo:
`IG_APP_ID`, `IG_APP_SECRET`, `IG_USER_ID`, `IG_ACCESS_TOKEN`, `IG_TOKEN_EXPIRES_AT`,
`BLOB_READ_WRITE_TOKEN`.

## CLI: `ig.mjs`

Runs with `node`, resolves the repo by walking up from cwd to the nearest `instagram/config.json`.
The launchd job passes the repo path explicitly (`--repo`).

### `ig due`
Prints, without side effects: slots passed today, posts published today (from `log.jsonl`), the
resulting due count, and the ordered candidates that would publish. Exit 0.

Due-count math: `due = min(slotsPassedToday - publishedToday, readyCount)`, where a slot counts as
passed if its time is at or before now (and, if `maxLateMinutes` is set, not more than that many
minutes before now). Pinned posts whose `scheduledFor` is at or before now are always due, in
addition to the slot count.

This is what makes sleep safe: launchd fires missed calendar jobs on wake, and even if it fires once
for three missed slots, one run publishes three posts. Runs are idempotent because published-today is
read from the log, not from launchd.

### `ig publish [--now <post-dir>] [--dry-run]`
1. Refresh the token if `IG_TOKEN_EXPIRES_AT` is within 10 days: `GET graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=…` (long-lived to long-lived, only valid once the token is at least 24 h old); write the new token + expiry back to the env file.
2. Compute candidates (`--now` bypasses the slot math for that one folder).
3. For each candidate, sequentially:
   1. Validate (see `ig validate`). Invalid → `status: failed`, `error`, continue.
   2. Upload each media file to Vercel Blob under `instagram-studio/<post-dir-basename>/<file>` (public, random suffix).
   3. Create containers:
      - reel: `POST /{IG_USER_ID}/media` `media_type=REELS, video_url, caption, share_to_feed=true`
      - photo: `media_type=IMAGE, image_url, caption`
      - carousel: one `IMAGE` child container per slide with `is_carousel_item=true`, then a parent `media_type=CAROUSEL, children=[…], caption`
   4. Poll `GET /{container_id}?fields=status_code,status` every 5 s until `FINISHED`; `ERROR`/`EXPIRED` or 10 min elapsed → `failed`.
   5. `POST /{IG_USER_ID}/media_publish?creation_id=…` → media id → `GET /{media_id}?fields=permalink`.
   6. Write `status: posted`, `postedAt`, `url` to `post.json`. Delete the blobs.
   7. Append a line to `log.jsonl`: `{ts, postDir, kind, result, mediaId?, url?, error?}`.
   8. If more posts follow in the same run, wait 60 s between publishes so a catch-up burst doesn't land as one block.
4. Exit non-zero only if the run itself could not start (no config, no token). Per-post failures are
   recorded, not fatal, so one bad file never blocks the queue.

Blob cleanup on failure: delete whatever was uploaded, best effort.

### `ig validate [<post-dir>]`
Checks every `ready` post (or one): `post.json` parses and matches the contract; media files exist;
media combination is one of reel/photo/carousel; caption ≤ 2,200 chars and ≤ 30 hashtags; mp4 is
≤ 1 GB, ≤ 15 min, and (via `ffprobe` if present, else skipped with a warning) 9:16 within tolerance
with an H.264/AAC stream; images are JPEG or PNG ≤ 8 MB. Prints a table; exit 1 if any invalid.

### `ig token status|exchange|refresh`
`status` shows expiry. `exchange <short-lived-token>` performs the one-time short-lived to long-lived
exchange (`GET graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=…`) used by
`/ig-setup`. `refresh` forces the long-lived refresh described under `ig publish`.

## Skills and commands

- `/ig-setup` (skill `ig-setup`): guided one-time setup. Steps the user through creating a Meta app
  with the "Instagram API with Instagram Login" product, adding themselves as an Instagram Tester,
  and completing the Business Login flow in the browser. The user pastes the resulting short-lived
  token; the skill runs `ig token exchange <token>` to get the 60-day token, writes the env file, asks for the
  Vercel Blob token, writes `instagram/config.json` with the user's slots, installs
  `~/Library/LaunchAgents/com.jordanbrierley.instagram-studio.plist` (`StartCalendarInterval` for each
  slot, `RunAtLoad true`, `StartInterval 1800`, `StandardOutPath`/`StandardErrorPath` under
  `~/Library/Logs/instagram-studio/`), loads it, and runs `ig due` as the smoke test.
  The skill never types secrets itself: Meta app creation and the OAuth consent are done by the user
  in their browser, and tokens are pasted by the user.
- `/ig-post` (skill `ig-post`): runs `ig due`, shows the candidates, and only after an explicit yes
  runs `ig publish` (or `ig publish --now <dir>` for a chosen post). Reports the permalink(s).
- `/ig-queue` (skill `ig-queue`): runs `ig validate` and prints the queue with projected slot times,
  so a user can see "these 13 reels drain by 2026-09-03".

Headless form: `/instagram-studio:ig-post` etc., as with video-studio.

## Cyted integration

- `cyted-content-daily` writes `post.json` next to `caption.txt`/`meta.json` for every generated post:
  `media` from `meta.json.assets` (reveal posts prefer `asset.mp4`; carousel posts list the `-45.png`
  slides in order), `caption` from `caption.txt`, `status: ready`.
- One-off back-fill script (`scripts/backfill-post-json.mjs` in the Cyted repo, run once, not kept):
  creates `post.json` for the 30 existing `ready` folders and marks the 4 already-posted ones
  `posted` with their URLs from `QUEUE.md`.
- `QUEUE.md` stays as the human-readable index; `ig publish` does not edit it. The daily skill
  regenerates the status column from `post.json` on its next run (a small change to its ledger step).

## Testing

- Engine unit tests (`node --test`): due-count math across scenarios (normal slot, wake after one
  missed slot, wake after three, `maxLateMinutes` skipping, pinned post, already-published-today from
  log); ordering; container-kind detection from `media`; publish loop against a fake Graph API that
  walks `IN_PROGRESS → FINISHED` and one that returns `ERROR`; blob cleanup on failure; `post.json`
  write-back; validation rules.
- One integration test behind `IG_INTEGRATION=1` that publishes a fixture photo to the real account
  and then archives it via the API, so the token/host/publish path is proven end to end.
- Manual acceptance: `/ig-setup` on Jordan's Mac, then let the launchd job post the Manchester
  photographer reel at the next slot with the laptop closed until after the slot time.

## Risks

- Token expiry while the Mac is away for > 60 days: the plist keeps running and every run logs
  `token expired`; `/ig-setup` re-auth is the fix. Acceptable.
- Meta app in Development mode can only post to accounts with a tester role. That is exactly this
  use; publishing for other users would need App Review (out of scope).
- Rate limit is 25 posts per 24 h per account; three slots a day is well inside it. `ig due` caps
  catch-up bursts at the slot count so a stale queue cannot exceed it.

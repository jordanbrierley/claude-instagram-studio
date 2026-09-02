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

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

---
description: One-time setup for unattended Instagram posting: Meta app, access token, queue config and the scheduled job
---

Invoke the instagram-studio:ig-setup skill and work through it stage by stage.

If `instagram/config.json` already exists in this repo and
`node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" token status` reports a live token, setup is already done:
say so, show `node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" due`, and ask whether the user wants to
change slots, re-authorise the token, or reinstall the scheduled job, rather than starting again.

$ARGUMENTS may name the posts directory or the daily slots. Carry it into the config stage.

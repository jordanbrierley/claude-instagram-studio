---
description: Show what is due on Instagram and publish it after an explicit yes
---

Invoke the instagram-studio:ig-post skill.

If `${CLAUDE_PLUGIN_DATA}/engine/ig.mjs` is missing, the plugin is still bootstrapping: tell the user
to run /reload-plugins or restart Claude Code, and stop. If the repo has no `instagram/config.json`,
invoke the instagram-studio:ig-setup skill instead.

$ARGUMENTS may name one post folder to publish now, in which case use `publish --now <folder>` after
confirming with the user.

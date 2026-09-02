---
description: Validate the Instagram queue and project when each post goes out
---

Invoke the instagram-studio:ig-queue skill.

If `${CLAUDE_PLUGIN_DATA}/engine/ig.mjs` is missing, tell the user to run /reload-plugins or restart
Claude Code, and stop. If the repo has no `instagram/config.json`, invoke the
instagram-studio:ig-setup skill instead.

$ARGUMENTS may narrow the listing to one folder or one date.

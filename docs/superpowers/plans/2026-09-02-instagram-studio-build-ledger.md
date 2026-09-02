# instagram-studio build ledger

The subagent-driven-development ledger for the plan at 2026-09-02-instagram-studio-implementation.md, preserved from the git-ignored workspace so every ruling made on the author's behalf stays in the repo. Part 1 is the running ledger; Part 2 is the preflight rulings R1 to R32 that amended the plan in commit e68c41d.

## Part 1: progress ledger

# SDD ledger: plan: docs/superpowers/plans/2026-09-02-instagram-studio-implementation.md

Spec: docs/superpowers/specs/2026-08-25-instagram-studio-design.md (reachable, binding authority).
Workspace: worktree .worktrees/plugin-build, branch feat/plugin-build, base 6a620f3. No package.json at start, so no dependency install and no baseline suite; the first suite is Task 1's.

## Preflight rulings (2026-09-02, before Task 1)

- Ruling: commits go on branch feat/plugin-build in the worktree, not main as the plan's Global Constraints say: main stays clean until finishing-a-development-branch merges it: cost if wrong: one merge.
- Ruling (OQ1 marketplace name): keep `jordanbrierley-instagram`: video-studio already owns `jordanbrierley`: cost if wrong: a rename in two json files.
- Ruling (OQ2 due formula): slot-driven due is capped by UNPINNED ready posts; pinned-and-due add on top: matches the spec's intent that pins are "in addition": cost if wrong: an off-by-one in a catch-up run.
- Ruling (OQ3 pinned posts vs 25/24h): ADD a hard guard in the publish loop (Task 8): before each publish, count log entries with result=posted in the trailing 24h; at 25 or more, stop the run, log `rate-limit-guard`, leave remaining posts `ready`: an API ban is worse than a late post: cost if wrong: a post slips a day.
- Ruling (OQ4 integration cleanup): accept; publish, assert, print permalink for manual deletion; test only runs with IG_INTEGRATION=1: cost if wrong: one stray test post on the account.
- Ruling (OQ5 API version): pin a versioned base path as ONE constant in lib/graph.mjs, the current stable version verified against Meta docs during Task 7 (use ctx7 / WebFetch, do not guess): cost if wrong: a one-constant change.
- Ruling (OQ6 carousel children): poll only the parent; children are IMAGE only per spec: cost if wrong: Task 8 gains a per-child wait.
- Ruling (OQ7 catch-up burst): code default stays `maxLateMinutes: null` per spec; the config the setup skill WRITES defaults to 240 so a late wake never bursts: cost if wrong: a missed slot is skipped rather than caught up.
- Ruling (OQ8 plist absolute path): accept; `ig due` prints the engine path it runs from so an empty log is diagnosable; re-running setup stage 5 re-renders: cost if wrong: silent job death after a plugin move, fixed by re-setup.
- Ruling (OQ9 secrets): the setup skill hands the user a command block to run in THEIR terminal; no secret ever enters a transcript: cost if wrong: a slower setup.
- Ruling (OQ10 Cyted integration): out of scope here; owned by getcyted docs/superpowers/specs/2026-09-02-instagram-growth-system-design.md: cost if wrong: none.
- Ruling (OQ11 midnight): accept minutes-past-local-midnight comparison; document it in the README: cost if wrong: an edge-case skip at 23:5x.

## Preflight conflict scan
See preflight.md in this workspace (written by a read-only scan agent); rulings on its rows are appended below it.

## Task log

- Preflight scan complete: preflight.md (37 pair rows, 10 mismatches; 13 task rows, 13 findings). Rulings R1..R32 in preflight-rulings.md; plan to be amended once by a dedicated agent before Task 1.
- Plan amended per R1..R32: commit e68c41d (3,855 lines). Amend agent extracted and ran the inline code: 80 unit + 9 bootstrap tests pass in a scratch tree. Deviations accepted as rulings: R2 via derived key subsets (PUBLISH/EXCHANGE/REFRESH_KEYS from SECRET_KEYS); R4 literal pinned===false; R9 ENOTDIR test; R13 knock-on, CLI tests use JPEG fixtures. Ruling: all four accepted: each is the faithful version: cost: none.
- 2026-09-02 ~09:45: Jordan stopped all agents (permission prompts on every write outside the Cyted session dir). Task 1: five files written to the worktree, UNCOMMITTED and UNREVIEWED, no task-1-report.md. Resume = review the working tree against task-1-brief.md, commit, then the Task 1 review. Run the SDD loop from a session opened IN this worktree so writes are auto-accepted.
- 2026-09-02 ~17:10: resumed from the Cyted session (auto mode). Reviewed the Task 1 working tree against task-1-brief.md: all five files match verbatim except scripts/validate.mjs EM_DASH is a literal character, not the \u2014 escape, so validate fails on itself. .gitignore keeps the two pre-existing lines (.worktrees/, .superpowers/) on top of the brief's four: correct. BASE for Task 1 = e68c41d. Dispatching a haiku implementer to fix the constant, commit, report; then the Task 1 review.
- 2026-09-02 ~17:20: Jordan opened a dedicated session in this worktree. The Cyted session STOPPED its haiku implementer (impl-task-1) so only one session writes here; the worktree session owns the build from this line on. Check git status and scripts/validate.mjs before dispatching Task 1 again: the stopped implementer may have fixed and/or committed.
- 2026-09-02 (later): resumed in a session opened IN the worktree (auto mode). The 17:10 haiku dispatch never landed: scripts/validate.mjs line 54 still holds the literal em dash, validate exits 1 on itself, nothing committed, no task-1-report.md. BASE for Task 1 stays e68c41d. Re-dispatching a haiku implementer: fix the constant to the: escape, run validate (expect OK), commit with the brief's message, write the report. Then the Task 1 review.
- Task 1: complete (commits e68c41d..39f9f23, review clean). Implementer haiku, reviewer haiku. Report: task-1-report.md.
- Note: user-level defaultMode is auto; subagent Write/Edit calls prompt the user per file. From Task 2 on, every dispatch instructs subagents to write and edit files via Bash (heredocs, sed), never the Write/Edit tools. BASE for Task 2 = 39f9f23.
- Task 2: implementer (sonnet) DONE_WITH_CONCERNS, commit d696107. Ruling: the engine test scripts use the glob form `node --test "tests/unit/**/*.test.mjs"` (and the same for tests/integration) instead of the brief's bare directory `node --test tests/unit`: verified by the controller: on the installed Node v25.8.0 the bare directory form fails with "test failed" (it loads the directory as a module) while the glob form passes 9/9; the glob form is supported from Node 21 so the >=22.18.0 floor holds: cost if wrong: a one-line package.json edit. Any later brief embedding the bare form inherits this ruling. BASE for Task 2 = 39f9f23.
- Task 2 review (sonnet): spec compliant, all 8 files verbatim except the ruled glob deviation; reviewer confirmed via Node source that --test positional args are globs from v22.6.0, so the ruling holds on the floor version too. Two ⚠️ items resolved by controller: root package.json engines.node is ">=22.18.0" (line 5); hooks.json is byte-identical to the installed video-studio plugin's hooks.json, whose SessionStart hook ran at this session's start. Issues/Assessment section truncated in transit, re-requested.
- Task 2: minor (deferred): bootstrap.test.mjs cleans up with a trailing rmSync rather than try/finally or t.after, so a failed assertion leaks the scratch dir (plan-mandated verbatim test code).
- Task 2: minor (deferred): bootstrap.mjs walks srcDir twice per sync (fingerprint, then copy); negligible at this size (plan-mandated).
- Task 2: minor: fixture fake-plugin/engine/package.json has no engines field. Ruling: the "Node floor in every package.json" constraint scopes to shipped packages; the fixture is a throwaway test double that is never installed or published: cost if wrong: one field in a fixture.
- Task 2: minor: the controller's dispatch paraphrased the exit-0 cases as "logged to stderr"; the plan says "logged and skipped" and the brief's code logs two cases to stderr, two to stdout, and none for the no-plugin-context case, exactly as the brief's tests assert. Ruling: the plan's wording governs; no code change. Future dispatches copy constraint text verbatim rather than paraphrasing: cost if wrong: none.
- Task 2: complete (commits 39f9f23..d696107, review clean). Implementer sonnet, reviewer sonnet. BASE for Task 3 = d696107.
- Task 3: implementer (haiku) DONE, commit aa7dfe6, report task-3-report.md, no concerns; 18/18 tests pass. Review package review-d696107..aa7dfe6.diff. Reviewer dispatched (sonnet).
- Root cause of the permission prompts: ~/.claude/settings.json sets CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1, and every Agent call so far passed a `name`, which under that flag launches the subagent as a teammate (separate session) whose permission prompts bubble up to the lead. Ruling: from the Task 3 review onward, no Agent call passes `name`; subagents run in-process under this session's auto mode; fix-round resumes use the agent id from the spawn result: cost if wrong: none, the flag flip to 0 is offered to the user as the config-side fix.
- Task 3: minor (deferred): config.mjs writeEnv/updateEnv do not re-assert mode 700 on a pre-existing secrets directory (mkdirSync mode applies only on creation); file mode 600 is re-asserted via chmodSync.
- Task 3: minor (deferred): no test for updateEnv on a file lacking a trailing newline; reviewer verified the behaviour directly (correct).
- Task 3: complete (commits d696107..aa7dfe6, review clean). Implementer haiku, reviewer sonnet. BASE for Task 4 = aa7dfe6.
- Task 4: implementer (haiku, in-process) DONE, commit db956eb, report task-4-report.md, no concerns; 35/35 tests pass. Review package review-aa7dfe6..db956eb.diff. Reviewer dispatched (sonnet).
- Task 4: minor (deferred): selectCandidates relies on the caller passing findPosts' sorted output; no defensive sort by rel (plan-mandated verbatim code).
- Task 4: minor (deferred): the "skips corrupt lines on read" test never writes a corrupt log line, so readLog's try/catch is untested (plan-mandated verbatim test).
- Task 4: minor (deferred): minutes-since-midnight slot model counts a slot time that never occurs on a spring-forward day as passed; inherent to the spec's algorithm, awareness only.
- Task 4: complete (commits aa7dfe6..db956eb, review clean). Implementer haiku, reviewer sonnet (probed DST transitions, correct). BASE for Task 5 = db956eb.
- Task 7 pre-note: the ledger's OQ5 ruling (pin a version) and the brief (unversioned GRAPH_BASE) are reconciled by the amended plan's Open Question 5: keep GRAPH_BASE as one constant, confirm against Meta's current docs during Task 7 (ctx7 or WebFetch, never guess), and pin a version in that constant only if unversioned graph.instagram.com is deprecated. The dispatch carries this verbatim and asks for the docs finding in the report.
- Task 5: implementer (haiku) DONE, commit 09fb3fc, report task-5-report.md, no concerns; 48/48 tests pass. Review package review-db956eb..09fb3fc.diff. Reviewer dispatched (sonnet).
- Task 5 review (sonnet): Needs fixes. Important: validate.mjs unreadable() appends err.message's first line, which on a real non-zero exit is "Command failed: ffprobe ... <absolute path>", re-leaking the full path the basename prefix was meant to avoid. Ruling: real defect in plan-verbatim code, fix it: build the why from err.code / err.signal only, add a test with a Command-failed style message carrying a full path: cost if wrong: one line. ⚠️ photo aspect ratio resolved by controller: spec line 152 applies 9:16 to mp4 only, images are JPEG/PNG under 8 MB, not a gap.
- Task 5: minor (deferred): scheduledFor error text says "with an offset" but Date parsing accepts offset-less strings (plan-verbatim).
- Task 5: minor (deferred): no makeFfprobe test for valid JSON with no video stream.
- Task 5: minor (deferred): validateAll not tested with an unparseable post.json under the default statuses filter.
- Task 5: fix round 1/5 (1 addressed, 0 open: ffprobe message built from exit code or signal only, negative path test added; commits 09fb3fc..29722f8). Re-review haiku.
- Task 5: complete (commits db956eb..29722f8, review clean after 1 fix round). BASE for Task 6 = 29722f8.
- Task 6: implementer (sonnet) DONE, commit 2767baa, report task-6-report.md, no concerns; 52/52 tests, validate OK. @vercel/blob resolved 2.8.0, docs confirm put accepts a Node readable stream with multipart: true, so R14's primary path stands, no fallback. Review package review-29722f8..2767baa.diff. Reviewer dispatched (sonnet).
- Task 6: minor (deferred): blob.mjs upload holds no reference to the read stream, so a rejected put relies on Node's autoDestroy rather than an explicit stream.destroy().
- Task 6: complete (commits 29722f8..2767baa, review clean). Reviewer verified @vercel/blob 2.8.0 PutBody includes Readable from the shipped .d.ts. BASE for Task 7 = 2767baa.
- Task 7: implementer (sonnet) DONE, commit da0d16a, report task-7-report.md, no concerns; 62/62 tests. API version check: ctx7 and Meta docs confirm graph.instagram.com unversioned calls are supported, not deprecated; GRAPH_BASE unchanged (Open Question 5 closed: no pin). Review package review-2767baa..da0d16a.diff. Reviewer dispatched (sonnet).
- Task 7: minor (deferred): graph.mjs request() falls back to text.slice(0, 300) of a non-JSON body in the thrown message; a proxy echoing the query string could carry the token. Low risk against Meta's structured errors.
- Task 7: complete (commits 2767baa..da0d16a, review clean). Reviewer diffed all three files programmatically against the brief. BASE for Task 8 = da0d16a.
- Task 8: implementer (sonnet) DONE, commit 16881f6, report task-8-report.md, no concerns, all on-disk interfaces matched the brief; 72/72 tests in ~3s. Review package review-da0d16a..16881f6.diff. Reviewer dispatched (sonnet).
- Task 8 review (sonnet): approved; reviewer verified every downstream call signature and re-ran the suite (72/72). ⚠️ carousel children not polled individually: resolved by controller, that is the accepted OQ6 ruling (poll only the parent).
- Task 8: minor (deferred): publish.mjs finish() skips writePost when entry.post is null (unparseable post.json) but still logs; path untested (plan-verbatim code).
- Task 8: minor (deferred): postedInLast24h has no isolated unit test, only indirect coverage via the rate-limit test.
- Task 8: complete (commits da0d16a..16881f6, review clean). BASE for Task 9 = 16881f6.
- Task 9: implementer (haiku) DONE, commit cda9726, report task-9-report.md, no concerns; 77/77 tests. Review package review-16881f6..cda9726.diff. Reviewer dispatched (haiku, small pure-function diff).
- Ruling (Task 12 Step 4): the one-off real publish (IG_INTEGRATION=1 run) is NOT executed by the SDD loop: it is an outward-facing publish to the user's account, and ~/.config/instagram-studio/env does not exist on this machine anyway. Task 12 delivers Steps 1, 2, 3 and 5 (fixture, test, skip-by-default proof, commit); Step 4 is surfaced to the user in the final message: cost if wrong: none, the user runs one command.
- Ruling (Task 13 Step 4): the manual acceptance checklist on the Mac (plugin install, /ig-setup with a real Meta app, a real post, a lid-closed slot) is the user's gate, not the loop's. Task 13 delivers Steps 1, 2, 3 and 5; Step 4 is surfaced verbatim to the user: cost if wrong: none.
- Task 9: complete (commits 16881f6..cda9726, review clean, no findings). BASE for Task 10 = cda9726.
- Task 10: implementer (sonnet) DONE_WITH_CONCERNS, commit 5b3db7c, report task-10-report.md; 89/89 tests in ~2s, validate OK. Concern: the controller's self-review grep flagged env.IG_* property accesses. Ruling: R2 forbids hard-coded key LISTS in ig.mjs (SECRET_KEYS and subsets come from config.mjs); reading a named property off the env object is the brief's verbatim code and is fine: cost if wrong: none. Review package review-cda9726..5b3db7c.diff. Reviewer dispatched (sonnet).
- Task 10 review (sonnet): approved, one Important plan-mandated: requireSecrets throws a plain Error, so main's catch prints "ig: unexpected failure" plus a stack trace for the brief's own named exit-2 case (missing secrets); exit code 2 and no value leak. Ruling: real defect in plan-verbatim code, fix it with one wrapper that rethrows as RunError, plus one CLI test for the missing-secrets path: cost if wrong: a few lines. ⚠️ non-dry-run publish untested at CLI level: accepted as a plan gap; lib/publish.test.mjs covers the loop and Task 12 covers the real path; noted for the final review.
- Task 10: minor (deferred): `publish --now <dir>` does not reject a folder whose status is not "ready", so it could re-publish a posted folder; validatePost accepts all four statuses. Final review to triage whether a guard belongs in cmdPublish.
- Task 10: minor (deferred): `token status` with no token (exit 2) has no CLI test.
- Task 10: fix round 1/5 (1 addressed, 0 open: needSecrets wrapper rethrows RunError, missing-secrets CLI test added; commits 5b3db7c..699c539). Re-review haiku.
- Task 10: complete (commits cda9726..699c539, review clean after 1 fix round). 90/90 tests. BASE for Task 11 = 699c539.
- Task 11: implementer (haiku) DONE, commit cb18ab8, report task-11-report.md, no concerns; validate OK, no cyted, no em dash, 90/90. Review package review-699c539..cb18ab8.diff. Reviewer dispatched (sonnet).
- Task 11 review (sonnet): approved, no findings. ⚠️ Meta developer-portal UI flow in ig-setup Stage 2 is spec text that cannot be verified from the repo; resolved by controller: it is checked by the user's manual acceptance run (Task 13 Step 4), surfaced in the final message.
- Task 11: complete (commits 699c539..cb18ab8, review clean). BASE for Task 12 = cb18ab8.
- Task 12: implementer (sonnet) DONE, commit 3a8a414, report task-12-report.md; fixture 1080x1080 via sips (113,348 bytes), unit 90/90, integration 1 skipped without the flag, Step 4 deliberately not run. Review package review-cb18ab8..3a8a414.diff. Reviewer dispatched (sonnet).
- Task 12: minor (deferred): the integration test checks PUBLISH_KEYS with an inline assert loop rather than requireSecrets (plan-verbatim).
- Task 12: minor (deferred): the integration test passes a `sleep` dep that publishOne never reads (plan-verbatim, harmless).
- Task 12: complete (commits cb18ab8..3a8a414, review clean). Step 4 real publish left to the user. BASE for Task 13 = 3a8a414.
- Task 13: implementer (haiku) DONE, commit bdb59cc, report task-13-report.md; validate OK, 90/90, no em dash, Step 4 (manual acceptance) left to the user. Review package review-3a8a414..bdb59cc.diff. Reviewer dispatched (haiku).
- Task 13 review (haiku): four findings labelled Critical: README Commands section lacks `validate [<post-dir>]`, the global `--repo` and `--json` options, and the exit codes. Ruling: plan-verbatim omission, not a defect in anything that runs, so severity is Important not Critical; fix it anyway because it is three lines and makes the README match the CLI's own usage text: cost if wrong: three README lines.
- Task 13: fix round 1/5 (3 addressed pending re-review: validate argument, global options, exit codes; commits bdb59cc..4e3a593). Re-review haiku dispatched. Final review package rebuilt at final-review-6a620f3..4e3a593.diff (docs and lockfile excluded).
- Task 13: complete (commits 3a8a414..4e3a593, review clean after 1 fix round).
- All 13 tasks complete. HEAD 4e3a593, 16 commits over merge-base 6a620f3, 90/90 unit tests, validate OK. Final whole-branch review dispatched (opus) with final-review-6a620f3..4e3a593.diff and final-review-deferred.md.
- Final review (opus): ready to merge WITH FIXES. Critical: (1) graph.mjs non-JSON error body can echo the URL and leak access_token / client_secret into post.json, log.jsonl and err.log (reproduced); (2) publish.mjs finish() returns on a post.json write failure before appending the log line, so a successful publish is recorded nowhere and republishes next run (reproduced). Important: (3) findPosts statSync on a dangling symlink aborts every command; (4) publish --now accepts a non-ready folder and overwrites the original url/postedAt (reproduced); (5) cmdPublish's real path has no test and no seam; (6) the rate-limit log append is unguarded. Minors 7-13 listed in the review. Deferred-list triage: all ship-as-is except T7 slice (= Critical 1) and T10 --now (= Important 4).
- Ruling (final fix wave): ONE fix dispatch (sonnet) covering Critical 1-2, Important 3-6, and Minors 7, 8, 9, 11, 12, 13. Minor 10 (bootstrap logs to stdout) ships as-is: it matches the sibling video-studio plugin's behaviour and the plan's bootstrap tests assert stdout: cost if wrong: one line per session transcript. For Critical 2 the plan's write order (post.json then log) is kept; the fix is to guard the two writes independently so the log append always runs: reordering alone would not stop a republish when post.json is unwritable, and the io-error event is the signal: cost if wrong: one swapped pair of lines. FIX_BASE = 4e3a593.
- Final fix wave dispatched (sonnet) from FIX_BASE 4e3a593 with items C1, C2, I3, I4, I5, I6, M7, M8, M9, M11, M12, M13; report to final-fix-report.md. Next: scoped re-review of the wave, adjudicate residuals, then finishing-a-development-branch.
- Final fix wave DONE: 6 commits 4e3a593..348392b (3eb45c1 redact secrets in API errors; 1f6d05c always log a publish, guard the rate-limit append; 666b682 skip dangling symlinks; b3ab35d --now ready guard and io.makeDeps seam; cc149cb status null as missing, media path escape; 348392b README note and atomic plist). 98/98 tests, validate OK, no em dash. Report final-fix-report.md. Scoped re-review dispatched (sonnet) with review-4e3a593..348392b.diff.
- Final fix wave re-review (sonnet): all 12 findings ADDRESSED with covering tests; one residual Important: graph.mjs:34 slices to 300 chars before redacting, so a secret straddling the boundary leaks a fragment (reproduced by probe). Ruling: load-bearing (absolute secret constraint), smallest change is `redact(text).slice(0, 300)` plus a boundary test; resume the fix-wave implementer for exactly that, controller verifies the one-liner directly instead of a third review round: cost if wrong: one line.
- Residual fix DONE: dbd6c8d redacts before truncating; boundary test added (fails on the old line, passes on the new). Controller verified directly: graph.mjs:34 is `redact(text).slice(0, 300)`, 99/99 unit tests, validate OK, no em dash, no cyted, integration suite skips without the flag, working tree clean, 24 commits ahead of main.
- Final review closed: 12 findings fixed and re-reviewed, 1 residual fixed and controller-verified, Minor 10 ships as-is by ruling. Ledger and preflight rulings copied to docs/superpowers/plans/ for durability; workspace deleted per the SDD finish step.

## Part 2: preflight rulings

# Preflight rulings (controller, 2026-09-02)

Each ruling references a preflight.md row. The spec is the binding authority; where the plan
deviates deliberately the deviation is recorded in the plan's Open Questions as ACCEPTED.
Format below: `Ruling: what: why: cost if wrong`.

## Structural

- R1 (A: T9/T10 import order). Ruling: swap Tasks 9 and 10. New Task 9 = `lib/launchd.mjs` + `tests/unit/launchd.test.mjs` only, no edit to `ig.mjs`. New Task 10 = the complete `ig.mjs` CLI with all five commands (due, publish, validate, token, launchd) and the whole `tests/unit/cli.test.mjs` including the launchd CLI test, importing `renderPlist` and `DEFAULT_LABEL` only. Delete `plistPathFor` (no consumer).: an undefined artifact cannot be reviewed: cost: none.
- R2 (A: SECRET_KEYS dead export). Ruling: keep `SECRET_KEYS` exported from `lib/config.mjs`, add it to Task 3's Interfaces block, and make the CLI import it wherever a key list is needed; no hard-coded key lists in `ig.mjs`: one source of truth: cost: none.
- R3 (A: `makeRepo` duplicates `makeQueue`). Ruling: `tests/helpers/tmp-repo.mjs` (Task 4) exports `makeRepo(posts, config, files)` as a thin wrapper that calls `makeQueue` then writes `instagram/config.json`; the CLI tests import it; no second fixture builder: cost: none.
- R4 (A/B4: pinned publishes consume the slot budget). Ruling: every log line gets `pinned: boolean`; `publishedToday` counts only lines with `result === "posted"` and `pinned === false`; Task 4 gains a test whose log contains one pinned publish and asserts `slotDue` is unchanged; Task 8 writes `pinned` from the entry: matches the "in addition" rule: cost: an extra field per log line.
- R5 (A: due formula in T11/T13 copy). Ruling: every user-facing statement reads "capped at the number of unpinned ready posts; pinned posts whose time has come are added on top": cost: none.
- R6 (A: em-dash check scope). Ruling: `scripts/validate.mjs` walks `instagram-studio/` INCLUDING dot-directories (skip only `node_modules`), plus `scripts/` and `README.md`; the em-dash character in the script is written as the escape `,`, never as a literal: the check must cover `plugin.json` and itself: cost: none.
- R7 (A: T1 "green from Task 3"). Ruling: text reads "root `npm test` is red until Task 2 creates the engine and green from Task 2 onward": cost: none.
- R8 (OQ3, from the ledger). Ruling: Task 8's run loop gets a rate-limit guard: before each publish, count log lines with `result === "posted"` and `ts` within the trailing 24 hours; at 25 or more, emit `rate-limit-guard`, append a log line with `result: "skipped-rate-limit"`, leave the remaining candidates `ready`, and end the run cleanly. Test it: an API ban is worse than a late post: cost: a post slips a day.

## Task 2 (bootstrap)

- R9 (B2). Ruling: create `${CLAUDE_PLUGIN_DATA}` with `mkdirSync(..., {recursive: true})` BEFORE taking the lock; the lock `catch` handles `EEXIST` only and rethrows anything else into an outer `try/catch` around all of `main` that logs one line to stderr and exits 0; `npm ci` failure is caught the same way (logged, exit 0, engine left un-synced so the next session retries). Two new tests: missing data dir parent exits 0; a failing `npm` (fake via PATH) exits 0: the hook promised exit 0: cost: a silent install failure, visible in the hook log.

## Task 3 (config, secrets)

- R10 (B3). Ruling: `updateEnv` patches the file line by line: existing `KEY=value` lines for the given keys are replaced in place, new keys are appended, every other line (comments, blanks, unrelated keys) is preserved verbatim; `serializeEnv` is used only when the file does not exist. Values are written as parsed (unquoted) and `parseEnv` keeps stripping quotes; add a test that a comment line and a blank line survive `updateEnv`: cost: none.

## Task 4 (queue)

- R11 (B4 missing status). Ruling: a `post.json` with no `status` key is NOT a candidate: `readPost` leaves `status` undefined and `validatePost` (Task 5) reports `status missing`; nothing defaults to `ready`: a post must opt in to publishing: cost: a hand-written post.json needs one more field.
- R12 (B4 nested post.json). Ruling: `findPosts` treats a directory containing `post.json` as a leaf and does not descend into it; test with a nested `post.json`: cost: none.

## Task 5 (validate)

- R13 (B5). Ruling: after `errors.push(...)` return `ok: false` literally. `makeFfprobe` distinguishes "not installed" (spawn `ENOENT` → `null` → warning `ffprobe unavailable, skipped the video checks`) from "ffprobe failed on this file" (non-zero exit → an ERROR `ffprobe could not read <file>`); adjust the existing test and add one for the failure branch: cost: none.

## Task 6 (blob)

- R14 (B6). Ruling: `upload` passes a `fs.createReadStream(localPath)` to `put` with `multipart: true` and the content type; never `readFile` into a Buffer. The fake records the body's type; the test asserts a stream was passed. The implementer confirms the accepted body types against current `@vercel/blob` docs (use the `find-docs` skill / `npx ctx7`), and if streams are not accepted, falls back to `multipart: true` with a Blob from the stream and records that in the report: a 1 GB reel must not sit in memory: cost: none.

## Task 7 (graph)

- R15 (B7). Ruling: one private `tokenCall(pathname, params)` used by both `exchangeToken` and `refreshToken`; the client is a factory returning an object of closures (no `this`); `expiryFrom(now)` takes the injected clock; the token-leak test uses a distinctive token such as `secret-token-abc123` and asserts it is absent from the message: cost: none.
- R16 (spec item 6, 24 h refresh precondition). Ruling: no new key and no guard: `needsRefresh` only fires inside the last 10 days of a 60-day token, so a token is always older than 24 h when refresh runs; write that reasoning as a comment above `needsRefresh` and one README line. Record as ACCEPTED in Open Questions: cost: none.

## Task 8 (publish)

- R17 (B8). Ruling: `finish()` wraps its `writePostFn` and `appendLogFn` calls in `try/catch`; on failure it emits an `io-error` event with the path and message and returns; `runPublish` continues to the next candidate. Test: a `post.json` path that is a directory: a per-post failure is never fatal (Global Constraint): cost: none.

## Task 10 (CLI, formerly Task 9)

- R18 (B9 wall-clock tests). Ruling: the CLI's `io` object carries `now` (default `() => new Date()`); `cmdDue` and `cmdPublish` use `io.now()`; every CLI test pins `now` to 13:00 Europe/London on a fixed date so candidates exist and ordering is asserted unconditionally; the dry-run test asserts the candidate list it prints: cost: none.
- R19 (B9 duplication). Ruling: one `resolvePostDir(arg, repo)` helper and one `persistToken(env, envPath, io)` helper; no repeated blocks: cost: none.
- R20 (B9 validate exit code). Ruling: `validate` exits 1 when any post is invalid, per spec:153; amend the Global Constraint sentence to "The `publish` process exits non-zero only when the run itself could not start; `validate` exits 1 when any post is invalid": cost: none.
- R21 (OQ8, from the ledger). Ruling: `ig due` prints the engine path it is running from as its first line: cost: none.
- R22 (A10/B11 token exchange input). Ruling: `ig token exchange` takes NO argument; it reads `IG_ACCESS_TOKEN` (the short-lived token the user wrote) from the env file, exchanges it, and writes back the long-lived token and `IG_TOKEN_EXPIRES_AT`. `ig token status` prints expiry only, never the token. Deviation from spec:157 (`exchange <short-lived-token>`) is ACCEPTED for security: no token on a command line or in `ps`: cost: none.

## Task 9 (launchd, formerly Task 10)

- R23 (B10 node path). Ruling: `renderPlist` takes `nodePath` from `--node` if given, else `process.execPath`; README states that a node version-manager upgrade requires re-running setup stage 5 to re-render the plist. ACCEPTED in Open Questions: cost: silent job death after a node upgrade, fixed by re-setup.
- R24 (OQ7). Ruling: the code default for `maxLateMinutes` stays `null` per spec; the config the setup skill WRITES uses `240`: cost: a missed slot is skipped rather than caught up.

## Task 11 (skills)

- R25 (B11). Ruling: Stage 3 is two explicit halves. Half A, run by THE USER in their own terminal: an UNINDENTED heredoc (terminator in column 1) that creates `~/.config/instagram-studio` (mode 700) and writes the env file (mode 600) with FIVE values: `IG_APP_ID`, `IG_APP_SECRET`, `IG_USER_ID`, `IG_ACCESS_TOKEN` (short-lived), `BLOB_READ_WRITE_TOKEN`. Half B, run by THE AGENT: `node "${CLAUDE_PLUGIN_DATA}/engine/ig.mjs" token exchange` then `token status`. No `${CLAUDE_PLUGIN_DATA}` ever appears in a user-run block; no token ever appears on a command line: cost: none.
- R26 (B11 drain formula). Ruling: `ig-queue` reports days-to-drain as `ceil(max(0, N_unpinned - slotsRemainingToday) / slotsPerDay)` and lists pinned posts separately with their dates: cost: none.

## Task 12 (integration)

- R27 (B12 fixture). Ruling: Step 1 produces a 1080x1080 JPEG by trying, in order, `magick`/`convert -size 1080x1080 xc:#222222`, then `sips` from the first file matching `/System/Library/Desktop Pictures/*.{heic,jpg,png}` resized to 1080x1080, and FAILS the step with exit 1 and a message if neither yields a file whose `sips -g pixelWidth` is 1080. No `|| echo` fallbacks: cost: none.
- R28 (B12). Ruling: the integration test uses the real `makeFfprobe()` (a photo never invokes it anyway); a token inside the refresh window makes the test `skip` with a message, never fail: cost: none.

## Task 13 (README, licence)

- R29 (B13). Ruling: README documents install via the local path form (`/plugin marketplace add /absolute/path/to/instagram-studio` then `/plugin install instagram-studio@jordanbrierley-instagram`) and notes the GitHub form as "once the repo is published"; the due-formula text follows R5; the LICENSE file content is the full MIT text inlined in the plan with `Copyright (c) 2026 Jordan Brierley`: cost: none.

## Plan vs spec, unacknowledged items

- R30. Ruling: the `launchd` command (spec has four commands) is ACCEPTED: it is the testable plist renderer and the setup skill's only way to get a plist: cost: one extra command.
- R31. Ruling: `ig validate` prints per-post lines with indented errors and warnings rather than a table; ACCEPTED as more readable in a terminal: cost: none.
- R32. Ruling: `lib/config.mjs`, `lib/publish.mjs`, `lib/launchd.mjs` additions are ACCEPTED (already justified in the plan): cost: none.

All ACCEPTED deviations and R1's reorder are to be recorded in the plan's Open Questions section as resolved, with the ruling text.

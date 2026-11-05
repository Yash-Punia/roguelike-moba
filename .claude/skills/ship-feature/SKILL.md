---
name: ship-feature
description: Finish and ship a Warfront feature per the repo's hard rules - checks, MILESTONES mark and hash backfill, DECISIONS entry, one commit on main, push. Use whenever a feature or fix is ready to commit.
---

# Ship a feature

One feature = one commit on `main`, pushed at once (CLAUDE.md, D-045). Prefix shell commands with `rtk`.

## 1. Checks (all must pass)

```bash
rtk npm run typecheck
rtk npm run lint
npx vitest run 2>&1 | grep -E "×|FAIL|Test Files|Tests "
```

`rtk vitest run` can fail to parse and only writes `.vitest/`; use `npx vitest run` with a grep, and delete `.vitest/` if it appears. Remove any `tests/tmp-*.test.ts` probes (see the `sim-probe` skill) before committing.

If the change shows in the game, verify it in a browser first (`browser-check` skill).

## 2. MILESTONES.md (same commit)

- The feature's row: `[ ]` → `[c]`, or `[~]` with a "done so far" note if the row is only partly done. Append the D-number to the row text.
- **Backfill:** the previous feature's row still has an empty hash, or one hash less than its commits. Fill it in now (`git log --oneline -3`) and set that row to `[p]` (it was pushed). A commit can't contain its own hash.
- A follow-up commit to an already `[p]` row adds its hash to that row's list in the next commit, e.g. `| b26e4d1, 3c83e66 |`.

## 3. DECISIONS.md (same commit)

Next number: `grep -n "^## D-" DECISIONS.md | tail -1`, plus one. Check that the code comments you wrote cite the same number. Append at the end:

```markdown

## D-NNN — Short title
- Date: YYYY-MM-DD
- Source: user request (…) / M4 row N; the rest made during development
- Decision:
  - **Topic:** what was decided, with the numbers.
  - **Measured:** results (match length, test outcomes, perf), when relevant.
  - **Tests:** what the new tests pin.
- Why: one or two sentences.
- Alternatives: what was rejected, and why.
```

Say what supersedes or amends an older decision ("amends D-074").

## 4. Commit and push

```bash
rtk git add -A
rtk git commit -q -F - <<'EOF'
feat: short imperative summary

Two to four lines on what changed and why. D-NNN.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
rtk git push
git log --oneline -1
```

Use the attribution line the current session's system prompt gives. Use `fix:` for a fix to an already shipped feature. Never rewrite history unless asked.

## Gotchas

- Many files use CRLF line endings (`bot.ts`, `bots.json`, the maps). A Node script with `s.includes(old)` fails on them unless you normalise (`s.replace(/\r\n/g, '\n')`) and restore. The Edit tool handles them fine.
- Large edit scripts: write them to the scratchpad with Write and run `node <file>`. Bash heredocs with backticks and `${…}` inside break.
- Don't reformat JSON in `/data` with `JSON.stringify` (it expands inline arrays); insert text instead.

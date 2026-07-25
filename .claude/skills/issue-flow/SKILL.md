---
name: issue-flow
description: End-to-end issue automation - expand a GitHub issue into requirements, implement via the implementer subagent, review the PR yourself in rounds (all discussion as PR comments), user-approved squash merge, then close out the issue. Args - issue number, optional --auto to skip the merge gate.
---

Run the full issue → merged-PR → closed-issue loop. Usage:
`/issue-flow <issue#> [--auto]`.

Division of labor (non-negotiable): implementation and fixes are done by the
`implementer` subagent; YOU (the orchestrating agent) do all review, all
GitHub interaction, and all user communication. Review is never delegated.
All substantive discussion lives on the PR/issue as comments, so the record
survives this session.

## Phase 0 — preflight

Run `scripts/automation/check-setup.sh`. On exit 4, STOP and relay the doctor
output. Read `.automation.conf` (you'll need `REVIEW_MAX_ROUNDS`, `TEST_CMD`).

## Phase 1 — requirements

Follow the `expand-issue` skill's steps for issue N (fetch, research, post or
update the `claude:requirements` comment). If blocking Open Questions remain,
STOP and ask the user — even with `--auto`. This is the one gate `--auto`
never skips.

## Phase 2 — branch + implement

1. Type: `feat` for enhancements, `fix` for bugs (judge from the issue).
   `scripts/automation/branch.sh <type> <N> <short-slug>`.
2. `scripts/automation/set-status.sh <N> status:in-progress` then
   `gh issue edit <N> --add-assignee @me` (the script drops
   `status:requirements` in the same transition — exactly one `status:*`
   label applies at a time, so never add one with `gh issue edit`).
3. Spawn the `implementer` subagent (Agent tool, subagent_type `implementer`)
   with a prompt containing, verbatim: the full requirements comment, the
   relevant CLAUDE.md conventions, and the instruction to follow its TDD and
   conventional-commit rules. Do not paraphrase the requirements.
4. If STATUS is `blocked`, resolve what you can (answer questions, adjust
   requirements) and re-spawn; if it needs the user, stop and ask.

## Phase 3 — PR

`scripts/automation/pr-create.sh --draft --issue <N> --title "<type>(<scope>): <summary>"`
— the title must describe the WHOLE change (it becomes the squash commit).
Body: fill `scripts/automation/templates/pr-body.md`, link the requirements
comment. Record the PR number M (last stdout line).

## Phase 4 — CI loop

`scripts/automation/ci-status.sh <M> --wait`. On exit 1:
`scripts/automation/ci-logs.sh <M>`, spawn `implementer` with the failing-log
tail and the instruction to fix and commit; push (`git push`); repeat. If CI
fails 3 times on the same cause, stop and escalate to the user.

## Phase 5 — review loop (round K = 1..REVIEW_MAX_ROUNDS)

1. YOU review: read `gh pr diff <M>` plus the changed files in full, against
   the requirements comment and CLAUDE.md. Check: requirements coverage,
   correctness, tests actually test the requirements, conventions, no scope
   creep.
2. Post the review as a PR comment: fill
   `scripts/automation/templates/review-comment.md` (marker line first,
   round=K), verdict APPROVE or CHANGES REQUESTED, findings table, numbered
   required changes. `gh pr comment <M> --body-file <file>`.
3. On CHANGES REQUESTED: spawn `implementer` with the review comment verbatim;
   after it finishes, push, then post
   `scripts/automation/templates/fixes-comment.md` (round=K, responses 1:1
   with the required changes, each `Fixed in <sha>` or `Pushback: <reason>`)
   on the PR. Re-run Phase 4, then start round K+1.
4. Evaluate pushbacks on their merits — the implementer may be right.
5. If round REVIEW_MAX_ROUNDS ends without APPROVE: stop and escalate to the
   user with a summary comment on the PR — even with `--auto`.

## Phase 6 — merge gate

1. `gh pr ready <M>`.
2. Without `--auto`: AskUserQuestion — PR URL, one-line summary, diffstat,
   rounds used; options: Merge / Let me look first / Abandon.
3. On approval (or with `--auto`):
   `AUTOMATION_YES=1 scripts/automation/pr-merge.sh <M>`.

## Phase 7 — close out

1. Get the merge SHA (`gh pr view <M> --json mergeCommit`).
2. Post `scripts/automation/templates/issue-conclusion.md` (filled) on issue
   N: what shipped, PR/SHA, verification, follow-ups. File real follow-up
   issues (`gh issue create`) rather than leaving TODOs in text.
3. `Closes #N` normally auto-closes; check state and `gh issue close <N>` if
   still open.
4. `scripts/automation/set-status.sh <N> none` — the issue is closed, not in
   progress. `claude.yml`'s `close-out` job usually beats you to this on
   close; the script is idempotent, so run it anyway.
5. Tell the user: merged PR, conclusion link, and what a release would look
   like now (`scripts/automation/next-version.sh` output).

---
name: pr-fix
description: Take an existing PR (any PR, not just issue-flow ones), ingest human review comments and CI failures, fix via the implementer subagent, and respond point-by-point on the PR. Args - PR number.
---

Address outstanding feedback and failures on a PR. Usage: `/pr-fix <PR#>`.

1. **Preflight.** `scripts/automation/check-setup.sh`; on exit 4 STOP and
   relay the output.
2. **Gather.** For PR M:
   - `gh pr view <M> --json title,body,comments,reviews,url`
   - `gh pr diff <M>`
   - `scripts/automation/ci-status.sh <M>`; if failing,
     `scripts/automation/ci-logs.sh <M>`.
   Build ONE numbered, actionable list from: unresolved human review
   comments, unaddressed `claude:review` required changes, and CI failures.
   If the list is empty, say so and stop.
3. **Checkout.** `gh pr checkout <M>` (works for any PR head you can push to).
4. **Fix.** Spawn the `implementer` subagent with the numbered list verbatim
   plus relevant file context. It fixes, tests, commits.
5. **Push + respond.** `git push`. Post
   `scripts/automation/templates/fixes-comment.md` on the PR — responses 1:1
   with your numbered list (`Fixed in <sha>` / `Pushback: <reason>`). Use the
   next free `round=` number for the marker.
6. **Verify.** `scripts/automation/ci-status.sh <M> --wait`; if it fails on
   something you just touched, loop once more; otherwise report status, the
   comment URL, and anything needing a human decision.

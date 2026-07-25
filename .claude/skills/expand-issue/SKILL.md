---
name: expand-issue
description: Rewrite a GitHub issue into full, testable requirements and post them back on the issue (idempotently, via the claude:requirements marker). Args - issue number.
---

Expand a thin GitHub issue into a complete requirements document, posted on
the issue itself. Usage: `/expand-issue <issue#>`.

1. **Preflight.** Run `scripts/automation/check-setup.sh`. On exit 4, STOP and
   relay the doctor output (it contains the fix, e.g. `gh auth login`).
2. **Fetch.** `scripts/automation/issue-fetch.sh <N>` — read the issue and all
   comments. If a `<!-- claude:requirements` comment already exists, you are
   UPDATING it, not adding a new one.
3. **Research.** Explore the code the issue touches (cite real file paths).
   Understand current behavior before specifying new behavior. Check
   CLAUDE.md for constraints that shape the requirements.
4. **Write requirements.** Fill `scripts/automation/templates/requirements-comment.md`
   (keep the marker line first; replace every `{{PLACEHOLDER}}`):
   - Functional requirements: numbered, individually testable, no vagueness.
   - Acceptance criteria: a checklist a reviewer can verify mechanically.
   - Test plan: name the actual test files/commands that will prove it.
   - Open questions: ONLY things you genuinely cannot decide from the code,
     the issue, or repo conventions.
   Write the filled file to the session scratchpad.
5. **Post.**
   - New: `gh issue comment <N> --body-file <file>`
   - Update: find the comment id
     (`gh api repos/{owner}/{repo}/issues/<N>/comments --jq '.[] | select(.body | startswith("<!-- claude:requirements")) | .id'`)
     then `gh api repos/{owner}/{repo}/issues/comments/<id> -X PATCH -F body=@<file>`
6. **Label.** `scripts/automation/set-status.sh <N> status:requirements`
   (never `gh issue edit --add-label` for a `status:*` label — only one
   applies at a time, and the script enforces that plus creates the label if
   the repo lacks it). Then read the issue's `### Area` dropdown value and
   look it up in `AREA_LABEL_MAP` (`.automation.conf`); if it maps to a
   label, add that too (`gh issue edit <N> --add-label <label>`) — area
   labels are ordinary tags. A free-form issue has no `### Area` section;
   say so rather than guessing an area.
7. **Report.** Give the user the comment URL. If any Open Questions are
   blocking, surface them explicitly — implementation must not start on
   guessed answers.

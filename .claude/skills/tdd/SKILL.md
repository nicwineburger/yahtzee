---
name: tdd
description: Red-green-refactor discipline for any code change in this repo - failing test first, minimal implementation, full suite before commit. Use when implementing features or fixes by hand (the implementer subagent already follows this).
---

Test-driven development discipline for this repo. No GitHub interaction.

1. **Restate the behavior as a test.** Before touching implementation code,
   write down (one sentence) the observable behavior that should change.
2. **Red.** Write the failing test first, in the repo's existing test
   layout/naming (look at how current tests are organized; CLAUDE.md may pin
   repo-specific test locations and commands). Run the NARROWEST command
   that exercises it and confirm it fails **for the expected reason** — a
   test failing with an import error proves nothing.
3. **Green.** Implement the minimal change that passes. Re-run the narrow
   command.
4. **Refactor** with the test as a safety net, if warranted. Stay green.
5. **Full suite.** Run `TEST_CMD` from `.automation.conf` (and any secondary
   suite if you touched its area) before every commit. CLAUDE.md rules about
   mandatory regression tests for specific files are hard requirements.
6. **Commit** conventionally (the commit-msg hook enforces the format); the
   test and its implementation belong in the same commit.

Anti-patterns to refuse: writing tests after the implementation "to cover
it"; asserting on implementation details instead of behavior; weakening an
assertion to make it pass; skipping the full suite because the change "can't
affect anything else".

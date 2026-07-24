---
name: release
description: Cut a semver release - show the inferred bump and changelog preview, confirm with the user (with version override), then tag and publish a GitHub Release. Optional arg - explicit version like v1.2.0.
---

Cut a release from the default branch. Usage: `/release [vX.Y.Z]`.

1. **Preflight.** `scripts/automation/check-setup.sh`; on exit 4 STOP and
   relay the output. Must be on the default branch with a clean, synced tree
   (release.sh enforces this — surface its errors verbatim).
2. **Preview.**
   - `scripts/automation/next-version.sh --current` and `--bump` and the
     resulting next tag. Exit 3 means nothing releasable — report that and
     stop.
   - `scripts/automation/changelog.sh --version <next>` — show the user the
     notes that would ship.
3. **Confirm.** AskUserQuestion: release `<next>` as inferred / override the
   version (use the explicit arg if the user gave one) / cancel.
4. **Execute.** `AUTOMATION_YES=1 scripts/automation/release.sh --version <chosen>`
   (or without `--version` when using the inferred one).
5. **Report.** The release URL from `gh release view <tag> --json url`.

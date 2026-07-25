# Yahtzee / Yacht Dice solver — project conventions

Two halves, one repo:

- `math/` — the simulation/solver side. Exact backward-induction solvers for
  standard Yahtzee and for Clubhouse Games "Yacht Dice", plus query tooling
  over the solved games. Python, runs from the repo-root venv.
- `docs/` — the web app. A static, client-side optimal-play advisor for the
  Yacht Dice rules, deployed to GitHub Pages by
  `.github/workflows/pages.yml`. Plain HTML/JS/CSS, no build step.

## Environment

- ONE venv at the repo root: `yahtzee/.venv` (numpy, pandas, matplotlib,
  tqdm). Run math scripts FROM `math/` with `../.venv/bin/python <script>.py`
  — the solver's data paths are relative to `math/`.
- Web app needs no toolchain. Local preview: `python3 -m http.server -d docs`;
  engine regression test: `node docs/engine_test.mjs` (also run in CI before
  every Pages deploy).

## math/ — solver architecture

- **Standard Yahtzee** (13 categories, jokers, +100 extra-Yahtzee bonuses):
  `value_iteration.py` writes per-mask shards to
  `data/state_properties/level_NN/<13-bit mask>.npz` over `ReducedGameState`
  (filled_mask, upper_total capped at 63, yahtzee_eligible bit).
  `state_explorer.py` is the single source of truth for QUERYING the solved
  game (state values, per-roll decisions, box distributions) — never
  reinvent its math; `notebooks/state_explorer.ipynb` mirrors it.
- **Clubhouse Yacht Dice** (12 categories, sum-scored Full House/4-Kind,
  15/30 straights, no jokers/bonuses): `yacht_clubhouse.py` — same backward
  induction over (12-bit mask, upper), reusing the dice/keep/reroll tables
  from `precomputed.py` / `value_iteration.py`. Solution committed at
  `data/yacht_clubhouse_solution.npz`. Rules sourcing and the full
  standard-vs-Yacht numeric comparison: `yacht_dice_rules_comparison.md`.
- Headline-number scripts (run to reproduce every number in the comparison
  doc): `yahtzee_baseline_numbers.py` (standard rules, reads the solved
  shards) and `yacht_clubhouse_numbers.py` (Yacht rules; flags `--yacht-prob`,
  `--strict-fh`, `--mc N` for the extras).
- `data/` is gitignored by default with explicit keep rules (see .gitignore).
  Kept: precomputed tables, reduced states, state_properties shards,
  turn kernels, the level-00 final-outcome distribution, and the Yacht
  solution. `data/state_levels/` and `data/values/` are local-only build
  products — regenerate with `state_computations.py` / `value_iteration.py`.
- If you change any scoring/joker logic in `precomputed.py`, delete (or
  rebuild with `TRANSITIONS_REBUILD=1` / `REROLL_TABLES_REBUILD=1`) the
  pickles under `data/precomputed/`.

## docs/ — web app conventions

- The ONLY data dependency is `v_table.bin`: V(mask, upper) for all 4096×64
  Yacht states, uint16 × 0.01, exported by
  `math/export_yacht_solver_data.py` from the committed Yacht solution. The
  browser engine (`engine.js`) rebuilds the dice combinatorics itself and
  computes exact stage A/B/C decisions against that table — its advice must
  stay bit-for-bit consistent with the Python policy.
- `engine_test.mjs` + `test_fixtures.json` enforce that consistency (14
  state/roll fixture cases × 3 stages, dumped from the Python policy by the
  same export script). ALWAYS re-run `node docs/engine_test.mjs` after
  touching `engine.js`, and regenerate both exports after changing the Yacht
  solver: `cd math && ../.venv/bin/python export_yacht_solver_data.py`.
- UI state model (`app.js`): only upper-section SCORES are collected; lower
  boxes are filled/open toggles because lower-box points never affect future
  strategy under these rules. Keep it that way — don't add inputs the reduced
  state doesn't need.
- Deploys: push to `main` touching `docs/**` (or the workflow file) tests the
  engine and deploys via GitHub Actions to
  https://nicwineburger.github.io/yahtzee/.

## House rules

- Solver queries live in `math/` scripts, not buried in app code or
  notebooks; committed caches/exports make CI and the app independent of the
  heavy solves.
- Full House counts five-of-a-kind in BOTH rule sets (for Yacht Dice this is
  deliberate and evidence-backed — see the comparison doc's 325-max note).

## Repo automation

- Conventional commits are enforced by `.githooks/commit-msg` — run
  `scripts/automation/install-hooks.sh` once per clone. Squash merge only:
  the PR title becomes the commit on main and is linted in CI (`pr.yml`).
- Deterministic tooling lives in `scripts/automation/` (interfaces, exit
  codes, and comment-marker conventions in its README). Orchestration skills:
  `/issue-flow`, `/expand-issue`, `/pr-fix`, `/release`, `/tdd`.
- Implementation work is delegated to the `implementer` subagent (Opus 5 at
  `high` effort; the main agent plans/reviews on Fable at `xhigh`);
  the main agent orchestrates and reviews — review is never delegated.
- The generic layer is template-exportable via
  `scripts/automation/export-template.sh` — keep repo-specific values in
  `.automation.conf` (and this file), never in scripts/skills/templates.

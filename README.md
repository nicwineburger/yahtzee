# Yahtzee / Yacht Dice solver

Exact optimal-play solvers for two dice games, and a web app that plays
advisor for one of them:

- **Standard Yahtzee** — full backward-induction solution (13 boxes, upper
  bonus, jokers, +100 extra-Yahtzee bonuses). Optimal expected score:
  **254.59**.
- **Yacht Dice** as implemented in *Clubhouse Games: 51 Worldwide Classics*
  (Switch) — 12 boxes, sum-scored Full House and Four-of-a-Kind, 15/30
  straights, no jokers or extra bonuses. Optimal expected score: **191.77**.

## The web app

**https://nicwineburger.github.io/yahtzee/** — enter your scorecard and your
roll, get the exact EV-optimal keep or box placement for Yacht Dice.
Mobile-first, fully client-side, no build step. Source in [`docs/`](docs/)
(see its README for architecture and local development).

## The math

Everything lives in [`math/`](math/):

- `value_iteration.py` + `state_explorer.py` — the standard-Yahtzee solver
  and the query layer over the solved game (state values, per-roll optimal
  decisions, box score distributions).
- `yacht_clubhouse.py` — the Yacht Dice solver (same machinery, different
  category tables and state space), validated by exact single-box checks and
  Monte-Carlo replay.
- `yacht_dice_rules_comparison.md` — sourced rule differences between the two
  games and a full numeric comparison of the solved policies
  (`yahtzee_baseline_numbers.py` / `yacht_clubhouse_numbers.py` reproduce
  every number).
- `export_yacht_solver_data.py` — exports the solved Yacht value table
  (`docs/v_table.bin`) and the fixtures that keep the browser engine honest
  (`node docs/engine_test.mjs`).

Setup: `python3 -m venv .venv && .venv/bin/pip install numpy pandas
matplotlib tqdm`, then run scripts from `math/` with
`../.venv/bin/python <script>.py`.

## Testing

All of these run in CI before every Pages deploy:

```sh
npm ci                      # test tooling (Playwright)
npm run test:engine         # browser engine vs Python-policy fixtures
npm run test:engine-extra   # engine property tests (scoring rules, invariants)
npm run test:ui             # Playwright end-to-end, both app modes
cd math && ../.venv/bin/python test_yacht_clubhouse.py   # solver + exports
```

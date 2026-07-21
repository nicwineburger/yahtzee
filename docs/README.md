# Yacht Dice Solver (web app)

A static, fully client-side optimal-play advisor for **Yacht Dice** as
implemented in *Clubhouse Games: 51 Worldwide Classics* (Switch). Enter the
current scorecard and your roll; it tells you the best dice to keep, or the
best box to score, with exact expected values. Mobile-first; works offline
after first load (everything is static and cacheable).

Rules solved (see `../math/yacht_dice_rules_comparison.md` for sourcing):
12 boxes, sum-scored 4-of-a-Kind and Full House (five-of-a-kind counts),
S. Straight 15 / B. Straight 30, Yacht 50, +35 upper bonus at 63, no jokers
or extra-Yacht bonuses.

## How it works

- `v_table.bin` — the solved game: V(mask, upper) = expected remaining points
  under optimal play for all 4096 × 64 reduced states (uint16 × 0.01, 512 KB).
  Exported from the Python solver by `math/export_yacht_solver_data.py`
  (which reads `math/data/yacht_clubhouse_solution.npz`, produced by
  `math/yacht_clubhouse.py`).
- `engine.js` — rebuilds the dice combinatorics (252 roll multisets, keep
  sub-multisets, reroll outcome distributions) in the browser and computes
  exact stage A/B/C decisions against the value table. No approximations:
  the advice is the same as the Python solver's policy.
- `index.html` / `style.css` / `app.js` — the UI, with two modes:
  - **Advisor**: enter a real game's state by hand. Only the upper-section
    *scores* are asked for (lower-box points don't affect future strategy,
    so lower boxes are just filled/open toggles). Every listed option is
    playable: tapping the recommended (or any alternative) keep carries
    those dice into the next roll, and tapping any box choice scores it and
    starts the next turn.
  - **Play**: the app runs a full game — it rolls the dice (tap to hold
    between rolls, 3 rolls a turn), previews what every open box would
    score, banks the box you tap, tracks upper bonus and totals, and
    supports 1–4 players pass-and-play from one device. An advice toggle
    overlays the optimal move ("Hold these for me" / "Score it") without
    playing for you.
  The expected-points chip opens a chart of expected points left vs boxes
  filled (one line per player in play mode). All state persists in
  localStorage.

No build step, no dependencies.

## Deploying

GitHub Pages, either way works:

1. **Actions** (workflow included): Settings → Pages → Source: *GitHub
   Actions*. `.github/workflows/pages.yml` tests the engine and deploys
   `docs/` on pushes to `main`.
2. **Branch**: Settings → Pages → Source: *Deploy from a branch* →
   `main` / `docs/`.

## Developing / testing locally

```sh
python3 -m http.server -d docs     # then open http://localhost:8000
node docs/engine_test.mjs          # engine vs Python-solver fixtures
```

`test_fixtures.json` holds per-stage EVs and best actions for 14
(state, roll) cases dumped from the Python policy; regenerate both it and
`v_table.bin` with `cd math && ../.venv/bin/python export_yacht_solver_data.py`.

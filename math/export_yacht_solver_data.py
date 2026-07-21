"""Export the solved Clubhouse Yacht Dice value table for the web solver.

Writes docs/v_table.bin: 4096 masks x 64 upper totals of uint16 (little-endian),
mask-major, value = round(V * 100).  V < 656 always (max remaining score is
325), so uint16 with a 0.01 step is lossless enough for move ranking (max
quantization error 0.005 pts).

The web app (docs/engine.js) rebuilds the dice/keep/reroll tables itself and
only needs V(mask, upper) to score decisions, so this one file is the entire
data dependency.

Also writes docs/test_fixtures.json: per-stage EVs and best actions for a
handful of (state, roll) cases, straight from the Python policy — the browser
engine's regression reference (checked by `node docs/engine_test.mjs`).

Run from math/ with the ROOT venv:
    ../.venv/bin/python export_yacht_solver_data.py
"""
import json

import numpy as np

import yacht_clubhouse as yc
from yacht_clubhouse import Y_NUM_CATEGORIES

SOLUTION_PATH = "data/yacht_clubhouse_solution.npz"
OUT_PATH = "../docs/v_table.bin"
FIXTURES_PATH = "../docs/test_fixtures.json"

FULL = (1 << Y_NUM_CATEGORIES) - 1


def export_v_table(V):
    q = np.round(V * 100).astype("<u2")
    q.tofile(OUT_PATH)
    print(f"wrote {OUT_PATH}: {q.nbytes} bytes, "
          f"V(empty) = {q[0, 0] / 100:.2f} (float {V[0, 0]:.4f})")


def export_fixtures(V_by_mask):
    from precomputed import dice_values_to_idx
    from state_explorer import keep_to_values
    from value_iteration import REROLL_PAIR_KEEPS

    cases = []

    def add_case(mask, upper, rolls):
        pol = yc.policy_for_mask(mask, V_by_mask)
        for vals in rolls:
            i = dice_values_to_idx(vals)
            pair_a = int(pol["dec_A"][upper, i])
            pair_b = int(pol["dec_B"][upper, i])
            cases.append({
                "mask": mask, "upper": upper, "dice": list(vals),
                "evA": float(pol["ev_A"][upper, i]),
                "evB": float(pol["ev_B"][upper, i]),
                "evC": float(pol["ev_C"][upper, i]),
                "bestKeepA": list(keep_to_values(int(REROLL_PAIR_KEEPS[pair_a]))),
                "bestKeepB": list(keep_to_values(int(REROLL_PAIR_KEEPS[pair_b]))),
                "bestCatC": int(pol["dec_C"][upper, i]),
            })

    add_case(0, 0, [(1, 2, 3, 4, 6), (2, 3, 3, 4, 5), (1, 1, 2, 2, 3),
                    (3, 3, 3, 5, 6), (1, 2, 3, 4, 5), (1, 1, 1, 1, 1),
                    (5, 5, 6, 6, 6)])
    add_case((1 << 0) | (1 << 3) | (1 << 6) | (1 << 11), 17,
             [(2, 2, 4, 5, 6), (3, 3, 3, 4, 4), (1, 1, 6, 6, 6)])
    add_case(FULL - (1 << 8), 35, [(2, 2, 3, 3, 5), (4, 4, 4, 6, 6)])  # FH open
    add_case(FULL - (1 << 5), 60, [(2, 3, 4, 6, 6), (1, 2, 6, 6, 6)])  # Sixes open

    fx = {
        "v_empty": float(V_by_mask[0][0]),
        "v_states": [
            {"mask": 0, "upper": 0, "v": float(V_by_mask[0][0])},
            {"mask": 2049, "upper": 17, "v": float(V_by_mask[2049][17])},
            {"mask": FULL - (1 << 8), "upper": 35,
             "v": float(V_by_mask[FULL - (1 << 8)][35])},
            {"mask": FULL, "upper": 63, "v": float(V_by_mask[FULL][63])},
        ],
        "cases": cases,
    }
    with open(FIXTURES_PATH, "w") as f:
        json.dump(fx, f, indent=1)
    print(f"wrote {FIXTURES_PATH} with {len(cases)} cases")


def main():
    d = np.load(SOLUTION_PATH)
    masks = d["masks"]
    V = d["V"].astype(np.float64)

    n_masks = 1 << Y_NUM_CATEGORIES
    assert len(masks) == n_masks and (masks == np.arange(n_masks)).all(), \
        "solution npz must cover every mask in order"
    assert V.shape == (n_masks, 64)
    assert V.min() >= 0 and V.max() * 100 < 65536, V.max()

    export_v_table(V)
    export_fixtures({int(m): V[int(m)] for m in masks})


if __name__ == "__main__":
    main()

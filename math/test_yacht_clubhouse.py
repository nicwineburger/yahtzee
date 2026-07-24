"""Tests for the Clubhouse Yacht Dice solver and its web-app exports.

Plain asserts, no test framework; needs only numpy (+ the repo's committed
data). Checks the scoring rules, the committed solution's headline values,
single-open-box EVs against independently-known numbers, structural
invariants of the value function, and that the web exports (v_table.bin,
test_fixtures.json) agree with the solution.

Run from math/ with the ROOT venv (CI runs it with a bare numpy install):
    ../.venv/bin/python test_yacht_clubhouse.py
"""
import json

import numpy as np

import yacht_clubhouse as yc
from yacht_clubhouse import (
    Y_CHOICE, Y_FOUR_KIND, Y_FULL_HOUSE, Y_SMALL_STRAIGHT, Y_BIG_STRAIGHT,
    Y_YACHT, Y_NUM_CATEGORIES,
)
from precomputed import dice_values_to_idx

FULL = (1 << Y_NUM_CATEGORIES) - 1
PASS = []


def ok(label, cond):
    assert cond, label
    PASS.append(label)


def main():
    S = yc.Y_SCORE_TABLE

    # ── Scoring rules ──────────────────────────────────────────────────────
    i = dice_values_to_idx
    ok("12345: S.Straight 15, B.Straight 30, Choice 15",
       S[i((1, 2, 3, 4, 5))][Y_SMALL_STRAIGHT] == 15
       and S[i((1, 2, 3, 4, 5))][Y_BIG_STRAIGHT] == 30
       and S[i((1, 2, 3, 4, 5))][Y_CHOICE] == 15)
    ok("23456 is also a B.Straight", S[i((2, 3, 4, 5, 6))][Y_BIG_STRAIGHT] == 30)
    ok("13456 is only an S.Straight",
       S[i((1, 3, 4, 5, 6))][Y_SMALL_STRAIGHT] == 15
       and S[i((1, 3, 4, 5, 6))][Y_BIG_STRAIGHT] == 0)
    ok("66655: Full House = sum 28", S[i((6, 6, 6, 5, 5))][Y_FULL_HOUSE] == 28)
    ok("66665: 4K = sum 29, not FH",
       S[i((6, 6, 6, 6, 5))][Y_FOUR_KIND] == 29
       and S[i((6, 6, 6, 6, 5))][Y_FULL_HOUSE] == 0)
    ok("66666: Yacht 50, 4K 30, FH 30 (five-oak counts), no straights",
       S[i((6,) * 5)][Y_YACHT] == 50 and S[i((6,) * 5)][Y_FOUR_KIND] == 30
       and S[i((6,) * 5)][Y_FULL_HOUSE] == 30
       and S[i((6,) * 5)][Y_SMALL_STRAIGHT] == 0)
    ok("upper boxes are face * count", S[i((3, 3, 3, 1, 2))][2] == 9)
    ok("max box score is 50 across all states", int(S.max()) == 50)

    # ── Committed solution headline values ─────────────────────────────────
    d = np.load("data/yacht_clubhouse_solution.npz")
    V = {int(m): v.astype(np.float64) for m, v in zip(d["masks"], d["V"])}
    P = {int(m): p.astype(np.float64) for m, p in zip(d["masks"], d["P"])}

    ok("V(empty) = 191.7744", abs(V[0][0] - 191.7744) < 1e-3)
    ok("P(bonus | empty) = 69.02%", abs(P[0][0] - 0.690243) < 1e-3)
    ok("V(terminal) = 0", V[FULL].max() == 0)
    ok("all V in [0, 325]", all(v.min() >= 0 and v.max() <= 325 for v in V.values()))
    ok("all P in [0, 1]", all(p.min() >= -1e-9 and p.max() <= 1 + 1e-9 for p in P.values()))
    ok("terminal bonus indicator: P(full, 63) = 1, P(full, 62) = 0",
       P[FULL][63] == 1 and P[FULL][62] == 0)

    # Filling a box can only remove future opportunity: V(mask|c) <= V(mask).
    rng = np.random.default_rng(0)
    for _ in range(200):
        m = int(rng.integers(0, FULL))
        c = int(rng.integers(0, 12))
        assert (V[m | (1 << c)] <= V[m] + 1e-4).all(), (m, c)
    ok("V monotone under filling a box (200 random mask/box pairs)", True)

    # ── Single-open-box EVs (match yahtzee_baseline_numbers where rules
    #    coincide; Yacht-specific values from yacht_clubhouse_numbers) ──────
    def open_box_ev(cat, upper=35):
        pol = yc.policy_for_mask(FULL & ~(1 << cat), V)
        return float(pol["V"][upper])

    ok("last-turn Choice EV = 70/3", abs(open_box_ev(Y_CHOICE) - 70 / 3) < 1e-6)
    ok("last-turn Ones EV = 2.1065", abs(open_box_ev(0) - 2.106481) < 1e-4)
    ok("last-turn Yacht EV = 2.301", abs(open_box_ev(Y_YACHT) - 2.301) < 2e-3)
    ok("last-turn 4K EV = 5.611", abs(open_box_ev(Y_FOUR_KIND) - 5.611) < 2e-3)
    ok("last-turn S.Straight EV = 9.232", abs(open_box_ev(Y_SMALL_STRAIGHT) - 9.232) < 2e-3)
    ok("last-turn B.Straight EV = 7.833", abs(open_box_ev(Y_BIG_STRAIGHT) - 7.833) < 2e-3)

    # ── Web exports agree with the solution ────────────────────────────────
    q = np.fromfile("../docs/v_table.bin", dtype="<u2").reshape(1 << 12, 64) / 100.0
    Vmat = np.stack([V[m] for m in range(1 << 12)])
    ok("v_table.bin matches solution within quantization (0.005)",
       float(np.abs(q - Vmat).max()) <= 0.005 + 1e-9)

    with open("../docs/test_fixtures.json") as f:
        fx = json.load(f)
    ok("fixtures headline matches solution", abs(fx["v_empty"] - V[0][0]) < 1e-6)
    c0 = fx["cases"][0]
    pol = yc.policy_for_mask(c0["mask"], V)
    idx = dice_values_to_idx(tuple(c0["dice"]))
    ok("fixture case 0 reproducible from the solution",
       abs(float(pol["ev_A"][c0["upper"], idx]) - c0["evA"]) < 1e-6)

    # ── Per-stage dominance: keeping all five can never lose value ─────────
    ok("ev_B >= ev_C pointwise (empty card)",
       (yc.policy_for_mask(0, V)["ev_B"] >= yc.policy_for_mask(0, V)["ev_C"] - 1e-9).all())

    print(f"OK — {len(PASS)} solver checks passed")


if __name__ == "__main__":
    main()

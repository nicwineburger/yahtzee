"""Clubhouse "Yacht Dice" — headline numbers under the Clubhouse rule set.

Prints the Yacht-rules counterparts of everything
``yahtzee_baseline_numbers.py`` reports for standard Yahtzee, for the
side-by-side in yacht_dice_rules_comparison.md.  Reads
data/yacht_clubhouse_solution.npz (written by `yacht_clubhouse.py`;
regenerated here if missing).

Run from math/ with the ROOT venv:
    ../.venv/bin/python yacht_clubhouse_numbers.py
Optional extras (each adds a ~1 min sweep):
    --yacht-prob   P(fill the Yacht box with a real 50) under optimal play
    --strict-fh    re-solve with five-of-a-kind NOT counting as Full House
    --mc N         Monte-Carlo replay of N games (independent DP check)
"""
import os
import sys
import numpy as np

import yacht_clubhouse as yc
from yacht_clubhouse import (
    Y_CATEGORY_NAMES, Y_SCORE_TABLE, Y_NUM_CATEGORIES,
    Y_ONES, Y_THREES, Y_SIXES, Y_CHOICE, Y_FOUR_KIND, Y_FULL_HOUSE,
    Y_SMALL_STRAIGHT, Y_BIG_STRAIGHT, Y_YACHT,
)
from precomputed import ALL_DICE_STATES, dice_idx_to_values, dice_values_to_idx

SOLUTION_PATH = "data/yacht_clubhouse_solution.npz"

FULL = (1 << Y_NUM_CATEGORIES) - 1


def load_solution():
    if not os.path.exists(SOLUTION_PATH):
        V, P = yc.solve()
        masks = np.array(sorted(V.keys()), dtype=np.int32)
        np.savez_compressed(
            SOLUTION_PATH, masks=masks,
            V=np.stack([V[int(m)] for m in masks]).astype(np.float32),
            P=np.stack([P[int(m)] for m in masks]).astype(np.float32))
    d = np.load(SOLUTION_PATH)
    V = {int(m): v.astype(np.float64) for m, v in zip(d["masks"], d["V"])}
    P = {int(m): p.astype(np.float64) for m, p in zip(d["masks"], d["P"])}
    return V, P


def report():
    V, P = load_solution()
    v_empty = V[0][0]

    print("=" * 72)
    print("HEADLINE")
    print("=" * 72)
    print(f"V(empty)  whole-game expected score = {v_empty:.4f}")
    print(f"P(upper bonus) under optimal play   = {P[0][0]:.4%}")
    print(f"Turn-0 top-bonus EV (empty card)    = {35 * P[0][0]:.2f}")

    print()
    print("=" * 72)
    print("TOP-BONUS EV after a turn-1 upper fill")
    print("(rows = # of that number scored on turn 1; columns = the number)")
    print("=" * 72)
    print(f"{'count':>5} | " + " ".join(f"{n:>7}" for n in range(1, 7)))
    print("-" * 60)
    for c in range(0, 6):
        cells = []
        for n in range(1, 7):
            mask = 1 << (n - 1)
            upper = min(n * c, 63)
            cells.append(f"{35 * P[mask][upper]:7.2f}")
        print(f"{c:>5} | " + " ".join(cells))

    print()
    print("=" * 72)
    print("OPTIMAL FIRST-TURN OUTCOMES ranked by expected final total")
    print("(points banked + V of resulting state)")
    print("=" * 72)
    pol0 = yc.policy_for_mask(0, V)
    groups = {}
    for idx in range(len(ALL_DICE_STATES)):
        c = int(pol0["dec_C"][0, idx])
        pts = int(Y_SCORE_TABLE[idx, c])
        ev = float(pol0["ev_C"][0, idx])
        key = (c, pts)
        g = groups.setdefault(key, {"evs": set(), "rolls": []})
        g["evs"].add(round(ev, 6))
        g["rolls"].append(dice_idx_to_values(idx))
    rows = []
    for (c, pts), g in groups.items():
        assert max(g["evs"]) - min(g["evs"]) < 1e-4
        rows.append((float(np.mean(list(g["evs"]))), Y_CATEGORY_NAMES[c], pts,
                     min(g["rolls"]), len(g["rolls"])))
    rows.sort(key=lambda r: -r[0])
    print(f"{len(rows)} distinct optimal first-turn outcomes (from 252 rolls):\n")
    print(f"{'rank':>4}  {'box':11s} {'pts':>4}  {'sample':8s} {'exp final':>9}  {'#rolls':>6}")
    for i, (ev, box, pts, sample, n) in enumerate(rows):
        dice = "".join(str(d) for d in sample)
        print(f"{i:>4}  {box:11s} {pts:>4}  {dice:8s} {ev:>9.2f}  {n:>6}")

    print()
    print("=" * 72)
    print("EXPECTED TOTAL after committing 12 points on turn 1")
    print("=" * 72)
    for label, cat, upper in [
        ("12 in 3 box (four 3s)", Y_THREES, 12),
        ("12 in choice (sum 12)", Y_CHOICE, 0),
        ("12 in 4-kind box (sum 12)", Y_FOUR_KIND, 0),
        ("12 in 6 box (two 6s)", Y_SIXES, 12),
    ]:
        v = V[1 << cat][upper]
        total = 12 + v
        print(f"  {label:26s}  12 + V={v:8.4f}  ->  total = {total:8.4f}  "
              f"(delta vs {v_empty:.1f} = {total - v_empty:+.4f})")

    print()
    print("=" * 72)
    print("EACH BOX as the ONLY open box on the last turn")
    print("(upper_total=35, so no bonus interaction; EV-optimal policy)")
    print("=" * 72)
    st_top = FULL & ~(1 << Y_ONES)
    ev_ones = V[st_top][35]
    p_ones, dist = yc.replay_event_prob(st_top, 35, V,
                                        Y_SCORE_TABLE[:, Y_ONES] > 0)
    print(f"  Ones: mean count = {ev_ones:.4f}   P(>=1) = {p_ones * 100:.2f}%")
    counts = np.array([int(v[0]) for v in ALL_DICE_STATES])
    for k in range(6):
        print(f"    {k} of value: {dist[counts == k].sum() * 100:5.2f}%")
    print()
    for name, cat in [("Yacht", Y_YACHT), ("Full House", Y_FULL_HOUSE),
                      ("B. Straight", Y_BIG_STRAIGHT),
                      ("S. Straight", Y_SMALL_STRAIGHT), ("Choice", Y_CHOICE),
                      ("Four of a Kind", Y_FOUR_KIND)]:
        mask = FULL & ~(1 << cat)
        ev = V[mask][35]
        p, _ = yc.replay_event_prob(mask, 35, V, Y_SCORE_TABLE[:, cat] > 0)
        print(f"  {name:16s} P(success) = {p * 100:6.2f}%   EV = {ev:6.3f}")

    print()
    print("=" * 72)
    print("FIRST-ROLL KEEP DECISIONS from an empty card (stage A, turn 1)")
    print("=" * 72)
    from precomputed import KEEPS_FOR_DICE, ALL_KEEPS
    from state_explorer import keep_to_values
    for vals in [(1, 2, 3, 4, 6), (2, 3, 3, 4, 5), (1, 1, 2, 2, 3),
                 (3, 3, 3, 5, 6), (1, 2, 3, 4, 5)]:
        i0 = dice_values_to_idx(vals)
        pair = int(pol0["dec_A"][0, i0])
        # pair -> keep vector: local index within this dice state's keep list
        local = pair - int(yc.REROLL_OFFSETS[i0])
        keep = keep_to_values(KEEPS_FOR_DICE[i0][local])
        ev = float(pol0["ev_A"][0, i0])
        print(f"  roll {vals}: keep {keep}   EV = {ev:.2f}")


def extras(argv):
    V, P = load_solution()

    if "--yacht-prob" in argv:
        imm = np.zeros((len(ALL_DICE_STATES), Y_NUM_CATEGORIES))
        imm[Y_SCORE_TABLE[:, Y_YACHT] == 50, Y_YACHT] = 1.0
        F = yc.evaluate_functional(V, immediate=imm)
        print(f"\nP(score Yacht = 50 sometime) = {F[0][0]:.4%}"
              f"   (Yahtzee rules: P(Yahtzee 50) = 33.74%)")

    if "--strict-fh" in argv:
        strict = Y_SCORE_TABLE.copy()
        for i, v in enumerate(ALL_DICE_STATES):
            if v.max() == 5:
                strict[i, Y_FULL_HOUSE] = 0
        saved = yc.Y_SCORE_TABLE
        yc.Y_SCORE_TABLE = strict
        try:
            V2, P2 = yc.solve(progress=False)
        finally:
            yc.Y_SCORE_TABLE = saved
        print(f"\nSTRICT-FH variant (max 323, five-of-a-kind not a Full House):")
        print(f"  V(empty) = {V2[0][0]:.4f}   P(bonus) = {P2[0][0]:.4%}")

    if "--mc" in argv:
        n = int(argv[argv.index("--mc") + 1])
        totals = yc.simulate(V, n)
        print(f"\nMC replay of {n} games: mean = {totals.mean():.3f} "
              f"+/- {totals.std() / np.sqrt(n):.3f}   sd = {totals.std():.2f}")
        qs = np.percentile(totals, [5, 25, 50, 75, 95])
        print("  q05/q25/median/q75/q95 = " + " / ".join(f"{q:.0f}" for q in qs))


if __name__ == "__main__":
    report()
    extras(sys.argv[1:])

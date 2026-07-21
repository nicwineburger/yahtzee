"""Standard-rules (Yahtzee) baseline numbers, from the solved policy.

Prints the standard-Yahtzee counterparts of everything
``yacht_clubhouse_numbers.py`` reports, so the two rule sets can be compared
side by side (the comparison itself lives in yacht_dice_rules_comparison.md):

  1. Headline: V(empty), P(upper bonus), turn-0 top-bonus EV.
  2. Top-bonus EV after a single turn-1 upper fill (6 numbers x 0..5 dice).
  3. Optimal first-turn outcomes ranked by expected final total.
  4. Expected total after committing 12 points to various boxes on turn 1.
  5. Each box as the ONLY open box on the last turn: P(success) and EV
     (upper_total=35 so the bonus can't interfere), plus the
     "keep three 1s vs keep two 6s" Four-of-a-Kind comparison.

Everything READS the solved shards in data/state_properties/ via
state_explorer; nothing re-derives strategy.

Run from math/ with the ROOT venv (needs pandas/numpy):
    ../.venv/bin/python yahtzee_baseline_numbers.py
"""
import numpy as np

from constants import *
from precomputed import (ALL_DICE_STATES, dice_idx_to_values, dice_values_to_idx,
                         REROLL_OUTCOMES, SCORE_ROWS, KEEP_IDX)
from reduced_game_state import ReducedGameState
from state_explorer import (state_value, category_alternatives, cat_name,
                            mask_from_categories, box_distribution,
                            box_distribution_stats, box_distribution_table,
                            distribution_stats, get_state_row)


def top_bonus_ev(filled_mask, upper_total):
    state = ReducedGameState(filled_mask=filled_mask, upper_total=upper_total,
                             yahtzee_eligible=False)
    return box_distribution_stats(state, "UpperBonus", when="after")["mean"]


def last_turn_state(open_cat, upper_total=35):
    """State with only `open_cat` unfilled (last turn), no bonuses in play."""
    filled = [c for c in range(NUM_CATEGORIES) if c != open_cat]
    return ReducedGameState(filled_mask=mask_from_categories(filled),
                            upper_total=upper_total, yahtzee_eligible=False)


def p_success_from_roll(state, opening_roll, cat, forced_keepA=None):
    """P(box `cat` scores > 0) from `opening_roll`, following the solver's
    STORED optimal keeps (or a forced stage-A keep, a 6-tuple count vector).
    Exact enumeration over the two rerolls."""
    payload, row = get_state_row(state)
    dA, dB = payload["decisions_A"][row], payload["decisions_B"][row]
    i0 = dice_values_to_idx(opening_roll)
    kA = KEEP_IDX[forced_keepA] if forced_keepA is not None else int(dA[i0])
    fA, nA = REROLL_OUTCOMES[(i0, kA)]
    sA = float(sum(nA))
    p = 0.0
    for iB, nb in zip(fA, nA):
        kB = int(dB[int(iB)])
        fB, nB = REROLL_OUTCOMES[(int(iB), kB)]
        sB = float(sum(nB))
        succ = sum(nc for iC, nc in zip(fB, nB) if SCORE_ROWS[int(iC)][cat] > 0)
        p += (nb / sA) * (succ / sB)
    return p


def report():
    empty = ReducedGameState(filled_mask=0, upper_total=0, yahtzee_eligible=False)
    v_empty = state_value(empty)
    p_bonus = top_bonus_ev(0, 0) / UPPER_BONUS

    print("=" * 72)
    print("HEADLINE")
    print("=" * 72)
    print(f"V(empty)  whole-game expected score = {v_empty:.4f}")
    print(f"P(upper bonus) under optimal play   = {p_bonus:.4%}")
    print(f"Turn-0 top-bonus EV (empty card)    = {UPPER_BONUS * p_bonus:.2f}")

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
            cells.append(f"{top_bonus_ev(1 << (n - 1), min(n * c, 63)):7.2f}")
        print(f"{c:>5} | " + " ".join(cells))

    print()
    print("=" * 72)
    print("OPTIMAL FIRST-TURN OUTCOMES ranked by expected final total")
    print("=" * 72)
    groups = {}
    for idx in range(len(ALL_DICE_STATES)):
        top = category_alternatives(empty, idx).iloc[0]
        key = (int(top["category_idx"]), int(top["score_points"]))
        g = groups.setdefault(key, {"evs": set(), "rolls": []})
        g["evs"].add(round(float(top["total_EV"]), 6))
        g["rolls"].append(tuple(dice_idx_to_values(idx)))
    rows = []
    for (cat, pts), g in groups.items():
        assert max(g["evs"]) - min(g["evs"]) < 1e-4, (cat, pts, g["evs"])
        rows.append((float(np.mean(list(g["evs"]))), cat_name(cat), pts,
                     min(g["rolls"]), len(g["rolls"])))
    rows.sort(key=lambda r: -r[0])
    print(f"{len(rows)} distinct optimal first-turn outcomes (from 252 rolls):\n")
    print(f"{'rank':>4}  {'box':14s} {'pts':>4}  {'sample':8s} {'exp final':>9}  {'#rolls':>6}")
    for i, (ev, box, pts, sample, n) in enumerate(rows):
        dice = "".join(str(d) for d in sample)
        print(f"{i:>4}  {box:14s} {pts:>4}  {dice:8s} {ev:>9.2f}  {n:>6}")

    print()
    print("=" * 72)
    print("EXPECTED TOTAL after committing 12 points on turn 1")
    print("=" * 72)
    for label, cat, upper in [
        ("12 in 3 box (four 3s)", THREES, 12),
        ("12 in chance (sum 12)", CHANCE, 0),
        ("12 in 3-kind box (sum 12)", THREE_KIND, 0),
        ("12 in 4-kind box (sum 12)", FOUR_KIND, 0),
        ("12 in 6 box (two 6s)", SIXES, 12),
    ]:
        st = ReducedGameState(filled_mask=(1 << cat), upper_total=upper,
                              yahtzee_eligible=False)
        v = state_value(st)
        print(f"  {label:26s}  12 + V={v:8.4f}  ->  total = {12 + v:8.4f}  "
              f"(delta vs {v_empty:.1f} = {12 + v - v_empty:+.4f})")

    print()
    print("=" * 72)
    print("EACH BOX as the ONLY open box on the last turn (upper_total=35)")
    print("=" * 72)
    st = last_turn_state(ONES)
    tbl = box_distribution_table(st, ONES, when="after")
    s = distribution_stats(box_distribution(st, ONES, when="after"))
    print(f"  Ones: mean count = {s['mean']:.4f}   P(>=1) = {s['p_positive'] * 100:.2f}%")
    for _, r in tbl.iterrows():
        print(f"    {int(r['score'])} of value: {r['prob'] * 100:5.2f}%")
    print()
    for name, cat in [("Yahtzee", YAHTZEE), ("Full House", FULL_HOUSE),
                      ("Large Straight", LARGE_STRAIGHT),
                      ("Small Straight", SMALL_STRAIGHT), ("Chance", CHANCE),
                      ("Four of a Kind", FOUR_KIND), ("Three of a Kind", THREE_KIND)]:
        s = distribution_stats(box_distribution(last_turn_state(cat), cat, when="after"))
        print(f"  {name:16s} P(success) = {s['p_positive'] * 100:6.2f}%   EV = {s['mean']:6.3f}")

    print()
    print("4-KIND from 11166, three 1s vs two 6s (only 4-Kind open):")
    fk = last_turn_state(FOUR_KIND)
    p1 = p_success_from_roll(fk, [1, 1, 1, 6, 6], FOUR_KIND,
                             forced_keepA=(3, 0, 0, 0, 0, 0))
    p6 = p_success_from_roll(fk, [1, 1, 1, 6, 6], FOUR_KIND)
    print(f"  keep the 1's (three-of-a-kind): {p1 * 100:.1f}%")
    print(f"  keep the 6's (two-of-a-kind):   {p6 * 100:.1f}%   (EV-optimal)")


if __name__ == "__main__":
    report()

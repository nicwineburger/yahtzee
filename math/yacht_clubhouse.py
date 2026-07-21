"""Clubhouse Games (Switch) "Yacht Dice" rules — solver + query helpers.

Rule set (see yacht_dice_rules_comparison.md for sourcing):
  12 categories / 12 rounds, 3 rolls a turn (2 rerolls), keep-any between rolls:
    0..5  Ones..Sixes        face * count
    6     Choice             sum of all five dice (always scores)
    7     Four-of-a-Kind     sum of ALL five dice if 4+ of a kind, else 0
    8     Full House         sum of ALL five dice if 3+2 (five-of-a-kind DOES
                             count — the in-game max is 325, only reachable if a
                             Yacht can fill Full House), else 0
    9     S. Straight        15 if four in sequence, else 0
    10    B. Straight        30 if five in sequence, else 0
    11    Yacht              50 if five of a kind, else 0
  Upper bonus: +35 when Ones..Sixes total >= 63.
  NO Yahtzee-style joker rules and NO extra-Yacht bonus.

State = (filled_mask over 12 categories, upper_total capped at 63).  Rewards
(box points, +35 on crossing 63) are emitted immediately, so V(s) = expected
total future score under expected-score-optimal play, exactly like the main
solver's ReducedGameState convention.

The dice machinery (252 dice multisets, 462 keeps, reroll-outcome matrix) is
IDENTICAL to standard Yahtzee, so it is imported from `precomputed` /
`value_iteration` rather than rebuilt.  Only the category tables differ.

Run from math/ with the ROOT venv:  ../.venv/bin/python yacht_clubhouse.py
(runs the backward pass and prints V(empty) + P(upper bonus) as a smoke test;
the full report lives in yacht_clubhouse_numbers.py).
"""
import numpy as np

from precomputed import (
    ALL_DICE_STATES, ALL_DICE_FREQS, NUM_DICE_STATES,
    dice_idx_to_values,
)
from value_iteration import REROLL_MATRIX, REROLL_OFFSETS, REROLL_PAIR_KEEPS

# ── Categories ──────────────────────────────────────────────────────────────
Y_NUM_CATEGORIES = 12
Y_ONES, Y_TWOS, Y_THREES, Y_FOURS, Y_FIVES, Y_SIXES = range(6)
Y_CHOICE = 6
Y_FOUR_KIND = 7
Y_FULL_HOUSE = 8
Y_SMALL_STRAIGHT = 9
Y_BIG_STRAIGHT = 10
Y_YACHT = 11

Y_CATEGORY_NAMES = [
    "Ones", "Twos", "Threes", "Fours", "Fives", "Sixes",
    "Choice", "4Kind", "FullHouse", "SStraight", "BStraight", "Yacht",
]

Y_SMALL_STRAIGHT_POINTS = 15
Y_BIG_STRAIGHT_POINTS = 30
Y_YACHT_POINTS = 50
Y_UPPER_BONUS = 35
Y_UPPER_BONUS_THRESHOLD = 63

_UPPER_CAT_MASK = np.zeros(Y_NUM_CATEGORIES, dtype=bool)
_UPPER_CAT_MASK[: Y_SIXES + 1] = True


def _score_row(vec):
    """Scores for one dice multiset (6-vector of counts) across the 12 boxes."""
    vec = np.asarray(vec)
    total = int(np.dot(vec, np.arange(1, 7)))
    row = [int((f + 1) * vec[f]) for f in range(6)]
    row.append(total)                                            # Choice
    row.append(total if vec.max() >= 4 else 0)                   # 4Kind
    row.append(total if ((3 in vec and 2 in vec) or 5 in vec) else 0)  # Full House
    small = int(np.prod(vec[0:4]) + np.prod(vec[1:5]) + np.prod(vec[2:6]) > 0)
    row.append(Y_SMALL_STRAIGHT_POINTS * small)                  # S.Straight
    big = int(np.prod(vec[0:5]) + np.prod(vec[1:6]) > 0)
    row.append(Y_BIG_STRAIGHT_POINTS * big)                      # B.Straight
    row.append(Y_YACHT_POINTS * int(vec.max() == 5))             # Yacht
    return row


Y_SCORE_TABLE = np.array([_score_row(v) for v in ALL_DICE_STATES], dtype=np.int16)

_FREQS_F = ALL_DICE_FREQS.astype(np.float64)
_N_UPPER = Y_UPPER_BONUS_THRESHOLD + 1          # rows per mask: upper 0..63


def policy_for_mask(mask, V_next):
    """Solve one mask (all 64 upper totals at once).

    V_next: dict next_mask -> (64,) float array (missing = terminal, V=0).
    Returns dict with V (64,), per-stage evs (64,252) and decisions:
      dec_C (64,252) uint8 category; dec_B/dec_A (64,252) int32 PAIR index
      into REROLL_MATRIX rows (gather ev_flat at that index to evaluate).
    """
    base = Y_SCORE_TABLE.astype(np.int32)                        # (252, 12)
    legal = np.array([not (mask >> c) & 1 for c in range(Y_NUM_CATEGORIES)])

    uppers = np.arange(_N_UPPER)                                 # (64,)
    # (64, 252, 12) new upper total per (state row, dice, category)
    new_upper = np.where(
        _UPPER_CAT_MASK[None, None, :],
        np.minimum(uppers[:, None, None] + base[None, :, :], Y_UPPER_BONUS_THRESHOLD),
        uppers[:, None, None],
    )
    crossed = (uppers[:, None, None] < Y_UPPER_BONUS_THRESHOLD) & (
        new_upper >= Y_UPPER_BONUS_THRESHOLD) & _UPPER_CAT_MASK[None, None, :]
    reward = base[None, :, :] + Y_UPPER_BONUS * crossed

    V_next_2d = np.zeros((_N_UPPER, NUM_DICE_STATES, Y_NUM_CATEGORIES))
    for c in range(Y_NUM_CATEGORIES):
        if not legal[c]:
            continue
        nxt = V_next.get(mask | (1 << c))
        if nxt is not None:
            V_next_2d[:, :, c] = nxt[new_upper[:, :, c]]

    candidate = np.where(legal[None, None, :], reward + V_next_2d, -np.inf)
    dec_C = candidate.argmax(axis=2).astype(np.uint8)            # (64, 252)
    ev_C = np.take_along_axis(candidate, dec_C[:, :, None].astype(np.int64),
                              axis=2)[:, :, 0]

    def stage_keep(ev_in):
        ev_flat = (ev_in @ REROLL_MATRIX.T) / 7776.0             # (64, num_dk)
        dec = np.empty((_N_UPPER, NUM_DICE_STATES), dtype=np.int32)
        ev_out = np.empty((_N_UPPER, NUM_DICE_STATES))
        rows = np.arange(_N_UPPER)
        for d in range(NUM_DICE_STATES):
            seg = ev_flat[:, REROLL_OFFSETS[d]: REROLL_OFFSETS[d + 1]]
            local = seg.argmax(axis=1)
            dec[:, d] = REROLL_OFFSETS[d] + local
            ev_out[:, d] = seg[rows, local]
        return dec, ev_out, ev_flat

    dec_B, ev_B, _ = stage_keep(ev_C)
    dec_A, ev_A, _ = stage_keep(ev_B)
    V = (ev_A @ _FREQS_F) / 7776.0

    return {"V": V, "dec_C": dec_C, "ev_C": ev_C,
            "dec_B": dec_B, "ev_B": ev_B, "dec_A": dec_A, "ev_A": ev_A,
            "reward": reward, "new_upper": new_upper, "legal": legal}


def _eval_functional_for_mask(mask, pol, F_next, terminal_row=None,
                              immediate=None):
    """Evaluate E[functional] under the FIXED optimal policy `pol` for one mask.

    F_next: dict next_mask -> (64,) expected functional value from that state.
    terminal_row: (64,) values used when a next mask is missing from F_next
    (i.e. the game just ended); indexed by the new upper total.
    immediate: optional (252, 12) contribution added when the policy fills
    category c on final roll d (e.g. an indicator for "scored Yacht = 50").
    The upper-bonus functional needs no immediate term: upper is capped at 63
    exactly when the bonus is earned, so terminal upper==63 captures it.
    """
    if terminal_row is None:
        terminal_row = np.zeros(_N_UPPER)

    fC = np.zeros((_N_UPPER, NUM_DICE_STATES))
    dec_C = pol["dec_C"]
    new_upper = pol["new_upper"]
    for c in range(Y_NUM_CATEGORIES):
        sel = dec_C == c
        if not sel.any():
            continue
        nxt = F_next.get(mask | (1 << c))
        nu = new_upper[:, :, c]
        vals = nxt[nu] if nxt is not None else terminal_row[nu]
        if immediate is not None:
            vals = vals + immediate[None, :, c]
        fC[sel] = vals[sel]

    def back_keep(f_in, dec):
        f_flat = (f_in @ REROLL_MATRIX.T) / 7776.0
        return np.take_along_axis(f_flat, dec, axis=1)

    fB = back_keep(fC, pol["dec_B"])
    fA = back_keep(fB, pol["dec_A"])
    return (fA @ _FREQS_F) / 7776.0


def solve(progress=True):
    """Full backward pass. Returns (V_by_mask, P_bonus_by_mask):
    dict mask -> (64,) arrays over upper_total 0..63."""
    from itertools import combinations

    masks_by_level = [[] for _ in range(Y_NUM_CATEGORIES + 1)]
    for m in range(1 << Y_NUM_CATEGORIES):
        masks_by_level[m.bit_count()].append(m)

    full = (1 << Y_NUM_CATEGORIES) - 1
    V = {full: np.zeros(_N_UPPER)}
    terminal_bonus = (np.arange(_N_UPPER) >= Y_UPPER_BONUS_THRESHOLD).astype(np.float64)
    P = {full: terminal_bonus.copy()}

    for level in range(Y_NUM_CATEGORIES - 1, -1, -1):
        if progress:
            print(f"level {level:2d}: {len(masks_by_level[level])} masks", flush=True)
        newV, newP = {}, {}
        for mask in masks_by_level[level]:
            pol = policy_for_mask(mask, V)
            newV[mask] = pol["V"]
            newP[mask] = _eval_functional_for_mask(
                mask, pol, P, terminal_row=terminal_bonus)
        V.update(newV)
        P.update(newP)
    return V, P


def evaluate_functional(V_by_mask, terminal_row=None, immediate=None,
                        progress=False):
    """Backward sweep evaluating E[functional] under the optimal policy implied
    by V_by_mask (policies are recomputed per mask).  Returns dict mask -> (64,).
    See _eval_functional_for_mask for terminal_row / immediate semantics."""
    masks_by_level = [[] for _ in range(Y_NUM_CATEGORIES + 1)]
    for m in range(1 << Y_NUM_CATEGORIES):
        masks_by_level[m.bit_count()].append(m)

    full = (1 << Y_NUM_CATEGORIES) - 1
    if terminal_row is None:
        terminal_row = np.zeros(_N_UPPER)
    F = {full: terminal_row.copy()}
    for level in range(Y_NUM_CATEGORIES - 1, -1, -1):
        if progress:
            print(f"functional level {level:2d}", flush=True)
        newF = {}
        for mask in masks_by_level[level]:
            pol = policy_for_mask(mask, V_by_mask)
            newF[mask] = _eval_functional_for_mask(
                mask, pol, F, terminal_row=terminal_row, immediate=immediate)
        F.update(newF)
    return F


# ── Forward replay helpers (per-state, exact enumeration) ───────────────────

def replay_event_prob(mask, upper, V_next_by_mask, event_scores,
                      forced_keepA_pair=None):
    """P(final roll's `event`) from state (mask, upper) following the
    EV-optimal policy (or a forced stage-A pair index), averaging over the
    initial roll.  `event_scores`: (252,) bool — event holds for that final roll.
    Returns (p_event, ev_score_given_event, p_by_initial_roll dict)."""
    pol = policy_for_mask(mask, V_next_by_mask)
    row = min(upper, Y_UPPER_BONUS_THRESHOLD)

    p0 = _FREQS_F / 7776.0                                        # (252,)
    # stage A keep -> distribution after 1st reroll
    pair_A = pol["dec_A"][row] if forced_keepA_pair is None else forced_keepA_pair
    P_pair = np.zeros(REROLL_MATRIX.shape[0])
    np.add.at(P_pair, pair_A, p0)
    p1 = P_pair @ (REROLL_MATRIX / 7776.0)
    # stage B keep -> final distribution
    P_pair2 = np.zeros(REROLL_MATRIX.shape[0])
    np.add.at(P_pair2, pol["dec_B"][row], p1)
    p2 = P_pair2 @ (REROLL_MATRIX / 7776.0)

    p_event = float(p2[event_scores].sum())
    return p_event, p2


def final_roll_distribution_from_roll(mask, upper, opening_vals,
                                      V_next_by_mask, forced_keepA=None):
    """Final-roll distribution (252,) from a specific opening roll under the
    stored policy; forced_keepA is a 6-tuple count vector or None."""
    from precomputed import dice_values_to_idx, KEEP_IDX, KEEPS_FOR_DICE
    pol = policy_for_mask(mask, V_next_by_mask)
    row = min(upper, Y_UPPER_BONUS_THRESHOLD)
    i0 = dice_values_to_idx(opening_vals)

    if forced_keepA is None:
        pair0 = int(pol["dec_A"][row, i0])
    else:
        ki = KEEP_IDX[tuple(forced_keepA)]
        local = list(KEEPS_FOR_DICE[i0]).index(ki)
        pair0 = int(REROLL_OFFSETS[i0]) + local

    p1 = REROLL_MATRIX[pair0] / 7776.0                            # (252,)
    P_pair = np.zeros(REROLL_MATRIX.shape[0])
    np.add.at(P_pair, pol["dec_B"][row], p1)
    return P_pair @ (REROLL_MATRIX / 7776.0)


def simulate(V_by_mask, n_games, seed=0):
    """Monte-Carlo replay of the optimal policy (independent check of the DP).
    Returns an (n_games,) int array of final totals."""
    rng = np.random.default_rng(seed)
    p_roll = _FREQS_F / 7776.0
    pol_cache = {}

    def pol(mask):
        if mask not in pol_cache:
            pol_cache[mask] = policy_for_mask(mask, V_by_mask)
        return pol_cache[mask]

    totals = np.zeros(n_games, dtype=np.int32)
    for g in range(n_games):
        mask, upper, score = 0, 0, 0
        for _ in range(Y_NUM_CATEGORIES):
            p = pol(mask)
            d0 = rng.choice(NUM_DICE_STATES, p=p_roll)
            d1 = rng.choice(NUM_DICE_STATES, p=REROLL_MATRIX[p["dec_A"][upper, d0]] / 7776.0)
            d2 = rng.choice(NUM_DICE_STATES, p=REROLL_MATRIX[p["dec_B"][upper, d1]] / 7776.0)
            c = int(p["dec_C"][upper, d2])
            pts = int(Y_SCORE_TABLE[d2, c])
            score += pts
            if c <= Y_SIXES:
                if upper < Y_UPPER_BONUS_THRESHOLD and upper + pts >= Y_UPPER_BONUS_THRESHOLD:
                    score += Y_UPPER_BONUS
                upper = min(upper + pts, Y_UPPER_BONUS_THRESHOLD)
            mask |= 1 << c
        totals[g] = score
    return totals


if __name__ == "__main__":
    V, P = solve()
    print(f"\nV(empty)  Yacht Dice whole-game expected score = {V[0][0]:.4f}")
    print(f"P(upper bonus) from empty card under optimal play = {P[0][0]:.4%}")
    print(f"Top-bonus EV (empty card) = {35 * P[0][0]:.2f}")

# Yacht Dice (Clubhouse Games, Switch) vs standard Yahtzee rules

How the "Yacht Dice" game in Nintendo's *Clubhouse Games: 51 Worldwide
Classics* differs from the standard Yahtzee rules this repo's main solver
uses, and what happens to the headline numbers when the solver is re-run
under the Yacht Dice rules.

Code: `yacht_clubhouse.py` (solver — reuses the repo's dice/keep/reroll
machinery, swaps the category tables and state space) and
`yacht_clubhouse_numbers.py` (prints every Yacht-rules number below;
`yahtzee_baseline_numbers.py` prints the standard-rules counterparts). The
solved value/bonus tables are committed at `data/yacht_clubhouse_solution.npz`.

---

## 1. The Clubhouse Games rule set (sourced)

From the in-game guide (as reproduced in the GameFAQs walkthrough) plus
score-cap evidence from leaderboards/speedruns:

- **12 rounds, 12 categories.** 3 rolls per turn (2 rerolls), keep any dice
  between rolls — the turn structure is identical to Yahtzee.
- Categories and scoring:
  | Box | Requirement | Score |
  |---|---|---|
  | Ones … Sixes | — | face × count |
  | Choice | none | **sum of all five dice** |
  | Four-of-a-Kind | 4+ of one face | **sum of all five dice** |
  | Full House | 3 + 2 | **sum of all five dice** |
  | S. Straight | 4 in sequence | **15** |
  | B. Straight | 5 in sequence | **30** |
  | Yacht | 5 of a kind | 50 |
- **Upper bonus: +35 at 63+**, same threshold and amount as Yahtzee.
- **No Yahtzee-style extras**: a second Yacht is worth nothing (no +100
  bonus), and there are no joker rules (with the Yacht box filled, five of a
  kind can NOT stand in for a straight).
- **A Yacht (five of a kind) DOES fill Full House** for the sum of the dice.
  The GameFAQs author computes a 323 max assuming it can't; the actual
  leaderboard/speedrun perfect score is **325** = 105 (upper) + 35 (bonus)
  + 30 (Choice) + 30 (4K) + **30 (FH as five 6s)** + 15 + 30 + 50 — only
  reachable if a Yacht counts. Multiple players hold 325, so the solver allows
  it. (Sensitivity: forbidding it moves optimal EV by just −0.013, from
  191.774 to 191.761, so nothing below hinges on this call.)

Sources: [GameFAQs Yacht Dice guide](https://gamefaqs.gamespot.com/switch/286602-clubhouse-games-51-worldwide-classics/faqs/78437/yacht-dice),
[Cyberscore Yacht Dice leaderboard (top score 325)](https://cyberscore.me.uk/charts/452436),
[325-point perfect-score runs](https://www.speedrun.com/chg51ce/runs/zqgjr41m)
([video](https://www.youtube.com/watch?v=fJwRlyqUOJQ)).

## 2. Rule differences vs standard Yahtzee

| | Standard Yahtzee | Clubhouse Yacht Dice |
|---|---|---|
| Rounds / boxes | 13 | **12** |
| Three-of-a-Kind | sum of all dice | **doesn't exist** |
| Chance / Choice | Chance, sum of dice | same box, renamed Choice |
| Four-of-a-Kind | sum of all dice | same |
| Full House | flat **25** (5-oak counts) | **sum of all dice** (5-oak counts) |
| Small straight | flat **30** | flat **15** |
| Large straight | flat **40** | flat **30** |
| Yahtzee / Yacht | 50 | 50 |
| Extra five-of-a-kinds | **+100 each** | nothing |
| Joker rule | yes (5-oak fills straights/FH at full value) | **none** |
| Upper bonus | 63 → +35 | same |
| Max score | 1575 | **325** |

Everything about the dice themselves (252 distinct rolls, 462 keeps, reroll
outcome distributions) is unchanged, so the raw dice combinatorics
(6⁵ = 7776 ordered rolls, 252 outcomes, 1/1296 five-of-a-kind in one roll,
etc.) apply to both games verbatim.

## 3. Method + validation

`yacht_clubhouse.py` runs the same backward induction as `value_iteration.py`
over the smaller state space (12-bit mask × upper 0..63; no yahtzee-eligible
bit since there's no joker/bonus), importing the dice tables from
`precomputed`/`value_iteration`. A second fixed-policy sweep evaluates
functionals under the optimal policy (P(upper bonus), P(score the Yacht 50)).
Checks:

- Single-open-box states with identical scoring reproduce the standard-rules
  numbers exactly (Ones mean count 2.1065, 4-Kind 27.74% / EV 5.611, Yacht
  4.60%, Choice 23.333 — matching `yahtzee_baseline_numbers.py`).
- 100k-game Monte Carlo replay of the solved policy: mean 191.64 ± 0.12 vs
  DP 191.77; P(bonus) 69.2% vs 69.0%. (20k-game run with a different seed:
  191.91 ± 0.27.)

## 4. The numbers, standard rules vs Yacht Dice

### Headline

| | Yahtzee (13 turns) | Yacht Dice (12 turns) |
|---|---|---|
| Optimal expected score V(empty) | **254.59** | **191.77** |
| … per turn | 19.6 | 16.0 |
| P(upper bonus), optimal play | 68.12% | **69.02%** |
| Turn-0 top-bonus EV | 23.84 | 24.16 |
| P(score the 50-pt five-of-a-kind) | 33.74% | **28.34%** |
| Final-score sd | 59.6 | ≈37.9 (MC) |
| Final-score median | 248 | ≈193 (MC) |
| q05 / q95 | 180 / 388 | ≈128 / ≈259 (MC) |

"Par" for optimal play drops from 254.6 to **191.8** — scores are ~25% lower
and much tighter (no 100-point Yahtzee-bonus right tail: sd drops by a third,
and the q95 falls from +133 above the median to +66).

### Top bonus

The bonus *strengthens* slightly: despite one fewer turn, optimal play gets
the bonus a touch MORE often (69.0% vs 68.1%, turn-0 bonus EV 24.16 vs
23.84), because the Yacht lower section is worth so much less that the upper
section (and its 35) carries more of the game. The "what one upper fill does
to your bonus outlook" table keeps its exact shape; blanking an upper box
early now hurts *more* (0-fill of Threes on turn 1: bonus EV 2.80 vs 4.34
under Yahtzee rules; three-of-the-number fills stay near ~24 in both):

Yacht Dice values (35 × P(bonus) after a turn-1 fill of `count` dice of
`number`; standard-rules table in `yahtzee_baseline_numbers.py`):

```
count |       1       2       3       4       5       6
------------------------------------------------------------
    0 |   16.50    9.06    2.80    0.50    0.07    0.00
    1 |   19.11   14.41    8.80    3.84    1.17    0.19
    2 |   21.06   19.25   16.68   13.36    9.68    5.53
    3 |   24.19   24.10   24.07   23.82   23.59   23.05
    4 |   25.38   28.02   29.39   30.34   31.15   31.91
    5 |   27.29   29.75   31.19   32.37   33.35   34.07
```

### Ranking of optimal first-turn outcomes

Same overall picture at the top (Yacht 50 → big upper fills), but the middle
reshuffles substantially (40 distinct outcomes now vs 32, because sum-scored
Full Houses fan out into per-sum rows):

| Change | Yahtzee rules | Yacht Dice rules |
|---|---|---|
| Best outcome | Yahtzee 50, exp. 320.83 (+66 over par) | Yacht 50, exp. 225.36 (+34 over par) |
| Large/Big straight | rank 3 of 32 (exp. 261.53) | **rank 7** of 40 (exp. 197.85) |
| Full House | one flat-25 row, rank 7 | **sum-scored rows occupy ranks 4–6, 9–17** (FH 28 outranks the straight) |
| Small straight | rank 18, comfortably above Chance | **rank 27**, barely above Choice-26 |
| 3-Kind rows (ranks 6, 9–11) | present | gone (box doesn't exist) |
| Worst optimal outcome | Chance 19 (exp. 238.96, −15.6) | Choice 19 (exp. 177.65, −14.1) |

Under Yahtzee rules a first-roll large straight is the 4th-best thing that
can happen to you; in Yacht Dice a 28-point Full House beats the 30-point
B. Straight, and the S. Straight (15) drops from "solid outcome" to near the
bottom, next to the dump-box rows.

### Committing 12 points on turn 1

Same qualitative escalation (four 3s great … two 6s terrible), and the deltas
move in Yacht's favor for the good cases:

| Placement of 12 | Yahtzee: Δ vs 254.59 | Yacht: Δ vs 191.77 |
|---|---|---|
| Threes (four 3s) | +2.81 | **+5.25** |
| 4-Kind (sum 12) | −7.05 | **−3.77** |
| 3-Kind (sum 12) | −16.63 | (box doesn't exist) |
| Chance / Choice (sum 12) | −22.63 | −21.12 |
| Sixes (two 6s) | −22.39 | −21.62 |

The four-3s play is *more* clearly right under Yacht rules (bigger bonus
leverage), and burning 4-Kind on 12 stings less (its replacement value is
lower without the 3-Kind/joker ecosystem around it). Either way, 12 in the
Threes beats 12 in the Sixes by ~25 points of expectation (25.2 vs 26.9).

### Each box alone on the last turn

Upper boxes, Choice/Chance, 4-Kind and Yacht/Yahtzee are *identical* (same
scoring, same dice). The boxes whose rules changed:

| Box | Yahtzee: P / EV | Yacht: P / EV | Why |
|---|---|---|---|
| Small straight | 61.60% / 18.48 | 61.54% / **9.23** | 15 pts instead of 30; joker gone |
| Large/B. straight | 26.53% / 10.61 | 26.11% / **7.83** | 30 instead of 40; joker gone |
| Full House | 36.61% / 9.15 | **35.04% / 7.01** | sum-scored: avg ~20 when made (vs flat 25), and optimal play trades ~1.6% success for fatter sums |
| Three-of-a-Kind | 71.24% / 15.20 | — | box doesn't exist |

The straight success-probability drops (61.60→61.54, 26.53→26.11) are purely
the loss of the joker rule: under Yahtzee rules a rolled five-of-a-kind counts
as a straight once the Yahtzee box is filled; in Yacht Dice it's a miss.
The "keep three 1s vs keep two 6s" Four-of-a-Kind comparison (51.8% vs 22.8%
success; keeping the pair of 6s still wins on EV) carries over exactly —
4-Kind scoring is unchanged.

### First-roll keeps (empty card)

Spot-checked stage-A decisions transfer unchanged for ordinary rolls —
`12346→keep 1234`, `23345→keep 2345`, `11223→keep 22`, `33356→keep 333`,
`12345→keep all` are optimal under both rule sets. The differences live in
the category *placements* and in valuations, not in everyday keep intuition.

## 5. Conclusions that survive vs shift

**Survive:**
- All pure dice combinatorics — identical game mechanics.
- The upper-bonus strategy story: if anything stronger — 69% bonus rate, and
  early upper blanks are costlier.
- The "where you park 12 points" escalation and rough magnitudes.
- Everyday keep decisions (first-roll keeps spot-checked identical).
- Chance/Choice ≈ 23.3 as the last-turn dump-box yardstick.

**Shift:**
- Par drops from **254.6 to 191.8** (and per-turn 19.6 → 16.0); scores are
  much tighter (sd ~38 vs ~60) with no Yahtzee-bonus right tail.
- Straights are demoted: half-value S. Straight falls from "solid mid-tier
  outcome" to near the dump rows; B. Straight is outranked by a good sum-scored
  Full House.
- Full House becomes a sum-maximizing box (chase 66655, not any 3+2).
- Everything about Yahtzee bonuses/jokers (100-point bonus chains, joker
  straights) simply has no counterpart.
- Three-of-a-Kind (71% last-turn success, its first-turn outcome rows) has no
  counterpart either.

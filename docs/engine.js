/* Yacht Dice (Clubhouse Games rules) — client-side optimal-play engine.
 *
 * The only data dependency is v_table.bin: V(mask, upper) = expected remaining
 * score under optimal play, for every 12-bit filled-category mask and capped
 * upper total 0..63 (uint16 LE, value*100, mask-major; exported by
 * math/export_yacht_solver_data.py). All dice combinatorics (252 multisets,
 * sub-multiset keeps, reroll outcome distributions) are rebuilt here at
 * startup, and per-turn decisions are computed exactly:
 *
 *   stage C (no rerolls):  argmax over open boxes of pts + bonus + V(next)
 *   stage B (1 reroll):    argmax over keeps of E[stage C of final roll]
 *   stage A (2 rerolls):   argmax over keeps of E[stage B value of next roll]
 *
 * Categories (bit order matches the solver): 0-5 Ones..Sixes, 6 Choice,
 * 7 4-of-a-Kind (sum of all dice), 8 Full House (sum; five-of-a-kind counts),
 * 9 S.Straight 15, 10 B.Straight 30, 11 Yacht 50.  Upper bonus +35 at 63.
 */
"use strict";

const NUM_CATEGORIES = 12;
const CATEGORY_NAMES = [
  "Ones", "Twos", "Threes", "Fours", "Fives", "Sixes",
  "Choice", "4 of a Kind", "Full House", "S. Straight", "B. Straight", "Yacht",
];
const UPPER_BONUS = 35;
const UPPER_BONUS_THRESHOLD = 63;
const FULL_MASK = (1 << NUM_CATEGORIES) - 1;

// ── Dice multiset enumeration ───────────────────────────────────────────────
// All count-vectors [c1..c6] summing to `total`, in lexicographic order.
function enumerateMultisets(total) {
  const out = [];
  const rec = (face, left, acc) => {
    if (face === 5) { out.push([...acc, left]); return; }
    for (let k = 0; k <= left; k++) { acc.push(k); rec(face + 1, left - k, acc); acc.pop(); }
  };
  rec(0, total, []);
  return out;
}

const DICE_STATES = enumerateMultisets(5);           // 252 count-vectors
const NUM_DICE_STATES = DICE_STATES.length;
const DICE_KEY = (vec) => vec.join(",");
const DICE_IDX = new Map(DICE_STATES.map((v, i) => [DICE_KEY(v), i]));

const FACTORIAL = [1, 1, 2, 6, 24, 120];
function orderedCount(vec) {                          // multinomial weight
  let n = 0, denom = 1;
  for (const c of vec) { n += c; denom *= FACTORIAL[c]; }
  return FACTORIAL[n] / denom;
}

const DICE_FREQ = DICE_STATES.map(orderedCount);      // sums to 7776

// ── Scoring table (252 x 12) ────────────────────────────────────────────────
function scoreRow(vec) {
  let sum = 0, max = 0;
  for (let f = 0; f < 6; f++) { sum += (f + 1) * vec[f]; max = Math.max(max, vec[f]); }
  const has = (n) => vec.includes(n);
  const run = (s, len) => { for (let i = s; i < s + len; i++) if (vec[i] < 1) return false; return true; };
  const row = [];
  for (let f = 0; f < 6; f++) row.push((f + 1) * vec[f]);
  row.push(sum);                                                    // Choice
  row.push(max >= 4 ? sum : 0);                                     // 4K
  row.push(((has(3) && has(2)) || max === 5) ? sum : 0);            // Full House
  row.push((run(0, 4) || run(1, 4) || run(2, 4)) ? 15 : 0);         // S.Straight
  row.push((run(0, 5) || run(1, 5)) ? 30 : 0);                      // B.Straight
  row.push(max === 5 ? 50 : 0);                                     // Yacht
  return row;
}
const SCORES = DICE_STATES.map(scoreRow);

// ── Keeps and reroll-outcome distributions ──────────────────────────────────
// ADDS[r]: multisets of r rolled dice with P = orderedCount / 6^r.
const ADDS = [];
for (let r = 0; r <= 5; r++) {
  const denom = Math.pow(6, r);
  ADDS.push(enumerateMultisets(r).map((v) => ({ vec: v, p: orderedCount(v) / denom })));
}

// KEEPS: every sub-multiset that occurs, with its outcome distribution
// (list of [finalDiceIdx, prob]); KEEPS_FOR_DICE[d]: keep ids valid from d.
const KEEP_IDX = new Map();
const KEEPS = [];                                     // {vec, n, outcomes}
function keepIdFor(vec) {
  const key = DICE_KEY(vec);
  let id = KEEP_IDX.get(key);
  if (id !== undefined) return id;
  id = KEEPS.length;
  KEEP_IDX.set(key, id);
  const n = vec.reduce((a, b) => a + b, 0);
  const outcomes = ADDS[5 - n].map(({ vec: add, p }) => {
    const fin = vec.map((c, f) => c + add[f]);
    return [DICE_IDX.get(DICE_KEY(fin)), p];
  });
  KEEPS.push({ vec: [...vec], n, outcomes });
  return id;
}

const KEEPS_FOR_DICE = DICE_STATES.map((dice) => {
  const ids = [];
  const rec = (face, acc) => {
    if (face === 6) { ids.push(keepIdFor(acc)); return; }
    for (let k = 0; k <= dice[face]; k++) { acc.push(k); rec(face + 1, acc); acc.pop(); }
  };
  rec(0, []);
  return ids;
});

// ── Value table ─────────────────────────────────────────────────────────────
let VTABLE = null;                                    // Uint16Array(4096 * 64)

function loadValueTable(arrayBuffer) {
  const arr = new Uint16Array(arrayBuffer);
  if (arr.length !== (1 << NUM_CATEGORIES) * 64) {
    throw new Error(`v_table.bin: expected ${(1 << NUM_CATEGORIES) * 64} entries, got ${arr.length}`);
  }
  VTABLE = arr;
}

function V(mask, upper) {
  return VTABLE[mask * 64 + upper] / 100;
}

// ── Decisions ───────────────────────────────────────────────────────────────
function diceValuesToIdx(values) {                    // e.g. [1,3,3,4,6]
  const vec = [0, 0, 0, 0, 0, 0];
  for (const v of values) vec[v - 1]++;
  return DICE_IDX.get(DICE_KEY(vec));
}

function idxToValues(idx) {
  const out = [];
  DICE_STATES[idx].forEach((c, f) => { for (let i = 0; i < c; i++) out.push(f + 1); });
  return out;
}

// Ranked open-box choices for a final roll.
function rankCategories(mask, upper, diceIdx) {
  const rows = [];
  for (let c = 0; c < NUM_CATEGORIES; c++) {
    if (mask & (1 << c)) continue;
    const pts = SCORES[diceIdx][c];
    let reward = pts, newUpper = upper, crossed = false;
    if (c < 6) {
      newUpper = Math.min(upper + pts, UPPER_BONUS_THRESHOLD);
      if (upper < UPPER_BONUS_THRESHOLD && newUpper === UPPER_BONUS_THRESHOLD) {
        reward += UPPER_BONUS;
        crossed = true;
      }
    }
    rows.push({ cat: c, name: CATEGORY_NAMES[c], pts, crossed,
                ev: reward + V(mask | (1 << c), newUpper) });
  }
  rows.sort((a, b) => b.ev - a.ev);
  return rows;
}

// E[best final choice] for every possible final roll.
function evCAll(mask, upper) {
  const out = new Float64Array(NUM_DICE_STATES);
  for (let d = 0; d < NUM_DICE_STATES; d++) out[d] = rankCategories(mask, upper, d)[0].ev;
  return out;
}

// For every roll, the value of getting to keep-then-reroll against evNext.
function evKeepStage(evNext) {
  const out = new Float64Array(NUM_DICE_STATES);
  for (let d = 0; d < NUM_DICE_STATES; d++) {
    let best = -Infinity;
    for (const kid of KEEPS_FOR_DICE[d]) {
      let ev = 0;
      for (const [f, p] of KEEPS[kid].outcomes) ev += p * evNext[f];
      if (ev > best) best = ev;
    }
    out[d] = best;
  }
  return out;
}

// Ranked keeps of `diceIdx` against evNext (value-of-final-roll vector).
function rankKeeps(diceIdx, evNext) {
  const rows = [];
  for (const kid of KEEPS_FOR_DICE[diceIdx]) {
    const k = KEEPS[kid];
    let ev = 0;
    for (const [f, p] of k.outcomes) ev += p * evNext[f];
    const vals = [];
    k.vec.forEach((c, f) => { for (let i = 0; i < c; i++) vals.push(f + 1); });
    rows.push({ keepVec: k.vec, keepValues: vals, nKept: k.n, ev });
  }
  rows.sort((a, b) => b.ev - a.ev);
  return rows;
}

/* Main entry.
 * state: { mask, upper, dice: [5 face values], rerollsLeft: 0|1|2 }
 * Returns { kind: "score"|"keep", best, alternatives, evNow }
 *   kind "score": best = {cat, name, pts, ev, crossed}; alternatives = ranked boxes
 *   kind "keep":  best = {keepValues, nKept, ev}; alternatives = ranked keeps;
 *                 best.thenScore = box ranking if the best keep is all five.
 */
function advise(state) {
  const { mask, upper, rerollsLeft } = state;
  const diceIdx = diceValuesToIdx(state.dice);
  const cats = rankCategories(mask, upper, diceIdx);

  if (rerollsLeft === 0 || KEEPS_FOR_DICE[diceIdx].length === 0) {
    return { kind: "score", best: cats[0], alternatives: cats, diceIdx };
  }

  let evNext = evCAll(mask, upper);
  if (rerollsLeft === 2) evNext = evKeepStage(evNext);
  const keeps = rankKeeps(diceIdx, evNext);
  const best = keeps[0];
  if (best.nKept === 5) best.thenScore = cats[0];
  return { kind: "keep", best, alternatives: keeps, boxRanking: cats, diceIdx };
}

// Expected remaining score before rolling (turn start).
function stateValue(mask, upper) {
  return V(mask, Math.min(upper, UPPER_BONUS_THRESHOLD));
}

const YachtEngine = {
  NUM_CATEGORIES, CATEGORY_NAMES, UPPER_BONUS, UPPER_BONUS_THRESHOLD, FULL_MASK,
  DICE_STATES, NUM_DICE_STATES, SCORES, DICE_FREQ,
  loadValueTable, V, stateValue,
  diceValuesToIdx, idxToValues, rankCategories, evCAll, evKeepStage,
  rankKeeps, advise,
};

if (typeof module !== "undefined" && module.exports) module.exports = YachtEngine;
if (typeof window !== "undefined") window.YachtEngine = YachtEngine;

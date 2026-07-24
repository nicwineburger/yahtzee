// Engine property tests — invariants beyond the Python-fixture regression in
// docs/engine_test.mjs. No browser needed.
//
// Run:  node tests/engine-extra.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const E = require(join(here, "..", "docs", "engine.js"));

const buf = readFileSync(join(here, "..", "docs", "v_table.bin"));
E.loadValueTable(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

let failures = 0;
const check = (label, cond) => {
  if (!cond) { failures++; console.error("FAIL", label); }
};

// ── Scoring table vs an independent reimplementation, all 252 states ────────
function refScore(vec, cat) {
  const sum = vec.reduce((a, c, f) => a + c * (f + 1), 0);
  const max = Math.max(...vec);
  if (cat < 6) return (cat + 1) * vec[cat];
  if (cat === 6) return sum;                                     // Choice
  if (cat === 7) return max >= 4 ? sum : 0;                      // 4K
  if (cat === 8) return (vec.includes(3) && vec.includes(2)) || max === 5 ? sum : 0;
  const runs = [];
  let run = 0;
  for (let f = 0; f < 6; f++) { run = vec[f] >= 1 ? run + 1 : 0; runs.push(run); }
  if (cat === 9) return Math.max(...runs) >= 4 ? 15 : 0;         // S.Straight
  if (cat === 10) return Math.max(...runs) >= 5 ? 30 : 0;        // B.Straight
  return max === 5 ? 50 : 0;                                     // Yacht
}
let scoreMismatches = 0;
for (let d = 0; d < E.NUM_DICE_STATES; d++) {
  for (let c = 0; c < 12; c++) {
    if (E.SCORES[d][c] !== refScore(E.DICE_STATES[d], c)) scoreMismatches++;
  }
}
check(`scoring table matches reference (${scoreMismatches} mismatches)`, scoreMismatches === 0);

// ── Keep enumeration and reroll-outcome probabilities ───────────────────────
// #keeps of a multiset = prod(count+1); with EV(final)=1 everywhere, every
// keep's expected value must be exactly 1 (outcome probabilities sum to 1).
const ones = new Float64Array(E.NUM_DICE_STATES).fill(1);
let keepCountBad = 0, probBad = 0;
for (let d = 0; d < E.NUM_DICE_STATES; d += 7) {   // every 7th state: 36 states
  const keeps = E.rankKeeps(d, ones);
  const expected = E.DICE_STATES[d].reduce((a, c) => a * (c + 1), 1);
  if (keeps.length !== expected) keepCountBad++;
  for (const k of keeps) if (Math.abs(k.ev - 1) > 1e-12) probBad++;
}
check("keep counts = prod(face count + 1)", keepCountBad === 0);
check("reroll outcome probabilities sum to 1 for every keep", probBad === 0);

// ── Value-function sanity ───────────────────────────────────────────────────
check("V(terminal) = 0", E.stateValue(E.FULL_MASK, 63) === 0);
check("V(empty) = 191.77 (quantized)", Math.abs(E.stateValue(0, 0) - 191.7744) < 0.006);

// Keeping all five is always available, so a keep stage can never lose value.
const evC = E.evCAll(0, 0);
const evB = E.evKeepStage(evC);
let dominated = 0;
for (let d = 0; d < E.NUM_DICE_STATES; d++) if (evB[d] < evC[d] - 1e-9) dominated++;
check("evB >= evC pointwise (keep-all dominance)", dominated === 0);

// ── Category rules through rankCategories ───────────────────────────────────
const yacht66666 = E.diceValuesToIdx([6, 6, 6, 6, 6]);

// Only Sixes open, upper=60: scoring five 6s banks 30 and crosses the bonus.
const sixesOnly = E.FULL_MASK & ~(1 << 5);
const rows = E.rankCategories(sixesOnly, 60, yacht66666);
check("single open box -> single option", rows.length === 1);
check("bonus crossing adds 35 (30 + 35 + V(terminal))",
  rows[0].crossed === true && Math.abs(rows[0].ev - 65) < 1e-9);

// No joker rule: with the Yacht box filled, five 6s do NOT fill a straight,
// but DO fill Full House for the sum.
const yachtFilled = 1 << 11;
const jr = E.rankCategories(yachtFilled, 0, yacht66666);
const by = Object.fromEntries(jr.map((r) => [r.name, r.pts]));
check("no joker: S. Straight scores 0 on a yacht", by["S. Straight"] === 0);
check("no joker: B. Straight scores 0 on a yacht", by["B. Straight"] === 0);
check("five-of-a-kind counts as Full House (sum)", by["Full House"] === 30);

// ── advise() shape invariants ───────────────────────────────────────────────
const s0 = E.advise({ mask: 0, upper: 0, dice: [2, 3, 4, 6, 6], rerollsLeft: 0 });
check("rerollsLeft 0 -> score advice", s0.kind === "score");
check("score advice ranks all 12 open boxes", s0.alternatives.length === 12);
const s2 = E.advise({ mask: 0, upper: 0, dice: [2, 3, 4, 6, 6], rerollsLeft: 2 });
check("rerollsLeft 2 -> keep advice on a mixed roll", s2.kind === "keep");
check("keep advice EV >= score-now EV", s2.best.ev >= s0.best.ev - 1e-9);
const s12345 = E.advise({ mask: 0, upper: 0, dice: [1, 2, 3, 4, 5], rerollsLeft: 2 });
check("made B.Straight -> stand pat and score it",
  s12345.best.nKept === 5 && s12345.best.thenScore.name === "B. Straight");

if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log("OK — engine property tests passed");

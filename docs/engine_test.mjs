// Validates engine.js against fixtures dumped from the Python solver
// (docs/test_fixtures.json, written by math/export_yacht_solver_data.py —
// EVs and best actions for 14 (state, roll) cases at all three stages, plus
// V-table spot checks).
//
// Run:  node docs/engine_test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const E = require(join(here, "engine.js"));

const buf = readFileSync(join(here, "v_table.bin"));
E.loadValueTable(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const fx = JSON.parse(readFileSync(join(here, "test_fixtures.json"), "utf8"));

const TOL = 0.03; // uint16 quantization (0.005/entry) accumulated over a stage
let failures = 0;
const check = (label, got, want, tol = TOL) => {
  if (Math.abs(got - want) > tol) {
    console.error(`FAIL ${label}: got ${got}, want ${want}`);
    failures++;
  }
};

for (const s of fx.v_states) check(`V(${s.mask},${s.upper})`, E.V(s.mask, s.upper), s.v, 0.006);

for (const c of fx.cases) {
  const label = `mask=${c.mask} upper=${c.upper} dice=${c.dice.join("")}`;
  const evC = E.advise({ mask: c.mask, upper: c.upper, dice: c.dice, rerollsLeft: 0 });
  check(`${label} evC`, evC.best.ev, c.evC);

  const evB = E.advise({ mask: c.mask, upper: c.upper, dice: c.dice, rerollsLeft: 1 });
  check(`${label} evB`, evB.best.ev, c.evB);

  const evA = E.advise({ mask: c.mask, upper: c.upper, dice: c.dice, rerollsLeft: 2 });
  check(`${label} evA`, evA.best.ev, c.evA);

  // Best actions must match unless the top alternatives tie within tolerance.
  if (evC.best.cat !== c.bestCatC && evC.alternatives.length > 1
      && evC.alternatives[0].ev - evC.alternatives[1].ev > 2 * TOL) {
    console.error(`FAIL ${label}: best cat ${evC.best.cat}, want ${c.bestCatC}`);
    failures++;
  }
  for (const [adv, want, stage] of [[evB, c.bestKeepB, "B"], [evA, c.bestKeepA, "A"]]) {
    const got = adv.best.keepValues.join(",");
    if (got !== want.join(",") && adv.alternatives.length > 1
        && adv.alternatives[0].ev - adv.alternatives[1].ev > 2 * TOL) {
      console.error(`FAIL ${label} stage ${stage}: best keep [${got}], want [${want}]`);
      failures++;
    }
  }
}

// Structural sanity.
check("num dice states", E.NUM_DICE_STATES, 252, 0);
check("freq sum", E.DICE_FREQ.reduce((a, b) => a + b, 0), 7776, 0);
check("V(empty)", E.V(0, 0), fx.v_empty, 0.006);

if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log(`OK — ${fx.cases.length} cases x 3 stages + V spot checks all match Python solver`);

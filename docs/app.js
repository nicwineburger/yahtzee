/* Yacht Dice Solver — UI. Two modes sharing the engine:
 *   advisor — enter a real game's state by hand, get optimal advice.
 *   play    — the app rolls the dice and runs a full game (1-4 players,
 *             pass-and-play), with the advisor available as an overlay.
 * All math lives in engine.js. */
"use strict";

const E = window.YachtEngine;
const $ = (id) => document.getElementById(id);

const STORAGE_KEY = "yacht-solver-v1";
const PLAY_KEY = "yacht-solver-play-v1";
const MODE_KEY = "yacht-solver-mode";

let mode = "advisor";                 // "advisor" | "play"

const state = {
  upperScores: Array(6).fill(null),   // null = open, else banked score (count*face)
  lowerFilled: Array(6).fill(false),  // categories 6..11
  dice: [],                           // entered faces, up to 5
  roll: 1,                            // 1 | 2 | 3
  history: {},                        // boxes-filled count -> expected points left
  ready: false,
};

const PLAYER_COLORS = ["#4f7ec2", "#e0885a", "#3fa877", "#b07fd6"];

const play = {
  players: [],                        // {name, boxes: (number|null)[12], history:{}}
  current: 0,
  dice: [],                           // 5 faces once rolled this turn
  held: Array(5).fill(false),
  rollsUsed: 0,                       // 0..3
  adviceOn: false,
  over: false,
  animating: false,                   // transient: dice are mid-tumble
  rollingIdx: [],                     // which dice are tumbling
  pick: null,                         // transient: pending box choice at score stage
};

const ANIM_KEY = "yacht-solver-anim";
const ANIM_DURATION = { slow: 1400, normal: 800, fast: 400 };
const anim = {
  // Default off for users who ask the OS for reduced motion.
  on: !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches),
  speed: "normal",
};
let animTimer = null;

// ── Derived (advisor) ───────────────────────────────────────────────────────
const mask = () => {
  let m = 0;
  state.upperScores.forEach((s, i) => { if (s !== null) m |= 1 << i; });
  state.lowerFilled.forEach((f, i) => { if (f) m |= 1 << (6 + i); });
  return m;
};
const upperTotal = () => state.upperScores.reduce((a, b) => a + (b || 0), 0);
const cappedUpper = () => Math.min(upperTotal(), E.UPPER_BONUS_THRESHOLD);

// ── Derived (play) ──────────────────────────────────────────────────────────
const pMask = (p) => {
  let m = 0;
  p.boxes.forEach((b, c) => { if (b !== null) m |= 1 << c; });
  return m;
};
const pUpper = (p) => p.boxes.slice(0, 6).reduce((a, b) => a + (b || 0), 0);
const pCappedUpper = (p) => Math.min(pUpper(p), E.UPPER_BONUS_THRESHOLD);
const pTotal = (p) =>
  p.boxes.reduce((a, b) => a + (b || 0), 0) +
  (pUpper(p) >= E.UPPER_BONUS_THRESHOLD ? E.UPPER_BONUS : 0);
const pFilled = (p) => p.boxes.filter((b) => b !== null).length;

// ── Dice SVG ────────────────────────────────────────────────────────────────
const PIPS = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  6: [[0, 0], [0, 1], [0, 2], [2, 0], [2, 1], [2, 2]],
};
function dieSVG(face, size = 24, framed = false) {
  const dots = PIPS[face]
    .map(([x, y]) => `<circle class="pip" cx="${27 + x * 23}" cy="${27 + y * 23}" r="8.5"/>`)
    .join("");
  // Small standalone dice (alternative keeps, box-score picker) get an
  // explicit outline so they read as dice against any background.
  const frame = framed
    ? `<rect class="die-frame" x="5" y="5" width="90" height="90" rx="22"/>` : "";
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" aria-label="${face}">${frame}${dots}</svg>`;
}

// ── Rendering ───────────────────────────────────────────────────────────────
// The advice card lives at the top in advisor mode, but in play mode it sits
// between the round card and the scorecard, right under the advice toggle.
function placeAdviceCard() {
  const advice = $("advice");
  if (mode === "play") {
    const target = $("playScoreSection");
    if (advice.nextElementSibling !== target || advice.parentElement !== target.parentElement) {
      target.parentElement.insertBefore(advice, target);
    }
  } else {
    const view = $("advisorView");
    if (advice.nextElementSibling !== view || advice.parentElement !== view.parentElement) {
      view.parentElement.insertBefore(advice, view);
    }
  }
}

function render() {
  document.querySelectorAll("#modeSeg button").forEach((b) => {
    b.classList.toggle("on", b.dataset.mode === mode);
  });
  $("advisorView").hidden = mode !== "advisor";
  $("playView").hidden = mode !== "play";
  placeAdviceCard();
  if (mode === "advisor") {
    $("advice").hidden = false;
    renderDice();
    renderBoard();
    renderAdvice();
  } else {
    renderPlay();
  }
  save();
}

function renderDice() {
  const row = $("diceRow");
  row.innerHTML = "";
  for (let i = 0; i < 5; i++) {
    if (i < state.dice.length) {
      const b = document.createElement("button");
      b.className = "die";
      b.innerHTML = dieSVG(state.dice[i], 52);
      b.setAttribute("aria-label", `Die ${state.dice[i]}, tap to remove`);
      b.onclick = () => { state.dice.splice(i, 1); render(); };
      row.appendChild(b);
    } else {
      const d = document.createElement("div");
      d.className = "die-slot";
      row.appendChild(d);
    }
  }
  document.querySelectorAll("#rollSeg button").forEach((b) => {
    b.classList.toggle("on", Number(b.dataset.roll) === state.roll);
  });
}

function renderBoard() {
  const up = $("upperCol"), lo = $("lowerCol");
  up.innerHTML = ""; lo.innerHTML = "";
  for (let c = 0; c < 6; c++) {
    const s = state.upperScores[c];
    const b = document.createElement("button");
    b.className = "box" + (s !== null ? " filled" : "");
    b.innerHTML = `<span class="name">${E.CATEGORY_NAMES[c]}</span>` +
                  `<span class="val">${s === null ? "–" : s}</span>`;
    b.onclick = () => openUpperSheet(c);
    up.appendChild(b);
  }
  for (let c = 6; c < 12; c++) {
    const f = state.lowerFilled[c - 6];
    const b = document.createElement("button");
    b.className = "box" + (f ? " filled" : "");
    b.innerHTML = `<span class="name">${E.CATEGORY_NAMES[c]}</span>` +
                  `<span class="val">${f ? "✓" : "–"}</span>`;
    b.onclick = () => { state.lowerFilled[c - 6] = !f; render(); };
    lo.appendChild(b);
  }
  const ut = upperTotal();
  $("bonusLine").innerHTML = bonusLineHTML(ut);
}

function bonusLineHTML(ut) {
  if (ut >= E.UPPER_BONUS_THRESHOLD) {
    return `Upper total <b>${ut}</b> · <span class="earned">+35 bonus earned</span>`;
  }
  return `Upper total <b>${ut}</b> / 63 · ${63 - ut} more for the +35 bonus`;
}

function fmt(x, digits = 1) { return x.toFixed(digits); }

function diceKeptFlags(keepVec, dice) {
  const left = [...keepVec];
  return dice.map((f) => (left[f - 1] > 0 ? (left[f - 1]--, true) : false));
}

function adviceDiceHTML(keepVec, dice) {
  const kept = diceKeptFlags(keepVec, dice);
  return `<div class="advice-dice">` + dice.map((f, i) =>
    `<span class="die ${kept[i] ? "kept" : "dim"}" style="pointer-events:none">${dieSVG(f, 46)}</span>`
  ).join("") + `</div>`;
}

function miniDiceHTML(values) {
  if (!values.length) return `<span class="what">keep nothing</span>`;
  return `<span class="mini-dice">` + values.map((f) => `<span>${dieSVG(f, 18, true)}</span>`).join("") + `</span>`;
}

function countBits(m) {
  let n = 0;
  for (let c = 0; c < 12; c++) if (m & (1 << c)) n++;
  return n;
}

function recordHistory(m, u) {
  const filled = countBits(m);
  state.history[filled] = E.stateValue(m, u);
  // A manual card edit can reduce the filled count — drop stale later turns.
  for (const k of Object.keys(state.history)) {
    if (Number(k) > filled) delete state.history[k];
  }
}

// Shared advice-card builders (handlers differ per mode).
function scoreAdviceHTML(best, alts, stay, opts = {}) {
  const buttonLabel = opts.buttonLabel
    || (stay === "Score" ? "Apply &amp; next turn" : "Score it");
  const altSummary = opts.altAction === "pick"
    ? "Other options — tap to pick instead" : "Other options — tap to score instead";
  return `
    <div class="advice-main">
      <p class="advice-title">${stay} <u>${best.name}</u> for
        <span class="pts">${best.pts} pts</span>${best.crossed ? " · locks the +35 bonus" : ""}</p>
      ${opts.chipHTML || ""}
      <p class="advice-sub">Expected final haul from here: ${fmt(best.ev)} pts</p>
      <button class="apply-btn" id="adviceApplyBtn">${buttonLabel}</button>
      ${alts.length ? `<details class="more"><summary>${altSummary}</summary>
        <ul class="alts">${alts.map((a, i) =>
          `<li><button class="alt-btn" data-alt="${i}">
             <span class="what">${a.name} · ${a.pts} pts</span>
             <span class="delta">−${fmt(best.ev - a.ev)}</span></button></li>`).join("")}
        </ul></details>` : ""}
    </div>`;
}

function keepAdviceHTML(best, alts, dice, applyLabel, chipHTML = "") {
  const n = best.nKept;
  const title = n === 0
    ? "Reroll everything"
    : `Keep ${best.keepValues.join(" · ")} — reroll ${5 - n} ${5 - n === 1 ? "die" : "dice"}`;
  return `
    <div class="advice-main">
      <p class="advice-title">${title}</p>
      ${chipHTML}
      ${adviceDiceHTML(best.keepVec, dice)}
      <p class="advice-sub">Expected final haul from here: ${fmt(best.ev)} pts</p>
      ${applyLabel ? `<button class="apply-btn" id="adviceApplyBtn">${applyLabel}</button>` : ""}
      ${alts.length ? `<details class="more"><summary>Other keeps — tap to keep instead</summary>
        <ul class="alts">${alts.map((a, i) =>
          `<li><button class="alt-btn" data-alt="${i}">
             <span class="what">${miniDiceHTML(a.keepValues)}</span>
             <span class="delta">−${fmt(best.ev - a.ev)}</span></button></li>`).join("")}
      </ul></details>` : ""}
    </div>`;
}

function renderAdvice() {
  const body = $("adviceBody");
  const m = mask(), u = cappedUpper();

  const evChip = $("evValue");
  evChip.textContent = state.ready ? fmt(E.stateValue(m, u)) : "–";
  if (state.ready) recordHistory(m, u);

  if (!state.ready) { body.className = "advice-empty"; body.textContent = "Loading solver…"; return; }

  if (m === E.FULL_MASK) {
    body.className = "advice-empty";
    body.textContent = "Scorecard complete — nice game! Tap “New game” to start over.";
    evChip.textContent = "0";
    return;
  }
  if (state.dice.length < 5) {
    body.className = "advice-empty";
    body.textContent = `Enter your ${["first", "second", "third"][state.roll - 1]} roll below to get advice.`;
    return;
  }

  const adv = E.advise({ mask: m, upper: u, dice: state.dice, rerollsLeft: 3 - state.roll });
  body.className = "";

  if (adv.kind === "score" || (adv.kind === "keep" && adv.best.nKept === 5)) {
    const best = adv.kind === "score" ? adv.best : adv.best.thenScore;
    const alts = (adv.kind === "score" ? adv.alternatives : adv.boxRanking).slice(1, 5);
    const stay = adv.kind === "keep" ? "Stop rolling — score" : "Score";
    body.innerHTML = scoreAdviceHTML(best, alts, stay);
    $("adviceApplyBtn").onclick = () => applyScore(best);
    body.querySelectorAll(".alt-btn").forEach((b) => {
      b.onclick = () => applyScore(alts[Number(b.dataset.alt)]);
    });
    return;
  }

  const best = adv.best;
  const alts = adv.alternatives.slice(1, 4);
  body.innerHTML = keepAdviceHTML(best, alts, state.dice, "Keep these &amp; roll again");
  $("adviceApplyBtn").onclick = () => applyKeep(best.keepValues);
  body.querySelectorAll(".alt-btn").forEach((b) => {
    b.onclick = () => applyKeep(alts[Number(b.dataset.alt)].keepValues);
  });
}

function applyScore(choice) {
  const c = choice.cat;
  if (c < 6) state.upperScores[c] = choice.pts;
  else state.lowerFilled[c - 6] = true;
  state.dice = [];
  state.roll = 1;
  render();
}

function applyKeep(keepValues) {
  state.dice = [...keepValues];
  state.roll = Math.min(state.roll + 1, 3);
  render();
}

// ── Play mode ───────────────────────────────────────────────────────────────
function newPlayGame(n) {
  play.players = Array.from({ length: n }, (_, i) => ({
    name: `Player ${i + 1}`, boxes: Array(12).fill(null), history: {},
  }));
  play.current = 0;
  play.dice = [];
  play.held = Array(5).fill(false);
  play.rollsUsed = 0;
  play.over = false;
  render();
}

function playRoll() {
  if (play.over || !play.players.length || play.rollsUsed >= 3 || play.animating) return;
  if (play.rollsUsed === 0) { play.dice = []; play.held = Array(5).fill(false); }
  const rolling = [];
  for (let i = 0; i < 5; i++) {
    if (play.rollsUsed === 0 || !play.held[i]) {
      play.dice[i] = 1 + Math.floor(Math.random() * 6);
      rolling.push(i);
    }
  }
  play.rollsUsed++;
  play.pick = null;
  if (!anim.on) { autoHoldAdvice(); render(); return; }

  // Tumble: the outcome above is already committed; we just scramble the
  // rolling dice's faces on screen until the timer settles them.
  play.animating = true;
  play.rollingIdx = rolling;
  render();
  const t0 = Date.now();
  const duration = ANIM_DURATION[anim.speed] || ANIM_DURATION.normal;
  clearInterval(animTimer);
  animTimer = setInterval(() => {
    if (Date.now() - t0 >= duration) {
      clearInterval(animTimer);
      play.animating = false;
      play.rollingIdx = [];
      autoHoldAdvice();
      render();
      return;
    }
    const row = $("playDiceRow");
    for (const i of rolling) {
      const die = row.children[i];
      if (die) die.innerHTML = dieSVG(1 + Math.floor(Math.random() * 6), 52);
    }
  }, 75);
}

function playToggleHold(i) {
  if (play.rollsUsed === 0 || play.rollsUsed >= 3 || play.over || play.animating) return;
  play.held[i] = !play.held[i];
  render();
}

function playHoldKeep(keepVec) {
  play.held = diceKeptFlags(keepVec, play.dice);
  render();
}

// With advice on, the player intends to follow it: pre-select the recommended
// keep after each roll settles. Touching the dice is then always a deliberate
// deviation (which the override chip prices). Never auto-scores — banking a
// box stays a manual tap. Skips stand-pat advice so a stray Reroll tap can't
// burn a roll changing nothing.
function autoHoldAdvice() {
  if (!state.ready || !play.adviceOn || play.over || !play.players.length
      || play.rollsUsed === 0 || play.rollsUsed >= 3) return;
  const p = play.players[play.current];
  const adv = E.advise({
    mask: pMask(p), upper: pCappedUpper(p),
    dice: play.dice, rerollsLeft: 3 - play.rollsUsed,
  });
  if (adv.kind === "keep" && adv.best.nKept < 5) {
    play.held = diceKeptFlags(adv.best.keepVec, play.dice);
  }
}

function playScore(cat) {
  const p = play.players[play.current];
  if (play.over || play.rollsUsed === 0 || p.boxes[cat] !== null || play.animating) return;
  p.boxes[cat] = E.SCORES[E.diceValuesToIdx(play.dice)][cat];
  play.dice = [];
  play.held = Array(5).fill(false);
  play.rollsUsed = 0;
  play.pick = null;
  if (play.players.every((q) => pFilled(q) === 12)) play.over = true;
  else play.current = (play.current + 1) % play.players.length;
  render();
}

// Which dice count toward a box's score for the current roll. Sum-scored
// boxes (Choice/4K/FH/Yacht) use all five dice; straights use one die per
// face of the run; upper boxes use the matching faces; a zero box uses none.
function contributingDice(dice, cat) {
  const pts = E.SCORES[E.diceValuesToIdx(dice)][cat];
  if (!pts) return dice.map(() => false);
  if (cat < 6) return dice.map((f) => f === cat + 1);
  if (cat === 9 || cat === 10) {
    const have = new Set(dice);
    const runs = cat === 10
      ? [[1, 2, 3, 4, 5], [2, 3, 4, 5, 6]]
      : [[1, 2, 3, 4], [2, 3, 4, 5], [3, 4, 5, 6]];
    const run = runs.find((r) => r.every((f) => have.has(f))) || [];
    const used = new Set();
    return dice.map((f) => {
      if (run.includes(f) && !used.has(f)) { used.add(f); return true; }
      return false;
    });
  }
  return dice.map(() => true);
}

// At a score-stage advice state (final roll, or stand-pat), the pending box
// choice: the recommendation by default, or the player's override.
function scorePickInfo(adv) {
  if (!play.adviceOn || !adv) return null;
  if (adv.kind !== "score" && !(adv.kind === "keep" && adv.best.nKept === 5)) return null;
  const best = adv.kind === "score" ? adv.best : adv.best.thenScore;
  const ranking = adv.kind === "score" ? adv.alternatives : adv.boxRanking;
  const pick = play.pick !== null && ranking.some((r) => r.cat === play.pick)
    ? play.pick : best.cat;
  return { best, ranking, pick, pickRow: ranking.find((r) => r.cat === pick) };
}

function playStandingsSorted() {
  return play.players
    .map((p, i) => ({ p, i, total: pTotal(p) }))
    .sort((a, b) => b.total - a.total);
}

function renderPlay() {
  const has = play.players.length > 0;
  const p = has ? play.players[play.current] : null;

  if (state.ready && has) {
    for (const q of play.players) {
      q.history[pFilled(q)] = E.stateValue(pMask(q), pCappedUpper(q));
    }
  }

  $("evValue").textContent = state.ready && has && !play.over
    ? fmt(E.stateValue(pMask(p), pCappedUpper(p))) : (has && play.over ? "0" : "–");

  // Turn line + standings
  const info = $("playTurnInfo");
  if (!has) {
    info.textContent = "Play a game";
  } else if (play.over) {
    const s = playStandingsSorted();
    const tie = s.length > 1 && s[0].total === s[1].total;
    info.innerHTML = play.players.length === 1
      ? `Game over — <span class="winner">${s[0].total} points</span>`
      : (tie ? `Game over — it's a tie at <span class="winner">${s[0].total}</span>!`
             : `<span class="winner">${s[0].p.name} wins — ${s[0].total}!</span>`);
  } else {
    const round = pFilled(p) + 1;
    info.textContent = play.players.length > 1
      ? `Round ${round}/12 — ${p.name}` : `Round ${round} of 12`;
  }

  const st = $("standings");
  st.innerHTML = play.players.map((q, i) =>
    `<span class="stand${i === play.current && !play.over ? " on" : ""}">
       <i class="dot" style="background:${PLAYER_COLORS[i]}"></i>P${i + 1}: ${pTotal(q)}</span>`
  ).join("");
  st.hidden = play.players.length < 2;

  // Dice + roll button. With advice on: at keep stages, holds that deviate
  // from the recommended keep render amber (matching the override chip); at
  // the score stage the dice contributing to the pending box choice render
  // blue (recommended) or amber (overridden pick) instead of hold state.
  const adv = has && state.ready && !play.over && !play.animating && play.rollsUsed > 0
    ? E.advise({ mask: pMask(p), upper: pCappedUpper(p),
                 dice: play.dice, rerollsLeft: 3 - play.rollsUsed })
    : null;
  const deviating = !!(play.adviceOn && adv && adv.kind === "keep"
    && adv.best.nKept < 5 && overrideChipHTML(adv) !== "");
  const pickInfo = scorePickInfo(adv);
  const contrib = pickInfo ? contributingDice(play.dice, pickInfo.pick) : null;
  const pickDeviates = pickInfo && pickInfo.pick !== pickInfo.best.cat;

  const row = $("playDiceRow");
  row.innerHTML = "";
  for (let i = 0; i < 5; i++) {
    if (has && play.rollsUsed > 0 && !play.over) {
      const rolling = play.animating && play.rollingIdx.includes(i);
      let cls = "die" + (rolling ? " rolling" : "");
      if (pickInfo) {
        cls += (contrib[i] ? " kept" : "") + (contrib[i] && pickDeviates ? " deviate" : "");
      } else {
        cls += (play.held[i] ? " kept" : "") + (play.held[i] && deviating ? " deviate" : "");
      }
      const b = document.createElement("button");
      b.className = cls;
      b.innerHTML = dieSVG(play.dice[i], 52);
      b.setAttribute("aria-label", rolling ? "Die rolling" :
        pickInfo ? `Die ${play.dice[i]}${contrib[i] ? ", counts toward the picked box" : ""}` :
        `Die ${play.dice[i]}, ${play.held[i] ? "held" : "not held"} — tap to toggle`);
      b.onclick = () => playToggleHold(i);
      row.appendChild(b);
    } else {
      const d = document.createElement("div");
      d.className = "die-slot";
      row.appendChild(d);
    }
  }

  const btn = $("rollBtn");
  const hint = $("playHint");
  if (!has) {
    btn.hidden = true;
    hint.textContent = "Tap “New game” to pick 1–4 players (pass-and-play on one device).";
  } else if (play.over) {
    btn.hidden = true;
    hint.textContent = playStandingsSorted()
      .map((s) => `${s.p.name}: ${s.total}`).join(" · ");
  } else {
    btn.hidden = false;
    btn.disabled = play.rollsUsed >= 3 || play.animating;
    btn.textContent = play.animating ? "Rolling…"
      : play.rollsUsed === 0 ? "Roll"
      : play.rollsUsed < 3 ? `Reroll (${3 - play.rollsUsed} left)` : "No rolls left";
    hint.textContent = play.animating ? "…"
      : play.rollsUsed === 0
        ? `Roll to start ${play.players.length > 1 ? p.name + "'s" : "your"} turn.`
        : play.rollsUsed < 3
          ? "Tap dice to hold them, then reroll — or bank the roll into an open box below."
          : pickInfo
            ? "Final roll — tap the highlighted box again to bank it, or tap another to pick it instead."
            : "Final roll — tap an open box below to score it.";
  }

  // Scorecard
  $("playCardTitle").textContent = has
    ? (play.players.length > 1 ? `${p.name} — scorecard` : "Scorecard") : "Scorecard";
  const up = $("playUpperCol"), lo = $("playLowerCol");
  up.innerHTML = ""; lo.innerHTML = "";
  if (has) {
    const previewIdx = play.rollsUsed > 0 && !play.over && !play.animating
      ? E.diceValuesToIdx(play.dice) : null;
    for (let c = 0; c < 12; c++) {
      const filled = p.boxes[c] !== null;
      const scoreable = !filled && previewIdx !== null;
      const picked = pickInfo && pickInfo.pick === c;
      const b = document.createElement("button");
      b.className = "box" + (filled ? " filled" : "") + (scoreable ? " scoreable" : "")
        + (picked ? " picked" + (pickDeviates ? " pick-deviate" : "") : "");
      const val = filled ? p.boxes[c]
        : scoreable ? `+${E.SCORES[previewIdx][c]}` : "–";
      b.innerHTML = `<span class="name">${E.CATEGORY_NAMES[c]}</span>` +
                    `<span class="val">${val}</span>`;
      b.disabled = !scoreable;
      if (scoreable) {
        // With a pending pick, the first tap on another box moves the pick;
        // tapping the picked box banks it. Without advice: instant scoring.
        b.onclick = pickInfo
          ? () => { if (pickInfo.pick === c) playScore(c); else { play.pick = c; render(); } }
          : () => playScore(c);
      }
      (c < 6 ? up : lo).appendChild(b);
    }
    $("playBonusLine").innerHTML = bonusLineHTML(pUpper(p)) +
      ` · total <b>${pTotal(p)}</b>`;
  } else {
    $("playBonusLine").textContent = "";
  }

  renderPlayAdvice(p);
}

function renderPlayAdvice(p) {
  const card = $("advice");
  card.hidden = !play.adviceOn || !play.players.length || play.over;
  if (card.hidden) return;
  const body = $("adviceBody");
  if (!state.ready) { body.className = "advice-empty"; body.textContent = "Loading solver…"; return; }
  if (play.rollsUsed === 0 || play.animating) {
    body.className = "advice-empty";
    body.textContent = play.animating ? "Rolling…"
      : "Roll — the optimal move will appear here.";
    return;
  }

  const adv = E.advise({
    mask: pMask(p), upper: pCappedUpper(p),
    dice: play.dice, rerollsLeft: 3 - play.rollsUsed,
  });
  body.className = "";

  if (adv.kind === "score" || (adv.kind === "keep" && adv.best.nKept === 5)) {
    const info = scorePickInfo(adv);
    const { best, pick, pickRow } = info;
    const alts = info.ranking.slice(1, 5);
    const stay = adv.kind === "keep" ? "Stop rolling — score" : "Score";
    const chip = pick !== best.cat
      ? `<span class="over-chip">Your pick: ${pickRow.name} · −${fmt(best.ev - pickRow.ev)} pts</span>`
      : "";
    body.innerHTML = scoreAdviceHTML(best, alts, stay, {
      chipHTML: chip,
      buttonLabel: pick === best.cat ? null : `Score ${pickRow.name} for ${pickRow.pts} pts`,
      altAction: "pick",
    });
    $("adviceApplyBtn").onclick = () => playScore(pick);
    body.querySelectorAll(".alt-btn").forEach((b) => {
      b.onclick = () => { play.pick = alts[Number(b.dataset.alt)].cat; render(); };
    });
    return;
  }

  const best = adv.best;
  const alts = adv.alternatives.slice(1, 4);
  const chip = overrideChipHTML(adv);
  // Auto-hold keeps the dice matching the advice, so the apply button is only
  // needed as a way back after the player deviates.
  body.innerHTML = keepAdviceHTML(best, alts, play.dice,
    chip ? "Restore advised hold" : null, chip);
  const applyBtn = $("adviceApplyBtn");
  if (applyBtn) applyBtn.onclick = () => playHoldKeep(best.keepVec);
  body.querySelectorAll(".alt-btn").forEach((b) => {
    b.onclick = () => playHoldKeep(alts[Number(b.dataset.alt)].keepVec);
  });
}

// Treatment "B": when the player's holds differ from the recommended keep,
// show an amber chip with their hold and its EV cost. With auto-hold, any
// mismatch — including clearing every hold — is a deliberate deviation.
function overrideChipHTML(adv) {
  const heldVals = play.dice.filter((f, i) => play.held[i]);
  const heldVec = [0, 0, 0, 0, 0, 0];
  heldVals.forEach((f) => heldVec[f - 1]++);
  if (adv.best.keepVec.every((c, f) => c === heldVec[f])) return "";
  const row = adv.alternatives.find((r) => r.keepVec.every((c, f) => c === heldVec[f]));
  if (!row) return "";
  const cost = adv.best.ev - row.ev;
  const label = heldVals.length ? heldVals.slice().sort().join(" · ") : "none";
  return `<span class="over-chip">Your hold: ${label}
    &nbsp;·&nbsp; −${fmt(cost)} pts</span>`;
}

// ── Expected-points trajectory chart ────────────────────────────────────────
// x is the number of completed turns — identical to "boxes filled" (turn n
// ends with exactly n boxes banked). Play mode labels it "turn"; advisor
// keeps "boxes filled" since manual card edits aren't necessarily turns.
function chartSVG(series, xWord = "boxes filled") {
  const W = 340, H = 220, L = 38, R = 12, T = 16, B = 30;
  const ev0 = E.stateValue(0, 0);
  const all = series.flatMap((s) => Object.values(s.points));
  const yMax = Math.max(50, Math.ceil(Math.max(...all, ev0, 1) / 50) * 50);
  const x = (t) => L + (t / 12) * (W - L - R);
  const y = (v) => T + (1 - v / yMax) * (H - T - B);

  // Optimal glide path: the exact starting EV at (0, ev0) straight down to
  // (12, 0) — not the true E[V(state_t)] trajectory, just the two endpoints
  // a player's own line can be compared against at a glance.
  const refLine = `<line x1="${x(0)}" y1="${y(ev0)}" x2="${x(12)}" y2="${y(0)}" class="c-ref">
    <title>Optimal glide path — points left under optimal play</title></line>`;

  let grid = "";
  for (let v = 0; v <= yMax; v += 50) {
    grid += `<line x1="${L}" y1="${y(v)}" x2="${W - R}" y2="${y(v)}" class="c-grid"/>` +
            `<text x="${L - 6}" y="${y(v) + 3.5}" class="c-lbl" text-anchor="end">${v}</text>`;
  }
  for (let t = 0; t <= 12; t += 2) {
    grid += `<text x="${x(t)}" y="${H - B + 16}" class="c-lbl" text-anchor="middle">${t}</text>`;
  }

  let marks = "";
  for (const s of series) {
    const entries = Object.entries(s.points)
      .map(([t, v]) => [Number(t), v])
      .sort((a, b) => a[0] - b[0]);
    if (entries.length > 1) {
      const pts = entries.map(([t, v]) => `${x(t)},${y(v)}`).join(" ");
      marks += `<polyline points="${pts}" class="c-line" style="stroke:${s.color}"/>`;
    }
    marks += entries.map(([t, v], i) =>
      `<circle cx="${x(t)}" cy="${y(v)}" r="${i === entries.length - 1 ? 5 : 3.5}"
         class="c-dot" style="stroke:${s.color}${i === entries.length - 1 ? `;fill:${s.color}` : ""}">
         <title>${s.label} · ${xWord === "turn" ? `after turn ${t}` : `${t} filled`}: ${v.toFixed(1)} pts left</title></circle>`
    ).join("");
  }

  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img"
    aria-label="Expected points left by ${xWord}">
    ${grid}${refLine}${marks}
    <text x="${(L + W - R) / 2}" y="${H - 2}" class="c-lbl" text-anchor="middle">${xWord}</text>
  </svg>`;
}

function openChartSheet() {
  if (!state.ready) return;
  const inPlay = mode === "play";
  const xWord = inPlay ? "turn" : "boxes filled";
  const series = !inPlay
    ? [{ label: "You", color: PLAYER_COLORS[0], points: state.history }]
    : play.players.map((q, i) =>
        ({ label: `P${i + 1}`, color: PLAYER_COLORS[i], points: q.history }));

  const sheet = $("sheet");
  const nPoints = series.reduce((a, s) => a + Object.keys(s.points).length, 0);
  const legend = series.length > 1
    ? `<div class="chart-legend">${series.map((s) =>
        `<span><i class="dot" style="background:${s.color}"></i>${s.label}</span>`).join("")}</div>`
    : "";
  sheet.innerHTML = `<h3>Expected points left, by ${xWord}</h3>
    ${series.length ? chartSVG(series, xWord) : ""}${legend}
    <p class="hint">${nPoints > 1
      ? `Each dot is the expected remaining score at that point in the game. The dashed line is the optimal glide path: it starts at ${fmt(E.stateValue(0, 0))} ${inPlay ? "before turn 1 and glides to 0 by turn 12" : "with no boxes filled and glides to 0 as the card fills"} — a shallow step means that turn banked more than it cost.`
      : "Fill some boxes and the trajectory of the game will build up here."}</p>`;
  $("sheetBackdrop").hidden = false;
}

// ── Sheets ──────────────────────────────────────────────────────────────────
function openUpperSheet(c) {
  const face = c + 1;
  const sheet = $("sheet");
  const opts = [];
  opts.push(`<button class="open-opt" data-v="open">not filled</button>`);
  for (let k = 0; k <= 5; k++) {
    opts.push(`<button data-v="${k * face}">
      <span class="n">${k * face}</span><span class="s">${k}× ${dieSVG(face, 14, true)}</span></button>`);
  }
  sheet.innerHTML = `<h3>${E.CATEGORY_NAMES[c]} — banked score</h3>
    <div class="opts">${opts.join("")}</div>`;
  sheet.querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      state.upperScores[c] = b.dataset.v === "open" ? null : Number(b.dataset.v);
      closeSheet(); render();
    };
  });
  $("sheetBackdrop").hidden = false;
}

function openPlayNewSheet() {
  if (play.players.length && !play.over
      && !confirm("Abandon the current game and start a new one?")) return;
  const sheet = $("sheet");
  sheet.innerHTML = `<h3>New game — how many players?</h3>
    <div class="opts">${[1, 2, 3, 4].map((n) =>
      `<button data-n="${n}"><span class="n">${n}</span>
       <span class="s">${n === 1 ? "solo" : "pass & play"}</span></button>`).join("")}
    </div>`;
  sheet.querySelectorAll("button").forEach((b) => {
    b.onclick = () => { closeSheet(); newPlayGame(Number(b.dataset.n)); };
  });
  $("sheetBackdrop").hidden = false;
}

function openSettingsSheet() {
  $("settingsBtn").classList.add("open");
  const sheet = $("sheet");
  sheet.innerHTML = `<h3>Settings</h3>
    <div class="set-rows">
      ${mode === "play" ? `<label class="advice-switch"><input type="checkbox"
        id="adviceToggle" ${play.adviceOn ? "checked" : ""}>
        Show optimal-play advice</label>` : ""}
      <label class="advice-switch"><input type="checkbox" id="animToggle"
        ${anim.on ? "checked" : ""}>
        Roll animation</label>
      <div class="set-line" id="animSpeedRow" ${anim.on ? "" : "hidden"}>
        <span class="set-label">Speed</span>
        <div class="seg" id="animSpeedSeg" role="radiogroup" aria-label="Animation speed">
          ${["slow", "normal", "fast"].map((s) =>
            `<button data-speed="${s}"${s === anim.speed ? ' class="on"' : ""}>
             ${s[0].toUpperCase() + s.slice(1)}</button>`).join("")}
        </div>
      </div>
      <div class="set-line">
        <span class="set-label">Theme</span>
        <div class="seg" id="themeSeg" role="radiogroup" aria-label="Color theme">
          ${["auto", "dark", "light"].map((t) =>
            `<button data-theme="${t}"${t === currentTheme() ? ' class="on"' : ""}>
             ${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}
        </div>
      </div>
    </div>`;

  const adviceEl = sheet.querySelector("#adviceToggle");
  if (adviceEl) adviceEl.onchange = (e) => { play.adviceOn = e.target.checked; render(); };
  sheet.querySelector("#animToggle").onchange = (e) => {
    anim.on = e.target.checked;
    sheet.querySelector("#animSpeedRow").hidden = !anim.on;
    render();
  };
  sheet.querySelectorAll("#animSpeedSeg button").forEach((b) => {
    b.onclick = () => {
      anim.speed = b.dataset.speed;
      sheet.querySelectorAll("#animSpeedSeg button").forEach((x) =>
        x.classList.toggle("on", x === b));
      render();
    };
  });
  sheet.querySelectorAll("#themeSeg button").forEach((b) => {
    b.onclick = () => {
      applyTheme(b.dataset.theme);
      sheet.querySelectorAll("#themeSeg button").forEach((x) =>
        x.classList.toggle("on", x === b));
    };
  });
  $("sheetBackdrop").hidden = false;
}

function closeSheet() {
  $("sheetBackdrop").hidden = true;
  $("settingsBtn").classList.remove("open");
}
$("sheetBackdrop").addEventListener("click", (e) => {
  if (e.target === $("sheetBackdrop")) closeSheet();
});

// ── Wiring ──────────────────────────────────────────────────────────────────
document.querySelectorAll("#modeSeg button").forEach((b) => {
  b.onclick = () => { mode = b.dataset.mode; render(); };
});

$("dicePad").querySelectorAll("button[data-face]").forEach((b) => {
  const face = Number(b.dataset.face);
  b.innerHTML = dieSVG(face, 34);
  b.setAttribute("aria-label", `Add a ${face}`);
  b.onclick = () => {
    if (state.dice.length < 5) { state.dice.push(face); render(); }
  };
});
$("diceClear").onclick = () => { state.dice = []; render(); };

document.querySelectorAll("#rollSeg button").forEach((b) => {
  b.onclick = () => { state.roll = Number(b.dataset.roll); render(); };
});

$("resetBtn").onclick = () => {
  if (mask() !== 0 && !confirm("Clear the scorecard and start a new game?")) return;
  state.upperScores = Array(6).fill(null);
  state.lowerFilled = Array(6).fill(false);
  state.dice = [];
  state.roll = 1;
  state.history = {};
  render();
};

$("playNewBtn").onclick = openPlayNewSheet;
$("rollBtn").onclick = playRoll;
$("settingsBtn").onclick = openSettingsSheet;

$("evChip").onclick = openChartSheet;

// ── Theme (selected in the settings sheet) ──────────────────────────────────
const THEME_KEY = "yacht-solver-theme";

function currentTheme() {
  const t = document.documentElement.dataset.theme;
  return t === "dark" || t === "light" ? t : "auto";
}

function applyTheme(t) {
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try {
    if (t === "auto") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, t);
  } catch (e) { /* private mode — theme just won't persist */ }
}

// ── Persistence ─────────────────────────────────────────────────────────────
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      upperScores: state.upperScores, lowerFilled: state.lowerFilled,
      dice: state.dice, roll: state.roll, history: state.history,
    }));
    localStorage.setItem(PLAY_KEY, JSON.stringify({
      players: play.players, current: play.current, dice: play.dice,
      held: play.held, rollsUsed: play.rollsUsed, adviceOn: play.adviceOn,
      over: play.over,
    }));
    localStorage.setItem(MODE_KEY, mode);
    localStorage.setItem(ANIM_KEY, JSON.stringify({ on: anim.on, speed: anim.speed }));
  } catch (e) { /* private mode etc. — fine */ }
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (s) {
      if (Array.isArray(s.upperScores) && s.upperScores.length === 6) state.upperScores = s.upperScores;
      if (Array.isArray(s.lowerFilled) && s.lowerFilled.length === 6) state.lowerFilled = s.lowerFilled;
      if (Array.isArray(s.dice)) state.dice = s.dice.filter((f) => f >= 1 && f <= 6).slice(0, 5);
      if ([1, 2, 3].includes(s.roll)) state.roll = s.roll;
      if (s.history && typeof s.history === "object" && !Array.isArray(s.history)) {
        state.history = Object.fromEntries(Object.entries(s.history)
          .filter(([t, v]) => Number(t) >= 0 && Number(t) <= 12 && typeof v === "number"));
      }
    }
    const g = JSON.parse(localStorage.getItem(PLAY_KEY) || "null");
    if (g && Array.isArray(g.players) && g.players.length <= 4 && g.players.every(
        (q) => q && Array.isArray(q.boxes) && q.boxes.length === 12 &&
               q.boxes.every((b) => b === null || typeof b === "number"))) {
      play.players = g.players.map((q, i) => ({
        name: typeof q.name === "string" ? q.name : `Player ${i + 1}`,
        boxes: q.boxes,
        history: (q.history && typeof q.history === "object") ? q.history : {},
      }));
      if (Number.isInteger(g.current) && g.current >= 0 && g.current < play.players.length) play.current = g.current;
      if (Array.isArray(g.dice) && g.dice.length === 5 && g.dice.every((f) => f >= 1 && f <= 6)) play.dice = g.dice;
      if (Array.isArray(g.held) && g.held.length === 5) play.held = g.held.map(Boolean);
      if ([0, 1, 2, 3].includes(g.rollsUsed) && play.dice.length === 5) play.rollsUsed = g.rollsUsed;
      play.adviceOn = Boolean(g.adviceOn);
      play.over = Boolean(g.over);
    }
    const m = localStorage.getItem(MODE_KEY);
    if (m === "advisor" || m === "play") mode = m;
    const a = JSON.parse(localStorage.getItem(ANIM_KEY) || "null");
    if (a && typeof a === "object") {
      if (typeof a.on === "boolean") anim.on = a.on;
      if (a.speed in ANIM_DURATION) anim.speed = a.speed;
    }
  } catch (e) { /* corrupted storage — start fresh */ }
}

// ── Update check (cache busting) ────────────────────────────────────────────
// Deploys stamp BUILD_VERSION into index.html and write version.json. If the
// server has a newer build than the page we're running, force-refresh the
// cached index once and reload — mobile browsers rarely get a manual hard
// refresh. localStorage (game/advisor state, settings) is untouched.
function checkForUpdate() {
  const build = window.BUILD_VERSION;
  if (!build || build === "__BUILD__") return;         // local / unstamped
  fetch("version.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then(async (v) => {
      if (!v || !v.build || v.build === build) return;
      const guard = "yacht-solver-reloaded-for";
      try {
        if (sessionStorage.getItem(guard) === v.build) return;   // one attempt per build
        sessionStorage.setItem(guard, v.build);
      } catch (e) { return; }
      await fetch(location.href, { cache: "reload" }).catch(() => {});
      location.reload();
    })
    .catch(() => { /* offline etc. — current version keeps working */ });
}

// ── Boot ────────────────────────────────────────────────────────────────────
load();
render();
checkForUpdate();
fetch(`v_table.bin?v=${encodeURIComponent(window.BUILD_VERSION || "dev")}`)
  .then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.arrayBuffer();
  })
  .then((buf) => { E.loadValueTable(buf); state.ready = true; render(); })
  .catch((err) => {
    $("adviceBody").className = "advice-empty";
    $("adviceBody").textContent =
      `Couldn’t load the solver table (${err.message}). If you opened this file ` +
      `directly, serve the folder over HTTP instead (e.g. python3 -m http.server).`;
  });

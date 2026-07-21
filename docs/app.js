/* Yacht Dice Solver — UI. State in/out, advice rendering; all math in engine.js. */
"use strict";

const E = window.YachtEngine;
const $ = (id) => document.getElementById(id);

const STORAGE_KEY = "yacht-solver-v1";

const state = {
  upperScores: Array(6).fill(null),   // null = open, else banked score (count*face)
  lowerFilled: Array(6).fill(false),  // categories 6..11
  dice: [],                           // entered faces, up to 5
  roll: 1,                            // 1 | 2 | 3
  ready: false,
};

// ── Derived ─────────────────────────────────────────────────────────────────
const mask = () => {
  let m = 0;
  state.upperScores.forEach((s, i) => { if (s !== null) m |= 1 << i; });
  state.lowerFilled.forEach((f, i) => { if (f) m |= 1 << (6 + i); });
  return m;
};
const upperTotal = () => state.upperScores.reduce((a, b) => a + (b || 0), 0);
const cappedUpper = () => Math.min(upperTotal(), E.UPPER_BONUS_THRESHOLD);

// ── Dice SVG ────────────────────────────────────────────────────────────────
const PIPS = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  6: [[0, 0], [0, 1], [0, 2], [2, 0], [2, 1], [2, 2]],
};
function dieSVG(face, size = 24) {
  const dots = PIPS[face]
    .map(([x, y]) => `<circle class="pip" cx="${27 + x * 23}" cy="${27 + y * 23}" r="8.5"/>`)
    .join("");
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" aria-label="${face}">${dots}</svg>`;
}

// ── Rendering ───────────────────────────────────────────────────────────────
function render() {
  renderDice();
  renderBoard();
  renderAdvice();
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
  const line = $("bonusLine");
  if (ut >= E.UPPER_BONUS_THRESHOLD) {
    line.innerHTML = `Upper total <b>${ut}</b> · <span class="earned">+35 bonus earned</span>`;
  } else {
    line.innerHTML = `Upper total <b>${ut}</b> / 63 · ${63 - ut} more for the +35 bonus`;
  }
}

function fmt(x, digits = 1) { return x.toFixed(digits); }

function diceKeptFlags(keepVec) {
  const left = [...keepVec];
  return state.dice.map((f) => (left[f - 1] > 0 ? (left[f - 1]--, true) : false));
}

function adviceDiceHTML(keepVec) {
  const kept = diceKeptFlags(keepVec);
  return `<div class="advice-dice">` + state.dice.map((f, i) =>
    `<span class="die ${kept[i] ? "kept" : "dim"}" style="pointer-events:none">${dieSVG(f, 46)}</span>`
  ).join("") + `</div>`;
}

function miniDiceHTML(values) {
  if (!values.length) return `<span class="what">keep nothing</span>`;
  return `<span class="mini-dice">` + values.map((f) => `<span>${dieSVG(f, 17)}</span>`).join("") + `</span>`;
}

function renderAdvice() {
  const body = $("adviceBody");
  const m = mask(), u = cappedUpper();

  const evChip = $("evValue");
  evChip.textContent = state.ready ? fmt(E.stateValue(m, u)) : "–";

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
    body.innerHTML = `
      <div class="advice-main">
        <p class="advice-title">${stay} <u>${best.name}</u> for
          <span class="pts">${best.pts} pts</span>${best.crossed ? " · locks the +35 bonus" : ""}</p>
        <p class="advice-sub">Expected final haul from here: ${fmt(best.ev + 0)} pts</p>
        <button class="apply-btn" id="applyBtn">Apply &amp; next turn</button>
        ${alts.length ? `<details class="more"><summary>Other options</summary>
          <ul class="alts">${alts.map((a) =>
            `<li><span class="what">${a.name} · ${a.pts} pts</span>
             <span class="delta">−${fmt(best.ev - a.ev)}</span></li>`).join("")}
          </ul></details>` : ""}
      </div>`;
    $("applyBtn").onclick = () => applyScore(best);
    return;
  }

  const best = adv.best;
  const n = best.nKept;
  const title = n === 0
    ? "Reroll everything"
    : `Keep ${best.keepValues.join(" · ")} — reroll ${5 - n} ${5 - n === 1 ? "die" : "dice"}`;
  const alts = adv.alternatives.slice(1, 4);
  body.innerHTML = `
    <div class="advice-main">
      <p class="advice-title">${title}</p>
      ${adviceDiceHTML(best.keepVec)}
      <p class="advice-sub">Expected final haul from here: ${fmt(best.ev)} pts</p>
      ${alts.length ? `<details class="more"><summary>Other keeps</summary>
        <ul class="alts">${alts.map((a) =>
          `<li><span class="what">${miniDiceHTML(a.keepValues)}</span>
           <span class="delta">−${fmt(best.ev - a.ev)}</span></li>`).join("")}
        </ul></details>` : ""}
    </div>`;
}

function applyScore(best) {
  const c = best.cat;
  if (c < 6) state.upperScores[c] = best.pts;
  else state.lowerFilled[c - 6] = true;
  state.dice = [];
  state.roll = 1;
  render();
}

// ── Upper-box picker sheet ──────────────────────────────────────────────────
function openUpperSheet(c) {
  const face = c + 1;
  const sheet = $("sheet");
  const opts = [];
  opts.push(`<button class="open-opt" data-v="open">not filled</button>`);
  for (let k = 0; k <= 5; k++) {
    opts.push(`<button data-v="${k * face}">
      <span class="n">${k * face}</span><span class="s">${k}× ${dieSVG(face, 13)}</span></button>`);
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
function closeSheet() { $("sheetBackdrop").hidden = true; }
$("sheetBackdrop").addEventListener("click", (e) => {
  if (e.target === $("sheetBackdrop")) closeSheet();
});

// ── Wiring ──────────────────────────────────────────────────────────────────
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
  render();
};

// ── Persistence ─────────────────────────────────────────────────────────────
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      upperScores: state.upperScores, lowerFilled: state.lowerFilled,
      dice: state.dice, roll: state.roll,
    }));
  } catch (e) { /* private mode etc. — fine */ }
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!s) return;
    if (Array.isArray(s.upperScores) && s.upperScores.length === 6) state.upperScores = s.upperScores;
    if (Array.isArray(s.lowerFilled) && s.lowerFilled.length === 6) state.lowerFilled = s.lowerFilled;
    if (Array.isArray(s.dice)) state.dice = s.dice.filter((f) => f >= 1 && f <= 6).slice(0, 5);
    if ([1, 2, 3].includes(s.roll)) state.roll = s.roll;
  } catch (e) { /* corrupted storage — start fresh */ }
}

// ── Boot ────────────────────────────────────────────────────────────────────
load();
render();
fetch("v_table.bin")
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

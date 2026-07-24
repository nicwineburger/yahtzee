// End-to-end UI tests for the Yacht Dice solver web app.
//
// Serves docs/ on an ephemeral port with a built-in static server, drives the
// app with Playwright Chromium, and exercises both modes:
//   1. Advisor basics (advice content, EV chip, scorecard input)
//   2. Advisor interactions (apply keep/box, alternatives, trajectory chart,
//      persistence)
//   3. Theming (die-frame contrast in dark/light, theme toggle + persistence)
//   4. Play mode (roll/hold mechanics, rule enforcement, scoring previews,
//      a full seeded 2-player game with independently recomputed totals,
//      advice overlay + placement, per-player chart, persistence)
//
// Run:  node tests/ui.test.mjs
// Locally the preinstalled Chromium at /opt/pw-browsers/chromium is used as a
// fallback if Playwright's own browser download is absent.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const DOCS = join(here, "..", "docs");
const SHOTS = join(here, ".artifacts");
mkdirSync(SHOTS, { recursive: true });

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".bin": "application/octet-stream",
  ".md": "text/markdown",
};

const server = http.createServer(async (req, res) => {
  try {
    const path = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    const data = await readFile(join(DOCS, path));
    res.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

let browser;
try {
  browser = await chromium.launch();
} catch {
  browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
}

const errors = [];
let checks = 0;
const check = (label, cond) => {
  checks++;
  if (!cond) { errors.push("CHECK FAILED: " + label); console.error("FAIL", label); }
  else console.log("ok  ", label);
};

const MOBILE = { width: 390, height: 844 };

async function newPage(opts = {}) {
  const ctx = await browser.newContext({
    viewport: MOBILE, isMobile: true, hasTouch: true, ...opts,
  });
  if (opts.seedDice) {
    await ctx.addInitScript(() => {
      let s = 12345;
      Math.random = () => {
        s |= 0; s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    });
  }
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.getElementById("evValue").textContent !== "–");
  return { ctx, page };
}

// ═══ 1. Advisor basics ══════════════════════════════════════════════════════
{
  const { ctx, page } = await newPage();
  check("V(empty) chip = 191.8", (await page.textContent("#evValue")) === "191.8");

  for (const f of [3, 3, 5, 2, 6]) await page.click(`#dicePad button[data-face="${f}"]`);
  await page.waitForSelector(".advice-title");
  check("keep advice for 33526 = keep the pair of 3s",
    (await page.textContent(".advice-title")).includes("Keep 3 · 3"));

  await page.click('#rollSeg button[data-roll="3"]');
  await page.waitForSelector("#adviceApplyBtn");
  check("3rd roll -> score advice", (await page.textContent(".advice-title")).includes("Score"));
  await page.click("#adviceApplyBtn");
  check("apply fills a box", (await page.$$eval(".box.filled", (e) => e.length)) === 1);
  check("apply clears dice", (await page.$$eval("#diceRow .die", (e) => e.length)) === 0);

  // Upper-box picker sheet
  await page.click("#upperCol .box:nth-child(5)");
  await page.waitForSelector(".sheet .opts");
  await page.click('.sheet .opts button[data-v="15"]');
  const upperSum = await page.$$eval("#upperCol .box.filled .val", (els) =>
    els.reduce((a, e) => a + Number(e.textContent), 0));
  check(`bonus line shows upper total ${upperSum} after setting Fives=15`,
    (await page.textContent("#bonusLine")).includes(`Upper total ${upperSum}`));
  await ctx.close();
}

// ═══ 2. Advisor interactions ════════════════════════════════════════════════
{
  const { ctx, page } = await newPage();
  for (const f of [3, 3, 5, 2, 6]) await page.click(`#dicePad button[data-face="${f}"]`);
  await page.waitForSelector("#adviceApplyBtn");
  await page.click("#adviceApplyBtn");            // keep 3·3 -> next roll
  check("keep-apply leaves kept dice", (await page.$$eval("#diceRow .die", (e) => e.length)) === 2);
  check("keep-apply advances roll", await page.$eval('#rollSeg button[data-roll="2"]', (b) => b.classList.contains("on")));

  for (const f of [3, 4, 5]) await page.click(`#dicePad button[data-face="${f}"]`);
  await page.click("details.more summary");
  const altDice = await page.$eval(".alt-btn .mini-dice", (el) => el.querySelectorAll("svg").length);
  await page.click(".alt-btn");
  check("alternative keep applies its dice",
    (await page.$$eval("#diceRow .die", (e) => e.length)) === altDice);

  while ((await page.$$eval("#diceRow .die", (e) => e.length)) < 5) {
    await page.click('#dicePad button[data-face="2"]');
  }
  await page.click('#rollSeg button[data-roll="3"]');
  await page.waitForSelector("#adviceApplyBtn");
  await page.click("details.more summary");
  const altBox = (await page.textContent(".alt-btn .what")).split("·")[0].trim();
  await page.click(".alt-btn");
  const filled = await page.$$eval(".box.filled .name", (els) => els.map((e) => e.textContent.trim()));
  check(`alternative box "${altBox}" scores`, filled.some((n) => altBox.startsWith(n) || n.startsWith(altBox)));

  // Trajectory chart + persistence
  await page.click("#evChip");
  await page.waitForSelector(".sheet svg.chart");
  const dots = await page.$$eval(".sheet .c-dot", (e) => e.length);
  check("chart has one dot per recorded turn", dots === 2);
  await page.mouse.click(195, 100);
  await page.waitForSelector(".sheet-backdrop", { state: "hidden" });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.getElementById("evValue").textContent !== "–");
  await page.click("#evChip");
  await page.waitForSelector(".sheet svg.chart");
  check("trajectory persists across reload",
    (await page.$$eval(".sheet .c-dot", (e) => e.length)) === dots);
  await ctx.close();
}

// ═══ 3. Theming ═════════════════════════════════════════════════════════════
{
  const { ctx, page } = await newPage({ colorScheme: "dark" });
  const bodyBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  for (const f of [3, 3, 5, 2, 6]) await page.click(`#dicePad button[data-face="${f}"]`);
  await page.click("details.more summary");
  const altFrames = await page.$$eval(".alt-btn .die-frame", (els) =>
    els.map((e) => getComputedStyle(e).stroke));
  check("dark mode: alt-keep dice have high-contrast frames",
    altFrames.length > 0 && altFrames.every((s) => s === "rgb(153, 162, 176)"));

  await page.click("#upperCol .box:nth-child(5)");
  await page.waitForSelector(".sheet .opts");
  const sheetFrames = await page.$$eval(".sheet .die-frame", (els) =>
    els.map((e) => getComputedStyle(e).stroke));
  check("dark mode: box-score picker dice have frames",
    sheetFrames.length === 6 && sheetFrames.every((s) => s === "rgb(153, 162, 176)"));
  await page.mouse.click(195, 100);
  await page.waitForSelector(".sheet-backdrop", { state: "hidden" });

  check("auto theme follows dark system", (await bodyBg()) === "rgb(20, 22, 27)");
  await page.click("#themeBtn");                   // forced dark
  await page.click("#themeBtn");                   // forced light
  check("forced light overrides dark system pref", (await bodyBg()) === "rgb(244, 245, 247)");
  await page.reload({ waitUntil: "networkidle" });
  check("theme choice persists", (await bodyBg()) === "rgb(244, 245, 247)");
  await page.click("#themeBtn");                   // back to auto
  check("auto restores system theme", (await bodyBg()) === "rgb(20, 22, 27)");
  await ctx.close();
}

// ═══ 4. Play mode ═══════════════════════════════════════════════════════════
{
  const { ctx, page } = await newPage({ seedDice: true });
  const dice = () => page.$$eval("#playDiceRow .die svg", (els) => els.map((e) => Number(e.getAttribute("aria-label"))));
  const held = () => page.$$eval("#playDiceRow .die", (els) => els.map((e) => e.classList.contains("kept")));

  await page.click('#modeSeg button[data-mode="play"]');
  check("play view shown / advisor hidden",
    await page.$eval("#playView", (e) => !e.hidden) && await page.$eval("#advisorView", (e) => e.hidden));
  await page.click("#playNewBtn");
  await page.waitForSelector('.sheet button[data-n="2"]');
  await page.click('.sheet button[data-n="2"]');
  check("round 1, player 1", (await page.textContent("#playTurnInfo")).includes("Round 1/12 — Player 1"));

  // Roll / hold / reroll mechanics
  await page.click("#rollBtn");
  const d1 = await dice();
  check("first roll produces 5 dice", d1.length === 5);
  await page.click("#playDiceRow .die:nth-child(1)");
  await page.click("#playDiceRow .die:nth-child(2)");
  await page.click("#rollBtn");
  const d2 = await dice();
  check("held dice survive the reroll", d2[0] === d1[0] && d2[1] === d1[1]);
  await page.click("#rollBtn");
  check("no fourth roll", await page.$eval("#rollBtn", (b) => b.disabled));
  const beforeHold = (await held()).join();
  await page.click("#playDiceRow .die:nth-child(3)");
  check("holds locked after final roll", (await held()).join() === beforeHold);

  // Score previews match the engine
  const d3 = await dice();
  const engineChoice = await page.evaluate((dd) => {
    const idx = window.YachtEngine.diceValuesToIdx(dd);
    return window.YachtEngine.SCORES[idx][6];
  }, d3);
  const previews = await page.$$eval(".box.scoreable", (els) =>
    els.map((e) => ({ name: e.querySelector(".name").textContent, val: e.querySelector(".val").textContent })));
  check("12 open boxes offer previews", previews.length === 12);
  check("Choice preview = engine score = dice sum",
    previews.find((p) => p.name === "Choice").val === `+${engineChoice}`
    && engineChoice === d3.reduce((a, b) => a + b, 0));
  await page.$$eval(".box.scoreable", (els) =>
    els.find((e) => e.querySelector(".name").textContent === "Choice").click());
  check("scoring rotates to player 2", (await page.textContent("#playTurnInfo")).includes("Player 2"));

  // Advice overlay: placement + hold-for-me
  await page.click(".advice-switch");
  check("advice card sits between round card and scorecard",
    await page.evaluate(() => {
      const a = document.getElementById("advice");
      return a.parentElement.id === "playView"
        && a.nextElementSibling?.id === "playScoreSection" && !a.hidden;
    }));
  await page.screenshot({ path: join(SHOTS, "play_advice_placement.png") });
  await page.click("#rollBtn");
  await page.waitForSelector("#adviceApplyBtn");
  const title = (await page.textContent(".advice-title")).trim();
  if (title.startsWith("Keep")) {
    await page.click("#adviceApplyBtn");
    const kept = (await held()).filter(Boolean).length;
    check("'Hold these for me' sets holds", kept > 0 && kept < 6);
  }

  // Full seeded 2-player game: roll to the final roll, score the advised box.
  for (let guard = 0; guard < 140; guard++) {
    if (/wins|tie|Game over/.test(await page.textContent("#playTurnInfo"))) break;
    if (!(await page.$eval("#rollBtn", (b) => b.disabled || b.hidden))) {
      await page.click("#rollBtn");
      continue;
    }
    await page.waitForSelector("#adviceApplyBtn");
    await page.click("#adviceApplyBtn");
  }
  check("game finishes with a result", /wins|tie|Game over/.test(await page.textContent("#playTurnInfo")));
  const players = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("yacht-solver-play-v1")).players);
  check("all 24 boxes filled", players.every((p) => p.boxes.every((b) => b !== null)));
  const standingsText = await page.textContent("#standings");
  for (const [i, p] of players.entries()) {
    const upper = p.boxes.slice(0, 6).reduce((a, b) => a + b, 0);
    const expected = p.boxes.reduce((a, b) => a + b, 0) + (upper >= 63 ? 35 : 0);
    const shown = Number(standingsText.match(new RegExp(`P${i + 1}: (\\d+)`))[1]);
    check(`P${i + 1} displayed total = boxes + bonus (${expected})`, shown === expected);
  }

  // Per-player chart, mode switching, persistence
  await page.click("#evChip");
  await page.waitForSelector(".sheet svg.chart");
  check("chart draws one line per player",
    (await page.$$eval(".sheet .c-line", (e) => e.length)) === 2);
  await page.mouse.click(195, 80);
  await page.waitForSelector(".sheet-backdrop", { state: "hidden" });

  await page.click('#modeSeg button[data-mode="advisor"]');
  check("advice card returns to the top in advisor mode",
    await page.evaluate(() => {
      const a = document.getElementById("advice");
      return a.nextElementSibling?.id === "advisorView" && !a.hidden;
    }));
  check("advisor untouched by play mode", (await page.textContent("#evValue")) === "191.8");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.getElementById("evValue").textContent !== "–");
  await page.click('#modeSeg button[data-mode="play"]');
  check("finished game persists", /wins|tie|Game over/.test(await page.textContent("#playTurnInfo")));
  await ctx.close();
}

await browser.close();
server.close();

if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n` + errors.join("\n"));
  process.exit(1);
}
console.log(`\nALL ${checks} UI CHECKS PASSED`);

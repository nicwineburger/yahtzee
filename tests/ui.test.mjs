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

const overrides = new Map();   // path -> body, for the update-check section
let indexHits = 0;
const server = http.createServer(async (req, res) => {
  try {
    const path = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    if (path === "/index.html") indexHits++;
    const data = overrides.has(path) ? overrides.get(path) : await readFile(join(DOCS, path));
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

// Open the gear settings sheet, run fn, close via backdrop.
async function withSettings(page, fn) {
  await page.click("#settingsBtn");
  await page.waitForSelector(".sheet .set-rows");
  await fn();
  await page.mouse.click(195, 60);
  await page.waitForSelector(".sheet-backdrop", { state: "hidden" });
}

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
  const sheetMidY = await page.$eval(".sheet", (e) => e.getBoundingClientRect().top);
  await page.waitForSelector(".sheet .opts");
  await page.$eval(".sheet", (e) => Promise.all(e.getAnimations().map((a) => a.finished)));
  const sheetRestY = await page.$eval(".sheet", (e) => e.getBoundingClientRect().top);
  check("opening a sheet under normal motion slides up (not instantly at rest)",
    sheetMidY > sheetRestY);
  await page.click('.sheet .opts button[data-v="15"]');
  const upperSum = await page.$$eval("#upperCol .box.filled .val", (els) =>
    els.reduce((a, e) => a + Number(e.textContent), 0));
  check(`bonus line shows upper total ${upperSum} after setting Fives=15`,
    (await page.textContent("#bonusLine")).includes(`Upper total ${upperSum}`));
  check("bonus/total line sits above the board (both scorecards)",
    await page.evaluate(() => {
      const above = (line, board) =>
        !!(line.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING);
      return above(document.getElementById("bonusLine"), document.getElementById("upperCol"))
        && above(document.getElementById("playBonusLine"), document.getElementById("playUpperCol"));
    }));
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
  check("advisor chart x-axis is 'boxes filled'",
    (await page.$eval(".sheet svg.chart", (e) => e.textContent)).includes("boxes filled"));
  check("advisor chart shows optimal glide-path reference line",
    (await page.$(".sheet .c-ref")) !== null);
  check("reference line tooltip identifies the optimal glide path",
    (await page.$eval(".sheet .c-ref title", (e) => e.textContent)).includes("Optimal"));
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
  await page.click("#settingsBtn");
  await page.waitForSelector(".sheet .set-rows");
  check("gear animates open", await page.$eval("#settingsBtn", (b) => b.classList.contains("open")));
  check("advisor-mode settings omit the play-only advice toggle",
    (await page.$(".sheet #adviceToggle")) === null);
  check("settings default: theme Auto selected",
    await page.$eval('#themeSeg button[data-theme="auto"]', (b) => b.classList.contains("on")));
  await page.click('#themeSeg button[data-theme="light"]');
  check("forced light overrides dark system pref", (await bodyBg()) === "rgb(244, 245, 247)");
  await page.mouse.click(195, 60);
  await page.waitForSelector(".sheet-backdrop", { state: "hidden" });
  check("gear animation resets on close",
    !(await page.$eval("#settingsBtn", (b) => b.classList.contains("open"))));
  await page.reload({ waitUntil: "networkidle" });
  check("theme choice persists", (await bodyBg()) === "rgb(244, 245, 247)");
  await withSettings(page, async () => {
    check("persisted theme selected in settings",
      await page.$eval('#themeSeg button[data-theme="light"]', (b) => b.classList.contains("on")));
    await page.click('#themeSeg button[data-theme="auto"]');
  });
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
  // offsetParent, not the attribute: a CSS display rule can defeat [hidden].
  check("advice card actually not displayed with the toggle off",
    await page.$eval("#advice", (e) => e.hidden && e.offsetParent === null));
  await page.click("#playNewBtn");
  await page.waitForSelector('.sheet button[data-n="2"]');
  await page.click('.sheet button[data-n="2"]');
  check("round 1, player 1", (await page.textContent("#playTurnInfo")).includes("Round 1/12 — Player 1"));
  // Disable the roll animation so dice values can be read immediately.
  await withSettings(page, async () => {
    await page.click("#animToggle");
    check("animation toggle off hides the speed control",
      !(await page.$eval("#animToggle", (e) => e.checked))
      && await page.$eval("#animSpeedRow", (e) => e.hidden));
  });

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
  // Final roll: holding is meaningless with no rerolls left, so the dice stop
  // being controls rather than staying live-looking and swallowing taps
  // (renderPlay's finalRoll branch, docs/app.js). A plain page.click() would
  // hang here waiting for the button to become enabled — that IS the fix.
  check("final-roll dice are disabled",
    await page.$$eval("#playDiceRow .die", (els) => els.length === 5 && els.every((e) => e.disabled)));
  check("final-roll dice drop the tap-to-toggle affordance",
    await page.$$eval("#playDiceRow .die", (els) => els.every((e) => {
      const label = e.getAttribute("aria-label") || "";
      return label.includes("no rerolls left") && !label.includes("tap to toggle");
    })));
  check("final-roll dice show no pointer cursor",
    await page.$$eval("#playDiceRow .die",
      (els) => els.every((e) => getComputedStyle(e).cursor !== "pointer")));
  const beforeHold = (await held()).join();
  // Native .click() on a disabled button is a no-op, so this asserts the tap
  // has no effect without waiting on Playwright's actionability checks.
  await page.$eval("#playDiceRow .die:nth-child(3)", (e) => e.click());
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
  await withSettings(page, async () => {
    check("advice defaults off", !(await page.$eval("#adviceToggle", (e) => e.checked)));
    await page.click("#adviceToggle");
  });
  check("advice card sits between round card and scorecard",
    await page.evaluate(() => {
      const a = document.getElementById("advice");
      return a.parentElement.id === "playView"
        && a.nextElementSibling?.id === "playScoreSection" && !a.hidden;
    }));
  await page.screenshot({ path: join(SHOTS, "play_advice_placement.png") });
  await page.click("#rollBtn");
  await page.waitForSelector(".advice-title");
  const title = (await page.textContent(".advice-title")).trim();
  if (title.startsWith("Keep")) {
    // Auto-hold: the recommendation is pre-selected — no button, no chip.
    const kept = (await held()).filter(Boolean).length;
    check("advice keep auto-held after the roll", kept > 0 && kept < 5);
    check("no restore button while holds match advice", (await page.$("#adviceApplyBtn")) === null);
    check("no override chip when holds match advice", (await page.$(".over-chip")) === null);

    // Deviating (holding one extra die) prices the deviation and offers a way back.
    check("matching holds are blue (no deviate class)",
      (await page.$$eval("#playDiceRow .die.deviate", (e) => e.length)) === 0);
    const extraDie = await page.$$eval("#playDiceRow .die", (els) =>
      els.findIndex((e) => !e.classList.contains("kept")) + 1);
    await page.click(`#playDiceRow .die:nth-child(${extraDie})`);
    await page.waitForSelector(".over-chip");
    const chipText = await page.textContent(".over-chip");
    check("deviating holds show the override chip with EV cost",
      chipText.includes("Your hold:") && /−\d+\.\d+\s*pts/.test(chipText.replace(/\s+/g, " ")));
    check("restore button appears on deviation",
      (await page.textContent("#adviceApplyBtn")).includes("Restore advised hold"));
    // Every held die turns amber while deviating, chip and dice matching.
    const deviateStyles = await page.$$eval("#playDiceRow .die.kept", (els) =>
      els.map((e) => ({ dev: e.classList.contains("deviate"),
                        border: getComputedStyle(e).borderColor })));
    check("all held dice go amber while deviating",
      deviateStyles.length === kept + 1
      && deviateStyles.every((s) => s.dev && s.border === "rgb(160, 106, 0)"));
    await page.click("#adviceApplyBtn");
    check("restore clears the chip, amber, and re-syncs holds",
      (await page.$(".over-chip")) === null
      && (await page.$$eval("#playDiceRow .die.deviate", (e) => e.length)) === 0
      && (await held()).filter(Boolean).length === kept);
  }

  // Score-stage pick: after the final roll the recommended box is pre-picked
  // (blue), contributing dice highlighted; tapping another box moves the pick
  // (amber + chip), tapping the picked box banks it.
  while (!(await page.$eval("#rollBtn", (b) => b.disabled || b.hidden))) {
    await page.click("#rollBtn");
  }
  await page.waitForSelector(".box.picked");
  check("recommended box pre-picked in blue",
    (await page.$(".box.picked.pick-deviate")) === null);
  const recName = await page.$eval(".box.picked .name", (e) => e.textContent);
  const recPts = await page.$eval(".box.picked .val", (e) => Number(e.textContent.replace("+", "")));
  if (recPts > 0) {
    check("contributing dice highlighted for the recommended box",
      (await page.$$eval("#playDiceRow .die.kept", (e) => e.length)) > 0
      && (await page.$$eval("#playDiceRow .die.deviate", (e) => e.length)) === 0);
  }
  const otherBox = await page.$$eval(".box.scoreable", (els) => {
    const el = els.find((e) => !e.classList.contains("picked"));
    return el ? el.querySelector(".name").textContent : null;
  });
  await page.$$eval(".box.scoreable", (els) =>
    els.find((e) => !e.classList.contains("picked")).click());
  await page.waitForSelector(".box.picked.pick-deviate");
  check(`picking "${otherBox}" turns the pick amber with a priced chip`,
    (await page.$eval(".box.picked .name", (e) => e.textContent)) === otherBox
    && (await page.textContent(".over-chip")).includes("Your pick:"));
  check("button follows the override pick",
    (await page.textContent("#adviceApplyBtn")).startsWith(`Score ${otherBox}`));
  await page.$$eval(".box.scoreable", (els, name) =>
    els.find((e) => e.querySelector(".name").textContent === name).click(), recName);
  check("re-picking the recommendation clears the amber",
    (await page.$(".box.picked.pick-deviate")) === null
    && (await page.$(".over-chip")) === null);
  await page.$$eval(".box.picked", (els) => els[0].click());   // second tap banks
  check("tapping the picked box again banks it",
    (await page.$$eval("#playDiceRow .die", (e) => e.length)) === 0);

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
  const chartText = await page.$eval(".sheet svg.chart", (e) => e.textContent);
  check("play chart x-axis is 'turn' with after-turn tooltips",
    chartText.includes("turn") && chartText.includes("after turn")
    && !chartText.includes("boxes filled"));
  check("play-mode chart shows optimal glide-path reference line",
    (await page.$(".sheet .c-ref")) !== null);
  check("reference line tooltip identifies the optimal glide path (play mode)",
    (await page.$eval(".sheet .c-ref title", (e) => e.textContent)).includes("Optimal"));
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

// ═══ 5. Roll animation ══════════════════════════════════════════════════════
{
  const { ctx, page } = await newPage();
  await page.click('#modeSeg button[data-mode="play"]');
  await page.click("#playNewBtn");
  await page.waitForSelector('.sheet button[data-n="1"]');
  await page.click('.sheet button[data-n="1"]');

  await withSettings(page, async () => {
    check("animation defaults on with speed control visible (Normal)",
      await page.$eval("#animToggle", (e) => e.checked)
      && !(await page.$eval("#animSpeedRow", (e) => e.hidden))
      && await page.$eval('#animSpeedSeg button[data-speed="normal"]', (b) => b.classList.contains("on")));
  });

  await page.click("#rollBtn");
  check("dice tumble during the roll", (await page.$$eval(".die.rolling", (e) => e.length)) === 5);
  check("roll button locked while rolling",
    await page.$eval("#rollBtn", (b) => b.disabled && b.textContent === "Rolling…"));
  check("no score previews while rolling", (await page.$$eval(".box.scoreable", (e) => e.length)) === 0);
  await page.waitForSelector(".die.rolling", { state: "detached", timeout: 2500 });
  check("dice settle and previews appear",
    (await page.$$eval(".box.scoreable", (e) => e.length)) === 12
    && await page.$eval("#rollBtn", (b) => !b.disabled));

  // Speed control: fast settles well before slow's duration.
  await withSettings(page, () => page.click('#animSpeedSeg button[data-speed="fast"]'));
  await page.click("#playDiceRow .die:nth-child(1)");   // hold one die
  await page.click("#rollBtn");
  check("held die does not tumble", (await page.$$eval(".die.rolling", (e) => e.length)) === 4);
  await page.waitForTimeout(700);                        // fast = 400ms
  check("fast roll settled by 700ms", (await page.$$eval(".die.rolling", (e) => e.length)) === 0);
  await withSettings(page, () => page.click('#animSpeedSeg button[data-speed="slow"]'));
  await page.click("#rollBtn");
  await page.waitForTimeout(900);                        // slow = 1400ms
  check("slow roll still tumbling at 900ms", (await page.$$eval(".die.rolling", (e) => e.length)) > 0);
  await page.waitForSelector(".die.rolling", { state: "detached", timeout: 2500 });

  // Settings persist.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.getElementById("evValue").textContent !== "–");
  await withSettings(page, async () => {
    check("speed choice persists (slow)",
      await page.$eval('#animSpeedSeg button[data-speed="slow"]', (b) => b.classList.contains("on")));
    await page.click("#animToggle");
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.getElementById("evValue").textContent !== "–");
  await withSettings(page, async () => {
    check("animation off persists", !(await page.$eval("#animToggle", (e) => e.checked)));
  });
  await ctx.close();
}

// ═══ 6. Layout stability ════════════════════════════════════════════════════
// Advice-card content churn (prompt <-> full advice <-> "Rolling…") must not
// move the cards below it.
{
  const { ctx, page } = await newPage();
  const box = (sel) => page.locator(sel).boundingBox();

  // Advisor: empty prompt vs full advice, same card height.
  const hEmpty = (await box("#advice")).height;
  for (const f of [3, 3, 5, 2, 6]) await page.click(`#dicePad button[data-face="${f}"]`);
  await page.waitForSelector(".advice-title");
  check("advisor: advice card height stable prompt -> keep advice",
    Math.abs((await box("#advice")).height - hEmpty) < 1);

  // Play mode with advice on: scorecard must not move while rolling settles.
  await page.click('#modeSeg button[data-mode="play"]');
  await page.click("#playNewBtn");
  await page.waitForSelector('.sheet button[data-n="1"]');
  await page.click('.sheet button[data-n="1"]');
  await withSettings(page, () => page.click("#adviceToggle"));
  const yBefore = (await box("#playScoreSection")).y;
  await page.click("#rollBtn");                       // animation on: "Rolling…"
  check("scorecard fixed while dice tumble",
    Math.abs((await box("#playScoreSection")).y - yBefore) < 1);
  await page.waitForSelector(".die.rolling", { state: "detached", timeout: 2500 });
  await page.waitForSelector(".advice-title");
  check("scorecard fixed after advice renders",
    Math.abs((await box("#playScoreSection")).y - yBefore) < 1);
  await ctx.close();
}

// ═══ 7. Cache-busting update check ══════════════════════════════════════════
// A stamped page whose build differs from version.json refreshes itself once,
// keeping localStorage intact; matching builds never reload.
{
  const indexSrc = await readFile(join(DOCS, "index.html"), "utf8");
  overrides.set("/index.html", indexSrc.replaceAll("__BUILD__", "buildA"));
  overrides.set("/version.json", JSON.stringify({ build: "buildB" }));
  indexHits = 0;

  const ctx = await browser.newContext({ viewport: MOBILE });
  await ctx.addInitScript(() => {
    if (!localStorage.getItem("test-marker")) localStorage.setItem("test-marker", "kept");
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  // initial load + cache-priming fetch + reload = 3 index requests
  await new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (indexHits >= 3) { clearInterval(iv); resolve(); }
      else if (Date.now() - t0 > 6000) { clearInterval(iv); reject(new Error("page never self-refreshed")); }
    }, 50);
  }).catch((e) => check(e.message, false));
  check("stale build self-refreshes (prime + reload)", indexHits >= 3);
  await page.waitForFunction(() => document.getElementById("evValue") !== null);
  check("one refresh attempt per build (guard set)",
    await page.evaluate(() => sessionStorage.getItem("yacht-solver-reloaded-for")) === "buildB");
  check("localStorage survives the refresh",
    await page.evaluate(() => localStorage.getItem("test-marker")) === "kept");

  // Matching build: no reload.
  overrides.set("/version.json", JSON.stringify({ build: "buildA" }));
  indexHits = 0;
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  check("matching build never reloads", indexHits === 1);
  overrides.clear();
  await ctx.close();
}

// ═══ 8. Reduced motion preference ═══════════════════════════════════════════
{
  const { ctx, page } = await newPage({ reducedMotion: "reduce" });
  await page.click('#modeSeg button[data-mode="play"]');
  await withSettings(page, async () => {
    check("prefers-reduced-motion defaults the animation off",
      !(await page.$eval("#animToggle", (e) => e.checked)));
    check("prefers-reduced-motion disables the sheet slide-up animation",
      (await page.$eval(".sheet", (e) => getComputedStyle(e).animationName)) === "none");
    check("prefers-reduced-motion disables the backdrop fade-in animation",
      (await page.$eval(".sheet-backdrop", (e) => getComputedStyle(e).animationName)) === "none");
  });
  await ctx.close();
}

await browser.close();
server.close();

if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n` + errors.join("\n"));
  process.exit(1);
}
console.log(`\nALL ${checks} UI CHECKS PASSED`);

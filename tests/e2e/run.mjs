// End-to-end test in a real browser (Edge/Chrome via playwright-core) with a
// fake camera. Recognition input is injected through the ?test=1 hook with
// synthetic feature frames, while MediaPipe runs on the fake camera stream.
//
// Usage: node tests/e2e/run.mjs [camera.y4m] [--prefix repo-name]
//   camera.y4m  optional video for the fake camera (a person with visible hands
//               lets the run also check real hand detection)
//   --prefix    serve under /<prefix>/ like a GitHub Pages project site
import { readFileSync } from "node:fs";
import { startServer, launch, newPage } from "./lib.mjs";

const args = process.argv.slice(2);
const pi = args.indexOf("--prefix");
const prefix = pi >= 0 ? args.splice(pi, 2)[1] : "";
const y4m = args[0];

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`,
  );
};

const server = await startServer({ port: 8125, prefix });
const browser = await launch({ y4m });
let exitCode = 0;
try {
  const origin = new URL(server.url).origin;
  const { page, consoleErrors, context } = await newPage(browser, { origin });
  await page.goto(server.url + "?test=1");
  await page.click("#start");
  await page.waitForFunction(() => window.__shuwa?.state().running, null, {
    timeout: 60000,
  });
  // The first GPU inference compiles shaders (several seconds in headless Edge).
  await page.waitForFunction(
    () => window.__shuwa.state().detStats.frames > 20,
    null,
    { timeout: 90000 },
  );
  const s0 = await page.evaluate(() => window.__shuwa.state());
  check(
    "camera + MediaPipe running",
    s0.detStats.frames > 10,
    JSON.stringify(s0.detStats),
  );
  if (y4m)
    check(
      "hands detected in the fake camera video",
      s0.detStats.handFrames > 5,
      `${s0.detStats.handFrames}/${s0.detStats.frames} frames`,
    );

  await page.evaluate(() => window.__shuwa.takeover());
  // ---- fingerspelling: た・な・か via injected frames
  const feed = (expr) =>
    page.evaluate(async (expr) => {
      const fr = await import(
        new URL("tests/testkit/frames.mjs", location.href).href
      );
      const wm = await import(
        new URL("tests/testkit/word-moves.mjs", location.href).href
      );
      const HERE = { x: 0.3, y: 0 };
      const away = (ms) =>
        Array.from({ length: Math.round(ms / 33) }, (_, i) =>
          fr.frame(i * 33, {}),
        );
      const still = (shape, ms) => fr.hold({ D: { shape, at: HERE } }, { ms });
      const settle = (frames, ms = 350) => {
        const last = frames[frames.length - 1];
        return frames.concat(
          Array.from({ length: Math.round(ms / 33) }, (_, i) => ({
            ...last,
            t: last.t + (i + 1) * 33,
          })),
        );
      };
      const cat = (...parts) => {
        const out = [];
        let t = 0;
        for (const p of parts) {
          for (const f of p) out.push({ ...f, t: t + f.t });
          t = out[out.length - 1].t + 33;
        }
        return out;
      };
      const frames = new Function(
        "fr",
        "wm",
        "away",
        "still",
        "settle",
        "cat",
        `return ${expr};`,
      )(fr, wm, away, still, settle, cat);
      window.__shuwa.feed(frames);
      return window.__shuwa.state();
    }, expr);

  let s = await feed(
    `cat(still("た", 800), still("な", 800), still("か", 800))`,
  );
  check(
    "fingerspelling た・な・か appears as a caption",
    s.caption.includes("たなか"),
    `caption="${s.caption}"`,
  );
  s = await feed(
    `cat(away(300), settle(wm.WORD_MOVES["ありがとう"]({})), away(2600))`,
  );
  check(
    "word ありがとう recognised and the line is closed",
    s.lines.join("|") === "たなか ありがとう",
    JSON.stringify(s.lines),
  );
  s = await feed(
    `cat(wm.WORD_MOVES["昼"]({}), away(200), settle(wm.WORD_MOVES["挨拶"]({})), away(300))`,
  );
  check(
    "compound 昼+挨拶 → こんにちは",
    s.lines[1] === "こんにちは",
    JSON.stringify(s.lines),
  );

  const transcriptText = await page.locator("#transcript").innerText();
  check(
    "transcript panel lists both lines",
    transcriptText.includes("たなか ありがとう") &&
      transcriptText.includes("こんにちは"),
  );

  // ---- hand edit: Escape cancels (blur must not commit), Enter commits once
  const firstEdit = page
    .locator("#transcript li")
    .nth(1)
    .getByRole("button", { name: /直す/ });
  await firstEdit.click();
  await page.keyboard.type("消えるべき");
  await page.keyboard.press("Escape");
  s = await page.evaluate(() => window.__shuwa.state());
  check(
    "Escape cancels a line edit",
    s.lines[1] === "こんにちは",
    JSON.stringify(s.lines),
  );
  await page
    .locator("#transcript li")
    .nth(1)
    .getByRole("button", { name: /直す/ })
    .click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("こんにちは!");
  await page.keyboard.press("Enter");
  s = await page.evaluate(() => window.__shuwa.state());
  check(
    "Enter saves a line edit",
    s.lines[1] === "こんにちは!" && s.lines.length === 2,
    JSON.stringify(s.lines),
  );

  // ---- downloads
  for (const ext of ["txt", "csv", "srt", "json"]) {
    const [dl] = await Promise.all([
      page.waitForEvent("download"),
      page.click(`[data-dl="${ext}"]`),
    ]);
    const path = await dl.path();
    const body = readFileSync(path, "utf8");
    const okName =
      /^手話記録_\d{8}_\d{4}\./.test(dl.suggestedFilename()) &&
      dl.suggestedFilename().endsWith("." + ext);
    const okBody =
      ext === "json"
        ? JSON.parse(body).text.includes("こんにちは")
        : ext === "csv"
          ? body.charCodeAt(0) === 0xfeff && body.includes("ありがとう")
          : ext === "srt"
            ? /^1\n\d\d:\d\d:\d\d,\d{3} --> /.test(body) &&
              body.includes("たなか ありがとう")
            : body.includes("たなか ありがとう\n");
    check(`download .${ext}`, okName && okBody, dl.suggestedFilename());
  }

  // ---- video recording with captions
  await page.click("#rec");
  await page.waitForTimeout(2500);
  await page.click("#rec");
  await page.waitForSelector("#video-dl:not([hidden])", { timeout: 10000 });
  const vid = await page.evaluate(async () => {
    const a = document.getElementById("video-link");
    const b = await (await fetch(a.href)).blob();
    return { size: b.size, type: b.type, name: a.download };
  });
  check("recorded video is non-empty", vid.size > 10000, JSON.stringify(vid));

  // ---- dictionary registration (static sign, 3 samples) and use
  await page.click("#tab-dict");
  await page.fill("#reg-label", "テスト");
  await page.check('input[name="kind"][value="static"]');
  await page.click("#reg-start");
  for (let i = 0; i < 3; i++)
    s = await feed(`cat(still("か", 900), away(250))`);
  check(
    "3 samples captured during registration",
    s.reg?.n === 3,
    JSON.stringify(s.reg),
  );
  await page.click("#reg-save");
  await page.waitForFunction(() => window.__shuwa.state().signs.length === 1);
  s = await feed(`cat(away(2600), still("か", 900))`);
  check(
    "registered sign overrides the built-in kana",
    s.caption.endsWith("テスト"),
    `caption="${s.caption}"`,
  );

  // ---- persistence across reload (IndexedDB)
  await page.waitForTimeout(900);
  await page.reload();
  await page.waitForFunction(() => window.__shuwa);
  const persisted = await page.evaluate(() => window.__shuwa.state());
  const historyText = await page.locator("#history").innerText();
  check(
    "dictionary persists after reload",
    persisted.signs.length === 1 && persisted.signs[0].label === "テスト",
  );
  check(
    "previous session appears in history",
    historyText.includes("たなか ありがとう"),
    historyText.slice(0, 80),
  );

  check(
    "no console errors",
    consoleErrors.length === 0,
    consoleErrors.join(" | ").slice(0, 300),
  );
  check(
    "no 404 responses",
    server.notFound.filter((l) => !l.includes("favicon")).length === 0,
    server.notFound.join(" | "),
  );
  await context.close();
} catch (e) {
  console.error(e);
  check("run completed", false, String(e).slice(0, 300));
} finally {
  await browser.close();
  server.stop();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  exitCode = failed ? 1 : 0;
  process.exit(exitCode);
}

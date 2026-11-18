// Screenshots + layout audit at 1440 / 768 / 390 px with the camera running and
// captions injected. Usage: node tests/e2e/screens.mjs <outDir> [camera.y4m]
// Runs ~/.claude/skills/htmlpage/references/audit.js when present (overflow,
// clipping, contrast, tiny text) and always measures scrollWidth <= innerWidth.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { startServer, launch, newPage } from "./lib.mjs";

const [outDir = "screens", y4m] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const auditPath = join(
  homedir(),
  ".claude/skills/htmlpage/references/audit.js",
);
const audit = existsSync(auditPath)
  ? readFileSync(auditPath, "utf8").replace(/^\s*\/\/.*$/gm, "")
  : null;

const server = await startServer({ port: 8126 });
const browser = await launch({ y4m });
const report = [];
try {
  for (const [w, h] of [
    [1440, 900],
    [768, 1024],
    [390, 844],
  ]) {
    const { page, context, consoleErrors } = await newPage(browser, {
      width: w,
      height: h,
      origin: new URL(server.url).origin,
    });
    await page.goto(server.url + "?test=1");
    await page.screenshot({ path: join(outDir, `intro-${w}.png`) });
    await page.click("#start");
    await page.waitForFunction(
      () => window.__shuwa?.state().detStats.frames > 15,
      null,
      { timeout: 90000 },
    );
    await page.evaluate(async () => {
      window.__shuwa.takeover();
      const fr = await import(
        new URL("tests/testkit/frames.mjs", location.href).href
      );
      const wm = await import(
        new URL("tests/testkit/word-moves.mjs", location.href).href
      );
      const at = { x: 0.3, y: 0 };
      const away = (ms) =>
        Array.from({ length: Math.round(ms / 33) }, (_, i) =>
          fr.frame(i * 33, {}),
        );
      window.__shuwa.feed(wm.WORD_MOVES["昼"]({}));
      window.__shuwa.feed(wm.WORD_MOVES["挨拶"]({}));
      window.__shuwa.feed(away(2600));
      for (const k of ["た", "な", "か"])
        window.__shuwa.feed(fr.hold({ D: { shape: k, at } }, { ms: 800 }));
      // leave a pending (unconfirmed) kana with the gauge half full
      window.__shuwa.feed(
        away(300).concat(fr.hold({ D: { shape: "て", at } }, { ms: 300, t0: 300 })),
      );
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(outDir, `live-${w}.png`) });
    await page.screenshot({
      path: join(outDir, `live-${w}-full.png`),
      fullPage: true,
    });
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: innerWidth,
    }));
    let auditRes = null;
    if (audit) auditRes = await page.evaluate(`(${audit})()`);
    for (const tab of ["tab-dict", "tab-settings", "tab-help"]) {
      await page.click("#" + tab);
      await page.screenshot({
        path: join(outDir, `${tab}-${w}.png`),
        fullPage: true,
      });
      const o = await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      );
      if (!o) overflow[tab] = "OVERFLOW";
    }
    report.push({
      width: w,
      overflow,
      audit: auditRes && {
        pass: auditRes.pass,
        fails: auditRes.fails?.slice(0, 8),
      },
      consoleErrors,
    });
    await context.close();
  }
} finally {
  await browser.close();
  server.stop();
}
console.log(JSON.stringify(report, null, 1));

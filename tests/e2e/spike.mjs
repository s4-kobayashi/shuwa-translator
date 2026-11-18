// Spike: does the vendored MediaPipe runtime detect hands + pose from a real
// camera stream in Edge? Usage: node tests/e2e/spike.mjs <file.y4m> [seconds] [out.json]
import { writeFileSync } from "node:fs";
import { startServer, launch, newPage } from "./lib.mjs";

const [y4m, seconds = "6", outJson] = process.argv.slice(2);
const server = await startServer({ port: 8124 });
const browser = await launch({ y4m });
try {
  const { page, consoleErrors } = await newPage(browser, {
    origin: server.url.replace(/\/$/, ""),
  });
  await page.goto(server.url + "tests/e2e/spike.html");
  await page.waitForTimeout(Number(seconds) * 1000);
  const stats = await page.evaluate(() => window.__spike);
  const summary = {
    delegate: stats.delegate,
    hasPose: stats.hasPose,
    frames: stats.frames,
    handFrames: stats.handFrames,
    maxHands: stats.maxHands,
    poseFrames: stats.poseFrames,
    fps: Number((stats.fps || 0).toFixed(1)),
    msPerFrame: Number((stats.ms / Math.max(1, stats.frames)).toFixed(1)),
    errors: stats.errors,
    consoleErrors,
    notFound: server.notFound,
  };
  console.log(JSON.stringify(summary, null, 1));
  if (outJson) writeFileSync(outJson, JSON.stringify(stats.samples));
} finally {
  await browser.close();
  server.stop();
}

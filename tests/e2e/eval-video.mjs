// Accuracy on real signing videos. Each clip is played to the app as its camera
// (Chromium fake capture), recognised by the same code as the live site, and
// the transcript is compared with the expected text.
//
// Usage: node tests/e2e/eval-video.mjs manifest.json [--url https://…/] [--out result.json]
//
// manifest.json: [{ "file": "a.mp4", "expect": "ありがとう" }, ...]
//   file    video path (relative paths resolve against the manifest's folder)
//   expect  what is signed, in order, as the app should write it ("たなか ありがとう").
//           Use "" for signs outside the vocabulary: the right output is nothing.
//
// Needs ffmpeg/ffprobe on PATH. Videos are converted to .y4m in the OS temp
// folder; nothing is uploaded.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, basename } from "node:path";
import { startServer, launch, newPage } from "./lib.mjs";

const args = process.argv.slice(2);
const take = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args.splice(i, 2)[1] : "";
};
const remoteUrl = take("--url");
const outFile = take("--out");
const manifestPath = args[0];
if (!manifestPath) {
  console.error(
    "usage: node tests/e2e/eval-video.mjs manifest.json [--url URL] [--out result.json]",
  );
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const base = dirname(resolve(manifestPath));

// Before the signing starts the app needs a few seconds (GPU shader compile on
// the first inference). The clip is preceded by this much empty grey frame.
const LEAD_S = 10;
const TAIL_MS = 3000; // after the clip: let the last hold/segment commit

function probeDuration(file) {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { encoding: "utf8" },
  );
  const d = parseFloat(r.stdout);
  if (!Number.isFinite(d))
    throw new Error(`cannot read duration of ${file}: ${r.stderr}`);
  return d;
}

function toY4m(file, out) {
  const vf = [
    "scale=640:-2",
    "fps=30",
    `tpad=start_duration=${LEAD_S}:start_mode=add:color=gray`,
    "format=yuv420p",
  ].join(",");
  const r = spawnSync(
    "ffmpeg",
    ["-v", "error", "-y", "-i", file, "-an", "-vf", vf, out],
    {
      encoding: "utf8",
    },
  );
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${file}: ${r.stderr}`);
}

const norm = (s) => s.replace(/\s+/g, "");
function editDistance(a, b) {
  const A = [...a],
    B = [...b];
  let prev = Array.from({ length: B.length + 1 }, (_, j) => j);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    for (let j = 1; j <= B.length; j++)
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1),
      );
    prev = cur;
  }
  return prev[B.length];
}

const server = remoteUrl
  ? { url: remoteUrl.replace(/\/?$/, "/"), stop() {} }
  : await startServer({ port: 8126 });
const work = mkdtempSync(join(tmpdir(), "shuwa-eval-"));
const rows = [];
try {
  for (const item of manifest) {
    const file = resolve(base, item.file);
    const expect = item.expect ?? "";
    const dur = probeDuration(file);
    const y4m = join(work, basename(file).replace(/\.[^.]+$/, "") + ".y4m");
    toY4m(file, y4m);

    // One browser per clip: the fake camera file is a launch argument.
    const browser = await launch({ y4m });
    let got = "",
      detail = {};
    try {
      const { page, context, consoleErrors } = await newPage(browser, {
        origin: new URL(server.url).origin,
      });
      await page.goto(server.url + "?test=1");
      await page.click("#start");
      const t0 = Date.now();
      await page.waitForFunction(
        () => window.__shuwa?.state().detStats.frames > 5,
        null,
        {
          timeout: LEAD_S * 1000 - 500,
        },
      );
      // Clean session, but keep camera detections flowing into the recogniser.
      await page.evaluate(() => {
        window.__shuwa.takeover();
        window.__shuwa.releaseFeed();
      });
      // The fake camera loops the file: stop before it starts again.
      const endAt = t0 + LEAD_S * 1000 + dur * 1000 + TAIL_MS;
      await page.waitForTimeout(Math.max(0, endAt - Date.now()));
      const s = await page.evaluate(() => window.__shuwa.state());
      got = s.lines.join(" ").trim();
      detail = { detStats: s.detStats, consoleErrors };
      await context.close();
    } finally {
      await browser.close();
      rmSync(y4m, { force: true });
    }
    const dist = editDistance(norm(expect), norm(got));
    const row = {
      file: item.file,
      expect,
      got,
      exact: norm(expect) === norm(got),
      errors: dist,
      chars: [...norm(expect)].length,
      handFrames: `${detail.detStats?.handFrames}/${detail.detStats?.frames}`,
    };
    rows.push(row);
    console.log(
      `${row.exact ? "OK  " : "MISS"}  ${item.file}  expect="${expect}"  got="${got}"  hands=${row.handFrames}`,
    );
  }
} finally {
  server.stop();
  rmSync(work, { recursive: true, force: true });
}

const n = rows.length;
const exact = rows.filter((r) => r.exact).length;
const inVocab = rows.filter((r) => r.expect);
const outVocab = rows.filter((r) => !r.expect);
const chars = inVocab.reduce((a, r) => a + r.chars, 0);
const errs = inVocab.reduce((a, r) => a + r.errors, 0);
const summary = {
  clips: n,
  exactMatch: `${exact}/${n}`,
  characterErrorRate: chars ? +(errs / chars).toFixed(3) : null,
  outOfVocabularyCorrectlySilent: `${outVocab.filter((r) => r.exact).length}/${outVocab.length}`,
};
console.log("\n" + JSON.stringify(summary, null, 1));
if (outFile) writeFileSync(outFile, JSON.stringify({ summary, rows }, null, 1));

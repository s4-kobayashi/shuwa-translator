// Run real videos through the app's camera pipeline (MediaPipe + frameFeatures)
// and save the per-frame feature frames, so the recogniser can be evaluated and
// tuned offline (tests/realdata/replay.mjs) without re-running MediaPipe.
//
// Usage: node tests/e2e/dump-features.mjs clips.json outdir [--batch 15]
//
// clips.json: [{ "name": "c0", "file": "a.webm", "start"?: s, "end"?: s, "crop"?: "w:h:x:y" }]
// Relative paths resolve against clips.json's folder. Writes outdir/<name>.json
// = { name, frames }. Clips are concatenated with grey gaps into one fake-camera
// stream per batch; frames are assigned to clips by video time.
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { startServer, launch, newPage } from "./lib.mjs";

const args = process.argv.slice(2);
const bi = args.indexOf("--batch");
const BATCH = bi >= 0 ? Number(args.splice(bi, 2)[1]) : 15;
const [clipsPath, outDir] = args;
if (!clipsPath || !outDir) {
  console.error("usage: node tests/e2e/dump-features.mjs clips.json outdir");
  process.exit(2);
}
const clips = JSON.parse(readFileSync(clipsPath, "utf8"));
const base = dirname(resolve(clipsPath));
mkdirSync(outDir, { recursive: true });

const LEAD = 10; // s of grey before the first clip (GPU warm-up)
const GAP = 2; // s of grey between clips

function duration(file) {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { encoding: "utf8" },
  );
  return parseFloat(r.stdout);
}

function buildY4m(batch, out) {
  const inputs = [];
  const parts = [];
  batch.forEach((c, i) => {
    if (c.start != null) inputs.push("-ss", String(c.start));
    if (c.end != null) inputs.push("-to", String(c.end));
    inputs.push("-i", c.path);
    const pre = i === 0 ? LEAD : 0;
    parts.push(
      `[${i}:v]${c.crop ? `crop=${c.crop},` : ""}scale=640:480:force_original_aspect_ratio=decrease,` +
        `pad=640:480:(ow-iw)/2:(oh-ih)/2:color=gray,setsar=1,fps=30,format=yuv420p,` +
        `tpad=start_duration=${pre}:start_mode=add:color=gray:stop_duration=${GAP}:stop_mode=add:color=gray[v${i}]`,
    );
  });
  const filter =
    parts.join(";") +
    ";" +
    batch.map((_, i) => `[v${i}]`).join("") +
    `concat=n=${batch.length}:v=1:a=0[out]`;
  const r = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      ...inputs,
      "-filter_complex",
      filter,
      "-map",
      "[out]",
      out,
    ],
    { encoding: "utf8", maxBuffer: 1 << 26 },
  );
  if (r.status !== 0) throw new Error(r.stderr);
}

const server = await startServer({ port: 8127 });
const work = mkdtempSync(join(tmpdir(), "shuwa-dump-"));
try {
  for (let b = 0; b < clips.length; b += BATCH) {
    const batch = clips.slice(b, b + BATCH).map((c) => {
      const path = resolve(base, c.file);
      const full = duration(path);
      const dur = Math.min(c.end ?? full, full) - (c.start ?? 0);
      return { ...c, path, dur };
    });
    // Clip windows in stream time.
    let t = LEAD;
    for (const c of batch) {
      c.from = t;
      c.to = t + c.dur;
      t = c.to + GAP;
    }
    const total = t;
    const y4m = join(work, `batch${b}.y4m`);
    buildY4m(batch, y4m);

    const browser = await launch({ y4m });
    try {
      const { page, context } = await newPage(browser, {
        origin: new URL(server.url).origin,
      });
      await page.goto(server.url + "?test=1");
      await page.click("#start");
      await page.waitForFunction(() => window.__shuwa?.state().running, null, {
        timeout: 30000,
      });
      await page.evaluate(() => window.__shuwa.logFeatures());
      // Stop before the fake camera loops back to the start of the file.
      await page.waitForFunction(
        (end) => document.querySelector("video").currentTime >= end,
        total - 0.5,
        { timeout: (total + 30) * 1000, polling: 250 },
      );
      const frames = await page.evaluate(() => window.__shuwa.takeFeatures());
      const firstVt = frames[0]?.vt ?? 0;
      if (firstVt > LEAD - 1)
        console.warn(
          `batch ${b}: logging started late (vt ${firstVt.toFixed(1)} s)`,
        );
      for (const c of batch) {
        const fs = frames.filter(
          (f) => f.vt >= c.from - 0.3 && f.vt < c.to + GAP - 0.3,
        );
        writeFileSync(
          join(outDir, `${c.name}.json`),
          JSON.stringify({ name: c.name, frames: fs }),
        );
        const hands = fs.filter((f) => f.D || f.N).length;
        console.log(`${c.name}: ${fs.length} frames, ${hands} with hands`);
      }
      await context.close();
    } finally {
      await browser.close();
      rmSync(y4m, { force: true });
    }
  }
} finally {
  server.stop();
  rmSync(work, { recursive: true, force: true });
}

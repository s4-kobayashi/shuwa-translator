// Offline evaluation on feature frames dumped from real videos
// (tests/e2e/dump-features.mjs). Each clip is replayed into a fresh recogniser
// with the default settings, exactly as the app would see it.
//
// Usage: node tests/realdata/replay.mjs featdir [--only prefix] [--split train|test]
//   --split  deterministic half of the clips by name hash: tune on "train",
//            report on "test", so a change is not judged on the data it was fitted to.
//   --expect file.json  {name: "expected text"}; clips not listed expect no output.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRecognizer } from "../../js/recognizer.js";

const args = process.argv.slice(2);
const take = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args.splice(i, 2)[1] : "";
};
const only = take("--only");
const split = take("--split");
const expectFile = take("--expect");
const verbose = args.includes("-v");
const dir = args.find((a) => !a.startsWith("-"));
const expect = expectFile ? JSON.parse(readFileSync(expectFile, "utf8")) : {};

const hash = (s) =>
  [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const inSplit = (name) =>
  !split || (hash(name) % 2 === 0 ? "train" : "test") === split;

export function replay(frames) {
  const rec = createRecognizer();
  const t0 = frames[0]?.t ?? 0;
  const tokens = [];
  for (const f of frames)
    for (const e of rec.push({ ...f, t: f.t - t0 }))
      if (e.type === "commit") tokens.push({ ...e.token });
      else if (e.type === "replace" && tokens.length)
        tokens[tokens.length - 1] = { ...tokens.at(-1), text: e.text };
  return tokens;
}

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .filter((f) => !only || f.startsWith(only))
  .filter((f) => inSplit(f.replace(/\.json$/, "")));
let clips = 0,
  silent = 0,
  falseCaps = 0;
const byLabel = {};
for (const f of files.sort((a, b) =>
  a.localeCompare(b, "en", { numeric: true }),
)) {
  const { name, frames } = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const tokens = replay(frames);
  const got = tokens.map((t) => t.text).join(" ");
  const want = expect[name] ?? "";
  clips++;
  if (!want) {
    if (!tokens.length) silent++;
    falseCaps += tokens.length;
    for (const t of tokens) byLabel[t.text] = (byLabel[t.text] || 0) + 1;
  }
  if (verbose || want || tokens.length > 0)
    console.log(
      `${name.padEnd(16)} ${want ? `expect="${want}" ` : ""}got="${got}" ${tokens
        .map((t) => (+t.conf).toFixed(2))
        .join(",")}`,
    );
}
const sorted = Object.entries(byLabel).sort((a, b) => b[1] - a[1]);
console.log(
  `\n${clips} clips${split ? ` (${split})` : ""}: silent on ${silent}/${clips - Object.keys(expect).filter((k) => files.includes(k + ".json")).length} out-of-vocabulary clips, ${falseCaps} false captions`,
);
console.log(sorted.map(([k, v]) => `${k}×${v}`).join(" "));

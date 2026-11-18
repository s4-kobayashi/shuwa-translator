// Fetches the pinned MediaPipe runtime + models into ./vendor/mediapipe and
// writes vendor/mediapipe/CHECKSUMS.txt. Run once before publishing:
//   node scripts/fetch-vendor.mjs
// Re-running is idempotent: existing files with matching checksums are kept.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '0.10.35';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vendor', 'mediapipe');
const MODELS = {
  'hand_landmarker.task':
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  'pose_landmarker_lite.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
};
// Only the files the browser actually loads (non-module build; nosimd is the
// fallback for browsers without WebAssembly SIMD, e.g. iOS < 16.4).
const RUNTIME = [
  ['vision_bundle.mjs', 'vision_bundle.mjs'],
  ['wasm/vision_wasm_internal.js', 'wasm/vision_wasm_internal.js'],
  ['wasm/vision_wasm_internal.wasm', 'wasm/vision_wasm_internal.wasm'],
  ['wasm/vision_wasm_nosimd_internal.js', 'wasm/vision_wasm_nosimd_internal.js'],
  ['wasm/vision_wasm_nosimd_internal.wasm', 'wasm/vision_wasm_nosimd_internal.wasm'],
  ['LICENSE', null], // package has no LICENSE file; license is Apache-2.0 per package.json
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function main() {
  mkdirSync(join(OUT, 'wasm'), { recursive: true });
  mkdirSync(join(OUT, 'models'), { recursive: true });

  const work = mkdtempSync(join(tmpdir(), 'mp-'));
  try {
    execFileSync('npm', ['pack', `@mediapipe/tasks-vision@${VERSION}`, '--silent'], {
      cwd: work, stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32',
    });
    execFileSync('tar', ['xzf', `mediapipe-tasks-vision-${VERSION}.tgz`], { cwd: work });
    const pkg = JSON.parse(readFileSync(join(work, 'package', 'package.json'), 'utf8'));
    if (pkg.version !== VERSION) throw new Error(`unexpected version ${pkg.version}`);
    for (const [src, dst] of RUNTIME) {
      if (!dst) continue;
      copyFileSync(join(work, 'package', src), join(OUT, dst));
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  for (const [name, url] of Object.entries(MODELS)) {
    const dst = join(OUT, 'models', name);
    if (existsSync(dst)) continue;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    writeFileSync(dst, Buffer.from(await res.arrayBuffer()));
  }

  const files = [
    ...RUNTIME.filter(([, d]) => d).map(([, d]) => d),
    ...Object.keys(MODELS).map((m) => `models/${m}`),
  ];
  const lines = files.map((f) => `${sha256(readFileSync(join(OUT, f)))}  ${f}`);
  writeFileSync(
    join(OUT, 'CHECKSUMS.txt'),
    `# @mediapipe/tasks-vision@${VERSION} (Apache-2.0) + models from storage.googleapis.com/mediapipe-models\n${lines.join('\n')}\n`,
  );
  console.log(lines.join('\n'));
}

main().catch((e) => { console.error(e); process.exit(1); });

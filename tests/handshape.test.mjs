// Fingerspelling classifier accuracy.
//  - real MediaPipe landmarks: 4 photographs with known JSL readings
//  - synthetic: every static kana under random rotation (±15° per axis),
//    scale (±20%) and landmark noise (σ = 3% of palm size), both hands.
// The synthetic poses (testkit/kana-poses.mjs) are written from the joint-level
// handshape descriptions, independently of the classifier's prototype table.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { anatomicalSide, handShape } from "../js/features.js";
import { classifyKana, KANA_SPECS, shapeClasses } from "../js/handshape.js";
import { buildHand, pose, rng } from "./testkit/handmodel.mjs";
import { KANA_POSES } from "./testkit/kana-poses.mjs";

const fx = JSON.parse(
  readFileSync(
    new URL("./fixtures/real-landmarks.json", import.meta.url),
    "utf8",
  ),
);

test("every static kana prototype has a synthetic pose and vice versa", () => {
  assert.deepEqual(
    Object.keys(KANA_POSES).sort(),
    KANA_SPECS.map((s) => s.id).sort(),
  );
  assert.equal(KANA_SPECS.length, 41);
});

test("real photographs: thumbs-up=た, pointing=ひ, victory=う, fist=さ with a clear margin", () => {
  for (const [k, want] of Object.entries(fx.expected)) {
    const h = fx.frames[k].hands[0];
    const s = handShape(
      h.world,
      anatomicalSide(h),
      h.landmarks.map((p) => ({ x: (p.x * 4) / 3, y: p.y, z: (p.z * 4) / 3 })),
    );
    const res = classifyKana(s);
    assert.equal(
      res[0].label,
      want,
      `${k}: ${JSON.stringify(res.slice(0, 3))}`,
    );
    assert.ok(res[0].score >= 0.85, `${k} score ${res[0].score}`);
    assert.ok(
      res[0].score - res[1].score >= 0.3,
      `${k} margin ${res[0].score - res[1].score}`,
    );
  }
});

function synthetic({ mirror }) {
  const r = rng(mirror ? 11 : 7);
  const per = {};
  let ok = 0,
    n = 0;
  for (const [k, p] of Object.entries(KANA_POSES)) {
    const L = buildHand(p);
    per[k] = 0;
    for (let i = 0; i < 40; i++) {
      const pts = pose(L, {
        orient: p.orient || "up",
        jitterDeg: 15,
        noise: 0.03,
        scale: 1 + (r() * 2 - 1) * 0.2,
        mirror,
        r,
      });
      const top = classifyKana(handShape(pts, mirror ? "left" : "right"))[0];
      n++;
      if (top.label === k) {
        ok++;
        per[k]++;
      }
    }
  }
  return { acc: ok / n, per };
}

test("synthetic right hands: top-1 ≥ 95% overall, every kana ≥ 75%", () => {
  const { acc, per } = synthetic({ mirror: false });
  console.log(`  right-hand synthetic accuracy ${(acc * 100).toFixed(1)}%`);
  assert.ok(acc >= 0.95, `accuracy ${acc}`);
  for (const [k, c] of Object.entries(per))
    assert.ok(c / 40 >= 0.75, `${k}: ${c}/40`);
});

test("synthetic left hands (left-handed signers): top-1 ≥ 95%", () => {
  const { acc } = synthetic({ mirror: true });
  console.log(`  left-hand synthetic accuracy ${(acc * 100).toFixed(1)}%`);
  assert.ok(acc >= 0.95, `accuracy ${acc}`);
});

test("in-between hands (half-bent fingers, random angles) are rarely accepted", () => {
  // A hand caught mid-transition: every finger joint 30–60° flexed. At the
  // default threshold (score ≥ 0.6 and margin ≥ 0.1) these should mostly be
  // rejected; the hold timer in the recogniser filters the rest.
  const r = rng(99);
  let accepted = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    const f = () => [30 + r() * 30, 30 + r() * 30, 20 + r() * 30];
    const L = buildHand({
      fingers: [f(), f(), f(), f()],
      thumb: r() < 0.5 ? "across" : "tuck",
    });
    const res = classifyKana(
      handShape(pose(L, { jitterDeg: 40, noise: 0.03, r }), "right"),
    );
    if (res[0].score >= 0.6 && res[0].score - res[1].score >= 0.1) accepted++;
  }
  console.log(`  in-between hands accepted: ${accepted}/${N}`);
  assert.ok(accepted / N <= 0.05, `false accepts ${accepted}/${N}`);
});

test("generic handshape classes on real hands", () => {
  const cls = (k) => {
    const h = fx.frames[k].hands[0];
    return shapeClasses(handShape(h.world, anatomicalSide(h)));
  };
  assert.ok(cls("fist").fist > 0.9);
  assert.ok(cls("pointing_up").index > 0.9);
  assert.ok(cls("victory").U > 0.9);
  assert.ok(cls("thumb_up").thumbFist > 0.9);
});

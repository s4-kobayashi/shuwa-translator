// Few-shot user dictionary: 3 samples per sign, then recognise new
// performances of the same signs and reject signs that were never registered.
import test from "node:test";
import assert from "node:assert/strict";
import { buildMatcher, dtw, resample, seqVector, SEQ_LEN } from "../js/dtw.js";
import { shapeVector } from "../js/handshape.js";
import { handShape } from "../js/features.js";
import { buildHand, pose, rng } from "./testkit/handmodel.mjs";
import { KANA_POSES } from "./testkit/kana-poses.mjs";
import { movement } from "./testkit/frames.mjs";

test("resample gives a fixed length and keeps the end points", () => {
  const seq = Array.from({ length: 7 }, (_, i) => [i]);
  const r = resample(seq);
  assert.equal(r.length, SEQ_LEN);
  assert.equal(r[0][0], 0);
  assert.equal(r[SEQ_LEN - 1][0], 6);
});

test("dtw is zero for identical sequences and tolerant to time warping", () => {
  const a = resample(
    Array.from({ length: 30 }, (_, i) => [Math.sin(i / 5), 0]),
  );
  const warped = resample(
    Array.from({ length: 30 }, (_, i) => [
      Math.sin(((i / 29) ** 1.3 * 29) / 5),
      0,
    ]),
  );
  const other = resample(
    Array.from({ length: 30 }, (_, i) => [Math.cos(i / 5), 1]),
  );
  assert.equal(dtw(a, a), 0);
  assert.ok(dtw(a, warped) < dtw(a, other) / 4);
});

// ---- static user signs: five handshapes registered under custom labels ----
const STATIC_SIGNS = {
  サイン1: "か",
  サイン2: "む",
  サイン3: "ほ",
  サイン4: "ら",
  サイン5: "め",
};
const IMPOSTORS = ["あ", "さ", "て", "ゆ", "わ"];

function shapeSample(kana, r) {
  const p = KANA_POSES[kana];
  return handShape(
    pose(buildHand(p), {
      orient: p.orient || "up",
      jitterDeg: 12,
      noise: 0.025,
      scale: 0.85 + r() * 0.3,
      r,
    }),
    "right",
  );
}

test("static few-shot: 3 samples per sign → ≥90% top-1, impostors mostly rejected", () => {
  const r = rng(21);
  const m = buildMatcher(
    Object.entries(STATIC_SIGNS).map(([label, k]) => ({
      label,
      kind: "static",
      samples: [0, 1, 2].map(() => shapeVector(shapeSample(k, r))),
    })),
  );
  let ok = 0,
    n = 0;
  for (const [label, k] of Object.entries(STATIC_SIGNS))
    for (let i = 0; i < 40; i++, n++) {
      const res = m.matchStatic(shapeSample(k, r));
      if (res[0].label === label && res[0].score >= 0.6) ok++;
    }
  let fa = 0,
    nf = 0;
  for (const k of IMPOSTORS)
    for (let i = 0; i < 40; i++, nf++)
      if (m.matchStatic(shapeSample(k, r))[0].score >= 0.6) fa++;
  console.log(
    `  static few-shot accuracy ${ok}/${n}, impostor accepts ${fa}/${nf}`,
  );
  assert.ok(ok / n >= 0.9);
  assert.ok(fa / nf <= 0.1);
});

// ---- motion user signs: five made-up movements ----
const at = (x, y) => ({ x, y });
const MOTION_SIGNS = {
  円: (o, d) =>
    movement(
      Array.from({ length: 9 }, (_, i) => ({
        at: i / 8,
        D: {
          shape: "index",
          at: at(
            0.3 + d.x + 0.2 * Math.cos((i / 8) * 2 * Math.PI),
            d.y + 0.2 * Math.sin((i / 8) * 2 * Math.PI),
          ),
        },
      })),
      o,
    ),
  ジグザグ: (o, d) =>
    movement(
      [0, 1, 2, 3, 4].map((i) => ({
        at: i / 4,
        D: {
          shape: "flat",
          at: at(-0.1 + d.x + i * 0.12, d.y + (i % 2 ? 0.15 : -0.15)),
        },
      })),
      o,
    ),
  開く: (o, d) =>
    movement(
      [
        {
          at: 0,
          D: { shape: "fist", at: at(0.1 + d.x, d.y) },
          N: { shape: "fist", at: at(-0.1 + d.x, d.y) },
        },
        {
          at: 1,
          D: { shape: "open", at: at(0.5 + d.x, d.y + 0.1) },
          N: { shape: "open", at: at(-0.5 + d.x, d.y + 0.1) },
        },
      ],
      o,
    ),
  上げる: (o, d) =>
    movement(
      [
        {
          at: 0,
          D: {
            shape: "flat",
            orient: "palmDown",
            at: at(0.3 + d.x, -0.4 + d.y),
          },
        },
        {
          at: 1,
          D: {
            shape: "flat",
            orient: "palmDown",
            at: at(0.3 + d.x, 0.2 + d.y),
          },
        },
      ],
      o,
    ),
  叩く: (o, d) =>
    movement(
      [
        { at: 0, D: { shape: "fist", at: at(0.3 + d.x, d.y) } },
        { at: 1, D: { shape: "fist", at: at(0.3 + d.x, d.y) } },
      ],
      {
        ...o,
        wiggle: (w) => ({
          x: 0,
          y: -0.12 * Math.abs(Math.sin(2 * Math.PI * 1.5 * w)),
        }),
      },
    ),
};
const IMPOSTOR_MOVES = {
  横払い: (o, d) =>
    movement(
      [
        { at: 0, D: { shape: "flat", at: at(-0.3 + d.x, d.y) } },
        { at: 1, D: { shape: "flat", at: at(0.6 + d.x, d.y) } },
      ],
      o,
    ),
  下ろす: (o, d) =>
    movement(
      [
        { at: 0, D: { shape: "index", at: at(0.3 + d.x, 0.3 + d.y) } },
        { at: 1, D: { shape: "index", at: at(0.3 + d.x, -0.4 + d.y) } },
      ],
      o,
    ),
};

function perform(gen, r) {
  const ms = 700 * (0.8 + r() * 0.4);
  return gen({ ms }, { x: (r() * 2 - 1) * 0.06, y: (r() * 2 - 1) * 0.06 });
}

test("motion few-shot: 3 samples per sign → ≥90% top-1, unknown movements rejected", () => {
  const r = rng(5);
  const m = buildMatcher(
    Object.entries(MOTION_SIGNS).map(([label, gen]) => ({
      label,
      kind: "motion",
      samples: [0, 1, 2].map(() => seqVector(perform(gen, r))),
    })),
  );
  let ok = 0,
    n = 0;
  for (const [label, gen] of Object.entries(MOTION_SIGNS))
    for (let i = 0; i < 20; i++, n++) {
      const res = m.matchMotion(perform(gen, r));
      if (res[0].label === label && res[0].score >= 0.6) ok++;
    }
  let fa = 0,
    nf = 0;
  for (const gen of Object.values(IMPOSTOR_MOVES))
    for (let i = 0; i < 20; i++, nf++)
      if (m.matchMotion(perform(gen, r))[0].score >= 0.6) fa++;
  console.log(
    `  motion few-shot accuracy ${ok}/${n}, impostor accepts ${fa}/${nf}`,
  );
  assert.ok(ok / n >= 0.9);
  assert.ok(fa / nf <= 0.1);
});

test("a single sample still works with the default radius", () => {
  const r = rng(8);
  const m = buildMatcher([
    {
      label: "X",
      kind: "static",
      samples: [shapeVector(shapeSample("か", r))],
    },
  ]);
  assert.ok(m.matchStatic(shapeSample("か", r))[0].score > 0.5);
  assert.ok(m.matchStatic(shapeSample("さ", r))[0].score < 0.3);
});

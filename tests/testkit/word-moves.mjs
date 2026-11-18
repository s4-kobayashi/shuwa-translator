// Synthetic performances of every built-in word sign, moving kana and
// modifier motion, following the written descriptions in docs/vocabulary.md.
// Each entry returns a list of feature frames (see frames.mjs).
import { movement, hold, BP } from "./frames.mjs";

const below = (p, d) => ({ x: p.x, y: p.y - d });
const at = (x, y) => ({ x, y });
const sin = (w, cycles) => Math.sin(2 * Math.PI * cycles * w);

export const WORD_MOVES = {
  ありがとう: (o) =>
    movement(
      [
        {
          at: 0,
          D: { shape: "flat", orient: "profile", at: at(-0.12, -0.15) },
          N: { shape: "flat", orient: "palmDown", at: at(-0.15, -0.38) },
        },
        {
          at: 0.15,
          D: { shape: "flat", orient: "profile", at: at(-0.12, -0.15) },
          N: { shape: "flat", orient: "palmDown", at: at(-0.15, -0.38) },
        },
        {
          at: 1,
          D: { shape: "flat", orient: "profile", at: at(-0.12, 0.35) },
          N: { shape: "flat", orient: "palmDown", at: at(-0.15, -0.38) },
        },
      ],
      { ms: 800, ...o },
    ),
  挨拶: (o) =>
    movement(
      [
        {
          at: 0,
          D: { shape: "index", orient: "profile", at: at(0.28, -0.1) },
          N: { shape: "index", orient: "profile", at: at(-0.28, -0.1) },
        },
        {
          at: 0.2,
          D: { shape: "index", orient: "profile", at: at(0.28, -0.1) },
          N: { shape: "index", orient: "profile", at: at(-0.28, -0.1) },
        },
        {
          at: 1,
          D: { shape: "indexBent", orient: "profile", at: at(0.26, -0.22) },
          N: { shape: "indexBent", orient: "profile", at: at(-0.26, -0.22) },
        },
      ],
      { ms: 700, ...o },
    ),
  朝: (o) =>
    movement(
      [
        { at: 0, D: { shape: "fist", at: BP.temple } },
        { at: 1, D: { shape: "fist", at: below(BP.temple, 0.45) } },
      ],
      { ms: 600, ...o },
    ),
  昼: (o) =>
    hold(
      { D: { shape: "U", at: below(BP.forehead, 0.32) } },
      { ms: 700, ...o },
    ),
  夜: (o) =>
    movement(
      [
        {
          at: 0,
          D: { shape: "flat", at: at(0.5, BP.nose.y) },
          N: { shape: "flat", at: at(-0.5, BP.nose.y) },
        },
        {
          at: 1,
          D: { shape: "flat", at: at(-0.08, BP.nose.y - 0.05) },
          N: { shape: "flat", at: at(0.08, BP.nose.y - 0.05) },
        },
      ],
      { ms: 700, ...o },
    ),
  ごめんなさい: (o) =>
    movement(
      [
        {
          at: 0,
          D: { shape: "pinch", orient: "profile", at: below(BP.brow, 0.18) },
        },
        {
          at: 0.3,
          D: { shape: "pinch", orient: "profile", at: below(BP.brow, 0.18) },
        },
        {
          at: 1,
          D: { shape: "flat", orient: "profile", at: below(BP.brow, 0.7) },
        },
      ],
      { ms: 900, ...o },
    ),
  良い: (o) =>
    movement(
      [
        {
          at: 0,
          D: {
            shape: "fist",
            orient: "profile",
            at: below(BP.nose, 0.05),
            size: 0.25,
          },
        },
        {
          at: 1,
          D: {
            shape: "fist",
            orient: "profile",
            at: below(BP.nose, 0.12),
            size: 0.31,
          },
        },
      ],
      { ms: 600, ...o },
    ),
  お願い: (o) =>
    movement(
      [
        {
          at: 0,
          D: {
            shape: "flat",
            orient: "profile",
            at: below(BP.nose, 0.05),
            size: 0.25,
          },
        },
        {
          at: 1,
          D: {
            shape: "flat",
            orient: "profile",
            at: below(BP.nose, 0.25),
            size: 0.3,
          },
        },
      ],
      { ms: 700, ...o },
    ),
  さようなら: (o) =>
    movement(
      [
        { at: 0, D: { shape: "open", at: at(0.5, 0.55) } },
        { at: 1, D: { shape: "open", at: at(0.5, 0.55) } },
      ],
      { ms: 1100, wiggle: (w) => ({ x: 0.16 * sin(w, 2), y: 0 }), ...o },
    ),
  大丈夫: (o) =>
    movement(
      [
        {
          at: 0,
          D: { shape: "flat", orient: "side", at: below(BP.shNon, 0.22) },
        },
        {
          at: 0.2,
          D: { shape: "flat", orient: "side", at: below(BP.shNon, 0.22) },
        },
        {
          at: 1,
          D: { shape: "flat", orient: "side", at: below(BP.shDom, 0.22) },
        },
      ],
      { ms: 900, ...o },
    ),
  好き: (o) =>
    movement(
      [
        {
          at: 0,
          D: {
            shape: "pinchOpen",
            orient: "profile",
            at: BP.throat,
            size: 0.25,
          },
        },
        {
          at: 0.15,
          D: {
            shape: "pinchOpen",
            orient: "profile",
            at: BP.throat,
            size: 0.25,
          },
        },
        {
          at: 1,
          D: {
            shape: "pinch",
            orient: "profile",
            at: below(BP.throat, 0.25),
            size: 0.28,
          },
        },
      ],
      { ms: 800, ...o },
    ),
  元気: (o) =>
    movement(
      [
        {
          at: 0,
          D: { shape: "fist", orient: "profile", at: at(0.3, -0.35) },
          N: { shape: "fist", orient: "profile", at: at(-0.3, -0.35) },
        },
        {
          at: 1,
          D: { shape: "fist", orient: "profile", at: at(0.3, -0.35) },
          N: { shape: "fist", orient: "profile", at: at(-0.3, -0.35) },
        },
      ],
      {
        ms: 1000,
        wiggle: (w) => ({ x: 0, y: -0.14 * Math.abs(sin(w, 1)) }),
        wiggleN: (w) => ({ x: 0, y: -0.14 * Math.abs(sin(w, 1)) }),
        ...o,
      },
    ),
  会う: (o) =>
    movement(
      [
        {
          at: 0,
          D: { shape: "index", at: at(0.5, -0.1) },
          N: { shape: "index", at: at(-0.5, -0.1) },
        },
        {
          at: 1,
          D: { shape: "index", at: at(0.08, -0.1) },
          N: { shape: "index", at: at(-0.08, -0.1) },
        },
      ],
      { ms: 700, ...o },
    ),
  初め: (o) =>
    movement(
      [
        { at: 0, D: { shape: "flat", orient: "profile", at: at(0.25, -0.95) } },
        {
          at: 0.6,
          D: { shape: "flat", orient: "profile", at: at(0.25, -0.55) },
        },
        { at: 1, D: { shape: "index", at: at(0.25, -0.35) } },
      ],
      { ms: 800, ...o },
    ),
  お疲れ様: (o) =>
    movement(
      [
        {
          at: 0,
          D: { shape: "fist", orient: "profile", at: at(-0.12, -0.42) },
          N: { shape: "fist", orient: "palmDown", at: at(-0.2, -0.42) },
        },
        {
          at: 1,
          D: { shape: "fist", orient: "profile", at: at(-0.12, -0.42) },
          N: { shape: "fist", orient: "palmDown", at: at(-0.2, -0.42) },
        },
      ],
      {
        ms: 900,
        wiggle: (w) => ({ x: 0, y: 0.1 * Math.abs(sin(w, 1)) }),
        ...o,
      },
    ),
  わかる: (o) =>
    movement(
      [
        {
          at: 0,
          D: { shape: "flat", orient: "upSigner", at: at(0.05, -0.15) },
        },
        { at: 1, D: { shape: "flat", orient: "upSigner", at: at(0.05, -0.7) } },
      ],
      { ms: 700, ...o },
    ),
  何: (o) =>
    movement(
      [
        { at: 0, D: { shape: "index", at: at(0.3, 0.15) } },
        { at: 1, D: { shape: "index", at: at(0.3, 0.15) } },
      ],
      { ms: 900, wiggle: (w) => ({ x: 0.1 * sin(w, 2), y: 0 }), ...o },
    ),
  私: (o) =>
    hold(
      { D: { shape: "index", orient: "back", at: at(0.12, -0.35) } },
      { ms: 700, ...o },
    ),
  あなた: (o) =>
    hold(
      { D: { shape: "index", orient: "fwd", at: at(0.2, -0.25) } },
      { ms: 700, ...o },
    ),
  名前: (o) =>
    hold(
      {
        D: { shape: "thumbFist", orient: "profile", at: at(-0.08, -0.5) },
        N: { shape: "flat", at: at(-0.12, -0.3) },
      },
      { ms: 700, ...o },
    ),
  赤: (o) =>
    movement(
      [
        {
          at: 0,
          D: {
            shape: "index",
            orient: "side",
            at: at(BP.mouth.x + 0.12, BP.mouth.y - 0.05),
          },
        },
        {
          at: 1,
          D: {
            shape: "index",
            orient: "side",
            at: at(BP.mouth.x + 0.38, BP.mouth.y - 0.05),
          },
        },
      ],
      { ms: 600, ...o },
    ),
};

export const MOTION_KANA_MOVES = {
  の: (o) =>
    movement(
      [
        { at: 0, D: { shape: "index", at: at(0.35, 0.3) } },
        { at: 0.5, D: { shape: "index", at: at(0.3, 0.08) } },
        { at: 1, D: { shape: "index", at: at(0.12, -0.08) } },
      ],
      { ms: 600, ...o },
    ),
  ん: (o) =>
    movement(
      [
        { at: 0, D: { shape: "index", at: at(0.25, 0.25) } },
        { at: 0.5, D: { shape: "index", at: at(0.2, -0.02) } },
        { at: 1, D: { shape: "index", at: at(0.42, 0.18) } },
      ],
      { ms: 700, ...o },
    ),
  り: (o) =>
    movement(
      [
        { at: 0, D: { shape: "U", at: at(0.3, 0.3) } },
        { at: 1, D: { shape: "U", at: at(0.3, -0.1) } },
      ],
      { ms: 600, ...o },
    ),
  を: (o) =>
    movement(
      [
        { at: 0, D: { shape: "お", at: at(0.3, 0), size: 0.26 } },
        { at: 1, D: { shape: "お", at: at(0.3, 0.02), size: 0.2 } },
      ],
      { ms: 600, ...o },
    ),
  も: (o) =>
    movement(
      [
        { at: 0, D: { shape: "pinchOpen", at: at(0.3, 0) } },
        { at: 0.4, D: { shape: "pinchOpen", at: at(0.3, 0) } },
        { at: 1, D: { shape: "pinch", at: at(0.31, 0.02) } },
      ],
      { ms: 600, ...o },
    ),
};

/** Modifier motions: [base kana, expected text, movement]. */
export const MODIFIER_MOVES = {
  dakuten: [
    "か",
    "が",
    (o) =>
      movement(
        [
          { at: 0, D: { shape: "か", at: at(0.3, 0) } },
          { at: 1, D: { shape: "か", at: at(0.62, 0) } },
        ],
        { ms: 500, ...o },
      ),
  ],
  handakuten: [
    "は",
    "ぱ",
    (o) =>
      movement(
        [
          { at: 0, D: { shape: "は", at: at(0.3, 0) } },
          { at: 1, D: { shape: "は", at: at(0.3, 0.32) } },
        ],
        { ms: 500, ...o },
      ),
  ],
  small: [
    "つ",
    "っ",
    (o) =>
      movement(
        [
          { at: 0, D: { shape: "つ", at: at(0.3, 0), size: 0.26 } },
          { at: 1, D: { shape: "つ", at: at(0.3, 0.02), size: 0.2 } },
        ],
        { ms: 500, ...o },
      ),
  ],
  long: [
    "あ",
    "ー",
    (o) =>
      movement(
        [
          { at: 0, D: { shape: "あ", at: at(0.3, 0) } },
          { at: 1, D: { shape: "あ", at: at(0.3, -0.32) } },
        ],
        { ms: 500, ...o },
      ),
  ],
};

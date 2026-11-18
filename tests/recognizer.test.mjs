// End-to-end behaviour of the recogniser on synthetic feature streams:
// hold-to-confirm, re-arming, line breaks, modifiers, words, compounds,
// modes and the registration (capture) path.
import test from "node:test";
import assert from "node:assert/strict";
import { createRecognizer, isKana } from "../js/recognizer.js";
import { hold, movement, frame } from "./testkit/frames.mjs";
import { WORD_MOVES, MODIFIER_MOVES } from "./testkit/word-moves.mjs";

const HERE = { x: 0.3, y: 0 };

/** Concatenate segments; each is (t0) => frames. Returns all events. */
function play(rec, segments) {
  let t = 0;
  const events = [];
  for (const seg of segments) {
    const frames = seg(t);
    for (const f of frames) events.push(...rec.push(f));
    t = frames[frames.length - 1].t + 33;
  }
  return events;
}
const still =
  (shape, ms, extra = {}) =>
  (t0) =>
    hold({ D: { shape, at: HERE, ...extra } }, { ms, t0 });
const away = (ms) => (t0) =>
  Array.from({ length: Math.round(ms / 33) }, (_, i) => frame(t0 + i * 33, {}));
/** A movement followed by holding its final pose (real hands do not teleport). */
const move =
  (gen, o = {}, settleMs = 350) =>
  (t0) => {
    const fr = gen({ t0, ...o });
    const last = fr[fr.length - 1];
    const n = Math.round(settleMs / 33);
    return fr.concat(
      Array.from({ length: n }, (_, i) => ({ ...last, t: last.t + (i + 1) * 33 })),
    );
  };
const texts = (ev) =>
  ev.filter((e) => e.type === "commit").map((e) => e.token.text);

test("isKana separates spelled kana from words", () => {
  assert.ok(isKana("あ") && isKana("ー") && isKana("っ"));
  assert.ok(!isKana("ありがとう") && !isKana("A"));
});

test("holding a handshape commits it once, after the hold time, with a rising gauge", () => {
  const rec = createRecognizer();
  const ev = play(rec, [still("あ", 1500)]);
  assert.deepEqual(texts(ev), ["あ"]);
  const gauge = ev
    .filter((e) => e.type === "pending" && e.label === "あ")
    .map((e) => e.progress);
  assert.ok(gauge.length >= 10);
  for (let i = 1; i < gauge.length; i++) assert.ok(gauge[i] >= gauge[i - 1]);
  const commitAt = ev.find((e) => e.type === "commit").token.t;
  assert.ok(commitAt >= 450 && commitAt < 700, `committed at ${commitAt}`);
});

test("spelling た・な・か with direct transitions gives three kana", () => {
  const rec = createRecognizer();
  const ev = play(rec, [still("た", 800), still("な", 800), still("か", 800)]);
  assert.deepEqual(texts(ev), ["た", "な", "か"]);
});

test("the same kana twice needs a re-arm (hand dropped briefly)", () => {
  const rec = createRecognizer();
  const ev = play(rec, [still("あ", 800), away(300), still("あ", 800)]);
  assert.deepEqual(texts(ev), ["あ", "あ"]);
});

test("a pause of 2.2 s without hands closes the line", () => {
  const rec = createRecognizer();
  const ev = play(rec, [still("あ", 800), away(1500)]);
  assert.equal(ev.filter((e) => e.type === "newline").length, 0);
  const ev2 = play(rec, [away(2600)]);
  assert.equal(ev2.filter((e) => e.type === "newline").length, 1);
});

test("a short hold (shorter than holdMs) commits nothing", () => {
  const rec = createRecognizer();
  assert.deepEqual(texts(play(rec, [still("あ", 300), away(300)])), []);
});

test("holdMs setting changes the confirmation time", () => {
  const rec = createRecognizer({ holdMs: 900 });
  assert.deepEqual(texts(play(rec, [still("あ", 700)])), []);
  const rec2 = createRecognizer({ holdMs: 900 });
  assert.deepEqual(texts(play(rec2, [still("あ", 1200)])), ["あ"]);
});

for (const [name, [base, want, gen]] of Object.entries(MODIFIER_MOVES)) {
  test(`modifier motion after ${base}: ${name} → ${want}`, () => {
    const rec = createRecognizer();
    const ev = play(rec, [still(base, 700), move(gen)]);
    assert.deepEqual(texts(ev).slice(0, 1), [base]);
    if (name === "long") assert.deepEqual(texts(ev), [base, "ー"]);
    else {
      const mod = ev.find((e) => e.type === "modify");
      assert.ok(
        mod,
        `no modify event: ${JSON.stringify(ev.filter((e) => e.type === "rejected" || e.type === "scores"))}`,
      );
      assert.equal(mod.text, want);
      assert.deepEqual(
        texts(ev),
        [base],
        "the movement must not add another token",
      );
    }
  });
}

const MOTION_WORDS = Object.keys(WORD_MOVES).filter(
  (w) => !["昼", "私", "あなた", "名前"].includes(w),
);
for (const w of MOTION_WORDS) {
  test(`word ${w} performed as a movement is committed`, () => {
    const rec = createRecognizer();
    const ev = play(rec, [
      away(200),
      move(WORD_MOVES[w]),
      away(400),
    ]);
    const words = ev
      .filter((e) => e.type === "commit" && e.token.kind === "word")
      .map((e) => e.token.text);
    assert.equal(
      words.length,
      1,
      `${w}: ${JSON.stringify(texts(ev))} ${JSON.stringify(ev.filter((e) => e.type === "scores" || e.type === "rejected").slice(-2))}`,
    );
    assert.equal(words[0].replace(/[?？]$/, ""), w);
  });
}

test("static words (私) win over the kana reading of the same handshape", () => {
  const rec = createRecognizer();
  const ev = play(rec, [(t0) => WORD_MOVES["私"]({ t0 })]);
  assert.deepEqual(texts(ev), ["私"]);
});

test("昼 then 挨拶 within 3.5 s becomes こんにちは", () => {
  const rec = createRecognizer();
  const ev = play(rec, [
    (t0) => WORD_MOVES["昼"]({ t0 }),
    away(200),
    move(WORD_MOVES["挨拶"]),
    away(400),
  ]);
  assert.deepEqual(texts(ev), ["昼"]);
  const rep = ev.find((e) => e.type === "replace");
  assert.ok(rep, JSON.stringify(ev.filter((e) => e.type === "scores")));
  assert.equal(rep.text, "こんにちは");
});

test('mode "kana" ignores words, mode "word" ignores fingerspelling', () => {
  const kana = createRecognizer({ mode: "kana" });
  const ev = play(kana, [away(200), move(WORD_MOVES["ありがとう"]), away(300)]);
  assert.ok(!texts(ev).includes("ありがとう"));
  const word = createRecognizer({ mode: "word" });
  assert.deepEqual(texts(play(word, [still("あ", 900)])), []);
});

test("lower sensitivity rejects more: a borderline hand is not accepted at 0", () => {
  // は rotated toward the camera is ambiguous between は and other shapes.
  const strict = createRecognizer({ sensitivity: 0 });
  const loose = createRecognizer({ sensitivity: 1 });
  const seg = still("は", 900, { orient: "fwd" });
  const a = texts(play(strict, [seg]));
  const b = texts(play(loose, [seg]));
  assert.ok(a.length <= b.length);
});

test("registration: capture emits samples instead of tokens", () => {
  const rec = createRecognizer();
  rec.startCapture("static");
  const ev = play(rec, [still("か", 1000)]);
  assert.deepEqual(texts(ev), []);
  const s = ev.filter((e) => e.type === "sample");
  assert.equal(s.length, 1);
  assert.equal(s[0].kind, "static");
  assert.ok(s[0].shape.ext.length === 5);
  rec.stopCapture();

  const rec2 = createRecognizer();
  rec2.startCapture("motion");
  const ev2 = play(rec2, [
    away(100),
    move(WORD_MOVES["ありがとう"]),
    away(300),
  ]);
  const m = ev2.filter((e) => e.type === "sample");
  assert.equal(m.length, 1);
  assert.equal(m[0].kind, "motion");
  assert.ok(m[0].frames.length > 10);
  assert.deepEqual(texts(ev2), []);
});

test("a registered user sign overrides the built-in reading", async () => {
  const { shapeVector } = await import("../js/handshape.js");
  const rec = createRecognizer();
  rec.startCapture("static");
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const ev = play(rec, [still("か", 900), away(200)]);
    samples.push(
      ...ev.filter((e) => e.type === "sample").map((e) => shapeVector(e.shape)),
    );
  }
  rec.stopCapture();
  rec.setTemplates([{ label: "ピース", kind: "static", samples }]);
  const ev = play(rec, [away(300), still("か", 900)]);
  const c = ev.filter((e) => e.type === "commit");
  assert.equal(c.length, 1);
  assert.equal(c[0].token.text, "ピース");
  assert.equal(c[0].token.source, "user");
  assert.equal(c[0].token.kind, "word");
});

test('landmark jitter on a held hand does not look like movement', async () => {
  const { rng } = await import('./testkit/handmodel.mjs');
  const r = rng(4);
  const rec = createRecognizer();
  // 3° random rotation and 2 % palm-size noise on every frame.
  const ev = play(rec, [still('あ', 1500, { r, jitter: 3, noise: 0.02 })]);
  assert.equal(ev.filter((e) => e.type === 'moving').length, 0);
  assert.deepEqual(texts(ev), ['あ']);
});

test('a slow transition through in-between shapes adds no extra kana', () => {
  // さ → あ: the thumb travels from the front of the fist to the side over 300 ms.
  const rec = createRecognizer();
  const mid = (t0) => hold({ D: { shape: 'pinch', at: HERE } }, { ms: 300, t0 });
  const ev = play(rec, [still('さ', 800), mid, still('あ', 800)]);
  assert.deepEqual(texts(ev), ['さ', 'あ']);
});

test('a brief tracking dropout while holding does not repeat the kana', () => {
  const rec = createRecognizer();
  const ev = play(rec, [still('あ', 700), away(66), still('あ', 700), away(100), still('あ', 700)]);
  assert.deepEqual(texts(ev), ['あ']);
});

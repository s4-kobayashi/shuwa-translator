// Built-in word / moving-kana / modifier rules on synthetic performances that
// follow the written descriptions in docs/vocabulary.md, at three speeds.
import test from "node:test";
import assert from "node:assert/strict";
import {
  summarize,
  scoreWords,
  scoreMotionKana,
  modifierFor,
  reversals,
  WORD_RULES,
} from "../js/signs.js";
import {
  WORD_MOVES,
  MOTION_KANA_MOVES,
  MODIFIER_MOVES,
} from "./testkit/word-moves.mjs";
import { hold } from "./testkit/frames.mjs";

const SPEEDS = [0.75, 1, 1.3];
const baseMs = (gen) => {
  const f = gen();
  return f[f.length - 1].t - f[0].t;
};

test("every built-in word has a synthetic performance", () => {
  assert.deepEqual(
    Object.keys(WORD_MOVES).sort(),
    WORD_RULES.map((r) => r.id).sort(),
  );
});

for (const [word, gen] of Object.entries(WORD_MOVES)) {
  const isStatic = WORD_RULES.find((r) => r.id === word).static;
  test(`word ${word}: top-1 with score ≥ 0.6 at 0.75×/1×/1.3× speed`, () => {
    for (const k of SPEEDS) {
      const s = summarize(gen({ ms: baseMs(gen) * k }));
      const res = scoreWords(s, isStatic ? "static" : "motion");
      assert.equal(
        res[0].label,
        word,
        `${k}×: ${res.slice(0, 3).map((r) => r.label + r.score.toFixed(2))}`,
      );
      assert.ok(res[0].score >= 0.6, `${k}× score ${res[0].score}`);
    }
  });
}

for (const [kana, gen] of Object.entries(MOTION_KANA_MOVES)) {
  test(`moving kana ${kana}: top-1 ≥ 0.6`, () => {
    const s = summarize(gen());
    const res = scoreMotionKana(s);
    assert.equal(res[0].label, kana, JSON.stringify(res.slice(0, 3)));
    assert.ok(res[0].score >= 0.6);
  });
}

for (const [name, [base, want, gen]] of Object.entries(MODIFIER_MOVES)) {
  test(`modifier ${name}: ${base} → ${want}`, () => {
    const m = modifierFor(summarize(gen()), base);
    assert.ok(m, "no modifier detected");
    assert.equal(m.text, want);
  });
}

test("modifiers do not apply to kana that have no such form", () => {
  const [, , gen] = MODIFIER_MOVES.handakuten;
  const m = modifierFor(summarize(gen()), "か");
  assert.ok(!m || m.text !== "か゜");
});

test("holding still produces no motion word above threshold", () => {
  for (const shape of ["flat", "fist", "index", "open"]) {
    const s = summarize(
      hold({ D: { shape, at: { x: 0.3, y: -0.1 } } }, { ms: 900 }),
    );
    const best = scoreWords(s, "motion")[0];
    assert.ok(best.score < 0.6, `${shape}: ${best.label} ${best.score}`);
  }
});

test("reversals counts oscillation half-cycles and ignores small jitter", () => {
  const wave = Array.from(
    { length: 60 },
    (_, i) => 0.2 * Math.sin((2 * Math.PI * 2 * i) / 60),
  );
  assert.ok(reversals(wave, 0.1) >= 3, `wave ${reversals(wave, 0.1)}`);
  const jitter = Array.from({ length: 60 }, (_, i) => 0.01 * Math.sin(i * 1.7));
  assert.equal(reversals(jitter, 0.1), 0);
  const ramp = Array.from({ length: 30 }, (_, i) => i / 30);
  assert.equal(reversals(ramp, 0.1), 0);
});

test('a two-handed word is not read as a moving kana (挨拶 ≠ の)', () => {
  const s = summarize(WORD_MOVES['挨拶']());
  const kana = scoreMotionKana(s)[0];
  const word = scoreWords(s, 'motion')[0];
  assert.equal(word.label, '挨拶');
  assert.ok(kana.score < 0.4, `${kana.label} ${kana.score}`);
});

test('a moving kana still reads with the other hand resting low', async () => {
  const { movement } = await import('./testkit/frames.mjs');
  const rest = { shape: 'flat', orient: 'palmDown', at: { x: -0.2, y: -1.1 } };
  const s = summarize(
    movement(
      [
        { at: 0, D: { shape: 'index', at: { x: 0.35, y: 0.3 } }, N: rest },
        { at: 0.5, D: { shape: 'index', at: { x: 0.3, y: 0.08 } }, N: rest },
        { at: 1, D: { shape: 'index', at: { x: 0.12, y: -0.08 } }, N: rest },
      ],
      { ms: 600 },
    ),
  );
  const r = scoreMotionKana(s)[0];
  assert.equal(r.label, 'の');
  assert.ok(r.score >= 0.6, String(r.score));
});

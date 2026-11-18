// Built-in word signs and moving fingerspelling, as fuzzy rules over a motion
// segment. Every rule follows the written description cited in
// docs/vocabulary.md. Coordinates: body frame from features.js (shoulder
// widths, +x toward the dominant side, +y up).
import { shapeClasses, classifyKana, KANA_BY_ID } from "./handshape.js";

const ramp = (v, lo, hi) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
const near = (p, q, r) =>
  p && q ? Math.exp(-((p.x - q.x) ** 2 + (p.y - q.y) ** 2) / (r * r)) : 0;
const d2 = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const meanPt = (a) =>
  a.length ? { x: mean(a.map((p) => p.x)), y: mean(a.map((p) => p.y)) } : null;
/**
 * Every condition must hold to score high. A plain geometric mean is
 * compensatory: with five conditions one failed term (0.1) still gives 0.63,
 * above the acceptance threshold, and on real signing that let words fire
 * with the wrong handshape or in the wrong place. The weakest condition
 * therefore also caps the score.
 */
// 0.15–0.4 was chosen on half of the real clips (tests/realdata) and checked
// on the other half; 0.2–0.5 already breaks synthetic word recognition.
const VETO_LO = 0.15;
const VETO_HI = 0.4;
export const all = (...ms) =>
  Math.exp(mean(ms.map((m) => Math.log(Math.max(1e-4, m))))) *
  ramp(Math.min(...ms), VETO_LO, VETO_HI);

/** Count direction reversals along one axis with hysteresis (amplitude in SW). */
export function reversals(values, amp) {
  if (!values.length) return 0;
  let count = 0,
    dir = 0,
    ext = values[0];
  const start = values[0];
  for (const v of values) {
    if (dir === 0) {
      // No direction yet: wait until the value leaves the start by `amp`.
      if (v - start > amp) {
        dir = 1;
        ext = v;
      } else if (start - v > amp) {
        dir = -1;
        ext = v;
      }
    } else if (dir === 1) {
      if (v > ext) ext = v;
      else if (ext - v > amp) {
        dir = -1;
        ext = v;
        count++;
      }
    } else {
      if (v < ext) ext = v;
      else if (v - ext > amp) {
        dir = 1;
        ext = v;
        count++;
      }
    }
  }
  return count;
}

function handTrack(frames, key) {
  const fs = frames.filter((f) => f[key]);
  const present = fs.length / Math.max(1, frames.length);
  if (fs.length < 2) return { present, ok: false };
  const k = Math.max(1, Math.round(fs.length * 0.25));
  const head = fs.slice(0, k).map((f) => f[key]);
  const tail = fs.slice(-k).map((f) => f[key]);
  const all_ = fs.map((f) => f[key]);
  const pos = all_.map((h) => h.pos);
  let path = 0;
  for (let i = 1; i < pos.length; i++) path += d2(pos[i], pos[i - 1]);
  const cls = (hs) => {
    const cs = hs.map((h) => shapeClasses(h.shape));
    return Object.fromEntries(
      Object.keys(cs[0]).map((n) => [n, mean(cs.map((c) => c[n]))]),
    );
  };
  const startPos = meanPt(head.map((h) => h.pos)),
    endPos = meanPt(tail.map((h) => h.pos));
  const xs = pos.map((p) => p.x),
    ys = pos.map((p) => p.y);
  return {
    present,
    ok: true,
    frames: all_,
    head,
    tail,
    startPos,
    endPos,
    meanPos: meanPt(pos),
    startTip: (i) => meanPt(head.map((h) => h.tips[i])),
    endTip: (i) => meanPt(tail.map((h) => h.tips[i])),
    meanTip: (i) => meanPt(all_.map((h) => h.tips[i])),
    wrist: meanPt(all_.map((h) => h.wrist)),
    disp: { x: endPos.x - startPos.x, y: endPos.y - startPos.y },
    path,
    rangeX: Math.max(...xs) - Math.min(...xs),
    rangeY: Math.max(...ys) - Math.min(...ys),
    xs,
    ys,
    sizeRatio:
      mean(tail.map((h) => h.size)) /
      Math.max(1e-6, mean(head.map((h) => h.size))),
    cls: cls(all_),
    startCls: cls(head),
    endCls: cls(tail),
    shape: (hs, fn) => mean(hs.map((h) => fn(h.shape))),
  };
}

/** Summarise a segment once; all rules read from this. */
export function summarize(frames) {
  const body = frames.find((f) => f.body.ok)?.body || frames[0].body;
  const D = handTrack(frames, "D");
  const N = handTrack(frames, "N");
  const twoHand =
    frames.filter((f) => f.D && f.N).length / Math.max(1, frames.length);
  return {
    frames,
    P: body.points,
    D,
    N,
    twoHand,
    duration: frames[frames.length - 1].t - frames[0].t,
  };
}

// ---------------------------------------------------------------------------
// Word rules. kind: 'motion' needs movement; 'static' is also tried on holds.
// ---------------------------------------------------------------------------
export const WORD_RULES = [
  {
    id: "ありがとう",
    kind: "motion",
    fn: ({ D, N, twoHand }) =>
      !N.ok || !D.ok
        ? 0
        : all(
            ramp(twoHand, 0.4, 0.8),
            N.startCls.flat,
            ramp(-N.shape(N.head, (s) => s.palmUp), 0.1, 0.5),
            D.cls.flat,
            near(D.startPos, N.startPos, 0.6),
            ramp(D.disp.y, 0.15, 0.4),
            ramp(D.disp.y - Math.abs(D.disp.x), 0, 0.15),
            ramp(0.7 - N.path, 0, 0.35),
          ),
  },
  {
    id: "挨拶",
    kind: "motion",
    fn: ({ D, N, twoHand }) =>
      !N.ok || !D.ok
        ? 0
        : all(
            ramp(twoHand, 0.4, 0.8),
            D.startCls.index,
            N.startCls.index,
            ramp(
              D.shape(D.head, (s) => s.ext[1]) -
                D.shape(D.tail, (s) => s.ext[1]),
              0.1,
              0.35,
            ),
            ramp(
              N.shape(N.head, (s) => s.ext[1]) -
                N.shape(N.tail, (s) => s.ext[1]),
              0.1,
              0.35,
            ),
            ramp(0.45 - Math.abs(D.meanPos.y - N.meanPos.y), 0, 0.2),
            ramp(1.2 - D.path, 0, 0.5),
          ),
  },
  {
    id: "朝",
    kind: "motion",
    fn: ({ D, P }) =>
      !D.ok
        ? 0
        : all(
            D.startCls.fist,
            near(D.startPos, P.temple, 0.45),
            ramp(-D.disp.y, 0.12, 0.35),
          ),
  },
  {
    id: "昼",
    kind: "static",
    fn: ({ D, P }) =>
      !D.ok
        ? 0
        : all(
            D.cls.U,
            near(D.meanTip(1), P.forehead, 0.4),
            ramp(
              D.shape(D.frames, (s) => s.axis.up),
              0.3,
              0.7,
            ),
            ramp(0.6 - D.path, 0, 0.3),
          ),
  },
  {
    id: "夜",
    kind: "motion",
    fn: ({ D, N, twoHand, P }) =>
      !N.ok || !D.ok
        ? 0
        : all(
            ramp(twoHand, 0.4, 0.8),
            D.cls.flat,
            N.cls.flat,
            ramp(
              D.shape(D.frames, (s) => s.palmFacing),
              0,
              0.4,
            ),
            ramp(Math.min(D.meanPos.y, N.meanPos.y), P.chin.y - 0.6, P.chin.y),
            ramp(D.startPos.x - N.startPos.x, 0.35, 0.75),
            ramp(0.45 - (D.endPos.x - N.endPos.x), 0, 0.3),
          ),
  },
  {
    id: "ごめんなさい",
    kind: "motion",
    fn: ({ D, P }) =>
      !D.ok
        ? 0
        : all(
            D.startCls.pinch,
            near(D.startTip(1), P.brow, 0.4),
            D.endCls.flat,
            ramp(-D.disp.y, 0.15, 0.4),
          ),
  },
  {
    id: "良い",
    kind: "motion",
    fn: ({ D, P }) =>
      !D.ok
        ? 0
        : all(
            D.cls.fist,
            near(D.startPos, P.nose, 0.45),
            ramp(D.sizeRatio, 1.02, 1.15), // pushed forward (toward the camera)
            ramp(0.35 + D.disp.y, 0, 0.2),
          ),
  },
  {
    id: "お願い",
    kind: "motion",
    fn: ({ D, P }) =>
      !D.ok
        ? 0
        : all(
            Math.min(D.startCls.flat, D.endCls.flat),
            near(D.startPos, P.nose, 0.55),
            Math.max(ramp(D.sizeRatio, 1.02, 1.15), ramp(-D.disp.y, 0.1, 0.3)),
            ramp(1.0 - D.rangeX, 0, 0.4),
          ),
  },
  {
    id: "さようなら",
    kind: "motion",
    fn: ({ D, P }) =>
      !D.ok
        ? 0
        : all(
            D.cls.flat,
            ramp(
              D.shape(D.frames, (s) => s.palmFacing),
              0,
              0.4,
            ),
            ramp(D.meanPos.y, P.chest.y + 0.2, P.chin.y - 0.2),
            ramp(reversals(D.xs, 0.08), 0.5, 2),
            ramp(D.rangeX - D.rangeY, 0, 0.12),
          ),
  },
  {
    id: "大丈夫",
    kind: "motion",
    fn: ({ D, P }) =>
      !D.ok
        ? 0
        : all(
            D.cls.flat,
            near(D.startTip(2), P.shNon, 0.55),
            near(D.endTip(2), P.shDom, 0.55),
            ramp(D.disp.x, 0.3, 0.6),
          ),
  },
  {
    id: "好き",
    kind: "motion",
    fn: ({ D, P }) =>
      !D.ok
        ? 0
        : all(
            D.startCls.pinchOpen,
            Math.max(
              near(D.startPos, P.throat, 0.5),
              near(D.startPos, P.chin, 0.5),
            ),
            D.endCls.pinch,
            ramp(
              D.shape(D.head, (s) => s.contact.ti) -
                D.shape(D.tail, (s) => s.contact.ti),
              0.2,
              0.5,
            ),
          ),
  },
  {
    id: "元気",
    kind: "motion",
    fn: ({ D, N, P }) =>
      !D.ok
        ? 0
        : all(
            D.cls.fist,
            near(D.meanPos, P.chest, 0.8),
            ramp(reversals(D.ys, 0.08), 0.5, 2),
            ramp(D.rangeY - D.rangeX, -0.05, 0.1),
            // Short strokes in front of the chest, not big sweeps from face to waist.
            1 - ramp(D.rangeY, 0.7, 1.1),
            // Not お疲れ様: the other hand moves too, or the fist is away from its wrist.
            N.ok
              ? Math.max(
                  ramp(N.path, 0.15, 0.4),
                  1 - near(D.meanPos, N.wrist, 0.35),
                )
              : 1,
          ) * (N.ok && N.cls.fist > 0.5 ? 1 : 0.92),
  },
  {
    id: "会う",
    kind: "motion",
    fn: ({ D, N, twoHand }) =>
      !N.ok || !D.ok
        ? 0
        : all(
            ramp(twoHand, 0.4, 0.8),
            D.cls.index,
            N.cls.index,
            ramp(d2(D.startPos, N.startPos), 0.4, 0.75),
            ramp(0.5 - d2(D.endPos, N.endPos), 0, 0.25),
            ramp(-D.disp.x, 0.05, 0.25),
            ramp(N.disp.x, 0.05, 0.25),
          ),
  },
  {
    id: "初め",
    kind: "motion",
    fn: ({ D }) =>
      !D.ok
        ? 0
        : all(D.startCls.flat, D.endCls.index, ramp(D.disp.y, 0.2, 0.45)),
  },
  {
    id: "お疲れ様",
    kind: "motion",
    fn: ({ D, N, twoHand }) =>
      !N.ok || !D.ok
        ? 0
        : all(
            ramp(twoHand, 0.4, 0.8),
            D.cls.fist,
            near(D.meanPos, N.wrist, 0.55),
            ramp(reversals(D.ys, 0.05), 0.5, 2),
            ramp(0.6 - N.path, 0, 0.3),
          ),
  },
  {
    id: "わかる",
    kind: "motion",
    fn: ({ D, P }) =>
      !D.ok
        ? 0
        : all(
            D.cls.flat,
            ramp(-D.shape(D.frames, (s) => s.palmFacing), 0, 0.4),
            near(D.startPos, P.chest, 0.75),
            ramp(-D.disp.y, 0.15, 0.4),
            ramp(-D.disp.y - Math.abs(D.disp.x), 0, 0.15),
            ramp(1.5 - reversals(D.ys, 0.1), 0, 1),
          ),
  },
  {
    id: "何",
    kind: "motion",
    fn: ({ D }) =>
      !D.ok
        ? 0
        : all(
            D.cls.index,
            ramp(
              D.shape(D.frames, (s) => s.fingerDir[1].up),
              0.3,
              0.7,
            ),
            ramp(reversals(D.xs, 0.06), 0.5, 2),
            ramp(D.rangeX - D.rangeY, 0, 0.08),
          ),
  },
  {
    id: "私",
    kind: "static",
    fn: ({ D, P }) =>
      !D.ok
        ? 0
        : all(
            D.cls.index,
            Math.max(
              near(D.meanTip(1), P.chest, 0.55),
              near(D.meanTip(1), P.nose, 0.4),
            ),
            ramp(-D.shape(D.frames, (s) => s.fingerDir[1].fwd), 0.2, 0.6),
            ramp(0.6 - D.path, 0, 0.3),
          ),
  },
  {
    id: "あなた",
    kind: "static",
    fn: ({ D, P }) =>
      !D.ok
        ? 0
        : all(
            D.cls.index,
            ramp(
              D.shape(D.frames, (s) => s.fingerDir[1].fwd),
              0.35,
              0.75,
            ),
            ramp(D.meanPos.y, P.chest.y - 0.6, P.chest.y),
            ramp(P.chin.y - D.meanPos.y, 0, 0.3),
            ramp(0.6 - D.path, 0, 0.3),
          ),
  },
  {
    id: "名前",
    kind: "static",
    fn: ({ D, N, twoHand }) =>
      !N.ok || !D.ok
        ? 0
        : all(
            ramp(twoHand, 0.4, 0.8),
            N.cls.flat,
            ramp(
              N.shape(N.frames, (s) => s.palmFacing),
              0.1,
              0.5,
            ),
            ramp(
              N.shape(N.frames, (s) => s.axis.up),
              0.3,
              0.7,
            ),
            D.cls.thumbFist,
            near(D.meanTip(0), N.meanPos, 0.4),
          ),
  },
  {
    id: "赤",
    kind: "motion",
    fn: ({ D, P }) =>
      !D.ok
        ? 0
        : all(
            D.cls.index,
            near(D.startTip(1), P.mouth, 0.35),
            ramp(D.disp.x, 0.08, 0.25),
            ramp(D.rangeX - D.rangeY, 0, 0.1),
          ),
  },
];

export const COMPOUNDS = [
  { parts: ["朝", "挨拶"], text: "おはよう" },
  { parts: ["昼", "挨拶"], text: "こんにちは" },
  { parts: ["夜", "挨拶"], text: "こんばんは" },
  { parts: ["良い", "お願い"], text: "よろしくお願いします" },
  { parts: ["初め", "会う"], text: "はじめまして" },
];

/** Display text for a single word (some rule ids are glosses). */
export const WORD_TEXT = { 会う: "会う", 何: "何?" };

// ---------------------------------------------------------------------------
// Moving fingerspelling and the four modifier motions.
// ---------------------------------------------------------------------------
const kanaScore = (shapes, id) =>
  mean(shapes.map((s) => classifyKana(s, [KANA_BY_ID[id]])[0].score));

export const MOTION_KANA_RULES = [
  {
    id: "の",
    fn: ({ D }) =>
      !D.ok
        ? 0
        : all(
            D.cls.index,
            ramp(-D.disp.y, 0.15, 0.35),
            ramp(Math.abs(D.disp.x), 0.06, 0.2),
            ramp(1.5 - reversals(D.ys, 0.08), 0, 1),
          ),
  },
  {
    id: "ん",
    fn: ({ D }) => {
      if (!D.ok) return 0;
      const ys = D.ys,
        xs = D.xs;
      let lo = 0;
      for (let i = 1; i < ys.length; i++) if (ys[i] < ys[lo]) lo = i;
      const down = ys[0] - ys[lo],
        up = ys[ys.length - 1] - ys[lo],
        right = xs[xs.length - 1] - xs[lo];
      return all(
        D.cls.index,
        ramp(down, 0.08, 0.2),
        ramp(up, 0.06, 0.18),
        ramp(right, 0.04, 0.15),
      );
    },
  },
  {
    id: "り",
    fn: ({ D }) =>
      !D.ok
        ? 0
        : all(
            D.cls.U,
            ramp(-D.disp.y, 0.15, 0.35),
            ramp(-D.disp.y - Math.abs(D.disp.x), 0, 0.12),
          ),
  },
  {
    id: "を",
    fn: ({ D }) =>
      !D.ok
        ? 0
        : all(
            kanaScore(
              D.head.map((h) => h.shape),
              "お",
            ),
            ramp(1 - D.sizeRatio, 0.07, 0.18),
          ),
  },
  {
    id: "も",
    fn: ({ D }) =>
      !D.ok
        ? 0
        : all(
            ramp(
              D.shape(D.head, (s) => s.contact.ti),
              0.5,
              0.8,
            ),
            ramp(0.45 - D.shape(D.tail, (s) => s.contact.ti), 0, 0.2),
            ramp(
              D.shape(D.frames, (s) => s.ext[2] + s.ext[3] + s.ext[4]) * -1 +
                1.2,
              0,
              0.6,
            ),
            // the hand stays in place (好き closes the same way while moving down)
            ramp(0.2 - Math.hypot(D.disp.x, D.disp.y), 0, 0.1),
          ),
  },
];

export const DAKUTEN = {
  か: "が",
  き: "ぎ",
  く: "ぐ",
  け: "げ",
  こ: "ご",
  さ: "ざ",
  し: "じ",
  す: "ず",
  せ: "ぜ",
  そ: "ぞ",
  た: "だ",
  ち: "ぢ",
  つ: "づ",
  て: "で",
  と: "ど",
  は: "ば",
  ひ: "び",
  ふ: "ぶ",
  へ: "べ",
  ほ: "ぼ",
  う: "ゔ",
};
export const HANDAKUTEN = { は: "ぱ", ひ: "ぴ", ふ: "ぷ", へ: "ぺ", ほ: "ぽ" };
export const SMALL = {
  あ: "ぁ",
  い: "ぃ",
  う: "ぅ",
  え: "ぇ",
  お: "ぉ",
  つ: "っ",
  や: "ゃ",
  ゆ: "ゅ",
  よ: "ょ",
  わ: "ゎ",
};

/**
 * Modifier motion applied to the previous kana, or null.
 * Requires the segment to start in that kana's handshape.
 */
export function modifierFor(seg, lastKana) {
  const { D } = seg;
  if (!D.ok || !lastKana || !KANA_BY_ID[lastKana]) return null;
  const same = kanaScore(
    D.head.map((h) => h.shape),
    lastKana,
  );
  if (same < 0.35) return null;
  const { x, y } = D.disp;
  const cand = [];
  if (DAKUTEN[lastKana])
    cand.push({
      kind: "dakuten",
      text: DAKUTEN[lastKana],
      score: all(same, ramp(x, 0.1, 0.25), ramp(x - Math.abs(y), 0, 0.1)),
    });
  if (HANDAKUTEN[lastKana])
    cand.push({
      kind: "handakuten",
      text: HANDAKUTEN[lastKana],
      score: all(same, ramp(y, 0.1, 0.25), ramp(y - Math.abs(x), 0, 0.1)),
    });
  if (SMALL[lastKana])
    cand.push({
      kind: "small",
      text: SMALL[lastKana],
      score: all(
        same,
        ramp(1 - D.sizeRatio, 0.07, 0.16),
        ramp(0.3 - Math.hypot(x, y), 0, 0.15),
      ),
    });
  cand.push({
    kind: "long",
    text: "ー",
    score: all(same, ramp(-y, 0.1, 0.25), ramp(-y - Math.abs(x), 0, 0.1)),
  });
  cand.sort((a, b) => b.score - a.score);
  return cand[0].score > 0.45 ? cand[0] : null;
}

/** Score all built-in word rules for a segment ('motion' or 'static' pass). */
export function scoreWords(seg, kind = "motion") {
  return WORD_RULES.filter((r) =>
    kind === "static" ? r.kind === "static" : true,
  )
    .map((r) => ({ label: r.id, score: r.fn(seg) }))
    .sort((a, b) => b.score - a.score);
}

export function scoreMotionKana(seg) {
  // Fingerspelling is one-handed. If the other hand is up and active — moving,
  // or held at the same height as the dominant hand (挨拶, 会う) — this is a
  // two-handed word, not a moving kana. A hand resting low is ignored.
  const { D, N, twoHand } = seg;
  const active =
    N.ok && D.ok
      ? Math.max(
          ramp(N.path, 0.08, 0.2),
          1 - ramp(Math.abs(D.meanPos.y - N.meanPos.y), 0.25, 0.5),
        )
      : 0;
  const oneHand = 1 - 0.8 * ramp(twoHand, 0.4, 0.8) * active;
  return MOTION_KANA_RULES.map((r) => ({
    label: r.id,
    score: r.fn(seg) * oneHand,
  })).sort((a, b) => b.score - a.score);
}

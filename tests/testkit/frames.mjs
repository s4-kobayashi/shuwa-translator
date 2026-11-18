// Synthetic detector output (the same shape js/detector.js returns) for a
// standard upper-body framing, so tests exercise the full features → recogniser
// path. Positions are given in body coordinates (shoulder widths, +x toward the
// dominant side, +y up) and converted to image coordinates here.
import { buildHand, pose, F } from "./handmodel.mjs";
import { KANA_POSES } from "./kana-poses.mjs";
import { frameFeatures, bodyFrame } from "../../js/features.js";

export const ASPECT = 4 / 3;
const P = (x, y, v = 0.99) => ({ x, y, z: 0, visibility: v });
/** Frontal person; pose[12] = right shoulder appears on the image left. */
export const STD_POSE = (() => {
  const p = Array.from({ length: 33 }, () => P(0.5, 0.9, 0.2));
  p[0] = P(0.5, 0.42); // nose
  p[2] = P(0.52, 0.38);
  p[5] = P(0.48, 0.38); // eyes (left eye on image right)
  p[7] = P(0.55, 0.39);
  p[8] = P(0.45, 0.39);
  p[9] = P(0.51, 0.47);
  p[10] = P(0.49, 0.47); // mouth
  p[11] = P(0.6, 0.66);
  p[12] = P(0.4, 0.66); // shoulders
  p[15] = P(0.62, 0.95, 0.3);
  p[16] = P(0.38, 0.95, 0.3);
  return p;
})();
export const BODY = bodyFrame(STD_POSE, ASPECT, "right");
export const BP = BODY.points;

const SHAPES = {
  ...Object.fromEntries(Object.entries(KANA_POSES).map(([k, v]) => [k, v])),
  flat: { fingers: [F.E, F.E, F.E, F.E], abd: [2, 0, -2, -4], thumb: "tuck" },
  open: { fingers: [F.E, F.E, F.E, F.E], abd: [10, 0, -8, -16], thumb: "out" },
  fist: KANA_POSES["さ"],
  thumbFist: KANA_POSES["た"],
  index: KANA_POSES["ひ"],
  U: KANA_POSES["う"],
  pinchOpen: { fingers: [[10, 10, 5], F.C, F.C, F.C], thumb: "out" },
  pinch: { fingers: [[40, 45, 25], F.C, F.C, F.C], thumb: { touch: 8 } },
  indexBent: { fingers: [[10, 70, 50], F.C, F.C, F.C], thumb: "across" },
};

/**
 * One hand in detector format.
 * @param {{shape: string, orient?: string, at: {x,y}, side?: 'right'|'left', size?: number, depth?: number}} h
 */
export function detHand({
  shape,
  orient,
  at,
  side = "right",
  size = 0.25,
  r,
  jitter = 0,
  noise = 0,
}) {
  const def = SHAPES[shape];
  if (!def) throw new Error("unknown shape " + shape);
  const L = buildHand(def);
  const world = pose(L, {
    orient: orient || def.orient || "up",
    mirror: side === "left",
    r,
    jitterDeg: jitter,
    noise,
  });
  const pc = [0, 5, 9, 13, 17].reduce(
    (a, i) => ({ x: a.x + world[i].x / 5, y: a.y + world[i].y / 5 }),
    { x: 0, y: 0 },
  );
  const sw = BODY.sw;
  const midX = ((STD_POSE[11].x + STD_POSE[12].x) / 2) * ASPECT;
  const midY = (STD_POSE[11].y + STD_POSE[12].y) / 2;
  const Xc = midX - at.x * sw; // right-dominant body frame: +x is the image left
  const Yc = midY - at.y * sw;
  const k = (size * sw) / 0.092;
  const landmarks = world.map((p) => ({
    x: (Xc + k * (p.x - pc.x)) / ASPECT,
    y: Yc + k * (p.y - pc.y),
    z: (k * p.z) / ASPECT,
  }));
  return {
    landmarks,
    world,
    label: side === "right" ? "Right" : "Left",
    score: 0.98,
  };
}

/** Feature frame for given hands at time t (ms). */
export function frame(t, { D, N, pose: poseLm = STD_POSE } = {}) {
  const hands = [];
  if (D) hands.push(detHand({ side: "right", ...D }));
  if (N) hands.push(detHand({ side: "left", ...N }));
  return frameFeatures(
    { hands, pose: poseLm },
    { aspect: ASPECT, dominant: "right", t },
  );
}

const lerp = (a, b, w) => a + (b - a) * w;
const lerpPt = (a, b, w) => ({ x: lerp(a.x, b.x, w), y: lerp(a.y, b.y, w) });

/**
 * A movement as a list of frames. keys: [{ at: 0..1, D: {shape, at, ...}, N: {...} }]
 * Positions interpolate linearly between keys; the shape switches at each key.
 * Optional `wiggle(w)` returns an {x,y} offset added to D (for oscillations).
 */
export function movement(
  keys,
  { ms = 900, fps = 30, t0 = 0, wiggle, wiggleN } = {},
) {
  const n = Math.round((ms / 1000) * fps);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const w = i / n;
    let k = 0;
    while (k < keys.length - 2 && w > keys[k + 1].at) k++;
    const a = keys[k],
      b = keys[Math.min(k + 1, keys.length - 1)];
    const lw =
      b.at > a.at ? Math.min(1, Math.max(0, (w - a.at) / (b.at - a.at))) : 1;
    const pick = (ka, kb, extra) => {
      if (!ka) return null;
      const at = kb ? lerpPt(ka.at, kb.at, lw) : ka.at;
      const off = extra ? extra(w) : { x: 0, y: 0 };
      const src = lw > 0.5 && kb ? kb : ka;
      return {
        ...src,
        at: { x: at.x + off.x, y: at.y + off.y },
        size: kb && ka.size && kb.size ? lerp(ka.size, kb.size, lw) : src.size,
      };
    };
    out.push(
      frame(t0 + (i * 1000) / fps, {
        D: pick(a.D, b.D, wiggle),
        N: pick(a.N, b.N, wiggleN),
      }),
    );
  }
  return out;
}

/** n frames holding still. */
export function hold(spec, { ms = 800, fps = 30, t0 = 0 } = {}) {
  const n = Math.round((ms / 1000) * fps);
  return Array.from({ length: n }, (_, i) =>
    frame(t0 + (i * 1000) / fps, spec),
  );
}

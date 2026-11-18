// Handshape classification: built-in JSL fingerspelling prototypes (see
// docs/vocabulary.md for the source of every entry), generic handshape classes
// used by word rules, and the vector form used for user-recorded templates.
import { clamp01, meanDir } from "./features.js";

const E = 1,
  C = 0,
  H = 0.5,
  _ = null;

const hinge = (v) => (v > 0 ? v : 0);
const ramp = (v, lo, hi) => clamp01((v - lo) / (hi - lo));

// ---------------------------------------------------------------------------
// Prototype spec fields
//   ext:   [thumb, index, middle, ring, pinky] 1 extended / 0 curled / .5 half / null any
//   dir:   [fingers, target]  target: up | down | side | fwd | fwdDown
//   tdir:  thumb direction target (up | side)
//   palm:  viewer | signer
//   touch: { ti, tm, tr, tp, tmPip: true (touching) | false (apart) }
//   spread: together | apart     cross: true    hook: [finger indices]
//   bent:  true  (fingers bent at the knuckles, straight beyond — こ)
//   claw:  true  (fingers bent at the middle joints — え)
// ---------------------------------------------------------------------------
const U2 = [1, 2],
  W3 = [1, 2, 3],
  F4 = [1, 2, 3, 4];

export const KANA_SPECS = [
  { id: "あ", ext: [E, C, C, C, C], tdir: "side" },
  { id: "い", ext: [C, C, C, C, E], dir: [[4], "up"] },
  {
    id: "う",
    ext: [C, E, E, C, C],
    dir: [U2, "up"],
    palm: "viewer",
    nocross: true,
  },
  { id: "え", ext: [C, _, _, _, _], claw: true },
  { id: "お", ext: [_, H, H, H, H], touch: { ti: true }, round: true },
  {
    id: "か",
    ext: [E, E, E, C, C],
    dir: [[1], "up"],
    touch: { tmPip: true },
    spread: "apart",
  },
  { id: "き", ext: [_, E, _, _, E], touch: { tm: true, tr: true } },
  { id: "く", ext: [E, E, E, E, E], dir: [F4, "side"] },
  { id: "け", ext: [C, E, E, E, E], dir: [F4, "up"] },
  { id: "こ", ext: [_, _, _, _, _], bent: true, palm: "edge" },
  { id: "さ", ext: [C, C, C, C, C], fistThumbFront: true },
  { id: "し", ext: [E, E, E, C, C], dir: [U2, "side"] },
  { id: "す", ext: [E, E, E, C, C], dir: [U2, "down"] },
  { id: "せ", ext: [C, C, E, C, C], dir: [[2], "up"], palm: "viewer" },
  { id: "そ", ext: [C, E, C, C, C], dir: [[1], "fwdDown"] },
  { id: "た", ext: [E, C, C, C, C], tdir: "up" },
  {
    id: "ち",
    ext: [_, H, H, H, E],
    touch: { ti: true, tm: true },
    pursed: [1, 2],
  },
  {
    id: "つ",
    ext: [_, H, H, E, E],
    touch: { ti: true, tm: true },
    pursed: [1, 2],
  },
  { id: "て", ext: [E, E, E, E, E], dir: [F4, "up"], palm: "viewer" },
  {
    id: "と",
    ext: [C, E, E, C, C],
    dir: [U2, "up"],
    palm: "signer",
    nocross: true,
  },
  { id: "な", ext: [C, E, E, C, C], dir: [U2, "down"], nocross: true },
  { id: "に", ext: [C, E, E, C, C], dir: [U2, "side"], nocross: true },
  { id: "ぬ", ext: [C, _, C, C, C], hook: [1] },
  { id: "ね", ext: [E, E, E, E, E], dir: [F4, "down"] },
  { id: "は", ext: [C, E, E, C, C], dir: [U2, "fwd"], nocross: true },
  { id: "ひ", ext: [C, E, C, C, C], dir: [[1], "up"] },
  { id: "ふ", ext: [E, E, C, C, C], dir: [[1], "down"] },
  { id: "へ", ext: [E, C, C, C, E], dir: [[4], "down"] },
  { id: "ほ", ext: [_, _, _, _, _], bent: true, palm: "signer" },
  { id: "ま", ext: [C, E, E, E, C], dir: [W3, "down"], palm: "signer" },
  { id: "み", ext: [C, E, E, E, C], dir: [W3, "side"], palm: "signer" },
  { id: "む", ext: [E, E, C, C, C], dir: [[1], "side"], tdir: "up" },
  {
    id: "め",
    ext: [_, _, E, E, E],
    touch: { ti: true },
    dir: [[2, 3, 4], "up"],
  },
  { id: "や", ext: [E, C, C, C, E], dir: [[4], "up"] },
  { id: "ゆ", ext: [C, E, E, E, C], dir: [W3, "up"], palm: "signer" },
  { id: "よ", ext: [C, E, E, E, E], dir: [F4, "side"] },
  { id: "ら", ext: [C, E, E, C, C], cross: true },
  { id: "る", ext: [E, E, E, C, C], dir: [U2, "up"], touch: { tmPip: false } },
  { id: "れ", ext: [E, E, C, C, C], dir: [[1], "up"], tdir: "side" },
  { id: "ろ", ext: [C, _, _, C, C], hook: [1, 2] },
  { id: "わ", ext: [C, E, E, E, C], dir: [W3, "up"], palm: "viewer" },
];

// Base handshapes of the moving kana (used by the dynamic channel).
export const MOTION_KANA_BASE = {
  の: "ひ",
  ん: "ひ",
  り: "う",
  を: "お",
};

const DIR_TARGET = {
  up: { out: 0, up: 1, fwd: 0 },
  down: { out: 0, up: -1, fwd: 0 },
  fwd: { out: 0, up: 0, fwd: 1 },
  fwdDown: { out: 0.15, up: -0.5, fwd: 0.85 },
};

function dirCos(d, target) {
  if (target === "side") return Math.abs(d.out);
  const t = DIR_TARGET[target];
  const l = Math.hypot(t.out, t.up, t.fwd);
  return (d.out * t.out + d.up * t.up + d.fwd * t.fwd) / l;
}

function extPenalty(e, target, thumb) {
  if (target === 1) return hinge((thumb ? 0.55 : 0.62) - e) / 0.18;
  if (target === 0) return hinge(e - (thumb ? 0.42 : 0.38)) / 0.18;
  // Half-bent: measured 0.22–0.51 on rounded fingers; an extended pinky can read as low as 0.58.
  return hinge(0.28 - e) / 0.18 + hinge(e - 0.6) / 0.12;
}

/** Penalty (sum of squares) of a shape against one prototype. */
export function specPenalty(s, spec) {
  let D = 0;
  const add = (p, w = 1) => {
    D += w * p * p;
  };
  spec.ext.forEach((t, i) => {
    if (t !== null) add(extPenalty(s.ext[i], t, i === 0), i === 0 ? 0.8 : 1);
  });
  if (spec.dir) {
    const [fingers, target] = spec.dir;
    add((1 - dirCos(meanDir(s, fingers), target)) / 0.32);
  }
  if (spec.tdir) {
    const d = s.fingerDir[0];
    if (spec.tdir === "up") add(hinge(0.75 - d.up) / 0.3);
    else
      add(
        hinge(d.up - 0.45) / 0.3 + hinge(0.55 - Math.hypot(d.out, d.fwd)) / 0.3,
      );
  }
  if (spec.palm === "edge") add(hinge(Math.abs(s.palmFacing) - 0.55) / 0.25);
  if (spec.palm === "viewer") add(hinge(0.15 - s.palmFacing) / 0.3);
  if (spec.palm === "signer") add(hinge(s.palmFacing + 0.15) / 0.3);
  if (spec.touch) {
    for (const [k, must] of Object.entries(spec.touch)) {
      const d = s.contact[k];
      add(must ? hinge(d - 0.38) / 0.16 : hinge(0.42 - d) / 0.14);
    }
  }
  if (spec.spread === "apart") add(hinge(0.18 - s.spreadIM) / 0.1);
  if (spec.spread === "together") add(hinge(s.spreadIM - 0.35) / 0.15);
  if (spec.cross) add(hinge(s.crossIM + 0.02) / 0.08);
  if (spec.nocross) add(hinge(-s.crossIM - 0.05) / 0.08);
  // Curled fingers bend at the knuckle and rest on the palm (separates a fist
  // from hooks and claws). Real fists measure tip-to-palm ≈ 0.3, knuckle ≈ 0.6–0.9.
  spec.ext.forEach((t, f) => {
    if (f > 0 && t === 0 && !(spec.hook && spec.hook.includes(f)))
      add(
        hinge(s.tipPalmF[f] - 0.55) / 0.15 + hinge(0.35 - s.mcpBend[f]) / 0.15,
        0.7,
      );
  });
  if (spec.hook) {
    for (const f of spec.hook)
      add(
        hinge(s.mcpBend[f] - 0.45) / 0.15 +
          hinge(0.5 - s.distalBend[f]) / 0.18 +
          hinge(0.5 - s.tipPalmF[f]) / 0.12, // hooked finger stays off the palm
      );
  }
  if (spec.bent) {
    for (const f of F4)
      add(
        0.5 *
          (hinge(0.5 - s.mcpBend[f]) / 0.18 +
            hinge(s.distalBend[f] - 0.4) / 0.18),
      );
  }
  if (spec.claw) {
    for (const f of F4)
      add(
        0.5 *
          (hinge(0.8 - s.distalBend[f]) / 0.1 +
            hinge(s.mcpBend[f] - 0.7) / 0.2),
      );
    // A claw keeps its fingertips close to the palm; a half-open transition hand does not.
    add(hinge(s.tipPalm - 0.8) / 0.12);
    add(hinge(0.45 - s.tipPalm) / 0.12); // a fist has its fingertips on the palm
  }
  if (spec.round) {
    add(hinge(0.75 - s.tipPalm) / 0.2);
    add(hinge(s.tipPalm - 1.45) / 0.2);
  }
  if (spec.pursed) {
    for (const f of spec.pursed)
      add(
        (0.5 * hinge(s.contact[["", "ti", "tm", "tr", "tp"][f]] - 0.45)) / 0.18,
      );
  }
  if (spec.fistThumbFront) add(hinge(s.contact.tmPip - 0.6) / 0.2);
  return D;
}

/**
 * Score every static kana prototype. Returns [{label, score}] sorted desc.
 * score = exp(-penalty/2): 1 perfect, ~0.6 one soft violation, <0.2 clear mismatch.
 */
export function classifyKana(shape, specs = KANA_SPECS) {
  return specs
    .map((sp) => ({
      label: sp.id,
      score: Math.exp(-specPenalty(shape, sp) / 2),
    }))
    .sort((a, b) => b.score - a.score);
}

export const KANA_BY_ID = Object.fromEntries(KANA_SPECS.map((s) => [s.id, s]));

/** Fuzzy memberships of generic handshapes used by word rules. */
export function shapeClasses(s) {
  const ext = (f) => ramp(s.ext[f], 0.45, 0.75);
  const cur = (f) => 1 - ramp(s.ext[f], 0.3, 0.6);
  const minOf = (arr) => Math.min(...arr);
  const flat = minOf([ext(1), ext(2), ext(3), ext(4)]);
  const fist = minOf([cur(1), cur(2), cur(3), cur(4)]);
  return {
    flat,
    open: flat * ext(0),
    fist,
    thumbFist: fist * ramp(s.ext[0], 0.4, 0.7),
    index: ext(1) * minOf([cur(2), cur(3), cur(4)]),
    U: ext(1) * ext(2) * Math.min(cur(3), cur(4)),
    pinchOpen:
      ramp(s.ext[0], 0.3, 0.6) *
      ramp(s.ext[1], 0.25, 0.55) *
      minOf([cur(2), cur(3), cur(4)]) *
      ramp(s.contact.ti, 0.45, 0.85),
    pinch: 1 - ramp(s.contact.ti, 0.28, 0.5),
  };
}

/** Fixed-length numeric vector for user templates (k-NN). */
export function shapeVector(s) {
  const c = s.contact;
  const cap = (v) => Math.min(v, 1.6) / 1.6;
  return [
    ...s.ext,
    ...s.mcpBend.slice(1),
    ...s.distalBend.slice(1),
    cap(c.ti),
    cap(c.tm),
    cap(c.tr),
    cap(c.tp),
    cap(c.tmPip),
    s.palmFacing,
    s.palmUp,
    s.axis.out,
    s.axis.up,
    s.axis.fwd,
    Math.min(s.spreadIM, 1),
    Math.max(-1, Math.min(1, s.crossIM)),
    Math.min(s.tipPalm, 2) / 2,
  ];
}

export function vecDist(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += (a[i] - b[i]) ** 2;
  return Math.sqrt(d / a.length);
}

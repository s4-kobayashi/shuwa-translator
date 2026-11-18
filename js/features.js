// Pure feature extraction from MediaPipe landmarks (no DOM access).
//
// Conventions used everywhere downstream:
// - Every hand is canonicalised to RIGHT-hand geometry (left hands are mirrored
//   in x), so one set of handshape templates serves both hands.
// - Direction vectors are expressed as { out, up, fwd }:
//     out = toward the hand's own side (a right hand's "out" is the signer's right),
//     up  = toward the top of the image,
//     fwd = toward the camera (the viewer).
// - Body coordinates (bx, by) are in shoulder widths, origin at the shoulder
//   midpoint, by up, bx positive toward the signer's DOMINANT side. A
//   left-handed signer therefore produces the same numbers as a right-handed
//   one, which is how templates are shared.

export const TIP = [4, 8, 12, 16, 20];
export const MCP = [2, 5, 9, 13, 17];
export const PIP = [3, 6, 10, 14, 18];
export const DIP = [3, 7, 11, 15, 19];

const sub = (a, b) => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: (a.z || 0) - (b.z || 0),
});
const add = (a, b) => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: (a.z || 0) + (b.z || 0),
});
const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: (a.z || 0) * s });
const dot = (a, b) => a.x * b.x + a.y * b.y + (a.z || 0) * (b.z || 0);
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const len = (a) => Math.hypot(a.x, a.y, a.z || 0);
const unit = (a) => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l, z: (a.z || 0) / l };
};
const angle = (a, b) =>
  Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b)))));
export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const dist = (a, b) => len(sub(a, b));

/** Convert a camera-axes unit vector of a canonical right hand to {out, up, fwd}. */
const toOUF = (v) => ({ out: -v.x, up: -v.y, fwd: -v.z });

/**
 * Anatomical side of a detected hand ('left' | 'right' as the PERSON's hand).
 *
 * Measured with @mediapipe/tasks-vision 0.10.35 on unmirrored frames: the
 * handedness label is already anatomical (a right hand, palm to the camera,
 * is labelled "Right"; see tests/features.test.mjs which pins this with real
 * landmarks). The legacy "assumes a mirrored image" note does not apply here,
 * so the label is used as-is.
 */
export function anatomicalSide(hand) {
  if (hand.label === "Left") return "left";
  if (hand.label === "Right") return "right";
  return "right";
}

/** Joint bends of one landmark set (already canonicalised). */
function bends(W) {
  const palmSize = dist(W[0], W[9]) || 1e-6;
  const ext = [0, 0, 0, 0, 0];
  const mcpBend = [0, 0, 0, 0, 0];
  const distalBend = [0, 0, 0, 0, 0];
  for (let f = 1; f < 5; f++) {
    const m = MCP[f],
      p = PIP[f],
      d = DIP[f],
      t = TIP[f];
    const aM = angle(sub(W[m], W[0]), sub(W[p], W[m]));
    const aP = angle(sub(W[p], W[m]), sub(W[d], W[p]));
    const aD = angle(sub(W[d], W[p]), sub(W[t], W[d]));
    mcpBend[f] = clamp01(aM / 1.4);
    distalBend[f] = clamp01((aP + aD) / 2.6);
    ext[f] = 1 - clamp01((aM + aP + aD - 0.35) / 3.0);
  }
  // Thumb (calibrated on real MediaPipe output, see tests/fixtures): extended
  // = straight chain AND tip far from the wrist. Thumbs-up ≈ 1, fist ≈ 0.05,
  // thumb folded over fingers (pointing / victory) ≈ 0.1–0.25.
  const bendSum =
    angle(sub(W[2], W[1]), sub(W[3], W[2])) +
    angle(sub(W[3], W[2]), sub(W[4], W[3]));
  const straight = 1 - clamp01((bendSum - 0.3) / 1.2);
  const reach = clamp01((dist(W[4], W[0]) / palmSize - 1.0) / 0.4);
  ext[0] = 0.5 * straight + 0.5 * reach;
  return { ext, mcpBend, distalBend };
}

const canon = (pts, side) =>
  pts.map((p) => ({ x: side === "left" ? -p.x : p.x, y: p.y, z: p.z || 0 }));

/**
 * Handshape features of one hand.
 * @param {{x,y,z}[]} pts 21 points. World landmarks (metres) preferred; image
 *   landmarks also work if x is aspect-corrected.
 * @param {'left'|'right'} side anatomical side; left hands are mirrored.
 * @param {{x,y,z}[]} [alt] a second estimate of the same hand (aspect-corrected
 *   image landmarks). Joint bends are averaged over both estimates, which
 *   halves the error either one makes on foreshortened fingers.
 */
export function handShape(pts, side, alt) {
  const W = canon(pts, side);
  const palmSize = dist(W[0], W[9]) || 1e-6;
  let { ext, mcpBend, distalBend } = bends(W);
  if (alt && alt.length === 21) {
    const b = bends(canon(alt, side));
    const avg = (a, c) => a.map((v, i) => (v + c[i]) / 2);
    ext = avg(ext, b.ext);
    mcpBend = avg(mcpBend, b.mcpBend);
    distalBend = avg(distalBend, b.distalBend);
  }

  const contact = {
    ti: dist(W[4], W[8]) / palmSize,
    tm: dist(W[4], W[12]) / palmSize,
    tr: dist(W[4], W[16]) / palmSize,
    tp: dist(W[4], W[20]) / palmSize,
    tmPip: Math.min(dist(W[4], W[10]), dist(W[4], W[11])) / palmSize,
    thumbToPalm:
      dist(W[4], scale(add(add(W[5], W[9]), add(W[13], W[17])), 0.25)) /
      palmSize,
  };

  // Palm frame: across = pinky knuckle -> index knuckle, normal toward the palm side.
  const across = unit(sub(W[5], W[17]));
  const n = unit(cross(sub(W[5], W[0]), sub(W[17], W[0])));
  const palmFacing = -n.z; // +1 palm toward camera/viewer, -1 toward signer
  const palmUp = -n.y; // +1 palm toward ceiling

  const fingerDir = [];
  for (let f = 0; f < 5; f++)
    fingerDir.push(toOUF(unit(sub(W[TIP[f]], W[MCP[f]]))));
  const axis = toOUF(unit(sub(W[9], W[0])));

  const spreadIM = angle(sub(W[8], W[5]), sub(W[12], W[9]));
  const spreadMR = angle(sub(W[12], W[9]), sub(W[16], W[13]));
  const crossIM = dot(sub(W[8], W[12]), across) / palmSize; // < 0 when index crosses over middle
  const tipGapIM = dist(W[8], W[12]) / palmSize;
  const palmC = scale(
    [0, 5, 9, 13, 17].reduce((a, i) => add(a, W[i]), { x: 0, y: 0, z: 0 }),
    0.2,
  );
  // Fingertip distance from the palm centre (palm sizes): fist ≈ 0.3,
  // claw/hook ≈ 0.5–0.9, straight finger ≈ 1.6+.
  const tipPalmF = [
    0,
    ...[8, 12, 16, 20].map((i) => dist(W[i], palmC) / palmSize),
  ];
  const tipPalm = (tipPalmF[1] + tipPalmF[2] + tipPalmF[3] + tipPalmF[4]) / 4;

  return {
    tipPalm,
    tipPalmF,
    ext,
    mcpBend,
    distalBend,
    contact,
    palmFacing,
    palmUp,
    fingerDir,
    axis,
    spreadIM,
    spreadMR,
    crossIM,
    tipGapIM,
    palmSize,
  };
}

/** Mean direction of the given fingers ({out,up,fwd}, unit). */
export function meanDir(shape, fingers) {
  let o = 0,
    u = 0,
    f = 0;
  for (const i of fingers) {
    o += shape.fingerDir[i].out;
    u += shape.fingerDir[i].up;
    f += shape.fingerDir[i].fwd;
  }
  const l = Math.hypot(o, u, f) || 1;
  return { out: o / l, up: u / l, fwd: f / l };
}

/**
 * Body reference frame from pose landmarks (normalised image coords).
 * Falls back to an image-centred frame scaled by hand size when no pose.
 */
export function bodyFrame(
  pose,
  aspect,
  dominant = "right",
  fallbackHandSize = 0.08,
) {
  const s = dominant === "right" ? -1 : 1;
  const P = (p) => ({ x: p.x * aspect, y: p.y, z: 0 });
  let mid,
    sw,
    ok = false;
  if (
    pose &&
    pose[11] &&
    pose[12] &&
    (pose[11].visibility ?? 1) > 0.3 &&
    (pose[12].visibility ?? 1) > 0.3
  ) {
    const L = P(pose[11]),
      R = P(pose[12]);
    mid = scale(add(L, R), 0.5);
    sw = Math.max(dist(L, R), 0.05);
    ok = true;
  } else {
    sw = Math.max(fallbackHandSize * 3.2, 0.12);
    mid = { x: aspect * 0.5, y: 0.8, z: 0 };
  }
  const toBody = (p) => {
    const q = P(p);
    return { x: (s * (q.x - mid.x)) / sw, y: -(q.y - mid.y) / sw };
  };
  const frame = { ok, sw, aspect, s, toBody };
  if (ok) {
    const nose = toBody(pose[0]);
    const eyeL = toBody(pose[2]),
      eyeR = toBody(pose[5]);
    const mouth = {
      x: (toBody(pose[9]).x + toBody(pose[10]).x) / 2,
      y: (toBody(pose[9]).y + toBody(pose[10]).y) / 2,
    };
    const eyes = { x: (eyeL.x + eyeR.x) / 2, y: (eyeL.y + eyeR.y) / 2 };
    const faceH = Math.max(0.15, eyes.y - mouth.y);
    // Person's left shoulder = pose 11. Dominant shoulder for a right-hander = 12.
    const shDom = toBody(dominant === "right" ? pose[12] : pose[11]);
    const shNon = toBody(dominant === "right" ? pose[11] : pose[12]);
    const eyeDom = dominant === "right" ? eyeR : eyeL;
    frame.points = {
      nose,
      mouth,
      eyes,
      brow: { x: eyes.x, y: eyes.y + faceH * 0.35 },
      forehead: { x: eyes.x, y: eyes.y + faceH * 1.0 },
      chin: { x: mouth.x, y: mouth.y - faceH * 0.7 },
      throat: { x: mouth.x, y: mouth.y - faceH * 1.5 },
      chest: { x: 0, y: -0.45 },
      shDom,
      shNon,
      temple: { x: eyeDom.x + 0.22, y: eyeDom.y + faceH * 0.2 },
    };
  } else {
    // Without pose, assume a typical upper-body framing (face above the hands).
    frame.points = {
      nose: { x: 0, y: 1.3 },
      mouth: { x: 0, y: 1.1 },
      eyes: { x: 0, y: 1.45 },
      brow: { x: 0, y: 1.55 },
      forehead: { x: 0, y: 1.75 },
      chin: { x: 0, y: 0.9 },
      throat: { x: 0, y: 0.6 },
      chest: { x: 0, y: -0.45 },
      shDom: { x: 0.5, y: 0 },
      shNon: { x: -0.5, y: 0 },
      temple: { x: 0.35, y: 1.5 },
    };
  }
  return frame;
}

/** Per-hand frame summary in body coordinates. */
export function handSummary(hand, side, body) {
  const lm = hand.landmarks;
  const img = lm.map((p) => ({
    x: p.x * body.aspect,
    y: p.y,
    z: (p.z || 0) * body.aspect,
  }));
  const hasWorld = hand.world && hand.world.length === 21;
  const shape = handShape(
    hasWorld ? hand.world : img,
    side,
    hasWorld ? img : undefined,
  );
  const palmImg = [0, 5, 9, 13, 17].reduce(
    (a, i) => ({ x: a.x + lm[i].x / 5, y: a.y + lm[i].y / 5, z: 0 }),
    { x: 0, y: 0, z: 0 },
  );
  const sizeImg = dist(
    { x: lm[0].x * body.aspect, y: lm[0].y, z: 0 },
    { x: lm[9].x * body.aspect, y: lm[9].y, z: 0 },
  );
  return {
    side,
    shape,
    pos: body.toBody(palmImg),
    wrist: body.toBody(lm[0]),
    tips: TIP.map((i) => body.toBody(lm[i])),
    size: sizeImg / body.sw, // apparent hand size in shoulder widths (grows when moving toward camera)
    sizeImg,
  };
}

/**
 * Build the per-frame feature record consumed by the recogniser.
 * @param {{hands: any[], pose: any[]|null}} det detector output
 * @param {{aspect: number, dominant: 'left'|'right', t: number}} ctx
 */
export function frameFeatures(det, { aspect, dominant = "right", t }) {
  const hands = det.hands.map((h) => ({
    h,
    side: anatomicalSide(h),
  }));
  // Both labelled the same side: fall back to image order. Facing the camera,
  // the person's right hand appears on the image's left (smaller x).
  if (hands.length === 2 && hands[0].side === hands[1].side) {
    const leftmost =
      hands[0].h.landmarks[0].x <= hands[1].h.landmarks[0].x ? 0 : 1;
    hands[leftmost].side = "right";
    hands[1 - leftmost].side = "left";
  }
  const handSizeGuess = hands.length
    ? dist(
        {
          x: hands[0].h.landmarks[0].x * aspect,
          y: hands[0].h.landmarks[0].y,
          z: 0,
        },
        {
          x: hands[0].h.landmarks[9].x * aspect,
          y: hands[0].h.landmarks[9].y,
          z: 0,
        },
      )
    : 0.08;
  const body = bodyFrame(det.pose, aspect, dominant, handSizeGuess);
  let D = null,
    N = null;
  if (hands.length === 1) {
    D = handSummary(hands[0].h, hands[0].side, body);
  } else if (hands.length >= 2) {
    const di = hands.findIndex((x) => x.side === dominant);
    const a = di >= 0 ? di : 0;
    D = handSummary(hands[a].h, hands[a].side, body);
    N = handSummary(hands[1 - a].h, hands[1 - a].side, body);
  }
  return { t, body, D, N };
}

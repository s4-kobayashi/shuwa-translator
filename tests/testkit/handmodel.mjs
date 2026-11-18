// Parametric hand model for synthetic tests.
// Produces 21 MediaPipe-ordered 3D landmarks (metres, camera axes: x right,
// y down, z away from the camera) for a RIGHT hand. Canonical pose: wrist at
// origin, fingers up, palm toward the camera — so the thumb sits on +x.
// A left hand is the mirror image (x → -x).

const FINGER = {
  1: { mcp: [0.025, -0.088, 0], bones: [0.04, 0.025, 0.02] },
  2: { mcp: [0.003, -0.092, 0], bones: [0.045, 0.028, 0.021] },
  3: { mcp: [-0.017, -0.087, 0], bones: [0.042, 0.026, 0.02] },
  4: { mcp: [-0.034, -0.078, 0], bones: [0.033, 0.02, 0.018] },
};
const THUMB_CMC = [0.022, -0.025, -0.008];
const THUMB_BONES = [0.032, 0.03, 0.026];

const norm = (v) => {
  const l = Math.hypot(...v) || 1;
  return v.map((x) => x / l);
};
const addv = (a, b) => a.map((x, i) => x + b[i]);
const mul = (a, s) => a.map((x) => x * s);

/** Finger joint presets: [mcp, pip, dip] flexion in degrees. */
export const F = {
  E: [0, 0, 0], // extended
  C: [85, 100, 65], // curled into a fist
  H: [35, 55, 35], // rounded (お)
  B: [85, 4, 4], // bent at the knuckle only (こ)
  K: [8, 95, 65], // hooked (ぬ, ろ)
  W: [28, 92, 70], // claw (え)
  P: [48, 40, 22], // pursed toward the thumb (ち, つ, め)
};

/** Thumb presets as bone directions (canonical frame). */
export const T = {
  side: [
    [0.92, -0.32, -0.22],
    [0.92, -0.32, -0.22],
    [0.92, -0.3, -0.2],
  ],
  up: [
    [0.3, -0.95, -0.12],
    [0.22, -0.97, -0.1],
    [0.2, -0.98, -0.08],
  ],
  out: [
    [1, -0.28, -0.12],
    [1, -0.25, -0.1],
    [1, -0.22, -0.1],
  ],
  across: [
    [0.1, -0.7, -0.7],
    [-0.7, -0.3, -0.65],
    [-0.95, 0.1, -0.3],
  ],
  tuck: [
    [-0.2, -0.6, -0.75],
    [-0.8, -0.3, -0.5],
    [-0.9, 0.2, -0.2],
  ],
};

function fingerChain(f, [m, p, d], abdDeg = 0) {
  const a = (abdDeg * Math.PI) / 180;
  const pts = [FINGER[f].mcp];
  let phi = 0;
  const flex = [m, p, d];
  for (let j = 0; j < 3; j++) {
    phi += (flex[j] * Math.PI) / 180;
    // Rotate (sin a, -cos a, 0) toward -z (the palm side) by the cumulative flexion.
    const dir = [
      Math.sin(a) * Math.cos(phi),
      -Math.cos(a) * Math.cos(phi),
      -Math.sin(phi),
    ];
    pts.push(addv(pts[j], mul(dir, FINGER[f].bones[j])));
  }
  return pts; // mcp, pip, dip, tip
}

/**
 * @param {object} p
 *   fingers: [index, middle, ring, pinky] presets (arrays of 3 degrees)
 *   abd: [index, middle, ring, pinky] abduction degrees (+ toward the thumb)
 *   thumb: preset name from T, or { touch: landmarkIndex }
 */
export function buildHand({ fingers, abd = [4, 0, -4, -9], thumb = "across" }) {
  const L = new Array(21);
  L[0] = [0, 0, 0];
  for (let f = 1; f <= 4; f++) {
    const c = fingerChain(f, fingers[f - 1], abd[f - 1]);
    const base = 1 + f * 4;
    for (let k = 0; k < 4; k++) L[base + k] = c[k];
  }
  L[1] = THUMB_CMC;
  if (typeof thumb === "string") {
    const dirs = T[thumb];
    for (let j = 0; j < 3; j++)
      L[2 + j] = addv(L[1 + j], mul(norm(dirs[j]), THUMB_BONES[j]));
  } else {
    const target = addv(L[thumb.touch], [0.004, 0, -0.008]);
    const base = L[1];
    const mid = (s) =>
      addv(addv(base, mul(addv(target, mul(base, -1)), s)), [
        0.012 * Math.sin(Math.PI * s),
        0,
        -0.012 * Math.sin(Math.PI * s),
      ]);
    L[2] = mid(0.38);
    L[3] = mid(0.7);
    L[4] = target;
  }
  return L;
}

// ---- rotations -------------------------------------------------------------
const rx = (t) => [
  [1, 0, 0],
  [0, Math.cos(t), -Math.sin(t)],
  [0, Math.sin(t), Math.cos(t)],
];
const ry = (t) => [
  [Math.cos(t), 0, Math.sin(t)],
  [0, 1, 0],
  [-Math.sin(t), 0, Math.cos(t)],
];
const rz = (t) => [
  [Math.cos(t), -Math.sin(t), 0],
  [Math.sin(t), Math.cos(t), 0],
  [0, 0, 1],
];
const mm = (A, B) =>
  A.map((r) => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
const mv = (A, v) => A.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const deg = (d) => (d * Math.PI) / 180;

/** Orientation presets for a right hand facing the camera. */
export const ORIENT = {
  up: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  upSigner: ry(Math.PI), // fingers up, back of the hand to the viewer
  down: rz(Math.PI), // fingers down, palm still to the viewer
  downSigner: mm(rz(Math.PI), ry(Math.PI)),
  side: mm(rz(deg(90)), ry(Math.PI)), // fingers across the body, thumb up, back of hand to viewer
  fwd: rx(deg(90)), // fingers toward the viewer, palm down
  profile: ry(deg(90)), // thumb side toward the viewer (palm edge-on)
  fwdDown: mm(rx(deg(120)), rz(deg(-10))),
  back: rx(deg(-90)), // fingers away from the camera (pointing at oneself)
  palmDown: rx(deg(90)), // fingers toward the viewer, palm down
};

/** Seeded PRNG (mulberry32) so tests are reproducible. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function gauss(r) {
  const u = Math.max(1e-9, r()),
    v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Pose a hand: orientation preset, random perturbation, scale and noise.
 * Returns landmarks as [{x,y,z}] in metres (MediaPipe world-landmark style).
 * @param {number[][]} L canonical landmarks from buildHand
 * @param {{orient?: string, jitterDeg?: number, scale?: number, noise?: number, mirror?: boolean, r?: Function}} o
 */
export function pose(
  L,
  {
    orient = "up",
    jitterDeg = 0,
    scale = 1,
    noise = 0,
    mirror = false,
    r = Math.random,
  } = {},
) {
  let R = ORIENT[orient];
  if (jitterDeg) {
    const j = () => deg((r() * 2 - 1) * jitterDeg);
    R = mm(mm(mm(rx(j()), ry(j())), rz(j())), R);
  }
  const palm = Math.hypot(...L[9]) * scale;
  return L.map((p) => {
    let q = mv(R, p).map((v) => v * scale);
    if (noise) q = q.map((v) => v + gauss(r) * noise * palm);
    if (mirror) q[0] = -q[0];
    return { x: q[0], y: q[1], z: q[2] };
  });
}

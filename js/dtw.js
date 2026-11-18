// Few-shot matching for user-registered signs.
//  - static signs: k-NN over handshape vectors (handshape.js#shapeVector)
//  - moving signs: DTW over resampled per-frame vectors (seqVector)
// Every label gets its own acceptance radius learned from its samples
// (leave-one-out), so a sign the user performs consistently is matched
// strictly and a sloppy one loosely — and anything far from every sample is
// rejected instead of being forced onto the nearest label.
import { shapeVector, vecDist } from "./handshape.js";

export const SEQ_LEN = 24;

/** Per-frame vector for sequences (body-relative positions + compact shape). */
export function frameVector(f) {
  const D = f.D,
    N = f.N;
  const v = [];
  if (D) {
    v.push(
      D.pos.x,
      D.pos.y,
      D.tips[1].x,
      D.tips[1].y,
      Math.log(Math.max(D.size, 1e-3)),
    );
    v.push(
      ...D.shape.ext.map((e) => e * 0.8),
      D.shape.palmFacing * 0.6,
      D.shape.axis.up * 0.6,
      D.shape.axis.out * 0.6,
    );
  } else {
    v.push(0, -1.5, 0, -1.5, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
  if (N)
    v.push(
      1,
      N.pos.x,
      N.pos.y,
      (N.shape.ext[1] + N.shape.ext[2] + N.shape.ext[3] + N.shape.ext[4]) / 4,
    );
  else v.push(0, 0, -1.5, 0);
  return v;
}

/** Linear resample of a list of vectors to n frames. */
export function resample(seq, n = SEQ_LEN) {
  if (seq.length === 0) return [];
  if (seq.length === 1) return Array.from({ length: n }, () => seq[0].slice());
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = (i * (seq.length - 1)) / (n - 1);
    const a = Math.floor(p),
      b = Math.min(seq.length - 1, a + 1),
      w = p - a;
    out.push(seq[a].map((x, k) => x * (1 - w) + seq[b][k] * w));
  }
  return out;
}

/** Sequence descriptor: resampled vectors with the start position removed from
 *  the first 4 dims and kept as a separate (down-weighted) absolute anchor. */
export function seqVector(frames) {
  const vs = resample(frames.map(frameVector));
  if (!vs.length) return vs;
  const x0 = vs[0][0],
    y0 = vs[0][1];
  return vs.map((v) => {
    const r = v.slice();
    r[0] = v[0] - x0;
    r[1] = v[1] - y0;
    r[2] = v[2] - x0;
    r[3] = v[3] - y0;
    r.push(v[0] * 0.5, v[1] * 0.5); // absolute location, half weight
    return r;
  });
}

/** DTW distance with a Sakoe–Chiba band; normalised per aligned step. */
export function dtw(a, b, band = Math.ceil(SEQ_LEN * 0.25)) {
  const n = a.length,
    m = b.length;
  const INF = 1e18;
  let prev = new Float64Array(m + 1).fill(INF);
  let cur = new Float64Array(m + 1).fill(INF);
  prev[0] = 0;
  for (let i = 1; i <= n; i++) {
    cur.fill(INF);
    const lo = Math.max(1, i - band),
      hi = Math.min(m, i + band);
    for (let j = lo; j <= hi; j++) {
      const c = vecDist(a[i - 1], b[j - 1]);
      cur[j] = c + Math.min(prev[j], cur[j - 1], prev[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[m] / (n + m);
}

// Distances are RMS over all dimensions, so a clearly different trajectory
// (e.g. a straight swipe vs a zigzag of ±0.15 shoulder widths) is only ≈0.04
// apart; repeated performances of one sign measured 0.005–0.02.
const DEFAULT_RADIUS = { static: 0.16, motion: 0.06 };
const MIN_RADIUS = { static: 0.07, motion: 0.035 };

/**
 * Build a matcher from stored templates.
 * template: { label, kind: 'static'|'motion', samples: [vector|sequence, ...] }
 */
export function buildMatcher(templates) {
  const groups = templates.map((t) => {
    const distFn = t.kind === "static" ? vecDist : dtw;
    let radius = DEFAULT_RADIUS[t.kind];
    if (t.samples.length >= 2) {
      // leave-one-out nearest distances → radius = max(nearest) * 1.6
      const nn = t.samples.map((s, i) =>
        Math.min(
          ...t.samples.filter((_, j) => j !== i).map((o) => distFn(s, o)),
        ),
      );
      radius = Math.max(MIN_RADIUS[t.kind], Math.max(...nn) * 1.6);
    }
    return { ...t, distFn, radius };
  });

  function match(kind, query) {
    const res = [];
    for (const g of groups) {
      if (g.kind !== kind || !g.samples.length) continue;
      const d = Math.min(...g.samples.map((s) => g.distFn(query, s)));
      // score 1 at d=0, 0.5 at d = radius
      res.push({
        label: g.label,
        score: Math.pow(0.5, (d / g.radius) ** 2),
        dist: d,
        radius: g.radius,
      });
    }
    return res.sort((a, b) => b.score - a.score);
  }

  return {
    size: groups.length,
    labels: groups.map((g) => g.label),
    matchStatic: (shape) => match("static", shapeVector(shape)),
    matchMotion: (frames) => match("motion", seqVector(frames)),
  };
}

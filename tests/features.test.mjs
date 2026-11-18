// Feature extraction against REAL MediaPipe output (tests/fixtures/real-landmarks.json)
// and geometric invariances on the synthetic hand model.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  anatomicalSide,
  handShape,
  bodyFrame,
  frameFeatures,
} from "../js/features.js";
import { buildHand, pose, rng } from "./testkit/handmodel.mjs";
import { KANA_POSES } from "./testkit/kana-poses.mjs";

const fx = JSON.parse(
  readFileSync(
    new URL("./fixtures/real-landmarks.json", import.meta.url),
    "utf8",
  ),
);
const img = (h) =>
  h.landmarks.map((p) => ({ x: (p.x * 4) / 3, y: p.y, z: (p.z * 4) / 3 }));
const shapeOf = (h) => handShape(h.world, anatomicalSide(h), img(h));

test("handedness label is anatomical on unmirrored frames (measured, tasks-vision 0.10.35)", () => {
  // pointing_up / victory: a right hand, palm to the camera (thumb nail visible on the image right).
  for (const k of ["pointing_up", "victory", "fist"]) {
    const h = fx.frames[k].hands[0];
    assert.equal(anatomicalSide(h), "right", k);
    assert.ok(shapeOf(h).palmFacing > 0.5, `${k}: palm should face the camera`);
  }
  // woman_hands: the upper hand belongs to the arm entering from the image left = her right arm.
  const [a, b] = fx.frames.woman_hands.hands;
  const upper = a.landmarks[0].y < b.landmarks[0].y ? a : b;
  const lower = upper === a ? b : a;
  assert.equal(anatomicalSide(upper), "right");
  assert.equal(anatomicalSide(lower), "left");
});

test("pose landmarks are anatomical: dominant (right) shoulder is on +x of the body frame", () => {
  const body = bodyFrame(fx.frames.pose.pose, 4 / 3, "right");
  assert.ok(body.ok);
  assert.ok(
    body.points.shDom.x > 0.3 && body.points.shNon.x < -0.3,
    JSON.stringify(body.points),
  );
  assert.ok(body.points.nose.y > 0.3, "face is above the shoulders");
  const lefty = bodyFrame(fx.frames.pose.pose, 4 / 3, "left");
  assert.ok(
    lefty.points.shDom.x > 0.3,
    "left-handed frame mirrors so the dominant side stays +x",
  );
});

test("finger extension separates real fist / pointing / victory / thumbs-up", () => {
  const s = Object.fromEntries(
    ["fist", "pointing_up", "victory", "thumb_up"].map((k) => [
      k,
      shapeOf(fx.frames[k].hands[0]),
    ]),
  );
  assert.ok(
    s.fist.ext.every((e) => e < 0.3),
    `fist ${s.fist.ext}`,
  );
  assert.ok(
    s.pointing_up.ext[1] > 0.8 &&
      s.pointing_up.ext.slice(2).every((e) => e < 0.2),
  );
  assert.ok(
    s.victory.ext[1] > 0.8 && s.victory.ext[2] > 0.8 && s.victory.ext[3] < 0.2,
  );
  assert.ok(
    s.thumb_up.ext[0] > 0.8 && s.thumb_up.ext.slice(1).every((e) => e < 0.2),
    `thumb ${s.thumb_up.ext}`,
  );
  assert.ok(s.thumb_up.fingerDir[0].up > 0.7, "thumb points up");
});

test("a mirrored (left) hand yields the same canonical features as the right hand", () => {
  const r = rng(3);
  for (const k of ["か", "む", "ほ", "ら"]) {
    const p = KANA_POSES[k];
    const L = buildHand(p);
    const right = handShape(pose(L, { orient: p.orient || "up", r }), "right");
    const left = handShape(
      pose(L, { orient: p.orient || "up", mirror: true, r }),
      "left",
    );
    for (let i = 0; i < 5; i++)
      assert.ok(Math.abs(right.ext[i] - left.ext[i]) < 1e-9);
    assert.ok(Math.abs(right.palmFacing - left.palmFacing) < 1e-9);
    assert.ok(Math.abs(right.axis.out - left.axis.out) < 1e-9);
    assert.ok(Math.abs(right.crossIM - left.crossIM) < 1e-9);
  }
});

test("frameFeatures assigns dominant/non-dominant hands and body positions", () => {
  const f = frameFeatures(fx.frames.woman_hands, {
    aspect: 4 / 3,
    dominant: "right",
    t: 0,
  });
  assert.equal(f.D.side, "right");
  assert.equal(f.N.side, "left");
  const g = frameFeatures(fx.frames.woman_hands, {
    aspect: 4 / 3,
    dominant: "left",
    t: 0,
  });
  assert.equal(
    g.D.side,
    "left",
    "left-handed setting makes the left hand dominant",
  );
  // Same physical hand position appears mirrored in the left-handed body frame.
  assert.ok(Math.abs(f.D.pos.x + g.N.pos.x) < 1e-9);
});

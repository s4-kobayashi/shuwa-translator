// Landmark detection: MediaPipe HandLandmarker (2 hands) + PoseLandmarker lite.
// Assets are self-hosted under ./vendor/mediapipe so the app works from any
// static host (GitHub Pages project sub-path included) without third-party CDNs.
import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
} from "../vendor/mediapipe/vision_bundle.mjs";

const BASE = new URL("../vendor/mediapipe/", import.meta.url);

async function createWithFallback(Cls, fileset, options, preferGpu) {
  const delegates = preferGpu ? ["GPU", "CPU"] : ["CPU"];
  let lastError;
  for (const delegate of delegates) {
    try {
      const task = await Cls.createFromOptions(fileset, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate },
      });
      return { task, delegate };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

/**
 * @param {{ preferGpu?: boolean, poseEvery?: number, onStatus?: (msg: string) => void }} opts
 */
export async function createDetector({
  preferGpu = true,
  poseEvery = 2,
  onStatus = () => {},
} = {}) {
  onStatus("認識エンジンを読み込み中…");
  const fileset = await FilesetResolver.forVisionTasks(
    new URL("wasm", BASE).href.replace(/\/$/, ""),
  );

  onStatus("手の検出モデルを読み込み中…");
  const hands = await createWithFallback(
    HandLandmarker,
    fileset,
    {
      baseOptions: {
        modelAssetPath: new URL("models/hand_landmarker.task", BASE).href,
      },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    },
    preferGpu,
  );

  onStatus("姿勢の検出モデルを読み込み中…");
  let pose = null;
  try {
    pose = await createWithFallback(
      PoseLandmarker,
      fileset,
      {
        baseOptions: {
          modelAssetPath: new URL("models/pose_landmarker_lite.task", BASE)
            .href,
        },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      },
      preferGpu,
    );
  } catch (e) {
    // Pose only refines locations (face/chest); recognition still works without it.
    console.warn("pose landmarker unavailable", e);
  }

  let frame = 0;
  let lastTs = -1;
  let lastPose = null;

  return {
    delegate: hands.delegate,
    hasPose: !!pose,
    /**
     * @param {HTMLVideoElement|HTMLCanvasElement|ImageBitmap} source
     * @param {number} ts monotonically increasing milliseconds
     */
    detect(source, ts) {
      if (ts <= lastTs) ts = lastTs + 1;
      lastTs = ts;
      const h = hands.task.detectForVideo(source, ts);
      if (pose && frame % poseEvery === 0) {
        const p = pose.task.detectForVideo(source, ts);
        lastPose = p.landmarks && p.landmarks.length ? p.landmarks[0] : null;
      }
      frame++;
      return {
        ts,
        hands: (h.landmarks || []).map((lm, i) => ({
          landmarks: lm,
          world: h.worldLandmarks ? h.worldLandmarks[i] : null,
          // We feed the raw (unmirrored) camera frame. Measured with
          // tasks-vision 0.10.35 on real photos, the label is then the
          // person's anatomical hand ("Right" = their right hand); see
          // tests/features.test.mjs. features.js#anatomicalSide relies on this.
          label: h.handedness?.[i]?.[0]?.categoryName ?? "Unknown",
          score: h.handedness?.[i]?.[0]?.score ?? 0,
        })),
        pose: lastPose,
      };
    },
    close() {
      hands.task.close();
      pose?.task.close();
    },
  };
}

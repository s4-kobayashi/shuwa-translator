// Webcam access. Works on desktop browsers, Android Chrome and iOS Safari
// (the <video> element must be muted + playsinline for iOS).

export function cameraSupport() {
  if (!window.isSecureContext)
    return "カメラは https:// のページ(または localhost)でのみ使えます。GitHub Pages の https の URL から開いてください。";
  if (!navigator.mediaDevices?.getUserMedia)
    return "このブラウザはカメラに対応していません。Chrome・Edge・Safari の最新版でお試しください。";
  return null;
}

export function describeError(e) {
  switch (e?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "カメラの使用が許可されていません。アドレスバーのカメラアイコン(スマホはブラウザの設定)から、このページにカメラを許可して再読み込みしてください。";
    case "NotFoundError":
    case "OverconstrainedError":
      return "カメラが見つかりません。カメラが接続されているか確認してください。";
    case "NotReadableError":
      return "カメラを開けません。ほかのアプリ(ビデオ会議など)がカメラを使っていたら終了してください。";
    default:
      return `カメラを開始できませんでした(${e?.message || e})。`;
  }
}

/**
 * @param {HTMLVideoElement} video
 * @param {{facing: 'user'|'environment'}} opts
 */
export async function startCamera(video, { facing = "user" } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: facing,
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 },
    },
  });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  if (!video.videoWidth)
    await new Promise((r) =>
      video.addEventListener("loadedmetadata", r, { once: true }),
    );
  return stream;
}

export function stopCamera(video) {
  const s = video.srcObject;
  if (s) for (const t of s.getTracks()) t.stop();
  video.srcObject = null;
}

export async function hasMultipleCameras() {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    return devs.filter((d) => d.kind === "videoinput").length > 1;
  } catch {
    return false;
  }
}

// Video recording with burned-in captions: the camera frame and the current
// caption are drawn onto a canvas, and the canvas stream is recorded with
// MediaRecorder (WebM on Chrome/Edge/Firefox, MP4 on Safari).

const TYPES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4;codecs=avc1",
  "video/mp4",
];

export function recordingSupported() {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function"
  );
}

function pickType() {
  for (const t of TYPES) if (MediaRecorder.isTypeSupported?.(t)) return t;
  return "";
}

/**
 * @param {HTMLVideoElement} video
 * @param {() => {text: string, mirror: boolean}} getOverlay current caption and display mirroring
 */
export function startRecording(video, getOverlay) {
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;
  const scale = Math.min(1, 1280 / w);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  const font =
    '700 %pxpx "BIZ UDPGothic", "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif';
  // A timer, not requestAnimationFrame: rAF stops completely in a hidden tab,
  // timers only slow down, so the recording keeps going (at a lower rate).
  let timer = 0;

  function draw() {
    const { text, mirror } = getOverlay();
    ctx.save();
    if (mirror) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();
    if (text) {
      let size = Math.round(canvas.height * 0.075);
      ctx.font = font.replace("%px", size);
      while (ctx.measureText(text).width > canvas.width * 0.92 && size > 14) {
        size -= 2;
        ctx.font = font.replace("%px", size);
      }
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      const x = canvas.width / 2;
      const y = canvas.height - size * 0.9;
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(4, size * 0.18);
      ctx.strokeStyle = "#16181D";
      ctx.strokeText(text, x, y);
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(text, x, y);
    }
  }
  draw();
  timer = setInterval(draw, 1000 / 30);

  const mimeType = pickType();
  const stream = canvas.captureStream(30);
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start(1000);

  return {
    mimeType: rec.mimeType || mimeType || "video/webm",
    stop: () =>
      new Promise((resolve) => {
        rec.onstop = () => {
          clearInterval(timer);
          for (const t of stream.getTracks()) t.stop();
          const type = (rec.mimeType || mimeType || "video/webm").split(";")[0];
          resolve(new Blob(chunks, { type }));
        };
        rec.stop();
      }),
  };
}

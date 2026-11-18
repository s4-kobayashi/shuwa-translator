// App wiring: camera → detector → features → recogniser → captions / transcript.
import { createDetector } from "./detector.js";
import { frameFeatures } from "./features.js";
import { createRecognizer, isKana, DEFAULT_SETTINGS } from "./recognizer.js";
import { shapeVector } from "./handshape.js";
import { seqVector } from "./dtw.js";
import {
  createSession,
  addToken,
  replaceLast,
  removeLast,
  newLine,
  lineText,
  sessionLines,
  toTXT,
  toCSV,
  toJSON,
  toSRT,
  filename,
} from "./transcript.js";
import {
  cameraSupport,
  describeError,
  startCamera,
  stopCamera,
  hasMultipleCameras,
} from "./camera.js";
import { recordingSupported, startRecording } from "./recorder.js";
import * as store from "./storage.js";
import { KANA_HELP, MODIFIER_HELP, WORD_HELP } from "./vocab.js";

const $ = (id) => document.getElementById(id);
const TEST = new URLSearchParams(location.search).has("test");

// ---------------------------------------------------------------- settings
const PREF_KEY = "shuwa.settings";
const prefs = {
  dominant: "right",
  mode: DEFAULT_SETTINGS.mode,
  holdMs: DEFAULT_SETTINGS.holdMs,
  sensitivity: DEFAULT_SETTINGS.sensitivity,
  skeleton: true,
  mirror: true,
  candidates: true,
  diag: false,
};
try {
  Object.assign(prefs, JSON.parse(localStorage.getItem(PREF_KEY) || "{}"));
} catch {
  /* storage unavailable: defaults */
}
const savePrefs = () => {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
};

const rec = createRecognizer({
  holdMs: prefs.holdMs,
  sensitivity: prefs.sensitivity,
  mode: prefs.mode,
});

// ---------------------------------------------------------------- state
const video = $("video");
const canvas = $("skeleton");
const ctx2d = canvas.getContext("2d");
let detector = null;
let running = false;
let paused = false;
let facing = "user";
let session = createSession();
let sessionT0 = performance.now();
let recording = null; // { stop, startedAtMs, mimeType }
let lastVideoUrl = null;
let recStartedAt = 0; // performance.now() when the current/last recording started
let userSigns = [];
let reg = null; // registration in progress { label, kind, samples: [] }
let fpsCount = 0,
  fpsAt = performance.now(),
  fps = 0;
const detStats = { frames: 0, handFrames: 0, poseFrames: 0 };
let injected = false; // test mode: frames come from __shuwa.feed

// ---------------------------------------------------------------- captions
const capPrev = $("cap-prev"),
  capText = $("cap-text");
const capPending = $("cap-pending"),
  capPendingText = $("cap-pending-text"),
  gauge = $("gauge");

function currentLine() {
  return session.lines[session.lines.length - 1];
}
function renderCaptions(flashLast = false) {
  const lines = sessionLines(session);
  const cur = currentLine();
  const prev = cur.length ? lines[lines.length - 2] : lines[lines.length - 1];
  capPrev.textContent = prev ? lineText(prev) : "";
  capText.textContent = "";
  if (cur.length) {
    // Keep the caption to roughly one screen line: show the tail of a long line.
    let text = lineText(cur);
    if (text.length > 28) text = "…" + text.slice(-27);
    if (flashLast) {
      const lastText = cur[cur.length - 1].text;
      const head = text.endsWith(lastText)
        ? text.slice(0, -lastText.length)
        : text;
      capText.append(head);
      const span = document.createElement("span");
      span.className = "cap-new";
      span.textContent = text.endsWith(lastText) ? lastText : "";
      capText.append(span);
    } else capText.textContent = text;
  }
}
function setPending(label, progress) {
  capPendingText.textContent = label || "";
  capPending.classList.toggle("is-empty", !label);
  gauge.style.width = `${Math.round((progress || 0) * 100)}%`;
}
function captionForVideo() {
  const cur = currentLine();
  const lines = sessionLines(session);
  const l = cur.length ? cur : lines[lines.length - 1];
  return l ? lineText(l).slice(-30) : "";
}

const candList = $("candidates");
function showCandidates(top) {
  candList.replaceChildren(
    ...(prefs.candidates ? top || [] : []).slice(0, 3).map((c) => {
      const li = document.createElement("li");
      const b = document.createElement("b");
      b.textContent = c.label;
      li.append(b, ` ${Math.round(c.score * 100)}%`);
      return li;
    }),
  );
}

// ---------------------------------------------------------------- recogniser events
let saveTimer = 0;
function changed(flash = false) {
  renderCaptions(flash);
  renderTranscript();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(
    () =>
      store.sessions
        .save(session)
        .then(renderHistory)
        .catch((err) => {
          console.warn(err);
          setStatus(
            "記録をこの端末に保存できませんでした(空き容量やブラウザの設定を確認してください)。ダウンロードで保存できます。",
            true,
          );
        }),
    600,
  );
}

function handleEvents(events) {
  for (const e of events) {
    switch (e.type) {
      case "pending":
        if (e.kind === "capture") setPending("見本", e.progress);
        else setPending(e.label, e.label ? e.progress : 0);
        if (e.top) showCandidates(e.top);
        break;
      case "moving":
        setPending("", 0);
        break;
      case "idle":
        setPending("", 0);
        break;
      case "scores":
        showCandidates(e.top);
        break;
      case "commit":
        addToken(session, { ...e.token, at: Date.now() });
        setPending("", 0);
        changed(true);
        break;
      case "modify":
        replaceLast(session, e.text, { conf: e.conf });
        changed(true);
        break;
      case "replace":
        replaceLast(session, e.text, { kind: "word", conf: e.conf });
        changed(true);
        break;
      case "newline":
        newLine(session);
        changed();
        break;
      case "sample":
        onSample(e);
        break;
    }
  }
}

// ---------------------------------------------------------------- detection loop
const HAND_LINKS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
];
const POSE_LINKS = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
];

function drawSkeleton(det) {
  const w = (canvas.width = video.videoWidth || canvas.clientWidth);
  const h = (canvas.height = video.videoHeight || canvas.clientHeight);
  ctx2d.clearRect(0, 0, w, h);
  if (!prefs.skeleton || !det) return;
  const lw = Math.max(2, w / 400);
  ctx2d.lineCap = "round";
  if (det.pose) {
    ctx2d.strokeStyle = "rgba(238,241,244,0.55)";
    ctx2d.lineWidth = lw;
    ctx2d.beginPath();
    for (const [a, b] of POSE_LINKS) {
      const p = det.pose[a],
        q = det.pose[b];
      if ((p.visibility ?? 1) < 0.5 || (q.visibility ?? 1) < 0.5) continue;
      ctx2d.moveTo(p.x * w, p.y * h);
      ctx2d.lineTo(q.x * w, q.y * h);
    }
    ctx2d.stroke();
  }
  for (const hand of det.hands) {
    ctx2d.strokeStyle = "#FFD23F";
    ctx2d.lineWidth = lw;
    ctx2d.beginPath();
    for (const [a, b] of HAND_LINKS) {
      ctx2d.moveTo(hand.landmarks[a].x * w, hand.landmarks[a].y * h);
      ctx2d.lineTo(hand.landmarks[b].x * w, hand.landmarks[b].y * h);
    }
    ctx2d.stroke();
    ctx2d.fillStyle = "#FFFFFF";
    for (const p of hand.landmarks) {
      ctx2d.beginPath();
      ctx2d.arc(p.x * w, p.y * h, lw * 1.2, 0, Math.PI * 2);
      ctx2d.fill();
    }
  }
}

const status = $("status");
// Diagnostics (fps) show only when enabled in 設定; problems are always shown
// and stay up for 8 s.
let statusImportant = false;
let importantUntil = 0;
function setStatus(msg, important = false) {
  const now = performance.now();
  if (!important && now < importantUntil) return;
  if (important) importantUntil = now + 8000;
  statusImportant = important;
  status.textContent = msg;
  status.hidden = !prefs.diag && !important;
}

let lastVideoTime = -1;
function loop() {
  if (!running) return;
  schedule();
  if (paused || video.readyState < 2 || video.currentTime === lastVideoTime)
    return;
  lastVideoTime = video.currentTime;
  let det;
  try {
    det = detector.detect(video, performance.now());
  } catch (e) {
    console.error(e);
    return;
  }
  drawSkeleton(det);
  detStats.frames++;
  if (det.hands.length) detStats.handFrames++;
  if (det.pose) detStats.poseFrames++;
  fpsCount++;
  const now = performance.now();
  if (now - fpsAt > 1000) {
    fps = (fpsCount * 1000) / (now - fpsAt);
    fpsCount = 0;
    fpsAt = now;
    setStatus(
      `${fps.toFixed(0)} fps · ${detector.delegate === "GPU" ? "GPU" : "CPU"}${detector.hasPose ? "" : " · 姿勢なし"}`,
    );
  }
  if (injected) return;
  const f = frameFeatures(det, {
    aspect: video.videoWidth / video.videoHeight,
    dominant: prefs.dominant,
    t: now - sessionT0,
  });
  handleEvents(rec.push(f));
}
function schedule() {
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(loop);
  else requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- start / stop
const startBtn = $("start"),
  toggleBtn = $("toggle"),
  recBtn = $("rec"),
  flipBtn = $("flip");
const stage = $("stage");

function applyStageAspect() {
  if (video.videoWidth && window.matchMedia("(min-width: 960px)").matches)
    stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
  else stage.style.aspectRatio = "";
}
function applyMirror() {
  stage.classList.toggle("mirror", prefs.mirror && facing === "user");
}

async function start() {
  const why = cameraSupport();
  const err = $("intro-error");
  if (why) {
    err.textContent = why;
    err.hidden = false;
    return;
  }
  startBtn.disabled = true;
  err.hidden = true;
  startBtn.textContent = "準備中…";
  try {
    const camera = startCamera(video, { facing });
    detector =
      detector ||
      (await createDetector({ onStatus: (m) => (startBtn.textContent = m) }));
    await camera;
  } catch (e) {
    console.error(e);
    stopCamera(video);
    err.textContent = e?.name
      ? describeError(e)
      : `認識エンジンを読み込めませんでした(${e?.message || e})。ページを再読み込みしてください。`;
    err.hidden = false;
    startBtn.disabled = false;
    startBtn.textContent = "もう一度試す";
    return;
  }
  $("intro").hidden = true;
  applyMirror();
  applyStageAspect();
  running = true;
  paused = false;
  toggleBtn.disabled = false;
  toggleBtn.textContent = "一時停止";
  recBtn.disabled = !recordingSupported();
  flipBtn.hidden = !(await hasMultipleCameras());
  sessionT0 = performance.now() - lastSessionT();
  schedule();
}
function lastSessionT() {
  const lines = sessionLines(session);
  const l = lines[lines.length - 1];
  return l ? l[l.length - 1].t + 1000 : 0;
}

startBtn.addEventListener("click", start);
toggleBtn.addEventListener("click", () => {
  paused = !paused;
  toggleBtn.textContent = paused ? "再開" : "一時停止";
  if (paused) {
    setPending("", 0);
    setStatus("一時停止中");
    rec.reset();
  }
});
flipBtn.addEventListener("click", async () => {
  facing = facing === "user" ? "environment" : "user";
  stopCamera(video);
  try {
    await startCamera(video, { facing });
  } catch (e) {
    setStatus(describeError(e), true);
  }
  applyMirror();
  applyStageAspect();
});
$("undo").addEventListener("click", () => {
  removeLast(session);
  rec.reset();
  changed();
});
$("break").addEventListener("click", () => {
  newLine(session);
  rec.reset();
  changed();
});
window.addEventListener("resize", applyStageAspect);

// ---------------------------------------------------------------- video recording
recBtn.addEventListener("click", async () => {
  if (!recording) {
    recording = startRecording(video, () => ({
      text: captionForVideo(),
      mirror: prefs.mirror && facing === "user",
    }));
    recStartedAt = performance.now();
    recBtn.setAttribute("aria-pressed", "true");
    recBtn.textContent = "録画を停止";
    return;
  }
  const blob = await recording.stop();
  const ext = blob.type.includes("mp4") ? "mp4" : "webm";
  recording = null;
  recBtn.setAttribute("aria-pressed", "false");
  recBtn.textContent = "録画";
  if (lastVideoUrl) URL.revokeObjectURL(lastVideoUrl);
  lastVideoUrl = URL.createObjectURL(blob);
  const a = $("video-link");
  a.href = lastVideoUrl;
  a.download = filename(session, ext);
  a.textContent = `録画を保存 (.${ext}・${(blob.size / 1048576).toFixed(1)} MB)`;
  $("video-dl").hidden = false;
  selectTab("tab-log");
});

// ---------------------------------------------------------------- downloads
function download(text, name, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const FORMATS = {
  txt: () => [toTXT(session), "text/plain;charset=utf-8"],
  csv: () => [toCSV(session), "text/csv;charset=utf-8"],
  srt: () => [toSRT(session), "application/x-subrip;charset=utf-8"],
  json: () => [toJSON(session), "application/json"],
};
for (const b of document.querySelectorAll("[data-dl]"))
  b.addEventListener("click", () => {
    const ext = b.dataset.dl;
    const [text, type] = FORMATS[ext]();
    download(text, filename(session, ext), type);
  });
$("srt-video").addEventListener("click", () =>
  download(
    // relative to the session timeline now in use (it shifts when a past record is reopened)
    toSRT(session, recStartedAt - sessionT0),
    filename(session, "srt").replace(".srt", "_録画.srt"),
    "application/x-subrip;charset=utf-8",
  ),
);

// ---------------------------------------------------------------- transcript panel
const transcriptEl = $("transcript");
const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

function renderTranscript() {
  if (editing) return;
  const lines = session.lines
    .map((l, i) => ({ l, i }))
    .filter((x) => x.l.length);
  $("transcript-empty").hidden = lines.length > 0;
  const started = new Date(session.startedAt);
  $("session-meta").textContent =
    `${started.toLocaleDateString("ja-JP")} ${started.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })} 開始`;
  transcriptEl.replaceChildren(
    ...lines.map(({ l, i }) => {
      const li = document.createElement("li");
      const time = document.createElement("time");
      time.textContent = clock(l[0].t);
      const text = document.createElement("span");
      text.className = "text";
      const conf = Math.min(...l.map((t) => t.conf ?? 1));
      text.textContent = lineText(l);
      if (conf < 0.7) {
        text.classList.add("low");
        text.title = "信頼度が低めです";
      }
      const actions = document.createElement("span");
      actions.className = "line-actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "直す";
      edit.setAttribute("aria-label", `「${lineText(l)}」を直す`);
      edit.addEventListener("click", () => editLine(li, i));
      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "消す";
      del.setAttribute("aria-label", `「${lineText(l)}」を消す`);
      del.addEventListener("click", () => {
        const wasLast = i === session.lines.length - 1;
        session.lines.splice(i, 1);
        afterLineEdit(wasLast);
      });
      actions.append(edit, del);
      li.append(time, text, actions);
      return li;
    }),
  );
}

/**
 * After a line was edited or deleted by hand: a hand-edited last line is
 * finished, so new signs start a fresh line; and the recogniser forgets its
 * last token so a following 濁点 or compound cannot rewrite another line.
 */
function afterLineEdit(wasLast) {
  if (wasLast || !session.lines.length) session.lines.push([]);
  rec.reset();
  changed();
}

let editing = false; // suppress re-rendering the list while an input is open
function editLine(li, i) {
  if (editing) return;
  editing = true;
  const line = session.lines[i];
  const input = document.createElement("input");
  input.value = lineText(line);
  input.setAttribute("aria-label", "この行の文字");
  li.children[1].replaceWith(input);
  input.focus();
  input.select();
  let finished = false;
  const done = (commit) => {
    if (finished) return; // Enter/Escape remove the input, which also fires blur
    finished = true;
    editing = false;
    if (!commit) return changed();
    const wasLast = i === session.lines.length - 1;
    const v = input.value.trim();
    if (v)
      session.lines[i] = [
        {
          text: v,
          kind: "word",
          t: line[0].t,
          at: line[0].at,
          conf: 1,
          source: "edit",
        },
      ];
    else session.lines.splice(i, 1);
    afterLineEdit(wasLast);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") done(true);
    if (e.key === "Escape") done(false);
  });
  input.addEventListener("blur", () => done(true), { once: true });
}

// history
async function renderHistory() {
  const list = (await store.sessions.list()).filter(
    (s) => s.id !== session.id && sessionLines(s).length,
  );
  $("history-empty").hidden = list.length > 0;
  $("history").replaceChildren(
    ...list.map((s) => {
      const li = document.createElement("li");
      const info = document.createElement("div");
      info.className = "h-text";
      const d = new Date(s.startedAt);
      const small = document.createElement("small");
      small.textContent = `${d.toLocaleDateString("ja-JP")} ${d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}・${sessionLines(s).length} 行`;
      info.append(small, document.createTextNode(lineText(sessionLines(s)[0])));
      const act = document.createElement("div");
      act.className = "row-actions";
      const open = document.createElement("button");
      open.className = "btn";
      open.type = "button";
      open.textContent = "開く";
      open.addEventListener("click", async () => {
        await store.sessions.save(session);
        session = s;
        rec.reset();
        sessionT0 = performance.now() - lastSessionT();
        changed();
        renderHistory();
      });
      const del = document.createElement("button");
      del.className = "btn btn-danger";
      del.type = "button";
      del.textContent = "削除";
      del.addEventListener("click", async () => {
        if (!confirm("この記録を削除します。元に戻せません。よろしいですか?"))
          return;
        await store.sessions.remove(s.id);
        renderHistory();
      });
      act.append(open, del);
      li.append(info, act);
      return li;
    }),
  );
}

$("new-session").addEventListener("click", async () => {
  if (sessionLines(session).length) await store.sessions.save(session);
  session = createSession();
  sessionT0 = performance.now();
  rec.reset();
  $("video-dl").hidden = true;
  changed();
  renderHistory();
});

// ---------------------------------------------------------------- dictionary
function templatesForRecognizer() {
  return userSigns.map((s) => ({
    label: s.label,
    kind: s.kind,
    samples: s.samples,
  }));
}
async function loadSigns() {
  userSigns = await store.templates.list();
  rec.setTemplates(templatesForRecognizer());
  renderSigns();
}
function renderSigns() {
  $("signs-empty").hidden = userSigns.length > 0;
  $("signs").replaceChildren(
    ...userSigns.map((s) => {
      const li = document.createElement("li");
      const info = document.createElement("div");
      const label = document.createElement("span");
      label.className = "s-label";
      label.textContent = s.label;
      const small = document.createElement("small");
      small.textContent = `${s.kind === "static" ? "形" : "動き"}・見本 ${s.samples.length} 回${isKana(s.label) ? "・指文字として出力" : ""}`;
      info.append(label, small);
      const act = document.createElement("div");
      act.className = "row-actions";
      const more = document.createElement("button");
      more.className = "btn";
      more.type = "button";
      more.textContent = "見本を追加";
      more.addEventListener("click", () =>
        beginRegistration(s.label, s.kind, s.samples.slice()),
      );
      const del = document.createElement("button");
      del.className = "btn btn-danger";
      del.type = "button";
      del.textContent = "削除";
      del.addEventListener("click", async () => {
        if (!confirm(`「${s.label}」の登録を削除します。よろしいですか?`))
          return;
        await store.templates.remove(s.label);
        loadSigns();
      });
      act.append(more, del);
      li.append(info, act);
      return li;
    }),
  );
}

const MIN_SAMPLES = 3,
  MAX_SAMPLES = 5;
const banner = $("banner");
function regMessage() {
  const n = reg.samples.length;
  if (n >= MAX_SAMPLES)
    return `見本が ${n} 回そろいました。「登録する」を押してください。`;
  const next = `「${reg.label}」の見本 ${n + 1} 回目: カメラの前で手話をしてください`;
  return n >= MIN_SAMPLES
    ? `${n} 回記録しました。登録できます(${next}・最大 ${MAX_SAMPLES} 回)`
    : next;
}
function updateReg() {
  const msg = regMessage();
  $("reg-msg").textContent = msg;
  banner.textContent = msg;
  banner.hidden = false;
  $("reg-save").disabled = reg.samples.length < MIN_SAMPLES;
}
function beginRegistration(label, kind, samples = []) {
  if (!running) {
    selectTab("tab-dict");
    $("dict-msg").textContent = "先に「カメラを開始」を押してください。";
    return;
  }
  reg = { label, kind: kind === "auto" ? null : kind, samples };
  rec.startCapture(reg.kind || undefined);
  $("register").hidden = true;
  $("reg-progress").hidden = false;
  selectTab("tab-dict");
  updateReg();
}
function endRegistration() {
  reg = null;
  rec.stopCapture();
  rec.reset();
  banner.hidden = true;
  $("register").hidden = false;
  $("reg-progress").hidden = true;
  setPending("", 0);
}
function onSample(e) {
  if (!reg || reg.samples.length >= MAX_SAMPLES) return;
  if (!reg.kind) {
    reg.kind = e.kind;
    rec.startCapture(e.kind);
  }
  if (e.kind !== reg.kind) return;
  reg.samples.push(
    e.kind === "static" ? shapeVector(e.shape) : seqVector(e.frames),
  );
  updateReg();
  if (reg.kind === "static" && reg.samples.length < MAX_SAMPLES)
    banner.textContent += "(次の見本の前に、いったん手を下ろしてください)";
}
$("register").addEventListener("submit", (e) => {
  e.preventDefault();
  const label = $("reg-label").value.trim();
  if (!label) return;
  const kind = new FormData(e.target).get("kind");
  const existing = userSigns.find((s) => s.label === label);
  beginRegistration(
    label,
    kind,
    existing && (kind === "auto" || kind === existing.kind)
      ? existing.samples.slice()
      : [],
  );
  if (existing && reg) reg.kind = existing.kind;
});
$("reg-save").addEventListener("click", async () => {
  await store.templates.save({
    label: reg.label,
    kind: reg.kind,
    samples: reg.samples,
    updatedAt: Date.now(),
  });
  $("dict-msg").textContent = `「${reg.label}」を登録しました。`;
  $("reg-label").value = "";
  endRegistration();
  loadSigns();
});
$("reg-cancel").addEventListener("click", endRegistration);
$("dict-export").addEventListener("click", () =>
  download(
    store.exportDictionary(userSigns),
    "手話辞書.json",
    "application/json",
  ),
);
$("dict-import").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const signs = store.parseDictionary(await file.text());
    for (const s of signs) await store.templates.save(s);
    $("dict-msg").textContent = `${signs.length} 件の手話を読み込みました。`;
    loadSigns();
  } catch (err) {
    $("dict-msg").textContent = `読み込めませんでした: ${err.message}`;
  }
  e.target.value = "";
});

// ---------------------------------------------------------------- settings form
const form = $("settings");
function syncSettingsForm() {
  form.dominant.value = prefs.dominant;
  form.mode.value = prefs.mode;
  form.holdMs.value = prefs.holdMs;
  form.sensitivity.value = prefs.sensitivity;
  form.skeleton.checked = prefs.skeleton;
  form.mirror.checked = prefs.mirror;
  form.candidates.checked = prefs.candidates;
  form.diag.checked = prefs.diag;
  status.hidden = !prefs.diag && !statusImportant;
  $("holdMs-out").textContent = `${(prefs.holdMs / 1000).toFixed(2)} 秒`;
  $("sensitivity-out").textContent = `${Math.round(prefs.sensitivity * 100)}`;
}
form.addEventListener("input", () => {
  prefs.dominant = form.dominant.value;
  prefs.mode = form.mode.value;
  prefs.holdMs = Number(form.holdMs.value);
  prefs.sensitivity = Number(form.sensitivity.value);
  prefs.skeleton = form.skeleton.checked;
  prefs.mirror = form.mirror.checked;
  prefs.candidates = form.candidates.checked;
  prefs.diag = form.diag.checked;
  if (!prefs.candidates) showCandidates([]);
  rec.setSettings({
    holdMs: prefs.holdMs,
    sensitivity: prefs.sensitivity,
    mode: prefs.mode,
  });
  applyMirror();
  syncSettingsForm();
  savePrefs();
});

// ---------------------------------------------------------------- tabs
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(id) {
  for (const t of tabs) {
    const on = t.id === id;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute("aria-controls")).hidden = !on;
  }
}
for (const t of tabs) {
  t.addEventListener("click", () => selectTab(t.id));
  t.addEventListener("keydown", (e) => {
    const i = tabs.indexOf(t);
    const j =
      e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
    if (j === null) return;
    const next = tabs[(j + tabs.length) % tabs.length];
    selectTab(next.id);
    next.focus();
  });
}

// ---------------------------------------------------------------- help content
function fillDl(el, rows, wrap = false) {
  el.replaceChildren(
    ...rows
      .map(([k, v]) => {
        const dt = document.createElement("dt");
        dt.textContent = k;
        const dd = document.createElement("dd");
        dd.textContent = v;
        if (!wrap) return [dt, dd];
        const div = document.createElement("div");
        div.append(dt, dd);
        return [div];
      })
      .flat(),
  );
}
fillDl($("vocab-words"), WORD_HELP);
fillDl($("vocab-kana"), KANA_HELP, true);
fillDl($("vocab-mods"), MODIFIER_HELP);

// ---------------------------------------------------------------- boot
syncSettingsForm();
renderCaptions();
renderTranscript();
renderHistory();
loadSigns();
{
  const why = cameraSupport();
  if (why) {
    $("intro-error").textContent = why;
    $("intro-error").hidden = false;
  }
}

// Test hook (only with ?test=1): feed synthetic feature frames, read state.
if (TEST) {
  let feedEnd = 0;
  window.__shuwa = {
    /** Frames carry their own relative t (ms from 0); they are appended after the previous feed. */
    feed(frames) {
      injected = true;
      const t0 = Math.max(performance.now() - sessionT0, feedEnd + 33);
      for (const f of frames) handleEvents(rec.push({ ...f, t: t0 + f.t }));
      feedEnd = t0 + frames[frames.length - 1].t;
    },
    /** Stop feeding camera detections to the recogniser and start a clean session. */
    takeover() {
      injected = true;
      rec.reset();
      session = createSession();
      changed();
    },
    releaseFeed() {
      injected = false;
    },
    state: () => ({
      running,
      detStats: { ...detStats, fps, delegate: detector?.delegate },
      lines: sessionLines(session).map(lineText),
      tokens: sessionLines(session)
        .flat()
        .map((tk) => ({ text: tk.text, kind: tk.kind, conf: tk.conf })),
      caption: capText.textContent,
      pending: capPendingText.textContent,
      signs: userSigns.map((s) => ({
        label: s.label,
        kind: s.kind,
        n: s.samples.length,
      })),
      reg: reg && { label: reg.label, kind: reg.kind, n: reg.samples.length },
    }),
  };
}

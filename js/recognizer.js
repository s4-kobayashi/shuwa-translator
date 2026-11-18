// Recogniser: turns the per-frame feature stream into tokens.
//
//  - Static channel: the dominant hand holds still → the candidate handshape
//    must stay the same for `holdMs` (this is the "confirmation gauge" in the
//    UI) → commit a kana / static word / user static sign.
//  - Motion channel: movement starts → frames are collected until the hands
//    settle → the whole segment is scored against modifier motions (濁点 …),
//    user motion templates, moving kana and word rules.
//  - Rejection: nothing is output unless the best score clears a threshold
//    (set by the sensitivity slider) and beats the runner-up by a margin.
import { classifyKana, KANA_SPECS } from "./handshape.js";
import {
  summarize,
  scoreWords,
  scoreMotionKana,
  modifierFor,
  COMPOUNDS,
  WORD_TEXT,
} from "./signs.js";
import { buildMatcher } from "./dtw.js";

// Motion energy (shoulder widths per second, see motionEnergy). Measured on the
// built-in vocabulary: the slowest sign (好き, 0.25 sw in 0.6 s) reaches ≈0.45;
// a held hand with MediaPipe-like jitter stays below 0.15.
const V_START = 0.38;
const V_STOP = 0.2;
const ENERGY_WINDOW_MS = 130; // between the newest frames of the two averaged groups
const ENERGY_AVG = 3;
const START_FRAMES = 3;
const DEPTH_WEIGHT = 1.5; // hand-size change (toward/away from the camera)
// Handshape change (sum of finger-extension change per second). Signs such as
// 挨拶 (index fingers bow) or も (pinch closes) barely move the hand.
const SHAPE_WEIGHT = 0.3;
const STOP_MS = 200;
const PREROLL_MS = 260;
const MAX_SEG_MS = 4000;
const NEWLINE_MS = 2200;
const DROPOUT_MS = 200; // shorter gaps in hand tracking are ignored
const MODIFIER_WINDOW_MS = 1600;
const COMPOUND_WINDOW_MS = 3500;

/** A single hiragana (or the long-vowel mark) is spelled, everything else is a word. */
export const isKana = (label) => /^[ぁ-ゖー]$/.test(label);

export const DEFAULT_SETTINGS = { holdMs: 450, sensitivity: 0.5, mode: "auto" };

export function createRecognizer(initial = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...initial };
  let matcher = buildMatcher([]);
  let history = [];
  let seg = null; // { frames, stillMs, absentMs }
  let hot = 0; // consecutive frames above V_START
  let prev = null;
  let cand = null; // { label, kind, source, score, stableMs }
  let armed = true;
  let disarmLabel = null;
  let lastToken = null; // { text, kind, t, kana?: base kana for modifiers, word?: rule id }
  let absentMs = 0;
  let lineOpen = false;
  let capture = null; // registration mode: { kind?: 'static'|'motion' }

  const theta = () => 0.75 - 0.3 * settings.sensitivity; // 0.6 at default
  const margin = () => 0.04 + 0.12 * (1 - settings.sensitivity);

  /**
   * Motion energy of one hand: change between the mean of the last
   * ENERGY_AVG frames and the mean of ENERGY_AVG frames ≈ENERGY_WINDOW_MS
   * earlier, per second. Averaging and the small dead-zones keep landmark
   * jitter (size and finger-bend estimates wobble by a few %) from looking
   * like movement.
   */
  function handSpeed(key, A, B, dt) {
    if (A.some((f) => !f[key]) || B.some((f) => !f[key])) return 0;
    const m = (fs) => ({
      x: fs.reduce((a, f) => a + f[key].pos.x, 0) / fs.length,
      y: fs.reduce((a, f) => a + f[key].pos.y, 0) / fs.length,
      s: fs.reduce((a, f) => a + Math.log(f[key].size), 0) / fs.length,
      e: [0, 1, 2, 3, 4].map(
        (i) => fs.reduce((a, f) => a + f[key].shape.ext[i], 0) / fs.length,
      ),
    });
    const a = m(A),
      b = m(B);
    const planar = Math.hypot(a.x - b.x, a.y - b.y);
    const depth = Math.max(0, Math.abs(a.s - b.s) - 0.02);
    const shape = a.e.reduce(
      (acc, v, i) => acc + Math.max(0, Math.abs(v - b.e[i]) - 0.04),
      0,
    );
    return (
      (planar + DEPTH_WEIGHT * depth + SHAPE_WEIGHT * shape) / (dt / 1000)
    );
  }

  function motionEnergy() {
    const n = history.length;
    if (n < 2 * ENERGY_AVG) return 0;
    const A = history.slice(n - ENERGY_AVG);
    let j = n - ENERGY_AVG;
    while (j > ENERGY_AVG && history[n - 1].t - history[j - 1].t < ENERGY_WINDOW_MS) j--;
    const B = history.slice(j - ENERGY_AVG, j);
    if (B.length < ENERGY_AVG) return 0;
    const tm = (fs) => fs.reduce((a, f) => a + f.t, 0) / fs.length;
    const dt = tm(A) - tm(B);
    if (dt <= 0) return 0;
    return Math.max(handSpeed("D", A, B, dt), 0.85 * handSpeed("N", A, B, dt));
  }

  /** Best static candidate for one frame. */
  function staticCandidate(f) {
    const out = [];
    const user = matcher.size ? matcher.matchStatic(f.D.shape) : [];
    for (const u of user.slice(0, 3))
      out.push({
        label: u.label,
        kind: isKana(u.label) ? "kana" : "word",
        source: "user",
        score: Math.min(1, u.score + 0.05),
      });
    if (settings.mode !== "kana") {
      // Static word rules (昼・私・あなた・名前) read hand position and
      // orientation over the last few still frames.
      const recent = history.filter((h) => h.D && f.t - h.t <= 300);
      if (recent.length >= 3)
        for (const w of scoreWords(summarize(recent), "static").slice(0, 2))
          out.push({
            label: w.label,
            kind: "word",
            source: "builtin",
            score: w.score,
          });
    }
    if (settings.mode !== "word") {
      for (const k of classifyKana(f.D.shape, KANA_SPECS).slice(0, 3))
        out.push({
          label: k.label,
          kind: "kana",
          source: "builtin",
          score: k.score,
        });
    }
    out.sort((a, b) => b.score - a.score);
    // Priority tiers: the user's own registered signs, then location-specific
    // static words, then fingerspelling. A confident candidate of a higher
    // tier wins, and only competes (for the margin test) within its tier —
    // e.g. 昼 (U-hand at the forehead) is not blocked by the kana う.
    const tier = (c) => (c.source === "user" ? 0 : c.kind === "word" ? 1 : 2);
    const th = theta();
    let best = out[0] || null;
    for (const t of [0, 1]) {
      const top = out.find((c) => tier(c) === t && c.score >= th);
      if (top) {
        best = top;
        break;
      }
    }
    const second =
      out.find((o) => o.label !== best?.label && tier(o) === tier(best)) ||
      null;
    return { best, second, all: out };
  }

  function compoundFor(prevTok, word, t) {
    if (
      !prevTok ||
      prevTok.kind !== "word" ||
      t - prevTok.t > COMPOUND_WINDOW_MS
    )
      return null;
    return (
      COMPOUNDS.find(
        (c) => c.parts[0] === prevTok.word && c.parts[1] === word,
      ) || null
    );
  }

  function commitWord(events, label, score, source, t) {
    const comp = compoundFor(lastToken, label, t);
    if (comp) {
      events.push({
        type: "replace",
        text: comp.text,
        conf: Math.min(score, lastToken.conf),
        source: "builtin",
      });
      lastToken = {
        ...lastToken,
        text: comp.text,
        word: comp.text,
        t,
        conf: Math.min(score, lastToken.conf),
      };
      return;
    }
    const text = source === "user" ? label : WORD_TEXT[label] || label;
    events.push({
      type: "commit",
      token: { text, kind: "word", t, conf: score, source },
    });
    lastToken = { text, kind: "word", word: label, t, conf: score };
    lineOpen = true;
  }

  function commitKana(events, label, score, source, t) {
    events.push({
      type: "commit",
      token: { text: label, kind: "kana", t, conf: score, source },
    });
    lastToken = { text: label, kind: "kana", kana: label, t, conf: score };
    lineOpen = true;
  }

  function evaluateSegment(frames, events) {
    const t = frames[frames.length - 1].t;
    const s = summarize(frames);
    const moved = Math.max(s.D.ok ? s.D.path : 0, s.N.ok ? s.N.path : 0);
    const depth = s.D.ok ? Math.abs(Math.log(s.D.sizeRatio)) : 0;
    const reshaped = s.D.ok
      ? s.D.head[0].shape.ext.reduce(
          (a, v, i) =>
            a + Math.abs(v - s.D.tail[s.D.tail.length - 1].shape.ext[i]),
          0,
        )
      : 0;
    if (s.duration < 150 || (moved < 0.12 && depth < 0.12 && reshaped < 0.5))
      return false;

    if (capture) {
      if (!capture.kind || capture.kind === "motion")
        events.push({ type: "sample", kind: "motion", frames });
      return true;
    }

    const cands = [];
    // 1. modifier of the previous kana (濁点・半濁点・小書き・長音)
    if (
      settings.mode !== "word" &&
      lastToken?.kind === "kana" &&
      t - lastToken.t < MODIFIER_WINDOW_MS
    ) {
      const m = modifierFor(s, lastToken.kana);
      if (m)
        cands.push({
          label: m.text,
          kind: "modifier",
          mod: m.kind,
          score: m.score,
          source: "builtin",
        });
    }
    // 2. user motion signs (priority bonus: the user's own examples win ties)
    if (matcher.size)
      for (const u of matcher.matchMotion(frames).slice(0, 3))
        cands.push({
          label: u.label,
          kind: isKana(u.label) ? "kana" : "word",
          score: Math.min(1, u.score + 0.08),
          source: "user",
        });
    // 3. moving kana
    if (settings.mode !== "word")
      for (const k of scoreMotionKana(s).slice(0, 2))
        cands.push({
          label: k.label,
          kind: "kana",
          score: k.score,
          source: "builtin",
        });
    // 4. word rules
    if (settings.mode !== "kana")
      for (const w of scoreWords(s, "motion").slice(0, 3))
        cands.push({
          label: w.label,
          kind: "word",
          score: w.score,
          source: "builtin",
        });

    cands.sort((a, b) => b.score - a.score);
    const best = cands[0];
    const second = cands.find((c) => c.label !== best?.label);
    events.push({
      type: "scores",
      channel: "motion",
      top: cands.slice(0, 4).map((c) => ({ label: c.label, score: c.score })),
    });
    if (
      !best ||
      best.score < theta() ||
      (second && best.score - second.score < margin() * 0.75)
    ) {
      events.push({
        type: "rejected",
        channel: "motion",
        best: best ? { label: best.label, score: best.score } : null,
      });
      return false;
    }
    if (best.kind === "modifier") {
      if (best.mod === "long")
        commitKana(events, "ー", best.score, "builtin", t);
      else {
        events.push({ type: "modify", text: best.label, conf: best.score });
        lastToken = { ...lastToken, text: best.label, kana: best.label, t };
      }
    } else if (best.kind === "kana")
      commitKana(events, best.label, best.score, best.source, t);
    else commitWord(events, best.label, best.score, best.source, t);
    return true;
  }

  function push(f) {
    const events = [];
    const dt = prev ? Math.min(200, Math.max(1, f.t - prev.t)) : 33;
    history.push(f);
    while (history.length && f.t - history[0].t > 3000) history.shift();
    prev = f;
    const motion = motionEnergy();

    // Hands gone → close the line after a pause, re-arm the static channel.
    if (!f.D) {
      absentMs += dt;
      // MediaPipe regularly loses a hand for a frame or two. Only a real
      // absence (hand lowered) ends a segment or re-arms the static channel;
      // otherwise a held kana would be committed again after a blink.
      if (absentMs < DROPOUT_MS) return events;
      cand = null;
      armed = true;
      disarmLabel = null;
      if (seg) {
        const frames = seg.frames;
        seg = null;
        const produced = evaluateSegment(frames, events);
        if (!produced) armed = true;
      }
      if (lineOpen && absentMs >= NEWLINE_MS && !capture) {
        events.push({ type: "newline" });
        lineOpen = false;
        lastToken = null;
      }
      events.push({ type: "idle" });
      return events;
    }
    absentMs = 0;

    // ---- motion channel ----
    hot = motion > V_START ? hot + 1 : 0;
    // Real movement is sustained; a single-frame spike is landmark jitter.
    if (!seg && hot >= START_FRAMES) {
      seg = {
        frames: history.filter((h) => f.t - h.t <= PREROLL_MS),
        stillMs: 0,
      };
      cand = null;
      events.push({ type: "moving" });
    } else if (seg) {
      seg.frames.push(f);
      seg.stillMs = motion < V_STOP ? seg.stillMs + dt : 0;
      const dur = f.t - seg.frames[0].t;
      if (seg.stillMs >= STOP_MS || dur > MAX_SEG_MS) {
        const frames = seg.frames;
        const stillMs = seg.stillMs;
        seg = null;
        const before = staticCandidate(f).best;
        const produced = evaluateSegment(frames, events);
        if (produced) {
          armed = false;
          disarmLabel = before?.label ?? null;
        } else {
          // Re-arm only if the hand really travelled or now shows a different
          // shape; otherwise a wobble would repeat the last kana.
          let travelled = 0;
          for (let i = 1; i < frames.length; i++)
            if (frames[i].D && frames[i - 1].D)
              travelled += Math.hypot(
                frames[i].D.pos.x - frames[i - 1].D.pos.x,
                frames[i].D.pos.y - frames[i - 1].D.pos.y,
              );
          if (travelled >= 0.12 || before?.label !== disarmLabel) {
            armed = true;
            disarmLabel = null;
          }
          // A rejected segment was just a transition (e.g. between two
          // fingerspelled kana): the hand has already been still for
          // stillMs, so credit that to the next hold.
          if (armed && before && stillMs < MAX_SEG_MS)
            cand = { ...before, stableMs: stillMs - dt, frames: [] };
        }
      } else {
        events.push({ type: "moving" });
        return events;
      }
    }

    // ---- static channel ----
    if (seg) return events;
    const { best, second, all } = staticCandidate(f);
    if (!best) return events;
    if (!armed && best.label !== disarmLabel && best.score >= theta()) {
      armed = true;
      disarmLabel = null;
    }
    if (cand && cand.label === best.label) {
      cand.stableMs += dt;
      cand.score = 0.7 * cand.score + 0.3 * best.score;
      cand.frames.push(f);
      if (cand.frames.length > 40) cand.frames.shift();
    } else {
      cand = { ...best, stableMs: 0, frames: [f] };
    }
    const ok =
      best.score >= theta() &&
      (!second || best.score - second.score >= margin());
    if (!armed) return events;
    if (capture && (!capture.kind || capture.kind === "static")) {
      const progress = Math.min(1, cand.stableMs / (settings.holdMs * 1.4));
      events.push({
        type: "pending",
        label: "見本",
        progress,
        kind: "capture",
      });
      if (cand.stableMs >= settings.holdMs * 1.4) {
        events.push({ type: "sample", kind: "static", shape: f.D.shape });
        armed = false;
        disarmLabel = best.label;
      }
      return events;
    }
    // The hold only counts while the reading is confident (a slow transition
    // through a low-scoring shape must not fill the gauge).
    if (!ok) {
      cand.stableMs = 0;
      events.push({
        type: "pending",
        label: null,
        progress: 0,
        top: all.slice(0, 3),
      });
      return events;
    }
    events.push({
      type: "pending",
      label: best.label,
      kind: best.kind,
      progress: Math.min(1, cand.stableMs / settings.holdMs),
      top: all.slice(0, 3),
    });
    if (cand.stableMs >= settings.holdMs) {
      const t = f.t;
      if (cand.kind === "kana")
        commitKana(events, cand.label, cand.score, cand.source, t);
      else commitWord(events, cand.label, cand.score, cand.source, t);
      armed = false;
      disarmLabel = best.label;
      cand = null;
    }
    return events;
  }

  return {
    push,
    settings,
    setSettings(s) {
      Object.assign(settings, s);
    },
    setTemplates(templates) {
      matcher = buildMatcher(templates);
    },
    /** Registration: emit 'sample' events instead of tokens. kind: 'static'|'motion'|undefined(auto). */
    startCapture(kind) {
      capture = { kind };
      armed = true;
      disarmLabel = null;
      cand = null;
    },
    stopCapture() {
      capture = null;
      armed = false;
    },
    reset() {
      history = [];
      seg = null;
      cand = null;
      armed = true;
      lastToken = null;
      lineOpen = false;
      prev = null;
    },
    get capturing() {
      return !!capture;
    },
  };
}

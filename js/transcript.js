// Transcript model and export formats (pure — no DOM).
//
// A session is a list of lines; each line is a list of tokens. A token is one
// recognised unit: a kana (fingerspelling) or a word. Kana typed in a row are
// joined into one word; separate words are joined with a space, the usual way
// sign glosses are written.

export function createSession(startedAt = new Date()) {
  return {
    id: `s-${startedAt.getTime()}`,
    startedAt: startedAt.toISOString(),
    lines: [[]],
    meta: {},
  };
}

/** @param token {{text, kind:'kana'|'word', t:number(ms since start), conf:number, source:string}} */
export function addToken(session, token) {
  const line = session.lines[session.lines.length - 1];
  line.push({ ...token });
  return session;
}

/** Replace the last kana (used by 濁点/半濁点/小書き/長音 motions). */
export function replaceLast(session, text, extra = {}) {
  const line = session.lines[session.lines.length - 1];
  const last = line[line.length - 1];
  if (last) Object.assign(last, { text }, extra);
  return session;
}

export function removeLast(session) {
  for (let i = session.lines.length - 1; i >= 0; i--) {
    if (session.lines[i].length) {
      session.lines[i].pop();
      return session;
    }
    if (i > 0 && session.lines.length > 1) session.lines.pop();
  }
  return session;
}

export function newLine(session) {
  const line = session.lines[session.lines.length - 1];
  if (line.length) session.lines.push([]);
  return session;
}

export function lineText(tokens) {
  let out = "";
  let prevKind = null;
  for (const tk of tokens) {
    if (out && !(tk.kind === "kana" && prevKind === "kana")) out += " ";
    out += tk.text;
    prevKind = tk.kind;
  }
  return out;
}

export const sessionLines = (s) => s.lines.filter((l) => l.length);

export function plainText(s) {
  return sessionLines(s).map(lineText).join("\n");
}

const pad = (n, w = 2) => String(n).padStart(w, "0");
export function srtTime(ms) {
  ms = Math.max(0, Math.round(ms));
  const h = Math.floor(ms / 3600000),
    m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000),
    r = ms % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(r, 3)}`;
}
const clock = (ms) => srtTime(ms).slice(0, 8);

export function toTXT(s) {
  const head = `手話翻訳の記録\n開始: ${new Date(s.startedAt).toLocaleString("ja-JP")}\n\n`;
  const body = sessionLines(s)
    .map((l) => `[${clock(l[0].t)}] ${lineText(l)}`)
    .join("\n");
  return head + body + "\n";
}

function csvCell(v) {
  const str = String(v ?? "");
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

const SOURCE_LABEL = { user: "登録した手話", edit: "手で修正", builtin: "組込み" };

/** CSV with a UTF-8 BOM so Excel opens Japanese text correctly. */
export function toCSV(s) {
  const rows = [["行", "経過時間", "時刻", "種類", "内容", "信頼度", "出典"]];
  const t0 = new Date(s.startedAt).getTime();
  sessionLines(s).forEach((l, li) => {
    for (const tk of l) {
      rows.push([
        li + 1,
        clock(tk.t),
        // wall-clock time of the commit (tokens added after reopening a record keep their real time)
        new Date(tk.at ?? t0 + tk.t).toISOString(),
        tk.kind === "kana" ? "指文字" : "単語",
        tk.text,
        (tk.conf ?? 0).toFixed(2),
        SOURCE_LABEL[tk.source] || "組込み",
      ]);
    }
  });
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function toJSON(s) {
  return JSON.stringify(
    {
      format: "shuwa-transcript",
      version: 1,
      startedAt: s.startedAt,
      text: plainText(s),
      lines: sessionLines(s).map((l) => ({
        text: lineText(l),
        start: l[0].t,
        end: l[l.length - 1].t,
        tokens: l,
      })),
    },
    null,
    2,
  );
}

/**
 * SubRip subtitles. Each line becomes a cue from its first token until 1.5 s
 * after its last token (at least 1.2 s long), cut short when the next line
 * starts. `offsetMs` aligns cues with a video recording that started
 * `offsetMs` after the session; lines that ended before it are dropped.
 */
export function toSRT(s, offsetMs = 0) {
  const lines = sessionLines(s);
  const cues = [];
  lines.forEach((l, i) => {
    const start = l[0].t - offsetMs;
    const lastT = l[l.length - 1].t - offsetMs;
    if (lastT < 0) return;
    const next = i + 1 < lines.length ? lines[i + 1][0].t - offsetMs : Infinity;
    const end = Math.min(next, Math.max(lastT + 1500, start + 1200));
    const from = Math.max(0, start);
    // at least 0.3 s on screen, but never past the start of the next cue
    const to = Math.max(from + 1, Math.min(next, Math.max(end, from + 300)));
    cues.push({ from, to, text: lineText(l) });
  });
  return cues
    .map(
      (c, i) =>
        `${i + 1}\n${srtTime(c.from)} --> ${srtTime(c.to)}\n${c.text}\n`,
    )
    .join("\n");
}

export function filename(s, ext) {
  const d = new Date(s.startedAt);
  return `手話記録_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.${ext}`;
}

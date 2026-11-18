import test from "node:test";
import assert from "node:assert/strict";
import {
  createSession,
  addToken,
  replaceLast,
  removeLast,
  newLine,
  lineText,
  plainText,
  srtTime,
  toTXT,
  toCSV,
  toJSON,
  toSRT,
  filename,
} from "../js/transcript.js";

const tok = (text, kind, t, conf = 0.9, source = "builtin") => ({
  text,
  kind,
  t,
  conf,
  source,
});

function sample() {
  const s = createSession(new Date("2026-11-18T09:05:00+09:00"));
  addToken(s, tok("こんにちは", "word", 1000));
  addToken(s, tok("た", "kana", 2500));
  addToken(s, tok("な", "kana", 3000));
  addToken(s, tok("か", "kana", 3600, 0.7, "user"));
  newLine(s);
  addToken(s, tok("よろしくお願いします", "word", 9000));
  return s;
}

test("kana in a row join into one word; words are space separated", () => {
  const s = sample();
  assert.equal(lineText(s.lines[0]), "こんにちは たなか");
  assert.equal(plainText(s), "こんにちは たなか\nよろしくお願いします");
});

test("replaceLast / removeLast / newLine edit the transcript", () => {
  const s = createSession();
  addToken(s, tok("か", "kana", 0));
  replaceLast(s, "が");
  assert.equal(plainText(s), "が");
  newLine(s);
  newLine(s); // no empty lines are stacked
  assert.equal(s.lines.length, 2);
  removeLast(s);
  assert.equal(plainText(s), "");
  removeLast(s); // on an empty session: no throw
});

test("srtTime formats hours, minutes, seconds, millis", () => {
  assert.equal(srtTime(0), "00:00:00,000");
  assert.equal(srtTime(3723004), "01:02:03,004");
  assert.equal(srtTime(-5), "00:00:00,000");
});

test("TXT has a header and a timestamp per line", () => {
  const txt = toTXT(sample());
  assert.match(txt, /^手話翻訳の記録\n開始: /);
  assert.match(
    txt,
    /\[00:00:01\] こんにちは たなか\n\[00:00:09\] よろしくお願いします\n$/,
  );
});

test("CSV starts with a BOM, uses CRLF and quotes cells that need it", () => {
  const s = sample();
  addToken(s, tok('a,"b"', "word", 9500));
  const csv = toCSV(s);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const rows = csv.slice(1).split("\r\n");
  assert.equal(rows[0], "行,経過時間,時刻,種類,内容,信頼度,出典");
  assert.equal(rows[1].split(",")[3], "単語");
  assert.equal(rows[4].split(",")[6], "登録した手話");
  assert.ok(csv.includes('"a,""b"""'));
  assert.equal(rows.length, 1 + 6 + 1); // header + 6 tokens + trailing empty
});

test("JSON round-trips text and tokens", () => {
  const j = JSON.parse(toJSON(sample()));
  assert.equal(j.format, "shuwa-transcript");
  assert.equal(j.lines.length, 2);
  assert.equal(j.lines[0].start, 1000);
  assert.equal(j.lines[0].end, 3600);
  assert.equal(j.lines[0].tokens.length, 4);
  assert.equal(j.text, "こんにちは たなか\nよろしくお願いします");
});

test("SRT cues: start at first token, end 1.5 s after last, never overlap the next line", () => {
  const srt = toSRT(sample());
  assert.equal(
    srt,
    "1\n00:00:01,000 --> 00:00:05,100\nこんにちは たなか\n\n2\n00:00:09,000 --> 00:00:10,500\nよろしくお願いします\n",
  );
  const s = createSession();
  addToken(s, tok("あ", "kana", 0));
  newLine(s);
  addToken(s, tok("い", "kana", 800));
  const cues = toSRT(s).split("\n\n");
  assert.match(
    cues[0],
    /00:00:00,000 --> 00:00:00,800/,
    "cut at the next line",
  );
});

test("SRT offset aligns with a recording that started later", () => {
  const srt = toSRT(sample(), 2000);
  // line 1 (1.0–3.6 s) → starts before the recording: clamped to 0
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:03,100\n/);
  assert.match(srt, /2\n00:00:07,000 --> 00:00:08,500\n/);
  assert.equal(
    toSRT(sample(), 20000),
    "",
    "everything before the recording is dropped",
  );
});

test("filename uses local date and time", () => {
  const s = createSession(new Date(2026, 10, 18, 9, 5));
  assert.equal(filename(s, "csv"), "手話記録_20261118_0905.csv");
});

test('SRT cues never overlap even when lines are only 0.2 s apart', () => {
  const s = createSession();
  addToken(s, tok('あ', 'kana', 1000));
  newLine(s);
  addToken(s, tok('い', 'kana', 1200));
  const [a, b] = toSRT(s).split('\n\n');
  assert.match(a, /00:00:01,000 --> 00:00:01,200/);
  assert.match(b, /^2\n00:00:01,200 --> /);
});

test('CSV uses the wall-clock time stored with each token when present', () => {
  const s = createSession(new Date('2026-11-18T00:00:00Z'));
  addToken(s, { ...tok('あ', 'kana', 5000), at: Date.parse('2026-11-19T10:00:00Z') });
  assert.ok(toCSV(s).includes('2026-11-19T10:00:00.000Z'));
});

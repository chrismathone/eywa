/**
 * 인재원 **학습 분석지 · 시험 결과지의 숫자 조립** — 순수 함수(Vitest로 잠금).
 *
 * 사용자 2026-09-11: *"anki에서 한장짜리 학습분석지 있음 그거 가져와서 재디자인 설계해서 eywa식 만들어줘"*.
 * 정보 구조는 인재원 `eval-report.js`(renderStudy·renderExam)를 따르고 그림은 eywa 문법으로 새로 그린다 —
 * 그리기(components/jj-*.tsx)는 **여기서 받은 값만** 그린다(학부모 카드·학생 상세·응시 결과 창이 같은 숫자를 말하게).
 *
 * 원본과 같은 규칙:
 *  · 정답률·점수 60% 미만만 빨강 — 색만으로 말하지 않게 구역 설명에 그 뜻을 글로 적는다(`WEAK_NOTE`).
 *  · 판정 이름(Superior 같은 것)은 붙이지 않는다 — 점수·정답률·비교만.
 *  · 긴 목록은 앞부분만 두고 "그 외 N개" 한 줄로 접는다.
 *  · 날짜 "YYYY-MM-DD"는 Date로 읽지 않는다(UTC 자정이라 하루가 밀린다). 제출 시각(ISO)은 KST로 옮겨 적는다.
 * 🔴 없는 값은 지어내지 않는다 — 평균이 없으면 "—"와 그 이유, 기록이 없으면 "기록 없음".
 */
import { examTypeLabel, formatElapsed, formatStudyTime, type IjwExamResult, type IjwStudy } from "./contract";

export const WEAK_PCT = 60;
export const WEAK_NOTE = `빨간 막대 = 정답률 ${WEAK_PCT}% 미만`;

export type BarTone = "primary" | "critical";

export function pctOf(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const toneOfPct = (pct: number): BarTone => (pct < WEAK_PCT ? "critical" : "primary");
export const comma = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString("ko-KR");

// ── 날짜 ────────────────────────────────────────────────────────────────
function ymdParts(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? "");
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

/** 양 끝을 포함한 날 수. 못 읽으면 0. */
export function periodDays(from: string, to: string): number {
  const a = ymdParts(from);
  const b = ymdParts(to);
  if (!a || !b) return 0;
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000) + 1;
}

/** "2026-09-11" → "9/11". */
export function mdOf(ymd: string): string {
  const t = ymdParts(ymd);
  return t ? `${t.m}/${t.d}` : "—";
}

/** "8/13 ~ 9/11 · 30일". */
export function periodLabel(from: string, to: string): string {
  const n = periodDays(from, to);
  return n > 0 ? `${mdOf(from)} ~ ${mdOf(to)} · ${n}일` : "—";
}

function kstParts(iso: string): { m: number; d: number; hh: number; mm: number } | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t + 9 * 3_600_000);
  return { m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
}

/** 제출 시각(ISO) → KST "9/11". */
export function kstMd(iso: string): string {
  const p = kstParts(iso);
  return p ? `${p.m}/${p.d}` : "—";
}

/** 제출 시각(ISO) → KST "9월 11일 14:32". */
export function kstStamp(iso: string): string {
  const p = kstParts(iso);
  return p ? `${p.m}월 ${p.d}일 ${String(p.hh).padStart(2, "0")}:${String(p.mm).padStart(2, "0")}` : "—";
}

// ── 막대 목록(단어장별·품사별) ─────────────────────────────────────────────
export type BarRow = {
  key: string;
  label: string;
  correct: number;
  total: number;
  pct: number;
  tone: BarTone;
  kind: "item" | "rest" | "sum";
};

type BarInput = { label: string; correct: number; total: number };
const sumOf = (list: readonly BarInput[], k: "correct" | "total") => list.reduce((a, r) => a + r[k], 0);

/** 문항·답안이 0인 줄은 뺀다 · keep줄을 넘으면 앞 keep−1줄 + "그 외 N개" · 두 줄 이상이면 합계 줄. */
export function foldBarRows(items: readonly BarInput[], keep: number): BarRow[] {
  const list = items.filter((r) => r.total > 0);
  const row = (key: string, label: string, correct: number, total: number, kind: BarRow["kind"]): BarRow => {
    const pct = pctOf(correct, total);
    return { key, label, correct, total, pct, tone: toneOfPct(pct), kind };
  };
  const over = list.length > keep;
  const shown = over ? list.slice(0, Math.max(1, keep - 1)) : list;
  const out = shown.map((r, i) => row(`i${i}`, r.label || "기타", r.correct, r.total, "item"));
  const rest = list.slice(shown.length);
  if (rest.length) out.push(row("rest", `그 외 ${rest.length}개`, sumOf(rest, "correct"), sumOf(rest, "total"), "rest"));
  if (list.length > 1) out.push(row("sum", "합계", sumOf(list, "correct"), sumOf(list, "total"), "sum"));
  return out;
}

/** 단어장별 — 푼 수가 많은 순. */
export function studyDeckRows(s: IjwStudy, keep: number): BarRow[] {
  const items = [...s.byDeck]
    .sort((a, b) => b.answers - a.answers)
    .map((d) => ({ label: d.deck || "단어장", correct: d.correct, total: d.answers }));
  return foldBarRows(items, keep);
}

/** 품사별(학습) — 인재원이 준 순서(푼 수 → 품사 순) 그대로. */
export function studyPosRows(s: IjwStudy, keep: number): BarRow[] {
  return foldBarRows(s.byPos.map((p) => ({ label: p.label || p.pos || "기타", correct: p.correct, total: p.answers })), keep);
}

/** 품사별(시험) — 합계 = 문항 수. */
export function examPosRows(e: IjwExamResult, keep: number): BarRow[] {
  return foldBarRows(e.byPos.map((p) => ({ label: p.label || p.pos || "기타", correct: p.correct, total: p.total })), keep);
}

// ── 학습 분석지 ──────────────────────────────────────────────────────────
export type StudyKpis = {
  hasAnswers: boolean;
  accuracy: number;
  accuracyTone: BarTone;
  answers: string;
  correct: string;
  studyTime: string;
  studyNote: string;
  activeDays: string;
  activeNote: string;
  activeRatio: number;
  newWords: string;
  longTerm: string;
  longTermNote: string;
  longTermRatio: number;
};

export function studyKpis(s: IjwStudy): StudyKpis {
  const t = s.totals;
  const days = periodDays(s.from, s.to) || s.daily.length || 1;
  const accuracy = t.answers > 0 ? Math.round(Number.isFinite(t.accuracy) ? t.accuracy : pctOf(t.correct, t.answers)) : 0;
  return {
    hasAnswers: t.answers > 0,
    accuracy,
    accuracyTone: toneOfPct(accuracy),
    answers: `${comma(t.answers)}개`,
    correct: `${comma(t.correct)}개`,
    studyTime: formatStudyTime(t.studyMs),
    studyNote: t.activeDays > 0 ? `학습한 날 하루 평균 ${formatStudyTime(t.studyMs / t.activeDays)}` : "기간 중 학습 없음",
    activeDays: `${t.activeDays}일`,
    activeNote: `기간 ${days}일 중 ${pctOf(t.activeDays, days)}%`,
    activeRatio: clamp(t.activeDays / days, 0, 1),
    newWords: `${comma(t.newWords)}개`,
    longTerm: `${comma(s.longTermWords)}개`,
    longTermNote: s.seenWords > 0 ? `본 단어 ${comma(s.seenWords)}개 중 ${pctOf(s.longTermWords, s.seenWords)}%` : "아직 본 단어 없음",
    longTermRatio: s.seenWords > 0 ? clamp(s.longTermWords / s.seenWords, 0, 1) : 0,
  };
}

/** 눈금 끝값 — 169 → 200, 42 → 50처럼 읽기 좋은 수로 올린다(원본 niceMax). */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  if (v <= 5) return Math.max(1, Math.ceil(v));
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

export type DailyBar = { key: string; value: number; pct: number; label: string | null; peak: boolean };
export type DailyChart = { bars: DailyBar[]; peak: number; avg: number | null; avgPct: number | null; note: string };

/**
 * 일별 학습량 — 기둥(푼 문제 수) + **학습한 날** 평균선 + 최고치 하나. 날짜 이름표는 `labelCount`개 안팎을
 * 마지막 날에 맞춰 띄엄띄엄(원본과 같다).
 */
export function dailyChart(daily: IjwStudy["daily"], activeDays: number, labelCount: number): DailyChart {
  const n = daily.length;
  const peak = Math.max(0, ...daily.map((d) => d.answers));
  const max = niceMax(peak);
  const peakAt = peak > 0 ? daily.findIndex((d) => d.answers === peak) : -1;
  const every = Math.max(1, Math.ceil(n / Math.max(1, labelCount)));
  const bars = daily.map((d, i) => ({
    key: d.day || String(i),
    value: d.answers,
    pct: clamp((d.answers / max) * 100, 0, 100),
    label: (n - 1 - i) % every === 0 ? mdOf(d.day) : null,
    peak: i === peakAt,
  }));
  const avg = activeDays > 0 && peak > 0 ? Math.round(daily.reduce((a, d) => a + d.answers, 0) / activeDays) : null;
  return {
    bars,
    peak,
    avg,
    avgPct: avg == null ? null : clamp((avg / max) * 100, 0, 100),
    note: peak ? `학습한 날 평균 ${comma(avg ?? 0)}문제 · 가장 많이 푼 날 ${comma(peak)}문제` : "기간 중 학습 기록 없음",
  };
}

export type WeakRow = { key: string; no: number; prompt: string; answer: string; note: string };

/** 자주 틀리는 단어 — 인재원이 많이 틀린 순으로 준다(최대 10). */
export function weakRows(s: IjwStudy, limit: number): WeakRow[] {
  return s.weak.slice(0, limit).map((w, i) => ({
    key: String(i),
    no: i + 1,
    prompt: w.prompt,
    answer: w.answer,
    note: `${comma(w.wrongs)} / ${comma(w.answers)}회`,
  }));
}

export type StudyExamRow = { key: string; deck: string; typeLabel: string; date: string; score: number; tone: BarTone };
export type TrendPoint = { key: string; score: number; tone: BarTone };

/** 기간 중 시험 — 최신순 `limit`개 + 나머지 수 + 점수 추이(옛날 → 최근, 최근 6회, 2회 이상일 때만). */
export function studyExamRows(s: IjwStudy, limit: number): { rows: StudyExamRow[]; rest: number; trend: TrendPoint[] } {
  const scoreOf = (e: IjwStudy["exams"][number]) =>
    Number.isFinite(e.score) ? Math.round(e.score) : pctOf(e.correct, e.total);
  const rows = s.exams.slice(0, limit).map((e) => ({
    key: e.attemptId,
    deck: e.deck || "시험",
    typeLabel: examTypeLabel(e.examType),
    date: kstMd(e.submittedAt),
    score: scoreOf(e),
    tone: toneOfPct(scoreOf(e)),
  }));
  const trend = s.exams
    .slice(0, 6)
    .map((e) => ({ key: e.attemptId, score: clamp(scoreOf(e), 0, 100), tone: toneOfPct(scoreOf(e)) }))
    .reverse();
  return { rows, rest: Math.max(0, s.exams.length - rows.length), trend: trend.length >= 2 ? trend : [] };
}

// ── 시험 결과지 ──────────────────────────────────────────────────────────
export type AvgCompare = { label: string; value: string; note: string; tone: "positive" | "critical" | "neutral" };

/** 반·전체 평균과 비교 — 평균이 없으면(비교할 응시자 없음) 숫자를 지어내지 않는다. */
export function avgCompare(label: string, score: number, avg: number | null): AvgCompare {
  if (avg == null || !Number.isFinite(avg)) return { label, value: "—", note: "비교할 응시자 없음", tone: "neutral" };
  const a = Math.round(avg);
  const diff = score - a;
  return {
    label,
    value: `${a}점`,
    note: diff === 0 ? "평균과 같음" : `이 학생 ${diff > 0 ? "+" : ""}${diff}점`,
    tone: diff > 0 ? "positive" : diff < 0 ? "critical" : "neutral",
  };
}

export type ExamHeadline = {
  score: number;
  tone: BarTone;
  correctLine: string;
  typeLabel: string;
  submitted: string;
  elapsed: string;
  compares: [AvgCompare, AvgCompare];
};

export function examHeadline(e: IjwExamResult): ExamHeadline {
  const score = Number.isFinite(e.score) ? Math.round(e.score) : pctOf(e.correct, e.total);
  return {
    score,
    tone: toneOfPct(score),
    correctLine: `정답 ${comma(e.correct)} / ${comma(e.total)}문항`,
    typeLabel: examTypeLabel(e.deck.examType),
    submitted: kstStamp(e.submittedAt),
    elapsed: formatElapsed(e.elapsedMs),
    compares: [avgCompare("반 평균", score, e.classAvg), avgCompare("전체 평균", score, e.overallAvg)],
  };
}

export type BandMarker = { key: string; label: string; pct: number; tone: "ink" | "muted" };
export type ScoreBand = { pct: number; tone: BarTone; align: "start" | "center" | "end"; markers: BandMarker[] };

/** 점수 위치(0~100) — 반 평균(잉크)·전체 평균(회색) 세로선, 이름표는 가장자리에서 안쪽으로 붙인다. */
export function scoreBand(score: number, classAvg: number | null, overallAvg: number | null): ScoreBand {
  const pct = clamp(score, 0, 100);
  const markers: BandMarker[] = [];
  const add = (key: string, name: string, v: number | null, tone: BandMarker["tone"]) => {
    if (v == null || !Number.isFinite(v)) return;
    const r = Math.round(v);
    markers.push({ key, label: `${name} ${r}점`, pct: clamp(r, 0, 100), tone });
  };
  add("class", "반 평균", classAvg, "ink");
  add("all", "전체 평균", overallAvg, "muted");
  return { pct, tone: toneOfPct(pct), align: pct < 15 ? "start" : pct > 85 ? "end" : "center", markers };
}

export type WrongRow = { key: string; no: number; prompt: string; answer: string; typed: string | null };

/** 다시 봐야 할 단어 — 출제 순서. 안 낸 문항은 `typed: ""` → null("답 없음"). */
export function wrongRows(e: IjwExamResult, limit?: number): { rows: WrongRow[]; rest: number; total: number } {
  const all = e.wrong.map((w, i) => ({
    key: String(i),
    no: i + 1,
    prompt: w.prompt,
    answer: w.answer,
    typed: w.typed.trim() || null,
  }));
  const rows = limit != null && all.length > limit ? all.slice(0, limit) : all;
  return { rows, rest: all.length - rows.length, total: all.length };
}

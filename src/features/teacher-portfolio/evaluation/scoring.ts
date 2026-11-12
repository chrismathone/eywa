/**
 * 원래 수치 → 점수. 원장 설정(`config.ts`)의 규칙을 그대로 적용하는 순수 함수(화면 미리보기·집계가 같이 쓴다).
 */
import type { Band, MetricSetting, Scoring } from "./config";
import { round1 } from "@/lib/guards";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const UNCAPPED = 100_000;

/**
 * 구간은 위에서부터 처음 맞는 것 — 양 끝 포함. 어느 구간에도 안 들면 0점.
 * 수치는 **소수 첫째 자리로 반올림한 뒤** 견준다(화면에 보이는 33.7%와 같은 값으로 — 안 그러면 33.66…이 33.7로 보이는데 다른 구간에 든다).
 */
export function bandFor(raw: number, bands: readonly Band[]): Band | null {
  const r = round1(raw);
  return bands.find((b) => (b.from === null || r >= b.from) && (b.to === null || r <= b.to)) ?? null;
}

/** 만점이 0인 지표 — '건당 · 상한 없음'일 때만 점수가 난다(총점에 그대로 더하고 빼기). 그 밖의 규칙은 늘 0점이라 알린다. */
export function zeroMaxIssue(scoring: Scoring, max: number): string | null {
  if (max !== 0 || (scoring.mode === "perUnit" && !scoring.cap)) return null;
  return "만점이 0이면 ‘건당’에 ‘만점에서 멈춤’을 끈 규칙만 점수가 납니다(총점에 그대로 더하고 빼기). 지금 규칙으로는 늘 0점입니다.";
}

/**
 * 구간표의 빈틈·잘못 — 설정 화면이 저장 전에 알린다(막지는 않는다).
 * 빈틈 = 두 구간 사이에 어느 구간에도 안 드는 값이 있다(예: 0~33 · 34~66 → 33.5는 0점). 겹침은 '위에서부터'라 문제가 아니다.
 */
export function bandIssues(bands: readonly Band[], max: number, unit: string): string[] {
  const out: string[] = [];
  if (bands.some((b) => b.points > max || b.points < 0)) out.push(`구간 점수는 0~${fmt(max)}점 사이로 매깁니다 — 넘는 점수는 만점, 모자라는 점수는 0점으로 셉니다.`);
  if (bands.some((b) => b.from !== null && b.to !== null && b.from > b.to)) out.push("시작이 끝보다 큰 구간이 있습니다 — 그 구간에는 어떤 값도 들지 않습니다.");
  const spans = bands.filter((b) => b.from === null || b.to === null || b.from <= b.to)
    .map((b) => ({ lo: b.from ?? -Infinity, hi: b.to ?? Infinity })).sort((a, b) => a.lo - b.lo);
  let hi = -Infinity;
  for (const s of spans) {
    if (hi !== -Infinity && s.lo - hi > 0.1 + 1e-9) out.push(`${fmt(hi)}${unit}보다 크고 ${fmt(s.lo)}${unit}보다 작은 값(예: ${fmt(round1((hi + s.lo) / 2))}${unit})은 어느 구간에도 들지 않아 0점입니다.`);
    hi = Math.max(hi, s.hi);
  }
  return out;
}

export function pointsFor(raw: number, scoring: Scoring, max: number): number {
  switch (scoring.mode) {
    case "linear": {
      const span = scoring.full - scoring.zero;
      // 두 값이 같으면 문턱 — 그 값 이상이 만점(설명 문구와 같은 뜻).
      const share = span === 0 ? (raw >= scoring.full ? 1 : 0) : (raw - scoring.zero) / span;
      return round1(clamp(share, 0, 1) * max);
    }
    case "bands":
      // 구간 점수는 0~만점 — 만점보다 큰 점수를 적어도 총점이 만점 합계를 넘지 않게(설정 화면이 미리 알린다).
      return round1(clamp(bandFor(raw, scoring.bands)?.points ?? 0, 0, max));
    case "perUnit": {
      const p = raw * scoring.points;
      // 상한 = 더하는 쪽도 빼는 쪽도 만점까지(1건당 −5점 같은 감점도 만점만큼만). 상한 없음은 원장이 고른 것 — 다만 한 지표가
      // ±10만 점을 넘으면 총점 칸(numeric(8,1))이 넘쳐 지점 집계가 통째로 실패하므로 거기서 자른다(오타 한 칸이 매일 실패를 만들지 않게).
      return round1(scoring.cap ? clamp(p, -max, max) : clamp(p, -UNCAPPED, UNCAPPED));
    }
  }
}

/** 수치가 없을 때의 점수 — 합계에서 빼면 null. */
export function missingPoints(setting: Pick<MetricSetting, "missing" | "max">): number | null {
  return setting.missing === "zero" ? 0 : setting.missing === "full" ? setting.max : null;
}


function bandRange(b: Band, unit: string): string {
  if (b.from === null && b.to === null) return "전부";
  if (b.from === null) return `${fmt(b.to as number)}${unit} 이하`;
  if (b.to === null) return `${fmt(b.from)}${unit} 이상`;
  return `${fmt(b.from)}~${fmt(b.to)}${unit}`;
}

/** 규칙을 한 줄로 — "100% = 만점 · 0% = 0점(비례)" · "33% 이하 20점 · 40% 이하 16점 …" · "1건당 5점(만점까지)". */
export function describeScoring(scoring: Scoring, max: number, unit: string): string {
  switch (scoring.mode) {
    case "linear": {
      if (scoring.full === scoring.zero) return `${fmt(scoring.full)}${unit} 이상 만점(${fmt(max)}점) · 그 아래 0점`;
      const up = scoring.full > scoring.zero;
      return `${fmt(scoring.full)}${unit} ${up ? "이상" : "이하"} 만점(${fmt(max)}점) · ${fmt(scoring.zero)}${unit} ${up ? "이하" : "이상"} 0점 · 사이는 비례`;
    }
    case "bands":
      // 적은 점수가 만점을 넘거나 0 아래면 실제로 매기는 값(0~만점)으로 적는다 — 규칙 줄과 항목 점수가 어긋나지 않게.
      // 끝이 없는 구간이 맨 앞이 아니면 '그 밖'(앞 구간에 안 든 나머지)이다.
      return scoring.bands.map((b, i) => `${i > 0 && b.from === null && b.to === null ? "그 밖" : bandRange(b, unit)} ${fmt(clamp(b.points, 0, max))}점`).join(" · ");
    case "perUnit":
      // 만점 0 · 상한 없음 = 학부모 만족도처럼 총점에 그대로 더하고 빼는 지표.
      if (max === 0 && !scoring.cap) return `1${unit || "건"}당 ${fmt(scoring.points)}점 — 만점 없이 총점에 그대로 더하고 뺍니다`;
      return `1${unit || "건"}당 ${fmt(scoring.points)}점${scoring.cap ? `(${fmt(max)}점까지)` : "(상한 없음)"}`;
  }
}

/**
 * 점수표 — 항목별 내역 맨 위 '점수 기준' 상자가 줄마다 그린다(원장 2026-10-14 *"각 탭마다 세부 점수 지표 알려놓을것"*).
 * 문장(`describeScoring`)과 같은 규칙을 표 줄로 — 왼쪽 = 원래 수치의 조건, 오른쪽 = 점수.
 */
export function scoringTable(scoring: Scoring, max: number, unit: string): { when: string; points: string }[] {
  switch (scoring.mode) {
    case "linear": {
      if (scoring.full === scoring.zero) return [{ when: `${fmt(scoring.full)}${unit} 이상`, points: `${fmt(max)}점` }, { when: "그 아래", points: "0점" }];
      const up = scoring.full > scoring.zero;
      return [
        { when: `${fmt(scoring.full)}${unit} ${up ? "이상" : "이하"}`, points: `${fmt(max)}점(만점)` },
        { when: `${fmt(Math.min(scoring.zero, scoring.full))}${unit} ~ ${fmt(Math.max(scoring.zero, scoring.full))}${unit} 사이`, points: "비례" },
        { when: `${fmt(scoring.zero)}${unit} ${up ? "이하" : "이상"}`, points: "0점" },
      ];
    }
    case "bands":
      return scoring.bands.map((b, i) => ({
        when: i > 0 && b.from === null && b.to === null ? "그 밖" : bandRange(b, unit), points: `${fmt(clamp(b.points, 0, max))}점`,
      }));
    case "perUnit":
      return [
        { when: `1${unit || "건"}당`, points: `${fmt(scoring.points)}점` },
        { when: "상한", points: max === 0 && !scoring.cap ? "없음 — 총점에 그대로 더하고 뺍니다" : scoring.cap ? `${fmt(max)}점까지` : "없음" },
      ];
  }
}

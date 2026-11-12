/**
 * 수업보고서 평점(참고용, 0450a) — 표 행 → 화면 값 · 근거 카드 재료(순수, 클라·서버 공용).
 *
 * 원장 2026-10-23 *"평점 열을 추가하고 우리가 가진 평점을 업로드하고 마우스 올리면 이 평점에 대한 근거를
 * 참고용으로 알 수 있게"*. 값은 2026-10-22 오프라인 배치(Haiku 5.5 + 코드 규칙)가 **한 번** 매긴 것이고,
 * 기준은 "학부모가 받아봤을 때 좋은 감정을 느끼는가"다.
 * 🔴 앱은 AI를 부르지 않는다 — 저장된 값만 보여 준다(새 보고서는 '—'). '다시 매기기'를 만들지 말 것.
 * 🔴 화면에 raw 키(`warmth`·`confirmed`)를 내보내지 않는다 — 항목 이름은 저장된 한글 라벨 → 아래 표 순서로
 *    고르고, 둘 다 없으면 그 항목을 뺀다(지어내지 않는다).
 */
import type { TipCard, TipRow } from "@/components/hover-tip/tip";

/**
 * 평점 표시 스위치 — 서버 공통 문(`server/rating-access.ts`)이 지점 `report_rating`·쓰기 권한과 함께 본다.
 * 꺼지면 목록의 '평점' 열이 없고 서버(listReports)도 평점 표를 읽지 않는다.
 * 2026-10-26 원장 *"이게 4.0이라고?"* · *"전혀 신뢰안가는 점수"*로 한 번 껐다(옛 기준 v4: 다섯 항목 평균인데 '믿음' 91.5%·'알기 쉬움' 62.5%가
 * 만점이라 판에 박힌 글도 4.0) → 원장 점수표 44건에 맞춘 기준 v6(report-rating/harness/owner.ts)으로 다시 매기고 다시 켰다(*"진행해"*, 정렬 함께).
 * 🔴 화면은 **지금 기준(v6)으로 매긴 평점만** 보여 준다(옛 기준 값은 표에 남아도 읽지 않는다 — server/report-ratings.ts).
 */
export const REPORT_RATING_VISIBLE = true;

export type RatingClaim = "confirmed" | "needs_check" | "cleared" | "flagged";

/** 항목 하나 — score 0 = 해당 없음(종합 평균에서 빠진 항목). */
export type RatingItem = { label: string; score: number; note: string };

export type ReportRating = {
  points: number;
  items: RatingItem[];
  parentFeeling: string | null;
  suggestion: string | null;
  claim: RatingClaim | null;
  claimReason: string | null;
  ratedOn: string | null;
};

/** `lesson_report_ratings` 행(서버 로더가 읽는 칸만). numeric은 숫자·문자 어느 쪽으로 와도 받는다. */
export type RatingDbRow = {
  report_id: string;
  points: number | string | null;
  items: unknown;
  parent_feeling: string | null;
  suggestion: string | null;
  claim: string | null;
  claim_reason: string | null;
  rated_on: string | null;
};

/** 저장된 라벨이 비었을 때만 쓰는 이름표 — 배치(build-upload)가 쓴 라벨과 같다. */
const ITEM_LABEL: Record<string, string> = {
  warmth: "따뜻함",
  personal: "개별성",
  concern: "아쉬운 점 전달",
  clarity: "알기 쉬움",
  trust: "믿음",
};

export const CLAIM_LABEL: Record<RatingClaim, string> = {
  confirmed: "확정",
  needs_check: "확인 필요",
  cleared: "검증에서 풀림",
  flagged: "1차 판정만",
};

/**
 * 이 값 **미만**이면 주의 색 — 화면에 보이는 값으로 판정한다.
 * 기준 v6은 1~5 정수이고 무작위 150건이 1점 17% · 2점 26%라, 2점까지 칠하면 목록의 절반 가까이가 주황이 된다 → 1점('성의 없음')만.
 */
export const LOW_RATING_BELOW = 2;

const CLAIMS = new Set<string>(Object.keys(CLAIM_LABEL));
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseItems(raw: unknown): RatingItem[] {
  if (!Array.isArray(raw)) return [];
  const out: RatingItem[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const label = text(o.label) || ITEM_LABEL[text(o.key)] || "";
    const score = toNumber(o.score);
    if (!label || score === null || score < 0 || score > 5) continue;
    out.push({ label, score, note: text(o.note) });
  }
  return out;
}

/** 표 행 → 화면 값. 종합 점수가 0~5 숫자가 아니면 `null`(보이지 않게 — 이상한 값을 그리지 않는다). */
export function parseRating(row: RatingDbRow): ReportRating | null {
  const points = toNumber(row.points);
  if (points === null || points < 0 || points > 5) return null;
  const claim = text(row.claim);
  return {
    points,
    items: parseItems(row.items),
    parentFeeling: text(row.parent_feeling) || null,
    suggestion: text(row.suggestion) || null,
    claim: CLAIMS.has(claim) ? (claim as RatingClaim) : null,
    claimReason: text(row.claim_reason) || null,
    ratedOn: text(row.rated_on).slice(0, 10) || null,
  };
}

const roundTenth = (n: number) => Math.round(n * 10) / 10;

/** 목록 칸 표기 — 기준 v6은 정수(`3`), 소수가 있는 값만 한 자리(`3.4`). */
export function formatPoints(points: number): string {
  const p = roundTenth(points);
  return Number.isInteger(p) ? String(p) : p.toFixed(1);
}

export function isLowRating(points: number): boolean {
  return roundTenth(points) < LOW_RATING_BELOW;
}

/** 숫자 옆 주의 표식을 세울 클레임 — 검증에서 위험으로 남은 것만(풀렸거나 1차뿐인 것은 카드에만 적는다). */
export function claimNeedsAttention(claim: RatingClaim | null): claim is "confirmed" | "needs_check" {
  return claim === "confirmed" || claim === "needs_check";
}

/**
 * 마우스 오버 근거 카드 — 항목마다 `라벨 점수 · 근거`(기준 v6은 '정성·구체성' 하나 — 이유 + 멘트 인용), 아래에 기준.
 * 학부모 느낌·고칠 점·클레임은 옛 기준(v4)에만 있던 칸이라 값이 있을 때만 적는다.
 * 근거가 여러 줄이라 **넓은 카드**(`wide`)로 띄운다(기본 폭에선 절반 넘게 잘린다).
 */
export const RATING_BASIS_LINE = "기준: 원장이 직접 매긴 보고서 44건의 눈높이 — 선생님의 정성과 이 아이에 대한 구체적인 이야기";

export function ratingTipCard(r: ReportRating): TipCard {
  const rows: TipRow[] = r.items.map((i) =>
    i.score > 0 ? [`${i.label} ${i.score}`, i.note || "—"] : [i.label, "해당 없음"],
  );
  return {
    title: `보고서 멘트 점수 ${formatPoints(r.points)}`, // 원장 2026-10-27 '평점' → '보고서 멘트 점수'(목록 열 이름과 같게)
    meta: "참고용",
    rows,
    lines: [
      r.parentFeeling ? `학부모 느낌: "${r.parentFeeling}"` : null,
      r.suggestion ? `고치면 좋을 점: ${r.suggestion}` : null,
      r.claim ? `클레임 위험(${CLAIM_LABEL[r.claim]})${r.claimReason ? `: ${r.claimReason}` : ""}` : null,
      `AI가 ${r.ratedOn ? `${r.ratedOn}에 ` : ""}매긴 참고 값 · ${RATING_BASIS_LINE}`,
    ],
    wide: true,
  };
}

/**
 * 원생상담 평점(참고용) — 표 행 → 화면 값 · 근거 카드 재료(순수, 클라·서버 공용). 수업보고서 평점(report-admin/report-rating.ts)과 같은 모양.
 *
 * 원장 2026-11-11 *"모든 상담을 ai가 분석해서 … 보고서와 같은 잣대"* — 기준은 '기록에 상담자의 정성과 이 아이에 대한 구체적인
 * 이야기가 담겼는가'(정성·구체성)이고, 상담 자체의 옳고 그름이 아니다.
 * 🔴 앱은 AI를 부르지 않는다 — 저장된 값만 보여 준다(배치가 아직 안 본 상담은 '—'). '다시 매기기' 버튼을 만들지 말 것.
 * 🔴 화면에 raw 코드(`copied`·`onboarding`)를 내보내지 않는다 — 아래 한글 표를 거치고, 표에 없는 값은 그 줄을 뺀다(지어내지 않는다).
 */
import type { TipCard } from "@/components/hover-tip/tip";
import { formatPoints } from "@/features/report-admin/report-rating";

export type ConsultationRating = {
  points: number;
  reason: string;
  evidence: string;
  /** 상담 사유 태그 코드(복수) — 화면에는 `KIND_LABEL`로만. */
  kinds: string[];
  /** 기록에 없는 칸(`not_recorded`) 이름 — '기록에 없음'이지 '하지 않음'이 아니다. 카드에 '기록에 없는 내용'으로만 쓴다. */
  missing: string[];
  /** 코드 규칙이 정한 점수면 그 규칙 코드 — 화면에는 `ruleLabel`로만. */
  rule: string | null;
  /** 평가한 자료 — recording이면 카드에 '녹음 전사 기준'을 적는다. */
  basis: "memo" | "recording";
  ratedOn: string | null;
};

/** `student_consultation_ratings` 행(서버 로더가 읽는 칸만). numeric·smallint는 숫자·문자 어느 쪽으로 와도 받는다. */
export type ConsultationRatingDbRow = {
  consultation_id: string;
  points: number | string | null;
  reason: string | null;
  evidence: string | null;
  kinds: unknown;
  checks: unknown;
  rule: string | null;
  basis: string | null;
  rated_on: string | null;
};

/** 상담 사유 태그 — 모델이 기록에서 읽은 분류(점수 아님). 하네스의 KIND_CODES와 같은 열쇠. */
export const KIND_LABEL: Readonly<Record<string, string>> = {
  onboarding: "신규·첫 수업 후 연락",
  regular: "정기 상담",
  academic: "학습·성적",
  attendance: "출결·태도",
  schedule: "반·일정 안내",
  risk: "이탈 우려",
  complaint: "불만·문의",
  event: "행사 안내",
  materials: "교재·준비물",
  handover: "담임·강사 변경",
  safety: "안전",
  other: "기타",
};

/** 네 칸 이름 — 기록에 없는 칸을 카드에 알릴 때. */
export const PRESENT_LABEL: Readonly<Record<string, string>> = {
  reason: "상담 사유",
  context: "아이·가정 사정",
  response: "상대 반응·요청",
  next: "다음 행동",
};

/** 코드 규칙이 점수를 정한 까닭 — 모델이 읽은 값과 구분해 카드에 적는다. */
export const RULE_LABEL: Readonly<Record<string, string>> = {
  empty: "상담 내용이 적히지 않은 빈 양식이라 1점",
  copied: "같은 글이 여러 학생에게 그대로 입력돼 있어 3점까지",
};

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 표 행 → 화면 값. 점수가 1~5 숫자가 아니면 `null`(보이지 않게 — 이상한 값을 그리지 않는다). */
export function parseConsultationRating(row: ConsultationRatingDbRow): ConsultationRating | null {
  const points = toNumber(row.points);
  if (points === null || points < 1 || points > 5) return null;
  const kinds = (Array.isArray(row.kinds) ? row.kinds : []).map(String).filter((k) => k in KIND_LABEL);
  const checks = row.checks && typeof row.checks === "object" && !Array.isArray(row.checks) ? (row.checks as Record<string, unknown>) : {};
  return {
    points,
    reason: text(row.reason),
    evidence: text(row.evidence),
    kinds,
    missing: Object.keys(PRESENT_LABEL).filter((k) => checks[k] === "not_recorded"),
    rule: text(row.rule) || null,
    basis: row.basis === "recording" ? "recording" : "memo",
    ratedOn: text(row.rated_on).slice(0, 10) || null,
  };
}

export const ruleLabel = (rule: string | null): string | null => (rule ? (RULE_LABEL[rule] ?? null) : null);

export const CONSULTATION_RATING_BASIS_LINE = "기준: 수업보고서 평점과 같은 잣대 — 기록에 상담자의 정성과 이 아이에 대한 구체적인 이야기가 담겼는가(상담 자체의 옳고 그름이 아니다)";

/**
 * 마우스 오버 근거 카드 — 이유 · 기록 인용 · 상담 사유 · 기록에 없는 내용 · (코드 규칙이 정했으면) 그 까닭, 아래에 기준. 근거가 여러 줄이라 넓은 카드.
 * '기록에 없는 내용'은 기록을 보완할 곳을 알리는 줄이다 — 실제로 하지 않았다는 뜻이 아니다(문구에 그대로 적는다).
 */
export function consultationRatingTip(r: ConsultationRating): TipCard {
  const missing = r.missing.map((k) => PRESENT_LABEL[k]).filter(Boolean);
  return {
    title: `상담 평점 ${formatPoints(r.points)}`,
    meta: "참고용",
    rows: [
      ["이유", r.reason],
      ["기록에서", r.evidence ? `“${r.evidence}”` : ""],
      ["상담 사유", r.kinds.map((k) => KIND_LABEL[k]).join(" · ")],
      ["기록에 없음", missing.length ? `${missing.join(" · ")} (실제로 하지 않았다는 뜻은 아닙니다)` : ""],
      ["규칙", ruleLabel(r.rule) ?? ""],
    ],
    lines: [
      r.basis === "recording" ? "녹음 전사 기준 — 상담자가 직접 쓴 기록이 아니라 수기 기록 평점과 눈금이 다를 수 있습니다." : null,
      `AI가 ${r.ratedOn ? `${r.ratedOn}에 ` : ""}매긴 참고 값 · ${CONSULTATION_RATING_BASIS_LINE}`,
    ],
    wide: true,
  };
}

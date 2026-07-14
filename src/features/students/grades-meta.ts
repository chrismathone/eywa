// 성적 목표·코멘트 공용 메타 + 순수 계산. 클라(폼/표시)·서버(액션/쿼리) 양쪽이 import하므로
// ⚠️ server-only 금지([[#61]]). PillColor는 타입만 import(빌드 시 소거).
import type { PillColor } from "@/components/atoms/pill";
import { kstMonth } from "@/lib/date-kst";

// ── 성적 코멘트 카테고리(도메인 메타 — 운영 enum 아님, 하드코딩 허용) ─────────
// ijw GradeComment 카테고리 이식. 이모지 대신 eywa Pill 색으로 톤 구분(이름앞 아바타·이모지 지양).
export type CommentCategory = "strength" | "improvement" | "effort" | "potential" | "general";

export const COMMENT_CATEGORIES: { key: CommentCategory; label: string; color: PillColor }[] = [
  { key: "strength", label: "학습적 강점", color: "primary" },
  { key: "improvement", label: "학습적 보완점", color: "amber" },
  { key: "effort", label: "이번 달 노력한 점", color: "blue" },
  { key: "potential", label: "성장 잠재력", color: "purple" },
  { key: "general", label: "종합 소견", color: "neutral" },
];

export const COMMENT_CATEGORY_KEYS: CommentCategory[] = COMMENT_CATEGORIES.map((c) => c.key);

const CATEGORY_MAP: Record<string, { label: string; color: PillColor }> = Object.fromEntries(
  COMMENT_CATEGORIES.map((c) => [c.key, { label: c.label, color: c.color }]),
);

export function commentCategoryMeta(key: string): { label: string; color: PillColor } {
  return CATEGORY_MAP[key] ?? { label: key, color: "neutral" };
}

export function isCommentCategory(v: string): v is CommentCategory {
  return COMMENT_CATEGORY_KEYS.includes(v as CommentCategory);
}

// ── 기간(월) 헬퍼 ───────────────────────────────────────────────
/** Date → 'YYYY-MM'. 순수(인자 받음) — 테스트 대상. */
export function periodOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
/** 이번 달 'YYYY-MM'. (호출부에서 기본값으로 사용 — 렌더 본문 외) */
export function currentPeriod(): string {
  return kstMonth();
}

// ── 목표 달성 계산(순수) ─────────────────────────────────────────
/** 점수 → 백분율(만점 대비). 만점/점수 없으면 null. 소수 1자리 반올림. */
export function scorePct(score: number | null, maxScore: number | null): number | null {
  if (score == null || maxScore == null || maxScore <= 0) return null;
  return Math.round((score / maxScore) * 1000) / 10;
}

/** 달성 여부 — 실제점수 없으면 null(미응시), 있으면 실제 >= 목표. */
export function goalAchieved(targetScore: number, actualScore: number | null): boolean | null {
  if (actualScore == null) return null;
  return actualScore >= targetScore;
}

/** 목표 대비 격차(실제 - 목표). 실제 없으면 null. */
export function goalGap(targetScore: number, actualScore: number | null): number | null {
  if (actualScore == null) return null;
  return Math.round((actualScore - targetScore) * 100) / 100;
}

/** 달성률 = 달성한 목표 / 결과가 나온(미응시 제외) 목표. 결과 없으면 null. */
export function goalAchievementRate(goals: { achieved: boolean | null }[]): {
  achieved: number;
  resolved: number;
  pct: number | null;
} {
  const resolved = goals.filter((g) => g.achieved !== null);
  const achieved = resolved.filter((g) => g.achieved === true).length;
  return {
    achieved,
    resolved: resolved.length,
    pct: resolved.length === 0 ? null : Math.round((achieved / resolved.length) * 100),
  };
}

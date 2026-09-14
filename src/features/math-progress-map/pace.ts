/**
 * 계획 대비 실제 — **일수**로 환산한 차이(순수, Vitest).
 *
 * 계획은 교재 단위 선형 속도다(시작일·시작 쪽 → 목표일·목표 쪽). 오늘 있어야 할 쪽 = 시작 쪽 + 하루 쪽수 × 지난 일수,
 * 차이(일) = (실제 쪽 − 계획 쪽) ÷ 하루 쪽수. 달력일 기준이다(수업일로 세려면 학원설정 휴일·반 요일이 필요 — 실데이터
 * 배선 때 `pagesPerDay`를 수업일 수로 바꾸면 된다, 판정식은 그대로).
 *
 * 🔴 임계값은 지시 그대로: **+7일 이상 빠름 · −6~+6 계획대로 · −7일 이하 느림**. 색만으로 가르지 않는다 — 글자
 *    (↑ 12일 빠름 · ● 계획대로 · ↓ 8일 느림)가 항상 같이 선다.
 */
import { diffDays } from "./calendar";
import type { BookChapter, PaceStatus, PlanVsActual, StudentProgress } from "./model";
import type { SemanticTone } from "@/lib/design/semantic-color";

export const PACE_AHEAD_MIN = 7;
export const PACE_DELAYED_MAX = -7;

export function paceStatusOf(differenceDays: number): PaceStatus {
  if (differenceDays >= PACE_AHEAD_MIN) return "ahead";
  if (differenceDays <= PACE_DELAYED_MAX) return "delayed";
  return "normal";
}

/** 쪽 → 대단원 이름. 범위 앞이면 첫 단원, 뒤면 마지막 단원(계획이 교재를 넘어선 경우). */
export function chapterOfPage(chapters: readonly BookChapter[], page: number): string {
  if (chapters.length === 0) return "";
  const hit = chapters.find((c) => page >= c.fromPage && page <= c.toPage);
  if (hit) return hit.title;
  if (page < chapters[0]!.fromPage) return chapters[0]!.title;
  return chapters[chapters.length - 1]!.title;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function planVsActual(p: StudentProgress): PlanVsActual {
  const { plan, curriculum, asOf } = p;
  const actualPage = curriculum.currentPage;
  const span = plan.targetPage - plan.startPage;
  const totalDays = Math.max(1, diffDays(plan.startDate, plan.targetDate));
  // 🔴 계획이 비었거나(목표 쪽 ≤ 시작 쪽) 아직 시작 전이면 판정하지 않는다 — 속도 0으로 나누면 차이가 수천 일로 폭주하고,
  //    시작 전에 "느림"이 뜨면 거짓 재촉이다(실데이터에서 계획 미설정이 흔하다). 둘 다 `normal`·0일.
  if (span <= 0 || asOf < plan.startDate) {
    return {
      plannedPage: plan.startPage,
      plannedChapter: chapterOfPage(curriculum.chapters, plan.startPage),
      actualPage,
      actualChapter: curriculum.chapter,
      pagesPerDay: span > 0 ? Math.round((span / totalDays) * 100) / 100 : 0,
      differenceDays: 0,
      status: "normal",
    };
  }
  const elapsed = clamp(diffDays(plan.startDate, asOf), 0, totalDays);
  const pagesPerDay = span / totalDays;
  const plannedPage = clamp(Math.round(plan.startPage + pagesPerDay * elapsed), plan.startPage, plan.targetPage);
  const differenceDays = Math.round((actualPage - plannedPage) / pagesPerDay);
  return {
    plannedPage,
    plannedChapter: chapterOfPage(curriculum.chapters, plannedPage),
    actualPage,
    actualChapter: curriculum.chapter,
    pagesPerDay: Math.round(pagesPerDay * 100) / 100,
    differenceDays,
    status: paceStatusOf(differenceDays),
  };
}

export const PACE_META: Record<PaceStatus, { glyph: string; tone: SemanticTone; title: string }> = {
  ahead: { glyph: "↑", tone: "positive", title: "빠름" },
  normal: { glyph: "●", tone: "brand", title: "계획대로" },
  delayed: { glyph: "↓", tone: "critical", title: "느림" },
};

/** "↑ 12일 빠름" · "● 계획대로" · "↓ 8일 느림" */
export function paceLabel(pva: Pick<PlanVsActual, "differenceDays" | "status">): string {
  const meta = PACE_META[pva.status];
  if (pva.status === "normal") return `${meta.glyph} ${meta.title}`;
  return `${meta.glyph} ${Math.abs(pva.differenceDays)}일 ${meta.title}`;
}

/** "+12일" · "0일" · "−8일" — 툴팁·표의 짧은 꼴. */
export function paceDelta(differenceDays: number): string {
  if (differenceDays > 0) return `+${differenceDays}일`;
  if (differenceDays < 0) return `−${Math.abs(differenceDays)}일`;
  return "0일";
}

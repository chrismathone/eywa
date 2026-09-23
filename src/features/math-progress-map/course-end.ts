/**
 * **종강 이후** 판정 한 벌 — 원장 2026-09-16: *"종강 이후 달력에서는 선택 못하도록 차단하고, 비활성화 같은
 * 느낌으로 이후 달력 처리해놓는것도 좋을듯. 아니면 표시를 하지 말던가."*
 *
 * 시계는 고른 해의 **열두 달을 늘 다 그린다**(원이라 칸을 빼면 이가 빠진다). 그래서 종강이 2월인 해엔 3~12월이
 * 계획도 기록도 없는 빈 칸으로 서서 진도율 자리에 `—`만 남았다 — 누를 수는 있어서, 누르면 아무것도 없는 달로
 * 초점이 옮겨 갔다.
 *
 * 🔑 **종강 = 로드맵 마지막 단계의 끝 달**(`roadmap.steps[].endMonth`의 최댓값). 계획이 늘어나면 자동으로 밀린다 —
 *    "지금 몇 월까지 계획이 있나"를 따로 저장하지 않는다.
 * 🔴 **로드맵이 없으면 아무것도 막지 않는다**(`null`) — 모르는 것을 "끝났다"로 읽으면 멀쩡한 달이 통째로 잠긴다.
 * ⚠️ 이 판정은 **월 단위**다. 종강 달 자체는 살아 있다(그 달까지가 수업이다).
 * ⚠️ 세로 타임라인·연속 지도는 이미 로드맵 끝에서 멈춘다(`timelineRange`) — 종강 뒤 달이 서는 곳은 시계뿐이다.
 */
import type { RoadmapStep, StudentProgress } from "./model";
import { monthKey } from "./years";

const MONTH_KEY = /^\d{4}-\d{2}$/;

/** 종강(예상) 달 `YYYY-MM` — 로드맵이 없거나 끝 달이 비었으면 null. */
export function courseEndMonth(progress: Pick<StudentProgress, "roadmap"> & Partial<Pick<StudentProgress, "learningMap" | "plan">>): string | null {
  const steps: readonly RoadmapStep[] = progress.roadmap?.steps ?? [];
  // 단계 배열이 시간 순이라는 보장은 없다 — 가장 늦은 끝 달을 고른다.
  const ends = steps.map((step) => step.endMonth).filter((month) => MONTH_KEY.test(month));
  // A saved math goal remains the browsing horizon even when its future class dates are not scheduled yet.
  if (progress.learningMap && progress.plan?.targetDate) ends.push(progress.plan.targetDate.slice(0, 7));
  return ends.length > 0 ? ends.reduce((a, b) => (a > b ? a : b)) : null;
}

/** 그 달이 종강 **뒤**인가 — 종강을 모르면 false(막지 않는다). */
export function isAfterCourseEnd(endMonth: string | null, year: number, month: number): boolean {
  return endMonth != null && monthKey(year, month) > endMonth;
}

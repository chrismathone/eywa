import { monthKey, plannedDaysForMonth } from "./years";
import type { LearningRoadmap, MonthPlan, ProgressYear, RoadmapStep } from "./model";

/** 시안 전용 장기 계획. 중등 3개월, 고등 과정 4개월 — 사용자 지정(2026-09-15). */
const FUTURE_COURSES = [
  { id: "m2-1", label: "중2-1", group: "중등 2학년", duration: 3, topics: ["유리수와 순환소수", "식의 계산", "방정식과 함수"] },
  { id: "m2-2", label: "중2-2", group: "중등 2학년", duration: 3, topics: ["삼각형과 사각형", "도형의 닮음", "확률"] },
  { id: "m3-1", label: "중3-1", group: "중등 3학년", duration: 3, topics: ["실수와 다항식", "이차방정식", "이차함수"] },
  { id: "m3-2", label: "중3-2", group: "중등 3학년", duration: 3, topics: ["삼각비", "원의 성질", "통계"] },
  { id: "common-1", label: "공통수학1", group: "고등 공통", duration: 4, topics: ["다항식", "방정식과 부등식", "경우의 수", "행렬"] },
  { id: "common-2", label: "공통수학2", group: "고등 공통", duration: 4, topics: ["도형의 방정식", "집합과 명제", "함수와 그래프", "종합 정리"] },
  { id: "algebra-1", label: "대수1", group: "대수 · 미적분", duration: 4, topics: ["지수함수와 로그함수", "삼각함수", "수열", "종합 정리"] },
  { id: "calculus-1", label: "미적분1", group: "대수 · 미적분", duration: 4, topics: ["함수의 극한과 연속", "미분", "적분", "종합 정리"] },
] as const;

export function buildSampleRoadmap(asOf: string): { roadmap: LearningRoadmap; years: ProgressYear[] } {
  const steps: RoadmapStep[] = [
    { id: "e6-2", label: "초6-2", group: "입학 · 초등", startMonth: "2026-01", endMonth: "2026-02", estimated: false, description: "비례식 · 원의 넓이 · 입체도형" },
    { id: "m1-1", label: "중1-1", group: "중등 1학년", startMonth: "2026-03", endMonth: "2026-07", estimated: false, description: "소인수분해 · 방정식 · 그래프" },
    { id: "m1-2", label: "중1-2", group: "중등 1학년", startMonth: "2026-08", endMonth: "2026-10", estimated: false, description: "기본도형 · 함수 · 통계" },
  ];
  const byYear = new Map<number, MonthPlan[]>();
  let cursor = 2026 * 12 + 10; // 2026년 11월. 이미 있는 11~12월 상세 계획은 유지한다.
  for (const course of FUTURE_COURSES) {
    const first = cursor;
    const last = cursor + course.duration - 1;
    steps.push({ id: course.id, label: course.label, group: course.group,
      startMonth: monthKey(Math.floor(first / 12), first % 12 + 1),
      endMonth: monthKey(Math.floor(last / 12), last % 12 + 1), estimated: true,
      description: course.topics.join(" · ") });
    for (let index = 0; index < course.duration; index++, cursor++) {
      const year = Math.floor(cursor / 12);
      if (year === 2026) continue;
      const plans = byYear.get(year) ?? [];
      // 쪽수·교재는 샘플 전용. 현재 연도 계획의 학습량에 가까운 월 60쪽으로 예정 칸을 채운다.
      plans.push({ month: cursor % 12 + 1, semester: course.label, bookName: `${course.label} · 교재 미정`,
        chapter: course.topics[index]!, startPage: index * 60 + 1, endPage: (index + 1) * 60 });
      byYear.set(year, plans);
    }
  }
  return {
    roadmap: { enrolledOn: "2026-01-01", targetLabel: "미적분1",
      estimateNote: "미래 중등 학기당 3개월 · 고등 과정당 4개월. 예상 쪽수는 시안용이며 실제 교재·휴강에 따라 조정됩니다.", steps },
    years: [...byYear].map(([year, yearPlan]) => ({ year, yearPlan, estimated: true,
      dailyProgress: yearPlan.flatMap((plan) => plannedDaysForMonth(year, plan, asOf)) })),
  };
}

import { flatLessons } from "@/features/onescreen/curriculum";
import { buildLearningProgress, planLearningGoal, type LearningContext } from "@/features/math-sheets/lib/learning-plan";
import { buildLearningHistory } from "@/features/math-sheets/lib/learning-history";

export function learningMapFixture() {
  let goal = planLearningGoal({ studentId: "00000000-0000-0000-0000-000000000001", studyGrade: "중2", startBlock: "이등변삼각형의 성질", endBlock: "확률의 계산", startDate: "2026-09-01", endDate: "2026-11-30", textbook: null });
  for (const grade of ["중3", "공통수학1"]) goal = planLearningGoal({ ...goal, endStudyGrade: grade, endBlock: flatLessons(grade).at(-1)! }, goal);
  const context: LearningContext = {
    schedules: ["mon", "thu"].map(dayOfWeek => ({ dayOfWeek, startTime: "16:00", endTime: "17:00", validFrom: null, validTo: null })),
    holidays: { "2026-09-24": "휴일" }, spans: { [goal.studentId]: [{ start: "2025-01-01", end: null }] },
  };
  const records = [
    { date: "2026-07-02", progress: "중2 · 이등변삼각형의 성질", textbook: "교재" },
    { date: "2026-08-27", progress: "중2 · 직각삼각형의 합동", textbook: "교재" },
    { date: "2026-09-14", progress: "중2 · 내신대비", textbook: "내신 교재", homework: "오답 정리" },
  ];
  const progress = buildLearningProgress(goal, context, records, "2026-09-18");
  // 화면 테스트는 긴 구간(현재 학기 두 학기 앞부터 155차시)을 쓴다 — 시작 차시를 모르는 상태(start: null)로 둔다.
  // 🔴 실제 규칙은 "등록 이후 첫 기록부터"다(원장 2026-09-21) — 이 학생이면 이등변삼각형의 성질부터 98차시.
  //    그 규칙은 learning-history.test와 learning-map.test '오래 다닌 학생도 첫 기록에서' 테스트가 따로 잠근다.
  progress.history = { ...buildLearningHistory(goal, progress, records, "2025-01-01", "2026-09-18"), start: null };
  return { goal, progress, context, records,
    student: { studentId: goal.studentId, name: "검증 학생", grade: "중2", school: "학교" },
    classId: "00000000-0000-0000-0000-000000000002", className: "검증 반", month: "2026-09" };
}

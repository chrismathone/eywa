import type { OverviewData } from "@/features/dashboard/overview/model";
import { number } from "./charts";
import s from "./overview.module.css";

/**
 * '과목별 수강' 각주 — 세 숫자 잇기(원장 2026-10-20 *"과목별 수강은 강좌수와 조금 다르고 재원생과도 조금 다른데 이 부분 해결방안 모색"*).
 * 재원생은 **학생**, 과목별 수강은 **과목마다 학생**(두 과목이면 양쪽), 강좌수는 **반**을 센다 — 단위가 달라 합이 안 맞아 보인다.
 * 막대 합 = 과목 막대에 선 학생(`subjectStudents`) + 두 과목 이상 듣는 학생이 더 선 몫 · 재원생과의 차 = 아직 반이 없는 학생.
 * 값은 모두 같은 줄로 센 서버 값(`enrolledSubjectCounts`)이라 각주의 덧셈이 늘 맞는다. 옛 스냅샷(사잇값 없음)이면 그리지 않는다.
 */
export function SubjectBridge({ student, courses }: { student: OverviewData["students"]; courses: number | null }) {
  if (student.subjectStudents === undefined) return null;
  const sum = student.subjects.reduce((n, r) => n + r.value, 0);
  const extra = sum - student.subjectStudents;
  const noClass = student.enrolled - student.subjectStudents;
  return (
    <p className={s.footnote}>
      막대를 더하면 {number(sum)}명 — 수업 듣는 학생 {number(student.subjectStudents)}명
      {extra > 0 ? ` + 두 과목 이상 듣는 학생이 과목마다 한 번 더 ${number(extra)}` : ""}.
      {noClass > 0 ? ` 재원생 ${number(student.enrolled)}명 중 ${number(noClass)}명은 과목 막대에 들지 않습니다(반 배정 전이거나 종료일이 적힌 수강만 듣는 경우).` : ""}
      {courses !== null ? ` 강좌수 ${number(courses)}개는 반마다 셉니다(같은 과목 반을 둘 들으면 2개).` : ""}
    </p>
  );
}

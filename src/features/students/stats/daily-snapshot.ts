import {
  composeEnrolled,
  enrolledSubjectCounts,
  gradeSplit,
  schoolLevelLabel,
  summarizePrograms,
  type ActiveEnrollmentRow,
  type EnrolledStudentRow,
  type GradeSplitRow,
  type ProgramSummary,
} from "@/features/students/enrollment/enrolled-composition";
import type { ProgramSubject } from "@/features/students/enrollment/program";
import { summarizeCourses, type CourseSummary } from "@/features/students/enrollment/course-count";

/**
 * 원생 매일 기록 한 줄(`student_daily_stats.data`, 0381a) — 그날 재원생 구성. 순수 함수(Vitest).
 * 🔑 운영실 '재원생' 카드·'재원생 구성'·'학년별 재원생'·'과목별 수강'과 **같은 계산 함수**(`composeEnrolled`·`gradeSplit`·
 *    `enrolledSubjectCounts`·`summarizePrograms`·`schoolLevelLabel`)로 만든다 — 기록된 그날 값 = 그날 운영실 카드 값.
 * 이름·연락처는 담지 않는다(인원 수만).
 */
export type DailySnapshotV1 = {
  v: 1;
  /** 실시간 재원생 — 아직 한 과목도 시작 안 한 학생은 뺀다(운영실 카드와 같은 집합). */
  enrolled: number;
  /** 휴원 학생(상태 휴원). */
  onHold: number;
  /** 학교급 → 인원(미취학·초등·중등·고등·기타·미입력). */
  levels: Record<string, number>;
  /** 학년(원문 · 비면 '미입력') → 인원. */
  grades: Record<string, number>;
  /** 학년별 영어만 · 동시수강 · 수학만(학원설정 학년 순 + 기타·미입력). */
  gradeMix: GradeSplitRow[];
  /** 학교(원문 · 비면 '미입력') → 인원. */
  schools: Record<string, number>;
  /** 과목 키 → 수강생(두 과목이면 양쪽). */
  subjects: Record<string, number>;
  programs: ProgramSummary;
  /** 강좌수(2026-10-20부터 — 그 전 줄엔 없다) — 운영실 '강좌수' 칸과 같은 계산(`summarizeCourses`). */
  courses?: CourseSummary;
  /** 상담 진행 · 신규생 단계/체크(2026-10-21부터 — `ops-daily.ts`). */
  ops?: import("./ops-daily").OpsDaily;
};

const tally = (values: readonly (string | null | undefined)[], empty = "미입력"): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const v of values) {
    const key = v?.trim() || empty;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
};

export function buildDailySnapshot(input: {
  students: readonly EnrolledStudentRow[];
  rows: readonly ActiveEnrollmentRow[];
  /** 종료일이 오늘 이후로 적힌 활성 수강 — 강좌수에만 더한다(운영실 '강좌수' 칸과 같은 규약 · 재원생 구성은 `rows`만). */
  endingRows?: readonly ActiveEnrollmentRow[];
  onHold: number;
  subjects: readonly ProgramSubject[];
  gradeLevels: readonly string[];
  today: string;
  /** 강좌수 영어를 인재원 영어 · EiE 따로(원장 2026-10-30 — EiE 모듈 켜진 지점). */
  splitEnglish?: boolean;
}): DailySnapshotV1 {
  const composition = composeEnrolled({ students: input.students, rows: input.rows, scope: null, subjects: input.subjects, today: input.today });
  const visible = composition.students;
  return {
    v: 1,
    enrolled: visible.length,
    onHold: input.onHold,
    levels: tally(visible.map((s) => schoolLevelLabel(s.grade))),
    grades: tally(visible.map((s) => s.grade)),
    gradeMix: gradeSplit(visible, composition.programs, input.gradeLevels).rows,
    schools: tally(visible.map((s) => s.school)),
    subjects: enrolledSubjectCounts(input.rows, null, input.today).bySubject,
    programs: summarizePrograms(
      visible.map((s) => s.id),
      composition.programs,
      composition.active,
    ),
    courses: summarizeCourses({ rows: [...input.rows, ...(input.endingRows ?? [])], scope: null, subjects: input.subjects, today: input.today, splitEnglish: input.splitEnglish }),
  };
}

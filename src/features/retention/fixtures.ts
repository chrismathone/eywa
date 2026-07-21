// 가상 시드 제너레이터 — eywa 실데이터 없이 위험 파이프라인을 테스트하기 위한 결정적 픽스처.
// eywa 원시 행(snake_case) 형태를 그대로 생성하므로 buildRoster에 바로 넣을 수 있다.
// 결정적: 같은 (count, today)면 항상 같은 결과. RNG 없이 아키타입 순환.
import type {
  RetentionRawData,
  RawAttendanceRow,
  RawConsultRow,
  RawEnrollmentRow,
  RawGradeRow,
  RawInvoiceRow,
  RawStudentRow,
} from "./roster";
import type { RiskLevel } from "./risk";

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function shift(base: Date, days: number): Date {
  const n = new Date(base);
  n.setDate(n.getDate() + days);
  return n;
}
/** doneCount개의 true를 N개 슬롯에 균등 분배(최근·과거 절반 모두 비율 반영). */
function spread(n: number, doneCount: number): boolean[] {
  const out: boolean[] = [];
  for (let j = 0; j < n; j++) {
    out.push(Math.floor(((j + 1) * doneCount) / n) > Math.floor((j * doneCount) / n));
  }
  return out;
}

type Archetype = {
  key: string;
  grade: string;
  note: string;
  lastScore: number;
  prevScore: number;
  homeworkRate: number; // %
  absences: number;
  lates: number;
  daysSinceCounsel: number | null;
  followUpInDays: number | null;
  endInDays: number | null;
  expect: RiskLevel;
};

// 위험도가 예측 가능하도록 밴드 경계에서 안전하게 떨어지는 5개 아키타입.
const ARCHETYPES: Archetype[] = [
  { key: "환불신호", grade: "고2", note: "학부모 환불 문의가 있었습니다", lastScore: 82, prevScore: 85, homeworkRate: 90, absences: 1, lates: 0, daysSinceCounsel: 20, followUpInDays: null, endInDays: 60, expect: "risk" },
  { key: "성적급락", grade: "중3", note: "", lastScore: 68, prevScore: 90, homeworkRate: 55, absences: 3, lates: 0, daysSinceCounsel: 35, followUpInDays: null, endInDays: 90, expect: "risk" },
  { key: "숙제부진", grade: "중1", note: "", lastScore: 80, prevScore: 86, homeworkRate: 55, absences: 1, lates: 3, daysSinceCounsel: 10, followUpInDays: null, endInDays: 120, expect: "warn" },
  { key: "상담공백", grade: "고1", note: "", lastScore: 88, prevScore: 90, homeworkRate: 95, absences: 2, lates: 3, daysSinceCounsel: 50, followUpInDays: null, endInDays: 14, expect: "warn" },
  { key: "안정", grade: "초5", note: "", lastScore: 92, prevScore: 90, homeworkRate: 98, absences: 0, lates: 0, daysSinceCounsel: 7, followUpInDays: 3, endInDays: 200, expect: "ok" },
];

const NAMES = ["김서윤", "이준우", "박지민", "최하은", "정도현", "강수아", "윤시우", "임채원", "오태양", "한예린", "서민재", "신유나"];
const TEACHERS = ["김민수", "이서연"];

export type FixtureCase = { id: string; name: string; archetype: string; expect: RiskLevel };
export type RetentionFixture = { data: RetentionRawData; cases: FixtureCase[] };

/** count명의 결정적 가상 학생 + 관련 행 생성. today 기준 상대 날짜. */
export function generateRetentionFixture(
  count = 10,
  today: Date = new Date("2026-06-15T00:00:00Z"),
): RetentionFixture {
  const period = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`;
  const students: RawStudentRow[] = [];
  const attendance: RawAttendanceRow[] = [];
  const grades: RawGradeRow[] = [];
  const consultations: RawConsultRow[] = [];
  const invoices: RawInvoiceRow[] = [];
  const enrollments: RawEnrollmentRow[] = [];
  const cases: FixtureCase[] = [];

  for (let i = 0; i < count; i++) {
    const a = ARCHETYPES[i % ARCHETYPES.length];
    const id = `stu-${String(i + 1).padStart(3, "0")}`;
    const name = NAMES[i % NAMES.length];
    const teacher = TEACHERS[i % TEACHERS.length];

    students.push({
      id,
      name,
      grade: a.grade,
      school: `${a.grade.slice(0, 1)}학교`,
      notes: a.note || null,
      ai_care_summary: null,
      teacherNames: [teacher],
    });

    // 성적 2건(직전·최근)
    grades.push({ student_id: id, score: a.prevScore, max_score: 100, taken_on: iso(shift(today, -40)) });
    grades.push({ student_id: id, score: a.lastScore, max_score: 100, taken_on: iso(shift(today, -10)) });

    // 출결 14세션(2일 간격, 28일 범위) — 결석/지각 배치 + 숙제 균등 분배
    const N = 14;
    const doneCount = Math.round((a.homeworkRate / 100) * N);
    const hw = spread(N, doneCount);
    for (let j = 0; j < N; j++) {
      let status = "present";
      if (j < a.absences) status = "absent";
      else if (j < a.absences + a.lates) status = "late";
      attendance.push({
        student_id: id,
        status,
        session_date: iso(shift(today, -(j * 2 + 1))),
        homework_required: true,
        homework_done: hw[j],
      });
    }

    // 상담(있으면) + 다음 연락(있으면)
    if (a.daysSinceCounsel != null) {
      consultations.push({
        student_id: id,
        consulted_at: shift(today, -a.daysSinceCounsel).toISOString(),
        summary: a.note || "정기 상담 진행",
        follow_up_date: a.followUpInDays != null ? iso(shift(today, a.followUpInDays)) : null,
        follow_up_done: false,
      });
    }

    // 수납(이번 달) + 수강(종료 임박 여부)
    const fee = a.grade.includes("고") ? 640000 : a.grade.includes("중") ? 540000 : 380000;
    invoices.push({ student_id: id, amount_total: fee, period });
    enrollments.push({
      student_id: id,
      end_date: a.endInDays != null ? iso(shift(today, a.endInDays)) : null,
      on_hold: false,
    });

    cases.push({ id, name, archetype: a.key, expect: a.expect });
  }

  // reportHomework는 비워 둔다 — 픽스처는 출석부 폴백 경로를 검증한다(실데이터는 수업보고서 경로).
  return {
    data: { students, attendance, reportHomework: [], grades, consultations, invoices, enrollments },
    cases,
  };
}

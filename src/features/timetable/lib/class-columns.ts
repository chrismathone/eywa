// 통합뷰(반=단위 카드) 데이터 도출 — 한 과목의 슬롯을 **반(class)별 카드**로 묶어 정렬한다.
// 순수 함수(테스트 강제). 각 반 카드: 헤더(반명·스케줄·강사·강의실) + 학생 명단 + 정원.
//
// ⚠️ 옛 "반=열 리치뷰"(시작교시 그룹 박스 + 카드별 요일×교시 미니그리드)는 폐기했다.
// 이유: ① 시작교시 그룹화가 화면을 박스 9개로 분절(외톨이·중복 라벨), ② 카드마다 반복되는 미니그리드가
// 절반이 빈 칸(정보는 이미 스케줄 라벨에 있음)인 노이즈, ③ 좁은 카드 + 박스별 가로스크롤로 한눈에 안 들어옴.
// 지금은 **반응형 카드 그리드**(좁으면 1열·넓으면 N열) — 교시 축·미니그리드 없이 반을 한눈에 본다.
import { enumDayToKo, type DayOfWeek } from "./periods";

export type ClassColumnStudent = {
  name: string;
  grade: string | null;
  school: string | null;
  studentId?: string;
  status: "active" | "hold" | "withdrawn";
  isNew?: boolean;
  isTransferredIn?: boolean;
};

export type ClassColumnSlot = {
  classId: string;
  className: string;
  subject: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  teacherName: string | null;
  classroomName: string | null;
  students: ClassColumnStudent[];
};

export type ClassCard = {
  classId: string;
  className: string;
  teacherName: string | null;
  classroomName: string | null;
  scheduleLabel: string; // "월·수·목 14:30~16:20"
  students: ClassColumnStudent[];
  activeCount: number; // 재원 수(정원 표시)
  startTime: string; // 정렬 키(가장 이른 시작시각)
};

const DAY_ORDER: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function hm(t: string): string {
  return String(t).slice(0, 5);
}

/** 반의 스케줄 라벨 — 요일(요일순 한글) + 전체 시간범위. 예: "월·수·목 14:30~16:20". */
function scheduleLabel(slots: ClassColumnSlot[]): string {
  const days = Array.from(new Set(slots.map((s) => s.dayOfWeek as DayOfWeek))).sort(
    (a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b),
  );
  const dayStr = days.map((d) => enumDayToKo(d)).join("·");
  const start = slots.reduce((m, s) => (hm(s.startTime) < m ? hm(s.startTime) : m), hm(slots[0].startTime));
  const end = slots.reduce((m, s) => (hm(s.endTime) > m ? hm(s.endTime) : m), hm(slots[0].endTime));
  return `${dayStr} ${start}~${end}`;
}

/**
 * 한 과목 슬롯 → 반(class)별 카드 목록. 시작시각순 → 반명순 정렬.
 * 한 반이 여러 교시/요일 슬롯에 걸쳐 있어도 한 카드로 묶는다(학생 명단은 반 기준 동일).
 */
export function buildClassCards(slots: ClassColumnSlot[]): ClassCard[] {
  const byClass = new Map<string, ClassColumnSlot[]>();
  for (const s of slots) {
    const list = byClass.get(s.classId) ?? [];
    list.push(s);
    byClass.set(s.classId, list);
  }

  const cards: ClassCard[] = [];
  for (const group of byClass.values()) {
    const first = group[0];
    const teacherCount = new Map<string, number>();
    let classroom: string | null = null;
    let startTime = hm(first.startTime);
    for (const s of group) {
      if (s.teacherName) teacherCount.set(s.teacherName, (teacherCount.get(s.teacherName) ?? 0) + 1);
      if (!classroom && s.classroomName) classroom = s.classroomName;
      if (hm(s.startTime) < startTime) startTime = hm(s.startTime);
    }
    // 대표 강사 = 최빈(여러 강사면 가장 많이 가르치는 사람)
    const teacherName =
      [...teacherCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? first.teacherName ?? null;
    const students = first.students;
    cards.push({
      classId: first.classId,
      className: first.className,
      teacherName,
      classroomName: classroom,
      scheduleLabel: scheduleLabel(group),
      students,
      activeCount: students.filter((s) => s.status === "active").length,
      startTime,
    });
  }

  return cards.sort(
    (a, b) => a.startTime.localeCompare(b.startTime) || a.className.localeCompare(b.className, "ko"),
  );
}

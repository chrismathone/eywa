// 통합뷰(반=단위 카드) 데이터 도출 — 한 과목의 슬롯을 **반(class)별 카드**로 묶고, **시작 교시별 섹션**으로 그룹화.
// 순수 함수(테스트 강제). 각 반 카드: 헤더(반명·스케줄·강사·강의실) + 학생 명단 + 정원.
//
// 통합뷰의 핵심 가치 = **교시별 정리**. 단 옛 "반=열 리치뷰"의 함정(① 카드별 요일×교시 미니그리드 노이즈,
// ② 박스별 가로스크롤, ③ 평일 교시군과 주말 교시가 같은 "N교시" 라벨을 공유해 그룹이 중복)은 피한다:
//   · 미니그리드/가로스크롤 없음 — 각 섹션은 반응형 카드 그리드(좁으면 1열·넓으면 N열, 컴포넌트가 렌더).
//   · **교시 정렬은 평일 기준** — 반의 그룹은 그 반의 **평일 시작 교시**로 정한다.
//   · **주말 전용 수업은 "주말" 한 섹션으로 따로** — 평일 교시 버킷에 안 섞이고 중복 라벨도 안 생긴다.
import {
  slotPeriodRow,
  enumDayToKo,
  type DayOfWeek,
  type PeriodsConfig,
  type TimetableSubject,
} from "./periods";

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
  groupOrder: number; // 그룹 정렬 키 = 평일 시작 교시 order(주말 전용은 WEEKEND_ORDER)
  groupLabel: string; // "1교시 시작" | "주말"
};

// 시작 교시별 섹션. 평일 교시 그룹들 + (있으면) 맨 뒤 "주말" 그룹.
export type ClassCardGroup = {
  key: string;
  label: string; // "1교시 시작" | "주말"
  order: number;
  cards: ClassCard[];
};

const DAY_ORDER: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKEND = new Set<string>(["sat", "sun"]);
const WEEKEND_ORDER = 100000; // 주말 그룹은 항상 맨 뒤

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
 * 각 카드에 **평일 시작 교시** 기준 그룹 정보(groupOrder/groupLabel)를 담는다(주말 전용=주말 그룹).
 */
export function buildClassCards(slots: ClassColumnSlot[], config: PeriodsConfig): ClassCard[] {
  const subject = (slots[0]?.subject ?? "math") as TimetableSubject;
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

    // 그룹 = 평일 시작 교시 기준. 평일 슬롯이 있으면 그 중 가장 이른 시작의 교시, 없으면(주말 전용) "주말".
    const weekdaySlots = group.filter((s) => !WEEKEND.has(s.dayOfWeek));
    let groupOrder: number;
    let groupLabel: string;
    if (weekdaySlots.length > 0) {
      const repr = weekdaySlots.reduce((m, s) => (hm(s.startTime) < hm(m.startTime) ? s : m), weekdaySlots[0]);
      const pr = slotPeriodRow(subject, repr.startTime, repr.dayOfWeek as DayOfWeek, config);
      groupOrder = pr.order;
      groupLabel = `${pr.label} 시작`;
    } else {
      groupOrder = WEEKEND_ORDER;
      groupLabel = "주말";
    }

    cards.push({
      classId: first.classId,
      className: first.className,
      teacherName,
      classroomName: classroom,
      scheduleLabel: scheduleLabel(group),
      students,
      activeCount: students.filter((s) => s.status === "active").length,
      startTime,
      groupOrder,
      groupLabel,
    });
  }

  return cards.sort(
    (a, b) => a.startTime.localeCompare(b.startTime) || a.className.localeCompare(b.className, "ko"),
  );
}

/**
 * 반 카드를 **시작 교시별 섹션**으로 묶는다. 평일 교시 그룹들(order 오름차순) + (있으면) 맨 뒤 "주말" 그룹.
 * 섹션 안 카드는 시작시각순→반명순(buildClassCards 정렬 유지).
 */
export function buildClassCardGroups(slots: ClassColumnSlot[], config: PeriodsConfig): ClassCardGroup[] {
  const cards = buildClassCards(slots, config);
  const map = new Map<string, ClassCardGroup>();
  for (const c of cards) {
    const key = `${c.groupOrder}::${c.groupLabel}`;
    let g = map.get(key);
    if (!g) {
      g = { key, label: c.groupLabel, order: c.groupOrder, cards: [] };
      map.set(key, g);
    }
    g.cards.push(c);
  }
  return [...map.values()].sort((a, b) => a.order - b.order);
}

// 통합뷰(반=열 리치 그리드) 데이터 도출 — ijw EnglishClassTab 이식. 순수 함수(테스트 강제).
// 한 과목 슬롯을 **반(class)별 카드**로 묶고 **시작 교시별 섹션**으로 그룹화. 각 카드:
// 헤더(반명·담임·요일별 강의실) + **요일×교시 미니그리드**(셀마다 강사/LAB, ijw slotTeachers) + 재원/대기/퇴원.
// 셀 강사·LAB·요일별 강의실은 슬롯 라벨(class_schedules.slot_teacher_label/slot_room_label, 0041a 백필)에서 온다.
// ⚠️ server-only 금지 — 클라(rich-card-group)도 import. 순수·plain만.
import {
  slotPeriodRow,
  subjectPeriodRows,
  enumDayToKo,
  type DayOfWeek,
  type PeriodsConfig,
  type TimetableSubject,
} from "./periods";

export type GridStudent = {
  name: string;
  grade: string | null;
  school: string | null;
  studentId?: string;
  status: "active" | "hold" | "withdrawn";
  isNew?: boolean;
  isTransferredIn?: boolean;
  englishName?: string | null;
  // hover 정보용 — 런타임엔 StudentLine 전체가 도착(서버 쿼리가 채움). 분리등원·퇴원일·최근 교재·최근 진도.
  attendanceDays?: string[];
  endDate?: string | null;
  latestTextbook?: { name: string; date: string | null } | null;
  latestReport?: {
    date: string;
    progress: string | null;
    examInfo: string | null;
    homeworkScore: string | null;
    teacherName: string | null;
  } | null;
};

/** 빌더 입력 — ScheduleSlotWithStudents와 구조 호환(서버 타입 직접 import 회피, [[#61]]). */
export type GridSlot = {
  classId: string;
  className: string;
  subject: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  teacherName: string | null; // 반 기본 강사(담임)
  classroomName: string | null; // 반 기본 강의실
  slotTeacherLabel: string | null; // 셀 강사/LAB(ijw slotTeachers)
  slotRoomLabel: string | null; // 셀 강의실(ijw slotRooms)
  classBgColor: string | null;
  classTextColor: string | null;
  students: GridStudent[];
};

export type GridCell = { label: string; isLab: boolean };
export type GridPeriodRow = { order: number; label: string; time: string };

/**
 * 강사 라벨(display_name·영문닉네임) → 저장된 색(#RRGGBB). 통합뷰 셀·담임색 배선용.
 * 서버가 users.bg_color/text_color + english_name으로 빌드해 클라 렌더에 plain 객체로 전달
 * (메서드 없는 순수 데이터라 [[#61]] server-only 무관). 미해결 라벨은 teacherColor 해시 폴백.
 */
export type TeacherColorMap = Record<string, { bg: string; text: string }>;

export type RichClassCard = {
  classId: string;
  className: string;
  subject: string; // 과목 키(hover 과목 pill용)
  teacherName: string | null; // 담임
  classroomLabel: string; // "월수 304 / 목 LAB실"
  bgColor: string | null; // ijw 반 헤더색(#RRGGBB) — null이면 과목색 폴백
  textColor: string | null;
  cells: Record<string, GridCell>; // `${order}:${day}` → 셀
  periodRows: GridPeriodRow[]; // 이 카드가 쓰는 교시행(그룹 축 union 재료)
  active: GridStudent[];
  hold: GridStudent[];
  withdrawn: GridStudent[];
  activeCount: number;
  groupOrder: number;
  groupLabel: string;
};

export type RichCardGroup = {
  key: string;
  label: string; // "1교시 시작" | "주말"
  order: number;
  cards: RichClassCard[];
  periodRows: GridPeriodRow[]; // 그룹 공통 교시축(카드 union, order순)
  days: DayOfWeek[]; // 그룹 공통 요일축(카드 union)
  holdRows: number; // 그룹 내 max(대기 수) — 카드/라벨열 높이 동기화
  withdrawnRows: number; // 그룹 내 max(퇴원 수)
};

const DAY_ORDER: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKDAY_DAYS: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri"];
const WEEKEND = new Set<string>(["sat", "sun"]);
const WEEKEND_ORDER = 100000;
const GRID_MIN = 5; // 미니그리드 기본 크기 — 평일 섹션은 항상 5요일(월~금) × 5교시(섹션 시작부터).

/** "본원304" → "304"(공통 건물 접두사 제거로 라벨 압축). "LAB실"·타건물은 그대로 — 건물 구분 유지. */
function shortRoom(room: string): string {
  return room.replace(/^본원/, "") || room;
}

/**
 * 요일별 강의실 → "월수 304 / 목 LAB실·304". 한 요일에 교시마다 강의실이 다르면(LAB 교시 등)
 * 그 요일의 강의실을 "·"로 모아 보여주고(ijw "목 LAB실-본원304" 패턴), 같은 강의실 집합인 요일끼리 묶는다.
 * 전부 같으면 단일, 비면 "-". 방 이름은 shortRoom으로 공통 "본원" 접두사를 떼 압축.
 */
function classroomLabel(perDayRooms: Map<DayOfWeek, Set<string>>): string {
  if (perDayRooms.size === 0) return "-";
  const dayStr = new Map<DayOfWeek, string>();
  for (const [d, set] of perDayRooms)
    dayStr.set(d, [...set].map(shortRoom).sort((a, b) => a.localeCompare(b, "ko")).join("·"));
  const distinct = [...new Set(dayStr.values())];
  if (distinct.length === 1) return distinct[0];
  const byRooms = new Map<string, DayOfWeek[]>();
  for (const d of DAY_ORDER) {
    const r = dayStr.get(d);
    if (!r) continue;
    (byRooms.get(r) ?? byRooms.set(r, []).get(r)!).push(d);
  }
  return [...byRooms.entries()]
    .map(([rooms, days]) => `${days.map(enumDayToKo).join("")} ${rooms}`)
    .join(" / ");
}

/** 한 과목 슬롯 → 시작 교시별 리치 카드 섹션. 교시 정렬은 평일 기준, 주말 전용 반은 "주말" 섹션. */
export function buildRichCardGroups(slots: GridSlot[], config: PeriodsConfig): RichCardGroup[] {
  const subject = (slots[0]?.subject ?? "math") as TimetableSubject;
  const byClass = new Map<string, GridSlot[]>();
  for (const s of slots) (byClass.get(s.classId) ?? byClass.set(s.classId, []).get(s.classId)!).push(s);

  const cards: RichClassCard[] = [];
  for (const group of byClass.values()) {
    const first = group[0];
    const cells: Record<string, GridCell> = {};
    const perDayRooms = new Map<DayOfWeek, Set<string>>();
    const periodMap = new Map<number, GridPeriodRow>();
    const slotTeacherCount = new Map<string, number>(); // 담임 폴백용(최빈 슬롯 강사, LAB 제외)
    let weekdayStart = Infinity;
    for (const s of group) {
      const day = s.dayOfWeek as DayOfWeek;
      const row = slotPeriodRow(subject, s.startTime, day, config);
      if (!periodMap.has(row.order)) periodMap.set(row.order, { order: row.order, label: row.label, time: row.time });
      const teacher = s.slotTeacherLabel ?? s.teacherName ?? "";
      cells[`${row.order}:${day}`] = { label: teacher, isLab: s.slotTeacherLabel === "LAB" };
      if (s.slotTeacherLabel && s.slotTeacherLabel !== "LAB")
        slotTeacherCount.set(s.slotTeacherLabel, (slotTeacherCount.get(s.slotTeacherLabel) ?? 0) + 1);
      const room = s.slotRoomLabel ?? s.classroomName;
      if (room) (perDayRooms.get(day) ?? perDayRooms.set(day, new Set()).get(day)!).add(room);
      if (!WEEKEND.has(day) && row.order < weekdayStart) weekdayStart = row.order;
    }
    // 담임 = 반 기본 강사 우선, 없으면 가장 많이 가르치는 슬롯 강사(ijw homeroom은 영문닉네임이라 FK 미해결).
    const topSlotTeacher = [...slotTeacherCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const students = first.students;
    const split = (st: GridStudent["status"]) => students.filter((x) => x.status === st);
    const weekend = weekdayStart === Infinity;
    cards.push({
      classId: first.classId,
      className: first.className,
      subject: first.subject,
      teacherName: first.teacherName ?? topSlotTeacher,
      classroomLabel: classroomLabel(perDayRooms),
      bgColor: first.classBgColor,
      textColor: first.classTextColor,
      cells,
      periodRows: [...periodMap.values()].sort((a, b) => a.order - b.order),
      active: split("active"),
      hold: split("hold"),
      withdrawn: split("withdrawn"),
      activeCount: students.filter((x) => x.status === "active").length,
      groupOrder: weekend ? WEEKEND_ORDER : weekdayStart,
      groupLabel: weekend ? "주말" : `${periodMap.get(weekdayStart)?.label ?? ""} 시작`,
    });
  }

  // 시작 교시별 그룹 + 그룹 공통 교시·요일 축(카드 union).
  const groupMap = new Map<string, RichClassCard[]>();
  for (const c of cards) {
    const key = `${c.groupOrder}::${c.groupLabel}`;
    (groupMap.get(key) ?? groupMap.set(key, []).get(key)!).push(c);
  }

  return [...groupMap.values()]
    .map((cs) => {
      cs.sort((a, b) => a.className.localeCompare(b.className, "ko"));
      const weekend = cs[0].groupOrder === WEEKEND_ORDER;
      // 셀(order:day)에서 "이 섹션 체계(평일/주말)의 요일"에 실제 있는 교시 order만 수집.
      // order=자정기준 분이라 평일 영어 2교시(15:00)와 주말 7교시(토 15:00)가 충돌 → 요일로 체계를 가른다.
      const daySet = new Set<DayOfWeek>();
      const presentOrders = new Set<number>();
      for (const c of cs) {
        for (const k of Object.keys(c.cells)) {
          const [ordPart, dayPart] = k.split(":");
          const day = dayPart as DayOfWeek;
          daySet.add(day);
          if (WEEKEND.has(day) === weekend) presentOrders.add(Number(ordPart));
        }
      }
      // 교시축 = 표준 교시표에서 섹션 시작 교시부터 5칸 윈도우(5×5 기본). 끝 가까운 섹션은
      // 윈도우를 당겨 항상 5칸 확보(표준 교시가 5개 미만인 수학계열은 전부).
      const standard = subjectPeriodRows(subject, weekend, config);
      const standardByOrder = new Map(standard.map((r) => [r.order, r]));
      // 앵커 = 섹션에 실제 등장하는 표준 교시 중 가장 이른 것(폴백 시각·다른 체계는 제외됨).
      const presentStd = [...presentOrders].filter((o) => standardByOrder.has(o));
      const anchorOrder = presentStd.length ? Math.min(...presentStd) : standard[0]?.order ?? 0;
      let startIdx = standard.findIndex((r) => r.order === anchorOrder);
      if (startIdx < 0) startIdx = 0;
      startIdx = Math.min(startIdx, Math.max(0, standard.length - GRID_MIN));
      const winRows = new Map<number, GridPeriodRow>();
      for (const r of standard.slice(startIdx, startIdx + GRID_MIN))
        winRows.set(r.order, { order: r.order, label: r.label, time: r.time });
      // 윈도우 밖이어도 실제 등장하는 표준 교시는 포함(긴 수업 클립 방지). 다른 체계(주말)·폴백 시각은
      // 제외 — 한 카드가 두 교시체계를 섞어도 그리드가 폭발하지 않게.
      for (const o of presentStd) {
        if (winRows.has(o)) continue;
        const r = standardByOrder.get(o)!;
        winRows.set(o, { order: r.order, label: r.label, time: r.time });
      }
      // 요일축 = 평일 섹션은 항상 월~금(5열), 주말 섹션은 실제 주말요일.
      const days = weekend ? DAY_ORDER.filter((d) => WEEKEND.has(d) && daySet.has(d)) : WEEKDAY_DAYS;
      return {
        key: `${cs[0].groupOrder}::${cs[0].groupLabel}`,
        label: cs[0].groupLabel,
        order: cs[0].groupOrder,
        cards: cs,
        periodRows: [...winRows.values()].sort((a, b) => a.order - b.order),
        days,
        holdRows: Math.max(1, ...cs.map((c) => c.hold.length)),
        withdrawnRows: Math.max(1, ...cs.map((c) => c.withdrawn.length)),
      };
    })
    .sort((a, b) => a.order - b.order);
}

// 솔리드 배경 + 흰 글자라 대비가 충분한 색만(amber·gold 제외 — 흰 글자 대비 미달로 셀 강사명이 안 읽힘).
const TEACHER_PALETTE = ["blue", "purple", "rose", "primary", "danger"] as const;
/** 강사명(라벨) → 결정적 색 키(이름 해시). eywa엔 강사 색 설정이 없어 라벨 해시로 안정 배정. */
export function teacherColor(name: string | null): (typeof TEACHER_PALETTE)[number] {
  if (!name) return "blue";
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TEACHER_PALETTE[h % TEACHER_PALETTE.length];
}

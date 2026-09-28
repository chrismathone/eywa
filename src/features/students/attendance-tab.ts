// 학생 상세 출결 탭 — 라벨·필터·달력 배치(순수). 과목 라벨은 학원설정 labelOf.
import { seatKeyOf, SEAT_NAME } from "@/features/attendance/seat/seat";
import { attendanceRate, attendedCount } from "@/lib/calc/attendance";
import { isEnrollmentOnRosterOn } from "@/features/enrollments/eligibility";
import {
  ATT_SOFT,
  ATT_SOFT_BORDER,
  type AttendanceStatusKey,
} from "@/features/attendance/status-color";

export type AttendanceClassOption = { value: string; label: string; subject: string };

export type AttendanceRecordLike = {
  date: string;
  status: string;
  classId: string;
  className: string;
  subject: string;
  note: string | null;
  slotStart: string | null;
  seatLabel: string | null;
  /** 그날 그 반 수업보고서를 쓴 사람(담임 아님). 없으면 안 적는다 — 영어는 aywa에 보고서를 안 쓴다. */
  reporter?: string | null;
};

/** 출결 6종. excused=병결(입력 경로는 이 모듈 밖). */
export const ATTENDANCE_STATUS_ORDER = [
  "present",
  "absent",
  "late",
  "excused",
  "early_leave",
  "makeup",
] as const;

export const ATTENDANCE_STATUS_LABEL: Record<(typeof ATTENDANCE_STATUS_ORDER)[number], string> = {
  present: "출석",
  absent: "결석",
  late: "지각",
  excused: "병결",
  early_leave: "조퇴",
  makeup: "보강",
};

/**
 * 색은 [`status-color.ts`](src/features/attendance/status-color.ts) 단일 소스.
 * ⚠️ v4 이전엔 여기가 chart 슬롯을 직접 참조해(공결=blue인데 조퇴=chart-5 장미, 보강=chart-1 파랑)
 *    출석부·당일 출결과 조퇴·보강 색이 어긋나 있었다.
 */
export const ATTENDANCE_STATUS_COLOR: Record<(typeof ATTENDANCE_STATUS_ORDER)[number], string> =
  Object.fromEntries(
    (Object.keys(ATT_SOFT) as AttendanceStatusKey[]).map((k) => [
      k,
      `${ATT_SOFT[k]} ${ATT_SOFT_BORDER[k]}`,
    ])
  ) as Record<(typeof ATTENDANCE_STATUS_ORDER)[number], string>;

const UNKNOWN_STATUS = "기타";

export function attendanceStatusLabel(status: string): string {
  return ATTENDANCE_STATUS_LABEL[status as keyof typeof ATTENDANCE_STATUS_LABEL] ?? UNKNOWN_STATUS;
}

export function attendanceStatusColor(status: string): string {
  return ATTENDANCE_STATUS_COLOR[status as keyof typeof ATTENDANCE_STATUS_COLOR] ?? "";
}

export function ymOf(date: string): string {
  return date.slice(0, 7);
}

/** "16:20:00" → "16:20". 형식이 아니면 숨긴다. */
export function formatSlotStart(slot: string | null | undefined): string | null {
  if (!slot) return null;
  const hhmm = slot.slice(0, 5);
  return /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : null;
}

/** LAB/JJ → 랩실/JJ실. */
export function seatDisplayName(seatLabel: string | null | undefined): string | null {
  const key = seatKeyOf(seatLabel);
  return key ? SEAT_NAME[key] : null;
}

/**
 * 출결 달력 칸의 배지 — `출석 초등M 개별 JJ1F 17:00`.
 *
 * 🔴 종전엔 `slot ?? className`이라 **교시가 있는 행은 반 이름이 통째로 사라졌다**(원장 제보 2026-09-07
 *    *"수업명이 보이지 않고 출결되는거 왜 그런지 원인 파악"*). 같은 달력에 `출석 초등M 개별 JJ1F`와
 *    `출석 17:00`이 섞여 보이던 게 이 한 줄 때문이다 — 교시(slot_start)를 쓰는 반(영어·자리)만 이름을
 *    잃었다. 칸이 좁아 하나만 적으려던 것으로 보이는데, **사라져야 할 쪽은 이름이 아니다**:
 *    "몇 시에 왔나"보다 "어느 수업이었나"가 먼저다(시각은 반이 이미 요일·교시로 정해 준다).
 * ⚠️ 칸은 여전히 좁다 → 넘치면 `truncate`가 자르고, 전문은 호버가 갚는다 — **사유가 있으면 메모 카드**
 *    (`attendanceHoverProps`), 없을 때만 `attendanceRecordTitle` 기본 툴팁이다(2026-09-15 메모 툴팁 = 카드).
 *    🔴 사유를 `title`로 되돌리지 말 것 — 가드 `tip-wiring.test.ts`가 잡는다.
 */
export function attendanceBadgeText(r: AttendanceRecordLike): string {
  return [
    attendanceStatusLabel(r.status),
    r.className,
    formatSlotStart(r.slotStart),
    seatDisplayName(r.seatLabel),
    r.reporter,
  ]
    .filter(Boolean)
    .join(" ");
}

export function attendanceRecordTitle(r: AttendanceRecordLike): string {
  return [
    attendanceStatusLabel(r.status),
    r.className,
    formatSlotStart(r.slotStart),
    seatDisplayName(r.seatLabel),
    // 배지는 좁아 잘리니 툴팁엔 누가 썼는지 말까지 붙인다(이름만 있으면 무엇인지 모른다).
    r.reporter ? `보고서 ${r.reporter}` : null,
    r.note,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function buildAttendanceClassOptions(
  enrollments: readonly { classId: string; className: string; subject: string; startDate: string; endDate: string | null; isTransferred?: boolean }[],
  today: string,
): AttendanceClassOption[] {
  const map = new Map<string, AttendanceClassOption>();
  for (const e of enrollments) {
    // 현재 수강 명단만 선택지에 둔다. 과거 출결 기록은 별도로 모두 조회·표시한다.
    if (!isEnrollmentOnRosterOn(e, today)) continue;
    if (e.classId) map.set(e.classId, { value: e.classId, label: e.className, subject: e.subject });
  }
  return [...map.values()];
}

/** 학생에게 있는 과목만. 라벨은 학원설정 labelOf. */
export function subjectFilterOptions(
  keys: readonly string[],
  labelOf: (key: string) => string,
): { value: string; label: string }[] {
  const unique = [...new Set(keys.filter((k) => k && k !== "?"))];
  unique.sort((a, b) => labelOf(a).localeCompare(labelOf(b), "ko"));
  return [{ value: "all", label: "전체 과목" }, ...unique.map((k) => ({ value: k, label: labelOf(k) }))];
}

export function classesForSubject(
  classes: AttendanceClassOption[],
  subject: string,
): { value: string; label: string }[] {
  const src = subject === "all" ? classes : classes.filter((c) => c.subject === subject);
  return src.map(({ value, label }) => ({ value, label }));
}

/** 고른 반이 지금 과목 목록에 없으면 전체. */
export function effectiveClassFilter(classId: string, options: { value: string }[]): string {
  if (classId === "all") return "all";
  return options.some((o) => o.value === classId) ? classId : "all";
}

export function filterAttendanceRecords<T extends AttendanceRecordLike>(
  records: T[],
  opts: { subject: string; classId: string; ym: string },
): T[] {
  return records.filter((r) => {
    if (opts.subject !== "all" && r.subject !== opts.subject) return false;
    if (opts.classId !== "all" && r.classId !== opts.classId) return false;
    if (opts.ym && ymOf(r.date) !== opts.ym) return false;
    return true;
  });
}

export type AttendanceMonthStats = {
  present: number;
  absent: number;
  late: number;
  excused: number;
  early_leave: number;
  makeup: number;
  total: number;
  rate: number;
};

/** 출석률 = (출석+지각)/전건 — 보강은 출석이 아니다(원장 2026-09-28, 공용 `attendedCount`). */
export function computeAttendanceStats(records: { status: string }[]): AttendanceMonthStats {
  const c = { present: 0, absent: 0, late: 0, excused: 0, early_leave: 0, makeup: 0 };
  for (const r of records) {
    if (r.status in c) c[r.status as keyof typeof c]++;
  }
  const total = records.length;
  const rate = Math.round(attendanceRate(attendedCount(c), total) * 10) / 10;
  return { ...c, total, rate };
}

function compareSlot(a: { slotStart: string | null }, b: { slotStart: string | null }): number {
  if (!a.slotStart && !b.slotStart) return 0;
  if (!a.slotStart) return -1;
  if (!b.slotStart) return 1;
  return a.slotStart.localeCompare(b.slotStart);
}

export function groupRecordsByDay<T extends AttendanceRecordLike>(records: T[]): Map<number, T[]> {
  const m = new Map<number, T[]>();
  for (const r of records) {
    const d = Number(r.date.slice(8, 10));
    if (!Number.isFinite(d)) continue;
    const list = m.get(d) ?? [];
    list.push(r);
    m.set(d, list);
  }
  for (const list of m.values()) list.sort(compareSlot);
  return m;
}

export function groupRecordsByDate<T extends AttendanceRecordLike>(records: T[]): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const r of records) {
    const list = m.get(r.date) ?? [];
    list.push(r);
    m.set(r.date, list);
  }
  for (const list of m.values()) list.sort(compareSlot);
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
}

export function monthCells(year: number, month: number): (number | null)[] {
  const firstDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = Array.from({ length: firstDow }, () => null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  return cells;
}

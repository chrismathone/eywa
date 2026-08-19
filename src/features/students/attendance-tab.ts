// 학생 상세 출결 탭 — 라벨·필터·달력 배치(순수). 과목 라벨은 학원설정 labelOf.
import { seatKeyOf, SEAT_NAME } from "@/features/attendance/seat/seat";
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

export function attendanceBadgeText(r: AttendanceRecordLike): string {
  const slot = formatSlotStart(r.slotStart);
  return [attendanceStatusLabel(r.status), slot ?? r.className, seatDisplayName(r.seatLabel)]
    .filter(Boolean)
    .join(" ");
}

export function attendanceRecordTitle(r: AttendanceRecordLike): string {
  return [attendanceStatusLabel(r.status), r.className, formatSlotStart(r.slotStart), seatDisplayName(r.seatLabel), r.note]
    .filter(Boolean)
    .join(" · ");
}

export function buildAttendanceClassOptions(
  enrollments: { classId: string; className: string; subject: string }[],
  records: { classId: string; className: string; subject: string }[],
): AttendanceClassOption[] {
  const map = new Map<string, AttendanceClassOption>();
  for (const e of enrollments) {
    if (e.classId) map.set(e.classId, { value: e.classId, label: e.className, subject: e.subject });
  }
  for (const r of records) {
    if (r.classId && !map.has(r.classId)) {
      map.set(r.classId, { value: r.classId, label: r.className, subject: r.subject });
    }
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

/** 출석률 = (출석+지각+보강)/전건. */
export function computeAttendanceStats(records: { status: string }[]): AttendanceMonthStats {
  const c = { present: 0, absent: 0, late: 0, excused: 0, early_leave: 0, makeup: 0 };
  for (const r of records) {
    if (r.status in c) c[r.status as keyof typeof c]++;
  }
  const total = records.length;
  const rate = total > 0 ? Math.round(((c.present + c.late + c.makeup) / total) * 1000) / 10 : 0;
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

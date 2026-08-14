/**
 * 자리 월간 출석부 — 순수 규칙(서버·클라 공용, IO 없음).
 *
 * 축은 반 그룹 × 학생 × 날짜. 시수는 **확정**(seat_label=자리)과 **확인 필요**(라벨 없이
 * 그날 살아있는 자리 슬롯과 시각이 맞는 행)를 **절대 합치지 않는다**(담임 정산에 남은 옛 기록).
 */
import { COUNTABLE_STATUSES } from "@/features/attendance/session-units";
import { DOW_KEYS, dowIndexOf } from "@/features/attendance/calendar";
import { specialSlotLabel, type SpecialSlotLabel } from "@/features/timetable/lib/teacher-label";
import { hhmm } from "./seat";

export type SeatMonthDay = {
  date: string;
  day: number;
  dow: number;
  label: string;
  isWeekend: boolean;
  isToday: boolean;
  placeholder?: boolean;
};

export type SeatSlotDef = {
  classId: string;
  dayOfWeek: string;
  start: string;
  end: string;
  validFrom: string | null;
  validTo: string | null;
};

export type SeatAttRecord = {
  id: string;
  classId: string;
  studentId: string;
  date: string;
  slotStart: string | null;
  status: string;
  seatLabel: string | null;
  sessionUnits: number | null;
};

export type SeatTrack = "confirmed" | "review";

const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

export function isSlotLiveOnDate(slot: SeatSlotDef, date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const dow = DOW_KEYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  if (slot.dayOfWeek !== dow) return false;
  const from = slot.validFrom ? slot.validFrom.slice(0, 10) : null;
  const to = slot.validTo ? slot.validTo.slice(0, 10) : null;
  if (from && from > date) return false;
  if (to && to < date) return false;
  return true;
}

/** 자리 라벨이 붙은 기록 = 확정. 라벨 없이 그날 산 자리 슬롯과 시각이 같으면 확인 필요. 그 외는 이 표 밖. */
export function classifySeatRecord(
  rec: Pick<SeatAttRecord, "seatLabel" | "classId" | "date" | "slotStart">,
  liveSlots: readonly SeatSlotDef[],
  wantLabel: SpecialSlotLabel,
): SeatTrack | null {
  if (rec.seatLabel?.trim()) {
    return specialSlotLabel(rec.seatLabel) === wantLabel ? "confirmed" : null;
  }
  const start = hhmm(rec.slotStart);
  if (!start) return null;
  const hit = liveSlots.some(
    (s) => s.classId === rec.classId && hhmm(s.start) === start && isSlotLiveOnDate(s, rec.date),
  );
  return hit ? "review" : null;
}

export function firstSlotStart(slots: readonly SeatSlotDef[], classId: string): string {
  const starts = slots.filter((s) => s.classId === classId).map((s) => hhmm(s.start)).filter(Boolean);
  return starts.sort((a, b) => a.localeCompare(b))[0] ?? "99:99";
}

export function sortClassIdsByFirstSlot(classIds: readonly string[], slots: readonly SeatSlotDef[]): string[] {
  return [...classIds].sort((a, b) => {
    const sa = firstSlotStart(slots, a);
    const sb = firstSlotStart(slots, b);
    return sa.localeCompare(sb) || a.localeCompare(b);
  });
}

/** "화 16:20 · 수 16:20·17:00" — 하루 흐름. labelOf가 있으면 시각 대신 교시 이름. */
export function formatSeatSchedule(
  slots: readonly SeatSlotDef[],
  classId: string,
  labelOf?: (start: string, end: string) => string,
): string {
  const byDow = new Map<number, string[]>();
  for (const s of slots) {
    if (s.classId !== classId) continue;
    const i = dowIndexOf(s.dayOfWeek);
    if (i < 0) continue;
    const label = labelOf?.(hhmm(s.start), hhmm(s.end)) || hhmm(s.start);
    if (!label) continue;
    const list = byDow.get(i) ?? [];
    if (!list.includes(label)) list.push(label);
    byDow.set(i, list);
  }
  return [...byDow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([dow, labels]) => `${DOW_KO[dow]} ${labels.join("·")}`)
    .join(" · ");
}

export function minutesBetween(start: string, end: string): number | null {
  const a = toMin(hhmm(start));
  const b = toMin(hhmm(end));
  if (a == null || b == null || b <= a) return null;
  return b - a;
}

/** 전 슬롯 길이가 같을 때만 그 분. 섞이면 null(JJ실처럼 40·50·60이 공존하면 환산이 거짓). */
export function commonSlotMinutes(slots: readonly Pick<SeatSlotDef, "start" | "end">[]): number | null {
  if (slots.length === 0) return null;
  const set = new Set<number>();
  for (const s of slots) {
    const m = minutesBetween(s.start, s.end);
    if (m == null) return null;
    set.add(m);
  }
  return set.size === 1 ? [...set][0]! : null;
}

export function sumTrackUnits(recs: readonly { status: string; sessionUnits: number | null }[]): number {
  let u = 0;
  for (const r of recs) {
    if (COUNTABLE_STATUSES.has(r.status)) u += r.sessionUnits ?? 1;
  }
  return Math.round(u * 10) / 10;
}

export function buildMonthDays(startIso: string, endIso: string, todayIso: string): SeatMonthDay[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startIso) || !/^\d{4}-\d{2}-\d{2}$/.test(endIso) || startIso > endIso) {
    return [];
  }
  const days: SeatMonthDay[] = [];
  const cur = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  for (let guard = 0; cur <= end && guard < 400; guard++) {
    const date = cur.toISOString().slice(0, 10);
    const dow = cur.getUTCDay();
    days.push({
      date,
      day: cur.getUTCDate(),
      dow,
      label: DOW_KO[dow] ?? "",
      isWeekend: dow === 0 || dow === 6,
      isToday: date === todayIso,
    });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

/** 기존 31칸 패딩 규약 — 28/30일 달도 출석률 열 위치가 안 움직이게. */
export function padDaysTo31(days: readonly SeatMonthDay[]): SeatMonthDay[] {
  if (days.length >= 31) return [...days];
  const out = [...days];
  for (let n = days.length + 1; n <= 31; n++) {
    out.push({ date: `pad-${n}`, day: n, dow: -1, label: "", isWeekend: false, isToday: false, placeholder: true });
  }
  return out;
}

function toMin(hm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

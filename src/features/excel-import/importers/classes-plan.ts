/**
 * 반 가져오기의 **순수** 판정(Vitest) — 날짜 더하기 · 요일 변환 · 시간표 교체 계획 · 등원 요일 정규화.
 * DB·엑셀을 모른다. `classes.ts`가 읽은 행을 이 함수들에 넘긴다.
 */

export const DOW_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type DowKey = (typeof DOW_KEYS)[number];
/** 요일 순서(월→일) — 등원 요일 배열의 정렬 기준(assign-helpers DAY_ORDER와 같은 순서). */
export const DOW_ORDER: readonly DowKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const DOW_LABEL: Record<DowKey, string> = { sun: "일", mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토" };

/** `parseWeekday`(0=일 … 6=토) → DB enum. */
export function dowKeyOf(idx: number): DowKey {
  return DOW_KEYS[idx] ?? "mon";
}

/** `YYYY-MM-DD` + n일(UTC 성분만 — 시간대 무관). */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 슬롯 비교용 모양 — **실효값**(칸 override ?? 반 기본)으로 비교한다(같은 배치를 다시 올려도 이력이 쪼개지지 않게). */
export type SlotShape = {
  day: string;
  start: string;
  end: string;
  teacher: string | null;
  room: string | null;
  teacherLabel: string | null;
  roomLabel: string | null;
};

export const slotKey = (s: Pick<SlotShape, "day" | "start">) => `${s.day}|${s.start}`;
const shapeKey = (s: SlotShape) => [s.day, s.start, s.end, s.teacher ?? "", s.room ?? "", s.teacherLabel ?? "", s.roomLabel ?? ""].join("|");

/** 두 시간표가 같은가(순서 무관 · 중복 개수까지). */
export function sameSchedule(a: readonly SlotShape[], b: readonly SlotShape[]): boolean {
  if (a.length !== b.length) return false;
  const count = new Map<string, number>();
  for (const s of a) count.set(shapeKey(s), (count.get(shapeKey(s)) ?? 0) + 1);
  for (const s of b) {
    const k = shapeKey(s);
    const n = count.get(k);
    if (!n) return false;
    count.set(k, n - 1);
  }
  return true;
}

export type ExistingSlotRow = { id: string; valid_from: string; valid_to: string | null };

/**
 * 적용 시작일 `start`부터 시간표를 바꿀 때 기존 행을 어떻게 할지 — 🔴 **행을 고쳐 쓰지 않고 구간을 닫는다**([[#88]]).
 *  · start 전에 끝나는 행: 그대로(이력)
 *  · start 이후에 시작하는 행(미래 예약 포함): 지움 — 그 구간은 파일의 시간표가 대신한다
 *  · start를 가로지르는 행: `valid_to = start 전날`로 닫음(이전 배치는 이력으로 남는다)
 */
export function planScheduleReplace(rows: readonly ExistingSlotRow[], start: string): { close: string[]; remove: string[] } {
  const close: string[] = [];
  const remove: string[] = [];
  for (const r of rows) {
    if (r.valid_to !== null && r.valid_to < start) continue;
    if (r.valid_from >= start) remove.push(r.id);
    else close.push(r.id);
  }
  return { close, remove };
}

/** `start`에 살아 있는 행인가(valid_from ≤ start ≤ valid_to, valid_to는 그날 포함). */
export function isLiveOn(r: { valid_from: string; valid_to: string | null }, day: string): boolean {
  return r.valid_from <= day && (r.valid_to === null || r.valid_to >= day);
}

/**
 * 등원 요일 정규화 — 반 운영 요일 안으로 좁히고 요일순. 비었거나 운영 요일을 전부 골랐으면 `[]`(= 전 요일 등원).
 * 한 명 배정(`normalizeAttendanceDays`)과 같은 규칙. 운영 요일을 모르면(시간표 없는 반) `[]`.
 * 반환 `outside` = 운영 요일이 아니라서 뺀 요일(오류로 알리는 데 쓴다).
 */
export function normalizeDays(picked: readonly DowKey[], classDays: ReadonlySet<string>): { days: DowKey[]; outside: DowKey[] } {
  if (picked.length === 0 || classDays.size === 0) return { days: [], outside: [] };
  const outside = picked.filter((d) => !classDays.has(d));
  const within = picked.filter((d) => classDays.has(d));
  if (within.length === 0 || new Set(within).size >= classDays.size) return { days: [], outside };
  return { days: DOW_ORDER.filter((d) => within.includes(d)), outside };
}

/** GiST와 같은 반열림 겹침(`[start,end)`) — enrollmentPeriodsOverlap과 같은 규약. */
export function periodsOverlap(aStart: string, aEnd: string | null, bStart: string, bEnd: string | null): boolean {
  return (!aEnd || bStart < aEnd) && (!bEnd || aStart < bEnd);
}

// ── 충돌 검사(시간표) ─────────────────────────────────────────────────────────────
/**
 * 적용 뒤 한 날의 배치(목표 배치) 한 칸 — **실효값**(칸 값 ?? 반 기본)으로. 자리(LAB·JJ) 칸은 강사·강의실을 null로 넘긴다
 * (여러 반이 같은 자리에 동시에 앉는 게 설계라 충돌이 아니다 — timetable/import/structure/conflicts.ts와 같은 규약).
 * `rowNum`이 있으면 이 파일이 넣는 칸(= 이번 변경이 건드린 칸)이다. 충돌은 **파일 칸이 낀 쌍만** 알린다.
 */
export type TargetSlot = {
  classId: string;
  day: string;
  start: string;
  end: string;
  teacherId: string | null;
  roomId: string | null;
  rowNum: number | null;
};

/** 시간표 가져오기 충돌 체크리스트와 같은 네 종류 — `merged`(같은 강사·같은 방 = 합반)만 적용을 막지 않는다. */
export type SlotConflictKind = "teacher" | "room" | "duplicate" | "merged";
export type SlotConflict = { kind: SlotConflictKind; a: TargetSlot; b: TargetSlot };

const minutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const timesOverlap = (a: TargetSlot, b: TargetSlot) => minutes(a.start) < minutes(b.end) && minutes(b.start) < minutes(a.end);

/**
 * 한 날의 목표 배치에서 충돌 찾기(요일·시각이 겹치는 쌍만):
 *  · duplicate — 같은 반이 같은 요일에 겹치는 두 칸
 *  · teacher   — 같은 강사가 다른 두 반에, 방이 서로 다름(둘 다 알 때)
 *  · room      — 같은 방을 다른 두 반이, 강사가 서로 다름(둘 다 알 때)
 *  · merged    — 같은 강사·같은 방(합반으로 보임) — 경고만
 * ⚠️ 방이나 강사를 모르는 쪽이 있으면 "다르다"고 단정하지 않는다(합반일 수 있다) — 같은 강사면 merged로 알린다.
 */
export function detectSlotConflicts(slots: readonly TargetSlot[]): SlotConflict[] {
  const out: SlotConflict[] = [];
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i]!;
      const b = slots[j]!;
      if (a.rowNum === null && b.rowNum === null) continue;
      if (a.day !== b.day || !timesOverlap(a, b)) continue;
      if (a.classId === b.classId) {
        out.push({ kind: "duplicate", a, b });
        continue;
      }
      const sameTeacher = !!a.teacherId && a.teacherId === b.teacherId;
      const sameRoom = !!a.roomId && a.roomId === b.roomId;
      if (sameTeacher) {
        out.push({ kind: a.roomId && b.roomId && !sameRoom ? "teacher" : "merged", a, b });
      } else if (sameRoom && a.teacherId && b.teacherId) {
        out.push({ kind: "room", a, b });
      }
    }
  }
  return out;
}

/**
 * 데스크 좌석표 — **학생축**(순수, Vitest).
 *
 * 원장(2026-08-14 정정): *"그냥 그 반의 오늘 날짜에 이 학생이 수업했냐 안했냐만 체크하는 단순한 알림판."*
 * 칸 = 반 × 학생 × 오늘 **하나**. 연강 2~3교시도 섹션 하나·칸 하나.
 * 섹션 순서 = 오늘 첫 교시 시작시각(시간을 훑는 건 유지).
 *
 * 읽기: 교시 무시, (반·학생·오늘)에 기록이 있으면 그 상태. 여러 행이면 recorded_at 최신.
 * 쓰기 슬롯은 호출부가 slot-axis를 따른다(수학=null, 영어=첫 교시). 기존 행이 있으면 그 행의 교시를 쓴다.
 */
import { seatMarkOf, type SeatMark } from "./mark-state";
import { saveSlotFor } from "./slot-axis";
import type { LiveBoardSlot, LiveStudent } from "./types";

export type SeatingStudent = LiveStudent & {
  mark: SeatMark;
  /** setAttendanceCell.slotStart — 기존 행이면 그 교시, 없으면 과목 축의 신규 값. */
  writeSlot: string | null;
};

export type SeatingClass = {
  classId: string;
  className: string;
  subject: string;
  teacherName: string | null;
  /** 오늘 첫 살아있는 교시 — 표시·10분 판정·영어 신규 저장. */
  firstStart: string;
  firstEnd: string | null;
  periodLabel: string | null;
  phase: LiveBoardSlot["phase"];
  ownedByMe: boolean;
  students: SeatingStudent[];
};

export type SeatingSummary = {
  unmarked: number;
  absent: number;
  recorded: number;
  expected: number;
};

type DayHit = {
  status: string | null;
  note: string | null;
  recordedAt: string | null;
  recordSlot: string | null;
};

/** 같은 (반·학생·오늘)의 여러 교시 행 중 **최신** 하나. 기록 없으면 null. */
export function pickClassDayHit(hits: readonly DayHit[]): DayHit | null {
  let best: DayHit | null = null;
  for (const h of hits) {
    if (h.status == null) continue;
    if (!best) {
      best = h;
      continue;
    }
    const a = h.recordedAt ?? "";
    const b = best.recordedAt ?? "";
    if (a > b) best = h;
  }
  return best;
}

export function foldSeating(slots: readonly LiveBoardSlot[]): SeatingClass[] {
  const byClass = new Map<string, LiveBoardSlot[]>();
  for (const slot of slots) {
    (byClass.get(slot.classId) ?? byClass.set(slot.classId, []).get(slot.classId)!).push(slot);
  }
  const out: SeatingClass[] = [];
  for (const list of byClass.values()) {
    const ordered = [...list].sort((a, b) => (a.slotStart < b.slotStart ? -1 : 1));
    const first = ordered[0];
    if (!first) continue;
    const roster = new Map<string, LiveStudent>();
    for (const slot of ordered) {
      for (const s of slot.students) roster.set(s.studentId, s);
    }
    const students: SeatingStudent[] = [...roster.values()]
      .map((base) => {
        const hit = pickClassDayHit(
          ordered.map((slot) => {
            const s = slot.students.find((x) => x.studentId === base.studentId);
            return {
              status: s?.status ?? null,
              note: s?.note ?? null,
              recordedAt: s?.recordedAt ?? null,
              recordSlot: s?.recordSlot ?? null,
            };
          }),
        );
        const status = hit?.status ?? null;
        return {
          ...base,
          status,
          note: hit?.note ?? base.note,
          recordSlot: hit?.recordSlot ?? null,
          recordedAt: hit?.recordedAt ?? null,
          mark: seatMarkOf(status, first.phase),
          writeSlot: hit ? (hit.recordSlot ?? null) : saveSlotFor(first.subject, first.slotStart),
        };
      })
      .sort((a, b) => a.studentName.localeCompare(b.studentName, "ko"));
    out.push({
      classId: first.classId,
      className: first.className,
      subject: first.subject,
      teacherName: first.teacherName,
      firstStart: first.slotStart,
      firstEnd: first.slotEnd,
      periodLabel: first.periodLabel,
      phase: first.phase,
      ownedByMe: first.ownedByMe,
      students,
    });
  }
  out.sort((a, b) =>
    a.firstStart === b.firstStart
      ? a.className.localeCompare(b.className, "ko")
      : a.firstStart < b.firstStart
        ? -1
        : 1,
  );
  return out;
}

/**
 * 이어지는 같은 반·같은 강사 교시를 한 카드로 접는다.
 * 예: 초등M 초4 BS1J 14:30~15:25 와 15:25~16:20 → 14:30~16:20 한 장.
 * 끝이 다음에 닿지 않으면(점심 전·후) 묶지 않는다.
 */
export function isAdjacentSlot(a: LiveBoardSlot, b: LiveBoardSlot): boolean {
  return (
    a.classId === b.classId &&
    a.teacherId === b.teacherId &&
    a.slotEnd != null &&
    a.slotEnd === b.slotStart
  );
}

function mergeAdjacentPair(a: LiveBoardSlot, b: LiveBoardSlot): LiveBoardSlot {
  const roster = new Map<string, LiveStudent>();
  for (const s of [...a.students, ...b.students]) roster.set(s.studentId, s);
  const students = [...roster.values()]
    .map((base) => {
      const hit = pickClassDayHit(
        [a, b].map((slot) => {
          const s = slot.students.find((x) => x.studentId === base.studentId);
          return {
            status: s?.status ?? null,
            note: s?.note ?? null,
            recordedAt: s?.recordedAt ?? null,
            recordSlot: s?.recordSlot ?? null,
          };
        }),
      );
      const status = hit?.status ?? null;
      return {
        ...base,
        status,
        note: hit?.note ?? base.note,
        recordSlot: hit?.recordSlot ?? null,
        recordedAt: hit?.recordedAt ?? null,
        signal: base.signal,
      };
    })
    .sort((x, y) => x.studentName.localeCompare(y.studentName, "ko"));
  return {
    ...a,
    slotEnd: b.slotEnd ?? a.slotEnd,
    // 뒤 교시가 시작됐으면 그 국면(앞이 종료여도 '진행 중'으로).
    phase: b.phase !== "before" ? b.phase : a.phase,
    students,
    recordedCount: students.filter((s) => s.status != null).length,
    hasAnyRecord: a.hasAnyRecord || b.hasAnyRecord,
    ownedByMe: a.ownedByMe || b.ownedByMe,
  };
}

export function groupAdjacentSlots(slots: readonly LiveBoardSlot[]): LiveBoardSlot[] {
  const ordered = [...slots].sort((a, b) =>
    a.slotStart === b.slotStart
      ? a.className.localeCompare(b.className, "ko")
      : a.slotStart < b.slotStart
        ? -1
        : 1,
  );
  const out: LiveBoardSlot[] = [];
  for (const slot of ordered) {
    const prev = out[out.length - 1];
    if (prev && isAdjacentSlot(prev, slot)) out[out.length - 1] = mergeAdjacentPair(prev, slot);
    else out.push(slot);
  }
  return out;
}

export function seatingSummary(classes: readonly SeatingClass[]): SeatingSummary {
  let unmarked = 0;
  let absent = 0;
  let recorded = 0;
  let expected = 0;
  for (const c of classes) {
    for (const s of c.students) {
      expected += 1;
      if (s.status != null) recorded += 1;
      if (s.mark === "unmarked") unmarked += 1;
      if (s.mark === "absent") absent += 1;
    }
  }
  return { unmarked, absent, recorded, expected };
}

/**
 * 데스크 좌석표 — **학생축**(순수, Vitest).
 *
 * 원장(2026-08-14 정정): *"그냥 그 반의 오늘 날짜에 이 학생이 수업했냐 안했냐만 체크하는 단순한 알림판."*
 * 칸 = 반 × 학생 × 오늘 **하나**. 연강 2~3교시도 섹션 하나·칸 하나.
 * 섹션 순서 = 오늘 첫 교시 시작시각(시간을 훑는 건 유지).
 *
 * 읽기: 교시 무시, (반·학생·오늘)에 기록이 있으면 그 상태. 여러 행이면 recorded_at 최신.
 * 쓰기 슬롯은 호출부가 slot-axis를 따른다(수학=null, 영어=첫 교시). 기존 행이 있으면 그 행의 교시를 쓴다.
 *
 * 🔴 **칸이 하루 하나라고 해서 하루치를 한 화면에 동시에 펼치는 건 다른 얘기다**(원장 2026-08-18:
 *    *"1개의 수업에 대해서만 수업인데 마치 전부 수업하는 것처럼"*). 카드마다 [`NowBand`](./now-band.ts)를
 *    들려 보내 화면이 지금/예정/지난으로 나눠 그린다 — **거르는 게 아니라 나누는 것**이다([[#105]]).
 */
import { specialSlotLabel, type SpecialSlotLabel } from "@/features/timetable/lib/teacher-label";
import { seatMarkOf, type SeatMark } from "./mark-state";
import { foldNowBands, type NowBand } from "./now-band";
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
  /** 오늘 첫 교시가 열리는 강의실 — 층 묶음 근거. */
  roomName: string | null;
  /** 오늘 첫 살아있는 교시 — 표시·10분 판정·영어 신규 저장. */
  firstStart: string;
  firstEnd: string | null;
  periodLabel: string | null;
  /** LAB·JJ — 같은 시각에 여러 반이 한 방을 쓴다. 일반 4열과 다른 묶음의 근거. */
  seatLabel: SpecialSlotLabel | null;
  phase: LiveBoardSlot["phase"];
  /**
   * 이 반이 **지금 열려 있나** — 교시 하나라도 열려 있으면 '지금'(`foldNowBands`).
   * 🔑 `phase`(첫 교시의 유예 국면)와 다르다: phase는 "빈 칸을 큐에 올릴 때가 됐나", band는 "지금 하나".
   */
  band: NowBand;
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
      teacherName: first.teacherName ?? first.slotTeacherLabel,
      roomName: ordered.find((s) => s.roomName)?.roomName ?? first.roomName,
      firstStart: first.slotStart,
      firstEnd: spanAdjacentEnd(ordered),
      band: foldNowBands(ordered.map((s) => s.band)),
      periodLabel: first.periodLabel,
      seatLabel: specialSlotLabel(first.slotTeacherLabel),
      // 헤더 색·대기/미출결은 카드에 적힌 첫 시각 기준. 뒤 교시는 더 늦다.
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
 * 첫 교시부터 끝이 다음에 닿는 동안의 종료시각 — **다만 같은 방에 있는 동안만**.
 * BS4F 20:10~21:05 + 21:05~22:00 → 22:00. 점심으로 끊기면 앞 블록만.
 *
 * 🔴 방이 바뀌면 끊는다. 카드는 **한 강의실 아래**에 놓이는데 종료시각만 계속 이어 붙이면 그 방에
 *    있지도 않은 시간을 그 방의 수업인 양 적는다 — 실측(화요일 본원602): DP6는 14:20~15:00만 602이고
 *    15:00~15:40은 랩실인데 카드가 `14:20~15:40`이라 적혀, 같은 방 LS6(15:00~17:00)와 **겹쳐 보였다**.
 *    그래서 한 강사가 한 방에서 세 반을 동시에 가르치는 그림이 됐다(같은 요일 실측 4쌍, 목 3·금 3·수 1).
 *    슬롯이 겹치는 일은 실제로 없다 — 겹침은 전부 이 이어붙이기가 만든 것이었다.
 * ⚠️ 자리(LAB·JJ) 표기도 방과 같이 본다 — 같은 호수라도 자리 수업은 담당이 다른 별개의 칸이다.
 */
export function spanAdjacentEnd(
  ordered: readonly {
    slotStart: string;
    slotEnd: string | null;
    roomName?: string | null;
    slotTeacherLabel?: string | null;
  }[],
): string | null {
  const first = ordered[0];
  if (!first) return null;
  const sameRoom = (a: (typeof ordered)[number], b: (typeof ordered)[number]) =>
    (a.roomName ?? null) === (b.roomName ?? null) &&
    specialSlotLabel(a.slotTeacherLabel ?? null) === specialSlotLabel(b.slotTeacherLabel ?? null);
  let end = first.slotEnd;
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]!;
    const next = ordered[i]!;
    if (prev.slotEnd == null || prev.slotEnd !== next.slotStart) break;
    if (!sameRoom(prev, next)) break;
    end = next.slotEnd;
  }
  return end;
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
    // 저장 축이 같아야 한 칸이다. 수학 연강(둘 다 null)만 묶고,
    // 영어 연속 교시(14:30 / 15:25 = 다른 행·다른 교재)는 묶지 않는다.
    a.saveSlot === b.saveSlot &&
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
    band: foldNowBands([a.band, b.band]),
    students,
    recordedCount: students.filter((s) => s.status != null).length,
    hasAnyRecord: a.hasAnyRecord || b.hasAnyRecord,
    ownedByMe: a.ownedByMe || b.ownedByMe,
  };
}

export function groupAdjacentSlots(slots: readonly LiveBoardSlot[]): LiveBoardSlot[] {
  // 반+강사별로 먼저 모은 뒤 잇는다. 시각 순으로만 훑으면 사이에 다른 반이
  // 끼는 순간(14:30 A, 14:40 B, 15:25 A) 연강 A가 안 붙는다.
  const byKey = new Map<string, LiveBoardSlot[]>();
  for (const slot of slots) {
    const key = `${slot.teacherId ?? ""}|${slot.classId}`;
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(slot);
  }
  const out: LiveBoardSlot[] = [];
  for (const group of byKey.values()) {
    const ordered = [...group].sort((a, b) => (a.slotStart < b.slotStart ? -1 : 1));
    const merged: LiveBoardSlot[] = [];
    for (const slot of ordered) {
      const prev = merged[merged.length - 1];
      if (prev && isAdjacentSlot(prev, slot)) merged[merged.length - 1] = mergeAdjacentPair(prev, slot);
      else merged.push(slot);
    }
    out.push(...merged);
  }
  out.sort((a, b) =>
    a.slotStart === b.slotStart
      ? a.className.localeCompare(b.className, "ko")
      : a.slotStart < b.slotStart
        ? -1
        : 1,
  );
  return out;
}

/**
 * 한 강의실 가로 칸 수. 수학 4교시와 같다.
 * 수업이 2~3개여도 이 폭을 유지하고, 학생은 칸 안에서 다음 줄로 간다.
 */
export const SEATING_PERIOD_COLS = 4;

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

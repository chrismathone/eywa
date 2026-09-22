// 강의실 자동배정 — 순수 함수(클라가 즉시 미리보기로 import. ⚠️ server-only 금지, [[#61]]).
//
// ijw ClassroomAssignment(useAutoAssignAlgorithm.ts) 경량 이식. ijw는 강의실에 층·건물·선호과목
// 메타가 있어 5축(과목-층 적합도·수용·강사동선·균등분산·학년그룹핑)으로 점수를 매겼지만, aywa
// classrooms는 name·capacity만 있어(메타 부재) **aywa가 실제로 지원하는 3축만** 쓴다:
//   ① 시간충돌 회피(같은 강의실 동시간 금지) ② 수용인원 적합 ③ 균등분산 + 기존배정 유지(안정성).
// 과목-층/강사동선/학년그룹핑은 강의실 메타가 생기면 확장(스키마 한계라 의도적 제외 — 가짜 점수 안 만듦).
//
// 배정 단위 = 반(classes.classroom_id). aywa 데모/UI가 반 기본 강의실로 동작하므로 슬롯별(slotRoom)
// 배정은 미이식(데모 경량판). 같은 강의실을 쓰는 두 반은 어느 슬롯도 시간이 안 겹쳐야 한다.

export type AssignSlot = { day: string; start: string; end: string }; // HH:MM

export type AssignClass = {
  id: string;
  className: string;
  subject: string;
  studentCount: number;
  currentRoomId: string | null;
  slots: AssignSlot[];
};

export type AssignRoom = { id: string; name: string; capacity: number | null };

/** 페이지/액션/클라가 공유하는 자동배정 입력 데이터(쿼리 반환형). */
export type ClassroomAssignData = { classes: AssignClass[]; rooms: AssignRoom[] };

export type AssignOptions = {
  respectCapacity: boolean; // 수용인원 초과 금지
  keepExisting: boolean; // 기존 배정 유지 우선(안정성 보너스 — 불필요한 이동 억제)
};

export const DEFAULT_ASSIGN_OPTIONS: AssignOptions = {
  respectCapacity: true,
  keepExisting: true,
};

export type Assignment = {
  classId: string;
  className: string;
  studentCount: number;
  fromRoomId: string | null;
  fromRoomName: string | null;
  toRoomId: string;
  toRoomName: string;
  changed: boolean; // toRoomId !== fromRoomId
};

export type Unassigned = { classId: string; className: string; studentCount: number; reason: string };

export type RoomConflict = {
  roomId: string;
  roomName: string;
  classNames: [string, string];
  day: string;
};

export type AssignResult = {
  assignments: Assignment[];
  unassigned: Unassigned[];
  conflictsBefore: RoomConflict[]; // 배정 전 현재 상태의 같은 강의실 시간겹침
};

const DAY_LABEL: Record<string, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => Number(x) || 0);
  return h * 60 + m;
}

/** 같은 요일에 두 슬롯 시간이 겹치는가. */
function slotsOverlap(a: AssignSlot, b: AssignSlot): { overlap: boolean; day: string } {
  if (a.day !== b.day) return { overlap: false, day: a.day };
  const overlap = toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);
  return { overlap, day: a.day };
}

/** 두 반의 슬롯 중 하나라도 시간이 겹치면 같은 강의실 불가. 겹친 요일도 반환. */
function classesConflict(a: AssignClass, b: AssignClass): { conflict: boolean; day: string | null } {
  for (const sa of a.slots) {
    for (const sb of b.slots) {
      const { overlap, day } = slotsOverlap(sa, sb);
      if (overlap) return { conflict: true, day };
    }
  }
  return { conflict: false, day: null };
}

/** 수용인원 적합 점수(0~10) — 활용률 70~100%가 최적, 너무 큰 방은 낭비라 감점. capacity 미설정은 중립 5. */
function capacityScore(studentCount: number, capacity: number | null): number {
  if (capacity == null || capacity <= 0) return 5;
  const util = studentCount / capacity;
  if (util >= 0.7) return 10;
  if (util >= 0.5) return 7;
  if (util >= 0.3) return 4;
  return 1;
}

/** 균등분산 점수 — 이미 배정된 반이 적은 강의실 선호. */
function distributionScore(load: number): number {
  if (load === 0) return 10;
  if (load <= 2) return 6;
  if (load <= 4) return 2;
  return -(load - 4) * 2;
}

/**
 * 그리디 배정. 제약이 많은 반(수용 가능한 강의실이 적은·학생 많은)을 먼저 배정하고,
 * 각 반마다 시간충돌 없는 후보 중 최고 점수 강의실을 결정적으로 고른다.
 */
export function autoAssignClassrooms(
  classes: AssignClass[],
  rooms: AssignRoom[],
  options: AssignOptions = DEFAULT_ASSIGN_OPTIONS,
): AssignResult {
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const occupancy = new Map<string, AssignClass[]>();
  for (const r of rooms) occupancy.set(r.id, []);

  const fitsCapacity = (c: AssignClass, r: AssignRoom) =>
    !options.respectCapacity || r.capacity == null || c.studentCount <= r.capacity;

  // 정렬: 수용 가능한 강의실이 적은 반(제약 큼) 먼저 → 학생 많은 순 → 이름/ id(결정적).
  const sorted = [...classes].sort((a, b) => {
    const fa = rooms.filter((r) => fitsCapacity(a, r)).length;
    const fb = rooms.filter((r) => fitsCapacity(b, r)).length;
    if (fa !== fb) return fa - fb;
    if (a.studentCount !== b.studentCount) return b.studentCount - a.studentCount;
    return a.className.localeCompare(b.className, "ko") || a.id.localeCompare(b.id);
  });

  const assignments: Assignment[] = [];
  const unassigned: Unassigned[] = [];

  for (const c of sorted) {
    const candidates = rooms.filter((r) => {
      if (!fitsCapacity(c, r)) return false;
      const here = occupancy.get(r.id) ?? [];
      return here.every((other) => !classesConflict(c, other).conflict);
    });

    if (candidates.length === 0) {
      const noCapacity = rooms.filter((r) => fitsCapacity(c, r)).length === 0;
      const reason =
        rooms.length === 0
          ? "등록된 강의실 없음"
          : noCapacity
            ? `수용 인원(${c.studentCount}명) 가능한 강의실 없음`
            : "동시간대 빈 강의실 없음";
      unassigned.push({ classId: c.id, className: c.className, studentCount: c.studentCount, reason });
      continue;
    }

    const scored = candidates
      .map((r) => {
        let score = capacityScore(c.studentCount, r.capacity);
        score += distributionScore((occupancy.get(r.id) ?? []).length) * 0.6;
        if (options.keepExisting && r.id === c.currentRoomId) score += 8;
        return { r, score };
      })
      .sort((x, y) => {
        if (y.score !== x.score) return y.score - x.score;
        // 동점: 현재 강의실 우선 → 이름 → id (결정적).
        const xc = x.r.id === c.currentRoomId ? 0 : 1;
        const yc = y.r.id === c.currentRoomId ? 0 : 1;
        if (xc !== yc) return xc - yc;
        return x.r.name.localeCompare(y.r.name, "ko") || x.r.id.localeCompare(y.r.id);
      });

    const best = scored[0].r;
    occupancy.get(best.id)!.push(c);
    const from = c.currentRoomId ? (roomById.get(c.currentRoomId) ?? null) : null;
    assignments.push({
      classId: c.id,
      className: c.className,
      studentCount: c.studentCount,
      fromRoomId: c.currentRoomId,
      fromRoomName: from?.name ?? null,
      toRoomId: best.id,
      toRoomName: best.name,
      changed: best.id !== c.currentRoomId,
    });
  }

  // 정렬: 표시 안정화(변경분 먼저, 이름순).
  assignments.sort(
    (a, b) =>
      Number(b.changed) - Number(a.changed) || a.className.localeCompare(b.className, "ko"),
  );

  return {
    assignments,
    unassigned,
    conflictsBefore: detectRoomConflicts(classes, rooms),
  };
}

/** 현재(배정 전) 상태에서 같은 강의실에 시간이 겹치는 반 쌍을 찾는다(중복 없이). */
export function detectRoomConflicts(classes: AssignClass[], rooms: AssignRoom[]): RoomConflict[] {
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const byRoom = new Map<string, AssignClass[]>();
  for (const c of classes) {
    if (!c.currentRoomId) continue;
    const arr = byRoom.get(c.currentRoomId) ?? [];
    arr.push(c);
    byRoom.set(c.currentRoomId, arr);
  }
  const conflicts: RoomConflict[] = [];
  for (const [roomId, list] of byRoom) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const { conflict, day } = classesConflict(list[i], list[j]);
        if (conflict) {
          conflicts.push({
            roomId,
            roomName: roomName.get(roomId) ?? roomId,
            classNames: [list[i].className, list[j].className],
            day: DAY_LABEL[day ?? ""] ?? day ?? "",
          });
        }
      }
    }
  }
  return conflicts;
}

/** 미리보기 요약 통계. */
export function assignSummary(result: AssignResult): {
  total: number;
  changed: number;
  unassigned: number;
  conflictsResolved: number;
} {
  return {
    total: result.assignments.length,
    changed: result.assignments.filter((a) => a.changed).length,
    unassigned: result.unassigned.length,
    conflictsResolved: result.conflictsBefore.length,
  };
}

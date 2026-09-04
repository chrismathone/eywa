// 반 블록을 다른 교시·요일로 옮길 수 있는가 — **순수 판정**(원장 2026-09-04: *"반을 콕 찝으면 그걸 계산해서
// 드랍 가능한 위치만 하이라이트"*, *"모든 반 소속 학생들의 모든 과목 스케줄이 통과해야"*).
//
// 재료는 **서버가 이미 받아 둔 그 주 슬롯 전부**(page의 `getWeeklyScheduleWithStudents`는 과목을 안 가린다)라
// 새 조회가 0건이다 — 집을 때마다 서버에 물으면 왕복이 폭발한다(B4).
// 다만 그 원본을 통째로 클라에 내려보내진 않는다(전 과목 명단이라 무겁다) → 서버에서 **압축 색인**으로 접어 보낸다:
//  · `busyByClass` — 화면에 뜬 반마다, 그 반 재원생이 **다른 반**에 잡혀 있는 칸들(과목 불문)
//  · `occupancy`   — 강사·강의실 판정용 슬롯 목록(학생 없이 7필드)
//
// 규칙 셋(막는 이유):
//  ① 학생 — 그 반 **재원생**이 목적지 시간에 다른 반에 있으면 못 간다. 사람이 두 곳에 못 있는다.
//  ② 강사 — 같은 시간에 그 강사가 다른 반을 맡고 있으면 못 간다.
//  ③ 강의실 — 같은 시간에 그 방을 다른 반이 쓰면 못 간다.
//
// 🔴 **자리(LAB·JJ)는 강사·강의실 축에서 뺀다** — 여러 반이 동시에 같은 자리에 앉는 것이 설계고 라벨이 사람도
//    아니다(가져오기 체크리스트 `conflicts.ts`와 **같은 규약**, `specialSlotLabel` 단일 소스). 단 **학생 축에서는
//    빼지 않는다**: 랩실에 앉아 있는 아이는 실제로 거기 있다("겹침이 아니다"와 "사람이 없다"는 다른 말).
// 🔴 **분리등원(`attendanceDays`)을 반드시 본다** — 월·목 반에 목요일만 오는 학생은 월요일이 비어 있다.
//    안 보면 거짓 충돌로 갈 수 있는 칸이 통째로 잠긴다.
// 🔴 **길이는 유지한다**(목적지 교시의 끝시각을 쓰지 않는다) — 저장된 60분 수업이 그리드 교시 40분으로 조용히
//    줄면 **급여 시수가 준다**(`schedule-preserve.ts` `formEndTimeWins` 주석과 같은 이유).
// ⚠️ 겹침 판정은 앱 단일 소스 `timeRangesOverlap`(경계 접촉은 겹침 아님)을 그대로 쓴다.

import { timeRangesOverlap } from "@/features/classes/overlap";
import { isSpecialSlotLabel } from "./teacher-label";

/** 색인을 만들 때 필요한 최소 슬롯 모양 — `ScheduleSlotWithStudents`가 구조적으로 만족한다. */
export type MoveSlotLike = {
  id: string;
  classId: string;
  className: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  teacherName: string | null;
  slotTeacherLabel: string | null;
  slotRoomId: string | null;
  classRoomId: string | null;
  classroomName: string | null;
  slotRoomLabel: string | null;
  students: MoveStudentLike[];
  /** 비수업 블록(감독·회의 등)이면 반이 아니다 — 학생 축엔 안 걸리지만 강사 축은 막는다. */
  blockKind?: string;
};

export type MoveStudentLike = {
  studentId: string;
  name: string;
  status?: "active" | "hold" | "withdrawn";
  /** 분리등원 요일 — 빈 배열/미지정 = 그 반 전 요일 등원. */
  attendanceDays?: string[];
};

/** 그 반 학생들이 **다른 반에** 잡혀 있는 한 칸(학생 이름까지 접어 둔다 — 화면이 이유를 적는다). */
export type BusyWindow = {
  day: string;
  start: string;
  end: string;
  /** 그 시간에 학생들이 가 있는 반 이름. */
  className: string;
  /** 그 칸에 걸리는 학생 이름들(이 반 소속 기준) — 화면은 3명까지 적고 나머지는 수로 말하므로 **최대 4명**만 싣는다. */
  names: string[];
  /** 이름을 자른 뒤 남은 인원(0이면 생략) — payload를 키우지 않으면서 "외 N명"을 정확히 적기 위한 값. */
  more?: number;
  /** 그 학생들이 **목적지 요일에 실제로 오는지** 판정하려면 요일별 등원이 필요하다 → 요일 제한이 있는 학생만 따로. */
  daysByName?: Record<string, string[]>;
};

/** 강사·강의실(그리고 같은 반의 다른 칸) 판정용 슬롯 — 학생 없이. */
export type OccupancySlot = {
  /** 배치(스케줄) id — 끌고 있는 **그 칸 자신**만 판정에서 빼기 위해 필요하다(같은 반의 다른 칸은 막아야 한다). */
  slotId: string;
  classId: string;
  className: string;
  day: string;
  start: string;
  end: string;
  /** 실효 강사 라벨(셀 override 우선). 자리(LAB·JJ)면 판정에서 빠진다. */
  teacher: string | null;
  /** 실효 강의실 키(FK 우선, 없으면 라벨). */
  roomKey: string | null;
  /** 자리 슬롯인가(강사·강의실 축 제외 대상). */
  seat: boolean;
};

/** 화면(클라)에 내려보내는 판정 재료 — 이 두 개면 어떤 칸이든 판정할 수 있다. */
export type ClassMoveIndex = {
  busyByClass: Record<string, BusyWindow[]>;
  occupancy: OccupancySlot[];
};

/**
 * 칸마다 부를 판정을 위해 **요일로 미리 나눠 둔** 색인 — 화면이 드래그 한 번에 한 벌 만든다.
 * 🔴 칸이 수백 개라 칸마다 전 슬롯을 훑으면 그 곱이 곧 픽업 렉이다(실측: 300칸 × 500슬롯).
 *    요일로 먼저 나누면 훑는 양이 1/6로 준다(가져오기 충돌 판정 `conflicts.ts`가 쓰는 것과 같은 수법).
 */
export type ClassMoveLookup = {
  /** `${classId}|${day}` → 그 반 학생들이 그 요일에 다른 반에 잡혀 있는 칸들. */
  busyByClassDay: Map<string, BusyWindow[]>;
  /** 요일 → 그 요일 슬롯(강사·강의실·같은 반 판정용). */
  occByDay: Map<string, OccupancySlot[]>;
};

/** 서버가 준 색인 → 요일별로 나눈 조회용 색인(클라에서 드래그당 한 번). */
export function buildClassMoveLookup(index: ClassMoveIndex): ClassMoveLookup {
  const busyByClassDay = new Map<string, BusyWindow[]>();
  for (const [classId, wins] of Object.entries(index.busyByClass)) {
    for (const w of wins) {
      const k = `${classId}|${w.day}`;
      const list = busyByClassDay.get(k);
      if (list) list.push(w);
      else busyByClassDay.set(k, [w]);
    }
  }
  const occByDay = new Map<string, OccupancySlot[]>();
  for (const o of index.occupancy) {
    const list = occByDay.get(o.day);
    if (list) list.push(o);
    else occByDay.set(o.day, [o]);
  }
  return { busyByClassDay, occByDay };
}

/** 옮길 수 없는 이유 — 화면이 그대로 문장으로 만든다(빈 배열이면 갈 수 있다). */
export type MoveBlocker =
  | { kind: "student"; names: string[]; className: string; more?: number }
  | { kind: "teacher"; teacher: string; className: string }
  | { kind: "room"; room: string; className: string }
  | { kind: "self"; className: string };

/** 그 슬롯의 실효 강사 라벨 — 셀 override가 반 담임을 이긴다(시간표 표시와 같은 우선순위). */
export function slotTeacherOf(s: MoveSlotLike): string | null {
  return s.slotTeacherLabel ?? s.teacherName;
}

/** 그 슬롯의 실효 강의실 키 — FK 우선, 없으면 라벨(시트 원문). 둘 다 없으면 null(=방을 모른다). */
export function slotRoomKeyOf(s: MoveSlotLike): string | null {
  const id = s.slotRoomId ?? s.classRoomId;
  if (id) return `id:${id}`;
  const label = s.slotRoomLabel ?? s.classroomName;
  return label ? `label:${label.trim()}` : null;
}

/** 한 칸에 이름을 몇 명까지 싣나 — 화면은 3명 + "외 N명"이라 4면 충분하다. */
const NAME_CAP = 4;

/** 화면에 적을 강의실 이름(키가 아니라 사람이 읽는 값). */
export function slotRoomNameOf(s: MoveSlotLike): string {
  return (s.slotRoomLabel ?? s.classroomName ?? "").trim();
}

/** 이 슬롯이 자리(LAB·JJ)인가 — 강사 라벨이나 방 라벨 어느 쪽이든 자리면 자리로 본다. */
export function isSeatSlot(s: MoveSlotLike): boolean {
  return isSpecialSlotLabel(slotTeacherOf(s)) || isSpecialSlotLabel(s.slotRoomLabel ?? s.classroomName);
}

/** 이 학생이 그 요일에 실제로 오는가 — 분리등원(attendanceDays)을 본다. */
export function attendsOn(days: string[] | undefined, day: string): boolean {
  return !days || days.length === 0 || days.includes(day);
}

/** `HH:MM(:SS)` → 분. */
export function toMinutes(t: string): number {
  const [h, m] = String(t).slice(0, 5).split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** 분 → `HH:MM:SS`(DB 저장 형식). */
export function toTimeString(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

/** 목적지 시작시각 + **원래 길이** → 끝시각(교시 길이를 따라가지 않는다 — 시수 보존). */
export function movedEndTime(slot: { startTime: string; endTime: string }, toStart: string): string {
  const dur = Math.max(0, toMinutes(slot.endTime) - toMinutes(slot.startTime));
  return toTimeString(toMinutes(toStart) + dur);
}

/**
 * 그 주 전체 슬롯 → 판정 색인(**서버에서 한 번**).
 *
 * @param slots 그 주 전 과목 슬롯(학생 포함)
 * @param forClassIds 화면에 뜬 반들 — 이 반들에 대해서만 학생 축 색인을 만든다(전 반을 만들면 payload가 커진다)
 */
export function buildClassMoveIndex(
  slots: readonly MoveSlotLike[],
  forClassIds: readonly string[],
): ClassMoveIndex {
  const want = new Set(forClassIds);
  // 학생 → 그 학생이 잡혀 있는 칸(재원만, 그 반 요일 등원만).
  const byStudent = new Map<string, { day: string; start: string; end: string; classId: string; className: string }[]>();
  // 반 → 그 반 재원생(이름·요일 제한)
  const rosterOf = new Map<string, Map<string, string[] | undefined>>();
  for (const s of slots) {
    for (const st of s.students) {
      if ((st.status ?? "active") !== "active" || !st.studentId) continue;
      if (want.has(s.classId)) {
        const m = rosterOf.get(s.classId) ?? new Map<string, string[] | undefined>();
        // 같은 반에 여러 칸이 있으면 요일 제한은 한 벌(수강 단위 값이라 칸마다 같다).
        if (!m.has(st.studentId)) m.set(st.studentId, st.attendanceDays);
        rosterOf.set(s.classId, m);
      }
      if (s.blockKind) continue; // 비수업 블록엔 학생이 없다(방어)
      if (!attendsOn(st.attendanceDays, s.dayOfWeek)) continue;
      const list = byStudent.get(st.studentId);
      const win = { day: s.dayOfWeek, start: s.startTime, end: s.endTime, classId: s.classId, className: s.className };
      if (list) list.push(win);
      else byStudent.set(st.studentId, [win]);
    }
  }
  // 학생 이름 사전(색인에 이름을 적기 위해)
  const nameOf = new Map<string, string>();
  for (const s of slots) for (const st of s.students) if (st.studentId) nameOf.set(st.studentId, st.name);

  const busyByClass: Record<string, BusyWindow[]> = {};
  for (const classId of want) {
    const roster = rosterOf.get(classId);
    if (!roster) continue;
    // (요일|시작|끝|다른반) → 걸리는 학생들
    const merged = new Map<string, BusyWindow>();
    for (const [studentId, days] of roster) {
      for (const w of byStudent.get(studentId) ?? []) {
        if (w.classId === classId) continue; // 자기 반 칸은 자기 자신
        const key = `${w.day}|${w.start}|${w.end}|${w.classId}`;
        const name = nameOf.get(studentId) ?? "학생";
        const cur = merged.get(key);
        if (cur) {
          if (!cur.names.includes(name)) {
            // 이름은 4명까지만 — 화면이 3명 + "외 N명"으로 적는다(payload를 사람 수만큼 키우지 않는다).
            if (cur.names.length < NAME_CAP) cur.names.push(name);
            else cur.more = (cur.more ?? 0) + 1;
          }
          if (days && days.length > 0) (cur.daysByName ??= {})[name] = days;
        } else {
          const win: BusyWindow = { day: w.day, start: w.start, end: w.end, className: w.className, names: [name] };
          if (days && days.length > 0) win.daysByName = { [name]: days };
          merged.set(key, win);
        }
      }
    }
    if (merged.size > 0) busyByClass[classId] = [...merged.values()];
  }

  // 강사·강의실 축은 **화면에 뜬 반이 실제로 쓰는 강사·방과 겹칠 수 있는 슬롯만** 싣는다 —
  // 전 과목 939행을 통째로 내려보내면 그 자체가 페이지 payload가 된다(B5의 결). 판정 결과는 같다:
  // 나머지 행은 강사도 방도 안 겹쳐서 어차피 막지 못한다.
  const myTeachers = new Set<string>();
  const myRooms = new Set<string>();
  // 같은 반의 다른 칸도 판정 대상이다 — 한 반이 같은 시간에 두 곳에 있을 수는 없다.
  for (const s of slots) {
    if (!want.has(s.classId) || isSeatSlot(s)) continue;
    const t = slotTeacherOf(s);
    if (t) myTeachers.add(t);
    const r = slotRoomKeyOf(s);
    if (r) myRooms.add(r);
  }
  const occupancy: OccupancySlot[] = [];
  for (const s of slots) {
    if (isSeatSlot(s)) continue; // 자리는 강사·강의실 축에서 늘 빠진다(같이 앉는 것이 설계)
    const teacher = slotTeacherOf(s);
    const roomKey = slotRoomKeyOf(s);
    const hitTeacher = teacher != null && myTeachers.has(teacher);
    const hitRoom = roomKey != null && myRooms.has(roomKey);
    if (!hitTeacher && !hitRoom && !want.has(s.classId)) continue;
    occupancy.push({
      slotId: s.id,
      classId: s.classId,
      className: s.className,
      day: s.dayOfWeek,
      start: s.startTime,
      end: s.endTime,
      teacher: hitTeacher ? teacher : null,
      roomKey: hitRoom ? roomKey : null,
      seat: false,
    });
  }
  return { busyByClass, occupancy };
}

/** 판정에 필요한, 끌고 있는 블록의 정보(화면이 드래그 data로 들고 있는 값). */
export type MoveSubject = {
  /** 끌고 있는 **그 배치**의 id — 자기 자신만 판정에서 뺀다(같은 반의 다른 칸은 막는다). */
  slotId: string;
  classId: string;
  /** 실효 강사 라벨. */
  teacher: string | null;
  /** 실효 강의실 키. */
  roomKey: string | null;
  /** 화면에 적을 강의실 이름. */
  roomName: string;
  /** 자리(LAB·JJ) 슬롯이면 강사·강의실 축을 안 본다. */
  seat: boolean;
  startTime: string;
  endTime: string;
};

/**
 * 이 반 블록을 (요일, 시작시각)으로 옮길 때 막는 것들. 빈 배열 = 갈 수 있다.
 * 판정은 색인만 본다(원본 슬롯 불필요) — 화면에서 칸마다 부른다.
 */
export function classMoveBlockers(
  subject: MoveSubject,
  toDay: string,
  toStart: string,
  lookup: ClassMoveLookup,
): MoveBlocker[] {
  const toEnd = movedEndTime(subject, toStart);
  const out: MoveBlocker[] = [];

  // ① 학생 — 목적지 요일에 **실제로 오는** 학생만 본다(분리등원).
  // ⚠️ 같은 반이 그 시간에 여러 칸(교시)을 가지면 이유가 그 수만큼 반복된다 → **반 이름으로 합친다**.
  const byClass = new Map<string, { names: string[]; more: number }>();
  for (const w of lookup.busyByClassDay.get(`${subject.classId}|${toDay}`) ?? []) {
    if (!timeRangesOverlap(toStart, toEnd, w.start, w.end)) continue;
    const names = w.names.filter((n) => attendsOn(w.daysByName?.[n], toDay));
    // 잘린 인원(`more`)은 이름을 모르니 수로만 더한다 — 이름이 하나도 안 남았는데 잘린 인원이 있으면
    // 그래도 막힌 것은 사실이라 그 사실을 알린다(요일 제한은 이름이 있는 쪽에만 걸린다).
    const more = w.names.length === names.length ? (w.more ?? 0) : 0;
    if (names.length === 0 && more === 0) continue;
    const cur = byClass.get(w.className);
    if (cur) {
      for (const n of names) if (!cur.names.includes(n)) cur.names.push(n);
      cur.more = Math.max(cur.more, more);
    } else byClass.set(w.className, { names: [...names], more });
  }
  for (const [className, v] of byClass) {
    out.push({ kind: "student", names: v.names, className, more: v.more });
  }

  // ②③ 강사·강의실 — 자리(LAB·JJ)는 뺀다(여럿이 동시에 쓰는 것이 설계).
  {
    let seenSelf = false;
    const seenTeacher = new Set<string>();
    const seenRoom = new Set<string>();
    for (const o of lookup.occByDay.get(toDay) ?? []) {
      if (o.slotId === subject.slotId || o.seat) continue;
      // 🔴 시간을 **먼저** 본다 — 겹치지도 않는 칸을 이유로 세우면 갈 수 있는 자리가 통째로 잠긴다
      //    (자기 반 칸도 마찬가지다: 다른 시각이면 아무 문제가 없다).
      if (!timeRangesOverlap(toStart, toEnd, o.start, o.end)) continue;
      // 같은 반의 **다른 칸**이 그 시간에 있으면 못 간다 — 한 반이 두 곳에 동시에 있을 수 없다
      // (월·목 병합 블록의 월 칸을 목 같은 시각으로 끌면 자기 목 칸과 겹친다).
      if (o.classId === subject.classId) {
        if (!seenSelf) {
          seenSelf = true;
          out.push({ kind: "self", className: o.className });
        }
        continue;
      }
      if (subject.seat) continue; // 자리(LAB·JJ)는 강사·강의실 축을 안 본다(같이 쓰는 것이 설계)
      if (subject.teacher && o.teacher === subject.teacher && !seenTeacher.has(o.classId)) {
        seenTeacher.add(o.classId);
        out.push({ kind: "teacher", teacher: subject.teacher, className: o.className });
      }
      if (subject.roomKey && o.roomKey === subject.roomKey && !seenRoom.has(o.classId)) {
        seenRoom.add(o.classId);
        out.push({ kind: "room", room: subject.roomName || "같은 강의실", className: o.className });
      }
    }
  }
  return out;
}

/** 막는 이유 → 한 줄 한글(화면·툴팁 공용 — 문구를 화면마다 새로 만들지 말 것). */
export function blockerText(b: MoveBlocker): string {
  if (b.kind === "student") {
    const head = b.names.slice(0, 3).join("·");
    const hidden = Math.max(0, b.names.length - 3) + (b.more ?? 0);
    const rest = hidden > 0 ? ` 외 ${hidden}명` : "";
    return `${head || "학생"}${rest} — 그 시간에 ${b.className}`;
  }
  if (b.kind === "self") return `${b.className} — 그 시간에 이 반의 다른 수업이 있습니다`;
  if (b.kind === "teacher") return `${b.teacher} 강사 — 그 시간에 ${b.className}`;
  return `${b.room} — 그 시간에 ${b.className}`;
}

/** 여러 이유를 한 문장으로(툴팁). 빈 배열이면 빈 문자열. */
export function blockersText(list: readonly MoveBlocker[]): string {
  return list.map(blockerText).join(" · ");
}

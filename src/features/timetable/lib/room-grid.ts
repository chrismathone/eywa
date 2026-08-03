// 교실뷰(강의실 사용 지도) 순수 모델 — 실효 강의실 버킷팅 + 점유 구간.
// 실효 강의실 = 교시 override(class_schedules.classroom_id) ?? 반 기본(classes.classroom_id) —
// 겹침 진단(features/classes/server/overlap-detect.ts)과 같은 우선순위. FK가 둘 다 없으면 시트 이식
// 라벨(slot_room_label) 문자열 버킷 폴백(live 데이터엔 현재 0건이지만 미래 이식분 방어), 그것도 없으면
// "미배정"으로 분리(지도에서 숨기면 그 수업이 어딘가 교실을 쓰고 있다는 사실이 사라진다).
// 순수 모듈(클라/서버 공용 — server-only 금지 [[#61]]). 계산은 Vitest(room-grid.test.ts).

import { timeToMin } from "./ten-minute-grid";

/** 교실뷰가 소비하는 경량 슬롯 — 학생 명단(이름) 없이 인원 수만(클라 전달 페이로드·PII 축소). */
export type RoomSlotLite = {
  id: string;
  classId: string;
  className: string;
  subject: string;
  dayOfWeek: string; // "mon" ~ "sun"
  startTime: string; // "HH:MM(:SS)"
  endTime: string;
  teacherLabel: string | null;
  /** 재원(active) 학생 수 — 좌석 활용(정원 대비) 지표용. */
  students: number;
  classBgColor: string | null;
  classTextColor: string | null;
  isSpecialLecture: boolean;
  /** 실효 강의실 FK(slot override ?? 반 기본). null=FK 미배정. */
  roomId: string | null;
  /** 표시 폴백 라벨(slot_room_label ?? 반 기본 강의실명) — FK 없는 이식분 버킷명으로만 사용. */
  roomLabel: string | null;
};

export type RoomInfo = { id: string; name: string; capacity: number | null };

/** FK 없는 라벨 버킷 키 접두사 — 등록 강의실 uuid와 충돌하지 않는 네임스페이스. */
export const LABEL_KEY_PREFIX = "label:";

/** 슬롯의 버킷 키 — FK 우선, 라벨 폴백, 없으면 null(미배정). */
export function roomKeyOf(s: Pick<RoomSlotLite, "roomId" | "roomLabel">): string | null {
  if (s.roomId) return s.roomId;
  if (s.roomLabel) return LABEL_KEY_PREFIX + s.roomLabel;
  return null;
}

export type RoomBucket = {
  key: string;
  name: string;
  capacity: number | null;
  /** classrooms 테이블 등록 여부 — false = 시트 라벨만 있는 미등록 방(이름 뒤에 표식). */
  registered: boolean;
  slots: RoomSlotLite[];
};

/**
 * 슬롯 → 강의실 버킷. 등록 강의실은 **수업이 없어도 전부 버킷 생성**(빈 교실을 보는 게 이 화면의
 * 존재 이유) + DB 정렬(name) 유지. 라벨 전용(미등록) 버킷은 뒤에 가나다순. 미배정은 별도 반환.
 */
export function buildRoomBuckets(
  slots: readonly RoomSlotLite[],
  rooms: readonly RoomInfo[],
): { buckets: RoomBucket[]; unassigned: RoomSlotLite[] } {
  const byKey = new Map<string, RoomSlotLite[]>();
  const unassigned: RoomSlotLite[] = [];
  for (const s of slots) {
    const k = roomKeyOf(s);
    if (!k) {
      unassigned.push(s);
      continue;
    }
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(s);
  }
  const registeredIds = new Set(rooms.map((r) => r.id));
  const buckets: RoomBucket[] = rooms.map((r) => ({
    key: r.id,
    name: r.name,
    capacity: r.capacity,
    registered: true,
    slots: byKey.get(r.id) ?? [],
  }));
  // 미등록 버킷 = 라벨 폴백 + (레이스로 rooms 목록에 없는 FK — onDelete set null이라 정상적으론 없음).
  const extras = [...byKey.entries()]
    .filter(([k]) => !registeredIds.has(k))
    .map(([k, list]) => ({
      key: k,
      name: k.startsWith(LABEL_KEY_PREFIX)
        ? k.slice(LABEL_KEY_PREFIX.length)
        : (list[0]?.roomLabel ?? "(삭제된 강의실)"),
      capacity: null,
      registered: false,
      slots: list,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return { buckets: [...buckets, ...extras], unassigned };
}

// ── 점유 구간(반 단위 병합) ─────────────────────────────────────────────────────
// ten-minute-grid의 buildClassIntervals는 격자 스냅(10분 라운딩)이라 지표 계산엔 오차가 생긴다
// (50분 수업이 60분으로 부풀면 가동률이 거짓말). 여기선 **실제 분 그대로** 병합한다.

export type RoomInterval = {
  classId: string;
  className: string;
  subject: string;
  startMin: number;
  endMin: number;
  students: number;
  teacherLabel: string | null;
  classBgColor: string | null;
  classTextColor: string | null;
  isSpecialLecture: boolean;
  /** 다른 반과의 시간 겹침: conflict=부분 겹침(이중예약 의심), joint=완전 동일 범위(합반), null=단독. */
  overlap: "conflict" | "joint" | null;
};

/** 같은 반의 인접(끝=시작)·중복 슬롯을 실제 분 단위로 병합 — 파싱 실패 슬롯은 제외(throw 금지). */
export function classIntervalsExact(slots: readonly RoomSlotLite[]): RoomInterval[] {
  const byClass = new Map<string, RoomSlotLite[]>();
  for (const s of slots) (byClass.get(s.classId) ?? byClass.set(s.classId, []).get(s.classId)!).push(s);
  const out: RoomInterval[] = [];
  for (const group of byClass.values()) {
    const parsed = group
      .map((s) => ({ s, a: timeToMin(s.startTime), b: timeToMin(s.endTime) }))
      .filter((x): x is { s: RoomSlotLite; a: number; b: number } => x.a != null && x.b != null && x.b > x.a)
      .sort((x, y) => x.a - y.a || x.b - y.b);
    let cur: RoomInterval | null = null;
    for (const { s, a, b } of parsed) {
      if (cur && a <= cur.endMin) {
        cur.endMin = Math.max(cur.endMin, b);
      } else {
        cur = {
          classId: s.classId,
          className: s.className,
          subject: s.subject,
          startMin: a,
          endMin: b,
          students: s.students,
          teacherLabel: s.teacherLabel,
          classBgColor: s.classBgColor,
          classTextColor: s.classTextColor,
          isSpecialLecture: s.isSpecialLecture,
          overlap: null,
        };
        out.push(cur);
      }
    }
  }
  return out.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
}

/**
 * 구간 간 겹침 판정 주석 달기 — **완전 동일 범위 = 합반(joint)**, 부분 겹침 = 이중예약 의심(conflict).
 * 강사뷰(packGroups)가 동일 범위 병렬을 합반 셀로 묶는 것과 같은 해석. conflict가 joint보다 우선.
 * 반환은 새 배열(입력 불변) + 부분 겹침 쌍 수.
 */
export function annotateOverlaps(intervals: readonly RoomInterval[]): {
  intervals: RoomInterval[];
  conflictPairs: number;
} {
  const out = intervals.map((iv) => ({ ...iv }));
  let conflictPairs = 0;
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i]!;
      const b = out[j]!;
      if (a.startMin < b.endMin && b.startMin < a.endMin) {
        if (a.startMin === b.startMin && a.endMin === b.endMin) {
          if (a.overlap !== "conflict") a.overlap = "joint";
          if (b.overlap !== "conflict") b.overlap = "joint";
        } else {
          a.overlap = "conflict";
          b.overlap = "conflict";
          conflictPairs++;
        }
      }
    }
  }
  return { intervals: out, conflictPairs };
}

/** 구간 합집합 길이(분) — 겹침·합반은 한 번만 센다(가동률 분자). */
export function occupiedMinutes(intervals: readonly { startMin: number; endMin: number }[]): number {
  const sorted = [...intervals].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  let total = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const iv of sorted) {
    if (iv.startMin > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = iv.startMin;
      curEnd = iv.endMin;
    } else {
      curEnd = Math.max(curEnd, iv.endMin);
    }
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return total;
}

/**
 * 강사 전체 보기의 **"이 기록 행이 그 강사 몫인가"** — 저장(서버 액션)이 화면과 **같은 함수·같은 재료**로 판정하게
 * 묶은 순수 모듈(Vitest). 조회는 [`server/scope-ownership.ts`](./server/scope-ownership.ts)가 맡는다.
 *
 * 🔴 왜: 화면(월간 매트릭스 `ownsSlot`, server/queries.ts)은 `ownsAttendanceSlot`에 (담임 · 그 반 교시 전부 ·
 *    날짜 · 교시 · 자리 라벨)을 넘겨 칸 값을 만든다. 저장이 다른 재료로 판정하면 친 숫자와 새로고침 뒤 숫자가
 *    또 갈린다(원장 제보 2026-09-11). 클라이언트가 보낸 "내 몫" 목록은 믿지 않는다(#77) — 클라는 **어느 강사의
 *    보기인지**(id)만 보내고, 몫은 여기서 다시 푼다.
 * ⚠️ 단 하나 뺀 재료가 **담임 시작일**(`homeroomSince`)이다 — 이유는 `buildScopeOwner` 주석.
 */
import { monthRange } from "@/lib/date-kst";
import {
  classTeacherIdsInRange,
  classTeacherRole,
  ownsAttendanceSlot,
  type AxisSlot,
  type ClassTeacherRole,
} from "./teacher-axis";
import type { DayTargetRow } from "./scoped-split";

/** 한 반의 판정 재료 — 월간 매트릭스가 `ownsSlot`에 넘기는 것과 같은 모양. */
export type ScopeClassFacts = {
  /** `classes.teacher_id`(현재 담임). */
  homeroomTeacherId: string | null;
  /** 그 반 `class_schedules`(자리 JJ·LAB 포함 — 자리 판정에 쓴다). 유효구간은 판정 함수가 날짜로 거른다. */
  slots: AxisSlot[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 스코프 강사 id 형식 — 화면은 `users.id`(uuid)만 보낸다. */
export function isScopeTeacherId(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** 범위 저장의 스코프 반 목록 — **배열**이고 전부 반 id(uuid)여야 한다. 아니면 화면이 만든 값이 아니다. */
export function isScopeClassIds(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((id) => typeof id === "string" && UUID_RE.test(id));
}

/**
 * 그 날짜가 속한 달에 이 사람이 이 반에서 맡은 역할 — page.tsx `classTaughtBy`·`teacherRoles`와 같은 판정
 * (교시 담당 = 그 달과 겹치는 유효 슬롯의 담당, 자리는 사람이 아니라 빠진다).
 */
export function scopeRoleOf(
  facts: ScopeClassFacts | undefined,
  teacherId: string,
  date: string,
): ClassTeacherRole | null {
  if (!facts) return null;
  const { from, to } = monthRange(date.slice(0, 7));
  return classTeacherRole({
    homeroomTeacherId: facts.homeroomTeacherId,
    slotTeacherIds: classTeacherIdsInRange({ homeroomTeacherId: null, slots: facts.slots, from, to }),
    teacherId,
  });
}

/** 강사 전체 보기가 이 반을 그 강사 표로 그리나(그 달에 담임이거나 교시 담당) — 아니면 스코프 저장은 잘못된 요청. */
export function scopeTeaches(facts: ScopeClassFacts | undefined, teacherId: string, date: string): boolean {
  return scopeRoleOf(facts, teacherId, date) !== null;
}

export type ScopeOwner = (classId: string, date: string, row: DayTargetRow) => boolean;

/**
 * 행 하나가 스코프 강사 몫인가 — 월간 매트릭스 `ownsSlot`과 같은 함수(`ownsAttendanceSlot`)·같은 재료로 판정한다.
 *
 * 🔴 **담임 시작일(`homeroomSince`)은 저장 판정에 넣지 않는다**(2026-09-11 결정 — 반응속도 1순위). 그 값을 알려면
 *    저장마다 감사로그 12개월·반 전체·직원 이름을 읽어야 한다(`getHomeroomSinceIndex`). 화면은 그 값으로 담임 폴백
 *    반의 **인계일 이전 칸**을 빗금(notMine)으로 빼는데, 그 칸은 격자·팝오버가 이미 입력을 막는다 — **그 칸의
 *    문지기는 격자다.** 그래서 서버는 그 교시를 몫으로 본다(시수가 거기로 가고, 저장을 거절하지 않는다).
 * ⚠️ 차이는 **서버가 더 넓게 받는 쪽**으로만 난다 — 화면이 몫이라 한 행은 서버도 몫이다(테스트가 잠근다). 시작일은
 *    날짜 단위 컷이라 한 칸(같은 날짜) 안의 교시 사이 분배를 못 바꾼다 → 남의 교시로 시수가 새는 원래 버그는 다시
 *    안 생긴다. 바뀌는 건 "전부 몫 아님 → 거절" 여부 하나뿐이다.
 */
export function buildScopeOwner(input: {
  teacherId: string;
  facts: ReadonlyMap<string, ScopeClassFacts>;
}): ScopeOwner {
  return (classId, date, row) => {
    const f = input.facts.get(classId);
    // 재료가 없는 반은 판정할 수 없다 — 몫이 아닌 것으로 본다(호출부가 `scopeTeaches`로 먼저 거른다).
    if (!f) return false;
    return ownsAttendanceSlot({
      scopeTeacherId: input.teacherId,
      homeroomTeacherId: f.homeroomTeacherId,
      slots: f.slots,
      date,
      slotStart: row.slot_start ?? null,
      homeroomSince: null,
      seatLabel: row.seat_label ?? null,
    });
  };
}

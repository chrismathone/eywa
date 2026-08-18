/**
 * 출결의 **강사 귀속 축(누가 가르쳤나)** — 순수 함수 단일 소스.
 *
 * 🔴 왜 한 곳으로 모으나: eywa에는 출결에 강사가 붙는 축이 **셋**이고, 화면마다 다른 축을 골라 쓰면
 *    같은 출결이 화면마다 다른 사람의 것이 된다(원장 제보 2026-08-18: *"ecs에서 출결하면 출결한
 *    선생님의 출석부가 아니라 담임 출결로 인정된다"*).
 *      ① `classes.teacher_id`        = **반 담임**(그 반 전체의 대표)
 *      ② `class_schedules.teacher_id`= **그 교시 담당**(영어는 교시마다 사람이 다르다)
 *      ③ `attendance_records.recorded_by` = **입력한 사람**(데스크가 대신 찍으면 데스크)
 *    ③은 "누가 키보드를 눌렀나"라 귀속이 아니다(실측 2026-08-18: 8월 교시별 1,146행 중 1,138행이
 *    김동후 한 명 — 그는 담임 반이 0개다). 귀속은 ②를 먼저 보고, 없으면 ①로 떨어진다.
 *
 * ⚠️ **자리(LAB·JJ) 슬롯은 담임으로 폴백하지 않는다.** 그 슬롯은 사람이 아니라 방이고(teacher_id가
 *    구조적으로 null), 담임으로 떨어뜨리면 담임이 하지 않은 수업이 담임 시수로 잡힌다
 *    (같은 이유로 0208a가 자리 출결을 정산 분모에서 뺐다).
 * ⚠️ **모호하면 지어내지 않는다.** 같은 (반·요일·시각)에 담당이 서로 다른 유효 슬롯이 둘 이상이면
 *    `ambiguous`(teacherId=null)다 — 한쪽을 임의로 고르면 그 사람 급여·출석부에 남의 수업이 붙는다.
 *
 * 이 파일은 **순수**하다(DB·서버 의존 0). 조회는 `server/teacher-axis-queries.ts`가 맡는다.
 */
import { isSpecialSlotLabel } from "@/features/timetable/lib/teacher-label";

/** 요일 enum(`day_of_week`) — DB 순서와 같다. 0=일요일인 JS Date 인덱스와 혼동 금지. */
export const AXIS_DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type AxisDow = (typeof AXIS_DOW)[number];

/** 축 판정에 필요한 `class_schedules` 한 줄의 최소 모양(서버 행 타입에 묶지 않는다). */
export type AxisSlot = {
  dayOfWeek: string; // "mon" ~ "sun"
  /** "HH:MM" 또는 "HH:MM:SS" — 비교 전에 normalizeAxisTime을 거친다. */
  startTime: string | null;
  teacherId: string | null;
  /** 자리 표기(LAB·JJ). 사람 라벨(닉네임)은 권한·귀속 근거로 쓰지 않는다 — 표시 전용. */
  slotTeacherLabel: string | null;
  validFrom: string; // "YYYY-MM-DD"
  validTo: string | null;
};

export type TeacherAxisSource =
  | "slot" // 그 교시 담당이 유일하게 정해졌다
  | "homeroom" // 교시 담당이 없어 반 담임으로 떨어졌다(수학 전 슬롯이 이 경로)
  | "seat" // 자리(LAB·JJ) 수업 — 사람이 아니다(담임 폴백 금지)
  | "ambiguous" // 담당이 서로 다른 유효 슬롯이 둘 이상 — 지어내지 않는다
  | "none"; // 담당도 담임도 없다

export type TeacherAxis = { teacherId: string | null; source: TeacherAxisSource };

/** "16:20:00" → "16:20". 형식이 아니면 그대로 돌려준다(비교는 문자열로 한다). */
export function normalizeAxisTime(value: string | null | undefined): string | null {
  if (value == null) return null;
  const m = /^(\d{2}):(\d{2})/.exec(value.trim());
  return m ? `${m[1]}:${m[2]}` : (value.trim() || null);
}

/** ISO 날짜의 요일 enum. `weekdayIndexOf`(date-kst)와 같은 UTC 기준 계산. */
export function axisDowOf(dateIso: string): AxisDow | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return null;
  const idx = new Date(`${dateIso}T00:00:00Z`).getUTCDay();
  return AXIS_DOW[idx] ?? null;
}

/**
 * 그 날짜에 살아 있는 슬롯인가 — `class_schedules`는 **운영 이력을 함께 담는다**([[#88]]·2026-08-04
 * 행 분할 결정). 전 행을 그대로 보면 끝난 교시의 옛 담당이 오늘 담당으로 되살아난다.
 */
export function slotLiveOn(slot: Pick<AxisSlot, "validFrom" | "validTo">, dateIso: string): boolean {
  if (slot.validFrom > dateIso) return false;
  return slot.validTo == null || slot.validTo >= dateIso;
}

/** 슬롯의 유효구간이 [from, to]와 겹치는가 — 기간 단위 스코프(월간 출석부)용. */
export function slotOverlapsRange(
  slot: Pick<AxisSlot, "validFrom" | "validTo">,
  from: string,
  to: string,
): boolean {
  if (slot.validFrom > to) return false;
  return slot.validTo == null || slot.validTo >= from;
}

/** 자리(LAB·JJ) 슬롯인가 — 담당이 비어 있고 자리 라벨이 붙은 줄. */
export function isSeatSlot(slot: Pick<AxisSlot, "teacherId" | "slotTeacherLabel">): boolean {
  return slot.teacherId == null && isSpecialSlotLabel(slot.slotTeacherLabel);
}

/**
 * **출결 한 건의 귀속** — (반·날짜·교시)를 실제로 가르친 사람.
 *
 * @param slotStart 교시별 기록(0196a)이면 "HH:MM", "그날 전체" 기록이면 null.
 *                  null이면 그날의 모든 교시를 후보로 본다(그래서 교시마다 담당이 다른 날은 `ambiguous`).
 *
 * 판정 순서(전부 이 함수 안에서만 바뀐다):
 *   ① 그 날짜에 유효한 슬롯 중 요일(+교시) 일치분을 고른다.
 *   ② 후보가 하나도 없으면 → 담임(보강처럼 시간표에 없는 날이 여기로 온다).
 *   ③ 후보가 전부 자리(LAB·JJ)면 → `seat`(null). 담임으로 떨어뜨리지 않는다.
 *   ④ 자리를 뺀 후보의 담당이 유일하면 → 그 사람(`slot`).
 *   ⑤ 담당이 서로 다르면 → `ambiguous`(null).
 *   ⑥ 후보는 있는데 담당이 전부 미지정이면 → 담임(수학 224/224 슬롯이 이 경로).
 */
export function resolveTaughtBy(input: {
  homeroomTeacherId: string | null;
  slots: readonly AxisSlot[];
  date: string;
  /** 넘기면 그 값으로, 없으면 `date`에서 도출. */
  dayOfWeek?: string | null;
  slotStart?: string | null;
}): TeacherAxis {
  const homeroom = input.homeroomTeacherId ?? null;
  const fallback = (): TeacherAxis =>
    homeroom ? { teacherId: homeroom, source: "homeroom" } : { teacherId: null, source: "none" };

  const dow = input.dayOfWeek ?? axisDowOf(input.date);
  if (!dow) return fallback();
  const wantStart = normalizeAxisTime(input.slotStart ?? null);

  const candidates = input.slots.filter(
    (s) =>
      s.dayOfWeek === dow &&
      slotLiveOn(s, input.date) &&
      (wantStart == null || normalizeAxisTime(s.startTime) === wantStart),
  );
  if (candidates.length === 0) return fallback();

  const staffed = candidates.filter((s) => !isSeatSlot(s));
  if (staffed.length === 0) return { teacherId: null, source: "seat" };

  const named = [...new Set(staffed.map((s) => s.teacherId).filter((v): v is string => !!v))];
  if (named.length === 1) return { teacherId: named[0]!, source: "slot" };
  if (named.length > 1) return { teacherId: null, source: "ambiguous" };
  return fallback();
}

/**
 * 이미 (요일·날짜·교시)로 좁혀진 **한 슬롯**의 귀속 — SQL이 먼저 거른 경로용(당일 출결 보드).
 * 위 `resolveTaughtBy`와 **같은 규칙**의 단건판이다: 자리는 담임 폴백 금지, 담당 없으면 담임.
 */
export function taughtByForSlot(input: {
  homeroomTeacherId: string | null;
  slot: Pick<AxisSlot, "teacherId" | "slotTeacherLabel">;
}): TeacherAxis {
  if (isSeatSlot(input.slot)) return { teacherId: null, source: "seat" };
  if (input.slot.teacherId) return { teacherId: input.slot.teacherId, source: "slot" };
  return input.homeroomTeacherId
    ? { teacherId: input.homeroomTeacherId, source: "homeroom" }
    : { teacherId: null, source: "none" };
}

/**
 * **이 반을 그 기간에 가르치는 사람 전부**(합집합) — 스코프·가시성용.
 *
 * 귀속(`resolveTaughtBy`)과 왜 다른가: 귀속은 한 건에 한 사람을 붙이는 일이라 모호하면 비워야 하지만,
 * "누구 출석부에 이 반이 보여야 하나"는 **한 사람이라도 가르치면 보여야** 한다. 좁게 잡으면 교시 담당
 * 강사가 자기 화면에서 자기 수업을 못 본다(실측 2026-08-18: Florence Park = 담임 반 0·교시 담당 5반
 * → 출석부가 통째로 비어 있었다).
 *
 * ⚠️ 자리(LAB·JJ)는 사람이 아니므로 들어가지 않는다(teacher_id가 null이라 구조적으로 제외된다).
 */
export function classTeacherIdsInRange(input: {
  homeroomTeacherId: string | null;
  slots: readonly AxisSlot[];
  from: string;
  to: string;
}): string[] {
  const out = new Set<string>();
  if (input.homeroomTeacherId) out.add(input.homeroomTeacherId);
  for (const s of input.slots) {
    if (!s.teacherId || isSeatSlot(s)) continue;
    if (slotOverlapsRange(s, input.from, input.to)) out.add(s.teacherId);
  }
  return [...out];
}

/** 이 반에서 그 사람의 역할 — 반 머리행 표식용. `null` = 이 기간에 안 가르친다. */
export type ClassTeacherRole = "homeroom" | "slot" | "both";

export function classTeacherRole(input: {
  homeroomTeacherId: string | null;
  slotTeacherIds: readonly string[];
  teacherId: string;
}): ClassTeacherRole | null {
  const isHomeroom = input.homeroomTeacherId === input.teacherId;
  const isSlot = input.slotTeacherIds.includes(input.teacherId);
  if (isHomeroom && isSlot) return "both";
  if (isHomeroom) return "homeroom";
  if (isSlot) return "slot";
  return null;
}

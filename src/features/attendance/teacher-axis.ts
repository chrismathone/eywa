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
import type { RecordedVia } from "./live/recorded-via";

/**
 * 자리 문(자리 출석부·공개 PIN)이 쓰기 때 굳히는 값 — `attendance_records.recorded_via`(0212a).
 * 🔴 JJ실은 `seat_label`을 안 박아서 **이 값이 유일한 표식**일 수 있다(아래 `recordedVia` 주석).
 */
const SEAT_VIA: RecordedVia = "seat";

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

/**
 * **강사 출석부(렌즈)가 이 교시를 그 강사 몫으로 세는가** — 월간 매트릭스의 값/유령 분기 단일 소스.
 *
 * @param scopeTeacherId 표의 주인. null이면 반별 보기 = 전부 그 반 몫(종전과 동일한 숫자).
 * @param slotStart 교시별 기록이면 "HH:MM", 교시를 안 남긴 옛 기록·수기 입력이면 null.
 *
 * 🔴 **교시가 없는 기록(day-level)은 좁히지 않는다.** 그 행은 "그날"만 말하므로 담당이 둘 이상이면
 *    귀속이 모호해져 **누구 화면에서도 사라진다**. 실제로 걸리는 게 거의 전부 수학이다 — 2026년 수학
 *    출결 8,358건 중 **8,322건이 day-level**이라, 좁히는 순간 담임 칸이 슬롯 담당에게 통째로 넘어가고
 *    (고등M 단체 BS4F: 담임 이성우 → 슬롯 유형숙 71건) 수업보고서 파생이 "수기 기록 없음"으로 보고
 *    덮어써 **수기 출석이 결석으로 뒤집혔다**(적대적 리뷰 2026-08-18 실측 3칸). 월간 격자의 새 입력도
 *    day-level이라 좁히면 찍자마자 화면에서 사라진다.
 * ⚠️ 대신 담당을 모르는 그 행은 그 반을 보는 강사 화면에 **종전대로** 남는다(영어 31건/2026년) —
 *    숨겨서 "기록이 없다"고 말하는 것보다 낫다.
 */
export function ownsAttendanceSlot(input: {
  scopeTeacherId: string | null;
  homeroomTeacherId: string | null;
  slots: readonly AxisSlot[];
  date: string;
  slotStart: string | null;
  /**
   * **담임 폴백으로 잡힌 반**에서 이 사람이 담임이 된 날(YYYY-MM-DD). 모르면 null(=종전대로 전부).
   *
   * 🔴 원장 제보 2026-08-19: *"김주현 선생님이 출결한것도 아닌데 보이는것도 같이 수정해야겠네."*
   *    `classes.teacher_id`는 **현재** 담임이라 시간 축이 없다 — 인계 이전(전임이 넣은) 기록까지
   *    새 담임 몫으로 잡혔다. 그래서 이 경계 이전 칸은 값에서 뺀다(표시는 빗금으로 남는다).
   * 🔴 **교시(slotStart) 유무보다 먼저 본다.** day-level 기록(수학이 사실상 전부)은 아래에서 통과시키는데,
   *    문제의 그 27행이 전부 day-level이라 나중에 보면 아무 효과가 없다.
   * ⚠️ **교시 담당으로 잡힌 반에는 넘기지 말 것** — 그 사람은 그날 실제로 그 교시를 가르쳤다.
   *    판정(담임 폴백인가)은 호출부가 하고, 여기는 넘어온 경계만 적용한다.
   * ⚠️ **인계 당일은 남긴다**(`<`이지 `<=`가 아니다). 출결은 날짜만 있고 인계 로그는 시각까지 있어
   *    그날 수업이 인계 전이었는지 후였는지 가릴 수 없다(실측 JJ2A: 8/10 20:15 인계, 그날 기록 9행).
   *    남기면 남의 기록이 하루치 보이고, 빼면 **자기 기록이 사라진다** — 덜 지우는 쪽을 고른다.
   */
  homeroomSince?: string | null;
  /**
   * 그 기록의 **자리 라벨**(`attendance_records.seat_label`, 0208a) — 있으면 자리 시수 행이다.
   *
   * 🔴 자리 기록은 **어느 강사 몫도 아니다** — 자리 슬롯에서 `resolveTaughtBy`가 `seat`로 비우는 것과 같은 결.
   *    슬롯으로만 판정하면 **그 반의 자리 교시 밖 시각**에 찍힌 자리 기록(자리 출석부 '다른 시간으로 옮기기',
   *    원장 2026-09-10)은 그 시각에 반 슬롯이 없어 **담임 폴백**을 타고 담임 몫 값이 된다 — 정산액(tier-rows)은
   *    `seat_label`로 그 행을 빼므로 화면 시수 ≠ 정산 시수가 된다.
   * ⚠️ 반별 보기(scope 없음)는 그대로 전부 그 반 몫이다 — 이 판정은 강사 렌즈에만 건다.
   * ⚠️ JJ실은 `seat_label`을 안 박는다(담임 시수와 같은 사실, `PAYROLL_SEAT_KEYS`) — 그래서 여기 안 걸린다.
   */
  seatLabel?: string | null;
  /**
   * 그 기록을 **어느 문이 썼나**(`attendance_records.recorded_via`, 0212a) — 자리 문이면 `"seat"`.
   *
   * 🔴 JJ실은 `seat_label`을 안 박으므로(위) 자리 판정이 **슬롯 매칭**에만 걸리는데, 그 매칭은 빠질 수 있다:
   *    자리판 '다른 시간으로 옮기기'로 그 반에 자리 슬롯이 없는 교시에 찍힌 기록 · 자리 슬롯이 `valid_to`로
   *    마감된 뒤 날짜의 기록 · 교시 시각 정정으로 `slot_start`가 슬롯과 어긋난 기록([[#106]]·[[#126]] 계열).
   *    그러면 담임 폴백을 타 **몫**이 되어 강사 보기 저장이 자리 기록을 덮었다(리뷰 2026-09-12).
   *    쓰기 시점에 굳는 이 값이 가장 튼튼한 신호라 **세 번째 자리 신호**로 합집합한다.
   * ⚠️ **null = 자리 아님** — 옛 스키마 폴백 insert(컬럼 부재, [[#95]])·이 컬럼 이전 기록은 비어 있다.
   *    비었다고 자리로 보면 반대 방향으로 틀린다(반 출석부 기록이 통째로 누구 몫도 아니게 된다).
   */
  recordedVia?: string | null;
}): boolean {
  if (!input.scopeTeacherId) return true;
  if (input.seatLabel?.trim()) return false;
  if (input.recordedVia === SEAT_VIA) return false;
  if (input.homeroomSince && input.date < input.homeroomSince) return false;
  if (!input.slotStart) return true;
  return (
    resolveTaughtBy({
      homeroomTeacherId: input.homeroomTeacherId,
      slots: input.slots,
      date: input.date,
      slotStart: input.slotStart,
    }).teacherId === input.scopeTeacherId
  );
}

/** 강사 렌즈에서 교시 한 칸의 몫 — 이 표의 주인 · 자리(JJ·랩실) · 그 밖(다른 선생님 교시 등). */
export type AttendanceSlotShare = "mine" | "seat" | "other";

/**
 * 강사 렌즈에서 이 교시가 **누구 몫인가**를 셋으로 가른다 — 몫(`mine`)은 위 `ownsAttendanceSlot`의 답 그대로이고,
 * 몫이 아닌 것만 **자리**와 **그 밖**으로 나눈다.
 *   · `mine`  = 이 표의 주인 몫(반별 보기는 전부 이것 — 위 함수와 같은 답)
 *   · `seat`  = 자리(JJ·랩실) — 자리 라벨이 박힌 행(랩실) 또는 그 교시가 자리 슬롯인 행(`resolveTaughtBy`의 `seat`)
 *   · `other` = 다른 선생님 교시 · 담당이 모호한 교시 · 담임이 되기 전 기록
 *
 * 🔴 원장 2026-09-12 *"jj는 개인강사 출석부에 넣음 안되지."* — 강사 보기 저장은 자리 행을 **아예 안 쓴다**(상태·메모·
 *    입력자·시수·지우기 전부). 다른 선생님 교시 행은 종전대로 상태를 함께 받으므로 저장·화면이 둘을 **갈라야** 한다.
 * ⚠️ JJ실은 `seat_label`을 안 박는다(위 `seatLabel` 주석) — 라벨만 보면 JJ 행을 놓친다. 그래서 **교시로도** 본다.
 * ⚠️ 몫 판정을 여기서 새로 짓지 않는다 — `mine`이면 자리 여부를 묻지 않는다(위 함수가 이긴다).
 */
export function attendanceSlotShare(input: Parameters<typeof ownsAttendanceSlot>[0]): AttendanceSlotShare {
  if (ownsAttendanceSlot(input)) return "mine";
  // 자리 표식 둘 — 랩실은 라벨(`seat_label`), JJ는 문(`recorded_via`). 슬롯 매칭보다 **먼저** 본다(위 주석의 세 경우).
  if (input.seatLabel?.trim() || input.recordedVia === SEAT_VIA) return "seat";
  // ⚠️ 한계: 같은 (반·요일·시각)에 자리 슬롯과 **사람 슬롯이 함께** 있으면 `resolveTaughtBy`가 사람 쪽을 택해
  //    여기서 자리로 안 잡힌다(현 데이터 0건, 리뷰 2026-09-12). 그 기록도 자리 문이 썼다면 위 `recordedVia`가
  //    먼저 걸러 주고, 둘 다 아니면 사람이 반 출석부에서 찍은 기록이라 실제로 그 사람 몫이 맞다.
  if (
    input.slotStart &&
    resolveTaughtBy({
      homeroomTeacherId: input.homeroomTeacherId,
      slots: input.slots,
      date: input.date,
      slotStart: input.slotStart,
    }).source === "seat"
  ) {
    return "seat";
  }
  return "other";
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

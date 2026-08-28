/**
 * 시간표(개발중) — DB 행 ↔ 계약(`types.ts`) 사이의 **순수** 변환·검증·집계.
 *
 * 서버 IO를 여기 두지 않는다(테스트가 DB 없이 돌아야 하고, 규칙이 쿼리·액션 양쪽에서 같아야 한다).
 * 🔴 시각은 **반드시 `hhmm()`**로 자른다 — 비교가 문자열 동등이라 DB의 'HH:MM:SS'와 폼의 'HH:MM'이
 *    섞이면 손대지 않은 칸까지 전부 '변경'으로 잡힌다(types.ts 주석).
 */
import {
  PLAN_DAYS,
  hhmm,
  isPlanMonth,
  type PlanDayOfWeek,
  type PlanMonthSummary,
  type PlanSlot,
  type PlanSlotInput,
} from "../types";

/** `timetable_plan_slots` 한 행(snake_case 원형). */
export type PlanSlotRow = {
  id: string;
  plan_month: string;
  class_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  teacher_id: string | null;
  classroom_id: string | null;
  slot_teacher_label: string | null;
  slot_room_label: string | null;
  period_label: string | null;
  merge_group: string | null;
  source_schedule_id: string | null;
};

/**
 * `PlanSlotRow`를 채우는 select 컬럼 목록 — 조회(queries)와 쓰기 후 반환(actions)이 **같은 문자열**을 쓴다.
 * 갈리면 한쪽만 새 컬럼을 못 받아 화면에서 그 값이 조용히 사라진다.
 *
 * ⚠️ **문자열 이어붙이기(`"a" + "b"`)로 쓰지 말 것** — supabase-js는 select 문자열의 **리터럴 타입**을 읽어
 * 반환 타입을 만드는데, `+`로 이으면 타입이 `string`으로 넓어져 결과가 `GenericStringError[]`가 된다
 * (typecheck가 즉시 터진다). 줄바꿈이 든 단일 템플릿 리터럴은 리터럴 타입을 유지한다.
 */
export const PLAN_SLOT_COLUMNS = `id, plan_month, class_id, day_of_week, start_time, end_time,
   teacher_id, classroom_id, slot_teacher_label, slot_room_label, period_label,
   merge_group, source_schedule_id`;

/** 월 목록 집계에 필요한 최소 컬럼(넓게 읽지 않는다 — B2). */
export type PlanMonthRow = { plan_month: string; class_id: string; updated_at: string | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 요일 문자열을 계약 타입으로 좁힌다(enum 값이 어긋나면 null — 조용히 'mon'으로 떨어뜨리지 않는다). */
export function toPlanDay(v: string | null | undefined): PlanDayOfWeek | null {
  return PLAN_DAYS.includes(v as PlanDayOfWeek) ? (v as PlanDayOfWeek) : null;
}

/** DB 행 → `PlanSlot`. 요일이 깨진 행은 담지 않는다(호출부가 filter로 걸러 쓴다). */
export function toPlanSlot(row: PlanSlotRow): PlanSlot | null {
  const day = toPlanDay(row.day_of_week);
  if (!day) return null;
  return {
    id: row.id,
    planMonth: row.plan_month,
    classId: row.class_id,
    dayOfWeek: day,
    startTime: hhmm(row.start_time),
    endTime: hhmm(row.end_time),
    teacherId: row.teacher_id ?? null,
    classroomId: row.classroom_id ?? null,
    slotTeacherLabel: row.slot_teacher_label ?? null,
    slotRoomLabel: row.slot_room_label ?? null,
    periodLabel: row.period_label ?? null,
    mergeGroup: row.merge_group ?? null,
    sourceScheduleId: row.source_schedule_id ?? null,
  };
}

/**
 * 월 목록 집계 — 달마다 칸 수·반 수·마지막 수정 시각. **최신 달이 위**(내림차순).
 * 빈 달(칸 0)은 행이 없으므로 여기서 만들어지지 않는다(계약 주석대로 0도 정상이지만, 그건 행이 남아 있는
 * 경우 — 전부 지운 달은 목록에서도 사라진다. 화면이 "만들기"를 다시 보여주는 게 맞다).
 */
export function summarizePlanMonths(rows: PlanMonthRow[]): PlanMonthSummary[] {
  const acc = new Map<string, { slots: number; classes: Set<string>; updatedAt: string | null }>();
  for (const r of rows) {
    if (!isPlanMonth(r.plan_month)) continue; // DB check가 막지만, 형식 밖 값이 목록·정렬을 어긋내지 않게
    let cur = acc.get(r.plan_month);
    if (!cur) {
      cur = { slots: 0, classes: new Set(), updatedAt: null };
      acc.set(r.plan_month, cur);
    }
    cur.slots += 1;
    if (r.class_id) cur.classes.add(r.class_id);
    // ISO 문자열은 사전식 비교가 곧 시간 비교(같은 UTC 표기라 안전).
    if (r.updated_at && (!cur.updatedAt || r.updated_at > cur.updatedAt)) cur.updatedAt = r.updated_at;
  }
  return [...acc.entries()]
    .map(([month, v]) => ({
      month,
      slotCount: v.slots,
      classCount: v.classes.size,
      updatedAt: v.updatedAt,
    }))
    .sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0));
}

/** 시드가 읽는 원본 한 줄(필요한 것만 — 유효구간 + 복사할 값). */
export type LiveScheduleRow = {
  id: string;
  class_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  teacher_id: string | null;
  classroom_id: string | null;
  slot_teacher_label: string | null;
  slot_room_label: string | null;
  period_label: string | null;
  merge_group: string | null;
  valid_from: string | null;
  valid_to: string | null;
};

/**
 * 🔴 **원본은 한 칸에 여러 줄일 수 있다** — `class_schedules`는 운영 이력을 함께 담아(#88) 담당·강의실이
 * 바뀌면 옛 행을 마감하고 새 행을 연다. 그 교체가 **이 달 안**에서 일어나면 같은
 * (반, 요일, 시작시각)이 두 줄 다 이 달과 겹친다 → 계획 표의 유니크
 * `(tenant, month, class, day, start)`에 그대로 넣으면 **INSERT 전체가 터진다**.
 *
 * 그래서 칸마다 한 줄만 남긴다. 남기는 기준 = **가장 늦게 시작한 행**(`valid_from` 최대) — 달 안에서
 * 교체가 있었다면 "그 달 이후로 계속 갈 배치"가 새 행이고, 다음 달 계획을 세우는 게 이 표의 존재
 * 이유이므로 최신 배치가 맞다. 같으면 `id`로 결정론적 tie-break(재실행 결과가 흔들리지 않게).
 */
export function dedupeLiveSchedules(rows: LiveScheduleRow[]): LiveScheduleRow[] {
  const best = new Map<string, LiveScheduleRow>();
  for (const r of rows) {
    const day = toPlanDay(r.day_of_week);
    if (!day) continue;
    const key = `${r.class_id}|${day}|${hhmm(r.start_time)}`;
    const cur = best.get(key);
    if (!cur) {
      best.set(key, r);
      continue;
    }
    const a = r.valid_from ?? "";
    const b = cur.valid_from ?? "";
    if (a > b || (a === b && r.id > cur.id)) best.set(key, r);
  }
  return [...best.values()];
}

/** 검증 결과 — 실패는 항상 **한글 사유**(UI에 raw 코드 노출 금지 규약). */
export type NormalizeResult =
  | { ok: true; value: PlanSlotInput }
  | { ok: false; error: string };

function cleanText(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim();
  return s.length > 0 ? s : null;
}

function cleanUuid(v: string | null | undefined): string | null | undefined {
  const s = String(v ?? "").trim();
  if (s.length === 0) return null;
  return UUID_RE.test(s) ? s : undefined; // undefined = 형식 오류(호출부가 에러로 승격)
}

/**
 * 화면이 넘긴 한 칸을 DB에 넣을 수 있는 모양으로 정규화 + 검증.
 * 🔑 시드(원본 복사)는 이 검증을 타지 않는다 — 이미 운영 중인 값을 그대로 옮기는 자리라, 여기서 막으면
 *    "현재 시간표는 되는데 복사는 안 되는" 상태가 된다. 검증은 **사람이 새로 적는 입력**에만 건다.
 */
export function normalizePlanSlotInput(input: PlanSlotInput): NormalizeResult {
  const classId = cleanUuid(input.classId);
  if (!classId) return { ok: false, error: "반을 선택해 주세요" };

  const day = toPlanDay(input.dayOfWeek);
  if (!day) return { ok: false, error: "요일이 올바르지 않습니다" };

  const startTime = hhmm(input.startTime);
  const endTime = hhmm(input.endTime);
  if (!HHMM_RE.test(startTime)) return { ok: false, error: "시작 시각이 올바르지 않습니다(예: 16:20)" };
  if (!HHMM_RE.test(endTime)) return { ok: false, error: "종료 시각이 올바르지 않습니다(예: 17:20)" };
  if (endTime <= startTime) return { ok: false, error: "종료 시각은 시작 시각보다 늦어야 합니다" };

  const teacherId = cleanUuid(input.teacherId);
  if (teacherId === undefined) return { ok: false, error: "강사 값이 올바르지 않습니다" };
  const classroomId = cleanUuid(input.classroomId);
  if (classroomId === undefined) return { ok: false, error: "강의실 값이 올바르지 않습니다" };
  const mergeGroup = cleanUuid(input.mergeGroup);
  if (mergeGroup === undefined) return { ok: false, error: "합반 묶음 값이 올바르지 않습니다" };
  const sourceScheduleId = cleanUuid(input.sourceScheduleId);
  if (sourceScheduleId === undefined) return { ok: false, error: "복사 출처 값이 올바르지 않습니다" };

  return {
    ok: true,
    value: {
      classId,
      dayOfWeek: day,
      startTime,
      endTime,
      teacherId,
      classroomId,
      slotTeacherLabel: cleanText(input.slotTeacherLabel),
      slotRoomLabel: cleanText(input.slotRoomLabel),
      periodLabel: cleanText(input.periodLabel),
      mergeGroup,
      sourceScheduleId,
    },
  };
}

import "server-only";
/**
 * 출결 쓰기의 **주체 판정 + 데스크 게이트** — setAttendanceCell/Bulk가 공유.
 *
 * 화면에서만 막으면 우회된다(#77). 강사는 제한 없고, 데스크(그 반 담당이 아닌 full)만
 * `canDeskMark`와 같은 판정을 서버가 다시 한다.
 * 🔴 게이트는 `source:"live"`(당일 출결)에만. 월간 격자 정정을 막지 않는다(#103).
 */
import { createClient } from "@/lib/supabase/server";
import { getTeachingClassIds } from "@/features/classes/server/delegation";
import { kstMinutesOfDay, kstToday, weekdayIndexOf } from "@/lib/date-kst";
import { deskWriteDenied, shouldEnforceDeskGate } from "../mark-state";
import { resolveStaffVia, type RecordedVia } from "../recorded-via";
import { hhmm, hhmmToMin, slotPhase, type SlotPhase } from "../signals";

const DOW_ENUM = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
type Sb = Awaited<ReturnType<typeof createClient>>;

/**
 * 이 사람이 그날 가르치는 반(담임 ∪ 위임 ∪ 부담임 슬롯).
 * `strict` = 쓰기 판정·입력자 표식 — 조회 실패를 "담당 반 없음"으로 읽지 않고 던진다. 예전엔 시간표 조회 오류를 버려
 * 담당 강사의 저장이 "담당 반이 아닙니다"로 막히거나 입력자 표식(`recorded_via`)이 데스크로 잘못 찍혔다(수정 계획 P1-A).
 * 읽기 화면은 기존 동작(빈 명단) 그대로 둔다.
 */
export async function userTaughtClassSet(
  supabase: Sb,
  userId: string,
  date: string,
  strict = false,
): Promise<Set<string>> {
  const [teaching, slotRes] = await Promise.all([
    getTeachingClassIds(supabase, userId, date, strict),
    supabase
      .from("class_schedules")
      .select("class_id")
      .eq("teacher_id", userId)
      .lte("valid_from", date)
      .or(`valid_to.is.null,valid_to.gte.${date}`),
  ]);
  if (strict && slotRes.error) throw slotRes.error;
  return new Set([
    ...teaching.all,
    ...((slotRes.data ?? []) as { class_id: string }[]).map((r) => r.class_id),
  ]);
}

export async function userTeachesClass(
  supabase: Sb,
  userId: string,
  classId: string,
  date: string,
): Promise<boolean> {
  // 입력자 표식(resolveWriteVia)이 쓴다 — 틀리면 기록에 남으니 strict.
  return (await userTaughtClassSet(supabase, userId, date, true)).has(classId);
}

export async function resolveWriteVia(
  supabase: Sb,
  userId: string,
  classId: string,
  date: string,
): Promise<RecordedVia> {
  return resolveStaffVia(await userTeachesClass(supabase, userId, classId, date));
}

/**
 * 그 반·그날의 교시 시각. `periodStart`가 있으면 그 교시, 없으면 가장 이른 교시.
 * 시간표에 없는 날(보강)은 null — 호출부가 10분 선을 적용하지 않는다.
 */
export async function lookupPeriodPhase(
  supabase: Sb,
  classId: string,
  date: string,
  periodStart?: string | null,
): Promise<SlotPhase> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "before";
  const today = kstToday();
  if (date < today) return "ended";
  if (date > today) return "before";

  const dayEnum = DOW_ENUM[weekdayIndexOf(date)];
  const { data, error } = await supabase
    .from("class_schedules")
    .select("start_time, end_time")
    .eq("class_id", classId)
    .eq("day_of_week", dayEnum)
    .lte("valid_from", date)
    .or(`valid_to.is.null,valid_to.gte.${date}`);
  if (error || !data) return "ended";
  const rows = (data as { start_time: string; end_time: string | null }[]).map((r) => ({
    start: hhmm(r.start_time),
    end: r.end_time ? hhmm(r.end_time) : null,
  }));
  const hit = periodStart
    ? rows.find((r) => r.start === periodStart)
    : [...rows].sort((a, b) => (a.start < b.start ? -1 : 1))[0];
  if (!hit) return "ended"; // 시간표에 없음 = 보강 등. 유예 선을 적용할 시각이 없다 → 미출결로 본다.
  const start = hhmmToMin(hit.start);
  if (start == null) return "ended";
  return slotPhase(kstMinutesOfDay(), start, hhmmToMin(hit.end));
}

/**
 * 데스크 쓰기 허용 여부. 강사(via=teacher)는 무조건 통과.
 * 거절 메시지는 `deskMarkDeniedReason`과 같다 — 화면과 서버가 같은 말.
 *
 * 🔴 `source !== "live"`면 검사하지 않는다. 월간 출석부·원스크린·시트가 같은 액션을 쓰는데
 *    via=desk로 정정·삭제를 막으면 원장부터 오클릭한 결석을 못 되돌린다(#103).
 */
export async function assertDeskMayWrite(input: {
  supabase: Sb;
  via: RecordedVia;
  classId: string;
  date: string;
  periodStart?: string | null;
  currentStatus: string | null;
  /** 지우기(null)는 데스크 범위가 아니다. */
  nextStatus: string | null;
  /** 당일 출결 화면만 `"live"`. 없으면 게이트 없음(recorded_via 스탬프는 그대로). */
  source?: string | null;
}): Promise<{ error: string } | { ok: true }> {
  // 국면 조회는 당일 데스크 쓰기에만. 월간 정정이 시간표 lookup에 묶이면 안 된다.
  const phase =
    shouldEnforceDeskGate(input.source) && input.via === "desk" && input.nextStatus !== null
      ? await lookupPeriodPhase(input.supabase, input.classId, input.date, input.periodStart)
      : "ended";
  const reason = deskWriteDenied({
    source: input.source,
    via: input.via,
    currentStatus: input.currentStatus,
    nextStatus: input.nextStatus,
    phase,
  });
  return reason ? { error: reason } : { ok: true };
}

/** 컬럼 부재(#95) — 0212a 미적용이어도 출결 저장은 살아야 한다. */
export function isMissingViaColumn(message: string): boolean {
  return /recorded_via/i.test(message);
}

export function withVia<T extends Record<string, unknown>>(row: T, via: RecordedVia): T & { recorded_via: RecordedVia } {
  return { ...row, recorded_via: via };
}

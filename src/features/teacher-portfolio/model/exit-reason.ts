/**
 * 그만둔 수강 한 줄의 '강사 탓이 아닌 사유' 판정 — 퇴원율(`churn.ts`)과 학생 배정·유지(`students.ts`)가 **같이 쓴다**(순수).
 *
 * 🔴 원장 2026-10-14 *"이사 졸업 이런건은 퇴원율로 잡지 않는다"* · *"모든 곳에서"* → 배정·유지에도 *"사유 규칙 적용"*.
 * - 사유 = 그 수강의 종료 사유 · (퇴원일 때) 학생의 퇴원 사유 — 둘 중 하나라도 원장이 고른 사유면 그 키(`excludedReasonOf`).
 * - '퇴원' = 그날 뒤에도 다니는(또는 31일 안에 시작하는) 다른 수강이 없다(`stillAttending` — 퇴원율의 '다님'과 한 벌).
 * - 학생의 퇴원 사유를 쓰는 때(`studentReasonAt`): 수강이 '퇴원에 따른 자동 종료'로 닫혔다(그 퇴원 때문에 닫힌 줄) · 퇴원일이
 *   그만둔 날 ±14일 안 · 사유 없이 끝난 줄이 그 퇴원과 함께 끝난 수강(`endedWithWithdrawal` — 시간표 X와 같은 `endedWithExit`,
 *   120일 · 그 사이 다시 등록했으면 아님) · 퇴원일 기록이 없는 옛 학생은 수강 사유가 비었을 때.
 *   🔴 사유 없이 그만둔 5월을 9월에 '이사'로 퇴원한 사유가 면제하지 않게 · 수강종료로 남았다 늦게 퇴원 처리된 것은 면제하게
 *   (시간표 X·급여명세서와 같은 결론 — 적대적 리뷰 2026-10-14).
 */
import { isSpecialLecture } from "@/features/classes/special-lecture";
import { OVERLAY_LOOKBACK_DAYS } from "@/features/withdrawals/exit-overlay-teachers";
import { endedWithExit, excludedReasonOf } from "@/features/withdrawals/reason-key";
import type { WithdrawalReason } from "@/features/withdrawals/types";
import { addDays } from "./dates";
import type { SnapshotClass, SnapshotEnrollment } from "./types";

export const AUTO_END_TEXT = "퇴원에 따른 자동 종료";
export type StudentReason = { id: string; reason: string | null; withdrawn_at?: string | null };
type Classes = ReadonlyMap<string, SnapshotClass>;
/** '곧 다님'의 끝 — 그만둔 날부터 31일 안에 시작하는 수강까지. 몇 달 뒤 재등록은 '다님'이 아니다. */
export const SOON_DAYS = 31;

const reasonCache = new WeakMap<readonly StudentReason[], Map<string, StudentReason>>();
const NO_REASONS: StudentReason[] = [];
/** 학생 id → 퇴원 사유(같은 배열은 한 번만 접는다). */
export function reasonsOf(rows: readonly StudentReason[] | undefined): Map<string, StudentReason> {
  const list = rows ?? NO_REASONS;
  let map = reasonCache.get(list);
  if (!map) reasonCache.set(list, (map = new Map(list.map((r) => [r.id, r]))));
  return map;
}

/**
 * 그날 뒤에도 다니는(또는 31일 안에 시작하는) 다른 수강 — 휴원도 다님(퇴원관리와 같다) · 취소된 미래 수강(종료일 ≤ 시작일)·
 * 보강 반·닫힌 반은 뺀다. 끝난 수강은 줄(id)로 뺀다 — 같은 반에 다음 날 다시 등록한 것은 '다님'이다.
 */
export function stillAttending(history: readonly SnapshotEnrollment[], classes: Classes, day: string, endedIds: ReadonlySet<string>): SnapshotEnrollment[] {
  const soon = addDays(day, SOON_DAYS);
  return history.filter((x) => {
    const c = classes.get(x.class_id);
    return !endedIds.has(x.id) && !c?.is_makeup_pool && (!c?.closed_at || c.closed_at > day) && x.start_date <= soon
      && (!x.end_date || (x.end_date > day && x.end_date > x.start_date));
  });
}

/** 이 줄이 그 퇴원(퇴원일)과 함께 끝난 같은 과목 수강인가 — 시간표 X와 같은 판정(보강 묶음·특강은 기준이 아님 · 종료일 있는 줄만). */
export function endedWithWithdrawal(row: SnapshotEnrollment, history: readonly SnapshotEnrollment[], classes: Classes, withdrawnDay: string): boolean {
  const subject = classes.get(row.class_id)?.subject;
  const ref = (id: string) => {
    const c = classes.get(id);
    return c && { closedAt: c.closed_at, regular: !c.is_makeup_pool && !isSpecialLecture({ isSpecial: c.is_special, className: c.class_name }) };
  };
  const rows = history.filter((e) => e.end_date && classes.get(e.class_id)?.subject === subject)
    .map((e) => ({ id: e.id, classId: e.class_id, startDate: e.start_date, endDate: e.end_date }));
  return endedWithExit(rows, withdrawnDay, ref, OVERLAY_LOOKBACK_DAYS).some((r) => r.id === row.id);
}

/** 이 그만둠에 쓸 학생 퇴원 사유(위 머리말의 때) — `together(퇴원일)` = 사유 없이 끝난 줄이 그 퇴원과 함께 끝났나. */
export function studentReasonAt(
  type: "퇴원" | "수강종료", s: StudentReason | undefined, text: string | null, exitDay: string, together?: (withdrawnDay: string) => boolean,
): string | null {
  if (type !== "퇴원" || !s) return null;
  if (text === AUTO_END_TEXT) return s.reason;
  const at = s.withdrawn_at?.slice(0, 10);
  if (!at) return text ? null : s.reason;
  if (at >= addDays(exitDay, -14) && at <= addDays(exitDay, 14)) return s.reason;
  return !text && together?.(at) ? s.reason : null;
}

/** 그만둔 수강 한 줄이 원장이 고른 사유인가 — 그 키, 아니면 null(퇴원율은 줄마다 판정해 하나라도 남으면 센다). */
export function excusedReasonOf(input: {
  text: string | null; type: "퇴원" | "수강종료"; student: StudentReason | undefined; exitDay: string; excludeReasons: readonly string[];
  together?: (withdrawnDay: string) => boolean;
}): WithdrawalReason | null {
  const student = studentReasonAt(input.type, input.student, input.text, input.exitDay, input.together);
  return excludedReasonOf([input.text, student], input.excludeReasons);
}

/**
 * 학생 배정·유지 — 그날 끝난 수강 줄이 **모두** 고른 사유일 때만 그 키(하나라도 아니면 감점한다). 퇴원인지는 퇴원율과 같은
 * `stillAttending`으로 본다(배정·유지의 '퇴원' 표시는 그날 유효한 수강만 봐서 더 넓다 — 다음 날 시작하는 다른 과목이 있어도 퇴원).
 */
export function excusedExitOf(input: {
  ended: readonly SnapshotEnrollment[]; history: readonly SnapshotEnrollment[]; classes: Classes;
  student: StudentReason | undefined; exitDay: string; excludeReasons: readonly string[];
}): WithdrawalReason | null {
  const { ended, history, classes, exitDay } = input;
  if (!input.excludeReasons.length || !ended.length) return null;
  const type = stillAttending(history, classes, exitDay, new Set(ended.map((e) => e.id))).length ? "수강종료" : "퇴원";
  const keys = ended.map((e) => excusedReasonOf({
    ...input, type, text: e.withdrawal_reason?.trim() || null, together: (at) => endedWithWithdrawal(e, history, classes, at),
  }));
  return keys.every(Boolean) ? keys[0]! : null;
}

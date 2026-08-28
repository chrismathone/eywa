import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { isPlanMonth, type PlanMonthSummary, type PlanSlot } from "../types";
import {
  PLAN_SLOT_COLUMNS,
  summarizePlanMonths,
  toPlanSlot,
  type PlanMonthRow,
  type PlanSlotRow,
} from "../lib/plan-row";
import { requireTimetablePlanAccess } from "./access";

/**
 * 시간표(개발중) 월별 계획 조회.
 *
 * 🔴 `timetable_plan_slots`는 RLS 정책 0개 + service_role 전용(0231a)이라 **세션 클라이언트로는 에러 없이
 *    0행**이 온다([[#104]]) → admin 클라이언트로 읽되 **`tenant_id` 명시 필터가 필수**다(RLS 우회이므로
 *    빠뜨리면 전 학원 데이터가 섞인다). 권한은 DB가 아니라 `requireTimetablePlanAccess`가 유일하게 판정한다.
 *
 * ⚠️ 게이트 실패는 **throw**한다 — "권한 없음"을 빈 배열로 돌려주면 화면이 "계획이 없음"으로 위장한다(#89).
 *    페이지는 `requireTimetablePlanAccess()`로 **먼저** 게이트해 한글 배너를 그리고, 통과했을 때만 이 함수를
 *    부를 것(그러면 여기 throw는 실제 사고일 때만 터진다).
 */

/** 게이트 통과 + admin 클라이언트 + 신뢰 tenantId를 한 번에. */
async function planReader(): Promise<{ admin: ReturnType<typeof createAdminClient>; tenantId: string }> {
  const gate = await requireTimetablePlanAccess();
  if (!gate.ok) throw new Error(gate.error);
  return { admin: createAdminClient(), tenantId: gate.access.tenantId };
}

const MONTH_COLUMNS = "plan_month, class_id, updated_at";

/**
 * 있는 달 목록(최신순) — 달마다 칸 수·반 수·마지막 수정 시각.
 *
 * **B2 근거(왜 전건을 읽어도 되는가)**: 집계 축이 "존재하는 모든 달"이라 어떤 필터로도 미리 좁힐 수 없다
 * (달 목록 자체가 결과다). group-by RPC가 정석이지만 0231a는 RPC를 만들지 않았고, 대신 이 조회는
 *  ① **`fetchAllPaged`로 `.range` 페이지네이션** — PostgREST 1000행 silent 절단이 구조적으로 불가능하고
 *  ② 컬럼을 **3개로 좁혀** 읽는다(격자 전체가 아니라 집계에 필요한 것만)
 *  ③ 규모 상한이 명확하다 — 한 달 계획은 본 시간표 슬롯 수(실측 `class_schedules` 1,068행, 그중 현재
 *     유효분은 절반 남짓)를 넘지 않고, 계획은 보통 이번·다음·다다음 달 정도만 유지한다 → 수천 행 규모.
 * 🔴 규모가 커져 이 조회가 눈에 띄면 **JS 집계를 늘리지 말고 group-by RPC**(0039a/0040a 패턴)로 옮길 것.
 *
 * ⚠️ 페이지 경계가 흔들리지 않게 정렬에 **유니크 tie-break(`id`)**를 포함한다(OFFSET 페이지네이션의 전제).
 */
export const getPlanMonths = cache(async (): Promise<PlanMonthSummary[]> => {
  const { admin, tenantId } = await planReader();
  const rows = await fetchAllPaged<PlanMonthRow>((from, to) =>
    admin
      .from("timetable_plan_slots")
      .select(MONTH_COLUMNS)
      .eq("tenant_id", tenantId)
      .order("plan_month", { ascending: false })
      .order("id")
      .range(from, to),
  );
  return summarizePlanMonths(rows);
});

/**
 * 그 달의 계획 전체(격자 한 장).
 * 한 달이 1000칸을 넘을 수 있으므로(반 × 요일 × 교시) **`fetchAllPaged` 필수** — bare select면 조용히 잘린다(B2).
 * 정렬은 요일(enum 정의 순 mon→sun) → 시작시각 → 유니크 tie-break(`id`).
 */
export async function getPlanSlots(month: string): Promise<PlanSlot[]> {
  if (!isPlanMonth(month)) return [];
  const { admin, tenantId } = await planReader();
  const rows = await fetchAllPaged<PlanSlotRow>((from, to) =>
    admin
      .from("timetable_plan_slots")
      .select(PLAN_SLOT_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("plan_month", month)
      .order("day_of_week")
      .order("start_time")
      .order("id")
      .range(from, to),
  );
  // 요일 enum이 깨진 행은 담지 않는다(toPlanSlot null) — 시각은 그 안에서 hhmm()으로 정규화된다.
  return rows.map(toPlanSlot).filter((s): s is PlanSlot => s !== null);
}

/**
 * 한 달에 칸이 몇 개인지만 — "이미 계획이 있는가" 판정 전용.
 * 행을 **한 줄도 받지 않는다**(`count: exact, head: true`) — 세려고 전건을 끌어오지 않는다는 B2의 정석.
 */
export async function countPlanSlots(month: string): Promise<number> {
  if (!isPlanMonth(month)) return 0;
  const { admin, tenantId } = await planReader();
  const { count, error } = await admin
    .from("timetable_plan_slots")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("plan_month", month);
  if (error) throw new Error(`계획 칸 수 조회 실패: ${error.message}`);
  return count ?? 0;
}

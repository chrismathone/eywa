"use server";

/**
 * **하루치 수업계획 조회** — 월간 뷰에서 그 날짜를 그 자리에서 고칠 때(더블클릭) 쓰는 재료.
 *
 * 🔑 새 저장 경로가 아니다 — 읽기 하나뿐이고, 고치는 건 기존 기계(`SlotPlanBlock` → `ECS_PLAN_API` →
 *    `flushSheetPatches`·`ecs_*` RPC)가 그대로 한다. 게이트도 주간·월간과 **같은** `requireEcsClassAccess`.
 *
 * 🔴 **월간 조회가 준 줄을 그대로 편집기에 넘기면 안 된다.** [`getClassSheetMonth`](./month-queries.ts)는
 *    훑는 화면을 위해 **빈 줄(영역만 고른 placeholder)과 고아 줄을 일부러 걸러서** 준다. 그 목록을
 *    편집기에 심으면 ① 서버엔 있는 빈 줄이 화면에 없어 "+ 줄 추가"가 같은 자리를 또 만들고
 *    ② CAS 기대값(seed)이 그 줄만 비어 첫 저장이 충돌로 뜬다. 그래서 편집기는 **거르지 않은 원본**을
 *    여기서 다시 읽는다.
 * 🔴 `class_sheet_*`는 RLS 정책이 0개라 세션 클라이언트로 읽으면 **에러 없이 0행**([[#104]]) →
 *    admin 클라이언트 + `tenant_id` 명시 필터.
 * ⚠️ 한 반·하루는 교시 2~4개 × 줄 몇 개(실측 최대 20행대)라 페이지네이션이 필요 없다 — 이 조회로
 *    무엇을 **세지도 집계하지도 않는다**(B2는 집계·distinct 용도의 무페이징 select를 막는 규칙이다).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { mondayOf } from "@/features/timetable/lib/week";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { planLineFromRow } from "../lib/plan-line";
import { normalizeSlotTime, YMD_RE } from "../lib/week";
import type { PlanLineDTO } from "./actions";
import { requireEcsClassAccess } from "./access";

export type EcsDayPlan = {
  /** 저널(IndexedDB)·presence 키의 축 — 주간 시트와 **같은 값**이어야 두 화면이 서로를 본다. */
  tenantId: string;
  userId: string;
  weekMonday: string;
  canEdit: boolean;
  /** '내신' 구획을 그릴지 — EiE 반은 초등이라 내신이 없다(판정은 `classes.english_track` 컬럼뿐). */
  showExamTerm: boolean;
  skillAreas: SkillAreaSetting[];
  /** `HH:MM` → 그 교시의 계획 줄 전부(**거르지 않은 원본**, line_no 순). */
  linesBySlot: Record<string, PlanLineDTO[]>;
};

export type EcsDayPlanResult = { ok: true; data: EcsDayPlan } | { ok: false; error: string };

export async function getEcsDayPlan(input: {
  classId: string;
  planDate: string;
}): Promise<EcsDayPlanResult> {
  if (!YMD_RE.test(input.planDate)) return { ok: false, error: "날짜가 올바르지 않습니다" };

  const gate = await requireEcsClassAccess(input.classId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const access = gate.access;

  let rows: Record<string, unknown>[];
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("class_sheet_plan_lines")
      .select("*")
      .eq("tenant_id", access.tenantId)
      .eq("class_id", input.classId)
      .eq("plan_date", input.planDate)
      .order("slot_start")
      .order("term_mode")
      .order("line_no")
      .order("id"); // 같은 line_no가 둘이어도 순서가 흔들리지 않게
    if (error) throw error;
    rows = data ?? [];
  } catch (e) {
    reportError(e, { scope: "class-sheets.day-plan", classId: input.classId, planDate: input.planDate });
    return { ok: false, error: "수업계획을 불러오지 못했습니다" };
  }

  const linesBySlot: Record<string, PlanLineDTO[]> = {};
  for (const row of rows) {
    const dto = planLineFromRow(row);
    (linesBySlot[normalizeSlotTime(dto.slotStart)] ??= []).push(dto);
  }

  return {
    ok: true,
    data: {
      tenantId: access.tenantId,
      userId: access.user.id,
      weekMonday: mondayOf(input.planDate),
      canEdit: access.canWrite,
      showExamTerm: access.englishTrack !== "eie",
      skillAreas: access.skillAreas,
      linesBySlot,
    },
  };
}

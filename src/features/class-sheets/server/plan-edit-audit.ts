import "server-only";

/**
 * 수업계획 **칸 값** 감사로그 — 칸을 떠날 때 한 줄(원장 결정 2026-09-14, 범위 확대: 교재·진도·과제 등).
 *
 * 🔑 문이 둘이다 — 로그인 영어 시트(`commitSheetEdits`, ECS 게이트)와 비로그인 공개 자리 화면(`commitSeatPlanEdits`,
 *    PIN·오늘·그 교시 명단). 게이트는 각 문이 하고 **기록 규칙은 여기 한 벌**이다(`plan-write.ts`와 같은 구조).
 * 🔴 **이 사람이 마지막으로 쓴 줄만** 적는다(`updated_by === grant.actorId`, PIN 문은 둘 다 null). 계획 칸은 CAS라
 *    남이 먼저 고치면 내 입력은 충돌로 멈추고, 거기서 '서버값 사용'을 누르면 DB 값은 **남이 쓴 값**이다 — 이 조건이
 *    없으면 그 변경이 이 사람 이름으로 남는다.
 *    ⚠️ 대신 내가 쓴 직후 같은 줄의 **다른 칸**을 남이 저장하면(updated_by는 행 단위) 내 줄이 빠진다 — 드묾.
 * 🔴 범위(scope)가 있는 문(PIN = 오늘·그 교시)은 그 밖 줄을 적지 않는다(쓰기 게이트와 같은 범위).
 * 🔑 구분(`skill_area`)은 영역 **키**라 기록할 때 학원설정 라벨로 바꿔 싣는다(raw 키 노출 금지).
 * 🔴 계획 칸 **저장**(`applyPlanPatches`)은 여전히 기록하지 않는다 — 타이핑 디바운스마다 불린다.
 * best-effort — 실패해도 편집을 막지 않는다. 호출부가 응답 뒤(`after`)에 부른다.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction, logActionAtDoor } from "@/features/audit/server/log";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { skillAreaLabelOf } from "@/features/owner/skill-areas";
import { auditValueChanged, clipAuditValue, PLAN_FIELD_LABEL, type SheetEdit } from "../lib/edit-audit";
import type { PlanPatchField } from "../lib/plan-codec";
import type { PlanWriteGrant, PlanWriteScope } from "./plan-write";

type PlanRow = Record<string, unknown> & {
  id: string;
  class_id: string;
  plan_date: string;
  slot_start: string;
  updated_by: string | null;
};

export async function logPlanCellEdits(input: {
  grant: PlanWriteGrant;
  skillAreas: readonly SkillAreaSetting[];
  edits: SheetEdit[];
  scope?: PlanWriteScope;
}): Promise<void> {
  const { grant } = input;
  const cells = input.edits.flatMap((e) => (e.cell.kind === "plan" ? [{ cell: e.cell, before: e.before }] : []));
  if (cells.length === 0) return;
  try {
    const ids = [...new Set(cells.map((c) => c.cell.lineId))];
    // 한 요청은 ≤ SHEET_EDIT_BATCH_MAX(20)칸이라 단일 `.in`으로 충분하다(B3의 수십+ 기준 아래).
    const { data, error } = await createAdminClient()
      .from("class_sheet_plan_lines")
      .select("id, class_id, plan_date, slot_start, updated_by, skill_area, textbook, page_range, progress, homework")
      .eq("tenant_id", grant.tenantId)
      .eq("class_id", grant.classId)
      .in("id", ids);
    if (error) return;
    const rows = new Map(((data ?? []) as PlanRow[]).map((r) => [String(r.id), r]));
    const shown = (field: PlanPatchField, v: string | null) =>
      field === "skill_area" && v ? skillAreaLabelOf(input.skillAreas, v).label : v;

    for (const { cell, before } of cells) {
      const row = rows.get(cell.lineId);
      if (!row) continue;
      const planDate = String(row.plan_date).slice(0, 10);
      const slotStart = String(row.slot_start ?? "").slice(0, 5);
      if (input.scope && (planDate !== input.scope.planDate || slotStart !== input.scope.slotStart.slice(0, 5))) {
        continue;
      }
      if ((row.updated_by ?? null) !== (grant.actorId ?? null)) continue;
      const raw = row[cell.field];
      const nextValue = typeof raw === "string" ? raw : null;
      if (!auditValueChanged(before, nextValue)) continue;
      const metadata = {
        classId: grant.classId,
        kind: "plan",
        lineId: cell.lineId,
        planDate,
        slotStart,
        field: cell.field,
        fieldLabel: PLAN_FIELD_LABEL[cell.field],
        before: clipAuditValue(shown(cell.field, before)),
        after: clipAuditValue(shown(cell.field, nextValue)),
        ...(grant.actorId ? {} : { viaPin: true }),
      };
      if (grant.actorId) {
        await logAction({ action: "ecs_plan_cell_edit", targetType: "class_sheet_plan", metadata });
      } else {
        await logActionAtDoor(
          { tenantId: grant.tenantId, doorName: grant.doorName ?? "자리 PIN(비로그인)" },
          { action: "ecs_plan_cell_edit", targetType: "class_sheet_plan", metadata },
        );
      }
    }
  } catch {
    // 감사 기록 실패는 편집을 막지 않는다(best-effort — logAction과 같은 규약).
  }
}

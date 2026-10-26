"use server";

/**
 * **배정 삭제 되돌리기** 서버 액션(원장 2026-10-19) — 지운 배정 한 줄을 되살리고, 함께 지운 진도 줄·표식을
 * [`restoreShiftState`](./shift-undo-core.ts)로 돌려놓는다.
 *
 * 🔴 게이트는 그 반의 ECS 쓰기 권한(삭제와 같은 문) — 서버 액션은 공개 엔드포인트다([[#77]]).
 * 🔴 재료는 **클라가 들고 온 값**이다 — 반은 게이트가 연 반으로 고정하고(tenant는 서버가 채운다), 교재가 이 학원
 *    것인지 다시 확인하며, 값 모양을 전부 검사한다. 배정을 직접 저장할 수 있는 사람보다 넓은 일은 못 한다.
 * ⚠️ 배정을 먼저 되살린다 — 줄 되돌리기가 거절돼도(그 사이 바뀜) 배정은 돌아오고, 그 사실을 알린다.
 */
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { requireEcsClassAccess } from "@/features/class-sheets/server/access";
import type { ShiftUndoToken } from "../shift-undo";
import type { PlanRestoreRow } from "../types";
import { normalizeSlotPicks } from "../lesson-schedule";
import { placeSameBookPlan } from "../plan-siblings";
import { friendlyTextbookError } from "./access";
import { isModuleOnForTenant } from "@/features/owner/server/modules";
import { restoreShiftState, validToken } from "./shift-undo-core";
import { claimHistory, releaseHistory } from "./import-batch";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function validPlan(p: unknown, classId: string): p is PlanRestoreRow {
  if (!p || typeof p !== "object") return false;
  const r = p as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    UUID.test(r.id) &&
    r.class_id === classId &&
    typeof r.textbook_id === "string" &&
    UUID.test(r.textbook_id) &&
    (r.slot_axis === "class" || r.slot_axis === "jj") &&
    (r.pace === "period" || r.pace === "day" || r.pace === "min25") &&
    (r.term_mode === "regular" || r.term_mode === "exam") &&
    typeof r.start_date === "string" &&
    YMD.test(r.start_date) &&
    Number.isInteger(r.start_lesson_no) &&
    (r.start_lesson_no as number) >= 1 &&
    (r.start_lesson_no as number) <= 200 &&
    (r.slot_picks === null || (Array.isArray(r.slot_picks) && r.slot_picks.length <= 48 && r.slot_picks.every((v) => typeof v === "string"))) &&
    typeof r.is_active === "boolean" &&
    (r.last_applied_at === null || (typeof r.last_applied_at === "string" && !Number.isNaN(Date.parse(r.last_applied_at)))) &&
    (r.last_applied_by === null || (typeof r.last_applied_by === "string" && UUID.test(r.last_applied_by))) &&
    (r.created_by === null || (typeof r.created_by === "string" && UUID.test(r.created_by)))
  );
}

export async function undoPlanDelete(input: {
  classId: string;
  plan: PlanRestoreRow;
  lines?: ShiftUndoToken;
  /** 이 삭제의 히스토리 기록(원장 2026-10-26) — 알림 [되돌리기]가 넘긴다(`undoLessonShift`와 같은 짝). */
  historyId?: string | null;
}): Promise<{ ok: true; warning?: string } | { ok: false; error: string }> {
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!validPlan(input.plan, input.classId)) return { ok: false, error: "되돌릴 기록이 올바르지 않습니다" };
  if (input.lines && !validToken(input.lines, input.classId)) return { ok: false, error: "되돌릴 기록이 올바르지 않습니다" };
  const admin = createAdminClient();
  const tenantId = gate.access.tenantId;
  const p = input.plan;
  // 다른 배정 액션과 같은 문 — 교재목록 모듈을 끈 학원에선 돌지 않는다(감사 S7).
  if (!(await isModuleOnForTenant(tenantId, "textbooks"))) return { ok: false, error: "이 학원은 교재목록 기능이 꺼져 있습니다" };

  // 교재가 이 학원 것인가(admin 조회라 RLS가 안 걸린다).
  const { data: book, error: bookErr } = await admin
    .from("textbooks")
    .select("id, skill_area")
    .eq("tenant_id", tenantId)
    .eq("id", p.textbook_id)
    .maybeSingle();
  if (bookErr) return { ok: false, error: friendlyTextbookError(bookErr, "되돌리지 못했습니다") };
  if (!book) return { ok: false, error: "교재를 찾을 수 없어 되돌리지 않았습니다" };
  if (!book.skill_area) return { ok: false, error: "이 교재에 구분이 없어 배정을 되살릴 수 없습니다" };

  const picks = p.slot_picks ? normalizeSlotPicks(p.slot_picks) : [];

  const historyId = input.historyId && UUID.test(input.historyId) ? input.historyId : null;
  if (historyId) {
    const claim = await claimHistory(admin, tenantId, input.classId, historyId, gate.access.user.id);
    if (claim === "taken") return { ok: false, error: "이미 되돌렸습니다" };
  }
  const fail = async (error: string) => {
    if (historyId) await releaseHistory(admin, tenantId, historyId).catch(() => undefined);
    return { ok: false as const, error };
  };

  // 🔴 같은 교재 배정 규칙(3개까지 · 교시 안 겹침, 2026-10-21)을 되살리기에도 건다 — 옛 유니크가 막아 주던 자리다.
  //    그 사이 같은 교시에 같은 교재를 다시 걸었으면 되살리면 한 칸에 같은 교재가 두 벌이 된다.
  const sib = await admin
    .from("class_textbook_plans")
    .select("id, slot_picks")
    .eq("tenant_id", tenantId)
    .eq("class_id", input.classId)
    .eq("textbook_id", p.textbook_id)
    .eq("is_active", true);
  if (sib.error) return fail(friendlyTextbookError(sib.error, "되돌리지 못했습니다"));
  const placement = placeSameBookPlan({
    picks: picks.length > 0 ? picks : null,
    siblings: (sib.data ?? []).map((r) => ({
      id: String(r.id),
      slotPicks: Array.isArray(r.slot_picks) && r.slot_picks.length > 0 ? (r.slot_picks as unknown[]).map(String) : null,
    })),
  });
  if (placement.kind === "error") return fail(`되돌리지 않았습니다 — ${placement.error}`);
  if (placement.kind === "update") {
    return fail("그 사이 같은 교재가 같은 교시에 다시 배정돼 있어 되돌리지 않았습니다");
  }
  const { error } = await admin.from("class_textbook_plans").insert({
    id: p.id,
    tenant_id: tenantId,
    class_id: input.classId,
    textbook_id: p.textbook_id,
    slot_axis: p.slot_axis,
    pace: p.pace,
    term_mode: p.term_mode,
    start_date: p.start_date,
    start_lesson_no: p.start_lesson_no,
    is_active: p.is_active,
    // 원래 배정 그대로 — 만든 사람·마지막 적용 기록을 되돌리기 누른 사람으로 바꾸지 않는다.
    created_by: p.created_by,
    last_applied_at: p.last_applied_at,
    last_applied_by: p.last_applied_by,
    ...(picks.length > 0 ? { slot_picks: picks } : {}),
  });
  if (error) {
    return fail(
      friendlyTextbookError(error, "배정을 되살리지 못했습니다", "그 사이 같은 교재가 다시 배정돼 있어 되돌리지 않았습니다"),
    );
  }

  let warning: string | undefined;
  if (input.lines) {
    const res = await restoreShiftState({ admin, tenantId, classId: input.classId, actor: gate.access.user.id, token: input.lines });
    if (res === "changed") warning = "배정은 되살렸지만, 그 사이 진도가 바뀌어 지운 진도 줄은 되돌리지 않았습니다";
    else if (res === "stopped") warning = "배정은 되살렸지만 진도 줄을 되돌리다 멈췄습니다 — 새로고침해 확인해 주세요";
  }

  await logAction({
    action: "textbook_plan_delete_undo",
    targetType: "class",
    targetLabel: gate.access.className,
    metadata: { id: p.id, lines: input.lines ? input.lines.removed.length : 0, warning: warning ?? null },
  });
  revalidatePath("/textbooks");
  revalidatePath(`/ecs/${input.classId}`, "layout");
  return { ok: true, warning };
}

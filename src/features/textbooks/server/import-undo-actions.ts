"use server";

/**
 * **마지막 월간계획 가져오기 되돌리기**(원장 2026-10-15) — 알림의 [실행 취소]와 가져오기 버튼 옆 ▾ 메뉴가 부른다.
 *
 * 🔴 게이트는 가져오기와 같은 ECS 쓰기 권한(`requireEcsClassAccess(write)`) — 서버 액션은 공개 엔드포인트다([[#77]]).
 * 🔴 **그 반의 가장 최근 가져오기만** 되돌린다 — 화면이 옛 id를 들고 있어도 서버가 다시 확인한다.
 * 🔑 먼저 '되돌림' 표시를 걸고(조건부 UPDATE) 그다음 줄을 돌린다 — 두 창이 동시에 눌러도 한 번만 돈다.
 *    줄 되돌리기가 실패하면 표시를 풀어 다시 누를 수 있게 한다.
 */
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { logAction } from "@/features/audit/server/log";
import { requireEcsClassAccess } from "@/features/class-sheets/server/access";
import { reportError } from "@/lib/observability/report-error";
import { IMPORT_FIELDS, planUndo, type LineFields } from "../import-undo";
import { loadImportBatch, loadLastImport } from "./import-batch";

export type UndoImportResult = { ok: true; restored: number; kept: number } | { ok: false; error: string };

/** 칸 되돌리기를 한꺼번에 몇 개씩 보낼지 — 수백 줄을 직렬로 보내면 수 초가 걸린다. */
const RESET_PARALLEL = 20;

export async function undoPlanImport(input: { classId: string; batchId: string }): Promise<UndoImportResult> {
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  const tenantId = gate.access.tenantId;
  const admin = createAdminClient();

  const last = await loadLastImport(admin, tenantId, input.classId);
  if (!last || last.id !== input.batchId) {
    return { ok: false, error: "되돌릴 수 있는 가져오기가 없습니다 — 이미 되돌렸거나 그 뒤에 다시 가져왔습니다" };
  }
  const batch = await loadImportBatch(admin, tenantId, input.classId, input.batchId);
  if (!batch || batch.undone) return { ok: false, error: "이미 되돌린 가져오기입니다" };

  // ① 표시 먼저 — 조건부라 동시에 두 번 눌러도 한쪽만 통과한다.
  const { data: claimed, error: claimErr } = await admin
    .from("class_plan_import_batches")
    .update({ undone_at: new Date().toISOString(), undone_by: gate.access.user.id })
    .eq("tenant_id", tenantId)
    .eq("id", input.batchId)
    .is("undone_at", null)
    .select("id");
  if (claimErr) return { ok: false, error: "되돌리지 못했습니다 — 잠시 뒤 다시 시도해 주세요" };
  if (!claimed || claimed.length === 0) return { ok: false, error: "이미 되돌린 가져오기입니다" };

  const release = () =>
    admin
      .from("class_plan_import_batches")
      .update({ undone_at: null, undone_by: null })
      .eq("tenant_id", tenantId)
      .eq("id", input.batchId);

  try {
    // ② 지금 값을 읽어 손대지 않은 칸만 고른다.
    const ids = batch.rows.map((r) => r.id);
    const current = await fetchInChunks<LineFields & { id: string }>(ids, (chunk) =>
      admin
        .from("class_sheet_plan_lines")
        .select(`id, ${IMPORT_FIELDS.join(", ")}`)
        .eq("tenant_id", tenantId)
        .eq("class_id", input.classId)
        .in("id", chunk) as never,
    );
    const plan = planUndo(batch.rows, new Map(current.map((r) => [r.id, r])));

    // ③ 지우고 비운다.
    for (let i = 0; i < plan.deletes.length; i += 100) {
      const { error } = await admin
        .from("class_sheet_plan_lines")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("class_id", input.classId)
        .in("id", plan.deletes.slice(i, i + 100));
      if (error) throw error;
    }
    const now = new Date().toISOString();
    for (let i = 0; i < plan.resets.length; i += RESET_PARALLEL) {
      const results = await Promise.all(
        plan.resets.slice(i, i + RESET_PARALLEL).map((r) =>
          admin
            .from("class_sheet_plan_lines")
            .update({ ...r.patch, updated_by: gate.access.user.id, updated_at: now })
            .eq("tenant_id", tenantId)
            .eq("class_id", input.classId)
            .eq("id", r.id),
        ),
      );
      const failed = results.find((x) => x.error);
      if (failed?.error) throw failed.error;
    }

    await logAction({
      action: "textbook_plan_import_undo",
      targetType: "class",
      targetLabel: gate.access.className,
      metadata: { batchId: input.batchId, restored: plan.restored, kept: plan.kept },
    });
    revalidatePath(`/ecs/${input.classId}`, "layout");
    revalidatePath("/ecs");
    return { ok: true, restored: plan.restored, kept: plan.kept };
  } catch (e) {
    reportError(e, { scope: "textbooks.import-undo", classId: input.classId, batchId: input.batchId });
    await release();
    revalidatePath(`/ecs/${input.classId}`, "layout");
    return { ok: false, error: "되돌리다 멈췄습니다 — 새로고침 후 다시 시도해 주세요" };
  }
}

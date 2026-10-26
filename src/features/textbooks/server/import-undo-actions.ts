"use server";

/**
 * **교재 배정 반영 되돌리기**(원장 2026-10-15) — 알림의 [실행 취소]와 툴바 [되돌리기 ▾]가 부른다.
 *
 * 🔴 게이트는 가져오기와 같은 ECS 쓰기 권한(`requireEcsClassAccess(write)`) — 서버 액션은 공개 엔드포인트다([[#77]]).
 * 🔑 **최근 5건 중 하나로 되돌린다**(원장 2026-10-26 *"최근 5회 작업한거중에 껄로 돌아갈수있게"*) — 고른 반영과
 *    그 뒤 반영을 **최신부터 거꾸로** 전부 되돌린다(`undoChain`). 중간 하나만 빼면 뒤 반영이 그 칸 위에 쌓인 채라
 *    "손대지 않은 칸" 판정이 틀어진다. 목록은 서버가 다시 읽는다(화면이 든 id를 믿지 않는다).
 * 🔴 **배정까지 지운다**(원장 2026-10-26 *"되돌리기 기능이 동작안한대"*) — 실제 줄만 비우면 빈 칸에 같은 교재가
 *    `계획`으로 다시 그려져 아무것도 안 바뀐 것처럼 보였다. 기록에 배정 표식이 있을 때만(옛 기록은 줄만).
 *    배정 삭제는 화면의 [배정 삭제]와 같은 액션(`deleteClassTextbookPlan`, 줄은 안 지움 — 줄은 여기서 이미 돌렸다).
 * 🔑 **미룸·당김 / 배정 삭제도 같은 목록**(원장 2026-10-26 *"미룸·당김이랑 배정삭제도 히스토리에 넣어줘"*) —
 *    기록의 표식(`HistoryMeta`)을 보고 각 화면 알림의 [되돌리기]와 **같은 서버 액션**을 부른다
 *    (`undoLessonShift` / `undoPlanDelete` — 그 사이 바뀐 게 있으면 거절하는 판정도 그대로).
 * 🔑 건마다 먼저 '되돌림' 표시를 걸고(조건부 UPDATE) 그다음 줄을 돌린다 — 두 창이 동시에 눌러도 한 번만 돈다.
 *    줄 되돌리기가 실패하면 표시를 풀어 다시 누를 수 있게 한다.
 */
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { logAction } from "@/features/audit/server/log";
import { requireEcsClassAccess } from "@/features/class-sheets/server/access";
import { reportError } from "@/lib/observability/report-error";
import { IMPORT_FIELDS, planUndo, undoChain, type LineFields } from "../import-undo";
import { claimHistory, loadImportBatch, loadRecentImports, releaseHistory } from "./import-batch";
import { deleteClassTextbookPlan } from "./plan-actions";
import { undoLessonShift } from "./shift-undo-actions";
import { undoPlanDelete } from "./plan-delete-actions";
import type { ShiftUndoToken } from "../shift-undo";
import type { PlanRestoreRow } from "../types";

export type UndoImportResult =
  | { ok: true; restored: number; kept: number; batches: number; plansRemoved: number; others: number }
  | { ok: false; error: string };

/** 칸 되돌리기를 한꺼번에 몇 개씩 보낼지 — 수백 줄을 직렬로 보내면 수 초가 걸린다. */
const RESET_PARALLEL = 20;

type Gate = Extract<Awaited<ReturnType<typeof requireEcsClassAccess>>, { ok: true }>;
type Admin = ReturnType<typeof createAdminClient>;
/** `other` = 미룸·당김 / 배정 삭제를 되돌렸다(줄 수를 세지 않는 종류). */
type OneResult =
  | { ok: true; restored: number; kept: number; planRemoved: boolean; other?: boolean }
  | { ok: false; error: string };

export async function undoPlanImport(input: {
  classId: string;
  batchId: string;
  /** ‘방금 한 것’만(배정 알림의 [실행 취소]) — 그 뒤에 다른 반영이 있으면 함께 지우지 않고 거절한다. */
  latestOnly?: boolean;
}): Promise<UndoImportResult> {
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminClient();

  const recent = await loadRecentImports(admin, gate.access.tenantId, input.classId);
  const chain = undoChain(recent, input.batchId);
  if (chain && input.latestOnly && chain.length > 1) {
    return { ok: false, error: "그 뒤에 다른 반영이 있습니다 — 툴바 [되돌리기 ▾]에서 시점을 골라 주세요" };
  }
  if (!chain) {
    return { ok: false, error: "되돌릴 수 있는 반영이 아닙니다 — 이미 되돌렸거나 최근 5건 밖입니다" };
  }

  const total = { restored: 0, kept: 0, batches: 0, plansRemoved: 0, others: 0 };
  let failure: string | null = null;
  for (const b of chain) {
    const r = await undoOne(admin, gate, input.classId, b.id);
    if (!r.ok) {
      failure = r.error;
      break;
    }
    total.restored += r.restored;
    total.kept += r.kept;
    total.batches += 1;
    if (r.planRemoved) total.plansRemoved += 1;
    if (r.other) total.others += 1;
  }
  revalidatePath(`/ecs/${input.classId}`, "layout");
  revalidatePath("/ecs");
  if (failure) {
    // 앞쪽(최신) 몇 건은 이미 되돌렸다 — 그 사실을 함께 말한다(성공으로도, 아무 일 없던 것으로도 뭉개지 않는다).
    return { ok: false, error: total.batches > 0 ? `${failure} (최근 ${total.batches}건은 되돌렸습니다)` : failure };
  }
  return { ok: true, ...total };
}

/** 반영 한 건 되돌리기 — 표시 → 줄 → 배정 순. */
async function undoOne(admin: Admin, gate: Gate, classId: string, batchId: string): Promise<OneResult> {
  const tenantId = gate.access.tenantId;
  const batch = await loadImportBatch(admin, tenantId, classId, batchId);
  if (!batch || batch.undone) return { ok: false, error: "이미 되돌린 반영입니다" };

  // ① 표시 먼저 — 조건부라 동시에 두 번 눌러도 한쪽만 통과한다.
  const claim = await claimHistory(admin, tenantId, classId, batchId, gate.access.user.id);
  if (claim === "error") return { ok: false, error: "되돌리지 못했습니다 — 잠시 뒤 다시 시도해 주세요" };
  if (claim === "taken") return { ok: false, error: "이미 되돌린 반영입니다" };
  const release = () => releaseHistory(admin, tenantId, batchId);

  // 미룸·당김 / 배정 삭제 — 알림 [되돌리기]와 같은 액션. 재료는 서버가 쓴 기록이지만 액션이 모양을 다시 검사한다.
  const meta = batch.meta;
  if (meta?.kind === "shift" || meta?.kind === "delete") {
    const r =
      meta.kind === "shift"
        ? await undoLessonShift({ classId, token: meta.token as ShiftUndoToken })
        : await undoPlanDelete({
            classId,
            plan: meta.plan as PlanRestoreRow,
            ...(meta.lines ? { lines: meta.lines as ShiftUndoToken } : {}),
          });
    if (!r.ok) {
      await release();
      return { ok: false, error: r.error };
    }
    return { ok: true, restored: 0, kept: 0, planRemoved: false, other: true };
  }

  let plan: ReturnType<typeof planUndo>;
  try {
    // ② 지금 값을 읽어 손대지 않은 칸만 고른다.
    const ids = batch.rows.map((r) => r.id);
    const current =
      ids.length === 0
        ? []
        : await fetchInChunks<LineFields & { id: string }>(ids, (chunk) =>
            admin
              .from("class_sheet_plan_lines")
              .select(`id, ${IMPORT_FIELDS.join(", ")}`)
              .eq("tenant_id", tenantId)
              .eq("class_id", classId)
              .in("id", chunk) as never,
          );
    plan = planUndo(batch.rows, new Map(current.map((r) => [r.id, r])));

    // ③ 지우고 비운다.
    for (let i = 0; i < plan.deletes.length; i += 100) {
      const { error } = await admin
        .from("class_sheet_plan_lines")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("class_id", classId)
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
            .eq("class_id", classId)
            .eq("id", r.id),
        ),
      );
      const failed = results.find((x) => x.error);
      if (failed?.error) throw failed.error;
    }
  } catch (e) {
    reportError(e, { scope: "textbooks.import-undo", classId, batchId });
    await release();
    return { ok: false, error: "되돌리다 멈췄습니다 — 새로고침 후 다시 시도해 주세요" };
  }

  // ④ 배정 — 줄은 이미 돌렸으니 배정만 지운다. 이미 지워졌으면(사람이 [배정 삭제]를 눌렀다) 할 일이 없다.
  //    🔴 다른 반의 배정이면 손대지 않는다(기록은 서버가 쓴 값이지만 한 번 더).
  let planRemoved = false;
  if (batch.plan) {
    const { data: row } = await admin
      .from("class_textbook_plans")
      .select("id, class_id")
      .eq("tenant_id", tenantId)
      .eq("id", batch.plan.planId)
      .maybeSingle();
    if (row && String(row.class_id) === classId) {
      const del = await deleteClassTextbookPlan(batch.plan.planId, { skipHistory: true });
      // 줄은 이미 돌렸다 — 표시를 풀면 같은 줄을 두 번 돌리게 되니 풀지 않고 사실만 알린다.
      if (!del.ok) {
        return { ok: false, error: `칸은 되돌렸지만 교재 배정을 지우지 못했습니다 — 교재 배정에서 직접 지워 주세요 (${del.error})` };
      }
      planRemoved = true;
    }
  }

  await logAction({
    action: "textbook_plan_import_undo",
    targetType: "class",
    targetLabel: gate.access.className,
    metadata: { batchId, restored: plan.restored, kept: plan.kept, planId: batch.plan?.planId ?? null, planRemoved },
  });
  return { ok: true, restored: plan.restored, kept: plan.kept, planRemoved };
}

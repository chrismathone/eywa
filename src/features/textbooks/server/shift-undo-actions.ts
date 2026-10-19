"use server";

/**
 * **미룸·당김 되돌리기** 서버 액션 — 규칙은 [`planShiftUndo`](../shift-undo.ts)(순수) 한 곳이다.
 *
 * 🔴 게이트는 그 반의 ECS 쓰기 권한 — 서버 액션은 공개 엔드포인트다([[#77]]).
 * 🔴 기록(token)은 **클라가 들고 온 값**이다 — 그래서 ① 반은 게이트가 연 반으로 고정하고(tenant·class는 서버가
 *    채운다), ② 값의 모양을 전부 검사하며, ③ 지우기·고치기는 **지금도 기록 그대로인 그 반 줄**에만 한다.
 *    이 반을 쓸 수 있는 사람이 칸에 직접 쓸 수 있는 것보다 넓은 일은 못 한다. 실행은 [`restoreShiftState`](./shift-undo-core.ts).
 * 🔴 `class_sheet_*`는 RLS 정책이 0개라 admin 클라이언트 + `tenant_id` 명시 필터([[#104]]).
 */
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { requireEcsClassAccess } from "@/features/class-sheets/server/access";
import type { PlanLineDTO } from "@/features/class-sheets/server/actions";
import type { ShiftUndoToken } from "../shift-undo";
import { readWeekCells } from "./shift-snapshot";
import { restoreShiftState, validToken } from "./shift-undo-core";

export type ShiftUndoResult =
  | { ok: true; cells?: { date: string; slotStart: string; lines: PlanLineDTO[] }[] }
  | { ok: false; error: string };

const CHANGED = "그 사이 이 반의 진도가 바뀌어 되돌리지 않았습니다 — 화면을 새로고침해 확인해 주세요";
const STOPPED = "되돌리다 멈췄습니다 — 새로고침 후 확인해 주세요";

export async function undoLessonShift(input: { classId: string; token: ShiftUndoToken }): Promise<ShiftUndoResult> {
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!validToken(input.token, input.classId)) return { ok: false, error: "되돌릴 기록이 올바르지 않습니다" };
  const token = input.token;
  const admin = createAdminClient();
  const tenantId = gate.access.tenantId;
  const classId = input.classId;

  const res = await restoreShiftState({ admin, tenantId, classId, actor: gate.access.user.id, token });
  if (res !== "ok") {
    revalidatePath(`/ecs/${classId}`, "layout");
    return { ok: false, error: res === "changed" ? CHANGED : STOPPED };
  }

  await logAction({
    action: "textbook_lesson_shift_undo",
    targetType: "class",
    targetLabel: gate.access.className,
    metadata: {
      date: token.date,
      removed: token.removed.length,
      added: token.added.length,
      changed: token.changed.length,
      markers: token.markers.length,
    },
  });
  revalidatePath(`/ecs/${classId}`, "layout");

  // 화면 갈아 끼우기 — 누른 날이 있는 주의 바뀐 칸들(다른 주는 그 주를 열 때 서버가 준다).
  const keys = [
    ...token.removed,
    ...token.added,
    ...token.changed.map((c) => c.after),
    ...token.changed.map((c) => c.before),
  ].map((l) => `${l.plan_date}|${l.slot_start}`);
  const week = await readWeekCells({ admin, tenantId, classId, date: token.date, slot: token.slot, keys }).catch(() => null);
  return { ok: true, cells: week?.cells };
}

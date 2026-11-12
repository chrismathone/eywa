"use server";

import { z } from "zod";
import { isTenantViewWriteBlocked } from "@/lib/auth/tenant-view";
import { readonlyTeacherViewError } from "@/lib/auth/view-as";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { explainDbError } from "@/lib/supabase/db-error";
import { logAction } from "@/features/audit/server/log";
import { DUTY_NOTE_ACTIONS, DUTY_NOTE_LABEL, NOTE_LIMIT, type DutyNoteAction } from "../notes";
import { getDutyAdminViewer } from "./admin-gate";

const schema = z.object({
  ids: z.array(z.string().uuid()).min(1, "대상이 없습니다").max(500, "한 번에 500건까지 처리할 수 있습니다"),
  action: z.enum(DUTY_NOTE_ACTIONS as [DutyNoteAction, ...DutyNoteAction[]]),
  note: z.string().max(NOTE_LIMIT, "사유는 500자까지 적을 수 있습니다"),
});

/**
 * 관리 기록 남기기(확인 · 사유 · 면제) — 업무 완성도 관리자 화면의 지연·이관 줄에서. 문 = 화면과 같은 권한 키(`duties`)의 **전체** 권한
 * ('담당' 권한은 자기 업무만 보는 사람이라 남의 의무를 정리하지 못한다 · 읽기 권한도 못 한다) + 과목 범위(DB 함수가 한 번 더 — 범위 밖이 섞이면 통째로 거절).
 */
export async function addDutyNote(input: { ids: string[]; action: DutyNoteAction; note: string }): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력을 확인해 주세요" };
  const viewer = await getDutyAdminViewer();
  if (!viewer) return { ok: false, error: "권한이 없습니다" };
  if (viewer.scope.ownerId || (await accessLevelTenant(viewer.user.systemRole, "duties")) !== "full") return { ok: false, error: "업무 완성도 전체 권한이 필요합니다" };
  if (await isTenantViewWriteBlocked()) return { ok: false, error: "읽기 전용으로 보는 중에는 바꿀 수 없습니다" };
  const readonly = await readonlyTeacherViewError();
  if (readonly) return { ok: false, error: readonly };
  const d = parsed.data;
  if (d.action !== "ack" && !d.note.trim()) return { ok: false, error: "사유를 적어 주세요" };
  const { data, error } = await createAdminClient().rpc("duty_note_add", { p_tenant: viewer.user.tenantId, p_ids: d.ids, p_action: d.action, p_note: d.note, p_actor: viewer.user.id, p_subjects: viewer.scope.subjects });
  if (error) return { ok: false, error: explainDbError(error, { scope: "duties.note", fallback: "저장하지 못했습니다. 잠시 뒤 다시 해 주세요." }).message };
  await logAction({ action: "duty_note_add", targetType: "duty_item", targetLabel: `업무 ${DUTY_NOTE_LABEL[d.action]} ${Number(data ?? 0)}건`, metadata: { step: d.action, count: Number(data ?? 0), note: d.note.trim().slice(0, 200), ids: d.ids.slice(0, 50) } });
  return { ok: true, count: Number(data ?? 0) };
}

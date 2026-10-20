"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { describeDbError } from "@/lib/supabase/db-error";
import { logAction } from "@/features/audit/server/log";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getMakeupCases, getMakeupCaseDetail, getMakeupOptions, getMakeupEvents } from "./queries";
import { makeupCommandSchema, parseMakeupCommand } from "../schemas";
import { parseCommandSuccess } from "../command-parse";

export type MakeupActionResult = { ok: true; result: Record<string, unknown> } | { ok: false; error: string; code?: string };

/** DB command is the only writer; the actor and all relationships are checked again there. */
/**
 * refresh "server" (default): Next re-renders the current page inside this action response.
 * refresh "client": no revalidation, so the response carries no page tree. The caller reloads the case data itself
 * (case detail) or navigates (intake/link). With a streamed page tree the router transition could stay suspended for
 * good: a lazy row landing during React's yield pings synchronously inside the render and the ping is dropped
 * (Next 16.2.6 / React 19.3 canary). No revalidation also means no `x-action-revalidated`, so the caller publishes
 * the mutation signal for other windows itself.
 */
/** RPC가 감사로그를 남기지 않는 명령 — 여기 없는 명령은 makeup_private.audit이 남긴다(0346a~0350e). */
const APP_LOGGED_COMMANDS: ReadonlySet<string> = new Set(["assign", "participation", "submit", "hold", "resume", "resolve_reconciliation"]);

export async function executeMakeupCommand(input: unknown, options?: unknown): Promise<MakeupActionResult> {
  const clientRefresh = z.object({ refresh: z.literal("client") }).safeParse(options).success;
  const parsed = makeupCommandSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "입력값을 확인해 주세요" };
  const checked = parseMakeupCommand(parsed.data);
  if (!checked.ok) return { ok: false, error: checked.error };
  if (JSON.stringify(parsed.data.payload).length > 32_000) return { ok: false, error: "입력 내용이 너무 깁니다" };
  const actor = await getCurrentUser({ teacherView: true });
  if (!actor || !(await canWriteTenant(actor.systemRole, "makeups"))) return { ok: false, error: "보강 기록 변경 권한이 없습니다" };
  const settings = await getTenantSettings();
  if (settings.makeups.mode === "off") return { ok: false, error: "보강관리 운영이 중지되어 있습니다" };
  if (settings.makeups.mode === "draining" && ["intake", "reserve", "reschedule", "link_legacy"].includes(parsed.data.action)) {
    return { ok: false, error: "새 접수를 중지한 상태입니다. 기존 업무를 먼저 처리해 주세요." };
  }
  const db = await createClient();
  const { data, error } = await db.rpc("makeup_command", {
    p_command_id: parsed.data.command_id, p_action: parsed.data.action,
    p_payload: parsed.data.payload, p_expected_revision: parsed.data.expected_revision,
  });
  if (error) {
    const info = describeDbError(error, { fallback: "보강 기록을 저장하지 못했습니다. 다시 시도해 주세요." });
    let code: string | undefined;
    try { code = JSON.parse(error.details || "{}").code; } catch { /* Non-JSON DB detail is not rendered. */ }
    return { ok: false, error: info.kind === "schema" ? "보강관리 DB 설정을 적용한 뒤 다시 시도해 주세요" : info.message, code };
  }
  const saved = parseCommandSuccess(data);
  if (!saved.ok) return { ok: false, error: "저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 시도해 주세요." };
  // 감사로그 — RPC(makeup_private.audit, 0345a)가 접수·승인·예약·인정·종결 등은 audit_logs에 `makeup_<명령>`으로 직접 남긴다.
  //    그 기록이 없는 명령만 여기서 한 줄(무엇을 · 어느 보강 건 · 어느 학생 — 입력 내용은 안 싣는다). 같은 요청을 다시 보낸 것(replayed)은 이미 남았다.
  //    ⚠️ 대사 처리의 '시수 차이 승인' 갈래는 RPC도 `makeup_accept_units`를 남긴다(승인 사실 · 이 줄은 처리 사실).
  if (!saved.value.replayed && APP_LOGGED_COMMANDS.has(parsed.data.action)) {
    const sid = parsed.data.payload.student_id;
    await logAction({
      action: "makeup_case_command",
      targetType: "makeup",
      metadata: {
        command: parsed.data.action,
        caseId: saved.value.case_id,
        studentId: typeof sid === "string" && z.string().uuid().safeParse(sid).success ? sid : null,
      },
    });
  }
  if (clientRefresh) return { ok: true, result: data };
  revalidatePath("/makeups");
  const affectedCases = new Set([saved.value.case_id, ...saved.value.case_ids, parsed.data.payload.case_id]);
  for (const id of affectedCases) {
    if (typeof id === "string" && z.string().uuid().safeParse(id).success) revalidatePath(`/makeups/${id}`);
  }
  revalidatePath("/makeups/candidates");
  revalidatePath("/makeups/dry-run");
  revalidatePath("/makeups/reconciliation");
  revalidatePath("/attendance");
  revalidatePath("/onescreen");
  revalidatePath("/ecs");
  revalidatePath("/dashboard");
  if (typeof parsed.data.payload.student_id === "string") revalidatePath(`/students/${parsed.data.payload.student_id}`);
  return { ok: true, result: data };
}

export async function searchMakeupOptions(input: unknown): ReturnType<typeof getMakeupOptions> {
  const parsed = z.object({
    kind: z.enum(["students", "classes", "staff", "classrooms", "policies", "attendance", "reports", "sessions"]),
    q: z.string().max(80).optional(), subject_key: z.string().max(40).optional(),
    student_id: z.string().uuid().optional(), session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    class_id: z.string().uuid().optional(),
    // Class candidates for one student and one date: "anchor" = attendance class, "original" = class of the absence.
    purpose: z.enum(["anchor", "original"]).optional(),
    page: z.number().int().positive().max(10_000).default(1),
    page_size: z.number().int().positive().max(50).default(30),
  }).safeParse(input);
  if (!parsed.success) return { error: "검색 조건을 확인해 주세요" };
  return getMakeupOptions(parsed.data);
}

export async function searchAllocationCases(input: unknown): ReturnType<typeof getMakeupCases> {
  const parsed = z.object({ student_id: z.string().uuid(), subject_key: z.string().max(40),
    page: z.number().int().positive().max(10_000).default(1), q: z.string().max(80).optional() }).safeParse(input);
  if (!parsed.success) return { error: "보강 건 검색 조건을 확인해 주세요" };
  return getMakeupCases({ ...parsed.data, eligibility: "approved", tab: "open", page_size: 30 });
}

export async function searchMergeCases(input: unknown): ReturnType<typeof getMakeupCases> {
  const parsed = z.object({ student_id: z.string().uuid(), subject_key: z.string().max(40),
    page: z.number().int().positive().max(100_000).default(1) }).safeParse(input);
  if (!parsed.success) return { error: "대표 보강 검색 조건을 확인해 주세요" };
  return getMakeupCases({ ...parsed.data, tab: "active", page_size: 30 });
}

/** Case detail data only (no page tree) — the detail view reloads with this after a client-refresh command. */
export async function reloadMakeupCaseDetail(input: unknown): ReturnType<typeof getMakeupCaseDetail> {
  const parsed = z.object({ case_id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "보강 건을 확인해 주세요" };
  return getMakeupCaseDetail(parsed.data.case_id);
}

export async function loadMakeupEvents(input: unknown): ReturnType<typeof getMakeupEvents> {
  const parsed = z.object({ case_id: z.string().uuid(), page: z.number().int().positive().max(100_000) }).safeParse(input);
  if (!parsed.success) return { error: "이력 조회 조건을 확인해 주세요" };
  return getMakeupEvents(parsed.data.case_id, parsed.data.page);
}

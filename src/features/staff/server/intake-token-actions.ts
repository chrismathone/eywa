"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { ROLE_HIERARCHY } from "@/lib/auth/role-hierarchy";
import { createAdminClient } from "@/lib/supabase/admin";
import { humanizeDbError } from "@/lib/supabase/db-error";
import { logAction } from "@/features/audit/server/log";
import { parseIntakeToken, STAFF_INTAKE_FORM_TYPE, type StaffIntakeToken } from "./intake-token";

// 직원 등록 QR 토큰 관리(생성·활성토글·삭제) — 게이트 = 직원관리 쓰기(개인 예외 반영) + admin client + tenant 필터.
// ⚠️ 이 토큰을 아는 사람은 **로그인 없이 직원 계정을 만들 수 있다**(원장 결정 2026-08-07 '제출 즉시 생성').
//    그래서 ① 링크는 필요할 때만 켜고 ② 기본 90일 만료 ③ 다 쓰면 끄거나 지우는 운영을 전제한다.

export type IntakeTokenActionState = { ok?: true; error?: string; notice?: string } | undefined;

async function requireStaffWrite() {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" as const };
  if (!(await canWriteTenant(user.systemRole, "staff"))) {
    return { error: "직원 등록 QR을 관리할 권한이 없습니다" as const };
  }
  return { user };
}

/** 이 학원의 직원 등록 QR 전부(만든 순). */
export async function listStaffIntakeTokens(tenantId: string): Promise<StaffIntakeToken[]> {
  const { data } = await createAdminClient()
    .from("academy_documents")
    .select("id, created_at, form_data")
    .eq("tenant_id", tenantId)
    .eq("form_type", STAFF_INTAKE_FORM_TYPE)
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? [])
    .map((r) => parseIntakeToken(r.id as string, r.created_at as string, r.form_data))
    .filter((t): t is StaffIntakeToken => t !== null);
}

/** QR 새로 만들기 — 이름·역할·만료일. 토큰은 서버가 만든다(추측 불가 32자 hex). */
export async function createStaffIntakeToken(
  _prev: IntakeTokenActionState,
  formData: FormData,
): Promise<IntakeTokenActionState> {
  const gate = await requireStaffWrite();
  if ("error" in gate) return { error: gate.error };

  const name = String(formData.get("name") ?? "").trim().slice(0, 60) || "직원 등록";
  const role = String(formData.get("role") ?? "teacher").trim();
  if (!(role in ROLE_HIERARCHY) || role === "student") return { error: "역할을 선택하세요" };
  // 만든 사람보다 강한 역할은 QR로도 못 만든다(직접 등록과 같은 위계 — 우회 통로가 되면 안 된다).
  if (ROLE_HIERARCHY[gate.user.systemRole] >= ROLE_HIERARCHY[role as keyof typeof ROLE_HIERARCHY]) {
    return { error: "본인 권한으로 부여할 수 없는 역할입니다" };
  }
  const days = Number(formData.get("days") ?? 90);
  const expiresAt = new Date(Date.now() + (Number.isFinite(days) && days > 0 ? days : 90) * 86400000).toISOString();

  const { error } = await createAdminClient().from("academy_documents").insert({
    tenant_id: gate.user.tenantId,
    title: `직원 등록 QR — ${name}`,
    category: "hr",
    kind: "form",
    form_type: STAFF_INTAKE_FORM_TYPE,
    form_data: { token: randomBytes(16).toString("hex"), name, active: true, expiresAt, role, submissionCount: 0 },
    restricted: true,
    staff_user_id: gate.user.id, // /documents 표면 제외(#77 벽) — 내부 전용 행
    uploaded_by: gate.user.id,
  });
  if (error) return { error: humanizeDbError(error.message, "저장") };

  await logAction({
    action: "staff_intake_token_create",
    targetType: "document",
    targetLabel: name,
    metadata: { role, expiresAt },
  });
  revalidatePath("/staff");
  return { ok: true, notice: "직원 등록 QR을 만들었습니다" };
}

/** 활성/비활성 토글 또는 삭제 — 다 쓴 링크를 즉시 닫는 경로. */
export async function setStaffIntakeToken(
  _prev: IntakeTokenActionState,
  formData: FormData,
): Promise<IntakeTokenActionState> {
  const gate = await requireStaffWrite();
  if ("error" in gate) return { error: gate.error };

  const id = String(formData.get("id") ?? "").trim();
  const action = String(formData.get("action") ?? "toggle");
  if (!id) return { error: "대상을 찾을 수 없습니다" };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("academy_documents")
    .select("id, created_at, form_data")
    .eq("tenant_id", gate.user.tenantId)
    .eq("form_type", STAFF_INTAKE_FORM_TYPE)
    .eq("id", id)
    .maybeSingle();
  if (!row) return { error: "이미 삭제된 QR입니다" };

  if (action === "delete") {
    const { error, data: deleted } = await admin
      .from("academy_documents")
      .delete()
      .eq("tenant_id", gate.user.tenantId)
      .eq("id", id)
      .select("id"); // select 없으면 0행 삭제도 성공으로 보인다
    if (error) return { error: humanizeDbError(error.message, "삭제") };
    if (!deleted?.length) return { error: "이미 삭제된 QR입니다" };
    await logAction({ action: "staff_intake_token_delete", targetType: "document", metadata: { id } });
    revalidatePath("/staff");
    return { ok: true, notice: "삭제했습니다" };
  }

  const cur = parseIntakeToken(row.id as string, row.created_at as string, row.form_data);
  if (!cur) return { error: "QR 정보를 읽을 수 없습니다" };
  const next = String(formData.get("active") ?? "false") === "true";
  const { error } = await admin
    .from("academy_documents")
    .update({ form_data: { ...(row.form_data as object), active: next } })
    .eq("tenant_id", gate.user.tenantId)
    .eq("id", id);
  if (error) return { error: humanizeDbError(error.message, "저장") };

  await logAction({
    action: "staff_intake_token_toggle",
    targetType: "document",
    targetLabel: cur.name,
    metadata: { active: next },
  });
  revalidatePath("/staff");
  return { ok: true, notice: next ? "QR을 열었습니다" : "QR을 닫았습니다" };
}

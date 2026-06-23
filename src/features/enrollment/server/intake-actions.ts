"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import {
  GENDER_OPTIONS,
  BLOOD_OPTIONS,
  RELATION_OPTIONS,
  SIBLINGS_OPTIONS,
  CONSULTATION_PATHS,
} from "@/features/enrollment/form-config";

// ───────────────────────── 토큰 관리 (직원, 인증) ─────────────────────────

async function requireIntakeAdmin() {
  const user = await getCurrentUser();
  if (!user) return { user: null, error: "로그인이 필요합니다" };
  const lvl = await accessLevelTenant(user.systemRole, "enrollment");
  if (lvl !== "full" && lvl !== "scoped") return { user: null, error: "등록상담 권한이 없습니다" };
  return { user, error: undefined as string | undefined };
}

export type IntakeTokenState = { error?: string; ok?: boolean } | undefined;

/** 공개 접수 토큰 생성 — 랜덤 시크릿(URL에 노출되는 공유키). */
export async function createIntakeToken(
  _prev: IntakeTokenState,
  formData: FormData,
): Promise<IntakeTokenState> {
  const { user, error } = await requireIntakeAdmin();
  if (error || !user) return { error };
  const name = String(formData.get("name") ?? "").trim() || "공개 접수";
  const expiresRaw = String(formData.get("expiresAt") ?? "").trim();

  const supabase = await createClient();
  const { error: insErr } = await supabase.from("intake_tokens").insert({
    tenant_id: user.tenantId,
    token: randomBytes(16).toString("hex"),
    name: name.slice(0, 80),
    expires_at: expiresRaw ? new Date(expiresRaw).toISOString() : null,
    created_by: user.id,
  });
  if (insErr) return { error: insErr.message };

  await logAction({ action: "intake_token_create", targetType: "intake_token", targetLabel: name });
  revalidatePath("/enrollment");
  return { ok: true };
}

/** 토큰 활성/비활성 토글 또는 삭제. */
export async function setIntakeTokenActive(
  _prev: IntakeTokenState,
  formData: FormData,
): Promise<IntakeTokenState> {
  const { user, error } = await requireIntakeAdmin();
  if (error || !user) return { error };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "토큰 ID가 누락되었습니다" };
  const action = String(formData.get("action") ?? "toggle");

  const supabase = await createClient();
  if (action === "delete") {
    const { error: delErr } = await supabase.from("intake_tokens").delete().eq("id", id);
    if (delErr) return { error: delErr.message };
  } else {
    const active = String(formData.get("active") ?? "false") === "true";
    const { error: updErr } = await supabase
      .from("intake_tokens")
      .update({ is_active: active })
      .eq("id", id);
    if (updErr) return { error: updErr.message };
  }
  revalidatePath("/enrollment");
  return { ok: true };
}

// ───────────────────────── 공개 제출 (비인증, admin client) ─────────────────────────

export type PublicIntakeState =
  | { error?: string; ok?: boolean }
  | undefined;

const clip = (v: FormDataEntryValue | null, max: number): string =>
  String(v ?? "").trim().slice(0, max);

/**
 * 학부모 공개 접수 제출 — 비인증. 토큰으로 테넌트 해석 → 검증 → 레이트리밋 → enrollment_consultations(pending).
 * admin client(service_role)로 RLS 우회하되, tenant_id는 검증된 토큰에서만 취한다(조작 불가).
 */
export async function submitPublicIntake(
  _prev: PublicIntakeState,
  formData: FormData,
): Promise<PublicIntakeState> {
  const token = clip(formData.get("token"), 64);
  // 봇 허니팟 — 사람은 비워두는 숨김 필드. 채워졌으면 성공인 척 조용히 무시.
  if (clip(formData.get("company"), 100)) return { ok: true };

  const prospectName = clip(formData.get("prospectName"), 60);
  const privacy = String(formData.get("privacyAgreement") ?? "") === "true";
  if (!token) return { error: "잘못된 접근입니다" };
  if (!prospectName) return { error: "학생 이름을 입력해주세요" };
  if (!privacy) return { error: "개인정보 수집·이용에 동의해주세요" };

  const admin = createAdminClient();
  const { data: tok } = await admin
    .from("intake_tokens")
    .select("id, tenant_id, is_active, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!tok || !tok.is_active) return { error: "사용할 수 없는 접수 링크입니다" };
  if (tok.expires_at && new Date(tok.expires_at as string) < new Date()) {
    return { error: "만료된 접수 링크입니다" };
  }

  // 레이트리밋 — 이 토큰으로 최근 1시간 20건 초과 차단.
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("enrollment_consultations")
    .select("id", { count: "exact", head: true })
    .eq("intake_token_id", tok.id)
    .gte("created_at", hourAgo);
  if ((count ?? 0) >= 20) return { error: "접수가 많아 잠시 후 다시 시도해주세요" };

  // 필수·화이트리스트 검증 — 비인증 직접 POST가 설정 밖 값/빈 필수필드를 넣지 못하게 막는다.
  // 과목·학년은 운영 enum 단일소스(토큰 테넌트의 학원설정)와 대조. <select>는 클라 가드일 뿐이라 서버에서 재검증.
  const settings = await getTenantSettingsByTenantId(tok.tenant_id as string);
  const allowedSubjects = new Set(
    buildSubjectMaps(settings.operations.subjects).options.map((o) => o.value),
  );
  const allowedGrades = new Set(settings.operations.gradeLevels);
  const has = (arr: readonly string[], v: string) => arr.includes(v);

  const prospectGrade = clip(formData.get("prospectGrade"), 20);
  const prospectSchool = clip(formData.get("prospectSchool"), 40);
  const gender = clip(formData.get("gender"), 10);
  const parentName = clip(formData.get("parentName"), 40);
  const parentPhone = clip(formData.get("parentPhone"), 20);
  const parentRelation = clip(formData.get("parentRelation"), 10);
  const consultationPath = clip(formData.get("consultationPath"), 40);

  if (!prospectSchool) return { error: "학교를 입력해주세요" };
  if (!parentName) return { error: "보호자 이름을 입력해주세요" };
  if (!parentPhone) return { error: "보호자 연락처를 입력해주세요" };
  if (!has(GENDER_OPTIONS.map((o) => o.value), gender)) return { error: "성별을 선택해주세요" };
  if (!has(RELATION_OPTIONS, parentRelation)) return { error: "보호자와의 관계를 선택해주세요" };
  if (!has(CONSULTATION_PATHS, consultationPath)) return { error: "상담 경로를 선택해주세요" };
  if (!allowedGrades.has(prospectGrade)) return { error: "학년을 선택해주세요" };

  // 선택 입력 — 화이트리스트 밖이면 조용히 버린다(null).
  const bloodRaw = clip(formData.get("bloodType"), 4);
  const bloodType = has(BLOOD_OPTIONS, bloodRaw) ? bloodRaw : null;
  const siblingsRaw = clip(formData.get("siblings"), 40);
  const siblings = has(SIBLINGS_OPTIONS, siblingsRaw) ? siblingsRaw : null;
  const subjects = formData.getAll("subjects").map((s) => String(s)).filter(Boolean);
  const subject = subjects.find((s) => allowedSubjects.has(s)) ?? null;

  const { error: insErr } = await admin.from("enrollment_consultations").insert({
    tenant_id: tok.tenant_id,
    prospect_name: prospectName,
    prospect_grade: prospectGrade,
    prospect_school: prospectSchool,
    gender,
    blood_type: bloodType,
    student_phone: clip(formData.get("studentPhone"), 20) || null,
    parent_name: parentName,
    parent_phone: parentPhone,
    parent_relation: parentRelation,
    address: clip(formData.get("address"), 120) || null,
    consultation_path: consultationPath,
    career_goal: clip(formData.get("careerGoal"), 60) || null,
    siblings,
    subject,
    parent_request: clip(formData.get("parentRequest"), 2000) || null,
    shuttle_bus_request: String(formData.get("shuttleBusRequest") ?? "") === "true",
    privacy_agreement: true,
    installment_agreement: String(formData.get("installmentAgreement") ?? "") === "true",
    outcome: "pending",
    from_public_intake: true,
    intake_token_id: tok.id,
    consultant_id: null,
  });
  if (insErr) return { error: "제출에 실패했습니다. 잠시 후 다시 시도해주세요" };

  // 제출수 증가(현재값 읽어 +1 — 동시성은 데모 규모 무시). 조회수(usage_count)는 공개 폼 노출에서 집계.
  const { data: cur } = await admin
    .from("intake_tokens")
    .select("submission_count")
    .eq("id", tok.id)
    .maybeSingle();
  await admin
    .from("intake_tokens")
    .update({ submission_count: ((cur?.submission_count as number) ?? 0) + 1 })
    .eq("id", tok.id);

  return { ok: true };
}

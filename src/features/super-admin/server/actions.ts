"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth/super-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { logSuperAdminAction } from "./audit";

export type CreateTenantState =
  | { error?: string; fieldErrors?: Record<string, string> }
  | undefined;

const SLUG_RE = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

/**
 * 신규 학원(tenant) + 원장(master) 동시 생성.
 *
 * 1) tenants INSERT (uuid 미리 생성)
 * 2) auth.users 생성 (admin API). app_metadata에 { tenant_id, system_role: 'master' } 주입.
 * 3) tg_sync_user_from_auth 트리거가 public.users에 자동 mirror.
 *
 * 실패 시 1)의 tenant row는 cascade로 정리되지 않으므로 명시적으로 롤백.
 */
export async function createTenantWithMaster(
  _prev: CreateTenantState,
  formData: FormData,
): Promise<CreateTenantState> {
  const sa = await requireSuperAdmin();

  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const masterEmail = String(formData.get("masterEmail") ?? "").trim().toLowerCase();
  const masterPassword = String(formData.get("masterPassword") ?? "");
  const displayName = String(formData.get("displayName") ?? "").trim();
  const plan = String(formData.get("plan") ?? "free").trim() || "free";

  const fieldErrors: Record<string, string> = {};
  if (!slug || !SLUG_RE.test(slug)) {
    fieldErrors.slug = "영문 소문자·숫자·하이픈 3~40자 (예: ijw-demo)";
  }
  if (!name) fieldErrors.name = "학원 이름을 입력하세요";
  if (!masterEmail || !masterEmail.includes("@")) fieldErrors.masterEmail = "이메일 형식이 올바르지 않습니다";
  if (masterPassword.length < 8) fieldErrors.masterPassword = "비밀번호는 8자 이상";
  if (!displayName) fieldErrors.displayName = "원장 표시명을 입력하세요";
  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors };
  }

  const admin = createAdminClient();

  // 1) tenants insert
  const { data: tenantRow, error: tenantErr } = await admin
    .from("tenants")
    .insert({ slug, name, plan })
    .select("id")
    .single();
  if (tenantErr) {
    if (tenantErr.code === "23505") {
      return { fieldErrors: { slug: "이미 사용 중인 slug 입니다" } };
    }
    return { error: `tenant 생성 실패: ${tenantErr.message}` };
  }
  const tenantId = tenantRow.id as string;

  // 2) auth.users 생성
  const { error: authErr } = await admin.auth.admin.createUser({
    email: masterEmail,
    password: masterPassword,
    email_confirm: true,
    app_metadata: { tenant_id: tenantId, system_role: "master" },
    user_metadata: { display_name: displayName },
  });
  if (authErr) {
    // rollback tenant
    await admin.from("tenants").delete().eq("id", tenantId);
    return { error: `master 계정 생성 실패: ${authErr.message}` };
  }

  // public.users에 display_name 보강 (트리거가 raw_user_meta_data.full_name을 우선이라 보장 차원)
  await admin
    .from("users")
    .update({ display_name: displayName })
    .eq("email", masterEmail)
    .eq("tenant_id", tenantId);

  await logSuperAdminAction({
    actorId: sa.id,
    actorEmail: sa.email,
    action: "create_tenant",
    targetTenantId: tenantId,
    targetLabel: name,
    metadata: { slug, masterEmail, plan },
  });

  revalidatePath("/super-admin/tenants");
  revalidatePath("/super-admin");
  redirect(`/super-admin/tenants/${tenantId}`);
}

export type UpdateTenantState = { error?: string; ok?: boolean } | undefined;

export async function updateTenant(
  _prev: UpdateTenantState,
  formData: FormData,
): Promise<UpdateTenantState> {
  const sa = await requireSuperAdmin();

  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const plan = String(formData.get("plan") ?? "").trim();

  if (!id) return { error: "id 누락" };
  if (!name) return { error: "이름은 비울 수 없습니다" };

  const admin = createAdminClient();
  const { error } = await admin.from("tenants").update({ name, plan }).eq("id", id);
  if (error) return { error: error.message };

  await logSuperAdminAction({
    actorId: sa.id,
    actorEmail: sa.email,
    action: "update_tenant",
    targetTenantId: id,
    targetLabel: name,
    metadata: { plan },
  });

  revalidatePath(`/super-admin/tenants/${id}`);
  revalidatePath("/super-admin/tenants");
  return { ok: true };
}

/** 지점장 보기(read-only 미러) 진입 기록. view 페이지 진입 시 호출. */
export async function logImpersonateView(tenantId: string, tenantName: string): Promise<void> {
  const sa = await requireSuperAdmin();
  await logSuperAdminAction({
    actorId: sa.id,
    actorEmail: sa.email,
    action: "impersonate_view",
    targetTenantId: tenantId,
    targetLabel: tenantName,
  });
}

export type LicenseState = { error?: string; ok?: boolean } | undefined;

/** 좌석형 라이선스 upsert (max_seats 설정). */
export async function upsertTenantLicense(
  _prev: LicenseState,
  formData: FormData,
): Promise<LicenseState> {
  const sa = await requireSuperAdmin();
  const tenantId = String(formData.get("tenantId") ?? "").trim();
  const feature = String(formData.get("feature") ?? "").trim();
  const maxSeatsRaw = String(formData.get("maxSeats") ?? "").trim();
  const tenantName = String(formData.get("tenantName") ?? "").trim();
  if (!tenantId || !feature) return { error: "필수 값 누락" };
  const maxSeats = maxSeatsRaw === "" ? null : Number(maxSeatsRaw);
  if (maxSeats !== null && (!Number.isFinite(maxSeats) || maxSeats < 0)) {
    return { error: "좌석 수가 올바르지 않습니다" };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("tenant_licenses")
    .upsert(
      { tenant_id: tenantId, feature, max_seats: maxSeats, is_active: true },
      { onConflict: "tenant_id,feature" },
    );
  if (error) return { error: error.message };

  await logSuperAdminAction({
    actorId: sa.id,
    actorEmail: sa.email,
    action: "grant_license",
    targetTenantId: tenantId,
    targetLabel: tenantName || null,
    metadata: { feature, maxSeats },
  });
  revalidatePath(`/super-admin/tenants/${tenantId}`);
  return { ok: true };
}

/** 토글형 라이선스 On/Off (없으면 생성). */
export async function toggleTenantLicense(
  _prev: LicenseState,
  formData: FormData,
): Promise<LicenseState> {
  const sa = await requireSuperAdmin();
  const tenantId = String(formData.get("tenantId") ?? "").trim();
  const feature = String(formData.get("feature") ?? "").trim();
  const nextActive = String(formData.get("nextActive") ?? "") === "true";
  const tenantName = String(formData.get("tenantName") ?? "").trim();
  if (!tenantId || !feature) return { error: "필수 값 누락" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("tenant_licenses")
    .upsert(
      { tenant_id: tenantId, feature, is_active: nextActive },
      { onConflict: "tenant_id,feature" },
    );
  if (error) return { error: error.message };

  await logSuperAdminAction({
    actorId: sa.id,
    actorEmail: sa.email,
    action: "toggle_license",
    targetTenantId: tenantId,
    targetLabel: tenantName || null,
    metadata: { feature, active: nextActive },
  });
  revalidatePath(`/super-admin/tenants/${tenantId}`);
  return { ok: true };
}

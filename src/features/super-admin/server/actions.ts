"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth/super-admin";
import { protectionRefusal, protectionStatus } from "@/lib/auth/protected-accounts";
import { createAdminClient } from "@/lib/supabase/admin";
import { EMAIL_TAKEN_MESSAGE, isEmailTakenAuthError } from "@/lib/auth/auth-email-error";
import { PUBLIC_BRANDING_TENANTS_TAG } from "@/features/owner/server/public-branding";
import { tenantSettingsTag } from "@/features/owner/server/queries";
import { dropPersonFromSettings } from "@/features/owner/server/retired-people";
import { licenseFlagsTag } from "@/lib/license/server";
import { flagsFromMode, isShellMode } from "@/lib/license/shell-mode";
import { SYSTEM_ROLES, type SystemRole } from "@/lib/permissions";
import { NEW_TENANT_LICENSE_OPTIONS, newTenantLicenseSelection } from "../new-tenant-licenses";
import { SEAT_FEATURES, TOGGLE_FEATURES, WINDOW_KEEPALIVE_KEY } from "../labels";
import { logSuperAdminAction } from "./audit";
import { logDbError, explainDbError } from "@/lib/supabase/db-error";
import { authPasswordErrorMessage } from "@/lib/auth/auth-password-error";

export type CreateTenantState =
  | { error?: string; fieldErrors?: Record<string, string> }
  | undefined;

// 2~40자 — 지점 약어(`cs` = 침산, 원장 2026-09-18)가 두 글자라 하한을 3에서 2로 내렸다. 한 번 정하면 안 바꾼다(URL엔 안 쓰지만
// env `PUBLIC_BRAND_TENANT_SLUG`·스크립트 `--tenant=`가 가리킨다).
const SLUG_RE = /^[a-z][a-z0-9-]{0,38}[a-z0-9]$/;

type AdminClient = ReturnType<typeof createAdminClient>;

async function rollbackCreatedTenant(admin: AdminClient, tenantId: string, failedAt: string): Promise<boolean> {
  const { data, error } = await admin
    .from("tenants")
    .delete()
    .eq("id", tenantId)
    .select("id")
    .maybeSingle();
  updateTag(PUBLIC_BRANDING_TENANTS_TAG);
  if (error || data?.id !== tenantId) {
    logDbError(error ?? new Error("롤백할 학원 행을 확인하지 못했습니다"), "super-admin.actions.createTenantWithMaster.rollback", {
      tenantId,
      failedAt,
    });
    return false;
  }
  return true;
}

async function readTenantNameForAudit(
  admin: AdminClient,
  tenantId: string,
  scope: string,
): Promise<{ name: string } | { error: string }> {
  const { data, error } = await admin.from("tenants").select("name").eq("id", tenantId).maybeSingle();
  if (error) {
    logDbError(error, `super-admin.actions.${scope}.tenant`, { tenantId });
    return { error: "학원 정보를 읽지 못했습니다 — 잠시 후 다시 시도해 주세요" };
  }
  const name = typeof data?.name === "string" ? data.name.trim() : "";
  return name ? { name } : { error: "학원을 찾을 수 없습니다 — 새로고침 후 다시 시도해 주세요" };
}

/**
 * 신규 학원(tenant) + 원장(master) 동시 생성.
 *
 * 1) tenants INSERT (uuid 미리 생성)
 * 2) 일반판 설정 + 고른 기능의 명시 라이선스 행 생성
 * 3) auth.users 생성 (admin API). app_metadata에 { tenant_id, system_role: 'master' } 주입.
 * 4) tg_sync_user_from_auth 트리거가 public.users에 자동 mirror.
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
  const licenses = newTenantLicenseSelection(formData);

  const fieldErrors: Record<string, string> = {};
  if (!slug || !SLUG_RE.test(slug)) {
    fieldErrors.slug = "영문 소문자·숫자·하이픈 2~40자 (예: cs)";
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
    .select("id, name")
    .single();
  if (tenantErr) {
    if (tenantErr.code === "23505") {
      return { fieldErrors: { slug: "이미 사용 중인 slug 입니다" } };
    }
    return { error: explainDbError(tenantErr, { scope: "super-admin.actions.createTenantWithMaster", fallback: "학원 생성 실패 — 잠시 후 다시 시도해 주세요" }).message };
  }
  const tenantId = tenantRow.id as string;
  const tenantName = tenantRow.name as string;

  // 1-1) 새 학원 = 일반판 프리셋(원장 2026-09-22 방향 B). 🔴 일반판은 **이 표식이 있어야만** 켜진다(preset.ts —
  //      표식 없는 학원은 침산 규칙으로 돈다). 그래서 표식을 못 남기면 학원 생성 자체를 되돌린다(조용히 침산 규칙을 받은
  //      새 학원이 생기지 않게). 값은 표식뿐 — 기본값 문서를 복사하지 않는다(일반판 기본값이 나아지면 손대지 않은 칸은 따라오게).
  //      계정보다 먼저 쓰는 이유: 여기서 실패하면 되돌릴 것이 학원 행 하나뿐이다(설정 행은 학원 삭제에 함께 지워진다 — FK cascade).
  const { error: settingsErr } = await admin
    .from("tenant_settings")
    .insert({ tenant_id: tenantId, data: { version: 1, preset: "generic", permissions: { specialAccess: { studentStatusManagerIds: [] } } } });
  if (settingsErr) {
    if (!(await rollbackCreatedTenant(admin, tenantId, "tenant_settings"))) {
      return { error: "학원 설정 생성에 실패했고, 만들어진 학원도 되돌리지 못했습니다 — 학원 목록을 확인해 주세요" };
    }
    return { error: explainDbError(settingsErr, { scope: "super-admin.actions.createTenantWithMaster", fallback: "학원 설정 생성 실패 — 잠시 후 다시 시도해 주세요" }).message };
  }

  // 1-2) 행 없음=허용인 기존 지점 규칙은 그대로 두고, 새 학원만 세 기능의 선택값을 명시 행으로 고정한다.
  const { error: licensesErr } = await admin.from("tenant_licenses").insert(
    NEW_TENANT_LICENSE_OPTIONS.map(({ key }) => ({
      tenant_id: tenantId,
      feature: key,
      is_active: licenses[key],
      expires_at: null,
    })),
  );
  if (licensesErr) {
    if (!(await rollbackCreatedTenant(admin, tenantId, "tenant_licenses"))) {
      return { error: "기능 설정 생성에 실패했고, 만들어진 학원도 되돌리지 못했습니다 — 학원 목록을 확인해 주세요" };
    }
    return { error: explainDbError(licensesErr, { scope: "super-admin.actions.createTenantWithMaster", fallback: "기능 설정 생성 실패 — 잠시 후 다시 시도해 주세요" }).message };
  }

  // 3) auth.users 생성
  const { error: authErr } = await admin.auth.admin.createUser({
    email: masterEmail,
    password: masterPassword,
    email_confirm: true,
    app_metadata: { tenant_id: tenantId, system_role: "master" },
    user_metadata: { display_name: displayName },
  });
  if (authErr) {
    // rollback tenant — insert~delete 사이에 단일 테넌트 판정이 캐시됐을 수 있어 롤백 후에도 비운다.
    if (!(await rollbackCreatedTenant(admin, tenantId, "auth_user"))) {
      return { error: "원장 계정 생성에 실패했고, 만들어진 학원도 되돌리지 못했습니다 — 학원 목록을 확인해 주세요" };
    }
    if (isEmailTakenAuthError(authErr)) return { error: `master 계정 생성 실패 — ${EMAIL_TAKEN_MESSAGE}` };
    return { error: authPasswordErrorMessage(authErr) ?? explainDbError(authErr, { scope: "super-admin.actions.createTenantWithMaster", fallback: "원장 계정 생성 실패 — 잠시 후 다시 시도해 주세요" }).message };
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
    targetLabel: tenantName,
    metadata: { slug, masterEmail, plan, ...licenses },
  });

  revalidatePath("/super-admin/tenants");
  revalidatePath("/super-admin");
  // 비로그인 브랜딩(getPublicBranding)은 학원이 1개면 그 학원, 2개+면 env `PUBLIC_BRAND_TENANT_SLUG`의 학원만 쓴다
  // (`pickBrandTenantId`) — 두 번째 학원이 생기는 이 순간 판정이 바뀌고 자리 PIN의 지점 목록도 늘어나므로 캐시를
  // 즉시 비운다(안 비우면 TTL 1시간 동안 로그인 화면이 첫 학원 브랜드를 계속 보여주고 새 지점은 PIN 화면에 안 선다).
  updateTag(PUBLIC_BRANDING_TENANTS_TAG);
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

  if (!id) return { error: "학원을 찾을 수 없습니다 — 새로고침 후 다시 저장하세요" };
  if (!name) return { error: "이름은 비울 수 없습니다" };
  // 빈 플랜은 저장하지 않는다 — 목록 배지가 "—"가 되고 플랜 필터(무료/유료) 어디에도 안 잡힌다.
  if (!plan) return { error: "플랜을 비울 수 없습니다 — 무료·프로·엔터프라이즈 중 하나를 고르거나 직접 적으세요" };

  const admin = createAdminClient();
  const { error } = await admin.from("tenants").update({ name, plan }).eq("id", id);
  if (error) return { error: explainDbError(error, { scope: "super-admin.actions.updateTenant", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  await logSuperAdminAction({
    actorId: sa.id,
    actorEmail: sa.email,
    action: "update_tenant",
    targetTenantId: id,
    targetLabel: name,
    metadata: { plan },
  });

  // 학원명은 브랜딩 소스다 — `resolveSettings`가 `profile.name || tenants.name`으로 폴백하므로,
  // /owner에서 학원명을 따로 넣지 않은 테넌트(신규 테넌트 기본값)는 **이 이름이 그대로** 로그인 화면·
  // 탭 제목·인쇄물에 나간다. 설정 캐시가 그 값을 담고 있으니 saveOwnerSection과 같은 규약으로 비운다
  // (경로 revalidate는 태그 캐시를 안 비운다 — 안 하면 최대 300초 옛 이름 노출).
  updateTag(tenantSettingsTag(id));
  // 지점 선택지(자리 PIN 화면)는 `tenants.name`을 캐시해 두므로 개명도 같은 태그로 즉시 비운다(생성/삭제와 같은 규약).
  updateTag(PUBLIC_BRANDING_TENANTS_TAG);
  revalidatePath("/", "layout");
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

export type UserMgmtState =
  | { error?: string; ok?: boolean; tempPassword?: string }
  | undefined;

/** 사용자 academy role 변경 (app_metadata + public.users 동기화). */
export async function changeUserRole(
  _prev: UserMgmtState,
  formData: FormData,
): Promise<UserMgmtState> {
  const sa = await requireSuperAdmin();
  const userId = String(formData.get("userId") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();
  const tenantId = String(formData.get("tenantId") ?? "").trim();
  const tenantName = String(formData.get("tenantName") ?? "").trim();
  if (!userId || !role || !tenantId) return { error: "필수 값 누락" };
  if (!SYSTEM_ROLES.some((allowed) => allowed === role && allowed !== "student")) {
    return { error: "지원하지 않는 역할입니다" };
  }

  const admin = createAdminClient();
  // 🔴 계정 = 지점 1:1 — 폼이 보낸 tenantId를 그대로 app_metadata에 쓰면 `users.tenant_id`와 갈릴 수 있다(로그인은 B 지점 RLS,
  //    직원 행은 A 지점). 계정의 실제 지점과 같을 때만 진행한다. 지점을 옮기는 기능이 아니다(옮기기 = 새 지점에 계정 하나 더).
  const { data: owner, error: ownerErr } = await admin.from("users").select("tenant_id").eq("id", userId).maybeSingle();
  if (ownerErr || !owner?.tenant_id) {
    logDbError(ownerErr, "super-admin.changeUserRole");
    return { error: "대상 계정을 찾을 수 없습니다" };
  }
  if (String(owner.tenant_id) !== tenantId) {
    return { error: "계정의 지점과 요청한 지점이 다릅니다 — 화면을 새로고침한 뒤 다시 시도하세요" };
  }
  // 보호 계정(슈퍼관리자 명단)은 총괄 콘솔에서도 역할을 못 바꾼다(원장 2026-09-30 "강력 가드. 꼭 물어봐야").
  // 명단 조회 실패도 막는다(재시도 문구) — 거절 기록은 진짜 보호 계정일 때만.
  const protection = await protectionStatus(userId);
  if (protection === "protected") {
    await logSuperAdminAction({
      actorId: sa.id, actorEmail: sa.email, action: "protected_account_refused",
      targetTenantId: tenantId, targetLabel: tenantName || null, metadata: { userId, attempt: "role", role },
    });
  }
  const roleRefusal = protectionRefusal(protection);
  if (roleRefusal) return { error: roleRefusal };
  // app_metadata 갱신 (RLS auth_tenant_id는 tenant_id, academy 권한은 system_role)
  const { error: authErr } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { system_role: role, tenant_id: tenantId },
  });
  if (authErr) return { error: explainDbError(authErr, { scope: "super-admin.actions.changeUserRole", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  // public.users 즉시 반영 (트리거가 처리하지만 명시)
  await admin.from("users").update({ system_role: role }).eq("id", userId).eq("tenant_id", tenantId);

  await logSuperAdminAction({
    actorId: sa.id,
    actorEmail: sa.email,
    action: "change_user_role",
    targetTenantId: tenantId,
    targetLabel: tenantName || null,
    metadata: { userId, role },
  });
  revalidatePath(`/super-admin/tenants/${tenantId}`);
  return { ok: true };
}

/** 임시 비밀번호 발급 (1회 표시 후 사용자에게 직접 전달). */
export async function resetUserPassword(
  _prev: UserMgmtState,
  formData: FormData,
): Promise<UserMgmtState> {
  const sa = await requireSuperAdmin();
  const userId = String(formData.get("userId") ?? "").trim();
  const tenantId = String(formData.get("tenantId") ?? "").trim();
  const tenantName = String(formData.get("tenantName") ?? "").trim();
  if (!userId || !tenantId) return { error: "필수 값 누락" };

  const admin = createAdminClient();
  const { data: account, error: accountError } = await admin.from("users")
    .select("id").eq("id", userId).eq("tenant_id", tenantId).maybeSingle();
  if (accountError || !account) {
    logDbError(accountError, "super-admin.resetUserPassword");
    return { error: "해당 지점의 계정을 찾을 수 없습니다" };
  }

  // 임시 비번 생성 (영숫자 12자)
  const tempPassword = Array.from(crypto.getRandomValues(new Uint8Array(9)))
    .map((b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31])
    .join("");

  const { error } = await admin.auth.admin.updateUserById(userId, { password: tempPassword });
  if (error) return { error: authPasswordErrorMessage(error) ?? explainDbError(error, { scope: "super-admin.actions.resetUserPassword", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  await logSuperAdminAction({
    actorId: sa.id,
    actorEmail: sa.email,
    action: "reset_user_password",
    targetTenantId: tenantId || null,
    targetLabel: tenantName || null,
    metadata: { userId },
  });
  return { ok: true, tempPassword };
}

/** 사용자 활성/비활성 (auth ban + public.users.status). */
export async function setUserActive(
  _prev: UserMgmtState,
  formData: FormData,
): Promise<UserMgmtState> {
  const sa = await requireSuperAdmin();
  const userId = String(formData.get("userId") ?? "").trim();
  const active = String(formData.get("active") ?? "") === "true";
  const tenantId = String(formData.get("tenantId") ?? "").trim();
  const tenantName = String(formData.get("tenantName") ?? "").trim();
  if (!userId || !tenantId) return { error: "필수 값 누락" };

  const admin = createAdminClient();
  const { data: account, error: accountError } = await admin.from("users")
    .select("id, status, system_role").eq("id", userId).eq("tenant_id", tenantId).maybeSingle();
  if (accountError || !account) {
    logDbError(accountError, "super-admin.setUserActive");
    return { error: "해당 지점의 계정을 찾을 수 없습니다" };
  }
  // 보호 계정(슈퍼관리자 명단)은 비활성·재활성도 못 한다(원장 2026-09-30 "강력 가드"). 조회 실패도 막는다.
  const protection = await protectionStatus(userId);
  if (protection === "protected") {
    await logSuperAdminAction({
      actorId: sa.id, actorEmail: sa.email, action: "protected_account_refused",
      targetTenantId: tenantId, targetLabel: tenantName || null, metadata: { userId, attempt: "status", active },
    });
  }
  const activeRefusal = protectionRefusal(protection);
  if (activeRefusal) return { error: activeRefusal };
  // 비활성: 100년 ban / 활성: ban 해제(0)
  const { error: authErr } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: active ? "none" : "876000h",
  });
  if (authErr) return { error: explainDbError(authErr, { scope: "super-admin.actions.setUserActive", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  // `.select` — 0행이면 저장되지 않은 것이다(리뷰 r1 F5: 저장 결과를 보지 않고 정리·'성공'을 내던 것을 고침).
  const { data: statusRows, error: statusErr } = await admin.from("users")
    .update({ status: active ? "active" : "inactive" }).eq("id", userId).eq("tenant_id", tenantId).select("id");
  const statusSaved = !statusErr && (statusRows?.length ?? 0) > 0;
  if (statusErr) logDbError(statusErr, "super-admin.setUserActive.status");
  else if (!statusSaved) console.error("[super-admin/setUserActive] 재직 상태 저장 0행", { tenantId, userId });
  // 퇴사자 권한 정리(원장 2026-11-09 *"퇴사시 같이 사라지게"*) — 직원관리의 퇴사·재입사와 같은 함수(그 지점 학원 설정에서 그 사람에게 **주는** 값만 뺀다).
  // 퇴사 상태에서 다시 활성으로 돌릴 때도 뺀다(옛 값이 되살아나지 않게). 이미 활성인 계정을 다시 '활성'으로 누른 것은 건드리지 않는다.
  // 🔴 재직 상태가 실제로 저장된 뒤에만 한다. 정리가 던져도 아래 운영 감사는 남긴다(결과는 그 줄에 싣는다).
  const cleans = statusSaved && (!active || account.status === "inactive");
  let permissionCleanup: Awaited<ReturnType<typeof dropPersonFromSettings>> | null = null;
  if (cleans) {
    try {
      const role = SYSTEM_ROLES.find((r) => r === account.system_role) ?? null;
      permissionCleanup = await dropPersonFromSettings(tenantId, userId, role as SystemRole | null, admin);
    } catch (e) {
      console.error("[super-admin/setUserActive] 퇴사자 권한 정리 실패", e);
      permissionCleanup = { ok: false, reason: "write" };
    }
  }
  try {
    updateTag(tenantSettingsTag(tenantId));
  } catch (e) {
    console.error("[super-admin/setUserActive] 설정 캐시 비우기 실패", e);
  }

  await logSuperAdminAction({
    actorId: sa.id,
    actorEmail: sa.email,
    action: "set_user_active",
    targetTenantId: tenantId || null,
    targetLabel: tenantName || null,
    metadata: {
      userId,
      active,
      ...(statusSaved ? {} : { statusSaved: false }),
      ...(permissionCleanup ? { permissionCleanup: permissionCleanup.ok ? { removed: permissionCleanup.removed, kept: permissionCleanup.kept } : { failed: permissionCleanup.reason } } : {}),
    },
  });
  revalidatePath(`/super-admin/tenants/${tenantId}`);
  if (!statusSaved) return { error: "로그인 차단은 바뀌었지만 재직 상태를 저장하지 못했습니다 — 다시 시도해 주세요" };
  return { ok: true };
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
  if (!tenantId || !feature) return { error: "필수 값 누락" };
  if (!SEAT_FEATURES.some((item) => item.key === feature)) return { error: "지원하지 않는 좌석 기능입니다" };
  const maxSeats = maxSeatsRaw === "" ? null : Number(maxSeatsRaw);
  if (maxSeats !== null && (!Number.isSafeInteger(maxSeats) || maxSeats < 0)) {
    return { error: "좌석 수가 올바르지 않습니다" };
  }

  const admin = createAdminClient();
  const tenant = await readTenantNameForAudit(admin, tenantId, "upsertTenantLicense");
  if ("error" in tenant) return { error: tenant.error };
  const { error } = await admin
    .from("tenant_licenses")
    .upsert(
      { tenant_id: tenantId, feature, max_seats: maxSeats, is_active: true },
      { onConflict: "tenant_id,feature" },
    );
  if (error) return { error: explainDbError(error, { scope: "super-admin.actions.upsertTenantLicense", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  await logSuperAdminAction({
    actorId: sa.id,
    actorEmail: sa.email,
    action: "grant_license",
    targetTenantId: tenantId,
    targetLabel: tenant.name,
    metadata: { feature, maxSeats },
  });
  updateTag(licenseFlagsTag(tenantId)); // 셸 표시용 라이선스 캐시(창 모드·꺼진 기능 버튼)
  revalidatePath(`/super-admin/tenants/${tenantId}`);
  return { ok: true };
}

/**
 * 지점 **화면 방식** 설정(창 모드 / 단일 화면(이전 화면 유지) / 단일 화면) — 라이선스 행 둘(`window_mode`·`window_keepalive`)을 **한 번에** 쓴다.
 * 🔴 항상 둘 다 쓴다 — 반쪽만 남으면 뜻이 갈린다(예: 창 모드를 껐는데 keepalive 행만 켜진 채 남음 → 판정은 단일 화면이라 무해하지만 카드가 거짓말).
 * 기존 `window_mode` 행의 뜻은 그대로("창 엔진을 쓰나")이고 새 행은 opt-in이라 SQL·마이그레이션이 없다(shell-mode.ts).
 */
export async function setTenantWindowMode(_prev: LicenseState, formData: FormData): Promise<LicenseState> {
  const sa = await requireSuperAdmin();
  const tenantId = String(formData.get("tenantId") ?? "").trim();
  const mode = String(formData.get("mode") ?? "");
  if (!tenantId) return { error: "필수 값 누락" };
  if (!isShellMode(mode)) return { error: "지원하지 않는 화면 방식입니다" };
  const { windowMode, keepalive } = flagsFromMode(mode);

  const admin = createAdminClient();
  const tenant = await readTenantNameForAudit(admin, tenantId, "setTenantWindowMode");
  if ("error" in tenant) return { error: tenant.error };
  // 만료일도 지운다 — 만료된 행을 켜 봐야 판정(`licenseAllows`)은 여전히 막아 카드만 켜진 척한다(토글과 같은 이유).
  const { error } = await admin.from("tenant_licenses").upsert(
    [
      { tenant_id: tenantId, feature: "window_mode", is_active: windowMode, expires_at: null },
      { tenant_id: tenantId, feature: WINDOW_KEEPALIVE_KEY, is_active: keepalive, expires_at: null },
    ],
    { onConflict: "tenant_id,feature" },
  );
  if (error) return { error: explainDbError(error, { scope: "super-admin.actions.setTenantWindowMode", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  await logSuperAdminAction({
    actorId: sa.id,
    actorEmail: sa.email,
    action: "toggle_license",
    targetTenantId: tenantId,
    targetLabel: tenant.name,
    metadata: { feature: "window_mode", active: windowMode, mode },
  });
  updateTag(licenseFlagsTag(tenantId)); // 셸 표시용 라이선스 캐시(화면 방식)
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
  if (!tenantId || !feature) return { error: "필수 값 누락" };
  if (!TOGGLE_FEATURES.some((item) => item.key === feature)) return { error: "지원하지 않는 기능입니다" };

  const admin = createAdminClient();
  const tenant = await readTenantNameForAudit(admin, tenantId, "toggleTenantLicense");
  if ("error" in tenant) return { error: tenant.error };
  const { error } = await admin
    .from("tenant_licenses")
    .upsert(
      // 켤 때는 만료일도 지운다 — 만료된 행을 켜 봐야 게이트(`licenseAllows`)는 여전히 막아 스위치만 켜진 척한다.
      nextActive
        ? { tenant_id: tenantId, feature, is_active: true, expires_at: null }
        : { tenant_id: tenantId, feature, is_active: false },
      { onConflict: "tenant_id,feature" },
    );
  if (error) return { error: explainDbError(error, { scope: "super-admin.actions.toggleTenantLicense", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  await logSuperAdminAction({
    actorId: sa.id,
    actorEmail: sa.email,
    action: "toggle_license",
    targetTenantId: tenantId,
    targetLabel: tenant.name,
    metadata: { feature, active: nextActive },
  });
  updateTag(licenseFlagsTag(tenantId)); // 셸 표시용 라이선스 캐시(창 모드·꺼진 기능 버튼)
  revalidatePath(`/super-admin/tenants/${tenantId}`);
  return { ok: true };
}

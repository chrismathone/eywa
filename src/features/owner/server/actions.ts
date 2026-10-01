"use server";

import { revalidatePath, updateTag } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPermissionLocked, type SystemRole } from "@/lib/permissions";
import { createUploadTicket, MEDIA_KIND } from "@/lib/storage/media-storage";
import { isTenantBrandingPath } from "@/lib/storage/legacy-audio-path";
import type { UploadTicket } from "@/lib/storage/types";
import { logAction } from "@/features/audit/server/log";
import { diffSettingsSection } from "../settings-diff";
import { tenantSettingsTag } from "./queries";
import { SECTION_SCHEMAS, SECTION_LABELS, type SectionKey, type PermissionsSettings } from "../settings-types";
import { prepareSectionForSave, presetOfStored } from "../preset";
import { normalizeDashboard } from "@/features/dashboard/layout/normalize";
import { navigationRevision } from "../normalize-navigation";
import { logDbError } from "@/lib/supabase/db-error";

export type OwnerSaveState = { ok?: boolean; error?: string; nonce?: number } | undefined;

/**
 * 학원 설정 섹션 1개 저장. 게이트 = 역할·권한 매트릭스(owner 메뉴, override 반영 — #58) —
 * 원장이 admin/manager에게 owner를 위임하면 설정 편집도 열린다. 단 **permissions(역할·권한) 섹션만은
 * 항상 master 전용**(self-escalation 차단 — 위임받은 역할이 권한 자체를 바꾸는 것 금지, 0080a DB 트리거와 이중 방어).
 * data(JSON)를 섹션 Zod로 검증 후 기존 jsonb에 머지(섹션 단위 덮어쓰기 — 다른 섹션 보존).
 */
// 로고/직인/팝업 이미지 업로드 티켓 — saveOwnerSection과 동일 게이트(owner 쓰기). 반환 path를 logoUrl/sealUrl에 저장.
export type IssueBrandingTicketState = { ticket?: UploadTicket; error?: string } | undefined;
// logo/seal=인쇄물 브랜딩. popup=공지 팝업 이미지(같은 branding 버킷·경로·권한 재사용 — master 전용 이미지).
const BRANDING_SLOTS = new Set(["logo", "seal", "popup"]);
export async function issueBrandingUploadTicket(
  _prev: IssueBrandingTicketState,
  formData: FormData,
): Promise<IssueBrandingTicketState> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(actor.systemRole, "owner"))) {
    return { error: "학원 설정(owner) 변경 권한이 없습니다" };
  }

  const slot = String(formData.get("slot") ?? "");
  if (!BRANDING_SLOTS.has(slot)) return { error: "잘못된 슬롯입니다" };
  const contentType = String(formData.get("contentType") ?? "");
  if (!MEDIA_KIND.branding.allowCT(contentType)) return { error: "이미지 파일만 업로드할 수 있습니다" };
  const size = Number(formData.get("size") ?? 0);
  if (!Number.isFinite(size) || size <= 0 || size > MEDIA_KIND.branding.maxBytes) {
    return { error: "파일이 너무 큽니다 (최대 5MB)" };
  }
  const ext = String(formData.get("ext") ?? "").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const path = `${actor.tenantId}/branding/${crypto.randomUUID()}.${ext}`;
  if (!isTenantBrandingPath(path, actor.tenantId)) return { error: "경로 생성 실패" };

  try {
    return { ticket: await createUploadTicket({ kind: "branding", path, contentType }) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "업로드 티켓 발급 실패" };
  }
}

export async function saveOwnerSection(
  _prev: OwnerSaveState,
  formData: FormData,
): Promise<OwnerSaveState> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "로그인이 필요합니다" };

  const section = String(formData.get("section") ?? "") as SectionKey;
  const schema = SECTION_SCHEMAS[section];
  if (!schema) return { error: "알 수 없는 설정 섹션입니다" };

  // 역할·권한(permissions) 섹션 = 항상 master 전용(self-escalation 차단 — 위임받은 역할이 자기/타인 권한을
  // 못 바꿈, 0080a DB 트리거 이중 방어). 그 외 섹션 = owner 메뉴 쓰기 권한(override 반영 — 위임 가능).
  if (section === "permissions") {
    if (actor.systemRole !== "master") {
      return { error: "역할·권한은 원장(master)만 변경할 수 있습니다" };
    }
  } else if (!(await canWriteTenant(actor.systemRole, "owner"))) {
    return { error: "학원 설정 변경 권한이 없습니다" };
  }
  // '기능 켜기·끄기'는 권한처럼 "무엇이 있나"를 정하는 층이라 위임 계정엔 안 연다 — 원장 + 총괄(super_admin 자동 통과 규약).
  // 0281a 트리거가 같은 선을 DB에서 긋는다(이중 방어, [[#77]]).
  if (section === "modules" && actor.systemRole !== "master" && !(await isCurrentUserSuperAdmin())) {
    return { error: "기능 켜기·끄기는 원장만 바꿀 수 있습니다" };
  }

  // '대시보드 관리'(역할별 운영실 배치) = 누가 무엇을 보나를 정하는 층이라 권한처럼 **원장 + 총괄**만(위임 계정 불가).
  // 비원장에게 배치를 열면 자기 화면에 원장 전용 칸(금액·직원)을 넣을 수 있다 — 편집 화면만 감추는 건 게이트가 아니다([[#77]]).
  if (section === "dashboard" && actor.systemRole !== "master" && !(await isCurrentUserSuperAdmin())) {
    return { error: "대시보드 배치는 원장만 바꿀 수 있습니다" };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(String(formData.get("data") ?? "null"));
  } catch {
    return { error: "설정 데이터 형식이 올바르지 않습니다" };
  }

  const result = schema.safeParse(parsedJson);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join(".");
    return { error: `입력값 오류${path ? ` (${path})` : ""}: ${first?.message ?? "검증 실패"}` };
  }

  const supabase = await createClient();
  // 기존 문서 읽어 섹션만 교체(다른 섹션 보존). RLS로 자기 테넌트만.
  const { data: existing, error: readError } = await supabase
    .from("tenant_settings")
    .select("data, updated_at")
    .eq("tenant_id", actor.tenantId)
    .maybeSingle();
  // 🔴 못 읽었으면 저장하지 않는다 — 빈 문서 위에 이 섹션만 얹으면 다른 섹션이 전부 지워진다(적대 리뷰 2026-09-22).
  if (readError) {
    console.error("[owner/actions] tenant_settings 조회 오류 — 저장 중단", readError);
    return { error: "설정을 불러오지 못해 저장하지 않았습니다. 잠시 뒤 다시 시도하세요." };
  }

  const preset = presetOfStored(existing?.data ?? null);
  // '기능 켜기·끄기'는 새 학원(일반판)에만 있는 설정이다 — 침산은 화면에서 감출 뿐 아니라 서버도 받지 않는다([[#77]]).
  // (받으면 owner 쓰기를 위임받은 사람이 요청을 만들어 침산 모듈을 끌 수 있고, 침산엔 되돌릴 화면이 없다.)
  if (section === "modules" && preset !== "generic") {
    return { error: "이 학원은 기능 켜기·끄기를 쓰지 않습니다" };
  }
  if (section === "permissions" && preset === "generic") {
    const p = result.data as PermissionsSettings;
    const ids = [...new Set([
      ...p.userOverrides.map((r) => r.userId),
      ...p.specialAccess.payslipViewerIds,
      ...p.specialAccess.leaveAdjusterIds,
    ])];
    if (ids.length > 0) {
      const { data: people, error: peopleError } = await createAdminClient()
        .from("users")
        .select("id, system_role, status")
        .eq("tenant_id", actor.tenantId)
        .in("id", ids)
        .limit(250);
      if (peopleError) {
        logDbError(peopleError, "owner.saveOwnerSection");
        return { error: "권한 대상 직원을 확인하지 못했습니다" };
      }
      const validIds = new Set((people ?? [])
        .filter((u) => u.system_role !== "student" && u.status !== "inactive")
        .map((u) => u.id));
      if (ids.some((id) => !validIds.has(id))) return { error: "현재 지점의 재직 직원만 권한 대상에 지정할 수 있습니다" };
      const roles = new Map((people ?? []).map((u) => [u.id, u.system_role as SystemRole]));
      if (p.userOverrides.some((r) => isPermissionLocked(r.menu, roles.get(r.userId)!, r.access))) {
        return { error: "이 역할에서 잠긴 메뉴 권한은 변경할 수 없습니다" };
      }
    }
  }
  const base = (existing?.data as Record<string, unknown> | null) ?? {};
  if (section === "navigation") {
    const expected = formData.get("navigationBaseline");
    if (typeof expected === "string" && expected !== navigationRevision(base.navigation)) {
      return { error: "다른 창에서 메뉴 구성이 변경되었습니다. 현재 편집 내용은 유지했습니다. 최신 구성을 새로고침한 뒤 다시 저장해 주세요." };
    }
  }
  // 대시보드 배치는 걸러서(모르는 카드·이탈 좌표) 저장하고, 기본 배치와 같은 역할은 저장값을 만들지 않는다(기본 개선이 따라오게).
  const sectionData =
    section === "dashboard"
      ? normalizeDashboard(result.data, { dropDefaults: true })
      : prepareSectionForSave(preset, section, parsedJson, result.data, base[section]);
  const nextData: Record<string, unknown> = { ...base, version: 1, [section]: sectionData };
  // 일반판 표식은 base에 이미 있다(학원 추가가 만든 행) — 한 번 더 못박아 둔다. 침산 행엔 아무것도 더하지 않는다.
  if (preset === "generic") nextData.preset = "generic";

  const write = {
      tenant_id: actor.tenantId,
      data: nextData,
      updated_by: actor.id,
      updated_at: new Date().toISOString(),
  };
  // 조회 이후 다른 설정 섹션이 먼저 저장돼도 그 문서를 덮지 않는다. 초기 생성의 동시 충돌도 insert로 막는다.
  const resultWrite = existing
    ? await supabase.from("tenant_settings").update(write).eq("tenant_id", actor.tenantId).eq("updated_at", existing.updated_at).select("tenant_id")
    : await supabase.from("tenant_settings").insert(write).select("tenant_id");
  const { error } = resultWrite;
  if (error) return { error: error.message };
  if (!resultWrite.data?.length) return { error: "다른 창에서 설정이 먼저 저장되었습니다. 새로고침한 뒤 다시 저장해 주세요." };

  // 🔴 **무엇이 바뀌었는지**를 함께 남긴다(원장 점검 2026-08-27) — 종전엔 `{section}`뿐이라
  //    "누가 언제 운영 체계를 저장했다"만 남고 되짚을 근거가 없었다. 비밀값·미등록 필드는 실리지 않는다.
  const diff = diffSettingsSection(section, (base as Record<string, unknown>)[section], sectionData);
  await logAction({
    action: "owner_settings_update",
    targetType: "tenant_settings",
    targetLabel: SECTION_LABELS[section],
    metadata: {
      section,
      ...(diff.changes.length ? { changes: diff.changes } : {}),
      ...(diff.others ? { others: diff.others } : {}),
    },
  });

  // 설정 캐시(unstable_cache, tenantId별) 무효화 — updateTag는 server action 전용 read-your-writes
  //   (같은 요청 내 즉시 만료·갱신)라 저장 직후 master가 새 값을 바로 본다. 아래 revalidatePath("/",
  //   "layout")은 문서상 unstable_cache 태그 무효화 폴백 겸 셸 재렌더(브랜드·과목 반영) 역할.
  updateTag(tenantSettingsTag(actor.tenantId));
  // 브랜드·과목·직급 등은 셸 전역에 쓰이므로 루트 레이아웃까지 갱신.
  revalidatePath("/", "layout");
  revalidatePath("/owner");
  if (section === "billing") revalidatePath("/billing");
  // 운영실은 저장 직후 새 배치로 보여야 한다(셸 전역 갱신에 더해 명시).
  if (section === "dashboard") revalidatePath("/dashboard");
  // 보고서·AI 멘트 설정 면은 /lesson-reports로 이관됨 — 그 라우트도 명시 갱신해야 저장 직후 값이 반영된다
  // (안 하면 report 섹션 저장 후 화면이 stale하게 옛 값으로 되돌아 보임 — 예: '강사 문항수 변경 허용' 체크 풀림).
  revalidatePath("/lesson-reports");
  // nonce — in-window 저장이라 연속 저장마다 폼 effect가 동시편집 신호를 1회씩 발화하도록(B-2).
  return { ok: true, nonce: Date.now() };
}

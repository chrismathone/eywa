"use server";

import { revalidatePath, updateTag } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOnOffMenu, isPermissionLocked, isScopedForbiddenRole, onOffAccessMessage, SCOPED_FORBIDDEN_MESSAGE, type SystemRole } from "@/lib/permissions";
import { createUploadTicket, MEDIA_KIND } from "@/lib/storage/media-storage";
import { isTenantBrandingPath } from "@/lib/storage/legacy-audio-path";
import type { UploadTicket } from "@/lib/storage/types";
import { logAction } from "@/features/audit/server/log";
import { diffSettingsSection } from "../settings-diff";
import { tenantSettingsTag } from "./queries";
import { SECTION_SCHEMAS, SECTION_LABELS, type SectionKey, type PermissionsSettings } from "../settings-types";
import { prepareSectionForSave, presetOfStored } from "../preset";
import { dashboardSavePart, mergeDashboardSave, normalizeDashboard } from "@/features/dashboard/layout/normalize";
import { validateDashboardAssignments } from "./dashboard-assignments";
import { navigationRevision } from "../normalize-navigation";
import { explainDbError, logDbError } from "@/lib/supabase/db-error";
import { plainSettingsReason, settingsValidationError } from "../settings-error";
import { platformSettingsError } from "./platform-settings";
import { OWNER_SECTION_MENU } from "@/lib/settings-role-catalog";
import { configureMakeupSettings } from "@/features/makeups/server/settings";
import { resolveSettings } from "../resolve";
import { subjectsWithNewcomerRecords } from "@/features/newcomers/server/subject-refs";
import { nextSettingsStamp, settingsRevOf, withoutSettingsRev } from "../settings-stamp";
import type { OperationsSettings } from "../settings-types";
import {
  CHANGED_ELSEWHERE_ERROR,
  STALE_FORM_ERROR,
  buildOperationsSave,
  operationsReply,
  readOperationsRequest,
  type OperationsReply,
  type OperationsRequest,
} from "./operations-save";
import { permissionsToken } from "./permissions-save";
import { hasDuplicateRoleCells } from "../permissions-canonical";
import { specialAccessTargets } from "../special-access";
import { payslipRefreshRequired } from "../payslip-permissions";
import { studentStatusRefreshRequired } from "../student-status-permissions";

/**
 * `operations` = 운영 섹션 저장이 확정한 상태(면별 기준 token · 과목 삭제는 그 면의 값도) — 화면이 다음 저장의 기준으로 쓴다.
 * `permissions` = 역할·권한 저장이 확정한 상태의 기준 token(같은 쓰임).
 * `version` = 이 저장이 쓴 그 섹션의 저장 순번(`data.<섹션>.rev` — 운영 · 역할·권한) — 화면이 "내려온 값이 이 저장보다 먼저 읽힌 것인가"를 가린다.
 */
export type OwnerSaveState =
  | { ok?: boolean; error?: string; nonce?: number; operations?: OperationsReply; permissions?: { token: string }; version?: number }
  | undefined;

/** 저장 순번(`rev`)을 섹션 안에 함께 쓰는 섹션 — 쓰는 곳이 여럿이라 편집 폼이 읽기와 저장의 선후를 가려야 하는 둘. */
const REV_SECTIONS: readonly SectionKey[] = ["operations", "permissions"];


/**
 * 학원 설정 섹션 1개 저장. 게이트 = 역할·권한 매트릭스(owner 메뉴, override 반영 — #58) —
 * 원장이 admin/manager에게 owner를 위임하면 설정 편집도 열린다. 단 **permissions(역할·권한) 섹션만은
 * 항상 master 전용**(self-escalation 차단 — 위임받은 역할이 권한 자체를 바꾸는 것 금지, 0080a DB 트리거와 이중 방어).
 * data(JSON)를 섹션 Zod로 검증 후 기존 jsonb에 머지(섹션 단위 덮어쓰기 — 다른 섹션 보존).
 */
// 로고/직인/팝업 이미지 업로드 티켓 — saveOwnerSection과 동일 게이트(owner 쓰기). 반환 path를 logoUrl/sealUrl에 저장.
export type IssueBrandingTicketState = { ticket?: UploadTicket; error?: string } | undefined;
// logo/seal=인쇄물 브랜딩. popup=공지 팝업 이미지(같은 branding 버킷·경로·권한 재사용 — master 전용 이미지).
// reportLogo=보고서 전용 로고(report.logoUrl) — 보고서 설정을 고치는 사람이 올리므로 report_settings 게이트.
const BRANDING_SLOTS = new Set(["logo", "seal", "popup", "reportLogo"]);
const BRANDING_SLOT_MENU = { popup: "popup_settings", reportLogo: "report_settings" } as const;
export async function issueBrandingUploadTicket(
  _prev: IssueBrandingTicketState,
  formData: FormData,
): Promise<IssueBrandingTicketState> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "로그인이 필요합니다" };
  const slot = String(formData.get("slot") ?? "");
  if (!BRANDING_SLOTS.has(slot)) return { error: "잘못된 슬롯입니다" };
  if (!(await canWriteTenant(actor.systemRole, BRANDING_SLOT_MENU[slot as keyof typeof BRANDING_SLOT_MENU] ?? "profile_settings"))) {
    return { error: "이미지 설정 변경 권한이 없습니다" };
  }
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
  if (!Object.hasOwn(SECTION_SCHEMAS, section)) return { error: "알 수 없는 설정 섹션입니다" };
  const schema = SECTION_SCHEMAS[section];
  if (!schema) return { error: "알 수 없는 설정 섹션입니다" };

  // 역할·권한(permissions) 섹션 = 항상 master 전용(self-escalation 차단 — 위임받은 역할이 자기/타인 권한을
  // 못 바꿈, 0080a DB 트리거 이중 방어). 그 외 섹션 = owner 메뉴 쓰기 권한(override 반영 — 위임 가능).
  if (section === "permissions") {
    if (actor.systemRole !== "master" || !(await canWriteTenant(actor.systemRole, "owner"))) {
      return { error: "역할·권한은 원장만 변경할 수 있습니다" };
    }
  } else if (!(await canWriteTenant(actor.systemRole, section in OWNER_SECTION_MENU ? OWNER_SECTION_MENU[section as keyof typeof OWNER_SECTION_MENU] : "owner"))) {
    return { error: section === "report" ? "보고서 설정 변경 권한이 없습니다" : "학원 설정 변경 권한이 없습니다" };
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

  // 🔴 운영 섹션은 요청 형식이 정해져 있다(두 면 · 시간표 칸 · 과목 삭제) — 섹션을 통째로 갈아끼우는 저장은 받지 않는다.
  //    쓰는 곳이 여럿이라(두 면·시간표·cron·시트 반영) 통째 교체는 먼저 한 저장을 조용히 되돌렸다(operations-slice.ts).
  let operationsRequest: OperationsRequest | undefined;
  if (section === "operations") {
    const read = readOperationsRequest(formData, parsedJson);
    if ("error" in read) return { error: read.error };
    operationsRequest = read.request;
  }
  // 🔴 역할·권한은 **화면이 연 시점의 기준 token**이 있어야 저장한다 — 섹션 전체를 되돌려 보내는 저장이라, 그사이 다른 곳
  //    (다른 창 · '역할 설정' 대화상자 · 운영자 스크립트)의 변경을 조용히 되돌리지 않으려면 기준이 필요하다(permissions-save.ts).
  const permissionsBaseline = section === "permissions" ? formData.get("permissionsBaseline") : null;
  if (section === "permissions" && (typeof permissionsBaseline !== "string" || !permissionsBaseline)) {
    return { error: STALE_FORM_ERROR };
  }
  // 시간표 칸·과목 삭제 요청은 data가 섹션 전체가 아니다 — 방금 읽은 값에 적용한 뒤 아래에서 검증한다.
  const sendsWholeSection = !operationsRequest || operationsRequest.kind === "face";
  const result = sendsWholeSection ? schema.safeParse(parsedJson) : null;
  if (result && !result.success) return { error: settingsValidationError(section, result.error.issues[0], parsedJson) };
  if (section === "makeups" && result) return configureMakeupSettings(result.data);
  // 같은 칸(메뉴·직급)을 두 번 지정한 요청은 받지 않는다 — 어느 줄이 적용될지가 읽는 곳마다 다르다
  // (앱은 마지막 줄, DB의 권한 함수는 먼저 걸리는 줄). 화면의 저장은 이런 요청을 만들지 않는다.
  // ⚠️ 스키마가 아니라 여기서 본다 — 스키마는 **이미 저장된 값**을 읽는 데도 쓰여서(운영 설정 보호 검사), 거기서 막으면
  //    그런 줄이 저장돼 있는 학원은 역할·권한을 아예 고칠 수 없게 된다.
  if (section === "permissions" && result && hasDuplicateRoleCells((result.data as PermissionsSettings).overrides)) {
    return { error: "같은 메뉴·직급의 권한을 두 번 지정할 수 없습니다" };
  }
  // 연결 앱 칸은 전체·없음만(원장 2026-11-05 — 링크를 세우나 마나) — 같은 까닭으로 여기서 **요청 값만** 본다. 저장돼 있던 그런 칸은
  // 화면이 기본값으로 읽어(resolveMatrix가 잠긴 값을 건너뛴다) 다시 싣지 않는다. 개인 줄은 아래 잠금 검사가 같은 문구로 본다.
  // 아래 '담당' 금지보다 먼저 본다 — 열람·아르바이트의 연결 앱 '담당'에 그 안내('읽기'를 고르라)를 내면 다시 보낸 '읽기'도 거절된다(재리뷰 2026-11-06).
  // 학원 비서도 전체·없음만이다(isOnOffMenu — 2026-11-09). 연결 앱 칸은 종전 문구 그대로(onOffAccessMessage).
  const onOffCell = section === "permissions" && result
    ? (result.data as PermissionsSettings).overrides.find((r) => isOnOffMenu(r.menu) && r.access !== "full" && r.access !== "none")
    : undefined;
  if (onOffCell) return { error: onOffAccessMessage(onOffCell.menu) };
  // 강사보다 낮은 직급(열람·아르바이트)의 '담당'(원장 2026-11-05) — 같은 까닭으로 스키마가 아니라 여기서 **요청 값만** 본다.
  // 화면은 저장돼 있던 그런 칸을 '읽기'(그 칸 기본값이 '없음'이면 '없음')로 내려(resolveMatrix) 보내므로, 저장값에 남아 있어도 이 면의 저장은 막히지 않는다.
  if (section === "permissions" && result && (result.data as PermissionsSettings).overrides.some((r) => r.access === "scoped" && isScopedForbiddenRole(r.role))) {
    return { error: SCOPED_FORBIDDEN_MESSAGE };
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
  // 화면을 연 뒤 역할·권한이 바뀌었으면(역할별 · 개인별 · 담당자 중 무엇이든) 저장하지 않는다.
  if (section === "permissions" && permissionsBaseline !== permissionsToken(resolveSettings(existing?.data ?? null, { name: "" }).permissions)) {
    return { error: CHANGED_ELSEWHERE_ERROR };
  }
  if (section === "permissions" && payslipRefreshRequired(parsedJson, (existing?.data as Record<string, unknown> | null)?.permissions)) {
    return { error: "새로고침한 뒤 급여명세서 권한을 다시 설정해 주세요." };
  }
  if (section === "permissions" && studentStatusRefreshRequired(parsedJson, (existing?.data as Record<string, unknown> | null)?.permissions)) {
    // 자리를 문장에 넣는다 — "담당자를 지정해 주세요"만으로는 어디서 하는지 몰라 같은 오류가 거듭 났다(원장 2026-11-05).
    // 전환과 메뉴 변경은 **한 번에 저장해도 된다**(요청에 studentStatusManagerIds 키가 실리면 이 검사를 지난다 · DB 트리거도 같다).
    // 막는 것은 **상태 변경 권한이 넓어지는 변경**뿐이다(사무실 역할의 원생 '전체' · 개인 '전체' — 판정은 studentStatusRefreshRequired).
    return { error: "이 변경은 원생 상태 변경(퇴원·휴원) 권한을 넓힙니다. 아래 '개인별 기능 권한 › 원생 상태 변경'에서 '담당자 지정으로 전환'을 누르고 담당자를 정한 뒤 함께 저장해 주세요. 이미 전환했다면 새로고침 후 다시 저장해 주세요." };
  }
  // 개인별 메뉴 권한의 대상 확인 — 어느 학원에서나 한다(침산도 역할 표 아래에서 개인별 권한을 준다, 원장 2026-10-06).
  //  · 개인별 메뉴 권한 — 새 학원(일반판): 종전대로 요청의 모든 줄을 본다. 침산: **새로 주거나 바꾸는 줄만** 본다 —
  //    이미 저장돼 있던 줄은 그대로 둘 수 있다. 전에 준 사람이 그 뒤 퇴직했다고 역할 표 저장까지 막히면, 화면에 안 보이는
  //    줄(지점에서 못 지우는 줄)이 하나만 그래도 이 면을 영영 저장할 수 없다.
  //  · 개인별 기능 권한(담당자 · 과목 범위) — **어느 학원에서나** 새로 지정하거나 바꾼 것만 본다(special-access.ts — 칸마다).
  //    전부를 다시 보면, 범위의 과목이 그 뒤 없어졌거나(과목 흡수) 지정한 사람이 퇴직한 학원은 역할 표 저장까지 막힌다.
  if (section === "permissions") {
    const p = result?.data as PermissionsSettings;
    const fresh = resolveSettings(existing?.data ?? null, { name: "" });
    const rowKey = (r: { userId: string; menu: string; access: string }) => `${r.userId}:${r.menu}:${r.access}`;
    // 저장돼 있던 줄은 깨져 있을 수 있다(손으로 넣은 값 — 줄이 null) — 읽을 수 있는 줄만 "그대로 둔 줄"로 친다.
    const readableStored: unknown[] = fresh.permissions.userOverrides;
    const storedRows: unknown[] = preset === "generic" ? [] : readableStored;
    const special = specialAccessTargets(p.specialAccess, fresh.permissions.specialAccess);
    // 과목 범위의 과목은 학원 설정에 있는 과목이어야 한다 — 없는 키는 아무와도 안 맞아 그 사람에게 직원이 한 명도 안 보인다.
    const knownSubjects = new Set(fresh.operations.subjects.map((s) => s.key));
    if (special.subjects.some((key) => !knownSubjects.has(key))) {
      return { error: "과목 범위에는 학원 설정에 있는 과목만 넣을 수 있습니다" };
    }
    const keysOf = (rows: unknown[]) => new Set(rows.flatMap((r) => {
      const row = r as { userId?: unknown; menu?: unknown; access?: unknown } | null;
      return row && typeof row.userId === "string" && typeof row.menu === "string" && typeof row.access === "string"
        ? [rowKey({ userId: row.userId, menu: row.menu, access: row.access })]
        : [];
    }));
    const kept = keysOf(storedRows);
    // 역할이 바뀌어(강사 → 아르바이트 등) 남은 옛 '담당' 개인 줄은 **어느 학원에서나** 그대로 둘 수 있다 — '읽기'(역할 칸이 '없음'이면 '없음')로 내려 적용되고
    // 화면은 그 까닭을 줄에 적는다(user-override-editor). 막으면 그 줄 하나 때문에 이 면 전체를 저장할 수 없다(리뷰 2026-11-05 · 일반판).
    const storedKeys = keysOf(readableStored);
    const checkedRows = p.userOverrides.filter((r) => !kept.has(rowKey(r)));
    const ids = [...new Set([...checkedRows.map((r) => r.userId), ...special.userIds])];
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
      const locked = checkedRows.find((r) => {
        const role = roles.get(r.userId)!;
        if (!isPermissionLocked(r.menu, role, r.access)) return false;
        // 저장돼 있던 연결 앱의 담당·읽기 줄(손으로 넣은 값)도 그대로 둘 수 있다 — 적용 단계가 건너뛴다(applyUserOverrides · 위 옛 '담당' 줄과 같은 까닭).
        // 학원 비서 줄도 같다(isOnOffMenu) — 그 사람이 뒤에 강사가 됐으면(강사 칸 잠금) 적용 단계가 건너뛰므로 남아 있어도 이 면의 저장을 막지 않는다.
        return !(((r.access === "scoped" && isScopedForbiddenRole(role)) || isOnOffMenu(r.menu)) && storedKeys.has(rowKey(r)));
      });
      if (locked) {
        // 전체·없음만인 칸(연결 앱 · 학원 비서)에 담당·읽기면 그렇다고 알린다(먼저 — 위 역할 칸 검사와 같은 차례) · 강사보다 낮은 직급의 '담당'이면 까닭을 알린다(원장 2026-11-05 "알림메시지도 배선" — 권한 표·개인별 권한 화면과 같은 문구).
        const onOffValue = isOnOffMenu(locked.menu) && locked.access !== "full" && locked.access !== "none";
        return { error: onOffValue ? onOffAccessMessage(locked.menu) : locked.access === "scoped" && isScopedForbiddenRole(roles.get(locked.userId)!) ? SCOPED_FORBIDDEN_MESSAGE : "이 역할에서 잠긴 메뉴 권한은 변경할 수 없습니다" };
      }
    }
  }
  const base = (existing?.data as Record<string, unknown> | null) ?? {};
  // 대시보드 동시 저장 = 마지막 저장이 이긴다(원장 2026-10-14) — 고친 부분(`dashboardPart`)을 밝혀 보내는 화면은 기준선 비교 없이
  // 지금 저장본 위에 그 부분만 덮어쓴다(mergeDashboardSave). 밝히지 않는 옛 요청만 종전대로 기준선이 다르면 거절한다.
  const dashboardPart = section === "dashboard" ? dashboardSavePart(formData.get("dashboardPart"), formData.get("dashboardTouched")) : null;
  if (dashboardPart === "invalid") return { error: "저장 요청을 읽지 못했습니다. 새로고침한 뒤 다시 저장해 주세요." };
  if (section === "dashboard") {
    const expected = formData.get("dashboardBaseline");
    if (!dashboardPart && typeof expected === "string" && expected !== JSON.stringify(normalizeDashboard(base.dashboard))) {
      return { error: "다른 창에서 대시보드 설정이 변경되었습니다. 새로고침한 뒤 다시 저장해 주세요." };
    }
    // 검사는 실제로 저장될 배정만 — 고친 부분을 밝힌 요청은 고친 직원 줄만 들어가므로(배치 저장이면 배정은 안 바뀐다)
    // 함께 실려 온 다른 직원 줄(그사이 퇴사·역할 변경)로 이 저장을 막지 않는다(리뷰 2026-10-14).
    const sent = normalizeDashboard(result?.data).assignments ?? [];
    const toCheck = dashboardPart
      ? (dashboardPart.part === "assignments" ? sent.filter((a) => dashboardPart.touched.includes(a.userId)) : [])
      : ((result?.data as { assignments?: unknown }).assignments !== undefined ? sent : []);
    if (toCheck.length) {
      const error = await validateDashboardAssignments(actor.tenantId, toCheck);
      if (error) return { error };
    }
  }
  if (section === "navigation") {
    const expected = formData.get("navigationBaseline");
    if (typeof expected === "string" && expected !== navigationRevision(base.navigation)) {
      return { error: "다른 창에서 메뉴 구성이 변경되었습니다. 현재 편집 내용은 유지했습니다. 최신 구성을 새로고침한 뒤 다시 저장해 주세요." };
    }
  }
  let sectionData: unknown;
  if (operationsRequest) {
    // 방금 읽은 운영 섹션 위에 이 요청이 맡은 칸만 얹는다. 두 면은 그 면의 기준 token이 다르면(그사이 같은 면이 바뀜) 거절.
    const fresh = resolveSettings(existing?.data ?? null, { name: "" }).operations;
    const built = buildOperationsSave(operationsRequest, fresh, result?.data as OperationsSettings | undefined, {
      by: actor.displayName ?? undefined,
      at: new Date().toISOString(),
    });
    if ("error" in built) return { error: built.issue ? settingsValidationError(section, built.issue, built.checked) : built.error };
    // 이미 없는 과목의 삭제 — 쓰지 않고 지금 상태를 돌려준다(화면이 그 값으로 맞춘다).
    if ("unchanged" in built) {
      return { ok: true, nonce: Date.now(), operations: operationsReply(fresh, operationsRequest), version: settingsRevOf(base.operations) };
    }
    // 과목 행이 사라지는 저장(흡수·미사용 삭제의 마지막 단계 · 과목 면에서 줄을 뺀 저장)이면 그 과목의 신규생 관리 기록을 마지막으로 다시 본다 —
    // 옮기는 규칙이 없는 기록이라 과목이 사라지면 옛 키에 남는다(newcomers/server/subject-refs.ts). 못 세면 지우지 않는다.
    const removedSubjects = fresh.subjects.filter((s) => !built.parsed.subjects.some((n) => n.key === s.key));
    if (removedSubjects.length > 0) {
      const held = await subjectsWithNewcomerRecords(actor.tenantId, removedSubjects.map((s) => s.key));
      if (held === null) return { error: "과목 사용 현황을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
      if (held.length > 0) {
        const names = removedSubjects.filter((s) => held.includes(s.key)).map((s) => s.label || s.key).join(", ");
        return { error: `'${names}' 과목에 신규생 관리 기록(완료 체크·담당 배정·적응 피드백)이 있어 과목을 지울 수 없습니다.` };
      }
    }
    // 새 칸 둘(periodStyle·schoolSaveAliases)은 어느 요청도 맡지 않아 값이 늘 fresh에서 온다 — 침산은 지우고 일반판은 그대로 둔다.
    sectionData = prepareSectionForSave(preset, section, built.raw, built.parsed, base[section]);
  } else if (section === "dashboard") {
    // 대시보드 배치는 걸러서(모르는 카드·이탈 좌표) 저장하고, 기본 배치와 같은 역할은 저장값을 만들지 않는다(기본 개선이 따라오게).
    const submitted = result?.data as { assignments?: unknown };
    sectionData = dashboardPart
      ? normalizeDashboard(mergeDashboardSave(base.dashboard, submitted, dashboardPart.part, dashboardPart.touched), { dropDefaults: true })
      : normalizeDashboard({ ...submitted, assignments: submitted.assignments ?? normalizeDashboard(base.dashboard).assignments }, { dropDefaults: true });
  } else {
    sectionData = prepareSectionForSave(preset, section, parsedJson, result?.data, base[section]);
  }
  try {
    const boundaryError = await platformSettingsError(section, sectionData, base[section]);
    if (boundaryError) return { error: boundaryError };
  } catch {
    return { error: "운영 설정 보호 여부를 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
  }
  // 운영 · 역할·권한 섹션은 저장 순번(`rev`)을 **섹션 안에** 함께 쓴다 — 편집 폼이 "내 저장보다 먼저 읽힌 값"을 가려내는 순서다(settings-stamp.ts).
  // 🔴 문서 최상위에 새 키를 두지 않는다 — DB의 쓰기 가드(0335a `guard_tenant_settings_write`)는 개별 설정만 위임받은 사람에게
  //    "맡은 섹션 밖은 그대로일 것"을 요구한다. 최상위에 순번이 생기면 그 사람들의 저장이 전부 거절된다.
  //    감사 기록의 변경 내역(아래 `sectionData`)에는 순번을 싣지 않는다.
  const sectionRev = REV_SECTIONS.includes(section) ? settingsRevOf(base[section]) + 1 : undefined;
  const storedSection = sectionRev === undefined ? sectionData : { ...(sectionData as Record<string, unknown>), rev: sectionRev };
  const nextData: Record<string, unknown> = { ...base, version: 1, [section]: storedSection };
  // 일반판 표식은 base에 이미 있다(학원 추가가 만든 행) — 한 번 더 못박아 둔다. 침산 행엔 아무것도 더하지 않는다.
  if (preset === "generic") nextData.preset = "generic";

  const write = {
      tenant_id: actor.tenantId,
      data: nextData,
      updated_by: actor.id,
      // 직전 표식과 반드시 다른 값으로(settings-stamp.ts) — 저장 직전 "읽은 뒤 누가 먼저 썼나"의 판정에 쓴다.
      updated_at: nextSettingsStamp(existing?.updated_at),
  };
  // 조회 이후 다른 설정 섹션이 먼저 저장돼도 그 문서를 덮지 않는다. 초기 생성의 동시 충돌도 insert로 막는다.
  const resultWrite = existing
    ? await supabase.from("tenant_settings").update(write).eq("tenant_id", actor.tenantId).eq("updated_at", existing.updated_at).select("tenant_id")
    : await supabase.from("tenant_settings").insert(write).select("tenant_id");
  const { error } = resultWrite;
  // DB 원문(영문 · 표 이름)을 그대로 내보내지 않는다 — 쓰기 가드가 돌려준 한글 사유는 지점 화면 문구로 다듬어 보여 준다.
  if (error) {
    return { error: plainSettingsReason(explainDbError(error, { scope: "owner.saveOwnerSection", fallback: "설정을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요." }).message) };
  }
  if (!resultWrite.data?.length) {
    // 대시보드는 마지막 저장이 이긴다 — 읽고 쓰는 그 짧은 사이에 겹친 것뿐이니 새로고침(편집이 사라진다) 대신 다시 누르게 한다.
    if (dashboardPart) return { error: "다른 저장과 겹쳐 저장하지 못했습니다. 편집한 내용은 그대로이니 저장을 한 번 더 눌러 주세요." };
    return { error: "다른 창에서 설정이 먼저 저장되었습니다. 새로고침한 뒤 다시 저장해 주세요." };
  }

  // 🔴 **무엇이 바뀌었는지**를 함께 남긴다(원장 점검 2026-08-27) — 종전엔 `{section}`뿐이라
  //    "누가 언제 운영 체계를 저장했다"만 남고 되짚을 근거가 없었다. 비밀값·미등록 필드는 실리지 않는다.
  // 저장 순번은 설정이 아니라 장부다 — 변경 내역에는 싣지 않는다(안 빼면 저장할 때마다 "외 1건"이 붙는다).
  const diff = diffSettingsSection(section, withoutSettingsRev((base as Record<string, unknown>)[section]), sectionData);
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
  // 운영 · 역할·권한 섹션은 **실제로 저장한 값**(다듬기까지 거친 뒤 다시 풀어 읽은 값)의 기준 token을 돌려준다 — 화면의 다음 저장 기준.
  //   (보낸 값 그대로가 아니다 — 요청에 없던 칸은 저장돼 있던 값으로 남는 등 저장 전 다듬기가 값을 바꾼다.)
  const saved = sectionRev === undefined ? undefined : resolveSettings(nextData, { name: "" });
  const operations = saved && operationsRequest ? operationsReply(saved.operations, operationsRequest) : undefined;
  const permissions = saved && section === "permissions" ? { token: permissionsToken(saved.permissions) } : undefined;
  // nonce — in-window 저장이라 연속 저장마다 폼 effect가 동시편집 신호를 1회씩 발화하도록(B-2).
  return {
    ok: true,
    nonce: Date.now(),
    ...(operations ? { operations } : {}),
    ...(permissions ? { permissions } : {}),
    ...(sectionRev === undefined ? {} : { version: sectionRev }),
  };
}

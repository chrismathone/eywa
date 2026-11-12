import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { normalizeDashboard } from "@/features/dashboard/layout/normalize";
import { sameItems } from "@/features/dashboard/layout/engine";
import { permissionsSchema, SPECIAL_ACCESS_ID_LISTS, type PermissionsSettings } from "../settings-types";
import { effectivePayslipManagerIds } from "../payslip-permissions";
import { isRecord } from "@/lib/guards";

/** 지점 설정 대상에서 운영자 계정을 제외한다. 조회 실패는 빈 명단으로 취급하지 않는다. */
export async function platformAccountIds(ids: readonly string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const db = createAdminClient();
  const rows = await fetchInChunks<{ id: string }>([...new Set(ids)], (chunk) =>
    db.from("super_admins").select("id").in("id", chunk),
  );
  return new Set(rows.map((row) => row.id));
}


/**
 * 역할·권한 설정에 이름이 올라 있는 계정 전부(개인별 메뉴 권한 + 개인별 기능 권한의 네 칸).
 * ⚠️ 화면(owner/page.tsx)은 **스키마를 거치지 않은 저장값**으로 부른다 — 줄이 깨져 있어도(손으로 넣은 값 · 줄이 null)
 *    던지지 않고 읽을 수 있는 계정만 모은다(던지면 학원 설정 화면이 통째로 안 열린다).
 */
export function permissionAccountIds(value: PermissionsSettings): string[] {
  const source: Record<string, unknown> = isRecord(value) ? value : {};
  const special: Record<string, unknown> = isRecord(source.specialAccess) ? source.specialAccess : {};
  const rowIds = (rows: unknown) => (Array.isArray(rows) ? rows.flatMap((row) => (isRecord(row) && typeof row.userId === "string" ? [row.userId] : [])) : []);
  const ids = (list: unknown) => (Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : []);
  return [...rowIds(source.userOverrides), ...SPECIAL_ACCESS_ID_LISTS.flatMap((key) => ids(special[key])), ...rowIds(special.staffSubjectScopes)];
}

const DENIED = "이 계정의 운영 설정은 지점에서 변경할 수 없습니다. 운영자 관리 화면을 이용해 주세요.";
const equalRows = (a: unknown[], b: unknown[]) => JSON.stringify(a.map((v) => JSON.stringify(v)).sort()) === JSON.stringify(b.map((v) => JSON.stringify(v)).sort());

/** 숨겨진 기존 설정은 그대로 전달할 수 있지만 추가·수정·삭제는 운영자 콘솔의 책임이다. */
export async function platformSettingsError(section: string, next: unknown, previous: unknown): Promise<string | null> {
  if (section === "dashboard") {
    const after = normalizeDashboard(next, { dropDefaults: true });
    const before = normalizeDashboard(previous, { dropDefaults: true });
    if (!sameItems(after.layouts.find((row) => row.role === "super")?.items ?? [], before.layouts.find((row) => row.role === "super")?.items ?? [])) return DENIED;
    const ids = await platformAccountIds([...(after.assignments ?? []), ...(before.assignments ?? [])].map((row) => row.userId));
    return equalRows((after.assignments ?? []).filter((row) => ids.has(row.userId)), (before.assignments ?? []).filter((row) => ids.has(row.userId))) ? null : DENIED;
  }
  if (section === "permissions") {
    const after = permissionsSchema.parse(next ?? { overrides: [] });
    const before = permissionsSchema.parse(previous ?? { overrides: [] });
    const ids = await platformAccountIds([...permissionAccountIds(after), ...permissionAccountIds(before)]);
    if (!equalRows(after.userOverrides.filter((row) => ids.has(row.userId)), before.userOverrides.filter((row) => ids.has(row.userId)))) return DENIED;
    for (const key of SPECIAL_ACCESS_ID_LISTS) {
      const list = (value: PermissionsSettings) => key === "payslipManagerIds"
        ? effectivePayslipManagerIds(value.specialAccess) : value.specialAccess[key] ?? [];
      if (!equalRows(list(after).filter((id) => ids.has(id)), list(before).filter((id) => ids.has(id)))) return DENIED;
    }
    const scopesOf = (value: PermissionsSettings) => value.specialAccess.staffSubjectScopes.filter((row) => ids.has(row.userId));
    if (!equalRows(scopesOf(after), scopesOf(before))) return DENIED;
  }
  return null;
}

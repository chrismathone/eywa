import { applyUserOverrides, canAccess, mergeMostPermissive, resolveMatrix, type SystemRole } from "@/lib/permissions";
import { capDisabledModules } from "@/lib/modules";
import type { TenantSettings } from "@/features/owner/settings-types";
import { dashboardAssignmentOf } from "./assignment";
import type { Bundle } from "./types";
import { selectSubjectView } from "./subject-view";

export type DashboardMember = { id: string; name: string; role: SystemRole; bundle: Bundle; scopeLabel: string; subjectKeys: string[]; canOpen: boolean; inherited: boolean };
export type DashboardMembers = { people: DashboardMember[]; failed: boolean };
export type MemberRow = { id: string; display_name: string | null; system_role: string; subjects: string[] | null; status: string | null };

/** 실제 화면과 같은 역할·총괄·개인 예외·모듈 캡을 적용한다. 목록의 0명과 조회 실패를 구분한다. */
export function dashboardMembers(rows: MemberRow[], superIds: ReadonlySet<string>, settings: TenantSettings): DashboardMember[] {
  const base = resolveMatrix(settings.permissions.overrides);
  const defaults = resolveMatrix([]);
  const labels = new Map(settings.operations.subjects.map((s) => [s.key, s.label]));
  const assignments = new Map(settings.dashboard.assignments?.map((a) => [a.userId, a]));
  return rows.filter((row) => row.status === "active" && row.system_role !== "student").map((row) => {
    const role = row.system_role as SystemRole;
    const isSuperAdmin = superIds.has(row.id);
    const roleMatrix = isSuperAdmin ? mergeMostPermissive(defaults, base) : base;
    const applied = applyUserOverrides(roleMatrix, row.id, role, settings.permissions.userOverrides);
    const matrix = capDisabledModules(isSuperAdmin ? mergeMostPermissive(roleMatrix, applied) : applied, settings.modules.disabled);
    const view = dashboardAssignmentOf({ id: row.id, systemRole: role, isSuperAdmin, subjects: row.subjects ?? [] }, assignments.get(row.id));
    return { id: row.id, name: row.display_name || "이름 미등록", role, bundle: view.bundle, inherited: view.inherited,
      subjectKeys: selectSubjectView(Object.fromEntries(labels), view.subjects).choices.map((s) => s.key),
      canOpen: canAccess(role, "dashboard", matrix),
      scopeLabel: view.scope === "all" ? "전 과목" : view.scope === "unassigned" ? "미지정" : view.subjects.map((key) => labels.get(key) ?? "삭제된 과목").join(" · ") || "미지정",
    };
  }).sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

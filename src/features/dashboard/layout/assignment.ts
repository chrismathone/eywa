import type { SystemRole } from "@/lib/permissions";
import { dashboardBundleOf } from "./bundle";
import type { DashboardAssignment } from "./types";

export type AssignmentUser = { id: string; systemRole: SystemRole; isSuperAdmin: boolean; subjects: readonly string[] };

/** 저장 전 기존 직원은 종전 범위를 유지한다. 명시 지정 후에는 과목 공란으로 배치를 추측하지 않는다. */
export function dashboardAssignmentOf(user: AssignmentUser, saved?: DashboardAssignment) {
  const assignment: DashboardAssignment = saved ?? {
    userId: user.id,
    scope: user.systemRole === "admin" && user.subjects.length ? "subjects" : "all",
    subjects: [...user.subjects],
    adminLayout: user.subjects.length ? "subject" : "desk",
  };
  const privileged = user.isSuperAdmin || user.systemRole === "master";
  const scope = privileged ? "all" : assignment.scope;
  return {
    bundle: dashboardBundleOf({ ...user, assignment: saved }),
    scope,
    subjectScoped: scope !== "all",
    subjects: scope === "subjects" ? assignment.subjects : [],
    assignment,
    inherited: !saved,
  };
}

/** 오래된 jsonb나 잘못된 직접 입력은 허용 범위로 넓히지 않고 버린다. 저장 액션은 별도로 엄격 검증한다. */
export function normalizeAssignments(raw: unknown): DashboardAssignment[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.slice(0, 1000).flatMap((v): DashboardAssignment[] => {
    if (!v || typeof v !== "object" || typeof v.userId !== "string" || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(v.userId) || seen.has(v.userId)) return [];
    if (!["all", "subjects", "unassigned"].includes(v.scope) || !["subject", "desk"].includes(v.adminLayout) || !Array.isArray(v.subjects)) return [];
    seen.add(v.userId);
    const subjects = [...new Set<string>(v.subjects.filter((s: unknown): s is string => typeof s === "string" && !!s.trim()).map((s: string) => s.trim()))].slice(0, 100);
    return [{ userId: v.userId, scope: v.scope, adminLayout: v.adminLayout, subjects: v.scope === "subjects" ? subjects : [] }];
  });
}

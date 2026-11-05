import "server-only";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { viewAsTeacher } from "@/lib/auth/view-as";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/observability/report-error";
import type { CurrentUser } from "@/lib/auth/current-user";
import { dashboardAssignmentOf } from "./assignment";
import { getTenantSettings } from "@/features/owner/server/queries";
import type { Bundle } from "./types";

/**
 * 운영실을 여는 사람의 묶음 + 담당 과목. 판정은 `dashboardBundleOf` 한 곳(순수) — 여기는 그 재료만 모은다.
 * 총괄 여부·저장된 배정과(관리자만) 기존 `users.subjects`를 함께 읽는다.
 *    담당 과목을 못 읽으면 "과목 없음"(= 데스크, 학원 전체 화면)으로 **넓히지 않고**, 담당 과목이 비어 있는 과목 관리자의
 *    **코드 기본** 배치로 좁힌다(`degraded` — 과목으로 좁히는 칸은 비고 화면은 산다, 30초 갱신이 다시 읽는다).
 */
export async function loadViewerBundle(viewer: CurrentUser): Promise<{ bundle: Bundle; subjects: string[]; subjectScoped: boolean; degraded?: true }> {
  // 🔴 '다른 강사 뷰'면 **대상 직원**의 묶음·담당 과목이다 — 호출부가 로그인 계정(requireAccess)을 넘겨도 여기서 대상으로 바꾼다.
  //    메뉴 권한은 대상 값인데 배치만 로그인 계정(원장 묶음 · 원장 배정)이면 대상 직원 화면에 원장 카드가 선다(원장 2026-11-05 강사뷰 전수).
  //    총괄 여부(isCurrentUserSuperAdmin)도 강사뷰 중에는 대상 기준이다(super-admin.ts).
  const user = (await viewAsTeacher()) ?? viewer;
  const subjectsPromise =
    user.systemRole === "admin"
      ? createClient().then(async (db) => {
          const { data, error } = await db.from("users").select("subjects").eq("id", user.id).maybeSingle();
          if (error) throw new Error("담당 과목을 읽지 못했습니다");
          return ((data?.subjects as string[] | null) ?? []).filter((s) => typeof s === "string" && s.trim());
        })
      : Promise.resolve([] as string[]);
  const safeSubjects = subjectsPromise.catch((error: unknown): null => {
    reportError(error, { scope: "dashboard.viewer-subjects" });
    return null;
  });
  const [isSuperAdmin, subjects, settings] = await Promise.all([isCurrentUserSuperAdmin(), safeSubjects, getTenantSettings()]);
  // 🔴 저장된 과목 관리자 배치(원장이 과목 관리자에게만 켠 금액·번호 옵션 포함)를 쓰지 않는다 — 데스크 관리자일 수도 있다.
  //    `degraded`면 호출부가 코드의 기본 과목 관리자 배치(민감 칸 없음·옵션 가림)로 그린다(적대 재리뷰 2026-10-01).
  if (subjects === null) return isSuperAdmin ? { bundle: "super", subjects: [], subjectScoped: false } : { bundle: "subject", subjects: [], subjectScoped: true, degraded: true };
  const { bundle, subjects: assigned, subjectScoped } = dashboardAssignmentOf({ id: user.id, systemRole: user.systemRole, isSuperAdmin, subjects }, settings.dashboard.assignments?.find((a) => a.userId === user.id));
  return { bundle, subjects: assigned, subjectScoped };
}

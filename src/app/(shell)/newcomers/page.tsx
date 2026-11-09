import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { kstToday } from "@/lib/date-kst";
import { getNewcomers } from "@/features/newcomers/server/queries";
import { parseBoardFilters } from "@/features/newcomers/board-model";
import { sampleFollowupView } from "@/features/newcomers/sample-data";
import { FollowupWorkspace } from "@/features/newcomers/followup-workspace";
import { getMakeeduSyncState } from "@/features/integrations/server/makeedu-sync";

export const metadata = { title: "신규생 관리 — 에이와" };

/**
 * 신규생 관리 — 90일 정착 관리 시안(aywa-next 375d27df4)을 얹었다.
 * 학생별·담당자별 탭 = 예시 값(담당 배정·피드백 표가 이 DB에 없다) · '전체 완료 체크표' 탭 = 실제 기록(종전 NewcomerBoard 그대로).
 */
export default async function NewcomersPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAccess("newcomers");
  const [view, canWrite, params, students, enrollments] = await Promise.all([
    getNewcomers(), canWriteTenant(viewer.systemRole, "newcomers"), searchParams,
    getMakeeduSyncState("students"), getMakeeduSyncState("enrollments"),
  ]);
  const initialFilters = parseBoardFilters({ get: (key) => typeof params[key] === "string" ? params[key] : null });
  return <FollowupWorkspace data={sampleFollowupView(kstToday())} legacy={view} canWriteChecks={canWrite}
    initialFilters={initialFilters} syncInfo={{ students, enrollments }} />;
}

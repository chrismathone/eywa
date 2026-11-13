import { requireAccess } from "@/lib/auth/require-access";
import { redirectStatsFirst } from "@/lib/auth/stats-first";
import { parseBoardFilters } from "@/features/newcomers/board-model";
import { followupAccess, getFollowupSource, getFollowupView } from "@/features/newcomers/server/followup-query";
import { FollowupWorkspace } from "@/features/newcomers/followup-workspace";
import { getMakeeduSyncState } from "@/features/integrations/server/makeedu-sync";

export const metadata = { title: "신규생 관리 — 에이와" };
export default async function NewcomersPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAccess("newcomers");
  const params = await searchParams;
  // 원장·관리자가 메뉴로 열면 통계가 먼저(stats-first.ts) — 담당 범위로 보는 계정은 통계가 목록으로 돌려보내니 그대로 목록.
  if (!(await followupAccess()).scoped) await redirectStatsFirst(user.systemRole, params, "/newcomers");
  const student = typeof params.student === "string" ? params.student : undefined;
  // 독립 조회는 함께 돌린다(B4) — 메이크에듀 동기화 시각은 관리자 화면에만 싣는다.
  const [{ data, legacy }, syncStudents, syncEnrollments] = await Promise.all([
    getFollowupSource(student).then(getFollowupView), getMakeeduSyncState("students"), getMakeeduSyncState("enrollments"),
  ]);
  const [students, enrollments] = data.canManage ? [syncStudents, syncEnrollments] : [null, null];
  const initialFilters = parseBoardFilters({ get: (key) => typeof params[key] === "string" ? params[key] : null });
  return <FollowupWorkspace data={data} legacy={legacy} initialFilters={initialFilters} initialStudent={student} syncInfo={{students,enrollments}} />;
}

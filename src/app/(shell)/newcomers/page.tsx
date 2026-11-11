import { requireAccess } from "@/lib/auth/require-access";
import { parseBoardFilters } from "@/features/newcomers/board-model";
import { getFollowupSource, getFollowupView } from "@/features/newcomers/server/followup-query";
import { FollowupWorkspace } from "@/features/newcomers/followup-workspace";
import { getMakeeduSyncState } from "@/features/integrations/server/makeedu-sync";

export const metadata = { title: "신규생 관리 — 에이와" };
export default async function NewcomersPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAccess("newcomers");
  const params = await searchParams;
  const student = typeof params.student === "string" ? params.student : undefined;
  // 독립 조회는 함께 돌린다(B4) — 메이크에듀 동기화 시각은 관리자 화면에만 싣는다.
  const [{ data, legacy }, syncStudents, syncEnrollments] = await Promise.all([
    getFollowupSource(student).then(getFollowupView), getMakeeduSyncState("students"), getMakeeduSyncState("enrollments"),
  ]);
  const [students, enrollments] = data.canManage ? [syncStudents, syncEnrollments] : [null, null];
  const initialFilters = parseBoardFilters({ get: (key) => typeof params[key] === "string" ? params[key] : null });
  return <FollowupWorkspace data={data} legacy={legacy} initialFilters={initialFilters} initialStudent={student} syncInfo={{students,enrollments}} />;
}

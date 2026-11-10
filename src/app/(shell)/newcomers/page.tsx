import { requireAccess } from "@/lib/auth/require-access";
import { parseBoardFilters } from "@/features/newcomers/board-model";
import { getFollowupSource, getFollowupView } from "@/features/newcomers/server/followup-query";
import { FollowupWorkspace } from "@/features/newcomers/followup-workspace";
import { getMakeeduSyncState } from "@/features/integrations/server/makeedu-sync";

export const metadata = { title: "신규생 관리 — 에이와" };

/**
 * 신규생 관리 — 90일 정착 관리(aywa-next 375d27df4 이식 · 실제 기록 s2_0060·s2_0061) + '전체 완료 체크표'(종전 NewcomerBoard).
 * `?student=<id>` = 90일이 지난 학생도 보고 이력을 다시 연다. 담당만(scoped) 권한은 자기 담임 학생·과목만 내려온다(followup-query).
 */
export default async function NewcomersPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAccess("newcomers");
  const params = await searchParams;
  const student = typeof params.student === "string" ? params.student : undefined;
  // 독립 조회는 함께(B4). 메이크에듀 동기화 시각은 관리자 화면에만 싣는다(담당만 권한엔 수강 연결을 고칠 일이 없다).
  const [{ data, legacy }, students, enrollments] = await Promise.all([
    getFollowupSource(student).then(getFollowupView), getMakeeduSyncState("students"), getMakeeduSyncState("enrollments"),
  ]);
  const syncInfo = data.canManage ? { students, enrollments } : undefined;
  const initialFilters = parseBoardFilters({ get: (key) => typeof params[key] === "string" ? params[key] : null });
  return <FollowupWorkspace data={data} legacy={legacy} initialFilters={initialFilters} initialStudent={student} syncInfo={syncInfo} />;
}

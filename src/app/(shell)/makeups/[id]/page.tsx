import { EmbedLink as Link } from "@/components/embed-link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAccess } from "@/lib/auth/require-access";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { PageHeader } from "@/components/page-header";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { settingsToPeriodsConfig } from "@/features/timetable/lib/periods";
import { getMakeupCaseDetail } from "@/features/makeups/server/queries";
import { CaseDetailView } from "@/features/makeups/components/case-detail-view";
import { makeupListBack } from "@/features/makeups/components/list-navigation";
import { getShellView } from "@/lib/auth/view-mode";

export const metadata = { title: "보강관리 · 상세 — 에이와" };
export default async function MakeupCasePage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ back?: string; existing?: string }>;
}) {
  const actor = await requireAccess("makeups");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  // 쓰기 여부 = 저장 액션(executeMakeupCommand)과 같은 판정. DB가 돌려주는 permissions만으로는 원장 덮어쓰기·
  // '다른 강사 뷰'(열람 전용)를 놓쳐 양식이 보였다가 저장 때 거절됐다(원장 2026-11-05 읽기 권한 정리).
  // 화면의 '내가 실시한 수업인가'(session-ui · fulfillment-review)는 저장 액션과 같은 사람 — 강사뷰면 검증된 대상 강사다
  // (executeMakeupCommand가 getCurrentUser({ teacherView: true })). 실제 계정 id를 넘기면 대상 강사의 수업이 '남의 수업'이 됐다.
  const [result, settings, query, shellView, canWrite, owner] = await Promise.all([getMakeupCaseDetail(id), getTenantSettings(), searchParams, getShellView(),
    canWriteTenant(actor.systemRole, "makeups"), getCurrentUser({ teacherView: true })]);
  const back = makeupListBack(query.back);
  if (!result.data) return <div className="space-y-4 p-4"><p role="alert">{result.error}</p>
    <Link href={`/makeups/${id}?${new URLSearchParams(typeof query.back === "string" ? { back: query.back } : {})}`} className="text-primary underline">다시 조회</Link><Link href={back} className="text-primary ml-4 underline">목록</Link></div>;
  const detail = result.data, subjects = buildSubjectMaps(settings.operations.subjects), periods = settingsToPeriodsConfig(settings.operations);
  return <div className="space-y-4 pb-6">
    <PageHeader title={`${detail.case.student_name} · 보강`} description={subjects.labelOf(detail.case.subject_key)}
      actions={<Link href={back} className="text-primary inline-block min-h-6 underline">목록</Link>} />
    {query.existing === "1" ? <p role="status" className="border-line rounded-md border p-3">이미 접수된 건입니다. 현재 처리 상태를 확인해 주세요.</p> : null}
    <CaseDetailView initial={detail} periods={periods} actorId={(owner ?? actor).id} reserveOn={settings.makeups.mode === "on"} canWrite={canWrite} recordView={shellView === "teacher" ? "teacher" : "attendance"} />
  </div>;
}

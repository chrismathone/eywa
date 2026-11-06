import { PageHeader } from "@/components/page-header";
import { WindowLink } from "@/components/workspace/window-link";
import { getOpenCare } from "@/features/student-care/server/queries";
import { CareAccessError } from "@/features/student-care/server/errors";
import { careHref, careStatus } from "@/features/student-care/model";
import { CareBlocked } from "@/features/student-care/components/care-blocked";

export const metadata = { title: "미완료 상담 약속 — 에이와" };

/** 미완료 상담 약속(목표일 순) — 신규생 기간이 지나도 완료·취소 전까지 남는다. 강사는 자기에게 배정된 약속만. */
export default async function OpenCarePage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  const page = /^\d{1,4}$/.test(sp.page ?? "") ? Number(sp.page) : 0;
  const header = <PageHeader eyebrow="원생" title="미완료 상담 약속" description="목표일 순 · 신규생 기간이 지나도 완료·취소 전까지 계속 관리합니다." embedLabel="미완료 상담 약속" />;
  let view: Awaited<ReturnType<typeof getOpenCare>>;
  try {
    view = await getOpenCare(page);
  } catch (error) {
    if (!(error instanceof CareAccessError)) throw error;
    return <div className="flex flex-col gap-4">{header}<CareBlocked reason={error.reason} message={error.message} /></div>;
  }
  return (
    <div className="flex flex-col gap-4">
      {header}
      {view.error ? <p className="border-line rounded-2xl border p-4 text-sm" role="alert">{view.error}</p> : (
        <>
          {view.records.length === 0 ? <p className="text-text-dim text-sm">표시할 미완료 약속이 없습니다.</p> : view.records.map((record) => {
            const student = view.students.find((s) => s.id === record.studentId);
            const intake = view.intakes.find((r) => r.id === record.intakeId);
            const status = careStatus(record.document, view.today, student?.enrolled_at ? String(student.enrolled_at).slice(0, 10) : null);
            return (
              <article key={record.id} className="bg-card border-line shadow-card flex flex-col gap-1.5 rounded-2xl border p-4">
                <WindowLink href={record.studentId ? careHref(record.studentId) : `/enrollment/${record.intakeId}/care`} className="text-primary font-bold hover:underline">
                  {student?.name ?? intake?.prospect_name ?? "상담 학생"}{!record.studentId ? " · 등록 전" : ""} · {record.document.content.promise}
                </WindowLink>
                <p className="text-sm">
                  목표일 <span className="num">{record.document.content.dueOn}</span> · {status.handoffPending ? "인수 대기" : "인수 확인"}
                  {status.overdue ? " · 기한 경과" : ""}{status.continuing ? " · 90일 이후 계속 관리" : ""}
                </p>
              </article>
            );
          })}
          <nav className="flex gap-4 text-sm font-semibold" aria-label="미완료 약속 페이지">
            {page > 0 ? <WindowLink href={`/students/care?page=${page - 1}`} className="text-primary hover:underline">이전 100건</WindowLink> : null}
            {view.more ? <WindowLink href={`/students/care?page=${page + 1}`} className="text-primary hover:underline">다음 100건</WindowLink> : null}
          </nav>
        </>
      )}
    </div>
  );
}

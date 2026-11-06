import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { getStudentCare, type StudentCareView } from "@/features/student-care/server/queries";
import { CareAccessError } from "@/features/student-care/server/errors";
import { CareWorkspace } from "@/features/student-care/components/care-workspace";
import { CareBlocked } from "@/features/student-care/components/care-blocked";

export const metadata = { title: "상담 약속·인계 — 에이와" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 원생의 상담 약속·인계(만들기·고치기·인수 확인·이행 증거·완료·취소). 권한·담당 범위는 `careAccess`(강사는 자기에게 배정된 약속만). */
export default async function StudentCarePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!UUID_RE.test(id)) notFound();
  const page = /^\d{1,4}$/.test(sp.page ?? "") ? Number(sp.page) : 0;
  let view: StudentCareView;
  try {
    view = await getStudentCare(id, page);
  } catch (error) {
    if (!(error instanceof CareAccessError)) throw error;
    return (
      <div className="flex flex-col gap-4">
        <PageHeader eyebrow="원생" title="상담 약속·인계" embedLabel="상담 약속·인계" />
        <CareBlocked reason={error.reason} message={error.message} />
      </div>
    );
  }
  const name = view.student?.name ?? "";
  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="원생" title="상담 약속·인계" description={name} embedLabel={name ? `${name} · 상담 약속·인계` : "상담 약속·인계"} />
      <CareWorkspace view={view} />
    </div>
  );
}

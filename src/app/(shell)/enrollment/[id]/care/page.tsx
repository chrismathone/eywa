import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { getIntakeCare } from "@/features/student-care/server/intake-queries";
import type { StudentCareView } from "@/features/student-care/server/queries";
import { CareAccessError } from "@/features/student-care/server/errors";
import { CareWorkspace } from "@/features/student-care/components/care-workspace";
import { CareBlocked } from "@/features/student-care/components/care-blocked";

export const metadata = { title: "등록 전 상담 약속·인계 — 에이와" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 등록 전(신규 콜&상담) 약속·인계 — 학생으로 연결되면 같은 약속이 학생 쪽으로 이어진다(s2_0029 트리거). */
export default async function IntakeCarePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!UUID_RE.test(id)) notFound();
  const page = /^\d{1,4}$/.test(sp.page ?? "") ? Number(sp.page) : 0;
  let view: StudentCareView;
  try {
    view = await getIntakeCare(id, page);
  } catch (error) {
    if (!(error instanceof CareAccessError)) throw error;
    return (
      <div className="flex flex-col gap-4">
        <PageHeader eyebrow="상담" title="등록 전 상담 약속·인계" embedLabel="등록 전 상담 약속·인계" />
        <CareBlocked reason={error.reason} message={error.message} />
      </div>
    );
  }
  const name = view.student?.name ?? view.intake?.name ?? "";
  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="상담" title="상담 약속·인계" description={name} embedLabel={name ? `${name} · 상담 약속·인계` : "상담 약속·인계"} />
      <CareWorkspace view={view} />
    </div>
  );
}

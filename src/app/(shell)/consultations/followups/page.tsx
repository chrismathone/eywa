import { requireAccess } from "@/lib/auth/require-access";
import { PageHeader } from "@/components/page-header";
import { ManagementQueue } from "@/features/management-agent/components/management-queue";
import { BackLink } from "@/components/back-link";

export const metadata = { title: "후속조치 관리 — 에이와" };
export default async function FollowupsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireAccess("consultations");
  const raw = Number((await searchParams).page ?? 1);
  const page = Number.isInteger(raw) && raw >= 1 && raw <= 10000 ? raw : 1;
  return <div className="space-y-4">
    <PageHeader title="후속조치 관리" description="기존 상담의 접수·처리·결과 확인" />
    <BackLink href="/consultations" label="원생상담으로" />
    <ManagementQueue page={page} />
  </div>;
}

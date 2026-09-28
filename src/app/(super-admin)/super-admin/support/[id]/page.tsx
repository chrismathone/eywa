import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { SupportRequestDetailView } from "@/components/support/request-detail";
import { SupportNotReady } from "@/components/support/list-states";
import { getAnySupportRequest } from "@/features/support/server/admin-queries";
import { SupportAnswerForm } from "../_answer-form";

export const metadata = { title: "슈퍼관리자 · 개선요청 — 에이와" };

export default async function SupportAdminRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await getAnySupportRequest(id);
  const back = (
    <Link href="/super-admin/support" className="text-primary text-sm">
      목록으로
    </Link>
  );
  if (!loaded.ready) {
    return (
      <>
        <PageHeader eyebrow="슈퍼관리자 · 고객센터" title="개선요청" />
        <SupportNotReady error={loaded.error} />
        {back}
      </>
    );
  }
  if (!loaded.item) notFound();
  const item = loaded.item;
  return (
    <>
      <PageHeader eyebrow="슈퍼관리자 · 고객센터" title={item.title} description={item.tenantName} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <SupportRequestDetailView item={item} showTenant />
        <SupportAnswerForm
          requestId={item.id}
          initial={{ status: item.status, dueDate: item.dueDate ?? "", answer: item.answer ?? "" }}
        />
      </div>
      {back}
    </>
  );
}

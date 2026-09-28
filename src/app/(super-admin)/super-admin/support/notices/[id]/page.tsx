import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { SupportNotReady } from "@/components/support/list-states";
import { fmtSupportDate } from "@/features/support/format";
import { getAnySupportNotice } from "@/features/support/server/admin-queries";
import { SupportNoticeForm } from "../../_notice-form";

export const metadata = { title: "슈퍼관리자 · 공지 수정 — aywa" };

export default async function EditSupportNoticePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await getAnySupportNotice(id);
  const back = (
    <Link href="/super-admin/support/notices" className="text-primary text-sm">
      목록으로
    </Link>
  );
  if (!loaded.ready) {
    return (
      <>
        <PageHeader eyebrow="슈퍼관리자 · 고객센터" title="공지 수정" />
        <SupportNotReady error={loaded.error} />
        {back}
      </>
    );
  }
  if (!loaded.item) notFound();
  const n = loaded.item;
  return (
    <>
      <PageHeader eyebrow="슈퍼관리자 · 고객센터" title="공지 수정" description={`등록일 ${fmtSupportDate(n.createdAt)}`} />
      <SupportNoticeForm noticeId={n.id} initial={{ title: n.title, body: n.body, pinned: n.pinned }} />
      {back}
    </>
  );
}

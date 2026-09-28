import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { SupportNoticeForm } from "../../_notice-form";

export const metadata = { title: "슈퍼관리자 · 새 공지 — 에이와" };

export default function NewSupportNoticePage() {
  return (
    <>
      <PageHeader eyebrow="슈퍼관리자 · 고객센터" title="새 공지" description="등록하면 모든 지점의 고객센터 공지사항에 바로 뜹니다." />
      <SupportNoticeForm noticeId={null} initial={{ title: "", body: "", pinned: false }} />
      <Link href="/super-admin/support/notices" className="text-primary text-sm">
        목록으로
      </Link>
    </>
  );
}

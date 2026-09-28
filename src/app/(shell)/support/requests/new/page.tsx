import { PageHeader } from "@/components/page-header";
import { WindowLink } from "@/components/workspace/window-link";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteSupportRequest } from "@/features/support/access";
import { SupportRequestForm } from "../../_components/request-form";

export const metadata = { title: "고객센터 · 개선요청 글쓰기 — aywa" };

export default async function NewSupportRequestPage() {
  const user = await requireAccess("support");
  const canWrite = await canWriteSupportRequest(user.systemRole);
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="고객센터" title="개선요청 글쓰기" description="aywa 운영팀이 읽고 처리상태와 답변을 달아 드립니다." />
      {canWrite ? (
        <SupportRequestForm initial={{ title: "", body: "", contactPhone: "", contactEmail: user.email }} />
      ) : (
        <p className="bg-card shadow-card rounded-2xl p-5 text-sm">개선요청을 작성할 권한이 없습니다.</p>
      )}
      <WindowLink href="/support?tab=requests" className="text-primary text-sm">
        목록으로
      </WindowLink>
    </div>
  );
}

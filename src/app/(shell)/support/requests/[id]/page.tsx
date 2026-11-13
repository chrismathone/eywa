import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { SupportRequestDetailView } from "@/components/support/request-detail";
import { WindowLink } from "@/components/workspace/window-link";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteSupportRequest } from "@/features/support/access";
import { getSupportRequest } from "@/features/support/server/queries";
import { canAuthorEditRequest } from "@/features/support/types";
import { SupportNotReady } from "@/components/support/list-states";
import { SupportRequestOwnerActions } from "../../_components/owner-actions";
import { phoneLabel } from "@/lib/format/phone";

export const metadata = { title: "고객센터 · 개선요청 — 에이와" };

export default async function SupportRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, user] = await Promise.all([params, requireAccess("support")]);
  const [loaded, canWrite] = await Promise.all([getSupportRequest(id), canWriteSupportRequest(user.systemRole)]);
  const back = (
    <WindowLink href="/support?tab=requests" className="text-primary text-sm">
      목록으로
    </WindowLink>
  );
  if (!loaded.ready) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="고객센터" title="개선요청" />
        <SupportNotReady error={loaded.error} />
        {back}
      </div>
    );
  }
  if (!loaded.item) notFound();
  const item = loaded.item;
  const editable = canWrite && item.authorId === user.id && canAuthorEditRequest(item.status, item.authorLocked);

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="고객센터 · 개선요청" title={item.title} />
      {editable ? (
        <SupportRequestOwnerActions
          requestId={item.id}
          initial={{
            title: item.title,
            body: item.body,
            contactPhone: phoneLabel(item.contactPhone) ?? "",
            contactEmail: item.contactEmail ?? "",
          }}
        />
      ) : null}
      <SupportRequestDetailView item={item} />
      {back}
    </div>
  );
}

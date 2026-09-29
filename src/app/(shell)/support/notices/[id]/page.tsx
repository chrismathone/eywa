import { notFound } from "next/navigation";
import { MenuMentionText } from "@/components/menu-mention-text";
import { Pill } from "@/components/atoms/pill";
import { PageHeader } from "@/components/page-header";
import { WindowLink } from "@/components/workspace/window-link";
import { requireAccess } from "@/lib/auth/require-access";
import { toneColor } from "@/lib/design/semantic-color";
import { fmtSupportDate } from "@/features/support/format";
import { getSupportNotice } from "@/features/support/server/queries";
import { SupportNotReady } from "@/components/support/list-states";

export const metadata = { title: "고객센터 · 공지사항 — 에이와" };

export default async function SupportNoticePage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }] = await Promise.all([params, requireAccess("support")]);
  const loaded = await getSupportNotice(id);
  const back = (
    <WindowLink href="/support" className="text-primary text-sm">
      목록으로
    </WindowLink>
  );
  if (!loaded.ready) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="고객센터" title="공지사항" />
        <SupportNotReady error={loaded.error} />
        {back}
      </div>
    );
  }
  if (!loaded.item) notFound();
  const n = loaded.item;
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="고객센터 · 공지사항" title={n.title} description={`등록일 ${fmtSupportDate(n.createdAt)}`} />
      <article className="bg-card shadow-card rounded-2xl p-5">
        {n.pinned ? (
          <div className="mb-3">
            <Pill color={toneColor("critical")}>공지</Pill>
          </div>
        ) : null}
        <p className="text-foreground text-sm leading-relaxed break-keep whitespace-pre-wrap"><MenuMentionText text={n.body} /></p>
      </article>
      {back}
    </div>
  );
}

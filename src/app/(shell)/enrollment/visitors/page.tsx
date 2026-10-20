import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { visitorAccess } from "@/features/visitor-history/server/access";
import { visitorSources } from "@/features/visitor-history/server/sources";
import { kstToday } from "@/lib/date-kst";
import { PageHeader } from "@/components/page-header";
import { EmbedLink } from "@/components/embed-link";
import { Button } from "@/components/ui/button";
import { VisitorView } from "./visitor-view";

export const metadata = { title: "방문 기록 — 에이와" };
export default async function VisitorHistoryPage() {
  await requireAccess("enrollment");
  const user = await visitorAccess();
  if (!user) notFound();
  const sources = visitorSources(user.tenantId).map(s => s.tagName);
  return <div className="space-y-4">
    <PageHeader eyebrow="신규 콜&상담" title="방문 기록"
      actions={<Button variant="ghost" render={<EmbedLink href="/enrollment" />}>콜&상담으로</Button>} />
    <VisitorView today={kstToday()} sources={sources} />
  </div>;
}

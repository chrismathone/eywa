import { visitorAccess } from "@/features/visitor-history/server/access";
import { EmbedLink } from "@/components/embed-link";
import { Button } from "@/components/ui/button";

export async function VisitorHistoryLink() {
  if (!await visitorAccess()) return null;
  return <Button variant="ghost" render={<EmbedLink href="/enrollment/visitors" />}>방문 기록</Button>;
}

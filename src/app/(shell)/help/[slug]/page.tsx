import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { getShellView } from "@/lib/auth/view-mode";
import { helpManualForTenant, helpManualOpens } from "@/features/help/access";
import { MANUALS, manualBySlug } from "@/features/help/manuals";
import { HelpAllowProvider } from "../_components/help-text";
import { ManualArticle } from "../_components/manual-article";

// 🔴 `generateStaticParams`를 두지 않는다(2026-09-14 리뷰) — 이 페이지는 아래에서 `requireAccess("help")`로
// 쿠키를 읽으므로 **정적 페이지가 될 수 없다**. 34개 슬러그를 프리렌더하겠다고 선언해도 동적 폴백으로
// 떨어질 뿐 얻는 것이 없고, 리포에서 유일한 사용처라 "여긴 정적"이라는 거짓 신호만 남았다.

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const manual = manualBySlug(slug);
  return { title: manual ? `${manual.title} 설명서 — 에이와` : "도움말 — 에이와" };
}

export default async function HelpManualPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const manual = manualBySlug(slug);
  if (!manual) notFound();

  const [user, view] = await Promise.all([requireAccess("help"), getShellView()]);
  const open = await helpManualOpens(manual, user.systemRole, view);
  if (!open) notFound();

  const allOpen = await Promise.all(MANUALS.map((m) => helpManualOpens(m, user.systemRole, view)));
  const visible = await Promise.all(MANUALS.filter((_, i) => allOpen[i]).map((item) => helpManualForTenant(item, user.tenantId)));
  const visibleManual = await helpManualForTenant(manual, user.tenantId);
  const related = visibleManual.related
    .map((s) => visible.find((m) => m.slug === s))
    .filter((m) => m !== undefined);
  const slugs = visible.map((m) => m.slug);

  return (
    <HelpAllowProvider slugs={slugs}>
      <ManualArticle manual={visibleManual} related={related} />
    </HelpAllowProvider>
  );
}

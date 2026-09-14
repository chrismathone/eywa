import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { getShellView } from "@/lib/auth/view-mode";
import { helpLinkOpens } from "@/features/help/access";
import { MANUALS, manualBySlug } from "@/features/help/manuals";
import { HelpAllowProvider } from "../_components/help-text";
import { ManualArticle } from "../_components/manual-article";

export async function generateStaticParams() {
  return MANUALS.map((m) => ({ slug: m.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const manual = manualBySlug(slug);
  return { title: manual ? `${manual.title} 설명서 — eywa` : "도움말 — eywa" };
}

export default async function HelpManualPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const manual = manualBySlug(slug);
  if (!manual) notFound();

  const [user, view] = await Promise.all([requireAccess("help"), getShellView()]);
  const open = await helpLinkOpens(manual.menuKey, user.systemRole, view);
  if (!open) notFound();

  const allOpen = await Promise.all(MANUALS.map((m) => helpLinkOpens(m.menuKey, user.systemRole, view)));
  const visible = MANUALS.filter((_, i) => allOpen[i]);
  const related = manual.related
    .map((s) => visible.find((m) => m.slug === s))
    .filter((m) => m !== undefined);
  const slugs = visible.map((m) => m.slug);

  return (
    <HelpAllowProvider slugs={slugs}>
      <ManualArticle manual={manual} related={related} />
    </HelpAllowProvider>
  );
}

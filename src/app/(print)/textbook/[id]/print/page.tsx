import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getTextbookOrderById } from "@/features/billing/server/textbook-queries";
import { TextbookRequestCard } from "./textbook-request-card";

export const metadata = { title: "교재 요청서 — eywa" };

// 교재요청서(ijw TextbookPreviewCard 이식) — 학부모 전달용 카드. 학원 입금 계좌는
// 학원설정(billing.account)에서 읽어 자동 표시(소비처). PNG 저장/인쇄는 클라 카드가 담당.
export default async function TextbookPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccess("billing");
  const { id } = await params;
  const [order, settings] = await Promise.all([
    getTextbookOrderById(id),
    getTenantSettings(),
  ]);
  if (!order) notFound();

  return (
    <TextbookRequestCard
      order={order}
      academyName={settings.profile.name || "인재원"}
      logoUrl={settings.profile.logoUrl || null}
      account={settings.billing.account}
    />
  );
}

import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { requireAccess } from "@/lib/auth/require-access";
import { resolveBrandingSrc } from "@/lib/storage/media-storage";
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
  const user = await requireAccess("billing");
  const { id } = await params;
  const embedded = (await headers()).get("x-embed") === "1";
  const [order, settings] = await Promise.all([
    getTextbookOrderById(id),
    getTenantSettings(),
  ]);
  if (!order) notFound();
  // 로고 — GCS 비공개 path면 signed URL로 resolve(외부 URL은 그대로).
  const logoUrl = await resolveBrandingSrc(settings.profile.logoUrl, user.tenantId);

  return (
    <TextbookRequestCard
      order={order}
      academyName={settings.profile.name || "인재원"}
      logoUrl={logoUrl}
      account={settings.billing.account}
      embedded={embedded}
    />
  );
}

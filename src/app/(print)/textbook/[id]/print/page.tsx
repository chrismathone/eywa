import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { requireAccess } from "@/lib/auth/require-access";
import { getTeacherScope } from "@/lib/auth/teacher-scope";
import { resolveBrandingSrc } from "@/lib/storage/media-storage";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getTextbookOrderById } from "@/features/billing/server/textbook-queries";
import { TextbookRequestCard } from "./textbook-request-card";

export const metadata = { title: "교재 요청서 — eywa" };

// 교재요청서(ijw TextbookPreviewCard 이식) — 학부모 전달용 카드. 학원 입금 계좌는
// 학원설정(billing.account)에서 읽어 자동 표시(소비처). PNG 저장/인쇄는 클라 카드가 담당.
// 게이트=textbook_requests(사무실 역할 전원 full + 강사 full) — 강사는 본인 담당 학생 요청서만(스코프).
export default async function TextbookPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ download?: string }>;
}) {
  const user = await requireAccess("textbook_requests");
  const { id } = await params;
  const { download } = await searchParams;
  const embedded = (await headers()).get("x-embed") === "1";
  const [order, settings] = await Promise.all([
    getTextbookOrderById(id),
    getTenantSettings(),
  ]);
  if (!order) notFound();
  // 강사는 본인 담당 학생 요청서만 열람(intra-tenant PII 스코프). 사무실 역할(billing full)은 전체 허용.
  if (user.systemRole === "teacher") {
    const { studentIds } = await getTeacherScope(user.id);
    if (!order.studentId || !studentIds.includes(order.studentId)) notFound();
  }
  // 로고 — GCS 비공개 path면 signed URL로 resolve(외부 URL은 그대로).
  const logoUrl = await resolveBrandingSrc(settings.profile.logoUrl, user.tenantId);

  return (
    <TextbookRequestCard
      order={order}
      academyName={settings.profile.name || "인재원"}
      logoUrl={logoUrl}
      account={settings.billing.account}
      embedded={embedded}
      autoDownload={download === "1"}
    />
  );
}

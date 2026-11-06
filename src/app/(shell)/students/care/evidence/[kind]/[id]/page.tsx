import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { resolveSheetEvidence } from "@/features/student-care/server/sheet-evidence";

/**
 * 강사 시트 증거 원본 — 메뉴·담당 반·수강 기간을 다시 확인한 뒤 그 달 시트로 보낸다(확인 못 하면 없는 주소).
 * 창(?embed=1) 안에서 열렸으면 보낼 주소에도 embed를 싣는다(#133 — 빠지면 창 안에 전체 셸이 뜬다).
 */
export default async function SheetEvidencePage({ params, searchParams }: { params: Promise<{ kind: string; id: string }>; searchParams: Promise<{ embed?: string }> }) {
  const [{ kind, id }, { embed }] = await Promise.all([params, searchParams]);
  if (kind !== "english_sheet" && kind !== "math_sheet") notFound();
  const user = await getCurrentUser();
  if (!user) notFound();
  const source = await resolveSheetEvidence(user, kind, id).catch(() => null);
  if (!source) notFound();
  redirect(embed === "1" ? `${source.href}&embed=1` : source.href);
}

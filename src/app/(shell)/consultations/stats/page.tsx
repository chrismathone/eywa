import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";

/**
 * 옛 '상담 통계' 화면 — 원생상담 목록 오른쪽 **통계 패널**로 흡수됐다(원장 2026-09-30 *"우측에 상담 통계 고도화"* · 중복 화면 금지).
 * 저장된 창·즐겨찾기가 이 주소를 열 수 있어 목록으로 돌려보낸다. 🔴 쿼리(`embed=1` 포함)를 그대로 넘긴다 — 빠지면 창 안에 전체 셸이 뜬다([[#133]]).
 */
export default async function ConsultationStatsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAccess("consultations");
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") params.set(k, v);
    else if (Array.isArray(v)) for (const x of v) params.append(k, x);
  }
  const qs = params.toString();
  redirect(qs ? `/consultations?${qs}` : "/consultations");
}

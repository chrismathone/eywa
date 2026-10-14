import { notFound, redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { reportViewer } from "@/features/withdrawal-reports/server/queries";

/**
 * 기존 스프레드시트 보고서 목록은 퇴원보고서 목록에 합쳤다(원장 2026-10-14 *"따로 볼 필요 없고 미연결 리스트만 따로"*).
 * 옛 주소는 그 목록의 '스프레드시트 기록'으로 보낸다 — 창 안이면 embed를 지킨다([[#133]]). 볼 수 없는 사람(기능 꺼짐·
 * 작성 요청 권한 없음)은 종전대로 바로 없는 주소 — 이동부터 하면 꺼진 기능의 주소가 한 번 응답한다.
 */
export default async function ArchivesPage({ searchParams }: { searchParams: Promise<{ embed?: string }> }) {
  await requireAccess("withdrawal_reports");
  if (!(await reportViewer())?.request) notFound();
  const { embed } = await searchParams;
  redirect(embed === "1" ? "/withdrawal-reports?status=archive&embed=1" : "/withdrawal-reports?status=archive");
}

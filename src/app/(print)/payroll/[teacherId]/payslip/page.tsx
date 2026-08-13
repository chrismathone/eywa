import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { landingPath } from "@/lib/auth/teacher-home";
import { getPayslipData } from "@/features/payroll/server/payslip-queries";
import { kstMonth } from "@/lib/date-kst";
import { PrintActions } from "@/app/(print)/enrollment/[id]/print/print-actions";
import { PayslipDocument } from "./payslip-document";
import { AdjustmentsEditor } from "./adjustments-editor";

export const metadata = { title: "급여명세서 — eywa" };

/**
 * 급여명세서(프리랜서 강의용역수수료 명세서) A4 — **원장 전용**.
 *
 * 원장이 구글시트로 손수 만들던 명세서를 그대로 옮긴 것이다(문서 1Uh7mbje…, 서식·수식 대조).
 * 금액 근거는 0199a 티어 정산 — 출석부 하단 '정산액'과 **같은 조립 코드**(collectTierRows)를 쓴다.
 *
 * 🔴 게이트는 requireAccess가 아니라 **master 직접 비교**다 — billing 메뉴 접근은 admin·accountant도
 *    통과하는데(권한 매트릭스 실측) 명세서엔 주민번호·계좌·급여가 전부 실린다.
 *    getPayslipData가 서버에서 한 번 더 막지만, 화면 단계에서 먼저 되돌려 에러 페이지 대신 홈으로 보낸다.
 */
export default async function PayslipPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ teacherId: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // ⚠️ 착지는 `landingPath` 단일 소스로 — roleHome은 과목 축이 없어 영어 전담 강사를 빈 원스크린에 떨어뜨린다
  //    (teacher-home-wiring.test.ts가 착지 지점 목록을 잠근다 — 새 지점은 거기에도 추가).
  if (user.systemRole !== "master") redirect(await landingPath(user.systemRole));

  const { teacherId } = await params;
  const sp = await searchParams;
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.period ?? "") ? sp.period! : kstMonth();
  const embedded = (await headers()).get("x-embed") === "1";

  const data = await getPayslipData(teacherId, period);

  return (
    <div className="print-portrait payslip-doc mx-auto max-w-[210mm] bg-white px-12 py-10 text-black print:p-0">
      <PrintActions embedded={embedded} />
      <AdjustmentsEditor
        teacherId={teacherId}
        period={period}
        adjustments={data.adjustments}
        canIssue={data.settlement !== null && data.amounts.netPay >= 0}
      />
      <PayslipDocument data={data} />
    </div>
  );
}

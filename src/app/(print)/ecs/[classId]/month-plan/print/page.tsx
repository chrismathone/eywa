import type { Metadata } from "next";
import { headers } from "next/headers";
import { PrintActions } from "@/app/(print)/enrollment/[id]/print/print-actions";
import { getMonthPlanPrint } from "@/features/class-sheets/server/month-plan-print";
import { MonthPlanPaper } from "./month-plan-paper";

export const metadata: Metadata = { title: "월간 계획서 인쇄 — eywa" };

/**
 * EiE **월간 계획서(MP)** 인쇄 — 학부모 배포용 A4 한 장(가로).
 *
 * 🔴 **대조·경고·작성률은 이 문서에 없다**(원장 2026-09-01 브리프) — 학부모가 받는 종이에
 *    "미작성 3일" 같은 내부 신호가 실리면 안 된다. 이 라우트는 계획 칸과 날짜만 그린다.
 * 🔴 게이트는 화면과 같은 함수 + **EiE 재확인**(`getMonthPlanPrint`) — 인쇄는 별도 주소라
 *    화면에서 탭을 감춘 것만으로는 안 막힌다(#77).
 * ⚠️ 가로 A4다 — 요일 3개 × 최대 4열이면 세로 190mm에 한 칸이 16mm도 안 돼 진도가 잘린다
 *    (자리 월간 출석부 별지와 같은 판단).
 */
export default async function EcsMonthPlanPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { classId } = await params;
  const { month } = await searchParams;
  const res = await getMonthPlanPrint(classId, month ?? null);
  const embedded = (await headers()).get("x-embed") === "1";

  if (!res.ok) {
    return (
      <div className="mx-auto max-w-[277mm] px-8 py-10">
        <div className="print:hidden">
          <PrintActions embedded={embedded} />
        </div>
        <p className="text-[13px] text-black">{res.error}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[277mm] px-8 pt-6 pb-10">
      <div className="print:hidden">
        <PrintActions embedded={embedded} />
      </div>
      <MonthPlanPaper data={res.data} />
    </div>
  );
}

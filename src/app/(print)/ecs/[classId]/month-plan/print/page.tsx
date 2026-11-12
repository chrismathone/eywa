import type { Metadata } from "next";
import { headers } from "next/headers";
import { PrintActions } from "@/app/(print)/enrollment/[id]/print/print-actions";
import { getMonthPlanPrint } from "@/features/class-sheets/server/month-plan-print";
import { MonthPlanPaper } from "./month-plan-paper";
import { MpFitToPage } from "./fit-to-page";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "월간 계획서 인쇄 — 에이와" };

/**
 * EiE **월간 계획서(MP)** 인쇄 — 학부모 배포용 **A4 한 장**(원장 2026-09-21 *"한페이지에 딱 들어오게"*).
 *
 * 🔴 **대조·경고·작성률은 이 문서에 없다**(원장 2026-09-01 브리프) — 학부모가 받는 종이에
 *    "미작성 3일" 같은 내부 신호가 실리면 안 된다. 이 라우트는 계획 칸과 날짜만 그린다.
 * 🔴 게이트는 화면과 같은 함수 + **EiE 재확인**(`getMonthPlanPrint`) — 인쇄는 별도 주소라
 *    화면에서 탭을 감춘 것만으로는 안 막힌다(#77).
 * 🔑 한 장에 맞추는 규칙은 [`MpFitToPage`](./fit-to-page.tsx) — **A4 세로 고정**(원장 2026-09-21 *"세로 사이즈에
 *    맞도록"*), 문서를 같은 비율로 줄여 폭을 맞추고 남는 세로 높이는 계획 칸이 나눠 가진다.
 * 🔑 기간 축(`period`)은 화면이 보던 축을 주소로 실어 온다 — 세션으로 보던 계획서는 세션 창으로 찍힌다.
 */
export default async function EcsMonthPlanPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  searchParams: Promise<{ month?: string; period?: string | string[] }>;
}) {
  const { classId } = await params;
  const { month, period } = await searchParams;
  const res = await getMonthPlanPrint(classId, month ?? null, period ?? null);
  const embedded = (await headers()).get("x-embed") === "1";

  if (!res.ok) notFound();

  return (
    // ⚠️ 인쇄에선 바깥 여백을 0으로 — 여백은 `@page`가 한 번만 준다(두 번 주면 한 장에 안 들어간다).
    <div className="mx-auto max-w-[277mm] px-8 pt-6 pb-10 print:max-w-none print:p-0">
      <div className="print:hidden">
        <PrintActions embedded={embedded} />
      </div>
      <MpFitToPage>
        <MonthPlanPaper data={res.data} />
      </MpFitToPage>
    </div>
  );
}

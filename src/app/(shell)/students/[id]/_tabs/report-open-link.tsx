"use client";

import { SheetText } from "@/features/teacher-view/interface-label";

import { usePrintWindow } from "@/components/workspace/print-window";
import { useInFrame } from "@/components/workspace/use-in-frame";

/**
 * 원생 상세 '진도' 표의 **실제 수업보고서 바로가기**(원장 2026-09-18 *"실제 수업보고서 링크 바로가기"*).
 *
 * 🔴 **옆에 새 A4 창으로** 연다 — 보던 진도 표를 잃지 않게.
 *    ① 원생 상세는 보통 창(iframe) 안이다. 그 안에선 `WindowLink`도 인쇄 훅(`usePrintWindow`)도 **그 창 자체를
 *       보고서로 바꾼다**(iframe에선 `useIsDesktop`이 늘 false라 둘 다 드릴인으로 떨어진다). 그래서 창 안이면
 *       부모 작업면에 창을 열어 달라는 신호(`eywa-open-window` — WindowLink Shift+클릭과 같은 브리지)를 직접 보낸다.
 *    ② 창 id는 **인쇄 규약 `print/lesson_reports/<id>`** — 그래야 A4 크기로 선다(경로로 만든 id는 기본 크기).
 *       원스크린 'PDF'와 같은 id라 같은 보고서를 두 입구에서 열어도 창이 하나다.
 * 🔴 학부모 링크(`/r/…`)로 보내지 말 것 — 그 페이지는 워커 밖 **모든 방문을 학부모 열람으로 적는다**
 *    (바로 옆 '학부모 링크' 열이 직원 클릭으로 "1회 열람"이 된다).
 */
export function ReportOpenLink({ reportId, reportDate }: { reportId: string; reportDate: string }) {
  const openPrint = usePrintWindow();
  const inFrame = useInFrame();
  const params = {
    id: `print/lesson_reports/${reportId}`,
    href: `/lesson_reports/${reportId}/print`,
    // 창 제목에 날짜를 싣는다 — 같은 학생 보고서를 여럿 열면 창끼리 구분이 안 된다.
    title: `수업 보고서 ${reportDate}`,
  };
  return (
    <button
      type="button"
      className="text-primary font-bold hover:underline"
      onClick={(e) => {
        if (inFrame) {
          window.parent.postMessage({ type: "eywa-open-window", ...params }, window.location.origin);
          return;
        }
        openPrint(params, e);
      }}
    >
      <SheetText value={"열기"} /></button>
  );
}

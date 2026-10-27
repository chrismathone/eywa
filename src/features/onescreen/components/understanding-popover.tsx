"use client";

import { Popover } from "@base-ui/react/popover";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import type { UnderstandingRow } from "../math-report-pilot";
import { UnderstandingPanel } from "./understanding-panel";

/**
 * 표 행의 소단원별 이해도 창 — 카드의 이해도 패널(`UnderstandingPanel`)을 그대로 띄운다(원장 2026-10-27
 * *"학생별 상세에서 각각 변하게"*). 단계 버튼은 행에 그대로 두고, 소단원마다 다른 점수·빼기·되살리기는 이 창에서.
 * 버튼 글자에 뺀 소단원 수를 밝혀, 창을 열지 않아도 '빠진 게 있다'가 보이게 한다.
 */
export function UnderstandingPopover({
  rows,
  disabled,
  onScore,
  onToggle,
  onAll,
}: {
  rows: UnderstandingRow[];
  disabled?: boolean;
  onScore: (lesson: string, score: number | null) => void;
  onToggle: (lesson: string, off: boolean) => void;
  onAll?: (score: number) => void;
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  const offCount = rows.filter((r) => r.off).length;
  return (
    <Popover.Root>
      <Popover.Trigger
        className="border-line text-text-dim hover:border-primary data-[popup-open]:border-primary h-7 rounded-md border bg-background px-2 text-xs font-bold"
        title={t("os.grid.understandingDetailTitle")}
      >
        {offCount ? tf("os.grid.understandingDetailOff", { n: offCount }) : t("os.grid.understandingDetail")}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
          <Popover.Popup className="bg-card shadow-card max-h-[min(70dvh,var(--available-height))] w-[min(360px,calc(100vw-24px))] overflow-y-auto rounded-lg p-1 outline-none">
            <UnderstandingPanel rows={rows} disabled={disabled} onScore={onScore} onToggle={onToggle} onAll={onAll} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

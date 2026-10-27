"use client";

import { Popover } from "@base-ui/react/popover";
import { useSheetT } from "@/features/teacher-view/lang-context";
import { testSkipComplete, type DailyTestSkip } from "../math-report-pilot-sections";
import { DailyTestSkipPanel, TEST_SKIP_REASON_KEY } from "./daily-test-skip-panel";

/**
 * 표 행의 일일 테스트 '시험 없음' — 좁은 점수 칸에 사유 판(`DailyTestSkipPanel`)을 통째로 펼치면 행이 터진다(원장 2026-10-27
 * *"표모드에서 디자인 다깨짐"*). 칸에는 '시험 없음 · 사유' 버튼 하나만 두고, 누르면 카드와 같은 판을 창으로 띄운다.
 * 사유가 덜 찼으면(발송이 막히는 상태) 버튼을 붉게 해 창을 열지 않아도 보이게 한다.
 */
export function DailyTestSkipPopover({
  skip,
  disabled,
  onChange,
}: {
  skip: DailyTestSkip;
  /** 잠긴 행 — 창은 포털이라 칸의 fieldset 잠금이 닿지 않으니 직접 넘긴다. */
  disabled?: boolean;
  onChange: (skip: DailyTestSkip | null) => void;
}) {
  const t = useSheetT();
  const done = testSkipComplete(skip);
  const reason = skip.reason ? t(TEST_SKIP_REASON_KEY[skip.reason]) : t("os.card.testSkip.reasonLabel");
  return (
    <Popover.Root>
      <Popover.Trigger
        disabled={disabled}
        className={`data-[popup-open]:border-primary hover:border-primary flex w-full min-w-0 flex-col items-center rounded-md border bg-background px-1 py-0.5 text-xs font-bold leading-tight ${
          done ? "border-line text-text-dim" : "border-danger text-danger"
        }`}
        title={skip.detail ? `${reason} — ${skip.detail}` : reason}
      >
        <span className="whitespace-nowrap">{t("os.card.testSkip.no")}</span>
        <span className="block w-full truncate font-normal">{reason}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="center" sideOffset={4} className="z-50">
          <Popover.Popup className="bg-card shadow-card max-h-[min(70dvh,var(--available-height))] w-[min(340px,calc(100vw-24px))] overflow-y-auto rounded-lg p-1 text-left outline-none">
            <DailyTestSkipPanel skip={skip} disabled={disabled} onChange={onChange} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

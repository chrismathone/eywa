"use client";

/**
 * **보강 예약** 표식 — 원스크린 왼쪽 목록 · 카드 머리 · 표 모드가 같은 부품을 쓴다(원장 2026-10-22 *"표 모드도 동일하게"*).
 * 상태(`reservedTagState`, 원장 2026-10-27): '보강 예약 15:25~16:20' → 끝 시각이 지나도 확인 전이면 **'보강 진행 여부 확인해 주세요'**
 * (강조색 · 느린 깜빡임 — *"라벨 색상도 강조색상으로 꼭 중요하다는 식으로"* · *"펄스 깜빡임으로 주기 길게"*) → '보강 했음' 확인 뒤 '보강 완료'.
 * `onCheck`가 있으면(카드 머리·표 모드) 눌러서 **보강 했음 / 보강 못 했음**을 고른다(*"보강 예약을 누르면 보강을 했다 안했다 체크"*).
 * 왼쪽 목록은 줄 전체가 버튼이라 표시만. 결석분·발송 방식(합침/분리)은 툴팁. 판정은 `reserved-makeup.ts`.
 */
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { shortDate } from "../makeup-absence-link";
import { reservedTagState, reservedTimeText } from "../reserved-makeup";
import type { ReservedMakeup } from "../types";
import { useLessonClock } from "./use-lesson-clock";

type CheckOutcome = "done" | "missed";
type TagProps = { list?: readonly ReservedMakeup[]; size?: "sm" | "md"; onCheck?: (outcome: CheckOutcome) => void; busy?: boolean };

export function ReservedMakeupTag({ list, size = "sm", onCheck, busy }: TagProps) {
  // 시계는 표식이 있는 줄에서만 돈다(표 모드는 줄마다 이 부품을 그린다 — 빈 줄마다 타이머를 세우지 않게).
  if (!list?.length) return null;
  return <ReservedMakeupTagInner list={list} size={size} onCheck={onCheck} busy={busy} />;
}

function ReservedMakeupTagInner({ list, size, onCheck, busy }: { list: readonly ReservedMakeup[]; size: "sm" | "md"; onCheck?: (outcome: CheckOutcome) => void; busy?: boolean }) {
  const t = useSheetT();
  const tf = useSheetTf();
  const now = useLessonClock();
  const state = reservedTagState(list, now);
  // 이행됐지만 확인·끝 시각 전 = 정규 출석으로 시수가 미리 반영됐다 — 못 하면 고칠 곳을 알린다.
  const preApplied = state === "booked" && list.every((r) => r.done);
  const label =
    state === "needsCheck"
      ? t("os.reserved.needsCheck")
      : tf(state === "done" ? "os.reserved.done" : "os.reserved.tag", { time: reservedTimeText(list) });
  const title = [
    ...(state === "needsCheck" ? [t("os.reserved.needsCheckTitle")] : onCheck ? [t("os.reserved.checkTitle")] : []),
    ...list.map((r) => tf(r.mode === "merge" ? "os.reserved.merge" : "os.reserved.separate", { date: shortDate(r.absenceDate) })),
    ...(preApplied ? [t("os.reserved.preApplied")] : []),
  ].join("\n");
  const pad = size === "md" ? "px-1.5 py-px" : "px-1 py-px";
  const tone =
    state === "needsCheck"
      ? "bg-danger text-white pulse-slow"
      : state === "done"
        ? "border-purple text-purple border"
        : "bg-purple-soft text-purple";
  const cls = `num inline-flex shrink-0 items-center rounded-pill text-xs font-bold whitespace-nowrap ${pad} ${tone}`;
  if (!onCheck) {
    return (
      <span title={title} className={cls}>
        {label}
      </span>
    );
  }
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger disabled={busy} title={title} className={`${cls} cursor-pointer hover:opacity-85 disabled:opacity-60`}>
        {label} ▾
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-36">
        <DropdownMenuItem className="cursor-pointer font-bold" onClick={() => onCheck("done")}>
          {t("os.reserved.checkDone")}
        </DropdownMenuItem>
        <DropdownMenuItem className="text-danger cursor-pointer font-bold" onClick={() => onCheck("missed")}>
          {t("os.reserved.checkMissed")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

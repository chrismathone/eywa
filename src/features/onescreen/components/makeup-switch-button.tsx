"use client";

/**
 * 보강 보고서 **합치기 ↔ 나누기** 버튼(원장 2026-10-22) — 표 모드·카드가 같은 부품. 누르면 원스크린이 판정(makeup-switch.ts)하고 확인창을 띄운다.
 * join = '(보강)' 줄 → 같은 반 정규 줄에 합치기 · split = '정규+보강' 줄 → 보강 따로 보내기.
 */
import { useSheetT } from "@/features/teacher-view/lang-context";

export function MakeupSwitchButton({ kind, onClick, size = "sm" }: { kind: "join" | "split"; onClick: () => void; size?: "sm" | "md" }) {
  const t = useSheetT();
  const pad = size === "md" ? "px-2.5 py-1" : "px-1 py-px";
  return (
    <button
      type="button"
      onClick={onClick}
      title={t(kind === "join" ? "os.switch.joinTitle" : "os.switch.splitTitle")}
      className={`border-amber text-amber hover:bg-amber-soft inline-flex shrink-0 cursor-pointer items-center rounded-pill border text-xs font-bold whitespace-nowrap transition ${pad}`}
    >
      {t(kind === "join" ? "os.switch.join" : "os.switch.split")}
    </button>
  );
}

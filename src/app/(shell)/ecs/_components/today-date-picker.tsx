"use client";

/**
 * 오늘 면 날짜 **달력 선택** — EcsDayNav의 하루씩 이동을 보완한다(멀리 있는 날짜는 ◀를 열두 번 누르게 된다).
 * 원스크린 상단 바의 달력 패턴을 그대로 따른다: 🔴 크로미움은 **달력 아이콘을 눌러야** 달력이 열리므로
 * ① 클릭 때 `showPicker()` 직접 호출 + ② 달력 아이콘을 입력 전체로 늘려 이중 보장(top-bar.tsx, 2026-07-23).
 * 이동은 URL(searchParam) — 보기 상태는 계정 저장 대상이 아니다(today-nav.tsx 머리 주석과 같은 이유).
 */
import { useRef } from "react";
import { useRouter } from "next/navigation";
import { EyIcon } from "@/components/icons/eywa-icons";

export function EcsDatePicker({ date, mode }: { date: string; mode?: "sheet" | "cards" }) {
  const ref = useRef<HTMLInputElement>(null);
  const router = useRouter();
  return (
    <label
      className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft relative inline-flex shrink-0 cursor-pointer items-center rounded-full border p-1 transition"
      title="달력에서 날짜 선택"
      onClick={() => {
        // showPicker는 사용자 제스처 밖이거나 미지원이면 throw — 실패해도 아래 CSS 폴백이 받는다.
        try {
          ref.current?.showPicker?.();
        } catch {
          /* 폴백: 달력 아이콘이 입력 전체를 덮고 있어 이 클릭이 그대로 picker를 연다 */
        }
      }}
    >
      <EyIcon name="calendar" size={13} strokeWidth={2.5} />
      <input
        ref={ref}
        type="date"
        value={date}
        onChange={(e) => {
          if (e.target.value)
            router.push(`/ecs?view=today&date=${e.target.value}${mode === "cards" ? "&mode=cards" : ""}`);
        }}
        aria-label="날짜 선택"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
      />
    </label>
  );
}

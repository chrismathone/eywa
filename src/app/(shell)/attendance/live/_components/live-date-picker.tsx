"use client";

/**
 * 헤더 날짜를 누르면 달력. 크로미움은 아이콘을 눌러야 열려서 showPicker() + 투명 input 이중 보장
 * (ECS EcsDatePicker와 같은 규약). 미래 날짜는 max로 막는다.
 */
import { useRef } from "react";
import { useRouter } from "next/navigation";
import { formatKoreanDate } from "@/lib/date-kst";

export function LiveDatePicker({
  date,
  today,
  tab,
  hint,
}: {
  date: string;
  today: string;
  tab: string;
  hint?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function go(ymd: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || ymd > today) return;
    const q = tab === "desk" ? `tab=desk&date=${ymd}` : `date=${ymd}`;
    router.push(`/attendance/live?${q}`);
  }

  return (
    <button
      type="button"
      className="text-text-dim hover:text-foreground relative cursor-pointer text-left text-[13px]"
      title="날짜 선택"
      onClick={() => {
        try {
          ref.current?.showPicker?.();
        } catch {
          /* 투명 input의 달력 아이콘이 영역을 덮는다 */
        }
      }}
    >
      {formatKoreanDate(date)}
      {hint ? ` · ${hint}` : ""}
      <input
        ref={ref}
        type="date"
        value={date}
        max={today}
        onChange={(e) => go(e.target.value)}
        aria-label="날짜 선택"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
      />
    </button>
  );
}

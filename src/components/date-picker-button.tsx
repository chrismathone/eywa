"use client";

/**
 * 공용 날짜 선택기. label을 넘기면 PeriodNav 가운데 날짜가 트리거이며, 없으면 달력 아이콘이다.
 * Chromium은 네이티브 달력 표시기를 입력 전체로 넓혀 어디를 눌러도 열린다. 지원 브라우저에서는
 * showPicker도 호출하며 값 선택 후 이동은 onChange 호출부가 담당한다.
 */
import { useRef } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { CONTROL_SQUARE } from "@/components/ui/control-scale";

export function DatePickerButton({
  value,
  min,
  max,
  onChange,
  title = "달력에서 날짜 선택",
  ariaLabel = "날짜 선택",
  label,
}: {
  value: string;
  min?: string;
  max?: string;
  onChange: (ymd: string) => void;
  title?: string;
  ariaLabel?: string;
  /** PeriodNav 가운데 날짜를 직접 눌러 여는 표시. 생략하면 기존 아이콘 버튼. */
  label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <label
      className={`${label ? "h-full w-full px-2 font-bold text-foreground whitespace-nowrap" : `${CONTROL_SQUARE} border-line text-text-dim rounded-lg border`} hover:text-foreground hover:bg-bg-soft focus-within:ring-2 focus-within:ring-primary relative inline-flex shrink-0 cursor-pointer items-center justify-center transition`}
      title={title}
      onClick={() => {
        // showPicker는 사용자 제스처 밖이거나 미지원이면 throw — 실패해도 아래 CSS 폴백이 받는다.
        try {
          ref.current?.showPicker?.();
        } catch {
          /* 폴백: 달력 아이콘이 입력 전체를 덮고 있어 이 클릭이 그대로 picker를 연다 */
        }
      }}
    >
      {label ?? <EyIcon name="calendar" size={14} strokeWidth={2.25} />}
      <input
        ref={ref}
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        aria-label={ariaLabel}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
      />
    </label>
  );
}

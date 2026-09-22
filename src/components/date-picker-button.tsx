"use client";

/**
 * 달력 아이콘 버튼 — `<input type="date">`를 아이콘 하나로 접은 공용 부품(디자인 v5 18단계).
 *
 * 🔴 크로미움은 **달력 아이콘을 눌러야** 달력이 열린다 → ① 클릭 때 `showPicker()` 직접 호출 + ② 달력 아이콘을
 *    입력 전체로 늘려 이중 보장(원장 확인 2026-07-23, 원스크린 상단 바 규약). 크기는 control-scale 정사각
 *    (`CONTROL_SQUARE` — 옆에 서는 PeriodNav·Button과 같은 높이).
 * 값을 고르면 `onChange(ymd)` 한 번 — 이동(URL push·콜백)은 호출부 몫이라 이 부품은 라우터를 모른다.
 * 소비처: 원스크린 상단 바(`top-bar.tsx`) · ECS 오늘 면(`today-date-picker.tsx`). 같은 강사가 오가는 두 화면이라
 * 크기·아이콘이 갈리면 안 된다 — 그전엔 ECS만 아이콘 버튼(`h-8 w-8`)이었고 원스크린은 **날짜 글자 자체가**
 * 달력 트리거였다(라벨을 `PeriodNav`가 가져가면서 달력만 여는 버튼으로 분리됐다).
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
}: {
  value: string;
  min?: string;
  max?: string;
  onChange: (ymd: string) => void;
  title?: string;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <label
      className={`${CONTROL_SQUARE} border-line text-text-dim hover:text-foreground hover:bg-bg-soft relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border transition`}
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
      <EyIcon name="calendar" size={14} strokeWidth={2.25} />
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

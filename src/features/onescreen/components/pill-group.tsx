"use client";

/**
 * 1클릭 pill 선택 그룹 — 카드뷰·표뷰 공용(그리드 분해 0단계 추출).
 * 토글(재클릭 해제) 판단은 부모 핸들러 몫 — 이 컴포넌트는 클릭된 옵션을 그대로 올린다
 * (카드뷰 setAttitude가 "같은 값이면 해제"를 이미 처리, 표뷰도 동일 패턴으로 배선).
 */
export function PillGroup({
  options,
  value,
  onSelect,
  ariaLabel,
  size = "md",
  disabled,
}: {
  options: readonly string[];
  value: string | null | undefined; // 현재 선택값(없으면 null/undefined/"")
  onSelect: (option: string) => void;
  ariaLabel?: string; // 그룹 aria-label (예: "김이현 수업 태도")
  size?: "sm" | "md"; // sm=표뷰(밀도), md=카드뷰(기존 크기)
  disabled?: boolean;
}) {
  const sizeCls = size === "sm" ? "px-1.5 py-0.5 text-xs" : "px-2.5 py-1 text-xs";
  return (
    <div className={`flex flex-wrap ${size === "sm" ? "gap-1" : "gap-1.5"}`} role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const on = value === o;
        return (
          <button
            key={o}
            type="button"
            onClick={() => onSelect(o)}
            aria-pressed={on}
            disabled={disabled}
            className={`rounded-pill font-bold transition disabled:opacity-50 ${sizeCls} ${
              on ? "bg-primary text-primary-foreground" : "border-line text-text-dim hover:bg-bg-soft border"
            }`}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

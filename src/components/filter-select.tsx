"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

export type FilterSelectOption = { value: string; label: string };

/**
 * 공통 필터 dropdown — chip이 너무 많은 경우 대체용.
 * 현재 URL의 searchParams를 유지하면서 paramName만 교체.
 * value === "" (또는 allValue와 일치) 선택 시 해당 param 제거 → "전체" 효과.
 */
export function FilterSelect({
  paramName,
  value,
  options,
  allLabel = "전체",
  allValue = "",
  ariaLabel,
  className,
}: {
  paramName: string;
  value: string | null | undefined;
  options: FilterSelectOption[];
  allLabel?: string;
  allValue?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const currentParams = useSearchParams();

  return (
    <select
      aria-label={ariaLabel ?? paramName}
      value={value ?? allValue}
      className={
        className ??
        "border-border bg-background text-foreground rounded-md border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
      }
      onChange={(e) => {
        const v = e.target.value;
        const params = new URLSearchParams(currentParams?.toString() ?? "");
        if (v === allValue || v === "") params.delete(paramName);
        else params.set(paramName, v);
        const s = params.toString();
        router.push(`${pathname}${s ? `?${s}` : ""}`);
      }}
    >
      <option value={allValue}>{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

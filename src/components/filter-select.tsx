"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { SearchableSelect } from "@/components/ui/searchable-select";

export type FilterSelectOption = { value: string; label: string };

/**
 * 공통 필터 dropdown — chip이 너무 많은 경우 대체용.
 * 현재 URL의 searchParams를 유지하면서 paramName만 교체.
 * value === "" (또는 allValue와 일치) 선택 시 해당 param 제거 → "전체" 효과.
 *
 * `searchable`: 옵션이 수십~수백 개일 때(예: 반 ~129개) native select 벽을 피해 검색형 콤보박스로.
 */
export function FilterSelect({
  paramName,
  value,
  options,
  allLabel = "전체",
  allValue = "",
  ariaLabel,
  className,
  searchable = false,
}: {
  paramName: string;
  value: string | null | undefined;
  options: FilterSelectOption[];
  allLabel?: string;
  allValue?: string;
  ariaLabel?: string;
  className?: string;
  searchable?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const currentParams = useSearchParams();

  const navigate = (v: string) => {
    const params = new URLSearchParams(currentParams?.toString() ?? "");
    if (v === allValue || v === "") params.delete(paramName);
    else params.set(paramName, v);
    const s = params.toString();
    router.push(`${pathname}${s ? `?${s}` : ""}`);
  };

  if (searchable) {
    return (
      <SearchableSelect
        className={className ?? "w-44"}
        value={value ?? allValue}
        onValueChange={navigate}
        placeholder={allLabel}
        options={[{ value: allValue, label: allLabel }, ...options]}
      />
    );
  }

  return (
    <select
      aria-label={ariaLabel ?? paramName}
      value={value ?? allValue}
      className={
        className ??
        "border-border bg-background text-foreground rounded-md border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
      }
      onChange={(e) => navigate(e.target.value)}
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

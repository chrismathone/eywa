"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { SearchableSelect } from "@/components/ui/searchable-select";

export type FilterSelectOption = { value: string; label: string };

/**
 * 공통 필터 dropdown — URL searchParams를 유지하며 paramName만 교체.
 * value === "" (또는 allValue) 선택 시 해당 param 제거 → "전체" 효과.
 *
 * 드롭다운 스타일은 앱 전체에서 SearchableSelect로 통일(테두리·padding·ChevronDown·검색 팝오버 일관).
 * 과거 native <select> 분기는 제거 — `ariaLabel`은 트리거 버튼 접근성 이름으로 포워딩, `searchable`은 미사용.
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
  /** 트리거 버튼 접근성 이름(예: "강사 필터") — 없으면 paramName으로 폴백. */
  ariaLabel?: string;
  className?: string;
  /** @deprecated 호환용 — 이제 항상 검색형(SearchableSelect)으로 통일. */
  searchable?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const currentParams = useSearchParams();

  const navigate = (v: string) => {
    const params = new URLSearchParams(currentParams?.toString() ?? "");
    if (v === allValue || v === "") params.delete(paramName);
    else params.set(paramName, v);
    params.delete("page"); // 필터 변경은 결과집합이 바뀌므로 1페이지로 리셋(stale page 방지).
    const s = params.toString();
    router.push(`${pathname}${s ? `?${s}` : ""}`);
  };

  return (
    <SearchableSelect
      className={className ?? "w-44"}
      value={value ?? allValue}
      onValueChange={navigate}
      placeholder={allLabel}
      ariaLabel={ariaLabel ?? paramName}
      options={[{ value: allValue, label: allLabel }, ...options]}
    />
  );
}

"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { SearchableSelect } from "@/components/ui/searchable-select";

export type FilterSelectOption = {
  value: string;
  label: string;
  /** 라벨만으론 못 찾는 항목의 보조 검색어 겸 부가표시(예: 반 이름 옆 "수학 · 이성우"). */
  hint?: string;
};

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
  cap,
}: {
  paramName: string;
  value: string | null | undefined;
  options: FilterSelectOption[];
  allLabel?: string;
  allValue?: string;
  /** 트리거 버튼 접근성 이름(예: "강사 필터") — 없으면 paramName으로 폴백. */
  ariaLabel?: string;
  className?: string;
  /**
   * 팝업 렌더 상한(기본 50). ⚠️ 옵션이 수십 개를 넘고 **정렬이 카테고리와 상관**되면 기본값이
   * 한 카테고리를 통째로 가린다(gotcha #84) — 예: 반 목록은 이름순이라 로마자 영어반이 앞을 독점해
   * 50개 안에 수학반이 7개만 들어갔다. 그런 목록은 전량이 들어가도록 cap을 올릴 것.
   */
  cap?: number;
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
      cap={cap}
      options={[{ value: allValue, label: allLabel }, ...options]}
    />
  );
}

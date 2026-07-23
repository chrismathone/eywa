"use client";

import { useMemo } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";

/**
 * 태도·과제처럼 **정해진 선택지 하나**를 고르는 칸의 공용 드롭다운 — 원장 지시(2026-07-23):
 * *"태도나 과제 버튼 말고 드랍다운으로 변경."*
 *
 * 원래는 1클릭 알약(PillGroup, edutrix 라디오 패리티)이었는데 선택지가 늘면서
 * (과제에 '없음' 추가 = 4개) 표 한 행에 알약이 9개가 깔려 가로가 터졌다. 드롭다운은 2클릭이지만
 * 폭이 고정이라 표가 안정된다.
 *
 * ⚠️ 드롭다운은 [`SearchableSelect`]로 통일한다(design-conventions "드롭다운/셀렉트 규약").
 *    native `<select>` 신규 금지 — 전역 디자인 스크롤바가 안 닿고 스타일이 어긋난다.
 * ⚠️ **해제 경로를 반드시 남길 것** — 알약은 재클릭으로 해제됐다. 드롭다운엔 그런 동작이 없으므로
 *    맨 위 "선택 안 함"(빈 값)을 넣는다. 없으면 강사가 잘못 고른 값을 **되돌릴 방법이 사라진다.**
 */
export function FieldSelect({
  options,
  value,
  onSelect,
  ariaLabel,
  placeholder = "선택",
  className,
}: {
  options: readonly string[];
  /** 현재 값. 빈 문자열·null 모두 "미선택"으로 본다. */
  value: string | null | undefined;
  /** 선택 결과 — "선택 안 함"이면 `null`이 온다(호출부가 기존 해제 로직을 그대로 쓰게). */
  onSelect: (v: string | null) => void;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
}) {
  const opts = useMemo(
    () => [{ value: "", label: "선택 안 함" }, ...options.map((o) => ({ value: o, label: o }))],
    [options],
  );
  return (
    <SearchableSelect
      options={opts}
      value={value ?? ""}
      onValueChange={(v) => onSelect(v || null)}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      // 선택지가 5개 안팎이라 검색 입력은 실질 무용 — 안내 문구만 짧게(컴포넌트가 항상 그린다).
      searchPlaceholder="찾기"
      className={className}
    />
  );
}

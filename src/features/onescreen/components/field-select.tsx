"use client";

import { useMemo } from "react";
import { SearchableSelect, type ComboOption } from "@/components/ui/searchable-select";

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
  radius = "lg",
  box,
  labelOf,
  noneLabel = "선택 안 함",
  legacyHint = "이전 표기",
  searchPlaceholder = "찾기",
}: {
  options: readonly string[];
  /** 현재 값. 빈 문자열·null 모두 "미선택"으로 본다. */
  value: string | null | undefined;
  /** 선택 결과 — "선택 안 함"이면 `null`이 온다(호출부가 기존 해제 로직을 그대로 쓰게). */
  onSelect: (v: string | null) => void;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
  /**
   * 이웃 입력칸과 **같은 라운드**를 쓴다 — 표(grid-row)는 밀도 때문에 `rounded-sm`,
   * 카드·일괄 팝오버는 `rounded-lg`다. 높이·padding·글자크기는 세 표면이 동일해서 상수로 고정.
   */
  radius?: "sm" | "lg";
  /**
   * 박스 스타일(테두리·높이·라운드·글자)을 **통째로** 교체 — 그 표면의 다른 입력칸과 반드시 같아야 하는
   * 자리에서만 넘긴다(ECS 시트 = `SHEET_INPUT`). 넘기면 `radius`는 무시되고, 촘촘한 표라는 뜻이므로
   * 화살표도 함께 작아진다. 미지정이면 기존 기본값 그대로 — **다른 화면 영향 0**.
   */
  box?: string;
  /**
   * **저장값 → 화면 글자**(강사뷰 영어 화면). 저장·비교는 계속 원래 값으로 하고 **표시만** 바꾼다
   * — 넘기지 않으면 값이 그대로 보인다(기존 호출부 전부 무변경).
   * 🔴 여기서 값을 갈아치우지 말 것: `onSelect`는 언제나 **저장값**을 돌려줘야 한다.
   */
  labelOf?: (value: string) => string;
  /** '선택 안 함'·'이전 표기'·'찾기' — 화면 언어를 따르는 자리만 넘긴다(기본은 한국어 그대로). */
  noneLabel?: string;
  legacyHint?: string;
  searchPlaceholder?: string;
}) {
  const opts = useMemo(() => {
    const show = (v: string) => labelOf?.(v) ?? v;
    const base: ComboOption[] = [
      { value: "", label: noneLabel },
      ...options.map((o) => ({ value: o, label: show(o) })),
    ];
    // ⚠️ **선택지에 없는 저장값도 보이게 유지한다.** SearchableSelect는 옵션에서 못 찾은 값을 placeholder로
    //    그리므로, 그냥 두면 옛 표기(과제 '완료' → 퍼센트 전환, 2026-08-03)나 학원설정에서 지운 태도값이
    //    **빈 칸처럼 보인다** — 강사 눈엔 값이 사라진 것이고, 실제 DB엔 그대로 남아 학부모에게 나간다.
    const v = (value ?? "").trim();
    if (v && !options.includes(v)) base.push({ value: v, label: show(v), hint: legacyHint });
    return base;
  }, [options, value, labelOf, noneLabel, legacyHint]);
  return (
    <SearchableSelect
      options={opts}
      value={value ?? ""}
      onValueChange={(v) => onSelect(v || null)}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      // 선택지가 5개 안팎이라 검색 입력은 실질 무용 — 안내 문구만 짧게(컴포넌트가 항상 그린다).
      searchPlaceholder={searchPlaceholder}
      className={className}
      // 박스를 통째로 받은 자리(ECS)는 그 표면의 입력칸과 한 벌이라는 뜻 → 화살표도 촘촘하게.
      compact={box !== undefined}
      // ⚠️ 이웃 텍스트 입력과 **완전히 같은 치수**(원장 2026-07-23 "네모박스 크기가 너무 다름").
      //    표·카드·일괄 세 표면의 입력칸이 모두 `border-line bg-card h-8 px-2 text-[12px]`이고
      //    라운드만 다르다. 기본 트리거(py-2·px-3·text-sm)를 그대로 쓰면 한 줄에서 이 칸만 커진다.
      //    ⚠️ 새 표면에 FieldSelect를 놓을 땐 그 자리 입력칸 클래스와 대조해볼 것.
      triggerClassName={
        box ??
        `border-line bg-card text-foreground focus:border-primary h-8 border px-2 text-[12px] outline-none ${
          radius === "sm" ? "rounded-sm" : "rounded-lg"
        }`
      }
    />
  );
}

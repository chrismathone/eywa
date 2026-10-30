"use client";
import { useSheetText } from "@/features/teacher-view/lang-context";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { orderMulti, parseMulti } from "@/lib/multi-value";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { MARKER_TRIGGER, MARKER_WIDTH } from "@/components/ui/marker-trigger";

export type FilterSelectOption = {
  value: string;
  label: string;
  /** 라벨만으론 못 찾는 항목의 보조 검색어 겸 부가표시(예: 반 이름 옆 "수학 · 이성우"). */
  hint?: string;
  /** 묶음 제목(SearchableSelect `group`) — 예: 맨 아래 '퇴사자'. */
  group?: string;
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
  triggerClassName,
  cap,
  marker = false,
  clearParams,
  axisLabel,
  explicitAll = false,
  prefixOnlyFor,
  multiple = false,
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
   * 트리거 박스 클래스 override — 툴바 한 줄에서 **높이를 맞출 때** 쓴다(원장 2026-09-01 "버튼높이 통일").
   * ⚠️ 톤(배경·테두리)까지 통째로 대체된다 — 반쪽만 덮어쓰면 색이 갈린다(SearchableSelect 주석).
   */
  triggerClassName?: string;
  /**
   * 팝업 렌더 상한(기본 50). ⚠️ 옵션이 수십 개를 넘고 **정렬이 카테고리와 상관**되면 기본값이
   * 한 카테고리를 통째로 가린다(gotcha #84) — 예: 반 목록은 이름순이라 로마자 영어반이 앞을 독점해
   * 50개 안에 수학반이 7개만 들어갔다. 그런 목록은 전량이 들어가도록 cap을 올릴 것.
   */
  cap?: number;
  /**
   * **"지금 어느 반을 보고 있나"** 드롭다운인가 — 켜면 값이 실제로 골라졌을 때 형광 노랑 +
   * 페이지 최대 글자로 커진다([marker-trigger.ts](@/components/ui/marker-trigger), 원장 2026-08-18).
   * 🔴 **목록을 좁히는 필터엔 켜지 말 것**(과목·강사·상태). 이 표기는 화면에 **하나**일 때만 뜻이 있다 —
   *    노란 게 둘이 되는 순간 첫째가 안 보이고 "확실하게 보기 위함"이라는 목적이 통째로 사라진다.
   * ⚠️ 켜도 **"전체"일 땐 평범한 모양**이다 — 아무 반도 안 골랐는데 노랗게 칠하면 "전체"가 선택된
   *    반처럼 읽힌다(SearchableSelect `highlightSelected`가 같은 이유로 고른 값에만 강조를 준다).
   */
  marker?: boolean;
  /** @deprecated 호환용 — 이제 항상 검색형(SearchableSelect)으로 통일. */
  searchable?: boolean;
  /**
   * 값을 고를 때 **함께 지우는** 파라미터 — 서로 배타인 축(등록상담의 기간 프리셋 ↔ 특정 달)에 쓴다.
   * 안 지우면 두 축이 URL에 같이 남아 어느 쪽이 이기는지 서버 우선순위에 달린다.
   */
  clearParams?: string[];
  /**
   * 축 이름(기간·상담사·상태…). 주면 트리거가 **`축: 값`**(`기간: 전체` / `기간: 최근 7일`)으로 읽히고
   * 목록 안 해제 항목은 `allLabel`(기본 "전체") 그대로 선다.
   * 🔴 축 이름을 `allLabel`에 넣지 말 것 — 목록에서 "기간"이 제목인지 해제 항목인지 안 읽히고, 값을 고르면
   *    트리거에 '완료'만 남아 어느 축인지 사라진다(학생상담 리뷰 확정 결함, 2026-09-03).
   */
  axisLabel?: string;
  /**
   * "전체"를 골라도 파라미터를 **지우지 않고 `allValue`로 적는다**. 서버가 "파라미터 없음 = 계정에 저장된 보기 설정"으로
   * 읽는 화면(학생목록 `users.ui_prefs.students`)에서 쓴다 — 지우면 "전체로 되돌림"과 "처음 들어옴"이 같은 URL이 되어
   * 저장된 필터가 되살아나 전체를 고를 길이 없어진다. 저장이 없는 화면에선 켜지 말 것(URL만 길어진다).
   */
  explicitAll?: boolean;
  /** 이 값(보통 `allValue`)이 골라져 있으면 트리거에 축 이름만 — SearchableSelect 주석. */
  prefixOnlyFor?: string;
  /**
   * **다중 선택**(원장 2026-09-28) — `value`는 쉼표 문자열(`math,english`), 항목을 누르면 더하거나 빼고 목록은 열린 채다.
   * '전체'는 전부 해제. URL도 쉼표 문자열 — 🔴 **서버가 여러 값을 읽는 화면에서만** 켤 것(화면만 다중이고 서버가 첫 값만 쓰면 거짓 약속).
   */
  multiple?: boolean;
}) {
  const text = useSheetText();
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const currentParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const serverValues = multiple ? parseMulti(value, allValue) : [];
  // 🔴 낙관적 선택 — 서버 왕복 안에 둘째 항목을 누르면 서버가 준 값으로 다음 집합을 만들 때 첫 클릭이 사라진다
  //    (요일 필터 HeaderDayFilter와 같은 이유 — 적대적 리뷰 2026-09-04). 전환 중엔 마지막으로 보낸 집합이 화면이다.
  const [local, setLocal] = useState<string[]>(serverValues);
  const values = pending ? local : serverValues;

  const push = (params: URLSearchParams) => {
    for (const k of clearParams ?? []) params.delete(k);
    params.delete("page"); // 필터 변경은 결과집합이 바뀌므로 1페이지로 리셋(stale page 방지).
    const s = params.toString();
    return `${pathname}${s ? `?${s}` : ""}`;
  };

  const setAll = (params: URLSearchParams) => {
    if (explicitAll && allValue !== "") params.set(paramName, allValue);
    else params.delete(paramName);
  };

  const navigate = (v: string) => {
    const params = new URLSearchParams(currentParams?.toString() ?? "");
    if (multiple) {
      const next =
        v === allValue || v === ""
          ? []
          : orderMulti(
              values.includes(v) ? values.filter((x) => x !== v) : [...values, v],
              options.map((o) => o.value),
            );
      if (next.length === 0) setAll(params);
      else params.set(paramName, next.join(","));
      setLocal(next);
      const href = push(params);
      startTransition(() => router.push(href));
      return;
    }
    if (v === allValue || v === "") setAll(params);
    else params.set(paramName, v);
    router.push(push(params));
  };

  // 실제로 하나를 골랐을 때만 표기가 켜진다("전체"는 반을 고른 게 아니다 — 위 `marker` 주석).
  const markerOn = marker && (value ?? allValue) !== allValue && (value ?? "") !== "";

  // 기본 폭은 내용 폭(w-auto) — 옛 `w-44`(176px)는 14px 시절 예산이라 v5(라벨 18px)에선 감사로그 액션
  // 라벨(`시간표 계획 만들기(현재 시간표 복사)` ≈274px)이 잘렸다. v5에서 손본 툴바가 넘기는 값과 같다.
  // 2026-09-08 v5 글자 기준 실측: 예산 = 176 − px-2.5 20 − border 2 − gap 8 − chevron 16 = 130px < 174~274px.
  return (
    <SearchableSelect
      className={className ?? (markerOn ? MARKER_WIDTH : "w-auto")}
      value={multiple ? (values.length > 0 ? values.join(",") : allValue) : (value ?? allValue)}
      multiValues={multiple ? values : undefined}
      onValueChange={navigate}
      placeholder={text(axisLabel ?? allLabel)}
      valuePrefix={axisLabel ? text(axisLabel) : undefined}
      prefixOnlyFor={prefixOnlyFor}
      ariaLabel={text(ariaLabel ?? paramName)}
      cap={cap}
      // undefined면 SearchableSelect가 기본 박스를 그린다 — 반쪽만 덮어쓰지 않는다(톤은 한 벌).
      triggerClassName={markerOn ? MARKER_TRIGGER : triggerClassName}
      options={[{ value: allValue, label: text(allLabel) }, ...options.map((option) => option.label === "(선택지에 없는 값)" ? { ...option, label: text(option.label) } : option)]}
    />
  );
}

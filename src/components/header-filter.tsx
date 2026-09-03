import { FilterSelect, type FilterSelectOption } from "./filter-select";
import { CONTROL_H_SM, CONTROL_LABEL_SM } from "./ui/control-scale";

/**
 * **열 머리 필터** — 표의 열 제목 자리에 서는 드롭다운. 지시서 §10 *"필터·정렬은 목록 헤더 라벨을 눌러 호출"*
 * (원장 2026-09-03 "지시서 그대로", 첫 적용 = 학생목록). 필터 줄(툴바)이 통째로 사라지고 열 제목이 곧 필터다.
 *
 * 트리거는 열 제목처럼 읽힌다 — 값이 없으면 축 이름만(`상태`), 고르면 `상태: 휴원`. 치수는 control-scale의 작은
 * 컨트롤(라벨 16 = 표 본문과 같은 크기, 높이 20)이라 머리 행이 본문보다 커지지 않는다.
 *
 * 🔴 이 트리거가 서는 표는 `overflow-x-auto`로 싸지 말 것 — 팝업이 잘린다(팝업은 트리거 아래 absolute). **폰에서도**: overflow-x가
 *    auto면 overflow-y도 auto가 되어 짧은 표 안에서 팝업이 잘린다(리뷰 2026-09-04). 표는 메뉴의 최소 창 폭에 맞춰 `table-fixed`로 세우고,
 *    폰은 표(`min-w`)가 넘치면 셸 main이 가로로 스크롤한다.
 * 🔴 서버/클라 양쪽이 쓴다 — `"use client"`도 `server-only`도 붙이지 말 것(안쪽 FilterSelect가 클라다).
 */
export const HEADER_FILTER_TRIGGER = `${CONTROL_H_SM} ${CONTROL_LABEL_SM} text-foreground hover:bg-bg-soft rounded-md px-1 font-bold whitespace-nowrap`;

export function HeaderFilter({
  paramName,
  value,
  options,
  axisLabel,
  allLabel = "전체",
  allValue = "",
  ariaLabel,
  cap,
  explicitAll = false,
  showAll = false,
}: {
  paramName: string;
  value: string | null | undefined;
  options: FilterSelectOption[];
  /** 열 제목 = 축 이름(`상태`·`수강 과목`·`담당 강사`). */
  axisLabel: string;
  allLabel?: string;
  allValue?: string;
  ariaLabel?: string;
  cap?: number;
  /** 서버가 "파라미터 없음 = 저장된 보기 설정"으로 읽는 화면에서 켠다(FilterSelect 주석). */
  explicitAll?: boolean;
  /**
   * "전체"일 때도 값을 적는다(`상태: 재원`·`정렬: 학년순`). 기본은 축 이름만(`수강 과목`) — 안 걸린 필터가 `수강 과목: 전체`로
   * 읽히면 열 머리가 다섯 칸 전부 "…: 전체"로 늘어져 정작 걸린 필터가 안 보인다. 기본값이 무언가를 **숨기는** 축(상태=재원)과
   * 값이 항상 뜻을 갖는 축(정렬)만 켠다.
   */
  showAll?: boolean;
}) {
  // 걸린 값이 선택지 밖이면(학원설정에서 지운 학년·퇴사한 담임·옛 링크) 그 값을 **보이는 항목**으로 세운다 — 안 그러면 트리거가 옅은
  // 축 이름(placeholder)이 되어 "안 걸림"으로 읽히는데 목록은 0건이다(적대적 리뷰 2026-09-04). 라벨이 값을 감추지 않으니 되돌릴 수 있다.
  const known = value == null || value === "" || value === allValue || options.some((o) => o.value === value);
  const shown = known ? options : [...options, { value: value as string, label: "(선택지에 없는 값)" }];
  return (
    <FilterSelect
      paramName={paramName}
      value={value}
      // 안 걸린 축은 축 이름만(`수강 과목`) — 값은 진짜 골라져 있어 굵기가 다른 머리와 같고 목록에 ✓가 선다(빈 값으로 흉내 내면 옅어진다).
      prefixOnlyFor={showAll ? undefined : allValue}
      options={shown}
      axisLabel={axisLabel}
      allLabel={allLabel}
      allValue={allValue}
      ariaLabel={ariaLabel ?? `${axisLabel} 필터`}
      cap={cap}
      explicitAll={explicitAll}
      className="inline-block w-auto align-middle"
      triggerClassName={HEADER_FILTER_TRIGGER}
    />
  );
}

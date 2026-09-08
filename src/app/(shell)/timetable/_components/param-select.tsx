"use client";

import { HrefSelect, type HrefSelectOption } from "@/components/href-select";
import { confirmTimetableNav } from "./timetable-unsaved";

/**
 * 시간표 툴바의 `축: 값` 드롭다운(과목·구분·프로그램·뷰) — 공용 [`HrefSelect`](@/components/href-select)에 시간표의 규약 하나를
 * 얹는다: 이동 직전 **미저장 배치 경고**(`confirmTimetableNav`, 원장 2026-08-06 *"편집중에 주 과목 뷰 바꿀때도 경고"*).
 * 서버 컴포넌트(page.tsx)는 함수를 넘길 수 없어 이 얇은 클라 래퍼가 든다(주간 네비 `week-period-nav.tsx`와 같은 이유).
 * 항목 href는 서버 `buildHref`가 만든다 — 축 하나를 바꿀 때 나머지 축(주·과목별 기본 뷰·1시간 단위·표시 취향·프로그램)을 함께 싣는다.
 */
export function ParamSelect({
  axisLabel,
  ariaLabel,
  value,
  options,
}: {
  axisLabel: string;
  ariaLabel: string;
  value: string;
  options: HrefSelectOption[];
}) {
  return <HrefSelect axisLabel={axisLabel} ariaLabel={ariaLabel} value={value} options={options} beforeNavigate={confirmTimetableNav} />;
}

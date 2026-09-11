"use client";

/**
 * 오늘 면 날짜 **달력 선택** — EcsDayNav의 하루씩 이동을 보완한다(멀리 있는 날짜는 ◀를 열두 번 누르게 된다).
 * 버튼은 공용 `DatePickerButton`(원스크린 상단 바와 같은 부품·같은 크기 — 디자인 v5 18단계; 그전엔 이 화면만
 * `h-8 w-8` 아이콘 버튼이었고 원스크린은 날짜 글자가 트리거였다). 이동은 URL(searchParam) — 보기 상태는 계정
 * 저장 대상이 아니다(today-nav.tsx 머리 주석과 같은 이유).
 */
import { useRouter } from "next/navigation";
import { DatePickerButton } from "@/components/date-picker-button";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";

export function EcsDatePicker({
  date,
  mode,
  view = "today",
}: {
  date: string;
  mode?: "sheet" | "cards";
  view?: "today" | "room";
}) {
  const router = useRouter();
  const embed = useEmbed();
  const href = (ymd: string) =>
    view === "room"
      ? `/ecs?view=room&date=${ymd}`
      : `/ecs?view=today&date=${ymd}${mode === "cards" ? "&mode=cards" : ""}`;
  // 창(iframe) 안이면 embed=1을 싣는다(PeriodNav와 같은 규칙) — 빼면 뒤이은 새로고침이 창 안에 전체 셸을 그린다.
  return (
    <DatePickerButton
      value={date}
      onChange={(ymd) => router.push(embed ? withEmbed(href(ymd)) : href(ymd))}
    />
  );
}

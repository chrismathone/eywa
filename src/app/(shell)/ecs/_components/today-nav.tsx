import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  TOOLBAR_SEG_BOX,
  TOOLBAR_SEG_ITEM,
  TOOLBAR_SEG_OFF,
  TOOLBAR_SEG_ON_PRIMARY,
} from "@/components/toolbar-controls";
import { addDays, DAY_LABEL_W, formatKoreanDate } from "@/lib/date-kst";
import { PeriodNav } from "@/components/period-nav";
import { EcsDatePicker } from "./today-date-picker";

/**
 * ECS 면 전환(오늘 / 주간) + 날짜 이동 — 둘 다 **URL 파라미터**라 서버 컴포넌트로 충분하다.
 *
 * ⚠️ 보기 상태를 계정에 저장하지 않는 이유: 여기는 "지금 무엇을 보는가"이지 **설정이 아니다**(뒤로가기가
 *    동작해야 하고, 링크로 특정 날짜를 공유할 수 있어야 한다). 계정 귀속 대상은 프로그램 필터·글씨 크기다.
 * ⚠️ 모양은 **[WeekNav](../../timetable/_components/week-nav.tsx)를 그대로 따른다** — 같은 툴바에 나란히
 *    서는 컨트롤이라 여기만 다른 알약·테두리를 쓰면 그 줄이 통째로 어색해진다(원장 지적 2026-08-07
 *    "강사뷰 서식만 다르면 이상함"). 칩=`rounded-full`·소라벨=`.micro`·날짜=`.num`.
 */

/**
 * 면·모드 전환 칩 — 묶음 상자(TOOLBAR_SEG_BOX) 안에 서므로 자기 테두리·알약을 갖지 않는다
 * (원장 2026-09-01 툴바 라운드 통일). 활성 색(학원색)은 종전 그대로다.
 */
const chip = (active: boolean) =>
  `${TOOLBAR_SEG_ITEM} shrink-0 font-medium ${active ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF}`;

/** 오늘 면 입력 모드 — 기본 = 시트(URL 무표기). cards만 파라미터로 남긴다. */
export type EcsTodayMode = "sheet" | "cards";
const modeQ = (mode?: EcsTodayMode) => (mode === "cards" ? "&mode=cards" : "");

/**
 * 오늘 면 모드 전환(시트 / 요약 카드) — 원장 2026-08-11 *"원스크린 느낌으로 한곳에서 모두 수정하고
 * 싶다. 표 모드에서 전부 해결 가능하지 않나?"* → 기본이 **시트**(그 날짜 열만 필터한 주간 시트를 반마다
 * 쌓아 전부 편집), 카드는 요약·일괄 출석용 보조 보기로 남긴다.
 */
export function EcsTodayModeTabs({ mode, date }: { mode: EcsTodayMode; date: string }) {
  const base = `/ecs?view=today&date=${date}`;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="micro mr-0.5">모드</span>
      <div className={TOOLBAR_SEG_BOX}>
        <Link href={base} className={chip(mode === "sheet")} aria-current={mode === "sheet" ? "page" : undefined}>
          시트
        </Link>
        <Link
          href={`${base}&mode=cards`}
          className={chip(mode === "cards")}
          aria-current={mode === "cards" ? "page" : undefined}
        >
          요약 카드
        </Link>
      </div>
    </div>
  );
}

/**
 * 출결 모드로 가는 링크(2026-08-20) — 영어 전담 강사의 홈은 ECS라 여기가 그 사람의 입구다.
 *
 * 🔴 **폰엔 사이드바가 없다** — 하부탭(SUBTABS_BY_MENU)에만 두면 영어 강사는 출결 모드로 갈 길이
 *    아예 없다(셔틀 '오늘 등하원'에서 겪은 그대로). 원스크린 상단 바에 있는 것과 **같은 링크**다.
 * ⚠️ 면 전환 칩(보기/모드/날짜)과 달리 **다른 라우트**다. 옛 테두리 버튼(`h-8`·`text-xs`)은 "면 칩과 같은 네이비 채움이면 ECS의
 *    네 번째 면으로 읽힌다"는 이유였는데, 디자인 v5 18단계에서 원스크린 상단 바와 **같은 Primary**로 통일했다 — 한 강사가
 *    오가는 두 화면의 같은 링크는 같은 모양이어야 한다. 면으로 안 읽히는 근거는 채움이 아니라 **자리**다: 면 칩은 세그먼트
 *    묶음 안에 서고 이 버튼은 묶음 밖에 홀로 선다(같은 줄에 네이비 채움이 셋 서는 건 감수).
 */
export function EcsQuickAttendanceLink() {
  return (
    <Button
      render={<Link href="/attendance/quick" title="오늘 내 수업의 출결만 터치로 빠르게 입력합니다" />}
      className="shrink-0"
    >
      출결 모드
    </Button>
  );
}

export type EcsFace = "today" | "week" | "room";

export function EcsFaceTabs({ face, showToday = true }: { face: EcsFace; showToday?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="micro mr-0.5">보기</span>
      <div className={TOOLBAR_SEG_BOX}>
        {showToday ? (
          <Link href="/ecs?view=today" className={chip(face === "today")} aria-current={face === "today" ? "page" : undefined}>
            오늘
          </Link>
        ) : null}
        <Link href="/ecs?view=week" className={chip(face === "week")} aria-current={face === "week" ? "page" : undefined}>
          주간 시트
        </Link>
        <Link
          href="/ecs?view=room"
          className={chip(face === "room")}
          aria-current={face === "room" ? "page" : undefined}
          title="305호 집중자율수업실 — 그 시각 여러 반을 한 표로"
        >
          305 · JJ실
        </Link>
      </div>
    </div>
  );
}

/**
 * 날짜 이동(하루씩) — 앱 전역 단일 소스 [`PeriodNav`](@/components/period-nav)(원장 2026-09-01
 * *"출결 날짜 이동도 바꿔줘"*). 주간 이동과 같은 모양이라 같은 툴바에 나란히 서도 안 어긋난다.
 *
 * 🔴 '오늘' 알약이 하던 **두 일**은 라벨 클릭(오늘로) + 지난/미래 조회 배지로 나뉜다 —
 *    배지를 지우지 말 것(없으면 지난 날을 보면서 오늘로 착각한다).
 * ⚠️ 날짜 **선택**(달력)은 PeriodNav 밖에 그대로 남는다 — 하루씩 이동만으로는 먼 날짜에 못 간다
 *    (◀를 열두 번 누르게 된다, today-date-picker 주석). mode는 이동해도 유지한다.
 */
export function EcsDayNav({
  date,
  today,
  mode,
  view = "today",
}: {
  date: string;
  today: string;
  mode?: EcsTodayMode;
  view?: "today" | "room";
}) {
  const q = view === "room" ? "" : modeQ(mode);
  const base = `/ecs?view=${view}`;
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <PeriodNav
        label={formatKoreanDate(date)}
        prevHref={`${base}&date=${addDays(date, -1)}${q}`}
        nextHref={`${base}&date=${addDays(date, 1)}${q}`}
        currentHref={`${base}${q}`}
        relation={date === today ? "current" : date < today ? "past" : "future"}
        prevAriaLabel="이전 날"
        nextAriaLabel="다음 날"
        currentTitle="눌러서 오늘로"
        labelWidth={DAY_LABEL_W}
      />
      <EcsDatePicker date={date} mode={mode} view={view} />
    </div>
  );
}

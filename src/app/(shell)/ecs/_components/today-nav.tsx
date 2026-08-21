import Link from "next/link";
import { ChevronLeft, ChevronRight } from "@/components/icons/eywa-icon-compat";
import { addDays, formatKoreanDate } from "@/lib/date-kst";
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

/** 필터/토글 칩 공통(문법 ⑦ 알약) — 활성은 WeekNav '이번주'와 같은 foreground 반전. */
const chip = (active: boolean) =>
  `shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium transition ${
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
  }`;

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
      <div className="flex items-center gap-0.5">
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
 * ⚠️ 면 전환 칩(보기/모드/날짜)과 달리 **다른 라우트**라 알약 대신 테두리 버튼으로 구분한다 —
 *    같은 모양이면 "ECS의 네 번째 면"으로 읽힌다.
 */
export function EcsQuickAttendanceLink() {
  return (
    <Link
      href="/attendance/quick"
      title="오늘 내 수업의 출결만 터치로 빠르게 입력합니다"
      className="border-line text-text-dim hover:bg-bg-soft hover:text-foreground shrink-0 rounded-lg border px-2.5 py-1 text-xs font-bold whitespace-nowrap"
    >
      출결 모드
    </Link>
  );
}

export type EcsFace = "today" | "week" | "room";

export function EcsFaceTabs({ face, showToday = true }: { face: EcsFace; showToday?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="micro mr-0.5">보기</span>
      <div className="flex items-center gap-0.5">
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

/** 날짜 이동(하루씩) + '오늘' 복귀 — WeekNav와 같은 배열·같은 아이콘 버튼. mode는 이동해도 유지한다. */
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
  const iconBtn =
    "border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center rounded-full border p-1 transition";
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="micro mr-0.5">날짜</span>
      <div className="flex items-center gap-0.5">
        <Link href={`${base}&date=${addDays(date, -1)}${q}`} aria-label="이전 날" className={iconBtn}>
          <ChevronLeft size={13} strokeWidth={2.5} />
        </Link>
        <Link href={`${base}${q}`} className={chip(date === today)}>
          오늘
        </Link>
        <Link href={`${base}&date=${addDays(date, 1)}${q}`} aria-label="다음 날" className={iconBtn}>
          <ChevronRight size={13} strokeWidth={2.5} />
        </Link>
        <EcsDatePicker date={date} mode={mode} view={view} />
      </div>
      <span className="text-text-dim num text-[11px] whitespace-nowrap">{formatKoreanDate(date)}</span>
      {/* 오늘이 아니면 무슨 날을 보는지 명시 — WeekNav의 '과거/미래 조회' 배지와 같은 규약. */}
      {date !== today ? (
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap ${
            date > today ? "bg-blue-soft text-blue" : "bg-amber-soft text-amber"
          }`}
        >
          {date > today ? "미래 조회" : "지난 날 조회"}
        </span>
      ) : null}
    </div>
  );
}

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
      ? "border-foreground bg-foreground text-background"
      : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
  }`;

export function EcsFaceTabs({ face }: { face: "today" | "week" }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="micro mr-0.5">보기</span>
      <div className="flex items-center gap-0.5">
        <Link href="/ecs?view=today" className={chip(face === "today")} aria-current={face === "today" ? "page" : undefined}>
          오늘
        </Link>
        <Link href="/ecs?view=week" className={chip(face === "week")} aria-current={face === "week" ? "page" : undefined}>
          주간 시트
        </Link>
      </div>
    </div>
  );
}

/** 날짜 이동(하루씩) + '오늘' 복귀 — WeekNav와 같은 배열·같은 아이콘 버튼. */
export function EcsDayNav({ date, today }: { date: string; today: string }) {
  const iconBtn =
    "border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center rounded-full border p-1 transition";
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="micro mr-0.5">날짜</span>
      <div className="flex items-center gap-0.5">
        <Link href={`/ecs?view=today&date=${addDays(date, -1)}`} aria-label="이전 날" className={iconBtn}>
          <ChevronLeft size={13} strokeWidth={2.5} />
        </Link>
        <Link href="/ecs?view=today" className={chip(date === today)}>
          오늘
        </Link>
        <Link href={`/ecs?view=today&date=${addDays(date, 1)}`} aria-label="다음 날" className={iconBtn}>
          <ChevronRight size={13} strokeWidth={2.5} />
        </Link>
        {/* 달력 점프 — 하루씩 이동의 보완(원스크린 top-bar와 같은 showPicker 패턴). */}
        <EcsDatePicker date={date} />
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

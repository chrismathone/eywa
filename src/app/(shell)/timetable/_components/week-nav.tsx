import { addWeeks, thisMonday, weekLabel, weekRelation, compactWeekLabel } from "@/features/timetable/lib/week";
import { WeekPeriodNav } from "./week-period-nav";

/**
 * 시간표·ECS의 **주간 이동(타임머신)** — `‹ 2026년 9월 3주차 (14일~20일) ›` 한 덩어리.
 *
 * 원장 2026-09-01: *"주차이동을 월간처럼 깔끔한 스타일로 바꾸자."* 08-31에 *"웹앱내에서 비슷한 곳은 다
 * 방금 지시한 것으로"*라며 정한 [`PeriodNav`](@/components/period-nav) 모양을 여기까지 끌고 온 것이다.
 * 종전엔 `주 ◀ [이번주] ▶ 라벨`이라 한 줄에 조각이 넷이었고, 같은 일을 하는 월간 네비와 안 닮았다.
 *
 * 🔴 **'이번주' 알약은 사라졌지만 그 두 가지 일은 남는다** — 이번 주로 돌아가기는 **가운데 라벨 클릭**,
 *    "지금 이번 주인가"는 **과거/미래 조회 배지**(PeriodNav 🔴). 배지를 지우지 말 것: 없으면 지난 주
 *    화면을 보면서 이번 주로 착각한다.
 * 라벨은 `weekLabel` / `compactWeekLabel` 단일 소스 — 모바일은 짧은 날짜 범위로 양쪽 화살표를 남긴다.
 * ⚠️ 미저장 이탈 가드·무플래시 이동은 클라 절반([`week-period-nav`](./week-period-nav.tsx))이 맡는다.
 * ⚠️ **트레이드오프**: PeriodNav는 `<a href>`가 아니라 버튼이라 화살표를 Ctrl/가운데 클릭해도 새 탭이
 *    안 열린다(ParamLink는 열렸다). 이 앱에서 다른 주를 따로 띄우는 정식 경로는 사이드바 shift-클릭
 *    창이라 실사용 손실은 없다고 보고 모양의 일관성을 택했다 — 되살릴 땐 PeriodNav 쪽을 고칠 것
 *    (여기만 링크로 되돌리면 월간과 다시 갈린다).
 */
export function WeekNav({
  currentWeek,
  today,
  hrefForWeek,
}: {
  /** 보고 있는 주의 월요일(YYYY-MM-DD). */
  currentWeek: string;
  today: string;
  /** 월요일 → /timetable?... (view·subject 보존). */
  hrefForWeek: (monday: string) => string;
}) {
  return (
    <span data-help="tt-week" className="inline-flex">
    <WeekPeriodNav
      label={weekLabel(currentWeek)}
      mobileLabel={compactWeekLabel(currentWeek)}
      prevHref={hrefForWeek(addWeeks(currentWeek, -1))}
      nextHref={hrefForWeek(addWeeks(currentWeek, 1))}
      currentHref={hrefForWeek(thisMonday(today))}
      relation={weekRelation(currentWeek, today)}
    />
    </span>
  );
}

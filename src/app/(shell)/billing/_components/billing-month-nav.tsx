import { FilterSelect } from "@/components/filter-select";
import { PeriodNav } from "@/components/period-nav";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { currentPeriod } from "@/features/billing/calc";
import { monthLabel, shiftMonth } from "@/lib/date-kst";

/**
 * 수납 면 공용 **월 이동** — 앱 전역 단일 소스 [`PeriodNav`](@/components/period-nav)(원장 2026-08-31 *"웹앱 내 비슷한 곳은
 * 다 이걸로"*) + 월 직접 선택 라벨(`월: 2026년 9월`, 9단계 수납 면과 같은 모양 — 화살표만으론 옛 달까지 여러 번 눌러야 한다).
 *
 * 지출·회차 확정·시수 검증·환불·강사 정산이 저마다 손으로 만든 `◀ 2026년 9월 ▶`(size-8 아이콘 링크·h-8 text-xs 링크·
 * min-w-[90px] 라벨 — 다섯 벌이 서로 달랐다)을 대체한다(디자인 v5 14단계 2026-09-04). 수납 면(`billing-content`)도
 * 같은 부품이다 — 🔴 면마다 `PeriodNav` + `FilterSelect`를 손으로 짝지어 두지 말 것(한쪽만 고쳐진다).
 *
 * 서버 컴포넌트에서 쓴다. 화살표·라벨의 href는 호출부 `hrefFor(period)`가 만든다(면마다 `tab`·필터 파라미터가 다르다).
 * 드롭다운은 `FilterSelect`라 URL의 다른 파라미터는 그대로 두고 `period`만 갈아 끼운다(`page`는 리셋).
 * ⚠️ `defaultPeriod` = 파라미터가 없을 때 그 면이 보여 주는 달(대개 이번 달, 환불은 기록이 있는 가장 최근 달) —
 *    드롭다운의 해제 항목 자리(고르면 파라미터를 지운다). 라벨 클릭은 규약대로 **이번 달**이다.
 */
/** `months`를 못 주는 면의 기본 목록 길이 — 이번 달 포함 12개월. */
const DEFAULT_MONTH_WINDOW = 12;

export function BillingMonthNav({
  period,
  hrefFor,
  months,
  defaultPeriod = currentPeriod(),
  ariaLabel = "월 선택",
}: {
  period: string;
  hrefFor: (period: string) => string;
  /**
   * 월 드롭다운 항목("YYYY-MM") — 기록이 있는 달 목록을 아는 면(지출·환불·수납)은 그걸 넘긴다.
   * 없으면 **이번 달부터 거슬러 12개월**(회차·시수·정산은 달마다 계산하는 면이라 "기록이 있는 달" 목록이 없다 —
   * 그래도 드롭다운은 서야 한다: 화살표만으론 옛 달까지 여러 번 눌러야 한다는 근거가 같다. 적대 리뷰 2026-09-04).
   */
  months?: readonly string[];
  defaultPeriod?: string;
  ariaLabel?: string;
}) {
  const now = currentPeriod();
  const list = months ?? Array.from({ length: DEFAULT_MONTH_WINDOW }, (_, i) => shiftMonth(now, -i));
  const sorted = [...new Set(list)].sort().reverse();
  return (
    <>
      <PeriodNav
        label={monthLabel(period)}
        prevHref={hrefFor(shiftMonth(period, -1))}
        nextHref={hrefFor(shiftMonth(period, 1))}
        currentHref={hrefFor(now)}
        relation={period === now ? "current" : period < now ? "past" : "future"}
        prevAriaLabel="이전 달"
        nextAriaLabel="다음 달"
        currentTitle="눌러서 이번 달로"
        // "2026년 12월"까지 안 넘치는 고정 폭 — 수납·등록상담·ECS 월간과 같은 값.
        labelWidth={116}
      />
      <FilterSelect
        paramName="period"
        value={period}
        // 기본 달은 allValue라 목록 머리에 한 번만 서고, 보고 있는 달이 목록에 없으면(기록 0건·창 밖) 앞에 보강.
        options={[
          ...(sorted.includes(period) || period === defaultPeriod ? [] : [{ value: period, label: monthLabel(period) }]),
          ...sorted.filter((m) => m !== defaultPeriod).map((m) => ({ value: m, label: monthLabel(m) })),
        ]}
        allValue={defaultPeriod}
        allLabel={monthLabel(defaultPeriod)}
        axisLabel="월"
        ariaLabel={ariaLabel}
        cap={200}
        className="w-auto"
        triggerClassName={TOOLBAR_SELECT}
      />
    </>
  );
}

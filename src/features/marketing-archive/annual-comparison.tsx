import { useId } from "react";
import { Button } from "@/components/ui/button";
import { archiveMonth, campaignCost, statuses, type EventRow } from "./model";
import s from "./annual-comparison.module.css";

const months = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));
const planYears = Array.from({ length: 2099 - 2017 + 1 }, (_, index) => 2017 + index);
const periodFor = (year: number, month: string) => `${year}-${month}`;
const yearColor = (year: number) => {
  const colors = ["var(--cat-purple)", "var(--cat-green)", "var(--cat-gold-bright)", "var(--cat-rose)"];
  return colors[((year - 2023) % colors.length + colors.length) % colors.length];
};

type Props = {
  events: EventRow[];
  canWrite: boolean;
  busy: boolean;
  planYear: number;
  month: string;
  onYearChange: (year: number) => void;
  onMonthChange: (month: string) => void;
  onAdd: (period: string, planned: boolean) => void;
  onOpen: (event: EventRow) => void;
  onPlan: (event: EventRow, year: number) => void;
  onDelete: (event: EventRow) => void;
};

export function AnnualComparison({ events, canWrite, busy, planYear, month, onYearChange, onMonthChange, onAdd, onOpen, onPlan, onDelete }: Props) {
  const monthDescriptionId = useId();
  const years = [planYear - 3, planYear - 2, planYear - 1];
  const monthLabel = `${Number(month)}월`;
  const byPeriod = new Map<string, EventRow[]>();
  for (const event of events) {
    const period = archiveMonth(event);
    if (!period) continue;
    const records = byPeriod.get(period) ?? [];
    records.push(event);
    byPeriod.set(period, records);
  }
  const recordsFor = (year: number, key: string) => byPeriod.get(periodFor(year, key)) ?? [];
  const maxCount = Math.max(1, ...years.flatMap(year => months.map(key => recordsFor(year, key).length)));
  const plans = events.filter(event => (event.document.date ?? event.document.period)?.startsWith(periodFor(planYear, month)));
  const ordered = (records: EventRow[]) => [...records].sort((a, b) => (a.document.date ?? "9999").localeCompare(b.document.date ?? "9999"));

  return <>
    <div className={s.heading}>
      <div>
        <h2>3개년 같은 달 행사 비교</h2>
        <p>월을 선택하면 기획 연도 직전 3년의 같은 달 행사를 볼 수 있습니다.</p>
      </div>
      <label className={s.yearSelect}>기획 연도
        <select value={planYear} onChange={event => onYearChange(Number(event.target.value))}>
          {planYears.map(year => <option key={year} value={year}>{year}년</option>)}
        </select>
      </label>
    </div>
    <div className={s.legend} aria-label="비교 연도 범례">
      {years.map(year => <span key={year}><i style={{ background: yearColor(year) }} />{year}년</span>)}
    </div>
    <div className={s.months} role="group" aria-label="비교할 월">
      {months.map(key => {
        const counts = years.map(year => recordsFor(year, key).length);
        const descriptionId = `${monthDescriptionId}-${key}`;
        return <button key={key} type="button" className={s.month} aria-pressed={month === key}
          aria-label={`${Number(key)}월 비교`} aria-describedby={descriptionId}
          onClick={() => onMonthChange(key)}>
          <span aria-hidden="true" className={s.bars}>
            {counts.map((count, index) => <span className={s.barSlot} key={years[index]}>
              <span className={s.barCount}>{count || ""}</span>
              <span className={s.bar} style={{ background: yearColor(years[index]), height: `${count / maxCount * 100}%` }} />
            </span>)}
          </span>
          <strong>{Number(key)}월</strong>
          <span id={descriptionId} hidden>{years.map((year, index) => `${year}년 ${counts[index]}건`).join(", ")}</span>
        </button>;
      })}
    </div>
    <p className={s.note}>예정·취소와 월 단위 기록을 포함한 건수입니다. 날짜 충돌 기록은 히스토리에서 확인할 수 있습니다.</p>
    <div className={s.years}>
      {years.map(year => {
        const records = ordered(recordsFor(year, month));
        return <section className={s.yearCard} key={year} aria-label={`${year}년 ${monthLabel} 행사`}
          style={{ borderColor: `color-mix(in srgb, ${yearColor(year)} 38%, var(--line))` }}>
          <header className={s.yearHeader} style={{ background: `color-mix(in srgb, ${yearColor(year)} 17%, var(--card))` }}>
            <div><h3>{year}년 {monthLabel}</h3><span>{records.length}건</span></div>
            {canWrite && <Button size="sm" variant="outline" disabled={busy}
              aria-label={`${year}년 ${monthLabel} 행사 추가`} onClick={() => onAdd(periodFor(year, month), false)}>+ 행사 추가</Button>}
          </header>
          {records.length === 0 && <p className={s.empty}>이 달에 기록된 행사가 없습니다.</p>}
          {records.map(event => {
            const d = event.document;
            const cost = campaignCost(d);
            return <div key={event.id} className={s.event}>
              <div className={s.eventMeta}><time dateTime={d.date ?? d.period ?? undefined}>{d.date ?? monthLabel}</time><span>{statuses[d.state]}</span></div>
              <button type="button" className={s.eventTitle} onClick={() => onOpen(event)}>{d.title}</button>
              <p>예약 {d.reservations ?? (d.reservationRaw || "미확인")} · 참석 {d.attendees ?? (d.attendanceRaw || "미확인")}</p>
              {cost !== null && <p>비용 {cost.toLocaleString()}원</p>}
              {d.retrospective && <p className={s.feedback}>결과 {d.retrospective}</p>}
              {d.nextAction && <p className={s.feedback}>다음 계획 {d.nextAction}</p>}
              {canWrite && <div className={s.eventActions}>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onPlan(event, planYear)}>이 기록으로 {planYear} 기획</Button>
                <Button size="sm" variant="ghost" disabled={busy} aria-label={`${d.title} 삭제`} onClick={() => onDelete(event)}>삭제</Button>
              </div>}
            </div>;
          })}
        </section>;
      })}
    </div>
    <div className={s.plans}>
      <div className={s.heading}>
        <h3>{planYear}년 {monthLabel} 기획·행사</h3>
        {canWrite && <Button size="sm" disabled={busy} onClick={() => onAdd(periodFor(planYear, month), true)}>+ {monthLabel} 기획 추가</Button>}
      </div>
      {plans.length === 0 && <p>이 달에 작성된 기획·행사가 없습니다.</p>}
      {ordered(plans).map(event => <div key={event.id} className={s.plan}>
        <div><button className={s.eventTitle} type="button" onClick={() => onOpen(event)}>{event.document.title}</button>
          <p>{event.document.date ?? "월 단위"} · {statuses[event.document.state]}</p></div>
        {canWrite && <Button size="sm" variant="ghost" disabled={busy} aria-label={`${event.document.title} 삭제`} onClick={() => onDelete(event)}>삭제</Button>}
      </div>)}
    </div>
  </>;
}

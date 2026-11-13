import { addDays, formatKoreanDate } from "@/lib/date-kst";
import { monthLabel, shiftMonth } from "@/lib/month-grid";
import { PeriodNav } from "@/components/period-nav";
import { buildParentMonth, listParentMonthChanges, summarizeParentMonth } from "@/features/shuttle/parent/parent-month";
import { loadParentMonth } from "@/features/shuttle/parent/server/parent-month-data";
import { loadParentClassDates } from "@/features/classes/server/parent-timetable-data";
import { dayCodeOf } from "@/features/shuttle/roster";
import type { ParentViewer } from "@/features/shuttle/parent/server/parent-viewer";
import { DIRECTION_LABEL } from "@/features/shuttle/types";
import { MonthDaySheet } from "./month-day-sheet";
import { MonthFixedRow } from "./month-fixed-row";
import { MonthGrid } from "./month-grid";
import { MARK, MAX_PICK_DATES } from "./month-marks";

const PATH = "/parent/rides";
/** 미리 바꿀 수 있는 기간(서버 `parentGate`와 같은 62일) — 다음 달 이동의 끝. */
const MAX_AHEAD_DAYS = 62;

const hrefOf = (q: { month: string; kid: string; date?: string }) =>
  `${PATH}?view=month&month=${q.month}&kid=${q.kid}${q.date ? `&dates=${q.date}` : ""}`;

/**
 * 학부모 '월별' — 한 달을 평일 달력으로(사용자 2026-10-01). 날짜를 **고르고 [수정하기]**를 누르면 상세가 아래에서
 * 올라온다(`dates=a,b,…` — 끌어서 여러 날을 함께 고를 수 있다, `month-grid.tsx`). '이번 달 변경' 목록의 줄은 그날 하나를 바로 연다.
 * 🔑 판정은 순수 함수 `parent-month.ts` 한 곳 — 지난 날은 탑승 기록, 앞으로는 바뀐 날만.
 * 🔑 지난달은 **이 아이 기록이 처음 있는 달**까지, 다음 달은 미리 바꿀 수 있는 62일 끝까지.
 */
export async function ParentMonthView({
  viewer,
  today,
  month: rawMonth,
  kid: rawKid,
  dates: rawDates,
  fixed,
}: {
  viewer: ParentViewer;
  today: string;
  month?: string;
  kid?: string;
  /** 고른 날짜들 — "2026-10-06,2026-10-07". */
  dates?: string;
  /** 고정시간을 바꿀 요일(`fixed=wed`). */
  fixed?: string;
}) {
  const kid = viewer.children.find((c) => c.id === rawKid) ?? viewer.children[0];
  if (!kid) {
    return <p className="border-line text-text-dim rounded-2xl border border-dashed p-6 text-center text-sm">연결된 자녀가 없습니다. 학원에 문의해 주세요.</p>;
  }
  const thisMonth = today.slice(0, 7);
  const lastMonth = addDays(today, MAX_AHEAD_DAYS).slice(0, 7);
  const asked = /^\d{4}-\d{2}$/.test(rawMonth ?? "") ? rawMonth! : thisMonth;

  const data = await loadParentMonth(viewer, kid.id, asked);
  const firstMonth = data.earliestMonth && data.earliestMonth < thisMonth ? data.earliestMonth : thisMonth;
  // 범위 밖 주소는 끝으로 당긴다(달은 데이터를 다시 안 읽어도 될 만큼 가벼운 판정만 — 재료는 asked로 읽었다).
  const month = asked < firstMonth ? firstMonth : asked > lastMonth ? lastMonth : asked;
  const monthData = month === asked ? data : await loadParentMonth(viewer, kid.id, month);

  const input = { month, today, ...monthData };
  const weeks = buildParentMonth(input);
  const summary = summarizeParentMonth(weeks);
  const changes = listParentMonthChanges(input, weeks);
  // 고른 날짜 — 이 달 달력에 있는 날만. 둘 이상이면 고칠 수 있는 날만 남긴다(지난 날·쉬는 날은 하나만 볼 수 있다).
  const editableTo = addDays(today, MAX_AHEAD_DAYS);
  const inMonth = new Map(weeks.flat().filter((d) => d.inMonth).map((d) => [d.date, d]));
  // 수업 있는 날(= 등원하는 날)과 그날 수업(과목 · 시각) — 쉬는 날은 뺀다. 실패하면 표시 없이 달력만 그린다.
  const classDates = await loadParentClassDates(
    viewer,
    kid.id,
    [...inMonth.values()].filter((d) => !d.holiday).map((d) => ({ day: dayCodeOf(d.date), ymd: d.date })),
  );
  const canEdit = (d: string) => !inMonth.get(d)?.holiday && d >= today && d <= editableTo;
  const askedDates = [...new Set((rawDates ?? "").split(","))].filter((d) => inMonth.has(d)).sort();
  const selected = (askedDates.length > 1 ? askedDates.filter(canEdit) : askedDates).slice(0, MAX_PICK_DATES);

  return (
    <>
      {viewer.children.length > 1 ? (
        <nav aria-label="자녀 선택" className="flex flex-wrap gap-1.5">
          {viewer.children.map((c) => (
            <a
              key={c.id}
              href={hrefOf({ month, kid: c.id })}
              aria-current={c.id === kid.id ? "true" : undefined}
              className={`rounded-full px-3 py-1 text-sm font-bold ${c.id === kid.id ? "bg-primary text-primary-foreground" : "bg-card text-foreground shadow-[var(--shadow-card)]"}`}
            >
              {c.name}
            </a>
          ))}
        </nav>
      ) : null}

      <div className="flex justify-center">
        <PeriodNav
          label={monthLabel(month)}
          prevHref={hrefOf({ month: shiftMonth(month, -1), kid: kid.id })}
          nextHref={hrefOf({ month: shiftMonth(month, 1), kid: kid.id })}
          currentHref={hrefOf({ month: thisMonth, kid: kid.id })}
          relation={month < thisMonth ? "past" : month > thisMonth ? "future" : "current"}
          prevDisabled={month <= firstMonth}
          nextDisabled={month >= lastMonth}
        />
      </div>

      <MonthFixedRow
        viewer={viewer}
        kid={kid}
        today={today}
        fixed={fixed}
        hrefFor={(d) => `${hrefOf({ month, kid: kid.id })}${d ? `&fixed=${d}` : ""}`}
      />

      <p className="text-text-dim text-center text-xs break-keep">
        {kid.name} · 탄 날 <b className="text-foreground">{summary.rodeDays}</b> · 미탑승 <b className="text-foreground">{summary.missed}</b> · 안 탐{" "}
        <b className="text-foreground">{summary.skipDays}</b> · 결석 <b className="text-foreground">{summary.absentDays}</b> · 변경{" "}
        <b className="text-foreground">{summary.changedDays}</b>
      </p>

      <section className="bg-card rounded-2xl p-1.5 shadow-[var(--shadow-card)]">
        <div className="text-text-dim grid grid-cols-5 pb-1 text-center text-xs font-bold">
          {["월", "화", "수", "목", "금"].map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        {/* key — 달·아이·열린 날짜가 바뀌면 선택 상태를 새로 잡는다. */}
        <MonthGrid
          key={`${month}|${kid.id}|${selected.join(",")}`}
          weeks={weeks}
          today={today}
          editableTo={editableTo}
          baseHref={hrefOf({ month, kid: kid.id })}
          opened={selected}
          classByDate={Object.fromEntries(
            [...(classDates ?? [])].map(([ymd, blocks]) => [
              ymd,
              blocks.map((b) => ({ label: b.subjectLabel || b.className, className: b.className, start: b.start, end: b.end })),
            ]),
          )}
        />
        <p className="text-text-dim mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs">
          {Object.values(MARK).map((m) => (
            <span key={m.label}>
              <b className={m.tone}>{m.glyph}</b> {m.label}
            </span>
          ))}
          <span>
            <b className="bg-green-soft text-green rounded px-1">초록 칸</b> 수업 있는 날(과목 · 시간)
          </span>
          <span>등하원 표시는 앞으로 바뀐 날만 보여요</span>
        </p>
      </section>

      <section className="bg-card rounded-2xl p-4 shadow-[var(--shadow-card)]">
        <h2 className="text-sm font-bold">이번 달 변경</h2>
        {changes.length === 0 ? (
          <p className="text-text-dim mt-1 text-sm">이번 달은 바뀐 날이 없어요.</p>
        ) : (
          <ol className="mt-2 flex flex-col gap-1.5">
            {changes.map((c) => (
              <li key={`${c.date}|${c.direction}|${c.kind}`}>
                <a href={hrefOf({ month, kid: kid.id, date: c.date })} className="flex items-baseline gap-2 text-sm break-keep">
                  <span className="num text-text-dim shrink-0">{formatKoreanDate(c.date).replace(/^\d{4}년 /, "")}</span>
                  <span>
                    {c.kind === "absent"
                      ? "결석"
                      : c.kind === "skip"
                        ? `${DIRECTION_LABEL[c.direction]} 안 탐`
                        : `${DIRECTION_LABEL[c.direction]} · ${c.label ?? "다른 자리"}로 변경`}
                  </span>
                </a>
              </li>
            ))}
          </ol>
        )}
      </section>

      {selected.length > 0 ? (
        <MonthDaySheet
          viewer={viewer}
          kid={kid}
          dates={selected}
          today={today}
          holiday={inMonth.get(selected[0]!)?.holiday ?? null}
          editable={selected.every(canEdit)}
          closeHref={hrefOf({ month, kid: kid.id })}
        />
      ) : null}
    </>
  );
}

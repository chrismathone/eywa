"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { shiftMonth } from "@/lib/date-kst";
import { EyIcon } from "@/components/icons/eywa-icons";
import { PeriodNav } from "@/components/period-nav";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { offGoalCountByDate } from "../lib/goal-match";
import { setMyEcsMonthDisplay, setMyEcsMonthView } from "../server/actions";
import type { EcsMonthDisplay, EcsMonthView } from "../view-prefs";
import type { ClassSheetMonthData } from "../server/month-queries";
import { MonthCalendar } from "./month-calendar";
import { MonthGoalStrip } from "./month-goal-strip";
import { MonthRail } from "./month-rail";
import { useMonthGoals, type GoalRole } from "./use-month-goals";

/**
 * ECS 월간 뷰 껍데기 — **달력 ↔ 진도표 전환**과 표시 토글, 목표 편집 상태를 소유한다.
 *
 * 🔴 전환에 재조회가 없다 — 두 보기는 같은 자료를 다르게 그린 것뿐이라 서버를 다시 부르면
 *    "보기만 바꿨는데 화면이 깜빡"인다. 달 이동만 서버 왕복(`PeriodNav`).
 * ⚠️ 표시 토글은 **보기마다 따로** 기억한다(달력은 둘 다 켠 채, 진도표는 둘 다 끈 채) — 한 벌로 묶으면
 *    한쪽에서 켠 것이 다른 쪽을 망친다(view-prefs `DEFAULT_ECS_MONTH_DISPLAY` 주석).
 * ⚠️ 작성률·경고 수는 **표시 토글과 무관**하다 — 접는 것만으로 숫자가 좋아 보이면 안 된다.
 */
export function MonthClient({
  data,
  classOptions,
  initialView,
  initialDisplay,
}: {
  data: ClassSheetMonthData;
  classOptions: { id: string; name: string }[];
  initialView: EcsMonthView;
  initialDisplay: Record<EcsMonthView, EcsMonthDisplay>;
}) {
  const router = useRouter();
  const [view, setView] = useState<EcsMonthView>(initialView);
  const [display, setDisplay] = useState(initialDisplay);
  const [role, setRole] = useState<GoalRole>("homeroom");
  const { goals, setField, flushAll, savedAt, error, dismissError } = useMonthGoals({
    classId: data.classId,
    periodStart: `${data.month}-01`,
    initial: data.goals,
  });

  // 경고 기준은 **담임 목표** 고정(month-calendar ⚠️ 참조) — 부담임 탭을 봐도 안 흔들린다.
  const warnGoals = goals.homeroom;
  const offByDate = useMemo(() => offGoalCountByDate(data.lines, warnGoals), [data.lines, warnGoals]);
  const offDays = Object.keys(offByDate).length;
  const cur = display[view];

  const hrefFor = (month: string) => `/ecs/${data.classId}/month?month=${month}`;
  const thisMonth = data.today.slice(0, 7);

  const chooseView = (next: EcsMonthView) => {
    if (next === view) return;
    setView(next);
    void setMyEcsMonthView(next);
  };

  const toggle = (key: keyof EcsMonthDisplay) => {
    const next = { ...cur, [key]: !cur[key] };
    setDisplay((d) => ({ ...d, [view]: next }));
    void setMyEcsMonthDisplay(view, next);
  };

  const seg = (key: EcsMonthView | "week", label: string) => {
    const active = key !== "week" && key === view;
    return (
      <button
        key={key}
        type="button"
        aria-pressed={active}
        onClick={() => {
          if (key === "week") {
            // '주간'은 이 화면의 보기가 아니라 **기존 주간 시트로 가는 문**이다(같은 축에 두되 이동한다).
            // 🔴 목표 편집 저장을 **기다린 뒤** 떠난다 — 안 기다리면 방금 친 글자가 언마운트에 쓸려 간다.
            void flushAll().then(() => router.push(`/ecs/${data.classId}`));
            return;
          }
          chooseView(key);
        }}
        className={`cursor-pointer px-4 py-1.5 text-[13.5px] font-bold transition ${
          active ? "bg-primary text-primary-foreground" : "text-text-dim hover:bg-bg-soft"
        }`}
      >
        {label}
      </button>
    );
  };

  const toggleChip = (key: keyof EcsMonthDisplay, label: string, title: string) => (
    <button
      type="button"
      aria-pressed={cur[key]}
      title={title}
      onClick={() => toggle(key)}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] font-bold transition ${
        cur[key] ? "border-primary text-primary bg-primary-soft" : "border-line-strong text-text-dim hover:bg-bg-soft"
      }`}
    >
      {cur[key] ? <EyIcon name="check" size={11} /> : null}
      {label}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <SearchableSelect
          value={data.classId}
          onValueChange={(v) => {
            if (v && v !== data.classId) {
              void flushAll().then(() => router.push(`/ecs/${v}/month?month=${data.month}`));
            }
          }}
          options={classOptions.map((o) => ({ value: o.id, label: o.name }))}
          ariaLabel="반 선택"
          className="min-w-[180px]"
        />
        <PeriodNav
          label={data.monthLabel}
          prevHref={hrefFor(shiftMonth(data.month, -1))}
          nextHref={hrefFor(shiftMonth(data.month, 1))}
          currentHref={hrefFor(thisMonth)}
          relation={data.month === thisMonth ? "current" : data.month < thisMonth ? "past" : "future"}
          prevAriaLabel="이전 달"
          nextAriaLabel="다음 달"
          currentTitle="눌러서 이번 달로"
          minLabelWidth={110}
          onNavigate={(href) => flushAll().then(() => router.push(href))}
        />
        <span
          className="text-text-dim text-[12.5px]"
          title="이 달에 배정된 전 교시 기준입니다 — 아래 표시 토글(자리 교시)을 꺼도 이 숫자는 그대로입니다. 주간 시트의 작성률은 그 주 표시 설정을 따르므로 두 숫자가 다를 수 있습니다."
        >
          계획{" "}
          <b className="text-foreground num">
            {data.fill.filled}/{data.fill.total}
          </b>
          교시 <span className="num">({data.fill.pct}%)</span>
        </span>
        {offDays > 0 ? (
          <span className="text-amber inline-flex items-center gap-1.5 text-[12.5px] font-bold">
            <span className="border-amber bg-amber-soft inline-block size-2 rounded-[2px] border" aria-hidden />
            목표 밖 교재 <span className="num">{offDays}일</span>
          </span>
        ) : null}

        <span className="ml-auto flex flex-wrap items-center gap-2">
          <span className="border-line-strong inline-flex overflow-hidden rounded-lg border [&>button+button]:border-l [&>button+button]:border-[var(--line-strong)]">
            {seg("week", "주간")}
            {seg("cal", "달력")}
            {seg("rail", "진도표")}
          </span>
          {toggleChip("homework", "과제", "계획 줄의 과제까지 보여줍니다")}
          {toggleChip(
            "seat",
            "자리 교시(JJ)",
            "랩실·JJ실 자리 교시 — 반 진도가 아니라 학생 개별 진도입니다. 표시만 바뀌고 작성률은 그대로입니다",
          )}
        </span>
      </div>

      {error ? (
        <p className="border-danger/40 bg-danger-soft text-danger flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold">
          목표를 저장하지 못했습니다 — {error} · 새로고침하면 마지막으로 저장된 값이 보입니다
          <button type="button" onClick={dismissError} className="ml-auto cursor-pointer underline">
            닫기
          </button>
        </p>
      ) : null}

      {view === "cal" ? (
        <>
          <MonthGoalStrip
            monthLabel={data.month}
            skillAreas={data.skillAreas}
            goals={goals}
            role={role}
            onRole={setRole}
            lines={data.lines}
            canEdit={data.canEdit}
            savedAt={savedAt}
            onField={setField}
          />
          <MonthCalendar data={data} goals={warnGoals} display={cur} />
        </>
      ) : (
        <MonthRail
          data={data}
          goals={warnGoals}
          display={cur}
          canEdit={data.canEdit}
          savedAt={savedAt}
          onField={setField}
        />
      )}
    </div>
  );
}

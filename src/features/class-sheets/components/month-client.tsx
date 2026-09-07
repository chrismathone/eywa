"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { shiftMonth } from "@/lib/date-kst";
import { EyIcon } from "@/components/icons/eywa-icons";
import { PeriodNav } from "@/components/period-nav";
import { usePrintWindow } from "@/components/workspace/print-window";
import { offGoalCountByDate } from "../lib/goal-match";
import { setMyEcsMonthDisplay, setMyEcsMonthView } from "../server/actions";
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { sheetMonthLabel } from "@/features/teacher-view/i18n";
import { classNameFor } from "@/features/teacher-view/class-name";
import { SHEET_BAR, sheetFacesFor, sheetPill } from "../chrome";
import { hasClassOnDate, weekForMonth } from "../face-nav";
import { SheetBarDivider, SheetClassPicker, SheetFaceSwitch } from "./sheet-chrome";
import type { EcsMonthDisplay, EcsMonthView } from "../view-prefs";
import type { ClassSheetMonthData } from "../server/month-queries";
import { MonthCalendar } from "./month-calendar";
import { MonthDayEditor } from "./month-day-editor";
import { MonthGoalStrip } from "./month-goal-strip";
import { MonthMemo } from "./month-memo";
import { MonthPlanBar } from "./month-plan-bar";
import { MonthPlanView, type MonthPlanChromeProps } from "./month-plan-view";
import { MonthRail } from "./month-rail";
import { useMonthGoals, type GoalRole } from "./use-month-goals";
import { useMonthPlan } from "./use-month-plan";

/**
 * ECS 월간 뷰 껍데기 — **달력 ↔ 진도표 ↔ 계획(MP) 전환**과 표시 토글, 목표·계획 편집 상태를 소유한다.
 *
 * 🔴 전환에 재조회가 없다 — 세 보기는 같은 자료를 다르게 그린 것뿐이라 서버를 다시 부르면
 *    "보기만 바꿨는데 화면이 깜빡"인다. 달 이동만 서버 왕복(`PeriodNav`).
 * 🔴 **계획(MP)은 EiE 반에만 선다**(원장 2026-09-01) — 탭은 `sheetFacesFor(data.isEie)`가 정하고,
 *    저장·인쇄는 서버가 같은 판정을 한 번 더 한다(#77 — 화면 조건은 게이트가 아니다).
 * ⚠️ 표시 토글은 **보기마다 따로** 기억한다(달력은 둘 다 켠 채, 진도표는 둘 다 끈 채) — 한 벌로 묶으면
 *    한쪽에서 켠 것이 다른 쪽을 망친다(view-prefs `DEFAULT_ECS_MONTH_DISPLAY` 주석).
 * ⚠️ 작성률·경고 수는 **표시 토글과 무관**하다 — 접는 것만으로 숫자가 좋아 보이면 안 된다.
 * 🔴 상단 바는 주간 시트와 **같은 껍데기·같은 왼쪽 덩어리·같은 보기 전환**을 쓴다
 *    ([chrome.ts](../chrome.ts) + [sheet-chrome](./sheet-chrome.tsx), 원장 2026-09-01
 *    *"월간과 주간 차이가 너무 심함 · 일관성있게 디자인 통일"*). 여기에 표기를 다시 적지 말 것.
 */
export function MonthClient({
  data,
  mpChrome,
  classOptions,
  initialView,
  initialDisplay,
  fromWeek,
}: {
  data: ClassSheetMonthData;
  /**
   * 계획(MP) 문서의 껍데기(제목·안내·범례·꼬리말) — **인쇄물과 같은 값**이 서버에서 온다
   * (`getMonthPlanChrome`). EiE가 아니면 null이고, 그 반엔 MP 보기 자체가 없다.
   */
  mpChrome: MonthPlanChromeProps | null;
  classOptions: { id: string; name: string }[];
  initialView: EcsMonthView;
  initialDisplay: Record<EcsMonthView, EcsMonthDisplay>;
  /** 주소가 들고 온 **"왔던 주"** — 주간 시트에서 넘어왔을 때만 있다(없으면 null). */
  fromWeek: string | null;
}) {
  const router = useRouter();
  const [view, setView] = useState<EcsMonthView>(initialView);
  const [display, setDisplay] = useState(initialDisplay);
  const [role, setRole] = useState<GoalRole>("homeroom");
  /**
   * 그 자리에서 고치는 창이 열린 날짜 — 달력은 **칸 클릭**, 진도표는 날짜 열 머리 클릭으로 연다
   * (원장 2026-09-01 *"더블클릭으로 해당날짜 수정가능하게"* → 같은 날 *"클릭 주간 이동은 기능 삭제할것"*
   * 으로 칸에서 다투던 이동이 사라져 **한 번만 눌러도** 열린다).
   */
  const [openDay, setOpenDay] = useState<string | null>(null);
  const { goals, setField, flushAll, savedAt, error, dismissError } = useMonthGoals({
    classId: data.classId,
    periodStart: `${data.month}-01`,
    initial: data.goals,
  });
  /**
   * 계획(MP) 편집 — **EiE 반에만 있는 보기**라 이 훅도 그 반에서만 의미가 있다.
   * ⚠️ 훅은 조건부로 부를 수 없으므로 항상 부르되, EiE가 아니면 서버가 빈 목록을 준다(왕복 0).
   */
  const plan = useMonthPlan({ classId: data.classId, initial: data.mp.cells, holidays: data.holidays });

  // 경고 기준은 **담임 목표** 고정(month-calendar ⚠️ 참조) — 부담임 탭을 봐도 안 흔들린다.
  const warnGoals = goals.homeroom;
  const offByDate = useMemo(() => offGoalCountByDate(data.lines, warnGoals), [data.lines, warnGoals]);
  const offDays = Object.keys(offByDate).length;
  const cur = display[view];

  /**
   * 달 이동·반 전환 링크는 **지금 보고 있는 보기를 함께 들고 간다**(`view=`) — 안 그러면 주간에서
   * '진도표'로 들어와 달을 넘기는 순간 계정에 저장된 옛 보기로 조용히 되돌아간다.
   * ⚠️ 계정 기본값은 이 화면에서 보기를 고를 때만 바뀐다(`setMyEcsMonthView`) — URL은 이번 방문의
   *    요청일 뿐이라 다음에 목록에서 열면 마지막으로 **여기서** 고른 보기로 열린다.
   */
  const hrefFor = (month: string, v: EcsMonthView = view) =>
    `/ecs/${data.classId}/month?month=${month}&view=${v}`;
  const thisMonth = data.today.slice(0, 7);
  /**
   * '주간'으로 갈 때 여는 주 — 규칙과 근거는 [face-nav](../face-nav.ts) 한 곳(순수·Vitest).
   * 🔴 `/ecs/{반}`으로 그냥 보내면 8월을 훑다가 이번 주로 튄다 — 원장이 지운 "칸 클릭 → 그 주" 이동을
   *    상단 전환이 대신하려면 **보고 있던 기간**을 들고 가야 한다.
   */
  const weekMonday = weekForMonth({
    month: data.month,
    today: data.today,
    fromWeek,
    weeks: data.weeks,
    hasClassOn: (d) => hasClassOnDate(data.slotsByDate, d),
  });
  const weekHref = `/ecs/${data.classId}${weekMonday ? `?week=${weekMonday}` : ""}`;

  /**
   * 🔴 편집 큐를 **먼저 비우고** 연다/이동한다 — 화면을 다시 읽을 때(`router.refresh`) 아직 안 나간
   *    글자가 있으면 옛 값으로 되돌아온다. 목표(달력·진도표)와 계획(MP)이 각자 큐를 들고 있어 **둘 다** 기다린다.
   */
  const flushEdits = () => Promise.all([flushAll(), plan.flushAll()]).then(() => undefined);
  const openDayEditor = (date: string) => void flushEdits().then(() => setOpenDay(date));

  const t = useSheetT();
  const tf = useSheetTf();
  const lang = useSheetLang();
  // 반 이름·월 라벨은 화면 언어를 따른다(상단 바·창 제목이 같은 값을 봐야 갈리지 않는다).
  const shownClassName = classNameFor(data.className, lang);
  const shownMonthLabel = sheetMonthLabel(data.month, data.monthLabel, lang);
  const openPrintWindow = usePrintWindow();
  // 창 id는 `print/<type>/<recordId>` 규약 — 반·달마다 다른 창이라 두 달을 나란히 열어 비교할 수 있다.
  const printOpts = {
    id: `print/ecs-mp/${data.classId}-${data.month}`,
    href: `/ecs/${data.classId}/month-plan/print?month=${data.month}`,
    // 창 **제목**(강사가 보는 크롬)이라 언어를 따른다 — 인쇄물 본문은 학부모 서식이라 한국어 그대로다.
    title: tf("month.printDocTitle", { class: shownClassName, month: shownMonthLabel }),
  };

  const chooseView = (next: EcsMonthView) => {
    if (next === view) return;
    setView(next);
    void setMyEcsMonthView(next);
    /**
     * 주소도 따라 고친다 — 안 고치면 새로고침·공유 링크가 방금 고른 보기를 잃는다(주소가 이겨서).
     * 🔴 `router.replace`가 아니라 **`history.replaceState`** 다: 라우터를 태우면 이 화면이 서버를 다시
     *    타고, 그 사이 목표 편집 큐와 열려 있는 창이 흔들린다. 여기선 주소만 맞추면 된다(재조회 불요 —
     *    두 보기는 같은 자료를 다르게 그린 것뿐이다). 주간 시트의 요일 필터와 같은 규약.
     * 🔴 주소를 **새로 짓지 않고 지금 주소를 고친다** — 새로 지으면 `week=`(왔던 주)와 `embed=1`(플로팅
     *    창 표식)이 같이 떨어져 나가서, 보기만 바꿨는데 '주간'이 엉뚱한 주로 가고 창 안에 셸이 되살아난다.
     */
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const toggle = (key: keyof EcsMonthDisplay) => {
    const next = { ...cur, [key]: !cur[key] };
    setDisplay((d) => ({ ...d, [view]: next }));
    void setMyEcsMonthDisplay(view, next);
  };

  /**
   * 🔴 이동은 **편집 저장을 기다린 뒤**(주간 시트가 `store.flush()`를 기다리는 것과 같은 순서) —
   *    안 기다리면 방금 친 글자가 언마운트에 쓸려 간다.
   */
  const navigate = (href: string) => flushEdits().then(() => router.push(href));

  const toggleChip = (key: keyof EcsMonthDisplay, label: string, title: string) => (
    <button
      type="button"
      aria-pressed={cur[key]}
      title={title}
      onClick={() => toggle(key)}
      className={`${sheetPill(cur[key])} inline-flex items-center gap-1.5`}
    >
      {cur[key] ? <EyIcon name="check" size={11} /> : null}
      {label}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-col gap-2.5">
      <div className={SHEET_BAR}>
        {/* 목록 · 반 선택(노란 표기) · 반 정보 보기 — 주간 시트와 **같은 조각**(sheet-chrome.tsx). */}
        <SheetClassPicker
          classId={data.classId}
          classLabel={shownClassName}
          classOptions={classOptions}
          // 담임 이름을 반 표기 안 오른쪽에(원장 2026-09-02 *"ecs도 마찬가지"*) — 주간 시트·MCS와 같은 자리.
          teacherName={data.teacherName}
          onNavigate={navigate}
          // 주간 시트와 같은 규약 — '목록'은 **주간 면**으로 돌아간다. 어느 주로 갈지는 '주간' 전환
          // 버튼과 **같은 판정**(`weekForMonth`)을 재사용한다(두 벌로 적으면 서로 다른 주로 간다).
          listHref={`/ecs?view=week&week=${weekMonday}`}
          hrefForClass={(id) => `/ecs/${id}/month?month=${data.month}&view=${view}`}
        />
        <SheetBarDivider />
        <PeriodNav
          label={shownMonthLabel}
          prevHref={hrefFor(shiftMonth(data.month, -1))}
          nextHref={hrefFor(shiftMonth(data.month, 1))}
          currentHref={hrefFor(thisMonth)}
          relation={data.month === thisMonth ? "current" : data.month < thisMonth ? "past" : "future"}
          prevAriaLabel={t("month.prev")}
          nextAriaLabel={t("month.next")}
          currentTitle={t("month.current")}
          labelWidth={116}
          onNavigate={navigate}
        />
        {/* 주간 | 달력 | 진도표 (+ EiE면 계획(MP)) — 주간 시트와 **같은 칸**, 같은 자리(기간 네비 옆). */}
        <SheetFaceSwitch
          current={view}
          // 🔴 계획(MP)은 EiE 반에만 선다 — 판정은 서버가 준 `isEie`(english_track 컬럼) 하나다.
          faces={sheetFacesFor(data.isEie)}
          onSelect={(face) => {
            // '주간'만 이동이다(별도 라우트) — 나머지는 이 화면 안에서 그리는 방식만 바뀐다.
            if (face === "week") void navigate(weekHref);
            else chooseView(face);
          }}
        />
        <SheetBarDivider />
        {view === "mp" ? (
          /* 계획(MP)은 축이 **날짜**다(달력·진도표의 '교시'가 아니다) — 같은 자리에 다른 단위를 적으면
             두 숫자가 서로를 반박한다. 그래서 이 보기에서는 숫자 줄을 통째로 바꾼다. */
          <MonthPlanBar data={data} cells={plan.cells} />
        ) : (
          <>
            <span
              className="text-text-dim text-[12.5px]"
              title={t("month.fill.title")}
            >
              {t("bulk.plan")}{" "}
              <b className="text-foreground num">
                {data.fill.filled}/{data.fill.total}
              </b>
              {t("month.fill.unit")} <span className="num">({data.fill.pct}%)</span>
            </span>
            {offDays > 0 ? (
              <span className="text-amber inline-flex items-center gap-1.5 text-[12.5px] font-bold">
                <span className="border-amber bg-amber-soft inline-block size-2 rounded-[2px] border" aria-hidden />
                {t("month.offGoal")} <span className="num">{tf("month.days", { n: offDays })}</span>
              </span>
            ) : null}
          </>
        )}

        <span className="ml-auto flex flex-wrap items-center gap-2">
          {view === "mp" ? (
            <>
              {toggleChip(
                "actual",
                t("month.toggle.actual"),
                t("month.toggle.actual.title"),
              )}
              {/* 🔴 인쇄는 **학부모 문서**라 대조·경고·작성률이 실리지 않는다(인쇄 라우트 주석).
                  🔴 여는 창은 **서버에서 다시 읽는다** → 방금 친 글자가 아직 큐에 있으면 옛 내용이
                     인쇄된다. 이동과 같은 순서로 **flush를 먼저** 기다린다. */}
              <button
                type="button"
                onClick={(e) => void flushEdits().then(() => openPrintWindow(printOpts, e))}
                className={`${sheetPill(false)} inline-flex items-center gap-1`}
                title={t("month.print.title")}
              >
                {t("month.print")}
              </button>
            </>
          ) : (
            <>
              {toggleChip("homework", t("plan.col.homework"), t("month.toggle.homework.title"))}
              {toggleChip(
                "seat",
                t("month.toggle.seat"),
                t("month.toggle.seat.title"),
              )}
            </>
          )}
        </span>
      </div>

      {error ? (
        <p className="border-danger/40 bg-danger-soft text-danger flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold">
          {tf("month.error.goal", { error })}
          <button type="button" onClick={dismissError} className="ml-auto cursor-pointer underline">
            {t("popup.close")}
          </button>
        </p>
      ) : null}

      {view === "mp" && plan.error ? (
        <p className="border-danger/40 bg-danger-soft text-danger flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold">
          {tf("month.error.plan", { error: plan.error })}
          <button type="button" onClick={plan.dismissError} className="ml-auto cursor-pointer underline">
            {t("popup.close")}
          </button>
        </p>
      ) : null}
      {/* 🔴 0239a는 원장이 손으로 적용한다 — 적용 전에도 이 화면은 살아야 하고([[#95]]), **원인을
          단정하지 않는다**(표가 없는 것과 조회가 실패한 것은 다른 사실이다). */}
      {view === "mp" && data.mp.status === "missing-table" ? (
        <p className="border-amber/40 bg-amber-soft text-amber rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold">
          {t("month.mp.notReady")}
        </p>
      ) : null}
      {view === "mp" && data.mp.status === "failed" ? (
        <p className="border-danger/40 bg-danger-soft text-danger rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold">
          {t("month.mp.loadFailed")}
        </p>
      ) : null}

      {view === "mp" ? (
        <MonthPlanView
          data={data}
          chrome={mpChrome}
          cells={plan.cells}
          showActual={cur.actual}
          canEdit={data.canEdit && data.mp.status === "ok"}
          onCell={plan.setCell}
          onEbookColumn={(dates, show) => void plan.setEbookColumn(dates, show)}
          onDayOff={(date, off) => void plan.setDayOff(date, off)}
        />
      ) : view === "cal" ? (
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
          {/* 특이사항 메모(0246a) — 원장 2026-09-03 *"메모를 월간계획과 달력 바로 사이에"*.
              🔴 달력 보기에만 선다(진도표·계획은 축이 다르다) — `month-memo.tsx` 머리 각주 참조. */}
          <MonthMemo
            classId={data.classId}
            month={data.month}
            monthLabel={shownMonthLabel}
            initialBody={data.memo.body}
            status={data.memo.status}
            canEdit={data.canEdit}
          />
          <MonthCalendar data={data} goals={warnGoals} display={cur} onOpenDay={openDayEditor} />
        </>
      ) : (
        <MonthRail
          data={data}
          goals={warnGoals}
          display={cur}
          canEdit={data.canEdit}
          savedAt={savedAt}
          onField={setField}
          onOpenDay={openDayEditor}
        />
      )}

      {openDay ? (
        <MonthDayEditor
          // 날짜가 바뀌면 창 안의 계획 상태를 새로 세운다(블록은 마운트당 1회 시드다).
          key={openDay}
          classId={data.classId}
          className={data.className}
          date={openDay}
          slots={data.slotsByDate[openDay] ?? []}
          periodLabelBySlot={data.periodLabelBySlot}
          onClose={() => setOpenDay(null)}
          onSaved={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}

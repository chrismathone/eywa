"use client";

import { shiftMonth } from "@/lib/date-kst";
import { EyIcon } from "@/components/icons/eywa-icons";
import { PeriodNav } from "@/components/period-nav";
import { copyGoalsFromPreviousMonth, setMyMcsFontSize, setMyMcsMonthView } from "../server/actions";
import {
  MCS_FONT_SIZES,
  MCS_FONT_SIZE_LABEL,
  MCS_FONT_SIZE_ZOOM,
  type McsFontSize,
} from "../font-size";
import type { McsMonthView } from "../view-prefs";
import type { MathSheetMonthData } from "../server/month-queries";
import { MonthSheet } from "./month-sheet";
import { MonthTrack } from "./month-track";
import { useStudentGoals } from "./use-student-goals";
import { useState } from "react";

/**
 * MCS 월간 뷰 껍데기 — **진도표 ↔ 진도 레일 전환**과 목표 편집 상태를 소유한다.
 *
 * 🔴 전환에 재조회가 없다 — 두 보기는 같은 자료를 다르게 그린 것뿐이라 서버를 다시 부르면
 *    "보기만 바꿨는데 화면이 깜빡"인다. 달 이동만 서버 왕복(`PeriodNav`).
 * 🔴 달을 옮기기 전에 **밀린 목표 저장을 끝까지 기다린다** — 안 기다리면 방금 친 글자가 언마운트에
 *    쓸려 간다(ECS 월간 뷰에서 적대적 리뷰로 잡은 결함과 같은 자리).
 * ⚠️ 전환 버튼의 모양·자리는 ECS와 **똑같이** 둔다 — 두 시트를 오가는 사람이 다시 배우지 않게.
 */
export function MonthClient({ data }: { data: MathSheetMonthData }) {
  const [view, setView] = useState<McsMonthView>(data.view);
  const [fontSize, setFontSize] = useState<McsFontSize>(data.fontSize);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const { goals, setField, flushAll, savedAt, error, dismissError } = useStudentGoals({
    classId: data.classId,
    month: data.month,
    initial: data.goals,
  });

  const hrefFor = (month: string) => `/mcs/${data.classId}/month?month=${month}`;
  const thisMonth = data.today.slice(0, 7);
  const relation = data.month === thisMonth ? "current" : data.month < thisMonth ? "past" : "future";

  const chooseFont = (next: McsFontSize) => {
    if (next === fontSize) return;
    setFontSize(next);
    void setMyMcsFontSize(next);
  };

  /**
   * 지난 달 목표 가져오기 — **빈 칸만** 채운다(서버가 다시 판정한다).
   * 🔴 화면을 새로 그려야 값이 보이므로 저장 flush 뒤 하드 내비게이션으로 다시 읽는다
   *    (서버 액션 직후의 router.push는 삼켜진다 — [[#102]]).
   */
  const copyPrev = async () => {
    if (copying) return;
    setCopying(true);
    setCopyMsg(null);
    try {
      await flushAll();
      const res = await copyGoalsFromPreviousMonth({
        classId: data.classId,
        month: data.month,
        studentIds: data.students.map((s) => s.studentId),
      });
      if (!res.ok) {
        setCopyMsg(`가져오지 못했습니다: ${res.error}`);
        return;
      }
      if (res.copied === 0) {
        setCopyMsg("가져올 목표가 없습니다(지난 달 목표가 없거나 이미 다 적혀 있습니다).");
        return;
      }
      window.location.reload();
    } catch {
      setCopyMsg("가져오지 못했습니다.");
    } finally {
      setCopying(false);
    }
  };

  const chooseView = (next: McsMonthView) => {
    if (next === view) return;
    setView(next);
    void setMyMcsMonthView(next);
  };

  const seg = (key: McsMonthView, label: string) => (
    <button
      key={key}
      type="button"
      aria-pressed={key === view}
      onClick={() => chooseView(key)}
      // ⚠️ ECS의 [SheetFaceSwitch](@/features/class-sheets/components/sheet-chrome) 칸과 **같은 값**
      //    (2026-09-01 ECS 상단 바 통일 때 함께 맞췄다) — 두 시트를 오가는 사람이 다시 배우지 않게.
      //    MCS는 '주간' 면이 없어 그 컴포넌트를 그대로 쓰진 않는다.
      className={`cursor-pointer px-3.5 py-1 text-[13px] font-bold transition ${
        key === view ? "bg-primary text-primary-foreground" : "text-text-dim hover:bg-bg-soft"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <PeriodNav
          label={data.monthLabel}
          prevHref={hrefFor(shiftMonth(data.month, -1))}
          nextHref={hrefFor(shiftMonth(data.month, 1))}
          currentHref={hrefFor(thisMonth)}
          relation={relation}
          prevAriaLabel="이전 달"
          nextAriaLabel="다음 달"
          currentTitle="눌러서 이번 달로"
          // 저장 flush를 끝낸 뒤 직접 이동한다(가로챈 화면의 책임 — PeriodNav 주석 참조).
          onNavigate={(href) => flushAll().then(() => window.location.assign(href))}
        />
        <div className="border-line-strong inline-flex overflow-hidden rounded-lg border">
          {seg("sheet", "진도표")}
          {/* 구분선 농도도 ECS와 같은 값(line-strong) — 나란히 두면 옅은 쪽이 눈에 띈다. */}
          <span className="bg-line-strong w-px" />
          {seg("track", "진도 레일")}
        </div>
        {data.teacherName ? (
          <span className="bg-primary-soft text-primary rounded-full px-2 py-0.5 text-[11px] font-bold">
            담임 {data.teacherName}
          </span>
        ) : null}
        {view === "sheet" && data.canEdit && data.goalsStatus === "ok" ? (
          <button
            type="button"
            onClick={() => void copyPrev()}
            disabled={copying}
            title="지난 달 목표를 이 달의 빈 칸에만 채웁니다(이미 적은 것은 그대로)"
            className="border-line-strong hover:bg-bg-soft cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-bold disabled:opacity-60"
          >
            {copying ? "가져오는 중…" : "지난 달 목표 가져오기"}
          </button>
        ) : null}
        <span className="flex-1" />
        {/* 글씨 크기 — 원스크린·ECS와 **같은 어휘·같은 배율**(원장이 화면을 오가며 쓴다). */}
        <span className="border-line-strong inline-flex overflow-hidden rounded-lg border">
          {MCS_FONT_SIZES.map((f, i) => (
            <button
              key={f}
              type="button"
              aria-pressed={f === fontSize}
              onClick={() => chooseFont(f)}
              className={`cursor-pointer px-2 py-1 text-[12px] font-bold transition ${
                i > 0 ? "border-line-faint border-l" : ""
              } ${f === fontSize ? "bg-primary text-primary-foreground" : "text-text-dim hover:bg-bg-soft"}`}
            >
              {MCS_FONT_SIZE_LABEL[f]}
            </button>
          ))}
        </span>
        {/* 🔴 아직 한 번도 안 지난 달은 '미작성'이 아니다 — 안 온 수업을 안 적었다고 재촉하지 않는다. */}
        {data.elapsedDays === 0 ? (
          <span className="bg-muted text-text-faint rounded-full px-2 py-0.5 text-[11px] font-bold">
            아직 수업 전
          </span>
        ) : null}
        {data.elapsedDays > 0 && data.fill.unwritten > 0 ? (
          <span className="bg-danger-soft text-danger rounded-full px-2 py-0.5 text-[11px] font-bold">
            미작성 {data.fill.unwritten}칸
          </span>
        ) : null}
        {data.elapsedDays > 0 && data.fill.untracked > 0 ? (
          <span className="bg-muted text-text-faint rounded-full px-2 py-0.5 text-[11px] font-bold">
            흔적 없음 {data.fill.untracked}칸
          </span>
        ) : null}
        {data.elapsedDays > 0 ? (
          <span className="bg-muted text-text-faint num rounded-full px-2 py-0.5 text-[11px] font-bold">
            기록 {data.fill.written} / {data.fill.written + data.fill.unwritten}
          </span>
        ) : null}
        {savedAt ? <span className="text-green text-[11px] font-bold">저장됨</span> : null}
      </div>

      {data.goalsStatus === "missing-table" ? (
        <p className="border-amber bg-amber-soft/40 text-amber rounded-lg border-l-[3px] px-3 py-2 text-xs">
          이 달 목표를 아직 저장할 수 없습니다 — 목표 표(0237a)가 적용되기 전입니다. 진도 · 미작성 · 정체는
          그대로 보입니다.
        </p>
      ) : data.goalsStatus === "failed" ? (
        <p className="border-danger bg-danger-soft/40 text-danger rounded-lg border-l-[3px] px-3 py-2 text-xs">
          이 달 목표를 불러오지 못했습니다. 목표와 어긋난 교재 경고가 이 화면에선 뜨지 않습니다 — 잠시 뒤
          새로고침해 주세요.
        </p>
      ) : null}

      {copyMsg ? (
        <button
          type="button"
          onClick={() => setCopyMsg(null)}
          className="border-line-strong bg-bg-soft text-text-dim cursor-pointer rounded-lg border-l-[3px] px-3 py-2 text-left text-xs"
        >
          {copyMsg} (눌러서 닫기)
        </button>
      ) : null}

      {error ? (
        <button
          type="button"
          onClick={dismissError}
          className="border-danger bg-danger-soft/50 text-danger cursor-pointer rounded-lg border-l-[3px] px-3 py-2 text-left text-xs"
        >
          <EyIcon name="alert" size={12} className="mr-1 inline" />
          목표 저장 실패: {error} — 새로고침하면 마지막으로 저장된 값이 보입니다. (눌러서 닫기)
        </button>
      ) : null}

      <div style={fontSize === "sm" ? undefined : { zoom: MCS_FONT_SIZE_ZOOM[fontSize] }}>
      {view === "sheet" ? (
        <MonthSheet
          data={data}
          goals={goals}
          onGoalChange={setField}
          canEdit={data.canEdit && data.goalsStatus === "ok"}
        />
      ) : (
        <MonthTrack data={data} />
      )}
      </div>
    </div>
  );
}

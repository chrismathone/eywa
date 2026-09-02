"use client";
// 툴바 모양은 ECS 시트와 **같은 상수**를 쓴다 — 두 시트를 오가는 사람이 다시 배우지 않게(앱 전역 툴바 규약).
import { SHEET_BAR, SHEET_SEG_BOX, sheetPill, sheetSegItem } from "@/features/class-sheets/chrome";
// 목록 · 반 선택(노란 표기) · 반 정보 보기 — ECS 주간·월간과 **같은 조각**(원장 2026-09-02 *"영어 ECS처럼
// 수학 MCS에 반정보가 있어야하는데 상단 헤더에 없음"*). 다른 점은 목록이 `/mcs`로 간다는 것뿐이다.
import { SheetBarDivider, SheetClassPicker } from "@/features/class-sheets/components/sheet-chrome";

import { shiftMonth } from "@/lib/date-kst";
import { EyIcon } from "@/components/icons/eywa-icons";
import { PeriodNav } from "@/components/period-nav";
import { copyGoalsFromPreviousMonth, setMyMcsFontSize } from "../server/actions";
import {
  MCS_FONT_SIZES,
  MCS_FONT_SIZE_LABEL,
  MCS_FONT_SIZE_ZOOM,
  type McsFontSize,
} from "../font-size";
import type { MathSheetMonthData } from "../server/month-queries";
import { MonthGrid } from "./month-grid";
import { RAIL_STATUS_LABEL } from "../lib/goal-rail";
import { RAIL_TONE } from "./goal-rail-bar";
import { TONE_SOFT } from "@/lib/design/semantic-color";
import { useStudentGoals } from "./use-student-goals";
import { useState } from "react";

/**
 * MCS 월간 뷰 껍데기 — 상단 바·글씨 크기·목표 편집 상태를 소유한다(표 자체는 month-grid.tsx 하나).
 *
 * 🔴 **보기는 진도표 하나다**(원장 2026-09-02: *"현황표도 제거. 그냥 진도표 하나만 남겨"* · *"느린순 제거"* ·
 *    *"탭 구분 자체를 없애고 진도표 화면만"*) — 같은 날 오전에 만든 진도 레일·목표 레일·현황 표 보기와
 *    '느린 순' 정렬을 전부 걷었다. 레일은 탭이 아니라 고정열의 목표 칸 아래 두 줄이다. **보기 탭을 다시 만들지 말 것.**
 * 🔴 달을 옮기기 전에 **밀린 목표 저장을 끝까지 기다린다** — 안 기다리면 방금 친 글자가 언마운트에
 *    쓸려 간다(ECS 월간 뷰에서 적대적 리뷰로 잡은 결함과 같은 자리).
 */
export function MonthClient({
  data,
  classOptions,
}: {
  data: MathSheetMonthData;
  /** 반 전환 드롭다운 — 서버가 지금 보는 반을 맨 앞에 끼워 준다(`getMathClassOptions` + 페이지). */
  classOptions: { id: string; name: string }[];
}) {
  const [fontSize, setFontSize] = useState<McsFontSize>(data.fontSize);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const { goals, setField, flushAll, savedAt, error, dismissError } = useStudentGoals({
    classId: data.classId,
    month: data.month,
    initial: data.goals,
  });

  const hrefFor = (month: string) => `/mcs/${data.classId}/month?month=${month}`;
  /**
   * 화면을 떠나는 이동은 전부 이 하나를 탄다 — 밀린 목표 저장을 끝낸 뒤 **하드 내비게이션**.
   * (서버 액션 직후의 `router.push`는 삼켜진다 — [[#102]]. 반 전환·달 이동이 같은 순서를 지킨다.)
   */
  const navigate = (href: string) => flushAll().then(() => window.location.assign(href));
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
        // 🔴 **나간 학생은 뺀다** — 회색 줄로 남아 있을 뿐이라 그 사람에게 이 달 목표를 새로 만들어
        //    주면 안 된다. 아직 안 들어온 신입(`upcoming`)은 **넣는다**(그 달에 나갈 진도가 있다).
        studentIds: data.students
          .filter((s) => s.rosterPhase !== "ended")
          .map((s) => s.studentId),
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

  return (
    <div className="flex flex-col gap-3">
      {/* 🔴 `.toolbar-rail`이 아니라 ECS와 같은 SHEET_BAR — 이 줄엔 반 선택 드롭다운(인라인 absolute)이 있어
          레일(좁은 화면·터치에서 overflow-x:auto)이면 목록이 통째로 잘린다(chrome.ts 주석, 적대적 리뷰 2026-09-02). */}
      <div className={SHEET_BAR}>
        <SheetClassPicker
          classId={data.classId}
          classLabel={data.className}
          classOptions={classOptions}
          // 담임은 반 이름 표기(노란 표기) 안 **가장 오른쪽**(원장 2026-09-02 *"담임을 반 옆에 적을것 … 가장 우측정렬"*).
          teacherName={data.teacherName}
          listHref="/mcs"
          onNavigate={navigate}
          // 반을 바꿔도 **보던 달**은 유지한다(ECS 월간과 같은 규약).
          hrefForClass={(id) => `/mcs/${id}/month?month=${data.month}`}
        />
        <SheetBarDivider />
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
          onNavigate={navigate}
        />
        {data.canEdit && data.goalsStatus === "ok" ? (
          <button
            type="button"
            onClick={() => void copyPrev()}
            disabled={copying}
            title="지난 달 목표를 이 달의 빈 칸에만 채웁니다(이미 적은 것은 그대로)"
            className={`${sheetPill(false)} disabled:opacity-60`}
          >
            {copying ? "가져오는 중…" : "지난 달 목표 가져오기"}
          </button>
        ) : null}
        <span className="flex-1" />
        {/* 글씨 크기 — 원스크린·ECS와 **같은 어휘·같은 배율**(원장이 화면을 오가며 쓴다). */}
        <span className={SHEET_SEG_BOX}>
          {MCS_FONT_SIZES.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={f === fontSize}
              onClick={() => chooseFont(f)}
              className={sheetSegItem(f === fontSize)}
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
            입력 없음 {data.fill.untracked}칸
          </span>
        ) : null}
        {/* 🔴 휴일 칸은 어느 수에도 안 들어가므로 **여기서 말하지 않으면 조용히 사라진다** — 그러면
            "이 달 칸이 왜 이렇게 적지"의 답이 화면에 없다. 재촉이 아니라 사유라 무채색이다.
            ⚠️ 휴일에 **쓴** 칸은 여기 없다(그건 `기록`에 들어가 100%로 인정된다 — [[holiday.ts]]). */}
        {data.fill.holiday > 0 ? (
          <span
            className="bg-att-weekend text-text-dim rounded-full px-2 py-0.5 text-[11px] font-bold"
            title="학원 휴일이라 기록 의무가 없는 칸입니다 — 작성률 분모에 들어가지 않습니다(그날 쓴 기록은 그대로 인정됩니다)"
          >
            휴일 {data.fill.holiday}칸
          </span>
        ) : null}
        {data.elapsedDays > 0 ? (
          <span className="bg-muted text-text-faint num rounded-full px-2 py-0.5 text-[11px] font-bold">
            기록 {data.fill.written} / {data.fill.written + data.fill.unwritten}
          </span>
        ) : null}
        {/* 목표 대비 집계 — 학생마다 대표 레일 하나(카드·현황 표와 같은 함수). 0인 상태는 안 적는다. */}
        {data.elapsedDays > 0
          ? (["behind", "on", "ahead", "done", "no-goal"] as const).map((s) =>
              data.railSummary[s] > 0 ? (
                <span
                  key={s}
                  className={`num rounded-full px-2 py-0.5 text-[11px] font-bold ${TONE_SOFT[RAIL_TONE[s]]}`}
                  title="이 달 목표(시작 → 목표 차시)에 견준 현재 위치 — 학생마다 대표 트랙 하나"
                >
                  {RAIL_STATUS_LABEL[s]} {data.railSummary[s]}
                </span>
              ) : null,
            )
          : null}
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
        <MonthGrid
          data={data}
          goals={goals}
          onGoalChange={setField}
          canEdit={data.canEdit && data.goalsStatus === "ok"}
        />
      </div>
    </div>
  );
}

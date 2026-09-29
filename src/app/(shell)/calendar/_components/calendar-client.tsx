"use client";

import { useState, type ReactNode } from "react";
import { ExcelImportButton } from "@/components/excel-import/excel-import-button";
import { EyIcon } from "@/components/icons/aywa-icons";
import { PeriodNav } from "@/components/period-nav";
import { Button } from "@/components/ui/button";
import type { CalendarEvent, CalendarTag } from "@/features/calendar/types";
import { MonthGrid } from "./month-grid";
import { EventDialog, type DialogState } from "./event-dialog";
import { DayListDialog } from "./day-list-dialog";
import { TagManager } from "./tag-manager";

/**
 * 캘린더 클라 껍데기 — 월 툴바(보기 드롭다운 · 월 네비 · 버튼) + 그리드 + 일정 다이얼로그 상태.
 * 데이터는 서버(page)가 내려준 직렬화 배열이라 그리드 통째로 클라여도 무겁지 않다(월 수십 건 규모).
 *
 * 툴바(지시서 §10, 디자인 v5 15단계 2026-09-04): 월 이동은 앱 전역 `PeriodNav`(옛 size-8 화살표 링크 + `오늘` outline 버튼 —
 * 라벨 클릭이 이번 달) · 상시 버튼 = Primary '일정 등록' + 텍스트 '태그 관리'(옛 outline 둘). 보기 드롭다운은 서버(page)가
 * 만든 노드를 같은 줄 맨 앞에 세운다(연간·목록·분석 줄과 같은 자리).
 */
export function CalendarClient({
  viewSelect,
  month,
  monthLabel,
  prevMonth,
  nextMonth,
  isCurrentMonth,
  today,
  events,
  tags,
  canWrite,
  canImport = false,
}: {
  /** `보기: 월` 드롭다운 — 서버가 만든 노드(항목 href에 연도·태그가 실린다). */
  viewSelect: ReactNode;
  month: string;
  monthLabel: string;
  prevMonth: string;
  nextMonth: string;
  isCurrentMonth: boolean;
  today: string;
  events: CalendarEvent[];
  /** 태그 사전(0224a) — 다이얼로그 선택지 + 태그 관리 모달. 비면(마이그 전) 태그 UI가 접힌다. */
  tags: CalendarTag[];
  canWrite: boolean;
  /** 엑셀로 넣기(일정 일괄) — 서버가 올리기 주소와 같은 `canManageTenant`로 정한 값. */
  canImport?: boolean;
}) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  // "+N개 더"로 여는 하루 상세 — 그 날 일정 전건 목록(열람이라 권한 무관).
  const [moreDate, setMoreDate] = useState<string | null>(null);

  function openEvent(e: CalendarEvent) {
    // 휴가 오버레이는 진실이 결재 문서라 캘린더에서 못 고친다 — 누구에게나 읽기 전용.
    setDialog(canWrite && e.source === "manual" ? { mode: "edit", event: e } : { mode: "view", event: e });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* 툴바 한 줄 — 월 이동은 URL(?m=)이라 새로고침·딥링크·창 타이틀이 공짜(PeriodNav가 router.push). */}
      <div className="flex flex-wrap items-center gap-2.5 px-1 py-1">
        {viewSelect}
        <PeriodNav
          label={monthLabel}
          prevHref={`/calendar?m=${prevMonth}`}
          nextHref={`/calendar?m=${nextMonth}`}
          currentHref="/calendar"
          relation={isCurrentMonth ? "current" : month < today.slice(0, 7) ? "past" : "future"}
          prevAriaLabel="이전 달"
          nextAriaLabel="다음 달"
          currentTitle="눌러서 이번 달로"
          // "2026년 12월"까지 안 넘치는 고정 폭 — 수납·등록상담과 같은 값.
          labelWidth={116}
        />
        {canWrite ? (
          <div className="ml-auto flex items-center gap-2">
            {/* 텍스트 Secondary — 상시 버튼은 창당 Primary 1 + 텍스트 1(§10). */}
            <Button variant="ghost" className="text-primary" onClick={() => setTagManagerOpen(true)}>
              태그 관리
            </Button>
            {canImport ? <ExcelImportButton kind="calendar" variant="ghost" label="엑셀로 넣기" /> : null}
            <Button onClick={() => setDialog({ mode: "create", date: isCurrentMonth ? today : `${month}-01` })}>
              <EyIcon name="plus" size={16} />
              일정 등록
            </Button>
          </div>
        ) : null}
      </div>

      {/* 그리드가 남는 세로를 전부 차지 — 셀 min-h는 grid 몫, 여기는 자리만 내준다. */}
      <div className="min-h-0 flex-1">
        <MonthGrid
          month={month}
          today={today}
          events={events}
          onEventClick={openEvent}
          onDayClick={canWrite ? (d) => setDialog({ mode: "create", date: d }) : undefined}
          onMoreClick={setMoreDate}
        />
      </div>

      {moreDate ? (
        <DayListDialog
          date={moreDate}
          events={events}
          canWrite={canWrite}
          onSelect={(e) => {
            setMoreDate(null);
            openEvent(e);
          }}
          onCreate={(d) => {
            setMoreDate(null);
            setDialog({ mode: "create", date: d });
          }}
          onClose={() => setMoreDate(null)}
        />
      ) : null}
      {tagManagerOpen ? <TagManager tags={tags} onClose={() => setTagManagerOpen(false)} /> : null}
      {dialog ? <EventDialog state={dialog} today={today} tags={tags} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

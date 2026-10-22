"use client";

import { SheetText } from "@/features/teacher-view/interface-label";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "@/components/icons/aywa-icon-compat";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { TimelineEvent } from "@/features/students/server/queries";
import { kstDateOf } from "@/lib/date-kst";

const KIND_META: Record<
  TimelineEvent["kind"],
  { label: string; color: string }
> = {
  enrollment_start: { label: "수강 시작", color: "bg-chart-2 text-chart-2" },
  enrollment_end: { label: "수강 종료", color: "bg-chart-4 text-chart-4" },
  enrollment_transfer: { label: "반이동", color: "bg-chart-1 text-chart-1" },
  enrollment_schedule: { label: "등원 요일", color: "bg-chart-2 text-chart-2" },
  enrollment_change: { label: "수강 변경", color: "bg-chart-5 text-chart-5" },
  enrollment_delete: { label: "이력 삭제", color: "bg-chart-4 text-chart-4" },
  consultation: { label: "상담", color: "bg-chart-1 text-chart-1" },
  memo: { label: "특이사항", color: "bg-chart-3 text-chart-3" },
  status_change: { label: "상태 변경", color: "bg-chart-5 text-chart-5" },
  grade: { label: "성적", color: "bg-chart-2 text-chart-2" },
  textbook: { label: "교재", color: "bg-chart-4 text-chart-4" },
  enrollment_consultation: { label: "입학 상담", color: "bg-chart-1 text-chart-1" },
};

function ymOf(date: string): string {
  return date.slice(0, 7); // YYYY-MM
}
function ymLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y}년 ${Number(m)}월`;
}
function recordedLabel(event: TimelineEvent): string | null {
  if (!event.recordedAt || !kstDateOf(event.recordedAt)) return null;
  const time = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(event.recordedAt));
  const date = kstDateOf(event.recordedAt)!;
  return `기록 ${date === event.date ? "" : `${date} `}${time}`;
}

/**
 * 타임라인을 월별로 페이지네이션. 한 학생의 전 이벤트는 이미 서버가 한 번에 가져오므로
 * 서버 라운드트립 없이 클라에서 월(이벤트 있는 달만, 최신순)을 ◀▶로 넘긴다 — 1열로 길게
 * 늘어지던 문제 해소. 정렬은 쿼리에서 date desc.
 */
export function TimelineView({ events }: { events: TimelineEvent[] }) {
  const [enrollmentOnly, setEnrollmentOnly] = useState(false);
  // 이벤트가 있는 달만 그룹화(최신순). 빈 달은 건너뛰어 매 페이지에 내용이 있게.
  const months = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>();
    for (const e of events) {
      if (enrollmentOnly && (!e.kind.startsWith("enrollment_") || e.kind === "enrollment_consultation")) continue;
      const ym = ymOf(e.date);
      const arr = map.get(ym) ?? [];
      arr.push(e);
      map.set(ym, arr);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [events, enrollmentOnly]);

  const [idx, setIdx] = useState(0);
  const safeIdx = Math.min(idx, Math.max(0, months.length - 1));

  if (events.length === 0) {
    return (
      <div className="space-y-4">
        <header className="border-border flex items-baseline justify-between border-b pb-3">
          <h2 className="text-foreground text-base font-bold"><SheetText value={"타임라인"} /></h2>
        </header>
        <p className="text-muted-foreground py-8 text-center text-sm"><SheetText value={"이벤트가 없습니다"} /></p>
      </div>
    );
  }

  const [ym, monthEvents] = months[safeIdx] ?? ["", []];

  return (
    <div className="space-y-4">
      <header className="border-border flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-foreground text-base font-bold"><SheetText value={"타임라인"} /></h2>
          <span className="text-muted-foreground num text-xs">
            {months.length ? safeIdx + 1 : 0}/{months.length}<SheetText value={"개월 · 총 "} />{months.reduce((n, [, rows]) => n + rows.length, 0)}<SheetText value={"건"} /></span>
        </div>
        {/* 월 네비 — idx 0 = 최신. ◀ 이전(과거)=idx+1, ▶ 다음(최신)=idx-1.
            가운데 라벨은 SearchableSelect로 어느 달이든 바로 점프(전역 드롭다운 규약). */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setIdx(safeIdx + 1)}
            disabled={safeIdx >= months.length - 1}
            className="hover:bg-bg-soft rounded p-1 disabled:pointer-events-none disabled:opacity-30"
            aria-label="이전 달"
          >
            <ChevronLeft className="size-4" />
          </button>
          <SearchableSelect
            // w-52(208px): 라벨 자리 162px ≥ `2026년 9월 · 12건` ≈150px(18px 글자) — 2026-09-08 v5 글자 기준 실측. w-40은 `· N건`이 잘렸고 w-48은 두 자리 건수에서 다시 모자란다.
            className="w-52"
            triggerClassName={TOOLBAR_SELECT}
            ariaLabel="월 선택"
            value={String(safeIdx)}
            onValueChange={(v) => setIdx(Number(v))}
            options={months.map(([m, evs], i) => ({
              value: String(i),
              label: `${ymLabel(m)} · ${evs.length}건`,
            }))}
          />
          <button
            type="button"
            onClick={() => setIdx(safeIdx - 1)}
            disabled={safeIdx <= 0}
            className="hover:bg-bg-soft rounded p-1 disabled:pointer-events-none disabled:opacity-30"
            aria-label="다음 달"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </header>

      {/* 기록 종류 — 전체 / 수강 변화만. 치수는 툴바 부품이 정한다(손으로 적지 않는다). */}
      <div role="group" aria-label="타임라인 기록 종류">
        <ToolbarSegment>
          {[{ label: "전체 기록", only: false }, { label: "수강 이력", only: true }].map(({ label, only }) => (
            <ToolbarSegmentItem key={label} active={enrollmentOnly === only} onClick={() => { setEnrollmentOnly(only); setIdx(0); }}>
              <SheetText value={label} />
            </ToolbarSegmentItem>
          ))}
        </ToolbarSegment>
      </div>

      {monthEvents.length === 0 ? <p className="text-muted-foreground py-8 text-center text-sm"><SheetText value={"수강 이력이 없습니다"} /></p> : (

      <ol className="border-border bg-card relative space-y-3 rounded-2xl border p-4 pl-8">
        {/* 타임라인 세로선 */}
        <span aria-hidden className="bg-border absolute top-4 bottom-4 left-[18px] w-px" />
        {monthEvents.map((e, i) => {
          const meta = KIND_META[e.kind];
          const recorded = recordedLabel(e);
          return (
            <li key={e.id ?? `${ym}-${i}`} className="relative">
              <span
                aria-hidden
                className={`absolute top-[6px] left-[-22px] inline-block size-2 rounded-full ${meta.color.split(" ")[0]}`}
              />
              {/* 적용일 · 변경 처리 시각 · 종류 · 등록자/처리자 */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="num text-muted-foreground text-xs">{e.date}</span>
                {recorded ? <span className="num text-text-faint text-xs">{recorded}</span> : null}
                <span
                  className={`bg-bg-soft/40 border-border inline-flex items-center rounded-full border px-1.5 py-0.5 text-xs font-medium ${
                    meta.color.split(" ")[1]
                  }`}
                >
                  {meta.label}
                </span>
                {e.registrant ? (
                  <span className="text-text-faint text-xs">· {e.registrant}</span>
                ) : null}
              </div>
              {/* 제목(굵게) — 본문과 위계 분리 */}
              <p className="text-foreground mt-1 text-sm font-bold break-keep">{e.title}</p>
              {/* 본문(흐리게) — 줄바꿈 보존 + 한글 어절 단위 */}
              {e.description ? (
                <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed break-keep whitespace-pre-line">
                  {e.description}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
      )}
    </div>
  );
}

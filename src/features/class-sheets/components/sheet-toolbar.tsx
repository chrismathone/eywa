"use client";

// ECS 툴바 — 주 네비(flush 후 이동)·반 전환·요일 알약·패널 토글·저장 인디케이터·동시편집 배지.
// WeekNav(ParamLink)를 안 쓰는 이유: 이동 전 store.flush()를 await해야 해서(§F) 버튼+onNavigate로 처리.
import { ChevronLeft, ChevronRight } from "@/components/icons/eywa-icon-compat";
import { addWeeks, thisMonday } from "@/features/timetable/lib/week";
import { EditingBadge } from "@/features/presence/editing-badge";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { ClassSheetWeekData } from "../server/queries";
import { useSaveIndicator, type SheetSaveStore } from "./use-sheet-saves";

const DOW_KO: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };
const iconBtn =
  "border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center rounded-full border p-1 transition";
const pill = (on: boolean) =>
  `shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium transition ${
    on ? "border-foreground bg-foreground text-background" : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
  }`;

export function SheetToolbar({
  data,
  classOptions,
  store,
  dayFilter,
  onDayFilter,
  panelOpen,
  onTogglePanel,
  onNavigate,
}: {
  data: ClassSheetWeekData;
  classOptions: { id: string; name: string }[];
  store: SheetSaveStore;
  dayFilter: string | null;
  onDayFilter: (day: string | null) => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
  onNavigate: (href: string) => void;
}) {
  const { pending, conflicts } = useSaveIndicator(store);
  const hrefFor = (classId: string, monday: string) => `/ecs/${classId}?week=${monday}`;
  const rel = data.weekRelation;

  return (
    <div className="bg-card shadow-card flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl px-4 py-2.5">
      <button type="button" className={pill(false)} onClick={() => onNavigate("/ecs")}>
        목록
      </button>
      <span className="w-[220px] shrink-0">
        <SearchableSelect
          options={classOptions.map((c) => ({ value: c.id, label: c.name }))}
          value={data.classId}
          onValueChange={(v) => {
            if (v && v !== data.classId) onNavigate(hrefFor(v, data.weekMonday));
          }}
          placeholder="반 선택"
          ariaLabel="반 전환"
        />
      </span>
      <span className="bg-line h-4 w-px" aria-hidden />

      <div className="flex items-center gap-0.5">
        <button
          type="button"
          className={iconBtn}
          aria-label="이전 주"
          onClick={() => onNavigate(hrefFor(data.classId, addWeeks(data.weekMonday, -1)))}
        >
          <ChevronLeft size={13} strokeWidth={2.5} />
        </button>
        <button
          type="button"
          className={pill(rel === "current")}
          onClick={() => onNavigate(hrefFor(data.classId, thisMonday(data.today)))}
        >
          이번주
        </button>
        <button
          type="button"
          className={iconBtn}
          aria-label="다음 주"
          onClick={() => onNavigate(hrefFor(data.classId, addWeeks(data.weekMonday, 1)))}
        >
          <ChevronRight size={13} strokeWidth={2.5} />
        </button>
      </div>
      <span className="text-foreground text-[13px] font-bold whitespace-nowrap">{data.weekLabel}</span>
      {rel !== "current" ? (
        <span className="border-line text-text-dim rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap">
          {rel === "past" ? "지난 주 조회" : "다음 주 조회"}
        </span>
      ) : null}
      <span className="bg-line h-4 w-px" aria-hidden />

      <span className="micro">요일</span>
      <div className="flex items-center gap-1">
        <button type="button" className={pill(dayFilter === null)} onClick={() => onDayFilter(null)}>
          전체
        </button>
        {data.grid.days.map((d) => (
          <button
            key={d.date}
            type="button"
            className={pill(dayFilter === d.date)}
            onClick={() => onDayFilter(dayFilter === d.date ? null : d.date)}
          >
            {DOW_KO[d.dow]}
            {d.date === data.today ? <span className="ml-0.5 align-middle text-[8px]">●</span> : null}
          </button>
        ))}
      </div>

      <span className="ml-auto flex items-center gap-2">
        <EditingBadge scope={`ecs:${data.classId}:${data.weekMonday}`} />
        {conflicts > 0 ? (
          <span className="text-danger text-[12px] font-bold whitespace-nowrap">충돌 {conflicts}건 — 셀에서 선택</span>
        ) : pending > 0 ? (
          <span className="text-text-dim text-[12px] whitespace-nowrap">저장 중…</span>
        ) : (
          <span className="text-text-faint text-[12px] whitespace-nowrap">저장됨</span>
        )}
        <button type="button" className={pill(panelOpen)} onClick={onTogglePanel}>
          계획 패널
        </button>
      </span>
    </div>
  );
}

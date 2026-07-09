"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays, List } from "lucide-react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { StudentAttendanceFull } from "@/features/students/server/queries";

const STATUS_LABEL: Record<string, string> = {
  present: "출석",
  absent: "결석",
  late: "지각",
  early_leave: "조퇴",
  makeup: "보강",
};
const STATUS_COLOR: Record<string, string> = {
  present: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  absent: "bg-chart-4/15 text-chart-4 border-chart-4/30",
  late: "bg-chart-3/15 text-chart-3 border-chart-3/30",
  early_leave: "bg-chart-5/15 text-chart-5 border-chart-5/30",
  makeup: "bg-chart-1/15 text-chart-1 border-chart-1/30",
};
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function ymOf(date: string): string {
  return date.slice(0, 7); // YYYY-MM
}

export function AttendanceView({
  records,
  classes,
}: {
  records: StudentAttendanceFull[];
  classes: { value: string; label: string }[];
}) {
  // 기본 월 = 가장 최근 기록의 월(없으면 올해 1월 회피 위해 첫 기록). 기록 없으면 현재월은 클라 effect 없이 첫 기록 기준.
  const defaultYm = records[0]?.date ? ymOf(records[0].date) : "";
  const [ym, setYm] = useState(defaultYm);
  const [classId, setClassId] = useState("all");
  const [view, setView] = useState<"calendar" | "list">("calendar");

  // 반 필터 적용 후 월 필터
  const classFiltered = useMemo(
    () => (classId === "all" ? records : records.filter((r) => r.classId === classId)),
    [records, classId],
  );
  const monthRecords = useMemo(
    () => (ym ? classFiltered.filter((r) => ymOf(r.date) === ym) : classFiltered),
    [classFiltered, ym],
  );

  // 통계(현재 월·반 필터 기준)
  const stats = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, early_leave: 0, makeup: 0 };
    for (const r of monthRecords) if (r.status in c) c[r.status as keyof typeof c]++;
    const total = monthRecords.length;
    const rate = total > 0 ? Math.round(((c.present + c.late + c.makeup) / total) * 1000) / 10 : 0;
    return { ...c, total, rate };
  }, [monthRecords]);

  const navMonth = (delta: number) => {
    if (!ym) return;
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setYm(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const [yy, mm] = ym ? ym.split("-").map(Number) : [0, 0];

  return (
    <div className="space-y-4">
      {/* 헤더: 뷰 토글 · 월 네비 · 반 필터 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <div className="flex items-center gap-1.5">
          <CalendarDays className="text-primary size-4" />
          <h2 className="text-foreground text-sm font-semibold">출결 현황</h2>
        </div>
        {/* 뷰 토글 */}
        <div className="border-line flex items-center gap-0.5 rounded-md border p-0.5">
          <ViewBtn active={view === "calendar"} onClick={() => setView("calendar")} icon={<CalendarDays className="size-3.5" />}>
            달력
          </ViewBtn>
          <ViewBtn active={view === "list"} onClick={() => setView("list")} icon={<List className="size-3.5" />}>
            리스트
          </ViewBtn>
        </div>
        {classes.length > 0 ? (
          <SearchableSelect
            className="w-40"
            value={classId}
            onValueChange={setClassId}
            options={[{ value: "all", label: "전체 수업" }, ...classes]}
            ariaLabel="수업 필터"
          />
        ) : null}
        {/* 월 네비 */}
        {ym ? (
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => navMonth(-1)} className="hover:bg-bg-soft rounded p-1" aria-label="이전 달">
              <ChevronLeft className="size-4" />
            </button>
            <span className="num text-foreground min-w-[5.5rem] text-center text-sm font-medium">
              {yy}년 {mm}월
            </span>
            <button type="button" onClick={() => navMonth(1)} className="hover:bg-bg-soft rounded p-1" aria-label="다음 달">
              <ChevronRight className="size-4" />
            </button>
          </div>
        ) : null}
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="출석률" value={`${stats.rate}%`} highlight="text-chart-2" />
        <Card label="출석" value={String(stats.present)} unit="건" />
        <Card label="결석" value={String(stats.absent)} unit="건" highlight="text-chart-4" />
        <Card label="지각" value={String(stats.late)} unit="건" highlight="text-chart-3" />
      </div>

      {records.length === 0 ? (
        <p className="text-muted-foreground py-10 text-center text-sm">출결 기록이 없습니다</p>
      ) : view === "calendar" ? (
        <MonthCalendar year={yy} month={mm} records={monthRecords} />
      ) : (
        <AttendanceList records={monthRecords} />
      )}

      {/* 범례 */}
      <div className="text-text-dim flex flex-wrap gap-2 text-[11px]">
        {Object.entries(STATUS_LABEL).map(([k, label]) => (
          <span key={k} className={`rounded-sm border px-1.5 py-0.5 ${STATUS_COLOR[k]}`}>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function MonthCalendar({ year, month, records }: { year: number; month: number; records: StudentAttendanceFull[] }) {
  const byDay = useMemo(() => {
    const m = new Map<number, StudentAttendanceFull[]>();
    for (const r of records) {
      const d = Number(r.date.slice(8, 10));
      const list = m.get(d) ?? [];
      list.push(r);
      m.set(d, list);
    }
    return m;
  }, [records]);

  if (!year) return null;
  const firstDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="bg-card border-line overflow-hidden rounded-md border">
      <div className="border-line grid grid-cols-7 border-b">
        {WEEKDAYS.map((w, i) => (
          <div
            key={w}
            className={`py-2 text-center text-xs font-medium ${i === 0 ? "text-danger" : i === 6 ? "text-blue" : "text-text-dim"}`}
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d, i) => (
          <div key={i} className="border-line min-h-[64px] border-r border-b p-1 last:border-r-0">
            {d ? (
              <>
                <div className={`num text-[11px] ${i % 7 === 0 ? "text-danger" : i % 7 === 6 ? "text-blue" : "text-text-dim"}`}>
                  {d}
                </div>
                <div className="mt-0.5 flex flex-col gap-0.5">
                  {(byDay.get(d) ?? []).slice(0, 3).map((r, j) => (
                    <span
                      key={j}
                      title={`${STATUS_LABEL[r.status] ?? r.status} · ${r.className}${r.note ? ` · ${r.note}` : ""}`}
                      className={`truncate rounded-sm border px-1 py-0.5 text-[10px] font-medium ${STATUS_COLOR[r.status] ?? ""}`}
                    >
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  ))}
                  {(byDay.get(d)?.length ?? 0) > 3 ? (
                    <span className="text-text-faint text-[10px]">+{byDay.get(d)!.length - 3}</span>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function AttendanceList({ records }: { records: StudentAttendanceFull[] }) {
  const byDate = useMemo(() => {
    const m = new Map<string, StudentAttendanceFull[]>();
    for (const r of records) {
      const list = m.get(r.date) ?? [];
      list.push(r);
      m.set(r.date, list);
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [records]);

  if (byDate.length === 0)
    return <p className="text-muted-foreground py-8 text-center text-sm">이 달의 출결 기록이 없습니다</p>;

  return (
    <ul className="bg-card border-line divide-line divide-y rounded-md border">
      {byDate.map(([date, rows]) => (
        <li key={date} className="flex items-center gap-3 px-4 py-2">
          <span className="num text-text-dim w-24 text-xs">{date}</span>
          <div className="flex flex-1 flex-wrap gap-1.5">
            {rows.map((r, i) => (
              <span
                key={i}
                title={r.note ?? undefined}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${STATUS_COLOR[r.status] ?? ""}`}
              >
                <span>{STATUS_LABEL[r.status] ?? r.status}</span>
                <span className="opacity-60">·</span>
                <span className="opacity-80">{r.className}</span>
              </span>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

function ViewBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition ${
        active ? "bg-primary text-primary-foreground font-medium" : "text-text-dim hover:bg-bg-soft"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function Card({ label, value, unit, highlight }: { label: string; value: string; unit?: string; highlight?: string }) {
  return (
    <div className="bg-card border-line rounded-md border p-3">
      <p className="eyebrow">{label}</p>
      <p className={`num text-foreground mt-1 text-xl font-semibold ${highlight ?? ""}`}>
        {value}
        {unit ? <span className="text-muted-foreground ml-0.5 text-xs font-normal">{unit}</span> : null}
      </p>
    </div>
  );
}

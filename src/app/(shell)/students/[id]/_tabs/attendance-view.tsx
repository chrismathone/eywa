"use client";
import {
  TOOLBAR_SEG_BOX,
  TOOLBAR_SEG_ITEM,
  TOOLBAR_SEG_OFF,
  TOOLBAR_SEG_ON_PRIMARY,
  TOOLBAR_SELECT,
} from "@/components/toolbar-controls";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays, List } from "@/components/icons/eywa-icon-compat";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useSubjectMaps } from "@/features/owner/operations-context";
import type { StudentAttendanceFull } from "@/features/students/server/queries";
import {
  ATTENDANCE_STATUS_ORDER,
  attendanceStatusColor,
  attendanceStatusLabel,
  classesForSubject,
  computeAttendanceStats,
  effectiveClassFilter,
  filterAttendanceRecords,
  subjectFilterOptions,
  ymOf,
  type AttendanceClassOption,
} from "@/features/students/attendance-tab";
import { AttendanceList, MonthCalendar } from "./attendance-panels";

export function AttendanceView({
  records,
  classes,
}: {
  records: StudentAttendanceFull[];
  classes: AttendanceClassOption[];
}) {
  const subjects = useSubjectMaps();
  const defaultYm = records[0]?.date ? ymOf(records[0].date) : "";
  const [ym, setYm] = useState(defaultYm);
  const [subject, setSubject] = useState("all");
  const [classId, setClassId] = useState("all");
  const [view, setView] = useState<"calendar" | "list">("calendar");

  const subjectOptions = useMemo(
    () => subjectFilterOptions(classes.map((c) => c.subject), subjects.labelOf),
    [classes, subjects],
  );
  const classOptions = useMemo(() => classesForSubject(classes, subject), [classes, subject]);
  const activeClassId = effectiveClassFilter(classId, classOptions);

  const monthRecords = useMemo(
    () => filterAttendanceRecords(records, { subject, classId: activeClassId, ym }),
    [records, subject, activeClassId, ym],
  );
  const stats = useMemo(() => computeAttendanceStats(monthRecords), [monthRecords]);

  const navMonth = (delta: number) => {
    if (!ym) return;
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setYm(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const [yy, mm] = ym ? ym.split("-").map(Number) : [0, 0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <div className="flex items-center gap-1.5">
          <CalendarDays className="text-primary size-4" />
          <h2 className="text-foreground text-sm font-bold">출결 현황</h2>
        </div>
        <div className={TOOLBAR_SEG_BOX}>
          <ViewBtn active={view === "calendar"} onClick={() => setView("calendar")} icon={<CalendarDays className="size-3.5" />}>
            달력
          </ViewBtn>
          <ViewBtn active={view === "list"} onClick={() => setView("list")} icon={<List className="size-3.5" />}>
            리스트
          </ViewBtn>
        </div>
        {subjectOptions.length > 1 ? (
          <SearchableSelect
            className="w-36"
            triggerClassName={TOOLBAR_SELECT}
            value={subject}
            onValueChange={(v) => {
              setSubject(v);
              setClassId("all");
            }}
            options={subjectOptions}
            ariaLabel="과목 필터"
          />
        ) : null}
        {classOptions.length > 0 ? (
          <SearchableSelect
            className="w-40"
            triggerClassName={TOOLBAR_SELECT}
            value={activeClassId}
            onValueChange={setClassId}
            options={[{ value: "all", label: "전체 수업" }, ...classOptions]}
            ariaLabel="수업 필터"
          />
        ) : null}
        {ym ? (
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => navMonth(-1)}
              className="hover:bg-bg-soft inline-flex h-8 w-8 items-center justify-center rounded-md"
              aria-label="이전 달"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="num text-foreground min-w-[5.5rem] text-center text-sm font-medium">
              {yy}년 {mm}월
            </span>
            <button
              type="button"
              onClick={() => navMonth(1)}
              className="hover:bg-bg-soft inline-flex h-8 w-8 items-center justify-center rounded-md"
              aria-label="다음 달"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Card label="출석률" value={`${stats.rate}%`} highlight="text-chart-2" />
        <Card label="출석" value={String(stats.present)} unit="건" />
        <Card label="결석" value={String(stats.absent)} unit="건" highlight="text-chart-4" />
        <Card label="지각" value={String(stats.late)} unit="건" highlight="text-chart-3" />
        <Card label="병결" value={String(stats.excused)} unit="건" highlight="text-blue" />
      </div>

      {records.length === 0 ? (
        <p className="text-muted-foreground py-10 text-center text-sm">출결 기록이 없습니다</p>
      ) : view === "calendar" ? (
        <MonthCalendar year={yy} month={mm} records={monthRecords} />
      ) : (
        <AttendanceList records={monthRecords} />
      )}

      <div className="text-text-dim flex flex-wrap gap-2 text-[11px]">
        {ATTENDANCE_STATUS_ORDER.map((k) => (
          <span key={k} className={`rounded-full border px-1.5 py-0.5 ${attendanceStatusColor(k)}`}>
            {attendanceStatusLabel(k)}
          </span>
        ))}
      </div>
    </div>
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
      className={`${TOOLBAR_SEG_ITEM} inline-flex items-center gap-1 ${
        active ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function Card({ label, value, unit, highlight }: { label: string; value: string; unit?: string; highlight?: string }) {
  return (
    <div className="bg-card border-line rounded-2xl border p-3">
      <p className="eyebrow">{label}</p>
      <p className={`num text-foreground mt-1 text-xl font-bold ${highlight ?? ""}`}>
        {value}
        {unit ? <span className="text-muted-foreground ml-0.5 text-xs font-normal">{unit}</span> : null}
      </p>
    </div>
  );
}

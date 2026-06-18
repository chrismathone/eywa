import Link from "next/link";
import { CalendarX, Clock, UserCheck, Users, UserX, type LucideIcon } from "lucide-react";
import { Pill } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { FilterSelect } from "@/components/filter-select";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getMonthlyAttendanceMatrix,
  type AttendanceMatrix,
  type AttendanceStatus,
} from "@/features/attendance/server/queries";
import { AttendanceCell } from "./_components/attendance-cell";

export const metadata = { title: "출석부 — eywa" };

type RangeKey = "month" | "2w";

function attHref(p: {
  classId: string | null;
  month: string;
  range: RangeKey;
  teacherId?: string | null;
}): string {
  const sp = new URLSearchParams();
  if (p.classId) sp.set("class", p.classId);
  if (p.teacherId) sp.set("teacher", p.teacherId);
  sp.set("month", p.month);
  if (p.range === "2w") sp.set("range", "2w");
  return `/attendance?${sp.toString()}`;
}

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y!, m! - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonth(month: string): string {
  const [y, m] = month.split("-");
  return `${y}년 ${Number(m)}월`;
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string; month?: string; range?: string; teacher?: string }>;
}) {
  await requireAccess("attendance");
  const {
    class: classParam,
    month: monthParam,
    range: rangeParam,
    teacher: teacherParam,
  } = await searchParams;
  const month = monthParam ?? currentMonthKey();
  const range: RangeKey = rangeParam === "2w" ? "2w" : "month";

  // 전체 반 목록은 어떤 classId로 불러도 동일 — 강사 필터로 좁힌다.
  const initial = await getMonthlyAttendanceMatrix(month, classParam ?? null);
  const allClasses = initial.classes;
  // 강사 드롭다운(담임 배정된 반에서 distinct)
  const teacherOptions = Array.from(
    new Map(
      allClasses
        .filter((c) => c.teacherId && c.teacherName)
        .map((c) => [c.teacherId as string, c.teacherName as string]),
    ),
  ).map(([value, label]) => ({ value, label }));
  const filteredClasses = teacherParam
    ? allClasses.filter((c) => c.teacherId === teacherParam)
    : allClasses;
  // 첫 진입/강사 변경 시: 필터된 반 중 첫 번째 자동 선택. 현재 class가 필터에 없으면 교체.
  const selectedClassId =
    classParam && filteredClasses.some((c) => c.id === classParam)
      ? classParam
      : filteredClasses[0]?.id ?? null;
  const matrix =
    classParam && selectedClassId === classParam
      ? initial
      : selectedClassId
        ? await getMonthlyAttendanceMatrix(month, selectedClassId)
        : initial;

  const selectedClass = matrix.classes.find((c) => c.id === selectedClassId) ?? null;
  const prevMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);
  // 2주 보기는 가로 컬럼을 줄이려 마지막 14일만 노출(출석률은 전체 기록 기준 유지).
  const visibleDays = range === "2w" ? matrix.days.slice(-14) : matrix.days;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="bg-card border-line shadow-card flex flex-wrap items-center gap-3 rounded-md border px-4 py-3">
        {/* 강사 dropdown — 담임 기준으로 반 좁히기 */}
        {teacherOptions.length > 0 ? (
          <>
            <div className="flex items-center gap-1.5">
              <span className="micro mr-1">강사</span>
              <FilterSelect
                paramName="teacher"
                value={teacherParam ?? null}
                options={teacherOptions}
                ariaLabel="강사 필터"
                allLabel="전체 강사"
                searchable
              />
            </div>
            <span className="bg-line h-4 w-px" aria-hidden />
          </>
        ) : null}

        {/* 반 dropdown */}
        <div className="flex items-center gap-1.5">
          <span className="micro mr-1">반</span>
          <FilterSelect
            paramName="class"
            value={selectedClassId}
            options={filteredClasses.map((c) => ({ value: c.id, label: c.className }))}
            ariaLabel="반 필터"
            searchable
          />
        </div>

        <span className="bg-line h-4 w-px" aria-hidden />

        {/* 월 navigator */}
        <div className="flex items-center gap-1.5">
          <Link
            href={attHref({ classId: selectedClassId, month: prevMonth, range, teacherId: teacherParam })}
            className="border-line hover:bg-bg-soft inline-flex size-7 items-center justify-center rounded-sm border"
            aria-label="이전 달"
          >
            ◀
          </Link>
          <span className="text-foreground min-w-[90px] text-center text-[13px] font-bold">
            {formatMonth(month)}
          </span>
          <Link
            href={attHref({ classId: selectedClassId, month: nextMonth, range, teacherId: teacherParam })}
            className="border-line hover:bg-bg-soft inline-flex size-7 items-center justify-center rounded-sm border"
            aria-label="다음 달"
          >
            ▶
          </Link>
        </div>

        <span className="bg-line h-4 w-px" aria-hidden />

        {/* 범위 토글 — 가로 컬럼 수 축소 */}
        <div className="flex items-center gap-1.5">
          <span className="micro mr-1">범위</span>
          {([
            ["month", "한 달"],
            ["2w", "2주"],
          ] as const).map(([key, label]) => (
            <Link
              key={key}
              href={attHref({ classId: selectedClassId, month, range: key, teacherId: teacherParam })}
              className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
                range === key
                  ? "border-foreground bg-foreground text-background font-medium"
                  : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
              }`}
            >
              {label}
            </Link>
          ))}
        </div>

        {/* 우측 요약 — 반/강사는 좌측 드롭다운과 중복이라 제거. 강사 필터가 '전체'일 때만
            선택 반의 담당 강사를 보조 표기(그땐 좌측에 강사명이 없어 유용). */}
        <span className="text-text-faint ml-auto font-mono text-[11px]">
          {!selectedClass
            ? "반을 선택하세요"
            : !teacherParam && selectedClass.teacherName
              ? `${selectedClass.teacherName} 강사`
              : null}
        </span>
      </div>

      {/* Stat 4 */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <Stat label="등록 학생" value={matrix.stats.totalStudents} unit="명" color="primary" icon={Users} />
        <Stat
          label="출석률"
          value={matrix.stats.presentRate}
          unit="%"
          color={
            matrix.stats.presentRate >= 90
              ? "primary"
              : matrix.stats.presentRate >= 80
                ? "amber"
                : "danger"
          }
          icon={UserCheck}
        />
        <Stat label="결석" value={matrix.stats.absentCount} unit="회" color="danger" icon={UserX} />
        <Stat label="지각" value={matrix.stats.lateCount} unit="회" color="amber" icon={Clock} />
      </section>

      {!selectedClassId ? (
        <EmptyState
          icon={() => <CalendarX size={32} strokeWidth={1.5} />}
          title="등록된 반이 없습니다"
        />
      ) : matrix.students.length === 0 ? (
        <EmptyState
          icon={() => <Users size={32} strokeWidth={1.5} />}
          title="이 반에 등록된 학생이 없습니다"
          description="학생목록에서 등록 후 다시 확인하세요."
        />
      ) : (
        <MatrixTable matrix={matrix} days={visibleDays} selectedClassId={selectedClassId} />
      )}
    </div>
  );
}

// ─────────────────── 매트릭스 테이블 ───────────────────

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "O",
  absent: "X",
  late: "L",
  excused: "공",
  makeup: "보",
  early_leave: "조",
};

function MatrixTable({
  matrix,
  days,
  selectedClassId,
}: {
  matrix: AttendanceMatrix;
  days: AttendanceMatrix["days"];
  selectedClassId: string;
}) {
  return (
    <DragScrollArea className="bg-card border-line shadow-card rounded-md border">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="bg-bg-soft border-line sticky left-0 z-10 min-w-[40px] border-b border-r px-3 py-2 text-left whitespace-nowrap">
              <span className="micro">#</span>
            </th>
            <th className="bg-bg-soft border-line sticky left-[40px] z-10 border-b border-r px-3 py-2 text-left whitespace-nowrap">
              <span className="micro">이름</span>
            </th>
            <th className="bg-bg-soft border-line border-b border-r px-2 py-2 text-left whitespace-nowrap">
              <span className="micro">학년</span>
            </th>
            <th className="bg-bg-soft border-line border-b border-r px-2 py-2 text-left whitespace-nowrap">
              <span className="micro">학교</span>
            </th>
            {days.map((d) => (
              <th
                key={d.date}
                className={`border-line border-b border-r px-1 py-2 text-center font-mono text-[10px] ${
                  d.isToday
                    ? "bg-primary text-primary-foreground"
                    : d.isWeekend
                      ? "bg-bg-soft/70 text-text-faint"
                      : "bg-bg-soft text-text-dim"
                }`}
              >
                <div className="font-bold">{d.day}</div>
                <div className="opacity-70">{d.label}</div>
              </th>
            ))}
            <th className="bg-bg-soft border-line sticky right-0 z-10 border-b border-l px-2 py-2 text-right whitespace-nowrap">
              <span className="micro">출석률</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {matrix.students.map((s, i) => {
            const studentMarks = matrix.marks[s.id] ?? {};
            const recorded = Object.values(studentMarks);
            const present = recorded.filter((x) => x === "present").length;
            const rate =
              recorded.length > 0 ? Math.round((present / recorded.length) * 100) : null;
            const rateColor =
              rate === null
                ? "text-text-faint"
                : rate >= 90
                  ? "text-primary"
                  : rate >= 80
                    ? "text-amber"
                    : "text-danger";
            return (
              <tr key={s.id} className="hover:bg-bg-soft/40">
                <td className="border-line text-text-dim sticky left-0 z-10 min-w-[40px] border-b border-r bg-card px-3 py-2 text-[11px] whitespace-nowrap">
                  {i + 1}
                </td>
                <td className="border-line text-foreground sticky left-[40px] z-10 border-b border-r bg-card px-3 py-2 text-[12px] font-bold whitespace-nowrap">
                  {s.name}
                </td>
                <td className="border-line text-text-dim border-b border-r px-2 py-2 text-[11px] whitespace-nowrap">
                  {s.grade ?? "—"}
                </td>
                <td className="border-line text-text-dim border-b border-r px-2 py-2 text-[11px] whitespace-nowrap">
                  {s.school ?? "—"}
                </td>
                {days.map((d) => {
                  const mark = (studentMarks[d.date] as AttendanceStatus | undefined) ?? null;
                  return (
                    <td key={d.date} className="border-line border-b border-r p-0 text-center">
                      <AttendanceCell
                        studentId={s.id}
                        classId={selectedClassId}
                        sessionDate={d.date}
                        initialStatus={mark}
                        isWeekend={d.isWeekend}
                        note={matrix.notes[s.id]?.[d.date] ?? null}
                      />
                    </td>
                  );
                })}
                <td
                  className={`border-line sticky right-0 z-10 border-b border-l bg-card px-2 py-2 text-right font-mono text-[12px] font-bold whitespace-nowrap ${rateColor}`}
                >
                  {rate === null ? "—" : `${rate}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            {/* 범례 1행: 좌측 요약 노트 + 우측(ml-auto) 범례 Pill 가로 나열(좁으면 가로 스크롤, 줄바꿈 X) */}
            <td
              colSpan={days.length + 5}
              className="bg-bg-soft border-line border-t px-3 py-2"
            >
              <div className="flex items-center gap-2 overflow-x-auto text-[11px] [&>*]:shrink-0 [&_*]:whitespace-nowrap">
                <span className="text-text-faint font-mono text-[11px]">
                  총 {matrix.stats.totalRecords}회 기록 · 셀 클릭 시 출결 즉시 변경
                </span>
                <span className="micro ml-auto">범례</span>
                {(["present", "absent", "late", "early_leave", "excused", "makeup"] as AttendanceStatus[]).map(
                  (s) => (
                    <Pill key={s} color={pillColorFor(s)}>
                      {STATUS_LABEL[s]} {labelFor(s)}
                    </Pill>
                  ),
                )}
              </div>
            </td>
          </tr>
        </tfoot>
      </table>
    </DragScrollArea>
  );
}

function pillColorFor(
  s: AttendanceStatus,
): "primary" | "danger" | "amber" | "blue" | "purple" | "rose" {
  if (s === "present") return "primary";
  if (s === "absent") return "danger";
  if (s === "late") return "amber";
  if (s === "early_leave") return "rose";
  if (s === "excused") return "blue";
  return "purple";
}

function labelFor(s: AttendanceStatus): string {
  if (s === "present") return "출석";
  if (s === "absent") return "결석";
  if (s === "late") return "지각";
  if (s === "early_leave") return "조퇴";
  if (s === "excused") return "공결";
  return "보강";
}

function Stat({
  label,
  value,
  unit,
  color,
  icon: Icon,
}: {
  label: string;
  value: number;
  unit: string;
  color: "primary" | "amber" | "danger";
  icon: LucideIcon;
}) {
  const ICON_BG = {
    primary: "bg-primary-soft text-primary",
    amber: "bg-amber-soft text-amber",
    danger: "bg-danger-soft text-danger",
  } as const;
  return (
    <div className="bg-card border-line shadow-card rounded-md border p-4">
      <header className="flex items-center justify-between">
        <p className="micro">{label}</p>
        <span className={`flex size-[26px] items-center justify-center rounded-sm ${ICON_BG[color]}`}>
          <Icon size={13} strokeWidth={2} />
        </span>
      </header>
      <p className="mt-2 flex items-baseline gap-1">
        <span className="tabular text-foreground text-[28px] leading-none">{value}</span>
        <span className="text-text-dim text-xs">{unit}</span>
      </p>
    </div>
  );
}

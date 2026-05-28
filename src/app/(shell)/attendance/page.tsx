import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Pill } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getMonthlyAttendanceMatrix,
  type AttendanceMatrix,
  type AttendanceStatus,
} from "@/features/attendance/server/queries";

export const metadata = { title: "출석부 — eywa" };

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
  searchParams: Promise<{ class?: string; month?: string }>;
}) {
  await requireAccess("attendance");
  const { class: classParam, month: monthParam } = await searchParams;
  const month = monthParam ?? currentMonthKey();

  // 첫 진입(반 선택 없음): 가용 반 중 첫 번째 자동 선택
  const initial = await getMonthlyAttendanceMatrix(month, classParam ?? null);
  const selectedClassId = classParam ?? initial.classes[0]?.id ?? null;
  const matrix =
    classParam || !initial.classes.length
      ? initial
      : await getMonthlyAttendanceMatrix(month, selectedClassId);

  const selectedClass = matrix.classes.find((c) => c.id === selectedClassId) ?? null;
  const prevMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="bg-card border-line shadow-card flex flex-wrap items-center gap-3 rounded-md border px-4 py-3">
        {/* 반 chip */}
        <div className="scrollbar-thin flex items-center gap-1 overflow-x-auto">
          <span className="micro mr-1">반</span>
          {matrix.classes.map((c) => (
            <Link
              key={c.id}
              href={`/attendance?class=${c.id}&month=${month}`}
              className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
                selectedClassId === c.id
                  ? "border-foreground bg-foreground text-background font-medium"
                  : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
              }`}
            >
              {c.className}
            </Link>
          ))}
        </div>

        <span className="bg-line h-4 w-px" aria-hidden />

        {/* 월 navigator */}
        <div className="flex items-center gap-1.5">
          <Link
            href={`/attendance?class=${selectedClassId ?? ""}&month=${prevMonth}`}
            className="border-line hover:bg-bg-soft inline-flex size-7 items-center justify-center rounded-sm border"
            aria-label="이전 달"
          >
            ◀
          </Link>
          <span className="text-foreground min-w-[90px] text-center text-[13px] font-bold">
            {formatMonth(month)}
          </span>
          <Link
            href={`/attendance?class=${selectedClassId ?? ""}&month=${nextMonth}`}
            className="border-line hover:bg-bg-soft inline-flex size-7 items-center justify-center rounded-sm border"
            aria-label="다음 달"
          >
            ▶
          </Link>
        </div>

        <span className="text-text-faint ml-auto font-mono text-[11px]">
          {selectedClass
            ? `${selectedClass.className} · ${selectedClass.teacherName ?? "—"} 강사`
            : "반을 선택하세요"}
        </span>
      </div>

      {/* Stat 4 */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <Stat label="등록 학생" value={matrix.stats.totalStudents} unit="명" color="primary" icon="seed" />
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
          icon="pulse"
        />
        <Stat label="결석" value={matrix.stats.absentCount} unit="회" color="danger" icon="falling" />
        <Stat label="지각" value={matrix.stats.lateCount} unit="회" color="amber" icon="rings" />
      </section>

      {!selectedClassId ? (
        <EmptyState
          icon={() => <EyIcon name="pulse" size={32} />}
          title="등록된 반이 없습니다"
        />
      ) : matrix.students.length === 0 ? (
        <EmptyState
          icon={() => <EyIcon name="seed" size={32} />}
          title="이 반에 등록된 학생이 없습니다"
          description="학생목록에서 등록 후 다시 확인하세요."
        />
      ) : (
        <MatrixTable matrix={matrix} selectedClassId={selectedClassId} />
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
};

const STATUS_CLASS: Record<AttendanceStatus, string> = {
  present: "bg-primary-soft text-primary",
  absent: "bg-danger-soft text-danger",
  late: "bg-amber-soft text-amber",
  excused: "bg-blue-soft text-blue",
  makeup: "bg-purple-soft text-purple",
};

function MatrixTable({
  matrix,
  selectedClassId,
}: {
  matrix: AttendanceMatrix;
  selectedClassId: string;
}) {
  return (
    <div className="bg-card border-line shadow-card overflow-auto rounded-md border">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="bg-bg-soft border-line sticky left-0 z-10 border-b border-r px-3 py-2 text-left">
              <span className="micro">#</span>
            </th>
            <th className="bg-bg-soft border-line sticky left-[40px] z-10 border-b border-r px-3 py-2 text-left">
              <span className="micro">이름</span>
            </th>
            <th className="bg-bg-soft border-line border-b border-r px-2 py-2 text-left">
              <span className="micro">학년</span>
            </th>
            <th className="bg-bg-soft border-line border-b border-r px-2 py-2 text-left">
              <span className="micro">학교</span>
            </th>
            {matrix.days.map((d) => (
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
            <th className="bg-bg-soft border-line border-b border-r px-2 py-2 text-right">
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
                <td className="border-line text-text-dim sticky left-0 z-10 border-b border-r bg-card px-3 py-2 text-[11px]">
                  {i + 1}
                </td>
                <td className="border-line text-foreground sticky left-[40px] z-10 border-b border-r bg-card px-3 py-2 text-[12px] font-bold">
                  {s.name}
                </td>
                <td className="border-line text-text-dim border-b border-r px-2 py-2 text-[11px]">
                  {s.grade ?? "—"}
                </td>
                <td className="border-line text-text-dim border-b border-r px-2 py-2 text-[11px]">
                  {s.school ?? "—"}
                </td>
                {matrix.days.map((d) => {
                  const mark = studentMarks[d.date] as AttendanceStatus | undefined;
                  const cls = mark ? STATUS_CLASS[mark] : "";
                  const label = mark ? STATUS_LABEL[mark] : "·";
                  return (
                    <td
                      key={d.date}
                      className={`border-line border-b border-r p-0 text-center ${
                        d.isWeekend && !mark ? "bg-bg-soft/40" : ""
                      }`}
                    >
                      <Link
                        href={`/attendance/${d.date}/${selectedClassId}`}
                        className={`block size-7 leading-7 font-mono text-[11px] font-bold ${cls} ${
                          mark ? "" : "text-text-faint hover:bg-bg-soft"
                        }`}
                      >
                        {label}
                      </Link>
                    </td>
                  );
                })}
                <td
                  className={`border-line border-b border-r px-2 py-2 text-right font-mono text-[12px] font-bold ${rateColor}`}
                >
                  {rate === null ? "—" : `${rate}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="bg-bg-soft border-line border-t px-3 py-2">
              <div className="flex items-center gap-3 text-[11px]">
                <span className="micro">범례</span>
                {(["present", "absent", "late", "excused", "makeup"] as AttendanceStatus[]).map(
                  (s) => (
                    <Pill key={s} color={pillColorFor(s)}>
                      {STATUS_LABEL[s]} {labelFor(s)}
                    </Pill>
                  ),
                )}
              </div>
            </td>
            <td
              colSpan={matrix.days.length + 1}
              className="bg-bg-soft border-line border-t px-3 py-2 text-right font-mono text-[11px]"
            >
              총 {matrix.stats.totalRecords}회 기록 · 셀 클릭 시 해당 날짜 입력 화면
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function pillColorFor(s: AttendanceStatus): "primary" | "danger" | "amber" | "blue" | "purple" {
  if (s === "present") return "primary";
  if (s === "absent") return "danger";
  if (s === "late") return "amber";
  if (s === "excused") return "blue";
  return "purple";
}

function labelFor(s: AttendanceStatus): string {
  if (s === "present") return "출석";
  if (s === "absent") return "결석";
  if (s === "late") return "지각";
  if (s === "excused") return "공결";
  return "보강";
}

function Stat({
  label,
  value,
  unit,
  color,
  icon,
}: {
  label: string;
  value: number;
  unit: string;
  color: "primary" | "amber" | "danger";
  icon: Parameters<typeof EyIcon>[0]["name"];
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
          <EyIcon name={icon} size={13} />
        </span>
      </header>
      <p className="mt-2 flex items-baseline gap-1">
        <span className="tabular text-foreground text-[28px] leading-none">{value}</span>
        <span className="text-text-dim text-xs">{unit}</span>
      </p>
    </div>
  );
}

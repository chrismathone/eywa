import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { PrintActions } from "@/app/(print)/enrollment/[id]/print/print-actions";
import {
  AttendanceAppendix,
  seatAppendixCaption,
} from "@/app/(print)/payroll/[teacherId]/payslip/attendance-appendix";
import { getCurrentUser } from "@/lib/auth/current-user";
import { requireAccess } from "@/lib/auth/require-access";
import { kstMonth } from "@/lib/date-kst";
import { buildHolidayMap } from "@/features/attendance/calendar";
import { rollupDay } from "@/features/attendance/cell-display";
import { getTenantSettings } from "@/features/owner/server/queries";
import { dutyAllowsSeat } from "@/features/attendance/seat/duty";
import { getActiveSeatDuties } from "@/features/attendance/seat/server/duty";
import { getSeatMonthly } from "@/features/attendance/seat/server/monthly-queries";
import type { SeatMonthGroup } from "@/features/attendance/seat/monthly-build";
import { isPayrollSeat, parseAnySeatKey, parseUsableSeatKey, SEAT_NAME } from "@/features/attendance/seat/seat";
import type { AttendanceMatrix, AttendanceStatus, MatrixStudent } from "@/features/attendance/server/queries";

export async function generateMetadata({ params }: { params: Promise<{ seat: string }> }) {
  const seat = parseAnySeatKey((await params).seat);
  return { title: `${seat ? SEAT_NAME[seat] : "자리"} 월간 출석부 인쇄 — 에이와` };
}

export default async function SeatMonthlyPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ seat: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { seat: seatParam } = await params;
  const seat = parseAnySeatKey(seatParam);
  if (!seat) notFound();
  if (!parseUsableSeatKey(seatParam)) notFound();

  // 담당 토글은 화면 주인(강사뷰면 검증된 대상 강사) — 하루 화면·쓰기 게이트(gateSeatWrite)와 같은 신원.
  const user = await getCurrentUser({ teacherView: true });
  if (!user) redirect("/login");
  if (!dutyAllowsSeat(await getActiveSeatDuties(user.id, user.tenantId), seat)) await requireAccess("seat_attendance");

  const { month: monthParam } = await searchParams;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam ?? "") ? monthParam! : kstMonth();
  const embedded = (await headers()).get("x-embed") === "1";
  const [view, settings] = await Promise.all([getSeatMonthly(seat, month), getTenantSettings()]);

  const unitsByStudent: Record<string, number> = {};
  for (const g of view.groups) {
    for (const s of g.students) unitsByStudent[s.id] = s.confirmedUnits;
  }

  return (
    <>
      <div className="print:hidden mx-auto max-w-[277mm] px-8 pt-6">
        <PrintActions embedded={embedded} />
      </div>
      <AttendanceAppendix
        groups={view.groups.map((g) => ({
          classId: g.classId,
          className: g.className,
          matrix: groupToMatrix(g, view.month, view.window, view.days),
        }))}
        period={month}
        teacherName={SEAT_NAME[seat]}
        holidays={buildHolidayMap(settings.operations.holidays)}
        caption={seatAppendixCaption(isPayrollSeat(seat))}
        unitsByStudent={unitsByStudent}
        nameStyle="badge"
      />
    </>
  );
}

function groupToMatrix(
  g: SeatMonthGroup,
  month: string,
  window: AttendanceMatrix["window"],
  days: AttendanceMatrix["days"],
): AttendanceMatrix {
  const marks: AttendanceMatrix["marks"] = {};
  const units: AttendanceMatrix["units"] = {};
  const slots: AttendanceMatrix["slots"] = {};
  for (const s of g.students) {
    for (const [date, cell] of Object.entries(g.cells[s.id] ?? {})) {
      const recs = cell.slots.filter((x) => x.status).map((x) => ({ slot: x.start, status: x.status!, units: x.units }));
      const day = rollupDay(recs);
      if (!day) continue;
      marks[s.id] ??= {};
      marks[s.id]![date] = day.status as AttendanceStatus;
      if (day.units !== 1 && day.units > 0) {
        units[s.id] ??= {};
        units[s.id]![date] = day.units;
      }
      if (day.count > 1) {
        slots[s.id] ??= {};
        slots[s.id]![date] = day.slots;
      }
    }
  }
  const students: MatrixStudent[] = g.students.map((s) => ({
    id: s.id,
    name: s.name,
    grade: s.grade,
    school: s.school,
    enrolledAt: s.spans[0]?.start ?? null,
    attendDows: s.attendDows,
    spans: s.spans,
    badges: s.badges,
  }));
  return {
    classes: [],
    selectedClassId: g.classId,
    month,
    window,
    days,
    classDows: [...new Set(g.students.flatMap((s) => s.attendDows))],
    students,
    marks,
    notes: {},
    units,
    slots,
    ghosts: {},
    dayAxis: {},
    derived: {},
    derivedActive: false,
    stats: {
      totalStudents: students.length,
      presentRate: 0,
      presentCount: 0,
      absentCount: 0,
      lateCount: 0,
      makeupCount: 0,
      totalRecords: 0,
    },
  };
}

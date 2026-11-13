import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { TOOLBAR_CHIP, TOOLBAR_CHIP_OFF } from "@/components/toolbar-controls";
import { PeriodNav } from "@/components/period-nav";
import { requireAccess } from "@/lib/auth/require-access";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { getCurrentUser } from "@/lib/auth/current-user";
import { kstMonth } from "@/lib/date-kst";
import { buildHolidayMap } from "@/features/attendance/calendar";
import { getTenantSettings } from "@/features/owner/server/queries";
import { dutyAllowsSeat } from "@/features/attendance/seat/duty";
import { getActiveSeatDuties } from "@/features/attendance/seat/server/duty";
import { getSeatMonthly } from "@/features/attendance/seat/server/monthly-queries";
import { loadSeatMonthlyPrefs } from "@/features/attendance/seat/server/monthly-prefs";
import { parseAnySeatKey, parseUsableSeatKey, SEAT_NAME, SEAT_ROOM } from "@/features/attendance/seat/seat";
import { CollapseAllChip } from "@/app/(shell)/attendance/_components/class-group";
import { SeatMonthlyCollapse } from "./_components/collapse-provider";
import { MonthlyLegend, MonthlySummary } from "./_components/monthly-summary";
import { MonthlyTable } from "./_components/monthly-table";
import { MonthlyPrintButton } from "./_components/print-button";

/** 탭 제목은 자리 이름을 따라간다 — 같은 화면이 랩실·JJ실 둘 다를 연다. */
export async function generateMetadata({ params }: { params: Promise<{ seat: string }> }): Promise<Metadata> {
  const seat = parseAnySeatKey((await params).seat);
  return { title: `${seat ? SEAT_NAME[seat] : "자리"} 월간 출석부 — 에이와` };
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

export default async function SeatMonthlyPage({
  params,
  searchParams,
}: {
  params: Promise<{ seat: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { seat: seatParam } = await params;
  const { month: monthParam } = await searchParams;
  const seat = parseAnySeatKey(seatParam);
  if (!seat) notFound();

  // 화면은 '쓸 수 있는 자리'(USABLE)까지 연다 — `seat_label`(자리 시수)은 PAYROLL_SEAT_KEYS만이라 JJ 기록은 '확인 필요'로 선다.
  if (!parseUsableSeatKey(seatParam)) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        <PageHeader
          eyebrow="출석부"
          title={`${SEAT_NAME[seat]} 월간`}
          description="아직 열지 않은 자리입니다"
          actions={
            <Link href="/attendance?list=1" className="border-line hover:bg-bg-soft rounded-full border px-2.5 py-0.5 text-xs">
              출석부로
            </Link>
          }
        />
        <EmptyState
          image="students"
          title={`${SEAT_NAME[seat]} 월간 출석부는 아직 열지 않았습니다`}
          description="이 자리 수업은 지금 담임 시수로 잡혀 있습니다. 자리 시수로 옮길지 정한 뒤 열면 그때부터 집계합니다."
        />
      </div>
    );
  }

  // 담당 토글은 화면 주인(강사뷰면 검증된 대상 강사) — 하루 화면·쓰기 게이트(gateSeatWrite)와 같은 신원.
  const user = await getCurrentUser({ teacherView: true });
  if (!user) redirect("/login");
  if (!dutyAllowsSeat(await getActiveSeatDuties(user.id, user.tenantId), seat)) await requireAccess("seat_attendance");

  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam ?? "") ? monthParam! : kstMonth();
  const [view, prefs, settings, canOpenAttendance] = await Promise.all([
    getSeatMonthly(seat, month),
    loadSeatMonthlyPrefs(),
    getTenantSettings(),
    canAccessTenant(user.systemRole, "attendance"),
  ]);
  const holidays = buildHolidayMap(settings.operations.holidays);
  const href = (m: string) => `/attendance/seat/${seat}/month?month=${m}`;

  return (
    <SeatMonthlyCollapse classIds={view.groups.map((g) => g.classId)} initial={prefs.collapsed}>
      <div className="flex h-full min-h-0 flex-col gap-3 pb-3">
        <PageHeader
          eyebrow="출석부"
          title={`${SEAT_NAME[seat]} ${SEAT_ROOM[seat]} 월간`}
          embedLabel={`${SEAT_NAME[seat]} 월간 · ${formatMonth(month)}`}
          description={view.window.label}
          actions={
            // flex-wrap — 하루 면과 같은 이유(폰에서 칩+PeriodNav가 한 줄에 안 들어가 본문이 가로로 밀린다, 2026-09-13).
            <div className="flex flex-wrap items-center gap-1.5">
              <Link href={`/attendance/seat/${seat}`} className={`${TOOLBAR_CHIP} ${TOOLBAR_CHIP_OFF}`}>
                하루
              </Link>
              {/* 출석부를 못 여는 사람(자리 출석부만 받은 아르바이트 등)에겐 그리지 않는다 — 누르면 첫 화면으로 튕긴다(2026-11-05 리뷰). */}
              {canOpenAttendance ? (
                <Link href="/attendance?list=1" className={`${TOOLBAR_CHIP} ${TOOLBAR_CHIP_OFF}`}>
                  출석부로
                </Link>
              ) : null}
              <MonthlyPrintButton seat={seat} month={month} title={`${SEAT_NAME[seat]} ${formatMonth(month)}`} />
              {/* 월 이동 — 월별 출석부·시간표와 같은 PeriodNav(원장 2026-09-01). 라벨 클릭 = 이번 달. */}
              <PeriodNav
                label={formatMonth(month)}
                prevHref={href(shiftMonth(month, -1))}
                nextHref={href(shiftMonth(month, 1))}
                currentHref={href(kstMonth())}
                relation={month === kstMonth() ? "current" : month < kstMonth() ? "past" : "future"}
                prevAriaLabel="이전 달"
                nextAriaLabel="다음 달"
                currentTitle="눌러서 이번 달로"
              />
              {view.groups.length > 0 ? <CollapseAllChip classIds={view.groups.map((g) => g.classId)} /> : null}
            </div>
          }
        />

        <div className="bg-card shadow-card shrink-0 space-y-1.5 rounded-2xl px-4 py-2.5">
          <MonthlySummary summary={view.summary} minutesPerSlot={view.minutesPerSlot} />
          <MonthlyLegend />
        </div>

        {view.groups.length === 0 || view.summary.studentCount === 0 ? (
          <EmptyState
            image="students"
            title={`이 기간에 ${SEAT_NAME[seat]} 수업이 없습니다`}
            description="달을 옮기거나 시간표에서 자리 배치를 확인하세요."
          />
        ) : (
          <div className="isolate min-h-0 flex-1">
            <MonthlyTable seat={seat} view={view} holidays={holidays} />
          </div>
        )}
      </div>
    </SeatMonthlyCollapse>
  );
}

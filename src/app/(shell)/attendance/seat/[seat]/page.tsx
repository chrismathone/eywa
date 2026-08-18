import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "@/components/icons/eywa-icon-compat";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { kstToday } from "@/lib/date-kst";
import { dutyAllowsSeat } from "@/features/attendance/seat/duty";
import { getSeatDuties } from "@/features/attendance/seat/server/duty";
import { getSeatDay } from "@/features/attendance/seat/server/queries";
import {
  USABLE_SEAT_KEYS,
  parseUsableSeatKey,
  pickPeriodIndex,
  SEAT_NAME,
  SEAT_ROOM,
} from "@/features/attendance/seat/seat";
import { seatHasJjFields } from "@/features/attendance/seat/jj-fields";
import { attachJjMarks } from "@/features/attendance/seat/server/jj-marks";
import { SeatBoard } from "./_components/seat-board";

export const metadata: Metadata = { title: "랩실·JJ실 출석부 — eywa" };

/** KST 지금 "HH:MM" — 기본으로 열 교시를 고르는 데만 쓴다(순수 규칙은 pickPeriodIndex). */
function kstNowHm(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function dateLabel(date: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${date}T00:00:00Z`));
}

/**
 * 자리(랩실·JJ실) 출석부 — **자리 × 날짜 × 교시** 한 장.
 *
 * 여러 반 학생이 같은 시각에 한 방으로 들어오는 운영(실측 랩실 최대 5개 반 32명)이라, 반 축인 기존
 * 출석부로는 "지금 이 방에 들어온 애들"을 한 번에 볼 수 없었다. 여기는 그 한 칸만 본다.
 * 저장은 새 테이블이 아니라 기존 `attendance_records`(class_id = 학생의 원래 반, slot_start = 교시)다.
 */
export default async function SeatAttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ seat: string }>;
  searchParams: Promise<{ date?: string; start?: string }>;
}) {
  const { seat: seatParam } = await params;
  const { date: dateParam, start: startParam } = await searchParams;

  const seat = parseUsableSeatKey(seatParam);
  if (!seat) notFound();

  // 토글 담당은 메뉴 권한 없이 그 자리만 연다. 없으면 기존 seat_attendance 게이트.
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!dutyAllowsSeat(await getSeatDuties(user.id), seat)) await requireAccess("seat_attendance");

  const today = kstToday();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam ?? "") ? dateParam! : today;
  const day = await getSeatDay(seat, date);

  const fallbackIdx = pickPeriodIndex(day.periods, date === today ? kstNowHm() : "00:00");
  const idx = startParam ? day.periods.findIndex((p) => p.start === startParam) : fallbackIdx;
  const period = day.periods[idx >= 0 ? idx : fallbackIdx] ?? null;

  // 지난 날짜 쓰기는 사무실만 — 자리 전용 권한(아르바이트)은 오늘만. 서버 액션이 같은 판정을 다시 한다(#77).
  const canEditPast = await canWriteTenant(user.systemRole, "attendance");
  const readOnly = date !== today && !canEditPast;

  const href = (q: { date?: string; start?: string }) => {
    const sp = new URLSearchParams();
    sp.set("date", q.date ?? date);
    if (q.start) sp.set("start", q.start);
    return `/attendance/seat/${seat}?${sp.toString()}`;
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <PageHeader
        eyebrow="출석부"
        title={`${SEAT_NAME[seat]} ${SEAT_ROOM[seat]}`}
        embedLabel={`${SEAT_NAME[seat]} · ${dateLabel(date)}`}
        description={dateLabel(date)}
        actions={
          <div className="flex items-center gap-1.5">
            {/* 자리는 강사 축의 한 갈래라 되돌아갈 길을 헤더에 둔다(사이드바 항목이 없다). */}
            <Link
              href="/attendance"
              className="border-line hover:bg-bg-soft mr-1 rounded-full border px-2.5 py-0.5 text-xs"
            >
              출석부로
            </Link>
            <Link
              href={`/attendance/seat/${seat}/month?month=${date.slice(0, 7)}`}
              className="border-line hover:bg-bg-soft mr-1 rounded-full border px-2.5 py-0.5 text-xs"
            >
              월간
            </Link>
            {USABLE_SEAT_KEYS.length > 1 ? (
              <div className="bg-bg-soft mr-1 inline-flex rounded-full p-0.5">
                {USABLE_SEAT_KEYS.map((k) => (
                  <Link
                    key={k}
                    href={`/attendance/seat/${k}?date=${date}`}
                    className={`rounded-full px-3 py-1 text-[13px] font-semibold ${
                      k === seat ? "bg-primary text-primary-foreground" : "text-text-dim"
                    }`}
                  >
                    {SEAT_NAME[k]}
                  </Link>
                ))}
              </div>
            ) : null}
            <Link
              href={href({ date: shiftDate(date, -1), start: undefined })}
              className="border-line hover:bg-bg-soft inline-flex size-7 items-center justify-center rounded-full border"
              aria-label="이전 날"
            >
              <ChevronLeft className="size-3.5" />
            </Link>
            <Link
              href={href({ date: today, start: undefined })}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${
                date === today ? "border-primary bg-primary text-primary-foreground" : "border-line text-text-dim"
              }`}
            >
              오늘
            </Link>
            <Link
              href={href({ date: shiftDate(date, 1), start: undefined })}
              className="border-line hover:bg-bg-soft inline-flex size-7 items-center justify-center rounded-full border"
              aria-label="다음 날"
            >
              <ChevronRight className="size-3.5" />
            </Link>
          </div>
        }
      />

      {day.periods.length === 0 || !period ? (
        <EmptyState
          image="students"
          title={`이 날은 ${SEAT_NAME[seat]} 수업이 없습니다`}
          description="날짜를 옮기거나 시간표에서 자리 배치를 확인하세요."
        />
      ) : (
        <SeatBoard
          key={`${seat}|${date}|${period.start}`}
          seat={seat}
          date={date}
          periods={day.periods.map((p) => ({
            start: p.start,
            ends: p.ends,
            classIds: p.slots.map((s) => s.classId),
          }))}
          activeStart={period.start}
          rosters={
            seatHasJjFields(seat)
              ? await attachJjMarks(day.rosterByPeriod[period.start] ?? [], user.tenantId, date, period.start)
              : (day.rosterByPeriod[period.start] ?? [])
          }
          readOnly={readOnly}
          hrefFor={`/attendance/seat/${seat}?date=${date}&start=`}
        />
      )}
    </div>
  );
}

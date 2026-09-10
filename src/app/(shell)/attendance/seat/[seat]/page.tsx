import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import {
  TOOLBAR_CHIP,
  TOOLBAR_CHIP_OFF,
  TOOLBAR_SEG_BOX,
  TOOLBAR_SEG_ITEM,
  TOOLBAR_SEG_OFF,
  TOOLBAR_SEG_ON_PRIMARY,
} from "@/components/toolbar-controls";
import { PeriodNav } from "@/components/period-nav";
import { requireAccess } from "@/lib/auth/require-access";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { kstToday } from "@/lib/date-kst";
import { dutyAllowsSeat } from "@/features/attendance/seat/duty";
import { getSeatDuties } from "@/features/attendance/seat/server/duty";
import { getSeatDay } from "@/features/attendance/seat/server/queries";
import {
  USABLE_SEAT_KEYS,
  ambiguousClassIds,
  parseUsableSeatKey,
  pickPeriodIndex,
  SEAT_NAME,
  SEAT_ROOM,
} from "@/features/attendance/seat/seat";
import { seatHasJjFields } from "@/features/attendance/seat/jj-fields";
import {
  nextSeatPeriodByStudent,
  prevPeriodAbsences,
  seatDayCells,
} from "@/features/attendance/seat/prev-period";
import { attachJjMarks } from "@/features/attendance/seat/server/jj-marks";
import { loadSeatJjPlans } from "@/features/attendance/seat/server/jj-plan";
import { mondayOf } from "@/features/timetable/lib/week";
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

  // 명단(듣기·단어)과 계획(진도)은 서로 독립이라 병렬(B4).
  // 🔴 계획은 **자리 권한이 아니라 영어 시트 권한**이 연다 — 아르바이트·viewer에겐 반마다 빈 값이 온다.
  const [rosters, plans] = await Promise.all([
    period && seatHasJjFields(seat)
      ? attachJjMarks(day.rosterByPeriod[period.start] ?? [], user.tenantId, date, period.start)
      : Promise.resolve(period ? (day.rosterByPeriod[period.start] ?? []) : []),
    period
      ? loadSeatJjPlans(
          seat,
          period.slots.map((sl) => sl.classId),
          user.tenantId,
          date,
          period.start,
        )
      : Promise.resolve({}),
  ]);

  /**
   * 같은 날 교시 사이 신호 — **이미 받아 온 하루치**(`day`)에서 순수 함수로 뽑는다(왕복 0회).
   * 🔴 여기서 나오는 건 **제안·표시**일 뿐이다. 결석은 사람이 버튼을 눌러야 찍히고, 그때도 서버가
   *    대상을 다시 계산한다([[#77]]).
   */
  const cells = period ? seatDayCells(day.periods, day.rosterByPeriod) : null;
  // ⚠️ 모호한 반(같은 반·같은 시작·다른 종료)은 아무도 못 쓰는 칸이라 표식·수에서 뺀다 — 서버 일괄이
  //    쓰는 집합과 **같은 인자**여야 버튼의 "N명"이 실제로 쓰는 수와 맞는다.
  const prevAbsentByCell =
    cells && period ? prevPeriodAbsences(cells, period.start, ambiguousClassIds(period)) : undefined;
  const nextStartByStudent = cells && period ? nextSeatPeriodByStudent(cells, period.start) : undefined;

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
        // ⚠️ 부제로 날짜를 또 적지 않는다 — 아래 날짜 네비가 같은 줄에서 이미 말하고 있다(둘이 나란히
        //    같은 날짜를 적으면 어느 쪽이 진짜인지 헷갈린다). 창(embed) 한 줄 라벨엔 그대로 들어간다.
        actions={
          <div className="flex items-center gap-1.5">
            {/* 자리는 강사 축의 한 갈래라 되돌아갈 길을 헤더에 둔다(사이드바 항목이 없다). */}
            <Link href="/attendance" className={`${TOOLBAR_CHIP} ${TOOLBAR_CHIP_OFF} mr-1`}>
              출석부로
            </Link>
            <Link
              href={`/attendance/seat/${seat}/month?month=${date.slice(0, 7)}`}
              className={`${TOOLBAR_CHIP} ${TOOLBAR_CHIP_OFF} mr-1`}
            >
              월간
            </Link>
            {USABLE_SEAT_KEYS.length > 1 ? (
              <div className={`${TOOLBAR_SEG_BOX} mr-1`}>
                {USABLE_SEAT_KEYS.map((k) => (
                  <Link
                    key={k}
                    href={`/attendance/seat/${k}?date=${date}`}
                    className={`${TOOLBAR_SEG_ITEM} ${k === seat ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF}`}
                  >
                    {SEAT_NAME[k]}
                  </Link>
                ))}
              </div>
            ) : null}
            {/* 날짜 이동 — 앱 전역 단일 소스 PeriodNav(원장 2026-09-01). '오늘' 알약이 하던 두 일은
                라벨 클릭(오늘로)과 지난/미래 조회 배지로 나뉜다.
                🔑 종전엔 **화살표 사이에 날짜가 없어서** 어느 날을 보는지 헤더까지 눈을 옮겨야 했다. */}
            <PeriodNav
              label={dateLabel(date)}
              prevHref={href({ date: shiftDate(date, -1), start: undefined })}
              nextHref={href({ date: shiftDate(date, 1), start: undefined })}
              currentHref={href({ date: today, start: undefined })}
              relation={date === today ? "current" : date < today ? "past" : "future"}
              prevAriaLabel="이전 날"
              nextAriaLabel="다음 날"
              currentTitle="눌러서 오늘로"
              // "12월 26일 (수)"(최장)까지 안 넘치는 고정 폭 — 넉넉히 잡는다.
              labelWidth={140}
            />
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
          rosters={rosters}
          readOnly={readOnly}
          hrefFor={`/attendance/seat/${seat}?date=${date}&start=`}
          prevAbsentByCell={prevAbsentByCell}
          // 🔵 '다음 교시'는 **로그인 화면에만** 내려간다 — 비로그인 PIN 화면(`/seat/:key`)엔 이 prop을
          //    아예 안 넘긴다(그 경로는 사유도 조회하지 않는다는 규약과 같은 결).
          nextStartByStudent={nextStartByStudent}
          // 진도 구획은 계획을 볼 수 있는 반이 하나라도 있을 때만 — 없으면 prop 자체를 안 넘긴다.
          plans={
            Object.keys(plans).length > 0
              ? {
                  plans,
                  tenantId: user.tenantId,
                  userId: user.id,
                  // 저널·presence 문서 키 — 영어 시트와 **같은 주차**여야 두 화면이 서로를 본다.
                  weekMonday: mondayOf(date),
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

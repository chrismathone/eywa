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
import { prevPeriodAbsences, seatDayCells } from "@/features/attendance/seat/prev-period";
import { attachJjMarks } from "@/features/attendance/seat/server/jj-marks";
import { loadSeatJjPlans } from "@/features/attendance/seat/server/jj-plan";
import { getSeatPlacementsForDay } from "@/features/attendance/seat/server/placements";
import { getSeatNextDestinationsBySlot } from "@/features/attendance/seat/server/next-destination";
import { seatStaysFor } from "@/features/attendance/seat/next-destination";
import { SeatPeriodChips, SEAT_ALL_PERIODS } from "./_components/seat-period-chips";
import { mondayOf } from "@/features/timetable/lib/week";
import { SeatBoard } from "./_components/seat-board";
import { SeatAllDay } from "./_components/seat-all-day";
import { applySeatDayChoices, getSeatPeriodChoices } from "@/features/attendance/seat/server/period-choice";
import { resolveSeatPeriodChoices } from "@/features/attendance/seat/period-choice";

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
  /**
   * 하루 명단 + 자리 **교시 선택**(0255a) — 서로 독립이라 병렬(B4). 선택은 하루/한 요일치 두 번뿐이고 교시
   * 수와 무관하다(B6). fail-soft라 표가 없어도 화면은 지금까지 그대로 산다([[#95]]).
   * 🔑 선택을 **먼저** 받아야 명단에 얹을 수 있다 — 다른 시간으로 옮긴 학생은 목표 교시에 서고(다음 행선지·
   *    앞 교시 결석도 그 명단으로 잰다) 원래 교시에선 빠진다.
   */
  const [day, periodChoiceLoad] = await Promise.all([
    getSeatDay(seat, date),
    getSeatPeriodChoices(user.tenantId, seat, date),
  ]);
  /** 교시 선택을 얹은 하루 명단 — 서버 쓰기 경로(`rosterKeys`)와 **같은 함수**다(버튼의 N = 실제로 쓰는 수). */
  const rosterByPeriod = applySeatDayChoices(day, periodChoiceLoad, date);

  /**
   * **'전체' 보기**(원장 2026-09-10 ⑨ *"한번에 오늘 전체 볼 수 있게. 스크롤링으로 시간대별로 분리해서"*).
   * 🔴 **랩실만** 연다 — JJ실은 교시마다 진도(수업계획) 블록이 붙어서 하루치를 펼치면 조회도 화면도
   *    교시 수만큼 불어난다(B6). 그래서 칩도 랩실에서만 세운다.
   * 🔑 조회는 **늘리지 않았다** — 하루 명단은 원래 `getSeatDay` 한 번이고, 배치·다음 행선지도 하루치를
   *    한 번 받아 교시별로 나눈다(`getSeatPlacementsForDay`·`getSeatNextDestinationsBySlot`).
   */
  const allowAllView = seat === "lab";
  const viewAll = allowAllView && startParam === SEAT_ALL_PERIODS;

  const fallbackIdx = pickPeriodIndex(day.periods, date === today ? kstNowHm() : "00:00");
  const idx = startParam && !viewAll ? day.periods.findIndex((p) => p.start === startParam) : fallbackIdx;
  const period = day.periods[idx >= 0 ? idx : fallbackIdx] ?? null;
  /** 이번에 그릴 교시들 — '전체'면 그날 전부, 아니면 고른 하나. */
  const shown = viewAll ? day.periods : period ? [period] : [];

  // 지난 날짜 쓰기는 사무실만 — 자리 전용 권한(아르바이트)은 오늘만. 서버 액션이 같은 판정을 다시 한다(#77).
  const canEditPast = await canWriteTenant(user.systemRole, "attendance");
  const readOnly = date !== today && !canEditPast;

  // 명단(듣기·단어)과 계획(진도)은 서로 독립이라 병렬(B4).
  // 🔴 계획은 **자리 권한이 아니라 영어 시트 권한**이 연다 — 아르바이트·viewer에겐 반마다 빈 값이 온다.
  const [rosters, plans, placementsDay, nextBySlot] = await Promise.all([
    period && seatHasJjFields(seat)
      ? attachJjMarks(rosterByPeriod[period.start] ?? [], user.tenantId, date, period.start)
      : Promise.resolve(period ? (rosterByPeriod[period.start] ?? []) : []),
    period
      ? loadSeatJjPlans(
          seat,
          period.slots.map((sl) => sl.classId),
          user.tenantId,
          date,
          period.start,
        )
      : Promise.resolve({}),
    // 자리 **배치**(드래그로 옮긴 자리, 0254a) — 하루치 한 번(교시는 화면에서 나눈다).
    // fail-soft라 표가 없어도 화면은 그대로 산다([[#95]]).
    getSeatPlacementsForDay(user.tenantId, seat, date),
    /**
     * **다음 행선지**(원장 2026-09-10 *"17:20 304호 가야함처럼"*) — 이 자리만이 아니라 **오늘 전 과목**의
     * 다음 수업을 본다. 그래서 순수 함수(`nextSeatPeriodByStudent`, 이 자리 교시만)로는 못 구하고 조회가
     * 든다. 🔵 명단은 `day`에 이미 있으므로 위 `rosters`를 기다리지 않는다(직렬 워터폴 금지, B4).
     * 🔵 **교시 여러 개를 한 벌로** 받는다 — '전체' 보기가 왕복을 교시 수만큼 늘리지 않게(B6).
     * 🔵 비로그인 PIN 화면(랩실)도 **같은 함수·같은 재료**다(원장 2026-09-10 *"seat/lab에서도 … 동일해야해"*).
     */
    getSeatNextDestinationsBySlot(
      // 🔑 **옮긴 뒤의 명단**으로 모은다 — 다른 시간에서 옮겨 온 학생도 그 교시의 다음 행선지를 받는다.
      [...new Set(shown.flatMap((p) => (rosterByPeriod[p.start] ?? []).flatMap((r) => r.students.map((s) => s.id))))],
      date,
      shown.map((p) => p.start),
      // 🔴 이 자리 교시는 배치표가 아니라 **교시 선택을 얹은 명단**으로 잰다 — 배치표로 재면 옮겨 나간 랩실을
      //    안내하고 옮겨 가는 교시는 못 적는다. 교시를 옮기는 자리(랩실)만이고 JJ실은 옛 규칙 그대로다.
      { stays: seatStaysFor(seat, rosterByPeriod) },
    ),
  ]);

  /**
   * 드래그·초기화를 열 것인가 — **랩실 + 오늘(또는 지난 날짜 쓰기 권한) + 0254a 적용됨**.
   * 🔴 서버 액션이 같은 판정을 다시 한다([[#77]]) — 이 값은 화면을 정할 뿐 게이트가 아니다.
   */
  const canMovePlacement = seat === "lab" && !readOnly && placementsDay.ready;

  /**
   * **교시 선택**(0255a) — 하루에 자리 수업이 두 번 있는 반에서 "이 학생은 어느 쪽인가".
   * 🔴 배치(0254a)와 **다른 표·다른 가용성**이다 — 한쪽 SQL만 적용돼 있어도 나머지 한쪽은 돈다.
   * 🔑 교시를 건너는 드래그는 '전체' 보기에만 있다(교시가 하나면 건널 곳이 없다). 하지만 **감추기는
   *    두 보기 모두**에 적용된다 — 안 그러면 같은 날을 두 방식으로 열었을 때 명단이 갈린다.
   */
  const canChoosePeriod = seat === "lab" && !readOnly && periodChoiceLoad.ready;
  const periodChoices = resolveSeatPeriodChoices({
    moves: periodChoiceLoad.moves,
    pins: periodChoiceLoad.pins,
    date,
  });
  // 못 쓰는 이유는 **쓸 수 있어야 할 때만** 말한다(지난 날짜 조회 중엔 배너가 소음이다).
  const placementNotice = seat === "lab" && !readOnly && !placementsDay.ready ? placementsDay.reason : null;

  /**
   * 같은 날 교시 사이 신호 — **이미 받아 온 하루치**(`day`)에서 순수 함수로 뽑는다(왕복 0회).
   * 🔴 여기서 나오는 건 **제안·표시**일 뿐이다. 결석은 사람이 버튼을 눌러야 찍히고, 그때도 서버가
   *    대상을 다시 계산한다([[#77]]).
   */
  // 🔴 **선택을 얹은 명단**으로 잰다 — 서버 일괄(`fillSeatPrevAbsent`)이 같은 명단을 쓴다. 원본으로 재면
  //    다른 시간으로 옮긴 학생의 "앞 교시"가 화면과 서버에서 갈려 버튼의 N과 실제로 쓰는 수가 어긋난다.
  const cells = period ? seatDayCells(day.periods, rosterByPeriod) : null;
  // ⚠️ 모호한 반(같은 반·같은 시작·다른 종료)은 아무도 못 쓰는 칸이라 표식·수에서 뺀다 — 서버 일괄이
  //    쓰는 집합과 **같은 인자**여야 버튼의 "N명"이 실제로 쓰는 수와 맞는다.
  const prevAbsentFor = (start: string, blocked: string[]) =>
    cells ? prevPeriodAbsences(cells, start, blocked) : undefined;

  /** 교시 칩·'전체' 칩이 함께 쓰는 주소 앞자락 — 값만 뒤에 붙는다(두 곳에 문자열을 적지 않게). */
  const hrefFor = `/attendance/seat/${seat}?date=${date}&start=`;

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
        // 🔴 날짜를 여기 또 적지 않는다(원장 2026-09-10 ⑥) — 오른쪽 `PeriodNav`가 같은 줄에서 이미
        //    같은 날짜를 말하고 있었다. 기간 네비가 앱 전역 단일 소스라 남기는 쪽은 그쪽이다.
        embedLabel={SEAT_NAME[seat]}
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
      ) : viewAll ? (
        /**
         * **'전체' 보기** — 교시를 위에서 아래로 이어 붙인다(원장 2026-09-10 ⑨ *"스크롤링으로 시간대별로
         * 분리해서"*). 교시마다 제 요약 줄(시각·반 수·인원·체크)이 경계를 만든다.
         *
         * 🔴 **일괄 버튼은 교시 안에만** 둔다(요약 줄에 그대로 붙어 있다) — 하루치를 한 번에 찍는 버튼은
         *    만들지 않는다(오클릭 한 번이 하루를 뭉갠다).
         * 🔑 조회는 안 늘었다 — 명단·배치·다음 행선지 모두 위에서 하루치를 한 번 받아 나눈 것이다.
         */
        <>
          <SeatPeriodChips
            periods={day.periods.map((p) => ({ start: p.start, classIds: p.slots.map((s) => s.classId) }))}
            activeStart={SEAT_ALL_PERIODS}
            hrefFor={hrefFor}
            showAll={allowAllView}
          />
          <SeatAllDay
            seat={seat}
            date={date}
            moves={periodChoiceLoad.moves}
            pins={periodChoiceLoad.pins}
            // 🔑 하루치 재료를 통째로 넘긴다 — '전체' 보기는 낙관 반영 때문에 클라가 같은 순수 함수로 다시 접는다.
            choiceDay={{
              slotsByClass: day.slotsByClass,
              markedSlotsByCell: day.markedSlotsByCell,
              busyStartsByClass: day.busyStartsByClass,
              offSlotByCell: day.offSlotByCell,
            }}
            canMove={canChoosePeriod}
            readOnly={readOnly}
            hrefFor={hrefFor}
            canMovePlacement={canMovePlacement}
            placementNotice={placementNotice}
            periods={day.periods.map((p) => ({
              start: p.start,
              rosters: day.rosterByPeriod[p.start] ?? [],
              prevAbsentByCell: prevAbsentFor(p.start, ambiguousClassIds(p)),
              nextStartByStudent: nextBySlot[p.start]?.startByStudent,
              nextRoomByStudent: nextBySlot[p.start]?.roomByStudent,
              placements: placementsDay.bySlot[p.start] ?? [],
            }))}
          />
        </>
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
          showAllChip={allowAllView}
          activeStart={period.start}
          rosters={rosters}
          readOnly={readOnly}
          hrefFor={hrefFor}
          prevAbsentByCell={prevAbsentFor(period.start, ambiguousClassIds(period))}
          // 🔵 '다음 행선지'는 **로그인 화면에만** 내려간다 — 비로그인 PIN 화면(`/seat/:key`)엔 이 prop을
          //    아예 안 넘긴다(그 경로는 사유도 조회하지 않는다는 규약과 같은 결).
          nextStartByStudent={nextBySlot[period.start]?.startByStudent}
          nextRoomByStudent={nextBySlot[period.start]?.roomByStudent}
          placements={placementsDay.bySlot[period.start] ?? []}
          canMove={canMovePlacement}
          placementNotice={placementNotice}
          periodChoices={periodChoices}
          // 🔑 `rosters`는 이미 교시 선택을 얹은 명단이다(위 `applySeatDayChoices`) — 보드가 다시 거르지 않는다.
          choicesApplied
          canChoosePeriod={canChoosePeriod}
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

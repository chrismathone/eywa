import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { brandLabels, getPublicBranding } from "@/features/owner/server/public-branding";
import { getPublicSeatDay } from "@/features/attendance/seat/server/queries";
import { getSeatPeriodChoices } from "@/features/attendance/seat/server/period-choice";
import { resolveSeatPeriodChoices } from "@/features/attendance/seat/period-choice";
import { attachJjMarks } from "@/features/attendance/seat/server/jj-marks";
import { loadPublicSeatJjPlans } from "@/features/attendance/seat/server/jj-plan-public";
import { getSeatPlacements, getSeatPlacementsForDay } from "@/features/attendance/seat/server/placements";
import {
  getSeatNextDestinationsBySlot,
  type SeatNextDestination,
} from "@/features/attendance/seat/server/next-destination";
import { seatHasJjFields } from "@/features/attendance/seat/jj-fields";
import { prevPeriodAbsences, seatDayCells } from "@/features/attendance/seat/prev-period";
import { readSeatPinSession, resolvePinSigningSecret } from "@/features/attendance/seat/server/pin-session";
import {
  ambiguousClassIds,
  parseSeatKey,
  pickPeriodIndex,
  PIN_NOTE_SEATS,
  SEAT_NAME,
  SEAT_ROOM,
} from "@/features/attendance/seat/seat";
import { mondayOf } from "@/features/timetable/lib/week";
import { kstToday } from "@/lib/date-kst";
import { SeatBoard } from "@/app/(shell)/attendance/seat/[seat]/_components/seat-board";
import { SeatAllDay } from "@/app/(shell)/attendance/seat/[seat]/_components/seat-all-day";
import {
  SeatPeriodChips,
  SEAT_ALL_PERIODS,
} from "@/app/(shell)/attendance/seat/[seat]/_components/seat-period-chips";
import { SeatPinForm } from "./pin-form";

/**
 * 🔴 `noindex` — 이 주소는 로그인 없이 열리고 통과하면 **학생 명단**이 나온다. 검색엔진에 실리면
 * 주소가 새는 순간 비밀번호만 남는다(4자리). 크롤러가 못 담게 막는다.
 */
export const metadata: Metadata = {
  title: "자리 출석부",
  robots: { index: false, follow: false, nocache: true },
};

function kstNowHm(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

/**
 * 자리(랩실·JJ실) 공개 출석부 — 로그인 없음. PIN 쿠키가 있어야 오늘·**그 자리** 명단만 보인다.
 * 지난 날짜·다른 자리·학생 상세로 가는 길을 만들지 않는다.
 *
 * 🔴 **로그인 자리 출석부와 같은 화면**이다(원장 2026-09-10 *"seat/lab에서도 자리 출석부와 동일해야해"*) —
 *    다음 행선지 · '전체' 보기(랩실) · 특이사항(`PIN_NOTE_SEATS`, 원장 선택 *"읽기·쓰기 둘 다 열기"*)이 같다.
 *    ⚠️ **다른 것은 둘뿐**: ① 날짜는 오늘 고정 ② **드래그(자리·교시 이동)는 없다** — 원장이 *"이것도 감사로그에
 *    남아야함"*을 못박았는데 이 화면엔 옮긴 **사람**이 없다(출결 쓰기는 `랩실 PIN(비로그인)`으로 남는다).
 * 🔴 쿠키에 적힌 자리와 주소의 자리가 **다르면 다시 묻는다**(`session.seat !== seat`) — 랩실 비밀번호로
 *    JJ실을 열 수 없다. 자리마다 비밀번호가 따로이고 담당자도 다르다.
 */
export default async function PublicSeatPage({
  params,
  searchParams,
}: {
  params: Promise<{ seat: string }>;
  searchParams: Promise<{ start?: string }>;
}) {
  const { seat: seatParam } = await params;
  const { start: startParam } = await searchParams;
  const seat = parseSeatKey(seatParam);
  if (!seat) notFound();

  const branding = await getPublicBranding();
  const labels = brandLabels(branding);
  const session = await readSeatPinSession();

  if (!session || session.seat !== seat) {
    const blocked = !branding || !resolvePinSigningSecret();
    if (blocked) {
      return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-foreground text-lg font-bold">지금은 이 화면을 쓸 수 없습니다</p>
          <p className="text-text-dim max-w-sm text-sm">관리자에게 문의해 주세요.</p>
        </main>
      );
    }
    return <SeatPinForm seat={seat} seatName={SEAT_NAME[seat]} academyLine={labels.academyLine} />;
  }

  const date = kstToday();
  const day = await getPublicSeatDay(session.tenantId, seat, date);
  /**
   * **로그인 화면과 같게 연 자리**(랩실) — 특이사항 읽기·쓰기 · 다음 행선지 · '전체' 보기. 원장 2026-09-10 지시는
   * 랩실 한정이라 그 밖의 자리 PIN(JJ실)은 종전 규약(이 화면에 새 정보를 더하지 않는다) 그대로다.
   */
  const sameAsLogin = PIN_NOTE_SEATS.includes(seat);
  /**
   * '전체' 보기 — 로그인 화면과 같은 규칙(랩실만: JJ실은 교시마다 진도 블록이 붙어 하루치가 불어난다).
   * 🔴 `sameAsLogin`도 함께 본다 — 이 보기(`SeatAllDay`)는 특이사항 칸을 **늘 연다**(`publicPin`이 없다). 메모를
   *    조회하지 않는 자리에서 열리면 화면엔 안 보이는 유령 입력이 된다(적대적 리뷰 2026-09-10).
   */
  const allowAllView = seat === "lab" && sameAsLogin;
  const viewAll = allowAllView && startParam === SEAT_ALL_PERIODS;
  const fallbackIdx = pickPeriodIndex(day.periods, kstNowHm());
  const idx = startParam && !viewAll ? day.periods.findIndex((p) => p.start === startParam) : fallbackIdx;
  const period = day.periods[idx >= 0 ? idx : fallbackIdx] ?? null;
  /** 이번에 그릴 교시들 — '전체'면 오늘 전부, 아니면 고른 하나. */
  const shown = viewAll ? day.periods : period ? [period] : [];

  // 명단(듣기·단어)과 계획(진도)·배치·교시 선택·다음 행선지는 서로 독립이라 병렬(B4).
  // 🔴 계획 재료는 **그날 그 자리 그 교시 명단**에 있는 반만 온다 — 로그인 화면이 ECS 게이트로 고르는
  //    자리에서, 여기는 PIN 쿠키 + 오늘 + 명단 화이트리스트가 고른다(서버가 정하고 저장 때 다시 본다).
  const [rosters, plans, placements, periodChoiceLoad, nextBySlot, placementsDay] = await Promise.all([
    period && !viewAll && seatHasJjFields(seat)
      ? // JJ실은 듣기·단어 칸이 붙는다 — 이미 적힌 값을 안 보여주면 담당자가 빈 칸으로 보고 다시 적는다.
        attachJjMarks(day.rosterByPeriod[period.start] ?? [], session.tenantId, date, period.start)
      : Promise.resolve(period ? (day.rosterByPeriod[period.start] ?? []) : []),
    period && !viewAll
      ? loadPublicSeatJjPlans(seat, session.tenantId, date, period.start)
      : Promise.resolve({}),
    /**
     * 자리 **배치**(드래그로 옮긴 자리) — **보기만** 한다(이동 prop은 언제나 false).
     * 🔑 그래도 **읽기는 한다** — 안 그러면 같은 방을 보는 두 화면이 "누가 어디 앉아 있나"를 다르게
     *    말해 당번이 엉뚱한 카드를 찾는다(출결 귀속은 어느 쪽이든 원래 반으로 같다).
     */
    period && !viewAll
      ? getSeatPlacements(session.tenantId, seat, date, period.start)
      : Promise.resolve({ rows: [], ready: false, reason: null }),
    /**
     * 자리 **교시 선택**(0255a) — 배치와 **같은 이유로 읽는다**: 여기서 정하지는 못해도, 안 읽으면
     * 같은 방을 보는 두 화면이 서로 다른 명단을 말한다.
     */
    getSeatPeriodChoices(session.tenantId, seat, date),
    /**
     * **다음 행선지**(원장 2026-09-10 *"17:20 304호 가야함처럼"*) — 로그인 화면과 **같은 함수**다.
     * 🔴 세션이 없어 테넌트를 넘긴다 → admin + 명시 `tenant_id` 필터(격리선)로 읽는다.
     * 🔵 교시 여러 개를 한 벌로 — '전체' 보기가 왕복을 교시 수만큼 늘리지 않게(B6).
     * 🔴 **랩실 PIN만**(`sameAsLogin`) — JJ실 PIN엔 종전대로 안 싣는다(왕복도 0).
     */
    sameAsLogin
      ? getSeatNextDestinationsBySlot(
          [
            ...new Set(
              shown.flatMap((p) => (day.rosterByPeriod[p.start] ?? []).flatMap((r) => r.students.map((s) => s.id))),
            ),
          ],
          date,
          shown.map((p) => p.start),
          session.tenantId,
        )
      : Promise.resolve<Record<string, SeatNextDestination>>({}),
    // '전체' 보기의 배치는 하루치 한 번(교시는 화면에서 나눈다).
    viewAll ? getSeatPlacementsForDay(session.tenantId, seat, date) : Promise.resolve(null),
  ]);

  /**
   * 앞 교시 결석 — **이미 이 화면에 있는 사실**을 접은 것뿐이다(교시 칩을 눌러 앞 교시를 열면 그 결석이
   * 그대로 보인다). 이 일괄이 없으면 당번이 교시마다 스무 명을 다시 찍는다.
   */
  const cells = seatDayCells(day.periods, day.rosterByPeriod);
  const prevAbsentByCell = period
    ? prevPeriodAbsences(
        cells,
        period.start,
        // 모호한 반은 아무도 못 쓰는 칸이라 표식·수에서 뺀다(서버 일괄과 같은 집합).
        ambiguousClassIds(period),
      )
    : undefined;
  const periodChoices = resolveSeatPeriodChoices({
    moves: periodChoiceLoad.moves,
    pins: periodChoiceLoad.pins,
    date,
  });
  const hrefFor = `/seat/${seat}?start=`;

  // 🔴 본문 폭을 캡하지 않는다 — 셸 `<main>`(px-3 lg:px-6, max-w 없음)과 **같은 폭**이다.
  //    원장 2026-09-03: *"월별 출석부와 같은 화면 크기로. 접근 방법만 다르지 기능이 다르지 않기
  //    때문에"*(seat/jj 로 접속했을 때의 화면 너비).
  // ⚠️ loading.tsx도 **같은 클래스**여야 한다(다르면 스켈레톤에서 본문으로 폭이 튄다).
  // ⚠️ 하단 여백은 셸 `<main>`과 같은 `pb-8 lg:pb-10` — 크롬리스 라우트는 셸을 안 거치므로 직접 준다.
  return (
    <div className="flex min-h-screen flex-col gap-3 px-3 pt-4 pb-8 lg:px-6 lg:pb-10">
      <header className="shrink-0">
        <p className="text-text-dim text-xs font-medium">{labels.academyLine}</p>
        <h1 className="text-foreground text-xl font-bold tracking-tight">
          {SEAT_NAME[seat]} {SEAT_ROOM[seat]}
        </h1>
        <p className="text-text-dim text-sm">오늘</p>
      </header>
      {day.periods.length === 0 || !period ? (
        <EmptyState image="students" title={`오늘은 ${SEAT_NAME[seat]} 수업이 없습니다`} />
      ) : viewAll ? (
        /**
         * **'전체' 보기** — 로그인 화면과 같은 조각(`SeatAllDay`)이다. 🔴 **이동은 끈 채**다(드래그·교시 이동·
         * 해제 없음 — 옮긴 사람을 감사로그에 남길 수 없다). 특이사항은 연다(랩실 = `PIN_NOTE_SEATS`).
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
            slotsByClass={day.slotsByClass}
            markedSlotsByCell={day.markedSlotsByCell}
            canMove={false}
            readOnly={false}
            hrefFor={hrefFor}
            canMovePlacement={false}
            placementNotice={null}
            periods={day.periods.map((p) => ({
              start: p.start,
              rosters: day.rosterByPeriod[p.start] ?? [],
              prevAbsentByCell: prevPeriodAbsences(cells, p.start, ambiguousClassIds(p)),
              nextStartByStudent: nextBySlot[p.start]?.startByStudent,
              nextRoomByStudent: nextBySlot[p.start]?.roomByStudent,
              placements: placementsDay?.bySlot[p.start] ?? [],
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
          readOnly={false}
          // 🔴 특이사항(사유 메모)은 `PIN_NOTE_SEATS`(랩실)에서만 연다 — 원장 2026-09-10 "읽기·쓰기 둘 다 열기".
          //    다른 자리(JJ실)는 그대로 닫는다: 그 경로는 메모를 조회조차 안 하므로 입력만 열면 유령 기록이 된다.
          publicPin={!PIN_NOTE_SEATS.includes(seat)}
          hrefFor={hrefFor}
          prevAbsentByCell={prevAbsentByCell}
          nextStartByStudent={nextBySlot[period.start]?.startByStudent}
          nextRoomByStudent={nextBySlot[period.start]?.roomByStudent}
          // 🔴 이동 prop은 넘기지 않는다(기본 false) — 이 화면은 배치를 **보기만** 한다.
          placements={placements.rows}
          // 교시 선택도 **보기만** — 로그인 화면과 같은 명단을 그리려는 것이다(위 조회 주석).
          periodChoices={periodChoices}
          slotsByClass={day.slotsByClass}
          markedSlotsByCell={day.markedSlotsByCell}
          // 진도 구획은 명단에 오른 반 중 계획이 있는 반이 하나라도 있을 때만 — 없으면 prop 자체를 안 넘긴다.
          plans={
            Object.keys(plans).length > 0
              ? {
                  plans,
                  tenantId: session.tenantId,
                  // 계정이 없다 — 저널(IndexedDB) 문서 키의 사용자 축은 자리 키로 둔다(남의 이름을 쓰지 않는다).
                  userId: `seat:${seat}`,
                  // 저널 문서 키의 주차 — 영어 시트와 **같은 월요일** 규약.
                  weekMonday: mondayOf(date),
                  // 🔵 저장은 자리 PIN 문으로 나간다(ECS 게이트는 세션이 없어 전건 거절된다).
                  viaPin: true,
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

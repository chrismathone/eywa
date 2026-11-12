import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import {
  brandLabels,
  getPublicBranding,
  getPublicBrandingByTenantId,
  listPublicBranchChoices,
} from "@/features/owner/server/public-branding";
import { getPublicSeatDay } from "@/features/attendance/seat/server/queries";
import { applySeatDayChoices, getSeatPeriodChoices } from "@/features/attendance/seat/server/period-choice";
import { resolveSeatPeriodChoices } from "@/features/attendance/seat/period-choice";
import { attachJjMarks } from "@/features/attendance/seat/server/jj-marks";
import { loadPublicSeatJjPlans } from "@/features/attendance/seat/server/jj-plan-public";
import { getSeatPlacements, getSeatPlacementsForDay } from "@/features/attendance/seat/server/placements";
import {
  getSeatNextDestinationsBySlot,
  type SeatDayDestinations,
} from "@/features/attendance/seat/server/next-destination";
import { seatStaysFor } from "@/features/attendance/seat/next-destination";
import { seatHasJjFields } from "@/features/attendance/seat/jj-fields";
import { prevPeriodAbsences, seatDayCells } from "@/features/attendance/seat/prev-period";
import { readSeatPinSession, resolvePinSigningSecret } from "@/features/attendance/seat/server/pin-session";
import { isModuleOnForTenant } from "@/features/owner/server/modules";
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
import { SEAT_ALL_PERIODS } from "@/app/(shell)/attendance/seat/[seat]/_components/seat-period-chips";
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

  // 브랜드(머리 줄 표기)와 지점 목록은 서로 독립(B4). 브랜드는 장식이라 없어도 되고(제품 중립 표기), 지점 목록은
  // 로그인 폼이 어느 지점의 비밀번호로 검증할지를 정한다(결정 C 2026-09-18 — URL에 지점이 없어 화면이 고르게 한다).
  const [branding, branches, session] = await Promise.all([
    getPublicBranding(),
    listPublicBranchChoices(),
    readSeatPinSession(),
  ]);
  const labels = brandLabels(branding);

  // PIN 쿠키가 남아 있어도 그 지점이 자습실(자리) 모듈을 껐으면 명단을 그리지 않는다(2026-09-22 방향 B).
  // 침산은 켜져 있어 종전과 같다. 쿠키가 없거나 다른 자리면 판정할 지점이 없으니 그대로 PIN 폼으로.
  if (session && session.seat === seat && !(await isModuleOnForTenant(session.tenantId, "seat_attendance"))) {
    notFound();
  }

  if (!session || session.seat !== seat) {
    // 🔴 브랜드가 없어도 막지 않는다 — 학원이 둘 이상이면 브랜드 학원이 비어 있을 수 있는데(env 미설정) 그건
    //    지점 태블릿이 닫힐 이유가 아니다. 막는 건 학원이 0개거나 서명 비밀이 없을 때뿐.
    const blocked = branches.length === 0 || !resolvePinSigningSecret();
    if (blocked) {
      return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-foreground text-lg font-bold">지금은 이 화면을 쓸 수 없습니다</p>
          <p className="text-text-dim max-w-sm text-sm">관리자에게 문의해 주세요.</p>
        </main>
      );
    }
    return (
      <SeatPinForm
        seat={seat}
        seatName={SEAT_NAME[seat]}
        academyLine={labels.academyLine}
        branches={branches.length > 1 ? branches : undefined}
      />
    );
  }

  const date = kstToday();
  /**
   * 하루 명단 + 자리 **교시 선택**(0255a) — 서로 독립이라 병렬(B4). 로그인 화면과 같은 순서다: 선택을 **먼저** 받아야
   * 명단에 얹을 수 있다 — 다른 시간으로 옮긴 학생은 목표 교시에 서고 원래 교시에선 빠진다(다음 행선지·앞 교시
   * 결석도 옮긴 뒤 명단으로 잰다). 🔴 서버 쓰기 게이트(`rosterKeys`)와 **같은 함수**라 화면에 선 학생 = 찍을 수 있는
   * 학생이다(안 얹으면 옮겨 온 학생이 이 태블릿에 안 보여 못 찍는다).
   */
  const [day, periodChoiceLoad, seatBranding] = await Promise.all([
    getPublicSeatDay(session.tenantId, seat, date),
    getSeatPeriodChoices(session.tenantId, seat, date),
    // 통과한 뒤 머리 줄은 회사 브랜드가 아니라 **이 태블릿의 지점**(쿠키의 tenantId) 이름 — 지점이 둘 이상이면 둘이 다르다.
    getPublicBrandingByTenantId(session.tenantId),
  ]);
  const seatLabels = brandLabels(seatBranding);
  const rosterByPeriod = applySeatDayChoices(day, periodChoiceLoad, date);
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

  // 명단(듣기·단어)과 계획(진도)·배치·다음 행선지는 서로 독립이라 병렬(B4).
  // 🔴 계획 재료는 **그날 그 자리 그 교시 명단**에 있는 반만 온다 — 로그인 화면이 ECS 게이트로 고르는
  //    자리에서, 여기는 PIN 쿠키 + 오늘 + 명단 화이트리스트가 고른다(서버가 정하고 저장 때 다시 본다).
  const [rosters, plans, placements, nextDay, placementsDay] = await Promise.all([
    period && !viewAll && seatHasJjFields(seat)
      ? // JJ실은 듣기·단어 칸이 붙는다 — 이미 적힌 값을 안 보여주면 담당자가 빈 칸으로 보고 다시 적는다.
        attachJjMarks(rosterByPeriod[period.start] ?? [], session.tenantId, date, period.start)
      : Promise.resolve(period ? (rosterByPeriod[period.start] ?? []) : []),
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
     * **다음 행선지**(원장 2026-09-10 *"17:20 304호 가야함처럼"*) — 로그인 화면과 **같은 함수**다.
     * 🔴 세션이 없어 테넌트를 넘긴다 → admin + 명시 `tenant_id` 필터(격리선)로 읽는다.
     * 🔵 교시 여러 개를 한 벌로 — '전체' 보기가 왕복을 교시 수만큼 늘리지 않게(B6).
     * 🔴 **랩실 PIN만**(`sameAsLogin`) — JJ실 PIN엔 종전대로 안 싣는다(왕복도 0).
     * 🔴 이 자리 교시는 로그인 화면과 **같은 명단**(교시 선택을 얹은 `rosterByPeriod`)으로 잰다(`seatStaysFor`) —
     *    배치표로 재면 옮겨 나간 랩실을 안내하고 옮겨 가는 교시는 못 적는다.
     */
    sameAsLogin
      ? getSeatNextDestinationsBySlot(
          [
            ...new Set(
              // 🔑 **옮긴 뒤의 명단**으로 모은다 — 다른 시간에서 옮겨 온 학생도 그 교시의 다음 행선지를 받는다.
              shown.flatMap((p) => (rosterByPeriod[p.start] ?? []).flatMap((r) => r.students.map((s) => s.id))),
            ),
          ],
          date,
          shown.map((p) => p.start),
          { tenantId: session.tenantId, stays: seatStaysFor(seat, rosterByPeriod) },
        )
      : Promise.resolve<SeatDayDestinations>({ bySlot: {}, classesByStudent: {} }),
    // '전체' 보기의 배치는 하루치 한 번(교시는 화면에서 나눈다).
    viewAll ? getSeatPlacementsForDay(session.tenantId, seat, date) : Promise.resolve(null),
  ]);
  /** 교시 → 다음 행선지·**마지막 수업**(원장 2026-09-11) — JJ실 PIN은 조회를 안 하므로 비어 있다(= 모름, 아무것도 안 적는다). */
  const nextBySlot = nextDay.bySlot;

  /**
   * 앞 교시 결석 — **이미 이 화면에 있는 사실**을 접은 것뿐이다(교시 칩을 눌러 앞 교시를 열면 그 결석이
   * 그대로 보인다). 이 일괄이 없으면 당번이 교시마다 스무 명을 다시 찍는다.
   */
  // 🔴 **선택을 얹은 명단**으로 잰다 — 서버 일괄(`fillSeatPrevAbsent`)이 같은 명단을 쓴다(버튼의 N = 실제로 쓰는 수).
  const cells = seatDayCells(day.periods, rosterByPeriod);
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
        <p className="text-text-dim text-xs font-medium">{seatLabels.academyLine}</p>
        <h1 className="text-foreground text-xl font-bold tracking-tight">
          {SEAT_NAME[seat]} {SEAT_ROOM[seat]}
        </h1>
        <p className="text-text-dim text-sm">오늘</p>
      </header>
      {day.periods.length === 0 || !period ? (
        <EmptyState image="students" title={`오늘은 ${SEAT_NAME[seat]} 수업이 없습니다`} />
      ) : viewAll ? (
        /**
         * **'전체' 보기** — 로그인 화면과 같은 조각(`SeatAllDay`, 칩 줄까지 그 조각이 그린다)이다. 🔴 **이동은 끈 채**다
         * (드래그·교시 이동·해제 없음 — 옮긴 사람을 감사로그에 남길 수 없다). 그래서 학생 축 재료도 싣지 않는다.
         * 특이사항은 연다(랩실 = `PIN_NOTE_SEATS`).
         */
        <SeatAllDay
          seat={seat}
          date={date}
          shownStart={null}
          showAll={allowAllView}
          // 하루치 재료를 통째로 — '전체' 보기는 클라가 같은 순수 함수로 다시 접는다(로그인 화면과 같다).
          choiceDay={{
            moves: periodChoiceLoad.moves,
            pins: periodChoiceLoad.pins,
            slotsByClass: day.slotsByClass,
            markedSlotsByCell: day.markedSlotsByCell,
            busyStartsByClass: day.busyStartsByClass,
            offSlotByCell: day.offSlotByCell,
            // LAB '따로 수업(*LAB)' 배정 — 서버 명단(`applySeatDayChoices`)·쓰기 게이트와 같은 값(안 넘기면 화면만 두 교시에 세운다).
            ...(day.defaultSlotsByCell ? { defaultSlotsByCell: day.defaultSlotsByCell } : {}),
          }}
          canMove={false}
          readOnly={false}
          hrefFor={hrefFor}
          canMovePlacement={false}
          placementNotice={null}
          periods={day.periods.map((p) => ({
            start: p.start,
            ends: p.ends,
            classIds: p.slots.map((s) => s.classId),
            rosters: day.rosterByPeriod[p.start] ?? [],
            prevAbsentByCell: prevPeriodAbsences(cells, p.start, ambiguousClassIds(p)),
            nextStartByStudent: nextBySlot[p.start]?.startByStudent,
            nextRoomByStudent: nextBySlot[p.start]?.roomByStudent,
            lastByStudent: nextBySlot[p.start]?.lastByStudent,
            placements: placementsDay?.bySlot[p.start] ?? [],
          }))}
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
          lastByStudent={nextBySlot[period.start]?.lastByStudent}
          // 🔴 이동 prop은 넘기지 않는다(기본 false) — 이 화면은 배치를 **보기만** 한다.
          placements={placements.rows}
          // 교시 선택도 **보기만** — 로그인 화면과 같은 명단을 그리려는 것이다(위 조회 주석).
          periodChoices={periodChoices}
          // 🔑 `rosters`는 이미 교시 선택을 얹은 명단이다(위 `applySeatDayChoices`) — 보드가 다시 거르지 않는다.
          choicesApplied
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

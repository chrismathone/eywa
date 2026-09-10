import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { brandLabels, getPublicBranding } from "@/features/owner/server/public-branding";
import { getPublicSeatDay } from "@/features/attendance/seat/server/queries";
import { getSeatPeriodChoices } from "@/features/attendance/seat/server/period-choice";
import { resolveSeatPeriodChoices } from "@/features/attendance/seat/period-choice";
import { attachJjMarks } from "@/features/attendance/seat/server/jj-marks";
import { loadPublicSeatJjPlans } from "@/features/attendance/seat/server/jj-plan-public";
import { getSeatPlacements } from "@/features/attendance/seat/server/placements";
import { seatHasJjFields } from "@/features/attendance/seat/jj-fields";
import { prevPeriodAbsences, seatDayCells } from "@/features/attendance/seat/prev-period";
import { readSeatPinSession, resolvePinSigningSecret } from "@/features/attendance/seat/server/pin-session";
import {
  ambiguousClassIds,
  parseSeatKey,
  pickPeriodIndex,
  SEAT_NAME,
  SEAT_ROOM,
} from "@/features/attendance/seat/seat";
import { mondayOf } from "@/features/timetable/lib/week";
import { kstToday } from "@/lib/date-kst";
import { SeatBoard } from "@/app/(shell)/attendance/seat/[seat]/_components/seat-board";
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
  const fallbackIdx = pickPeriodIndex(day.periods, kstNowHm());
  const idx = startParam ? day.periods.findIndex((p) => p.start === startParam) : fallbackIdx;
  const period = day.periods[idx >= 0 ? idx : fallbackIdx] ?? null;

  // 명단(듣기·단어)과 계획(진도)은 서로 독립이라 병렬(B4).
  // 🔴 계획 재료는 **그날 그 자리 그 교시 명단**에 있는 반만 온다 — 로그인 화면이 ECS 게이트로 고르는
  //    자리에서, 여기는 PIN 쿠키 + 오늘 + 명단 화이트리스트가 고른다(서버가 정하고 저장 때 다시 본다).
  const [rosters, plans, placements, periodChoiceLoad] = await Promise.all([
    period && seatHasJjFields(seat)
      ? // JJ실은 듣기·단어 칸이 붙는다 — 이미 적힌 값을 안 보여주면 담당자가 빈 칸으로 보고 다시 적는다.
        attachJjMarks(day.rosterByPeriod[period.start] ?? [], session.tenantId, date, period.start)
      : Promise.resolve(period ? (day.rosterByPeriod[period.start] ?? []) : []),
    period
      ? loadPublicSeatJjPlans(seat, session.tenantId, date, period.start)
      : Promise.resolve({}),
    /**
     * 자리 **배치**(드래그로 옮긴 자리) — **보기만** 한다(`canMove`를 안 넘긴다).
     * 🔴 이 화면에서 옮기지는 못한다 — 원장이 *"이것도 감사로그에 남아야함"*을 못박았는데 여기엔
     *    로그인이 없어 실행자를 남길 수 없다(자리 출결의 무기명 갈래가 이미 감사 사각지대다).
     * 🔑 그래도 **읽기는 한다** — 안 그러면 같은 방을 보는 두 화면이 "누가 어디 앉아 있나"를 다르게
     *    말해 당번이 엉뚱한 카드를 찾는다(출결 귀속은 어느 쪽이든 원래 반으로 같다).
     * ⚠️ 새 정보를 더하는 게 아니라 **같은 명단을 다르게 묶어 보여줄 뿐**이라, 사유·다음 교시처럼
     *    공개 화면에서 빼는 축과는 결이 다르다.
     */
    period
      ? getSeatPlacements(session.tenantId, seat, date, period.start)
      : Promise.resolve({ rows: [], ready: false, reason: null }),
    /**
     * 자리 **교시 선택**(0255a) — 배치와 **같은 이유로 읽는다**: 여기서 정하지는 못해도, 안 읽으면
     * 같은 방을 보는 두 화면이 서로 다른 명단을 말한다(로그인 화면엔 없는 학생이 여기엔 서 있다).
     * 🔴 새 정보를 더하는 게 아니라 **같은 명단에서 뺄 사람을 빼는 것**이라, 사유·다음 교시처럼
     *    공개 화면에서 막는 축과는 결이 다르다.
     */
    getSeatPeriodChoices(session.tenantId, seat, date),
  ]);

  /**
   * 앞 교시 결석 — **이미 이 화면에 있는 사실**을 접은 것뿐이다(교시 칩을 눌러 앞 교시를 열면 그 결석이
   * 그대로 보인다). 그래서 공개 화면에도 내려보낸다. 이 일괄이 없으면 당번이 교시마다 스무 명을 다시 찍는다.
   *
   * 🔴 **'다음 교시'(`nextStartByStudent`)는 안 넘긴다** — 이 화면에 새 정보를 더하지 않는다는 규약
   *    (사유 메모를 조회조차 안 하는 것과 같은 결). 로그인 화면에만 붙는다.
   */
  const prevAbsentByCell = period
    ? prevPeriodAbsences(
        seatDayCells(day.periods, day.rosterByPeriod),
        period.start,
        // 모호한 반은 아무도 못 쓰는 칸이라 표식·수에서 뺀다(서버 일괄과 같은 집합).
        ambiguousClassIds(period),
      )
    : undefined;

  // 🔴 본문 폭을 캡하지 않는다 — 셸 `<main>`(px-3 lg:px-6, max-w 없음)과 **같은 폭**이다.
  //    원장 2026-09-03: *"월별 출석부와 같은 화면 크기로. 접근 방법만 다르지 기능이 다르지 않기
  //    때문에"*(seat/jj 로 접속했을 때의 화면 너비). 그전엔 `max-w-5xl`(1024px)이라 한 교시에 반이
  //    3개면 진도 붙은 열(440px×3=1,320px)이 통째로 잘려 가로로 끌어야 출결을 찍었다.
  // ⚠️ loading.tsx도 **같은 클래스**여야 한다(다르면 스켈레톤에서 본문으로 폭이 튄다).
  // ⚠️ 하단 여백은 셸 `<main>`과 같은 `pb-8 lg:pb-10` — 끝까지 내렸을 때 마지막 카드가 창 바닥에
  //    딱 붙지 않게(원장 2026-09-03, 전 화면 공통). 크롬리스 라우트는 셸을 안 거치므로 직접 준다.
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
          readOnly={false}
          // 🔴 비로그인 PIN 화면 — 사유 칸을 **안 그린다**. 이 경로는 사유(note)를 조회조차 안 하므로
          //    (병원·수술·가족 일정이 적힌다) 입력만 열어 두면 화면엔 영영 안 보이는 유령 기록이 된다.
          publicPin
          hrefFor={`/seat/${seat}?start=`}
          prevAbsentByCell={prevAbsentByCell}
          // 🔴 `canMove`는 넘기지 않는다(기본 false) — 이 화면은 배치를 **보기만** 한다.
          placements={placements.rows}
          // 교시 선택도 **보기만** — 로그인 화면과 같은 명단을 그리려는 것이다(위 조회 주석).
          periodChoices={resolveSeatPeriodChoices({
            moves: periodChoiceLoad.moves,
            pins: periodChoiceLoad.pins,
            date,
          })}
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

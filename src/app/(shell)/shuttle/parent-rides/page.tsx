import { FaceTabs } from "@/components/face-tabs";
import { kstToday, formatKoreanDate, isValidYmd } from "@/lib/date-kst";
import { ParentRidesDayNav } from "./_components/parent-rides-day-nav";
import { isShuttleAdmin, requireShuttleView } from "@/features/shuttle/server/access";
import { canRecordBoarding } from "@/features/shuttle/server/record-gate";
import {
  getBoardingsOn,
  getRideExceptionsOn,
  getShuttleBoard,
  getTripsOn,
} from "@/features/shuttle/server/queries";
import { getRegularChanges, getRideChangesOn } from "@/features/shuttle/ride-change/server/change-history-queries";
import { getParentAccounts, getParentLinkedStudentIds, getParentStudentOptions } from "@/features/shuttle/parent-accounts/server/parents";
import { parentAccountsActor } from "@/features/shuttle/parent-accounts/server/parent-access";
import { ParentAccountsButton } from "./_components/parent-accounts-button";
import { ParentRidesBoard } from "./_components/parent-rides-board";
import { buildRideLegs, type RideLeg } from "@/features/shuttle/parent/parent-rides";
import { ParentRideCard } from "@/features/shuttle/parent/components/parent-ride-card";
import { SHUTTLE_PARENT_RIDES_PATH, shuttleFaces } from "@/features/shuttle/faces";
import { SHUTTLE_PHONE_CONTROLS } from "@/features/shuttle/control-size";
import { isSeason, type Season } from "@/features/shuttle/types";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { monthLabel, shiftMonth } from "@/lib/month-grid";
import { SHUTTLE_CHIP, SHUTTLE_CHIP_OFF, SHUTTLE_CHIP_ON } from "@/features/shuttle/control-size";
import { loadStaffMonth } from "@/features/shuttle/parent/server/staff-month-data";
import { StaffMonthView } from "./_components/staff-month-view";
import { staffMonthCalendar } from "@/features/shuttle/parent/staff-month";

/**
 * [일별] [월별] 전환(사용자 2026-10-16 "학부모 계정에서 보는 것처럼 일별 월별로") — 주소 `?v=month&m=YYYY-MM`.
 * 일별 = 종전 화면 그대로 · 월별 = 학부모 월별 달력을 아이 한 줄씩 모은 표(StaffMonthTable).
 */
function viewHref(view: "day" | "month", opts: { season: Season; d?: string; m?: string }): string {
  const q = new URLSearchParams();
  if (view === "month") q.set("v", "month");
  if (opts.d) q.set("d", opts.d);
  if (opts.m) q.set("m", opts.m);
  if (opts.season !== "term") q.set("season", opts.season);
  const qs = q.toString();
  return qs ? `${SHUTTLE_PARENT_RIDES_PATH}?${qs}` : SHUTTLE_PARENT_RIDES_PATH;
}

/**
 * 면 탭 + 날짜(달) 이동 줄 — 공용 `SHUTTLE_TOOLBAR`에서 `toolbar-rail`만 뺐다(사용자 2026-10-19 "폰 화면일 때 깨지네").
 * 레일은 폰에서 한 줄 가로 스크롤이라 날짜 이동이 화면 밖(오른쪽)으로 밀려 안 보였다 — 여기선 **감는다**:
 * 폰 = 탭 한 줄(탭 자체가 가로 스크롤) + 날짜 이동 한 줄 · 넓으면 한 줄.
 */
const TOOLBAR = `flex flex-wrap items-center gap-2 ${SHUTTLE_PHONE_CONTROLS}`;

/** 설명 문장 + [일별][월별][학부모 관리 현황] 줄 — 폰에선 문장이 한 줄을 다 쓰고 버튼은 그 아래(문장이 버튼 옆에 끼어 세로로 꺾이던 것). */
const INTRO_ROW = "flex flex-wrap items-center justify-between gap-x-3 gap-y-2";
const INTRO_TEXT = "text-text-dim min-w-0 flex-1 basis-full text-sm break-keep md:basis-0";

function ViewToggle({ view, season, date, month }: { view: "day" | "month"; season: Season; date: string; month: string }) {
  const item = (v: "day" | "month", label: string, href: string) => (
    <Link href={href} aria-current={view === v ? "page" : undefined} className={cn(SHUTTLE_CHIP, view === v ? SHUTTLE_CHIP_ON : SHUTTLE_CHIP_OFF)}>
      {label}
    </Link>
  );
  return (
    <span className="flex shrink-0 items-center gap-1" role="group" aria-label="일별·월별 보기">
      {item("day", "일별", viewHref("day", { season, d: date }))}
      {item("month", "월별", viewHref("month", { season, m: month }))}
    </span>
  );
}

export const metadata = { title: "학부모 등하원 — aywa" };

/**
 * 학부모 등하원(관리자 뷰) — 오늘 셔틀을 타는 아이마다 **학부모에게 보이는 문장**과 그 근거(차량·회차·
 * 기록·직원 메모)를 나란히 보여준다. 학부모 뷰(`/parent`)와 같은 카드·같은 판정 함수다.
 *
 * 🔑 재료는 오늘 등하원과 같은 조회 4개(세션 클라이언트 + RLS) — 셔틀을 보는 직원이면 누구나 연다.
 *    학부모 계정 정보는 '연결됨' 여부만 싣는다(이메일·연락처는 학부모 관리 현황, 원장·관리자 전용).
 * 🔑 카드 맨 아래 **변경 내역**(누가·언제·어디서 어디로, 0321a 장부)은 직원 화면에만 있다 — 학부모 화면엔 없다.
 * 🔑 오른쪽 [학부모 관리 현황] 버튼(모달: 계정 목록 + 발급)은 **원장·관리자에게만** 선다 — 그 데이터
 *    조회 둘은 스스로 같은 판정을 보고 다른 역할엔 빈 배열을 돌려주므로, 함께 병렬로 부른다(B4).
 */
export default async function ShuttleParentRidesPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; d?: string; v?: string; m?: string }>;
}) {
  const user = await requireShuttleView();
  const sp = await searchParams;
  const season: Season = isSeason(sp.season) ? sp.season : "term";
  // 날짜 이동(다른 셔틀 날짜 면과 같은 `?d=`). 🔑 관리자 미리보기는 **그날의 실제 기록까지** 그 날짜로 본다 —
  //    학부모 화면은 오늘만 기록을 보이지만, 직원은 지난 날 "학부모에게 뭐라고 나갔었나"를 확인할 수 있어야 한다.
  const today = kstToday();
  const date = sp.d && isValidYmd(sp.d) ? sp.d : today;
  const view: "day" | "month" = sp.v === "month" ? "month" : "day";
  const month = sp.m && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m) ? sp.m : date.slice(0, 7);

  // 📅 월별 — 학원 전체 한 달(아이 한 줄 × 평일). 날짜를 누르면 그날 상세 모달(거기서 [관리자 수정하기]). 일별 재료(노선·기록·변경 내역)는 안 읽는다.
  if (view === "month") {
    const [monthData, showTrack, monthManager, monthAccounts, monthStudents, canEdit] = await Promise.all([
      loadStaffMonth(user.tenantId, month),
      isShuttleAdmin(),
      parentAccountsActor(),
      getParentAccounts(),
      getParentStudentOptions(),
      canRecordBoarding(),
    ]);
    const dayHref = (d: string) => viewHref("day", { season, d: d === today ? undefined : d });
    const holidays = Object.fromEntries(monthData.days.flatMap((d) => (d.holiday ? [[d.date, d.holiday] as const] : [])));
    const weeks = staffMonthCalendar({ month, today, holidays }, monthData);
    return (
      <div className="flex min-h-full w-full flex-col gap-3 p-3 md:px-5 md:py-4">
        <div className={TOOLBAR}>
          <span className="min-w-0 flex-1 basis-full lg:basis-auto">
            <FaceTabs faces={shuttleFaces(season, { track: showTrack })} active={SHUTTLE_PARENT_RIDES_PATH} ariaLabel="셔틀 면 전환" />
          </span>
          <span className="flex shrink-0 items-center gap-1" aria-label="달 이동">
            <Link href={viewHref("month", { season, m: shiftMonth(month, -1) })} className={cn(SHUTTLE_CHIP, SHUTTLE_CHIP_OFF)} aria-label="이전 달">
              ‹
            </Link>
            <span className="num min-w-28 text-center font-bold">{monthLabel(month)}</span>
            <Link href={viewHref("month", { season, m: shiftMonth(month, 1) })} className={cn(SHUTTLE_CHIP, SHUTTLE_CHIP_OFF)} aria-label="다음 달">
              ›
            </Link>
          </span>
        </div>
        <div className={INTRO_ROW}>
          <p className={INTRO_TEXT}>
            {monthLabel(month)} · 셔틀 {monthData.rows.length}명 — 달력 칸은 그날 학원 전체(탄 아이 수 + 챙길 아이 이름), 아래 표는 학부모 [월별] 달력을 아이마다 한 줄로 모은 것입니다. 달력 날짜·표 칸을 누르면 그날 상세가 뜹니다.
            {monthData.ok ? null : <span className="text-danger font-bold"> 이 달 기록을 불러오지 못했습니다 — 잠시 후 다시 열어 주세요.</span>}
          </p>
          <span className="flex shrink-0 flex-wrap items-center gap-2">
            <ViewToggle view="month" season={season} date={date} month={month} />
            {monthManager ? <ParentAccountsButton accounts={monthAccounts} students={monthStudents} /> : null}
          </span>
        </div>
        <StaffMonthView
          weeks={weeks}
          data={{ days: monthData.days, rows: monthData.rows }}
          today={today}
          dayHrefs={Object.fromEntries(monthData.days.map((d) => [d.date, dayHref(d.date)]))}
          season={season}
          canEdit={canEdit}
        />
      </div>
    );
  }

  const [board, { logs }, { exceptions }, tripsRes, changes, regularChanges, linked, manager, parentAccounts, parentStudents, canAck] = await Promise.all([
    getShuttleBoard(season),
    getBoardingsOn(date),
    getRideExceptionsOn(date),
    getTripsOn(date),
    // 변경 내역(0321a 장부) — 직원 전용. 학부모 화면엔 없다(사용자 2026-09-29).
    getRideChangesOn(date),
    // 고정(매주) 시간 변경 — 최근 60일(0322a 장부), 직원 전용.
    getRegularChanges(),
    getParentLinkedStudentIds(user.tenantId),
    parentAccountsActor(),
    getParentAccounts(),
    getParentStudentOptions(),
    // 변경 내역 [확인] = ackShuttleHistory의 게이트와 같은 함수(월별 화면의 canEdit과 같은 판정).
    canRecordBoarding(),
  ]);

  const legsByStudent = buildRideLegs({
    ymd: date,
    runs: board.runs,
    vehicles: board.vehicles,
    exceptions,
    logs,
    trips: tripsRes.trips,
    tripsReady: tripsRes.ready,
  });

  // 이름은 배정(또는 '오늘만 탐' 예외)에서 온다 — 기록만 있는 추가 탑승은 이름을 모른다.
  const who = new Map<string, { name: string; schoolGrade: string }>();
  for (const run of board.runs)
    for (const stop of run.stops)
      for (const r of stop.riders) who.set(r.studentId, { name: r.studentName, schoolGrade: r.schoolGrade });
  for (const e of exceptions) if (!who.has(e.studentId)) who.set(e.studentId, { name: e.studentName, schoolGrade: e.schoolGrade });

  const students = [...legsByStudent.keys()]
    .map((id) => ({ id, ...(who.get(id) ?? { name: "(이름 모름)", schoolGrade: "" }) }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const linkedCount = students.filter((s) => linked.has(s.id)).length;

  // 카드 하나 — [전체]는 그 아이 구간 전부, [호차별]은 그 호차 구간과 그 방향의 변경 내역만 싣는다.
  const card = (s: (typeof students)[number], legs: RideLeg[]) => {
    const dirs = new Set(legs.map((l) => l.direction));
    return (
      <ParentRideCard
        name={s.name}
        schoolGrade={s.schoolGrade}
        legs={legs}
        staff
        changes={(changes.get(s.id) ?? []).filter((c) => dirs.has(c.direction))}
        regularChanges={(regularChanges.get(s.id) ?? []).filter((c) => dirs.has(c.direction))}
        canAck={canAck}
        // 학부모 화면과 같이 노선 전체(어디서 몇 시에 타는지)를 편다 — 학부모가 보는 것을 그대로 확인.
        showRoute
        aside={
          linked.has(s.id) ? (
            <span className="bg-green-soft text-green shrink-0 rounded-full px-2 py-0.5 text-xs font-bold">학부모 계정 연결됨</span>
          ) : (
            <span className="bg-bg-soft text-text-dim shrink-0 rounded-full px-2 py-0.5 text-xs font-bold">학부모 계정 미연결</span>
          )
        }
      />
    );
  };

  // 호차별 묶음 — 차량 정렬순. 등·하원을 다른 차로 타는 아이는 두 묶음에 모두 들어간다.
  const vehicles = board.vehicles.map((v) => ({
    id: v.id,
    name: v.name,
    riders: students.flatMap((s) => {
      const legs = (legsByStudent.get(s.id) ?? []).filter((l) => l.vehicleId === v.id);
      if (legs.length === 0) return [];
      return [{
        studentId: s.id,
        card: card(s, legs),
        inCount: legs.filter((l) => l.direction === "in" && !l.skipped).length,
        outCount: legs.filter((l) => l.direction === "out" && !l.skipped).length,
      }];
    }),
  }));

  return (
    <div className="flex min-h-full w-full flex-col gap-3 p-3 md:px-5 md:py-4">
      <div className={TOOLBAR}>
        <span className="min-w-0 flex-1 basis-full lg:basis-auto">
          <FaceTabs faces={shuttleFaces(season, { track: await isShuttleAdmin() })} active={SHUTTLE_PARENT_RIDES_PATH} ariaLabel="셔틀 면 전환" />
        </span>
        <ParentRidesDayNav date={date} today={today} season={season} />
      </div>
      <div className={INTRO_ROW}>
        <p className={INTRO_TEXT}>
          {formatKoreanDate(date)} · {date === today ? "오늘" : "그날"} 셔틀 {students.length}명 · 학부모 계정 연결 {linkedCount}명 — 굵은 문장과
          노선이 학부모 화면에 그대로 보이는 것이고, 맨 아래 줄(차량·기록·메모)은 직원에게만 보입니다.
        </p>
        {/* [일별][월별]은 [학부모 관리 현황] 옆(사용자 2026-10-16 "학부모 관리 현황 옆에 배치"). */}
        <span className="flex shrink-0 flex-wrap items-center gap-2">
          <ViewToggle view="day" season={season} date={date} month={month} />
          {manager ? <ParentAccountsButton accounts={parentAccounts} students={parentStudents} /> : null}
        </span>
      </div>
      {students.length === 0 ? (
        <div className="border-line text-text-dim rounded-2xl border border-dashed p-8 text-center text-sm">
          {date === today ? "오늘" : "이 날"} 셔틀을 타는 원생이 없습니다.
        </div>
      ) : (
        <ParentRidesBoard
          students={students.map((s) => ({ id: s.id, name: s.name, card: card(s, legsByStudent.get(s.id) ?? []) }))}
          vehicles={vehicles}
        />
      )}
    </div>
  );
}

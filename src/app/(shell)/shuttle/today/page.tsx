import { kstToday } from "@/lib/date-kst";
import {
  getBoardingsOn,
  getRideExceptionsOn,
  getShuttleBoard,
  getTripsOn,
} from "@/features/shuttle/server/queries";
import { getAssignableStudents } from "@/features/shuttle/server/students";
import { getRiderContacts } from "@/features/shuttle/server/rider-contacts";
import { getRiderAttendance } from "@/features/shuttle/server/rider-attendance";
import { canRecordBoarding } from "@/features/shuttle/server/record-gate";
import { isShuttleAdmin, requireShuttleView } from "@/features/shuttle/server/access";
import { loadShuttleTodayPrefs } from "@/features/shuttle/today/server/today-prefs";
import { isSeason, type Season } from "@/features/shuttle/types";
import { DayBoardClient } from "./_components/day-board-client";

export const metadata = { title: "셔틀 — 에이와" };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 오늘 등하원 — 그날 타기로 되어 있는 사람(정기 배정 × 요일)과 실제 기록을 겹쳐 보여준다.
 * 🔴 기록이 없는 줄은 "미탑승"이 아니라 **아직 안 찍음**이다(roster.mergePlanAndLog 주석).
 *
 * 원장 2026-08-19: *"셔틀 등하원 기록도 모두 DB화"* — 여기서 찍은 것이 `shuttle_boardings`에 남고,
 * 출결 화면은 그중 미탑승만 **신호로** 읽는다(자동 결석 처리 없음).
 */
export default async function ShuttleTodayPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string; season?: string }>;
}) {
  // 열람 = 메뉴 권한 또는 '셔틀 담당' 토글(access.ts). 🔴 로그인 착지가 이 화면이라 토글 우회가
  // 없으면 착지 → 거부 → 착지로 무한히 돈다. 기록 자격은 아래 canRecordBoarding이 따로 본다.
  const user = await requireShuttleView();
  const sp = await searchParams;
  const date = sp.d && YMD.test(sp.d) ? sp.d : kstToday();
  const season: Season = isSeason(sp.season) ? sp.season : "term";

  // 🔴 편성 권한이 아니라 **기록** 권한(record-gate.ts) — 화면·액션이 같은 함수를 본다([[#77]]).
  // 🔑 이것만 먼저 받는 이유: '오늘만 탑승'에 세울 재원생 목록(수백 행)을 **찍을 수 있는 사람에게만**
  //    싣기 위해서다. 열람 전용 계정엔 쓸 데가 없는데 폰에서 첫 페인트만 늦춘다.
  //    비용은 거의 0이다 — 요청 캐시라 사무실 계정은 왕복 0(레이아웃이 이미 매트릭스를 받았다)이고,
  //    셔틀 담당(viewer)만 토글 조회 1왕복이 든다.
  const canWrite = await canRecordBoarding();

  // 나머지는 서로 독립 — 함께 받는다(B4).
  const [board, { ready, logs }, prefs, exceptionsRes, students, tripsRes] =
    await Promise.all([
      getShuttleBoard(season),
      getBoardingsOn(date),
      loadShuttleTodayPrefs(), // 호차 보기 = 계정 귀속(다른 기기에서도 같은 상태)
      getRideExceptionsOn(date), // 일회성 개입(0229a) — 표가 없으면 ready:false로 조용히 접힌다([[#95]])
      canWrite ? getAssignableStudents() : Promise.resolve([]),
      getTripsOn(date), // 운행 단위(0243a) — 표가 없으면 ready:false로 상태를 아예 안 그린다
    ]);

  // 📞 학생·학부모 전화번호 — 기록 권한이 있을 때만(사용자 2026-10-21). 그날 명단에 설 수 있는 학생 전부(편성 · 오늘만 승하차 · 기록).
  // ✓ 하원 줄의 그날 출석(사용자 2026-10-30 — 관리자 뷰) — 출석부를 **읽기만** 한다. 하원으로 설 수 있는 학생만.
  const showTrack = await isShuttleAdmin();
  const [contacts, attendance] = await Promise.all([
    canWrite
      ? getRiderContacts([
          ...board.runs.flatMap((r) => r.stops.flatMap((s) => s.riders.map((x) => x.studentId))),
          ...exceptionsRes.exceptions.map((e) => e.studentId),
          ...logs.map((l) => l.studentId),
        ])
      : Promise.resolve({}),
    showTrack
      ? getRiderAttendance(date, [
          ...board.runs.flatMap((r) => r.stops.flatMap((s) => s.riders.filter((x) => x.ioKind === "out").map((x) => x.studentId))),
          ...exceptionsRes.exceptions.filter((e) => e.ioKind === "out").map((e) => e.studentId),
          ...logs.filter((l) => l.ioKind === "out").map((l) => l.studentId),
        ])
      : Promise.resolve({}),
  ]);

  return (
    <div className="flex min-h-full w-full flex-col gap-3 p-3 md:px-5 md:py-4">
      {!board.ready && !ready ? (
        <div className="border-line bg-card text-text-dim rounded-2xl border border-dashed p-8 text-center text-sm">
          셔틀 표가 아직 준비되지 않았습니다 — 마이그레이션 <span className="num">0225a</span>를
          적용하면 바로 쓸 수 있습니다.
        </div>
      ) : (
        <DayBoardClient
          showTrack={showTrack}
          date={date}
          season={season}
          vehicles={board.vehicles}
          runs={board.runs}
          logs={logs}
          canWrite={canWrite}
          initialVehicle={prefs.vehicle}
          exceptions={exceptionsRes.exceptions}
          // 🔴 0229a 미적용이면 false — 화면이 "오늘만 탑승" 버튼을 **아예 안 그린다**.
          //    없는 기능을 버튼으로 약속하면 눌렀을 때 한글 에러만 나온다(거짓 약속 금지).
          exceptionsReady={exceptionsRes.ready}
          students={students}
          today={kstToday()}
          // 운행 단위(0243a). 🔴 ready가 false면 상태를 **아예 안 그린다** — 실제로 돌고 있는 차를
          //    "출발 전"이라고 말하지 않기 위해서다(전부 null이라 그냥 그리면 그렇게 보인다).
          trips={[...tripsRes.trips.entries()]}
          tripsReady={tripsRes.ready}
          // 실시간 반영 채널(테넌트 × 날짜) — 남이 찍은 것이 이 화면에도 바로 들어온다.
          tenantId={user.tenantId}
          contacts={contacts}
          attendance={attendance}
        />
      )}
    </div>
  );
}

import { notFound } from "next/navigation";
import { FaceTabs } from "@/components/face-tabs";
import { addDays, formatKoreanDate, kstToday } from "@/lib/date-kst";
import { schoolGradeLabel } from "@/features/grades/unified/model";
import { SHUTTLE_CLASSES_PATH, shuttleFaces } from "@/features/shuttle/faces";
import { weekDates } from "@/features/shuttle/parent/parent-rides";
import { loadAcademyHolidays, restDayName } from "@/features/shuttle/parent/server/rest-days";
import { isShuttleAdmin, requireShuttleView } from "@/features/shuttle/server/access";
import { loadShuttleRiderIds } from "@/features/shuttle/server/rider-ids";
import { isSeason, type Season } from "@/features/shuttle/types";
import { applyRiderFilter } from "@/features/shuttle/rider-filter";
import { getWeeklyScheduleWithStudents } from "@/features/timetable/server/queries";
import { getReservationsInRange } from "@/features/attendance/server/makeup-reservation-queries";
import { getShuttleBoard } from "@/features/shuttle/server/queries";
import { buildRunCards } from "@/features/shuttle/run-cards";
import { studentAssignments } from "@/features/shuttle/student-assignments";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { loadRecentScheduleChanges, SCHEDULE_CHANGE_DAYS } from "@/features/shuttle/server/schedule-changes";
import { loadRideConflictAcks } from "@/features/shuttle/server/conflict-acks";
import { loadWeekRideChanges } from "@/features/shuttle/server/week-ride-changes";
import { buildMakeupCards } from "./_components/makeup-cards";
import { RiderWeekSheet, type SheetClass } from "./_components/rider-week-sheet";

export const metadata = { title: "탑승 학생 시간표 — aywa" };

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"] as const;

/**
 * 셔틀 '탑승 학생 시간표'(사용자 2026-10-27) — **aywa 시간표와 같은 데이터**(`getWeeklyScheduleWithStudents`, 이번 주 명단)에서
 * 셔틀에 배정된 학생만 추려(`applyRiderFilter`) **월~금 고정 열** 시트로 보여 준다.
 * 🔑 aywa 시간표 기본뷰는 요일을 묶어(월수금·화목) 보여 주는데, 셔틀은 요일마다 보는 일이라 열을 월~금으로 못박았다(사용자 "월화수목금을 기본 베이스로").
 * 🔑 과목은 섞어서 보여 준다(셔틀은 과목을 안 가린다). 명단은 재원(active)만 — 대기·퇴원은 안 탄다.
 * 🔒 실시간 위치와 같은 원장·관리자·총괄 전용(`isShuttleAdmin`, 밖은 404). 보기만 한다.
 */
export default async function ShuttleRiderClassesPage({ searchParams }: { searchParams: Promise<{ season?: string }> }) {
  const user = await requireShuttleView();
  if (!(await isShuttleAdmin())) notFound();
  const sp = await searchParams;
  const season: Season = isSeason(sp.season) ? sp.season : "term";
  const today = kstToday();
  const week = weekDates(today);

  // 서로 독립 — 함께 받는다(B4).
  const [slots, riderIds, holidays, board, acks, weekChanges, canWrite] = await Promise.all([
    // 명단 기준일 = 시간표와 같은 규칙 — 이번 주면 오늘, 주말에 열어 다음 주를 보면 그 주 월요일.
    getWeeklyScheduleWithStudents({ referenceDate: week.some((w) => w.ymd === today) ? today : week[0]!.ymd, futureNames: true }),
    loadShuttleRiderIds(user.tenantId, season),
    loadAcademyHolidays(user.tenantId),
    // 배차(사용자 2026-10-29 "아이들 차량 배차를 시간표에") — 셔틀 섹션의 노선 편성(그 시즌 회차 → 정류장 → 탑승자).
    getShuttleBoard(season),
    // "수정된 내용" 확인 기록(계정 귀속) — 확인한 겹침은 다시 안 띄운다.
    loadRideConflictAcks(),
    // 그 주 그날만 변경(사용자 2026-11-04) — 오늘 등하원 [등하원 수정]·학부모 수정과 같은 표. 실패면 null(평소 배정만 + 안내).
    loadWeekRideChanges(user.tenantId, week.slice(0, 5).map((w) => ({ day: w.day, ymd: w.ymd }))),
    // 수정 카드 [고정으로 변경] = 노선 편성과 같은 편성 쓰기 권한(서버 액션이 다시 본다).
    canWriteTenant(user.systemRole, "shuttle"),
  ]);
  /** 배차 카드 — 회차 × 요일, 그날 타는 아이(수업 카드와 따로 칸에 선다). */
  const runCards = buildRunCards(board.runs, board.vehicles, weekChanges ?? []);
  /** 학생별 평소 배정 — 수정 카드가 노선 편성 편집기로 연다(보드가 실은 회차에서 접는다, 추가 조회 0). */
  const assignments = Object.fromEntries(studentAssignments(board.runs, board.vehicles));

  // 보강 예약(0264a) — 시간표 '보강' 탭·운영실 카드와 같은 조회. 반 집합은 이번 주 시간표의 반 전부, 학생은 탑승 학생만.
  const allClassIds = [...new Set(slots.filter((s) => !s.blockKind).map((s) => s.classId))];
  const reservations = riderIds ? await getReservationsInRange(week[0]!.ymd, week[4]!.ymd, allClassIds) : [];
  const makeups = riderIds ? buildMakeupCards(reservations, slots, riderIds, week) : [];
  // 최근 시간이 바뀐 수업 배치(사용자 2026-10-29 "수업 시간이 바뀌거나 보강이 있을 때만 알려") — 그 겹침만 '수정된 내용'으로 띄운다.
  const changedFrom = await loadRecentScheduleChanges(
    user.tenantId,
    slots.filter((s) => !s.blockKind).map((s) => s.id),
    addDays(week[0]!.ymd, -SCHEDULE_CHANGE_DAYS),
  );

  const regular: SheetClass[] = riderIds
    ? applyRiderFilter(
        slots
          .filter((s) => !s.blockKind && (WEEKDAYS as readonly string[]).includes(s.dayOfWeek))
          .map((s) => ({ ...s, students: s.students.filter((st) => st.status === "active") })),
        riderIds,
      ).map((s) => ({
        id: s.id,
        day: s.dayOfWeek,
        start: s.startTime.slice(0, 5),
        end: s.endTime.slice(0, 5),
        className: s.className,
        subject: s.subject,
        // 교시 담당(칸 라벨) → 반 담임 — aywa 시간표 칸과 같은 우선순위.
        teacher: s.slotTeacherLabel ?? s.teacherName ?? "",
        changedFrom: changedFrom.get(s.id),
        students: s.students.map((st) => ({ id: st.studentId, name: st.name, schoolGrade: schoolGradeLabel(st.school, st.grade) })),
      }))
    : [];
  const classes = [...regular, ...makeups];

  return (
    <div className="flex min-h-full w-full flex-col gap-3 p-3 md:px-5 md:py-4">
      <FaceTabs faces={shuttleFaces(season, { track: true })} active={SHUTTLE_CLASSES_PATH} ariaLabel="셔틀 면 전환" />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-bold">탑승 학생 시간표</h1>
        <span className="text-text-dim text-sm">
          {season === "term" ? "학기중" : "방학중"} 셔틀 배정 학생 {riderIds?.size ?? 0}명 · {formatKoreanDate(week[0]!.ymd).replace(/^\d{4}년 /, "")} ~{" "}
          {formatKoreanDate(week[4]!.ymd).replace(/^\d{4}년 /, "")}
        </span>
      </div>
      {riderIds === null ? (
        <p className="bg-card text-text-dim rounded-2xl p-6 text-center text-sm shadow-[var(--shadow-card)]">
          셔틀 배정 명단을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.
        </p>
      ) : (
        <RiderWeekSheet
          classes={classes}
          runCards={runCards}
          acks={acks}
          week={week.map((w) => ({ ...w, rest: restDayName(holidays, w.ymd) }))}
          today={today}
          season={season}
          changesFailed={weekChanges === null}
          assignments={assignments}
          canWrite={canWrite}
        />
      )}
    </div>
  );
}

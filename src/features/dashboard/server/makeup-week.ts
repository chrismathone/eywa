import "server-only";

/**
 * 운영실 KPI **'보강예정'**(원장 2026-09-14 *"대시보드에도 '보강예정' 카드 추가 최상단"*) — **이번 주**(월~일, KST)에
 * 잡힌 보강 예약(0264a, 아직 안 한 것).
 *
 * 🔑 카드 숫자 = 팝업 목록 = ↗ 시간표 '보강' 탭(이번 주) — 셋이 **같은 두 함수**를 지난다:
 *    반 집합 `listMakeupScopeClasses`(관리자 = 활성 반 전부 · 강사 = 담임∪위임∪교시 담당) + `getReservationsInWeek`.
 *    시간표 탭은 거기에 과목 축만 더 가른다(탭이 과목별) — 전 과목 합이 이 카드다.
 * 🔴 창은 **이번 주 전체**(오늘 이전 요일 포함) **+ 지난 60일의 미이행 예약** — 지난 요일·지난 주에 이행 안 된 예약은
 *    "안 한 보강"이라 숨기면 안 된다(월요일에 카드에서 사라지던 것, 적대 리뷰 2026-09-14). 둘 다 `overdue`로 표시된다.
 *    이번 주 뒤로 잡힌 예약은 `later`로 따로 센다(카드 보조 줄). ⚠️ 시간표 보강 탭은 **그 주 격자**라 지난 주 미이행은 그 주로
 *    이동해야 보인다(카드 팝업이 날짜를 적는다).
 */
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { shiftDays, weekBoundsOf } from "@/features/timetable/lib/week";
import { listMakeupScopeClasses } from "@/features/attendance/server/makeup-reservation-scope";
import { getReservationsInWeek, toReservation } from "@/features/attendance/server/makeup-reservation-queries";

/** 지난 미이행 예약을 되짚는 창(일) — 두 달 전 보강을 아직 안 했으면 데스크가 정리할 일이지 매주 카드에 실을 일은 아니다. */
const OVERDUE_LOOKBACK_DAYS = 60;

export type WeekMakeupRow = {
  id: string;
  studentId: string;
  name: string;
  schoolGrade: string | null;
  classId: string;
  className: string;
  makeupDate: string;
  slotStart: string;
  slotEnd: string;
  periodLabel: string | null;
  absenceDate: string;
  /** 오늘 이전 요일인데 아직 이행 안 됨 — 팝업이 '지남'으로 표시한다. */
  overdue: boolean;
};

export type WeekMakeupOverview = {
  week: { start: string; end: string };
  rows: WeekMakeupRow[];
  /** 이번 주 뒤로 잡힌 예약 수(정보용 — 카드 집합엔 안 든다). */
  later: number;
};

export async function getWeekMakeupOverview(today: string, teacherId: string | null): Promise<WeekMakeupOverview> {
  const week = weekBoundsOf(today);
  const classes = await listMakeupScopeClasses(teacherId, week);
  const classIds = classes.map((c) => c.id);
  const classById = new Map(classes.map((c) => [c.id, c]));
  const supabase = await createClient();
  const [thisWeek, laterRows, overdueRaw] = await Promise.all([
    getReservationsInWeek(today, classIds),
    classIds.length === 0
      ? Promise.resolve([] as { id: string }[])
      : fetchInChunks<{ id: string }>(classIds, (chunk) =>
          supabase
            .from("makeup_reservations")
            .select("id")
            .eq("status", "reserved")
            .gt("makeup_date", week.end)
            .in("class_id", chunk),
        ).catch(() => [] as { id: string }[]),
    // 지난 주(들)의 미이행 예약 — 이번 주 창 앞 60일. 반 id 청크(B3), 한 반의 두 달 예약이 1,000행을 넘을 수 없다.
    classIds.length === 0
      ? Promise.resolve([] as Parameters<typeof toReservation>[0][])
      : fetchInChunks<Parameters<typeof toReservation>[0]>(classIds, (chunk) =>
          supabase
            .from("makeup_reservations")
            .select("id, student_id, class_id, absence_date, makeup_date, slot_start, slot_end, period_label, note, status, created_by")
            .eq("status", "reserved")
            .lt("makeup_date", week.start)
            .gte("makeup_date", shiftDays(today, -OVERDUE_LOOKBACK_DAYS))
            .in("class_id", chunk)
            .order("makeup_date")
            .order("slot_start"),
        ).catch(() => [] as Parameters<typeof toReservation>[0][]),
  ]);
  const reservations = [...overdueRaw.map(toReservation), ...thisWeek];
  const studentIds = [...new Set(reservations.map((r) => r.studentId))];
  const students = studentIds.length
    ? await fetchInChunks<{ id: string; name: string; grade: string | null; school: string | null }>(
        studentIds,
        (chunk) => supabase.from("students").select("id, name, grade, school").in("id", chunk),
      ).catch(() => [] as { id: string; name: string; grade: string | null; school: string | null }[])
    : [];
  const studentById = new Map(students.map((s) => [s.id, s]));
  const rows: WeekMakeupRow[] = reservations.flatMap((r) => {
    const stu = studentById.get(r.studentId);
    const cls = classById.get(r.classId);
    if (!stu || !cls) return [];
    return [
      {
        id: r.id,
        studentId: r.studentId,
        name: stu.name,
        schoolGrade: schoolGradeLabel(stu.school, stu.grade) || null,
        classId: r.classId,
        className: cls.className,
        makeupDate: r.makeupDate,
        slotStart: r.slotStart,
        slotEnd: r.slotEnd,
        periodLabel: r.periodLabel,
        absenceDate: r.absenceDate,
        overdue: r.makeupDate < today,
      },
    ];
  });
  rows.sort((a, b) => a.makeupDate.localeCompare(b.makeupDate) || a.slotStart.localeCompare(b.slotStart) || a.name.localeCompare(b.name, "ko"));
  return { week, rows, later: laterRows.length };
}

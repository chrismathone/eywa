import "server-only";

/**
 * 운영실 KPI **'보강예정'**(원장 2026-09-14 *"대시보드에도 '보강예정' 카드 추가"*) — **오늘부터 한 달** 안에 잡힌 보강 예약
 * (0264a, 아직 안 한 것) + 지난 미이행. 창은 원장 2026-09-16 *"오늘 기준으로 1달 이내로 바꿔줘"*로 **이번 주(월~일)에서 넓혔다**.
 *
 * 🔑 카드 숫자 = 팝업 목록 — **같은 배열**(`rows`). 창은 [`monthAheadWindow`](../overview/upcoming-window.ts) 한 함수이고
 *    '레벨테스트 및 첫수업 일정' 패널과 **끝 날짜가 같다**(원장 *"배선 오류 없이 아주 모든 곳에서 일치하도록"*).
 * 🔑 반 집합 `listMakeupScopeClasses`(관리자 = 활성 반 전부 · 강사 = 담임∪위임∪교시 담당)와 조회 `getReservationsInRange`는
 *    시간표 '보강' 탭과 **같은 두 함수**다. 탭은 **그 주(월~일) · 과목 하나**로 좁혀 보는 격자라, 카드 숫자는 탭을 주마다
 *    넘기며 과목마다 본 합(+ 지난 미이행)이다 — 탭 한 화면의 숫자와 같다고 적지 말 것.
 *    ⚠️ 강사 범위(겸직 강사뷰)는 반 집합을 **이번 주** 기준으로 한 번만 뽑는다 — 창 안에서 담당이 바뀌는 반(예: 10/1 인수인계)은
 *    그 뒤 주의 예약이 옛 담당 카드에 남고 새 담당 카드엔 빠져, 그 주의 탭(그 주 반 집합)과 다를 수 있다. 관리자는 해당 없음.
 * 🔴 **지난 60일의 미이행 예약**도 싣는다(`overdue`) — 이행 안 된 예약은 "안 한 보강"이라 날이 지났다고 숨기면 안 된다
 *    (적대 리뷰 2026-09-14). 창 뒤로 잡힌 예약은 `later`로 따로 센다(카드 보조 줄 · 카드 집합엔 안 든다).
 */
import { createClient } from "@/lib/supabase/server";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { shiftDays, weekBoundsOf } from "@/features/timetable/lib/week";
import { listMakeupScopeClasses } from "@/features/attendance/server/makeup-reservation-scope";
import { getReservationsInRange } from "@/features/attendance/server/makeup-reservation-queries";
import { monthAheadWindow, type DateWindow } from "@/features/dashboard/overview/upcoming-window";
import { loadNativeParticipants, rowsOrThrow } from "@/features/makeups/server/adapters/participants";

/** 지난 미이행 예약을 되짚는 창(일) — 두 달 전 보강을 아직 안 했으면 데스크가 정리할 일이지 매번 카드에 실을 일은 아니다. */
const OVERDUE_LOOKBACK_DAYS = 60;

/** `in()` 청크 크기(B3) — `fetchInChunks` 기본값과 같다. */
const CLASS_CHUNK = 100;

export type UpcomingMakeupRow = {
  id: string;
  studentId: string;
  name: string;
  schoolGrade: string | null;
  classId: string;
  className: string;
  makeupDate: string;
  slotStart: string;
  slotEnd: string;
  /** 보강 예약을 실제로 등록한 직원 이름(created_by). */
  createdByName: string | null;
  absenceDate: string;
  /** 오늘 이전인데 아직 이행 안 됨 — 팝업이 '지남'으로 표시한다. */
  overdue: boolean;
  origin: "reservation" | "native" | "additional";
};

export type UpcomingMakeupOverview = {
  /** 이 카드가 센 창(오늘 ~ 한 달 뒤 전날) — 카드 보조 줄·팝업 머리가 **이 값**을 읽는다. */
  range: DateWindow;
  rows: UpcomingMakeupRow[];
  /** 창 뒤로 잡힌 예약 수(정보용 — 카드 집합엔 안 든다). */
  later: number;
};

type Sb = Awaited<ReturnType<typeof createClient>>;

/** 창 뒤 예약 수 — 세기만 하므로 행을 받지 않는다(B2 `count: exact, head`). 반 id는 청크로(B3). */
async function countLater(supabase: Sb, after: string, classIds: readonly string[]): Promise<number> {
  if (classIds.length === 0) return 0;
  const chunks: string[][] = [];
  for (let i = 0; i < classIds.length; i += CLASS_CHUNK) chunks.push(classIds.slice(i, i + CLASS_CHUNK));
  const counts = await Promise.all(
    chunks.map(async (chunk) => {
      const { count, error } = await supabase
        .from("makeup_reservations")
        .select("id", { count: "exact", head: true })
        .eq("status", "reserved")
        .gt("makeup_date", after)
        .in("class_id", chunk);
      if (error) throw error;
      return count ?? 0;
    }),
  );
  return counts.reduce((sum, n) => sum + n, 0);
}

/**
 * 창 뒤 예약 수를 **반별로** — 과목 관리자 카드가 담당 과목 반의 수만 더한다(원장 2026-10-14 2단계). 과목 값이 필요할 때만 부른다
 * (원장 화면은 위 `countLater` 그대로). 반 id 한 칸만 받는다(창 뒤 '예약' 상태만이라 수십 건 수준). 반 id는 청크 · 청크 안은 페이지(B2·B3).
 */
async function countLaterByClass(supabase: Sb, after: string, classIds: readonly string[]): Promise<Map<string, number>> {
  const rows = await fetchAllPagedInChunks<{ class_id: string }>(
    [...classIds],
    (chunk, from, to) =>
      supabase
        .from("makeup_reservations")
        .select("class_id")
        .eq("status", "reserved")
        .gt("makeup_date", after)
        .in("class_id", chunk)
        .order("id")
        .range(from, to),
    CLASS_CHUNK,
  );
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.class_id, (out.get(r.class_id) ?? 0) + 1);
  return out;
}

/**
 * 보강예정 카드 원본 + 과목으로 다시 가를 재료(반 → 과목 · 반별 창 뒤 예약 수). 운영실은 이것을 받아 과목 관리자 값을 만든다.
 * 재료는 스냅샷에 싣지 않는다(반 id별 숫자는 화면에 필요 없다).
 */
export async function loadUpcomingMakeup(today: string, teacherId: string | null, byClass = false): Promise<{
  overview: UpcomingMakeupOverview;
  subjectOf: ReadonlyMap<string, string>;
  laterByClass: ReadonlyMap<string, number>;
}> {
  const range = monthAheadWindow(today);
  // 🔴 반 집합("누구의 반인가")은 **이번 주(월~일)** 기준 그대로 — 시간표 보강 탭이 이번 주에 고르는 반과 같다.
  //    한 달 창으로 넓히면 강사 범위에서 다음 달에 교시가 시작될 **남의 반** 예약이 섞이고, 월요일~어제 끝난 교시·위임 반이
  //    빠진다(적대 리뷰 2026-09-16). 관리자(teacherId null)는 기간과 무관하게 활성 반 전부다.
  const classes = await listMakeupScopeClasses(teacherId, weekBoundsOf(today));
  const classIds = classes.map((c) => c.id);
  const classById = new Map(classes.map((c) => [c.id, c]));
  const supabase = await createClient();
  const [reservations, later, nativeOutcome] = await Promise.all([
    // 지난 60일(미이행) ~ 창 끝을 **한 조회**로 — 오늘 이전 날짜가 곧 `overdue`다. 시간표 탭과 같은 함수(fail-soft).
    getReservationsInRange(shiftDays(today, -OVERDUE_LOOKBACK_DAYS), range.end, classIds),
    byClass
      ? countLaterByClass(supabase, range.end, classIds).catch(() => new Map<string, number>())
      : countLater(supabase, range.end, classIds).catch(() => 0),
    loadNativeParticipants({ date_from: shiftDays(today, -OVERDUE_LOOKBACK_DAYS), date_to: range.end, limit: 500 }, { sharedRead: true }),
  ]);
  const native = (nativeOutcome.status === "off" || nativeOutcome.status === "schema_missing"
    ? []
    : rowsOrThrow(nativeOutcome)).filter((row) => row.classId && classIds.includes(row.classId) && row.status !== "cancelled");
  const studentIds = [...new Set([...reservations.map((r) => r.studentId), ...native.map((row) => row.studentId)])];
  const creatorIds = [...new Set(reservations.flatMap((r) => r.createdBy ? [r.createdBy] : []))];
  // 🔴 이름 조회 실패는 **삼키지 않는다** — 빈 배열로 접으면 모든 줄이 걸러져 카드가 "0건", 팝업이 "예약이 없습니다"라는
  //    거짓 사실을 말한다(적대 리뷰 2026-09-16). 던지면 이 칸만 "조회 실패"로 뜬다(운영실 영역 단위 실패 규약).
  const [students, creators] = await Promise.all([
    fetchInChunks<{ id: string; name: string; grade: string | null; school: string | null }>(
      studentIds,
      (chunk) => supabase.from("students").select("id, name, grade, school").in("id", chunk),
    ),
    // 세션 RLS로 같은 학원의 예약자만 조회한다. 퇴사자도 남기며, 원반 담임으로 대신 채우지 않는다.
    fetchInChunks<{ id: string; display_name: string | null }>(
      creatorIds,
      (chunk) => supabase.from("users").select("id, display_name").in("id", chunk),
    ),
  ]);
  const studentById = new Map(students.map((s) => [s.id, s]));
  const creatorById = new Map(creators.map((c) => [c.id, c.display_name?.trim() || null]));
  const rows: UpcomingMakeupRow[] = reservations.flatMap((r) => {
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
        createdByName: r.createdBy ? creatorById.get(r.createdBy) ?? null : null,
        absenceDate: r.absenceDate,
        overdue: r.makeupDate < today,
        origin: "reservation",
      },
    ];
  });
  const seen = new Set(rows.map((row) => `${row.studentId}|${row.classId}|${row.makeupDate}|${row.slotStart}`));
  for (const row of native) {
    const stu = studentById.get(row.studentId);
    const cls = row.classId ? classById.get(row.classId) : undefined;
    if (!stu || !cls) throw new Error("보강 참여 학생을 확인하지 못했습니다");
    const slotStart = (row.startTime ?? "").slice(0, 5);
    const key = `${row.studentId}|${row.classId}|${row.sessionDate}|${slotStart}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      id: row.id, studentId: row.studentId, name: stu.name,
      schoolGrade: schoolGradeLabel(stu.school, stu.grade) || null,
      classId: row.classId!, className: cls.className, makeupDate: row.sessionDate,
      slotStart, slotEnd: (row.endTime ?? "").slice(0, 5), createdByName: null,
      absenceDate: row.originalDate ?? "", overdue: row.sessionDate < today, origin: "native",
    });
  }
  rows.sort((a, b) => a.makeupDate.localeCompare(b.makeupDate) || a.slotStart.localeCompare(b.slotStart) || a.name.localeCompare(b.name, "ko"));
  const total = typeof later === "number" ? later : [...later.values()].reduce((sum, n) => sum + n, 0);
  return { overview: { range, rows, later: total }, subjectOf: new Map(classes.map((c) => [c.id, c.subject])), laterByClass: typeof later === "number" ? new Map() : later };
}

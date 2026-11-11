import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSpecialLecture } from "@/features/classes/special-lecture";
import { buildChurnModel } from "@/features/teacher-portfolio/model/churn-model";
import { buildHomeroomOwner } from "@/features/teacher-portfolio/model/context";
import { buildStudentTracking } from "@/features/teacher-portfolio/model/students";
import { loadChurnSource } from "@/features/teacher-portfolio/server/churn-source";
import { isKoreanTeacherName } from "@/features/timetable/lib/teacher-label";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { endedWithExit } from "../reason-key";
import { SHEET_TEACHER_PREFIX, sheetTeacherName, sheetTeachersFor } from "../sheet-teachers";
import { loadSheetTeacherIndex } from "./sheet-teachers";
import { exitHomeroomIds, type HomeroomReport, type HomeroomRow, type HomeroomSlot } from "../exit-homeroom";
import { withdrawalMonthWindow } from "../window";
import { OVERLAY_LOOKBACK_DAYS, churnMonthOf, churnTeachersOf, churnZeroIds, type ChurnMonth, type ChurnView } from "../exit-overlay-teachers";

type ChurnSourceData = Awaited<ReturnType<typeof loadChurnSource>>;

/**
 * 그만둔 줄의 **담당 선생님 판정** — 시간표 X 겹침과 퇴원관리 '강사별'이 이 한 벌을 부른다(원장 2026-10-14 *"모든 데이터가
 * 일치해야함"* · 2026-10-15 퇴원관리 강사별). 담당 = 강사평가 퇴원율이 그 퇴원을 센 선생님(같은 재료 `loadChurnSource` · 같은 담임
 * 판정 `buildHomeroomOwner` · 같은 명단 `buildStudentTracking` · 같은 계산 `buildChurnModel` · 원장이 고른 세는 법).
 * 🔑 달별 퇴원율은 **물어본 달만** 계산해 기억한다 — 퇴원율은 수강이 끝난 달로 세서(`churnMonthOf`) 줄의 달과 어긋날 수 있다.
 *    전에는 X가 기준 달 앞뒤 몇 달만 미리 계산해, 그 밖의 달에 끝난 수강(수강종료로 남았다 늦게 퇴원 처리된 학생)은 선생님을 못 찾았다.
 * 🔴 `end`는 호출부가 **이번 달 말일**로 고정한다(강사평가 진행 중인 달과 같은 끝) — 끝이 움직이면 '같은 과목 계속 다님'이
 *    다음 달 수강을 읽느냐로 갈려 같은 줄의 선생님이 바뀐다(적대 리뷰 2026-10-14). `from`은 가장 이른 줄의 달보다 다섯 달 앞
 *    1일(함께 끝난 수강을 찾는 폭 120일 + 퇴원율 분모인 앞달)이면 충분하다.
 */
export type ExitTeacherJudge = {
  source: ChurnSourceData;
  owner: ReturnType<typeof buildHomeroomOwner>;
  /** 특강·보강 묶음 반 — 퇴원율이 안 세는 반. */
  irregular: ReadonlySet<string>;
  /** 이 학생이 `date`에 이 과목을 그만둔 것 — 퇴원율이 센 달과 그 퇴원과 함께 끝난 수강의 종료 사유. */
  endedOf(studentId: string, subject: string, date: string): { endMonth: string; endReasons: (string | null)[] };
  /** 화면의 담당 = 그만둘 때 다니던 반의 그날 담임(`exit-homeroom.ts` — 퇴원생 관리 차트와 같은 기준). 없으면 빈 배열. */
  homeroomOf(studentId: string, subject: string, date: string): string[];
  /**
   * 퇴원생 관리 차트의 담당선생님(`sheet-teachers.ts` — `SHEET_LAST_MONTH`까지 · 원장 2026-11-11 *"시트가 지금 정확한 데이터니까"*).
   * 이름 → 계정 id(같은 이름이 하나일 때) · 못 이으면 `sheet:이름`. 시트에 그 줄이 없으면 null → `homeroomOf`로.
   */
  sheetTeachersOf(name: string, subject: string, months: readonly string[]): string[] | null;
  /** 그 그만둠을 `month` 퇴원율에 넣은 선생님 id(없으면 빈 배열 = 선생님 미반영) — 점수 판정용(시간표 X의 '세지 않음' 판정). */
  teachersOf(studentId: string, subject: string, month: string): string[];
  /** 그 달 이 과목 퇴원율이 0인 선생님 id. */
  zeroIdsOf(subject: string, month: string): string[];
};

export async function loadExitTeacherJudge(
  tenantId: string,
  range: { from: string; end: string },
  clock: { today: string; thisMonth: string },
): Promise<ExitTeacherJudge> {
  const admin = createAdminClient();
  const [source, staff, sheetIndex] = await Promise.all([
    loadChurnSource(admin, tenantId, range),
    fetchAllPaged<{ id: string; display_name: string | null }>((a, b) =>
      admin.from("users").select("id, display_name").eq("tenant_id", tenantId).neq("system_role", "student").order("id").range(a, b)),
    loadSheetTeacherIndex(tenantId),
  ]);
  const korean = new Set(staff.filter((u) => isKoreanTeacherName(u.display_name)).map((u) => u.id));
  // 담임 이력이 빈 반 = 담임 칸이 비었거나, 인계 기록에 이전 담임이 없다 — 그 반만 보고서 작성자를 읽는다(`reportWriterOn`).
  const gapClassIds = source.classes
    .filter((c) => !c.teacher_id || source.transitions.some((t) => (t.class_id === c.id || (!t.class_id && t.target_label === c.class_name)) && !t.previous_teacher_id))
    .map((c) => c.id);
  const byName = new Map<string, string | null>();
  for (const u of staff) {
    const n = u.display_name?.trim();
    if (n) byName.set(n, byName.has(n) ? null : u.id); // 같은 이름이 둘이면 잇지 않는다
  }
  const reportRows = gapClassIds.length
    ? await fetchAllPagedInChunks<{ class_id: string; report_date: string; teacher_name: string | null }>(gapClassIds, (chunk, a, b) =>
        admin.from("lesson_reports").select("class_id, report_date, teacher_name").eq("tenant_id", tenantId).in("class_id", chunk)
          .gte("report_date", range.from).lte("report_date", range.end).order("id").range(a, b))
    : [];
  const reports = new Map<string, HomeroomReport[]>();
  for (const r of reportRows) {
    const id = byName.get((r.teacher_name ?? "").trim());
    if (!id) continue;
    (reports.get(r.class_id) ?? reports.set(r.class_id, []).get(r.class_id)!).push({ teacherId: id, date: String(r.report_date).slice(0, 10) });
  }
  const owner = buildHomeroomOwner(source.classes, source.transitions);
  const tracking = buildStudentTracking({ from: source.from, end: source.end, classes: source.classes, schedules: source.schedules, enrollments: source.enrollments, owner });
  const churn = buildChurnModel({ source: tracking.churnSource, classes: source.classes, options: source.options, futureEnrollments: source.futureEnrollments, studentReasons: source.studentReasons });
  const months = new Map<string, ChurnMonth>();
  const view: ChurnView = {
    get(m) {
      // 아직 오지 않은 달은 퇴원율이 없다(창이 비어 있다).
      if (m > clock.thisMonth) return undefined;
      let v = months.get(m);
      if (!v) {
        const win = withdrawalMonthWindow(m, clock.today);
        const w = { start: win.from, end: win.to };
        const eligible = churn.eligibleSubjects(w);
        v = { eligible, detail: new Map([...eligible.keys()].map((id) => [id, churn.exits(id, w)])) };
        months.set(m, v);
      }
      return v;
    },
  };

  // 그 퇴원과 함께 끝난 수강 = 강사평가와 같은 재료(`source.enrollments`)에서 `endedWithExit`(기준 = 정규 반의 마지막 그만둔 날).
  // 수강이 끝난 달 = 퇴원율이 그 퇴원을 센 달(`churnMonthOf`) — 퇴원일·수강종료 날짜(특강까지 본 날)와 달이 다를 수 있다.
  // 사유 = 그 수강들의 종료 사유도 — 강사 탓이 아닌 사유는 학생 퇴원 사유·수강 종료 사유 어느 쪽이든 뺀다(퇴원율과 같은 판정).
  const irregular = new Set(
    source.classes.filter((c) => c.is_makeup_pool || isSpecialLecture({ isSpecial: c.is_special, className: c.class_name })).map((c) => c.id),
  );
  const classRefs = new Map(source.classes.map((c) => [c.id, { closedAt: c.closed_at, regular: !irregular.has(c.id), subject: c.subject, name: c.class_name, src: c }]));
  const classOf = (id: string) => classRefs.get(id);
  // 과목 → 학생 → 끝난 수강.
  type Ended = HomeroomRow & { reason: string | null };
  const endedRows = new Map<string, Map<string, Ended[]>>();
  for (const e of source.enrollments) {
    const subject = classOf(e.class_id)?.subject;
    if (!e.end_date || !subject) continue;
    const bySubject = endedRows.get(subject) ?? new Map<string, Ended[]>();
    endedRows.set(subject, bySubject);
    bySubject.set(e.student_id, [...(bySubject.get(e.student_id) ?? []), { classId: e.class_id, startDate: e.start_date, endDate: e.end_date, transferred: !!e.is_transferred, reason: e.withdrawal_reason ?? null }]);
  }

  const slots = new Map<string, HomeroomSlot[]>();
  for (const s of source.schedules) {
    const list = slots.get(s.class_id) ?? slots.set(s.class_id, []).get(s.class_id)!;
    list.push({ teacherId: s.teacher_id, validFrom: s.valid_from, validTo: s.valid_to });
  }

  return {
    source,
    owner,
    irregular,
    endedOf(studentId, subject, date) {
      const ended = endedWithExit(endedRows.get(subject)?.get(studentId) ?? [], date, classOf, OVERLAY_LOOKBACK_DAYS);
      return { endMonth: churnMonthOf(ended, date, classOf), endReasons: ended.map((r) => r.reason) };
    },
    sheetTeachersOf: (name, subject, months) => {
      const hit = sheetIndex ? sheetTeachersFor(sheetIndex, { name, subject, months }) : null;
      return hit
        ? [...new Set(hit.map((raw) => {
            const n = sheetTeacherName(raw);
            return byName.get(n) ?? `${SHEET_TEACHER_PREFIX}${n}`;
          }))]
        : null;
    },
    homeroomOf: (studentId, subject, date) =>
      exitHomeroomIds({
        rows: endedRows.get(subject)?.get(studentId) ?? [],
        date,
        lookbackDays: OVERLAY_LOOKBACK_DAYS,
        classOf,
        // 칸 다수 판정은 영어 반만(시트 가져오기가 칸으로 담임을 정한다) — 수학은 담임 이력 그대로(시트도 반 담임을 적는다).
        slotsOf: (id) => {
          const c = classRefs.get(id)?.src;
          // 영어 반 = 프로그램 구분이 있거나 표준 과목 키가 영어(미분류 영어 반도 칸으로 담임을 정한다).
          return c && (c.english_track || c.subject === "english") ? (slots.get(id) ?? []) : [];
        },
        owner: (id, day) => {
          const c = classRefs.get(id)?.src;
          return c ? owner(c, day) : null;
        },
        isKorean: (id) => korean.has(id),
        reportsOf: (id) => reports.get(id) ?? [],
      }),
    teachersOf: (studentId, subject, month) => churnTeachersOf(view, studentId, subject, month),
    zeroIdsOf: (subject, month) => churnZeroIds(view, subject, month),
  };
}

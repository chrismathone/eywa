import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSpecialLecture } from "@/features/classes/special-lecture";
import { buildChurnModel } from "@/features/teacher-portfolio/model/churn-model";
import { buildHomeroomOwner } from "@/features/teacher-portfolio/model/context";
import { buildStudentTracking } from "@/features/teacher-portfolio/model/students";
import { loadChurnSource } from "@/features/teacher-portfolio/server/churn-source";
import { endedWithExit, type EndedRowRef } from "../reason-key";
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
  /** 그 그만둠을 `month` 퇴원율에 넣은 선생님 id(없으면 빈 배열 = 선생님 미반영). */
  teachersOf(studentId: string, subject: string, month: string): string[];
  /** 그 달 이 과목 퇴원율이 0인 선생님 id. */
  zeroIdsOf(subject: string, month: string): string[];
};

export async function loadExitTeacherJudge(
  tenantId: string,
  range: { from: string; end: string },
  clock: { today: string; thisMonth: string },
): Promise<ExitTeacherJudge> {
  const source = await loadChurnSource(createAdminClient(), tenantId, range);
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
  const classRefs = new Map(source.classes.map((c) => [c.id, { closedAt: c.closed_at, regular: !irregular.has(c.id), subject: c.subject }]));
  const classOf = (id: string) => classRefs.get(id);
  // 과목 → 학생 → 끝난 수강.
  const endedRows = new Map<string, Map<string, (EndedRowRef & { reason: string | null })[]>>();
  for (const e of source.enrollments) {
    const subject = classOf(e.class_id)?.subject;
    if (!e.end_date || !subject) continue;
    const bySubject = endedRows.get(subject) ?? new Map<string, (EndedRowRef & { reason: string | null })[]>();
    endedRows.set(subject, bySubject);
    bySubject.set(e.student_id, [...(bySubject.get(e.student_id) ?? []), { classId: e.class_id, startDate: e.start_date, endDate: e.end_date, reason: e.withdrawal_reason ?? null }]);
  }

  return {
    source,
    owner,
    irregular,
    endedOf(studentId, subject, date) {
      const ended = endedWithExit(endedRows.get(subject)?.get(studentId) ?? [], date, classOf, OVERLAY_LOOKBACK_DAYS);
      return { endMonth: churnMonthOf(ended, date, classOf), endReasons: ended.map((r) => r.reason) };
    },
    teachersOf: (studentId, subject, month) => churnTeachersOf(view, studentId, subject, month),
    zeroIdsOf: (subject, month) => churnZeroIds(view, subject, month),
  };
}

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstMonth, kstToday, monthRange, shiftMonth } from "@/lib/date-kst";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { isSpecialLecture } from "@/features/classes/special-lecture";
import { buildChurn } from "@/features/teacher-portfolio/model/churn";
import { buildHomeroomOwner } from "@/features/teacher-portfolio/model/context";
import { loadChurnSource } from "@/features/teacher-portfolio/server/snapshot";
import { isCleanupWithdrawal } from "../system-bulk";
import { withdrawalMonthWindow, type EndedClassRef } from "../window";
import { buildOverlayMonth, type OverlayExitInput, type OverlayHoldInput, type ExitOverlayData } from "../exit-overlay-model";
import { churnMonthsFor, churnTeachersOf, churnZeroIds, currentHomeroomIds, teacherTints, type ChurnView } from "../exit-overlay-teachers";
import { loadCurrentHolds, teacherNames } from "./exit-overlay-loaders";
import { getSubjectEndedStudents } from "./queries";
import { getWithdrawalsInWindow } from "./window";

export type { ExitOverlayData };

/** 석 달 묶음을 몇 달 전까지 넘겨 볼 수 있나(이번 달이 맨 왼쪽인 묶음 = 0). */
export const EXIT_OVERLAY_MAX_BACK = 24;

/** 줄 하나 + 강사평가 퇴원율에서 담당을 찾을 열쇠(학생 · 수강이 끝난 달). */
type Exit = { row: Omit<OverlayExitInput, "teachers">; studentId: string; endMonth: string };

/**
 * 시간표 X 겹침 — 한 과목의 석 달 퇴원(수강종료 포함, 원장 2026-10-14). 줄은 퇴원관리와 **같은 조회·같은 판정**에서 온다:
 * 퇴원 = 운영실 '퇴원생'의 기간 조회(`getWithdrawalsInWindow` — 병합·시스템 정리·퇴원 예약 제외, 여기서 '데이터 정리 일괄 퇴원'도 뺀다),
 * 수강종료 = 퇴원관리의 수강종료 판정(`getSubjectEndedStudents`, 후보만 석 달로 좁힘).
 * 🔴 담당 선생님은 **강사평가 퇴원율이 낸 값**이다(같은 재료 `loadChurnSource` · 같은 담임 판정 `buildHomeroomOwner` · 같은 계산
 *    `buildChurn`) — 겹침이 따로 판정하면 같은 퇴원이 화면마다 다른 선생님에게 붙는다(원장 *"모든 데이터가 일치해야함"*).
 *    퇴원율은 수강이 끝난 달로 센다 — 퇴원일(줄의 달)과 한 달 어긋날 수 있어 앞뒤 한 달까지 계산한다(`churnMonthsFor`).
 */
export async function getExitOverlay(subject: string, anchor: string, tenantId: string): Promise<ExitOverlayData> {
  const today = kstToday();
  const thisMonth = kstMonth();
  const monthKeys = [anchor, shiftMonth(anchor, -1), shiftMonth(anchor, -2)];
  const windows = monthKeys.map((m) => withdrawalMonthWindow(m, today));
  const from = windows[2]!.from;
  const to = windows[0]!.to;
  const churnMonths = churnMonthsFor(anchor, thisMonth);
  const supabase = await createClient();
  const live = anchor === thisMonth;

  const [withdrawn, subjectEnded, source, settings, holdRows] = await Promise.all([
    getWithdrawalsInWindow(from, to),
    getSubjectEndedStudents({ endedWithin: { from, to } }),
    // 퇴원율 분모 = 그 달 앞달 수업일 → 가장 이른 계산 달의 앞달 1일부터. 🔴 끝은 기준 달이 아니라 **이번 달 말일**로
    // 고정한다(강사평가 진행 중인 달과 같은 끝) — 끝이 기준 달을 따라 움직이면 '같은 과목 계속 다님'이 다음 달 수강을
    // 읽느냐로 갈려, ‹ ›로 달을 넘길 때마다 같은 줄의 선생님이 바뀐다(적대 리뷰 2026-10-14).
    loadChurnSource(createAdminClient(), tenantId, { from: monthRange(shiftMonth(anchor, -4)).from, end: monthRange(thisMonth).to }),
    getTenantSettings(),
    live ? loadCurrentHolds(supabase, today) : Promise.resolve([]),
  ]);
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const owner = buildHomeroomOwner(source.classes, source.transitions);
  const churn = buildChurn({ classes: source.classes, schedules: source.schedules, enrollments: source.enrollments, owner });
  const view: ChurnView = new Map(
    churnMonths.map((m) => {
      const win = withdrawalMonthWindow(m, today);
      const w = { start: win.from, end: win.to };
      const eligible = churn.eligibleSubjects(w);
      return [m, { eligible, detail: new Map([...eligible.keys()].map((id) => [id, churn.period(id, w).detail])) }];
    }),
  );

  // 수강이 끝난 달 = 함께 끝난 정규 수강 중 마지막 줄의 종료일(퇴원율이 세는 날 — 특강·반이동 줄은 퇴원율도 안 센다).
  // 퇴원일·수강종료 날짜(특강까지 본 날)와 달이 다를 수 있다. 모르면 줄의 달.
  const irregular = new Set(
    source.classes.filter((c) => c.is_makeup_pool || isSpecialLecture({ isSpecial: c.is_special, className: c.class_name })).map((c) => c.id),
  );
  const endMonthOf = (ended: readonly EndedClassRef[], date: string) =>
    ((ended.find((r) => !irregular.has(r.classId)) ?? ended[0])?.endDate ?? date).slice(0, 7);
  const exits: Exit[] = [];
  for (const w of withdrawn) {
    if (isCleanupWithdrawal(w.memo)) continue;
    const c = w.exitClasses.find((x) => x.subject === subject);
    if (!c) continue;
    exits.push({
      row: { key: w.id, kind: "withdrawn", name: w.name, schoolGrade: schoolGradeLabel(w.school, w.grade), date: w.withdrawnAt, reasonRaw: w.reason, memo: w.memo },
      studentId: w.id,
      endMonth: endMonthOf(c.endedTogether, w.withdrawnAt),
    });
  }
  for (const s of subjectEnded) {
    for (const d of s.endedDetail) {
      const date = d.endedAt?.slice(0, 10);
      if (d.subject !== subject || !date || date < from || date > to) continue;
      exits.push({
        row: {
          key: `${s.id}|${d.subject}`, kind: "subject-ended", name: s.name, schoolGrade: schoolGradeLabel(s.school, s.grade),
          date, reasonRaw: d.reason, memo: null, keepSubjects: s.activeSubjects.map((k) => subjects.labelOf(k)),
        },
        studentId: s.id,
        endMonth: endMonthOf(d.endedTogether ?? [], date),
      });
    }
  }

  const rowTeacherIds = exits.map((e) => churnTeachersOf(view, e.studentId, subject, e.endMonth));
  const zeroIds = monthKeys.map((m) => churnZeroIds(view, subject, m));
  const subjectClasses = source.classes
    .filter((c) => c.subject === subject)
    .map((c) => ({ id: c.id, teacherId: c.teacher_id, active: c.is_active, closedOn: c.closed_at, special: irregular.has(c.id), src: c }));
  const currentIds = currentHomeroomIds(subjectClasses, (c, day) => owner(c.src, day), today);
  const holdsHere = holdRows.filter((h) => h.subject === subject);
  const names = await teacherNames(supabase, [
    ...new Set([...rowTeacherIds.flat(), ...zeroIds.flat(), ...currentIds, ...holdsHere.flatMap((h) => (h.teacherId ? [h.teacherId] : []))]),
  ]);
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  const withTeacher: OverlayExitInput[] = exits.map((e, i) => ({ ...e.row, teachers: rowTeacherIds[i]!.flatMap((id) => nameOf(id) ?? []) }));
  const holds: OverlayHoldInput[] = holdsHere.map((h) => ({ ...h, teacher: nameOf(h.teacherId) }));

  const months = monthKeys.map((month, i) =>
    buildOverlayMonth({
      month,
      today,
      exits: withTeacher,
      zeroTeachers: zeroIds[i]!.flatMap((id) => nameOf(id) ?? []),
      holds: i === 0 && live ? holds : null,
    }),
  );
  const others = [...withTeacher.flatMap((e) => e.teachers), ...months.flatMap((m) => m.zero), ...holds.flatMap((h) => (h.teacher ? [h.teacher] : []))];
  const params = new URLSearchParams({ range: "custom", from, to, subject });
  return {
    subjectLabel: subjects.labelOf(subject),
    anchor,
    months,
    tints: teacherTints(currentIds.flatMap((id) => nameOf(id) ?? []), others),
    canNewer: anchor < thisMonth,
    canOlder: anchor > shiftMonth(thisMonth, -EXIT_OVERLAY_MAX_BACK),
    withdrawalsHref: `/withdrawals?${params.toString()}`,
  };
}

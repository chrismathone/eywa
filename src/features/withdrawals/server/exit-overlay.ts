import "server-only";
import { createClient } from "@/lib/supabase/server";
import { kstMonth, kstToday, monthRange, shiftMonth } from "@/lib/date-kst";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { isCleanupWithdrawal } from "../system-bulk";
import { withdrawalMonthWindow } from "../window";
import { buildOverlayMonth, exclusionNote, type OverlayExitInput, type OverlayHoldInput, type ExitOverlayData } from "../exit-overlay-model";
import { currentHomeroomIds, teacherTints } from "../exit-overlay-teachers";
import { loadExitTeacherJudge } from "./exit-teacher-judge";
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
 * 🔴 담당 선생님 = **그만둘 때 다니던 반의 그날 담임**(퇴원생 관리 차트의 '담당선생님'과 같은 기준, 원장 2026-11-11) — 판정 한 벌
 *    [`loadExitTeacherJudge`](./exit-teacher-judge.ts)의 `homeroomOf`(퇴원관리 '강사별'·명단 '담당강사'도 같은 함수). 그 전(10-14~11-11)엔
 *    강사평가 퇴원율이 센 선생님이었는데, 지난달 담당·교시 담당·JJ 담임까지 붙어 시트와 7~10월 90줄 중 32줄만 맞았다.
 *    퇴원율 판정(`teachersOf`)은 '수강종료는 세지 않음'(`counted`)과 '퇴원 0' 선생님에만 쓴다.
 */
export async function getExitOverlay(subject: string, anchor: string, tenantId: string): Promise<ExitOverlayData> {
  const today = kstToday();
  const thisMonth = kstMonth();
  const monthKeys = [anchor, shiftMonth(anchor, -1), shiftMonth(anchor, -2)];
  const windows = monthKeys.map((m) => withdrawalMonthWindow(m, today));
  const from = windows[2]!.from;
  const to = windows[0]!.to;
  const supabase = await createClient();
  const live = anchor === thisMonth;

  const [withdrawn, subjectEnded, judge, settings, holdRows] = await Promise.all([
    // 시간표 X는 강사평가 퇴원율과 같은 달(퇴원일)로 묶는다 — 퇴원월(수강료 기준)로 바꾸면 X의 선생님 판정 달과 갈린다.
    getWithdrawalsInWindow(from, to, { basis: "date" }),
    getSubjectEndedStudents({ endedWithin: { from, to }, basis: "date" }),
    // 퇴원율 분모 = 그 달 앞달 수업일 → 가장 이른 계산 달(줄의 달 또는 그 수강이 끝난 달)의 앞달 1일부터 — 여기에 '함께 끝난 수강'의 폭(`OVERLAY_LOOKBACK_DAYS`)을 더해
    // 7달 전 1일부터 읽는다(지난 열 줄의 넉 달 앞까지 — 기준 달을 넘겨도 같은 줄은 같은 판정). 🔴 끝은 기준 달이 아니라 **이번 달 말일**로
    // 고정한다(강사평가 진행 중인 달과 같은 끝) — 끝이 기준 달을 따라 움직이면 '같은 과목 계속 다님'이 다음 달 수강을
    // 읽느냐로 갈려, ‹ ›로 달을 넘길 때마다 같은 줄의 선생님이 바뀐다(적대 리뷰 2026-10-14).
    loadExitTeacherJudge(tenantId, { from: monthRange(shiftMonth(anchor, -7)).from, end: monthRange(thisMonth).to }, { today, thisMonth }),
    getTenantSettings(),
    live ? loadCurrentHolds(supabase, today) : Promise.resolve([]),
  ]);
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const { source, owner, irregular } = judge;
  // 그 퇴원과 함께 끝난 이 과목 수강 · 퇴원율이 센 달 · 그 수강들의 종료 사유 = 판정 한 벌(`judge.endedOf`).
  const endedOf = (studentId: string, date: string) => judge.endedOf(studentId, subject, date);
  const exits: Exit[] = [];
  for (const w of withdrawn) {
    if (isCleanupWithdrawal(w.memo)) continue;
    const c = w.exitClasses.find((x) => x.subject === subject);
    if (!c) continue;
    const { endMonth, endReasons } = endedOf(w.id, w.withdrawnAt);
    exits.push({
      row: {
        key: w.id, kind: "withdrawn", name: w.name, schoolGrade: schoolGradeLabel(w.school, w.grade), date: w.withdrawnAt, reasonRaw: w.reason, memo: w.memo, endReasons,
      },
      studentId: w.id,
      endMonth,
    });
  }
  for (const s of subjectEnded) {
    for (const d of s.endedDetail) {
      const date = d.endedAt?.slice(0, 10);
      if (d.subject !== subject || !date || date < from || date > to) continue;
      const { endMonth, endReasons } = endedOf(s.id, date);
      exits.push({
        row: {
          key: `${s.id}|${d.subject}`, kind: "subject-ended", name: s.name, schoolGrade: schoolGradeLabel(s.school, s.grade),
          date, reasonRaw: d.reason, memo: null, keepSubjects: s.activeSubjects.map((k) => subjects.labelOf(k)), endReasons,
        },
        studentId: s.id,
        endMonth,
      });
    }
  }

  // 보이는 담당 = 그만둘 때 다니던 반의 그날 담임(퇴원관리와 같은 `homeroomOf` · 퇴원생 관리 차트 기준 — 원장 2026-11-11).
  // 퇴원율이 센 선생님(`teachersOf`)은 '수강종료는 세지 않음' 판정(`counted`)에만 쓴다.
  const rowTeacherIds = exits.map((e) => judge.homeroomOf(e.studentId, subject, e.row.date));
  const countedIds = exits.map((e) => judge.teachersOf(e.studentId, subject, e.endMonth));
  const zeroIds = monthKeys.map((m) => judge.zeroIdsOf(subject, m));
  const subjectClasses = source.classes
    .filter((c) => c.subject === subject)
    .map((c) => ({ id: c.id, teacherId: c.teacher_id, active: c.is_active, closedOn: c.closed_at, special: irregular.has(c.id), src: c }));
  const currentIds = currentHomeroomIds(subjectClasses, (c, day) => owner(c.src, day), today);
  const holdsHere = holdRows.filter((h) => h.subject === subject);
  const names = await teacherNames(supabase, [
    ...new Set([...rowTeacherIds.flat(), ...zeroIds.flat(), ...currentIds, ...holdsHere.flatMap((h) => (h.teacherId ? [h.teacherId] : []))]),
  ]);
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  const withTeacher: OverlayExitInput[] = exits.map((e, i) => ({ ...e.row, teachers: rowTeacherIds[i]!.flatMap((id) => nameOf(id) ?? []), counted: countedIds[i]!.length > 0 }));
  const holds: OverlayHoldInput[] = holdsHere.map((h) => ({ ...h, teacher: nameOf(h.teacherId) }));

  const months = monthKeys.map((month, i) =>
    buildOverlayMonth({
      month,
      today,
      exits: withTeacher,
      zeroTeachers: zeroIds[i]!.flatMap((id) => nameOf(id) ?? []),
      holds: i === 0 && live ? holds : null,
      rules: source.options,
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
    rulesNote: exclusionNote(source.options),
  };
}

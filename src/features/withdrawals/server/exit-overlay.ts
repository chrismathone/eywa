import "server-only";
import { createClient } from "@/lib/supabase/server";
import { addDays, kstDateOf, kstMonth, kstToday, shiftMonth } from "@/lib/date-kst";
import { foldedReason } from "@/lib/folded-read";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { isSpecialLecture } from "@/features/classes/special-lecture";
import { getHomeroomHistoryIndex } from "@/features/classes/server/teacher-as-of-queries";
import { enrollmentLastDate } from "@/features/enrollments/eligibility";
import { getPastClassTeachers } from "@/features/students/server/past-class-teachers";
import type { PastClassTarget } from "@/features/students/lib/past-class-teacher";
import { withdrawalMonthWindow, type EndedClassRef } from "../window";
import { buildOverlayMonth, type OverlayExitInput, type OverlayHoldInput, type ExitOverlayData } from "../exit-overlay-model";
import { currentHomeroomIds, teacherNoteOf, teacherTints, zeroCandidateIds, type MonthExit, type OverlayClass } from "../exit-overlay-teachers";
import { loadCurrentHolds, loadSubjectClasses, teacherNames } from "./exit-overlay-loaders";
import { getSubjectEndedStudents } from "./queries";
import { getWithdrawalsInWindow } from "./window";

export type { ExitOverlayData };

/** 석 달 묶음을 몇 달 전까지 넘겨 볼 수 있나(이번 달이 맨 왼쪽인 묶음 = 0). */
export const EXIT_OVERLAY_MAX_BACK = 24;
/** 담임 추정 근거(보고서·출결)를 석 달 창 앞으로 며칠까지 읽나 — 그보다 오래된 근거만 남은 반은 '담임 미상'. */
const EVIDENCE_LOOKBACK_DAYS = 62;

type Exit = Omit<OverlayExitInput, "teacher" | "teacherNote"> & { target: PastClassTarget | null; ended: readonly EndedClassRef[] };

/**
 * 시간표 X 겹침 — 한 과목의 석 달 퇴원·수강종료(원장 2026-10-14). 줄은 퇴원관리와 **같은 조회·같은 판정**에서 온다:
 * 퇴원 = 운영실 '퇴원생'의 기간 조회(`getWithdrawalsInWindow` — 병합·시스템 정리·퇴원 예약 제외),
 * 수강종료 = 퇴원관리의 수강종료 판정(`getSubjectEndedStudents`, 후보만 석 달로 좁힘). 묶음 = 그때 담임(`getPastClassTeachers`,
 * 학생 상세 '지난 수업'과 같은 근거 — 추정이면 '추정'을 밝힌다). '퇴원 0'·선생님 색 = `exit-overlay-teachers.ts`.
 */
export async function getExitOverlay(subject: string, anchor: string): Promise<ExitOverlayData> {
  const today = kstToday();
  const thisMonth = kstMonth();
  const monthKeys = [anchor, shiftMonth(anchor, -1), shiftMonth(anchor, -2)];
  const windows = monthKeys.map((m) => withdrawalMonthWindow(m, today));
  const from = windows[2]!.from;
  const to = windows[0]!.to;
  const supabase = await createClient();
  const live = anchor === thisMonth;

  const [withdrawn, subjectEnded, classRows, history, settings, holdRows] = await Promise.all([
    getWithdrawalsInWindow(from, to),
    getSubjectEndedStudents({ endedWithin: { from, to } }),
    loadSubjectClasses(supabase, subject),
    getHomeroomHistoryIndex(),
    getTenantSettings(),
    live ? loadCurrentHolds(supabase, today) : Promise.resolve([]),
  ]);
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const classes: OverlayClass[] = classRows.map((c) => ({
    id: c.id,
    teacherId: c.teacher_id,
    openedOn: kstDateOf(c.created_at) ?? "",
    closedOn: c.closed_at,
    active: c.is_active,
    special: isSpecialLecture({ isSpecial: c.is_special, className: c.class_name }),
  }));

  // 줄 + 그때 담임을 찾을 재료 = 함께 끝난 수강 중 정규 반 첫째(특강은 정규 반이 없을 때만 — 같은 날 끝난 특강이
  // 묶음을 가로채지 않게). 마지막 수업일은 반이동이면 전날.
  const specialIds = new Set(classes.filter((c) => c.special).map((c) => c.id));
  const targetFrom = (ended: readonly EndedClassRef[]): PastClassTarget | null => {
    const r = ended.find((x) => !specialIds.has(x.classId)) ?? ended[0];
    return r ? targetOf(r.enrollmentId, r.classId, r.startDate, enrollmentLastDate(r.endDate, r.isTransferred)) : null;
  };
  const exits: Exit[] = [];
  for (const w of withdrawn) {
    const c = w.exitClasses.find((x) => x.subject === subject);
    if (!c) continue;
    exits.push({
      key: w.id,
      kind: "withdrawn",
      name: w.name,
      schoolGrade: schoolGradeLabel(w.school, w.grade),
      date: w.withdrawnAt,
      reasonRaw: w.reason,
      memo: w.memo,
      target: targetFrom(c.endedTogether),
      ended: c.endedTogether,
    });
  }
  for (const s of subjectEnded) {
    for (const d of s.endedDetail) {
      const date = d.endedAt?.slice(0, 10);
      if (d.subject !== subject || !date || date < from || date > to) continue;
      exits.push({
        key: `${s.id}|${d.subject}`,
        kind: "subject-ended",
        name: s.name,
        schoolGrade: schoolGradeLabel(s.school, s.grade),
        date,
        reasonRaw: d.reason,
        memo: null,
        keepSubjects: s.activeSubjects.map((k) => subjects.labelOf(k)),
        target: targetFrom(d.endedTogether ?? []),
        ended: d.endedTogether ?? [],
      });
    }
  }

  // '퇴원 0' = 함께 끝난 반 **전부**의 담임을 '퇴원 있음'으로(한 반만 보면 다른 반 담임이 0에 선다). 반을 모르는 줄은 가릴 수 없음.
  const historyFailed = !!foldedReason(history);
  const zeroIds = windows.map((window, i) =>
    zeroCandidateIds({
      window,
      classes,
      history,
      historyFailed,
      exits: exits
        .filter((e) => e.date.slice(0, 7) === monthKeys[i])
        .flatMap((e): MonthExit[] =>
          e.ended.length
            ? e.ended.map((r) => ({ reasonRaw: e.reasonRaw, classId: r.classId, lastDate: enrollmentLastDate(r.endDate, r.isTransferred) }))
            : [{ reasonRaw: e.reasonRaw, classId: null, lastDate: null }],
        ),
    }),
  );
  const currentIds = currentHomeroomIds(classes, history, today);
  const holdsHere = holdRows.filter((h) => h.subject === subject);
  const teacherIds = [
    ...new Set([...currentIds, ...zeroIds.flatMap((s) => (s ? [...s] : [])), ...holdsHere.flatMap((h) => (h.teacherId ? [h.teacherId] : []))]),
  ];
  // 그때 담임과 이름 조회는 서로 독립(B4). 담임 이력은 위에서 읽은 것을 넘긴다(서버 액션엔 요청 캐시가 없다).
  const [past, names] = await Promise.all([
    getPastClassTeachers(exits.flatMap((e) => (e.target ? [e.target] : [])), { history, evidenceFrom: addDays(from, -EVIDENCE_LOOKBACK_DAYS) }),
    teacherNames(supabase, teacherIds),
  ]);
  const withTeacher: OverlayExitInput[] = exits.map(({ target, ...e }) => {
    const p = target ? past.get(target.enrollmentId) : undefined;
    return { ...e, teacher: p?.name ?? null, teacherNote: teacherNoteOf(p) };
  });
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  const holds: OverlayHoldInput[] = holdsHere.map((h) => ({ ...h, teacher: nameOf(h.teacherId) }));

  const months = monthKeys.map((month, i) =>
    buildOverlayMonth({
      month,
      today,
      exits: withTeacher,
      homeroomTeachers: zeroIds[i] ? [...zeroIds[i]!].flatMap((id) => nameOf(id) ?? []) : null,
      holds: i === 0 && live ? holds : null,
    }),
  );
  const others = [...withTeacher.flatMap((e) => (e.teacher ? [e.teacher] : [])), ...months.flatMap((m) => m.zero ?? []), ...holds.flatMap((h) => (h.teacher ? [h.teacher] : []))];
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

function targetOf(enrollmentId: string | null, classId: string | null, startDate: string | null, lastDate: string | null): PastClassTarget | null {
  return enrollmentId && classId && startDate && lastDate ? { enrollmentId, classId, startDate, lastDate } : null;
}

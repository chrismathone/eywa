"use server";

/**
 * **보강 반 바꾸기** — 서버 액션(원장 2026-09-30 *"보고서 반 = 출석부 반은 모든 곳에서 일치"*, 설계 a).
 *
 * 보강 보고서가 있으면 단일 문 [`changeMakeupAnchor`](./makeup-anchor-sync.ts)로 보고서의 `makeup_class_id`·`classnote_class_id`와
 * 출결 칸을 **함께** 옮긴다. 보고서가 아직 없으면(보강을 추가만 했다) 명단 세션의 보강 반과 확인 때 선 칸을 같은 함수로 함께 옮긴다.
 * 🔴 게시된 보고서·게시 중·회수 중은 거절한다. 🔴 모든 바꾸기는 감사로그(`makeup_class_change`).
 * 게이트: 로그인 · 열람 전용 아님 · 출결 쓰기 권한 · (관리자 = 보고서 관리 쓰기) 아니면 **내 보강만** · 강사는 출결 수정 기간(7일).
 */
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { attendanceWindowApplies } from "@/features/attendance/server/edit-window-gate";
import { readonlyTeacherViewError } from "@/lib/auth/view-mode";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidYmd, kstToday } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import { attendanceLockMessage, isWithinAttendanceEditWindow } from "@/features/attendance/edit-window";
import { LEGACY_REPORT_SUBJECT } from "@/features/timetable/lib/report-subject";
import { ownsMakeupReport } from "../makeup-owner";
import { makeupSessionEntries } from "../makeup-session";
import { acceptMakeupAnchor, MAKEUP_ANCHOR_REJECTED_ERROR } from "../makeup-anchor";
import { changeMakeupSession } from "./makeup-session-store";
import { changeMakeupAnchor, loadMakeupAnchorCandidates, planReportAnchorMove, syncAnchorCells } from "./makeup-anchor-sync";
import { makeupMemo } from "../makeup-absence-link";
import { logDbError } from "@/lib/supabase/db-error";

export type SetMakeupClassResult =
  | { ok: true; className: string; moved: number; created: boolean; reportless: boolean }
  | { ok: false; error: string };

export async function setMakeupClass(input: {
  studentId: string;
  date: string;
  /** 과목 키 — 보강 보고서 단위(반 없는 보강은 과목이 단위, 0134a). */
  subject: string;
  classId: string;
}): Promise<SetMakeupClassResult> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const ro = await readonlyTeacherViewError();
  if (ro) return { ok: false, error: ro };
  if (!input.studentId || !input.classId || !input.subject || !isValidYmd(input.date)) return { ok: false, error: "잘못된 요청입니다" };
  if (!(await canWriteTenant(user.systemRole, "attendance"))) return { ok: false, error: "출석 입력 권한이 없습니다" };
  const today = kstToday();
  if ((await attendanceWindowApplies(user.systemRole)) && !isWithinAttendanceEditWindow(input.date, today))
    return { ok: false, error: attendanceLockMessage(input.date, today) };
  const isAdmin = await canWriteTenant(user.systemRole, "lesson_reports");
  const supabase = await createClient();
  const admin = createAdminClient();

  // 그날 그 학생의 반 없는 보강 보고서(과목 단위) — 옛 행은 subject가 NULL일 수 있어 JS로 맞춘다(보강 빼기와 같은 규약).
  const { data: rows, error } = await admin
    .from("lesson_reports")
    .select("id, subject, makeup_class_id, classnote_class_id, classnote_status, classnote_sent_at, created_by, teacher_name")
    .eq("tenant_id", user.tenantId)
    .eq("student_id", input.studentId)
    .eq("report_date", input.date)
    .eq("makeup", true)
    .is("class_id", null);
  if (error) {
    logDbError(error, "onescreen.setMakeupClass");
    return { ok: false, error: "보강 보고서를 확인하지 못했습니다 — 다시 시도해 주세요" };
  }
  const report = (rows ?? []).find(
    (r) => (((r.subject as string | null) ?? "").trim() || LEGACY_REPORT_SUBJECT) === input.subject,
  );
  if (report && !isAdmin && !ownsMakeupReport({ createdBy: report.created_by as string | null, teacherName: report.teacher_name as string | null }, user.id, user.displayName ?? ""))
    return { ok: false, error: "내가 작성한 보강만 반을 바꿀 수 있습니다" };

  // 받을 반 판정 = 보강 등록·보고서 저장과 **같은 함수**(담당 반 ∪ 학생이 다니는 반 · 같은 과목 · 종강 전).
  // 기준 강사 = 보고서 소유자(관리자가 대신 바꿀 때도 그 강사의 담당 반이 후보다), 보고서가 없으면 본인.
  const ownerId = (report?.created_by as string | null) ?? user.id;
  let cands;
  try {
    cands = await loadMakeupAnchorCandidates(supabase, { tenantId: user.tenantId, userId: ownerId, studentId: input.studentId, date: input.date });
  } catch {
    return { ok: false, error: "반 후보를 확인하지 못했습니다 — 다시 시도해 주세요" };
  }
  const target = acceptMakeupAnchor(cands, input.classId, input.subject, input.date);
  if (!target) return { ok: false, error: MAKEUP_ANCHOR_REJECTED_ERROR };

  let moved = 0;
  let created = false;
  const from = (report?.makeup_class_id as string | null) ?? null;
  if (report) {
    const res = await changeMakeupAnchor({
      tenantId: user.tenantId,
      report: {
        id: report.id as string,
        studentId: input.studentId,
        reportDate: input.date,
        subject: (report.subject as string | null) ?? null,
        makeupClassId: from,
        deliveryClassId: (report.classnote_class_id as string | null) ?? null,
        classnoteStatus: (report.classnote_status as string | null) ?? null,
        classnoteSentAt: (report.classnote_sent_at as string | null) ?? null,
        ownerId: (report.created_by as string | null) ?? null,
      },
      toClassId: target.id,
    });
    if (!res.ok) return res;
    moved = res.moved;
    created = res.created;
  }
  // 명단 세션의 보강 반도 같은 반으로(보고서 전이면 이것이 유일한 기록, 설계 b).
  // 보고서가 있으면 화면이 반 이름을 읽는 자리라 맞춰 둔다(실패해도 반 자체는 이미 바뀌었다).
  // ⚠️ 세션 행이 없거나 그 과목 항목이 없으면 건드리지 않는다(`changeMakeupSession`은 행이 없으면 새로 만든다 — 빈 세션을 만들지 않게).
  const sessionOwner = (report?.created_by as string | null) ?? user.id;
  const { data: sesRow } = await supabase
    .from("onescreen_daily_sessions")
    .select("subject_progress")
    .eq("tenant_id", user.tenantId)
    .eq("updated_by", sessionOwner)
    .eq("student_id", input.studentId)
    .eq("session_date", input.date)
    .maybeSingle();
  const prevEntry = makeupSessionEntries(sesRow?.subject_progress).find((e) => e.subject === input.subject) ?? null;
  const reportlessFrom = !report ? (prevEntry?.makeupClassId ?? null) : null;
  /**
   * 🔴 보고서 전인 보강도 **확인할 때 앵커 반에 칸이 선다**(`registerMakeupEntries` `recordCell`, 적대 리뷰 2026-09-30) — 반만 바꾸고 칸을 두면
   *    옛 반 칸 + (보고서 저장 때) 새 반 칸으로 **시수가 두 번** 선다. 그래서 보고서가 없어도 칸을 보고서 경로와 **같은 함수**로 옮긴다:
   *    막힐 일은 세션을 바꾸기 **전에** 보고(`planReportAnchorMove`), 세션을 바꾼 뒤 칸을 맞추고(`syncAnchorCells`), 칸이 실패하면 세션을 되돌린다.
   */
  let reportlessMove: Awaited<ReturnType<typeof planReportAnchorMove>> | null = null;
  if (!report && prevEntry && !reportlessFrom) {
    // 반이 없던 보강(보고서 전) = 확인 때 칸을 세우지 않았다(`recordCell`은 앵커가 있을 때만) — 옮길 칸이 없다.
    // 🔴 보이지 않는 보강 반을 원천으로 잡지 말 것 — 거기 있는 칸은 **다른 보강(보고서 저장분)**의 것이라 끌고 오면 남의 시수가 옮겨진다.
    reportlessMove = { plan: { kind: "none" }, fromClassId: null };
  } else if (!report && prevEntry && reportlessFrom !== target.id) {
    reportlessMove = await planReportAnchorMove({
      tenantId: user.tenantId,
      studentId: input.studentId,
      date: input.date,
      prevAnchor: reportlessFrom,
      ownerId: sessionOwner,
      toClassId: target.id,
    });
    if ("error" in reportlessMove) return { ok: false, error: reportlessMove.error };
  }
  const setSessionAnchor = (classId: string | null, className: string | null) =>
    changeMakeupSession(
      supabase,
      { tenantId: user.tenantId, teacherId: sessionOwner, studentId: input.studentId, date: input.date },
      (progress) => {
        const key = `makeup::${input.subject}`;
        return { ...progress, [key]: { ...progress[key], makeupClassId: classId, makeupClassName: className, makeup: true } };
      },
    );
  if (prevEntry) {
    const ses = await setSessionAnchor(target.id, target.className);
    if (!report && !ses.ok) return ses;
  } else if (!report) {
    return { ok: false, error: "바꿀 보강을 찾지 못했습니다 — 새로고침 뒤 다시 시도해 주세요" };
  }
  if (!report && prevEntry && reportlessMove && !("error" in reportlessMove)) {
    const synced = await syncAnchorCells({
      tenantId: user.tenantId,
      studentId: input.studentId,
      date: input.date,
      anchor: target.id,
      ownerId: sessionOwner,
      move: reportlessMove,
      units: prevEntry.units ?? null,
      note: prevEntry.absentDate ? makeupMemo(prevEntry.absentDate, input.date) : null,
    }).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    if (!synced.ok) {
      // 칸을 못 맞췄으면 세션(반)도 되돌린다 — 명단의 반과 출석부 칸의 반이 갈린 채로 두지 않는다.
      await setSessionAnchor(prevEntry.makeupClassId ?? null, prevEntry.makeupClassName ?? null).catch(() => undefined);
      return { ok: false, error: `출석부 칸을 옮기지 못해 반을 바꾸지 않았습니다 — ${synced.error}` };
    }
    moved = synced.moved;
    created = synced.created;
  }

  await logAction({
    action: "makeup_class_change",
    targetType: "lesson_report",
    metadata: {
      ...(report ? { reportId: report.id } : {}),
      studentId: input.studentId,
      date: input.date,
      subject: input.subject,
      fromClassId: report ? from : reportlessFrom,
      toClassId: target.id,
      movedCells: moved,
      createdCell: created,
      reportless: !report,
      substitute: !target.mine,
    },
  });
  revalidatePath("/onescreen");
  revalidatePath("/attendance");
  revalidatePath("/lesson-reports");
  return { ok: true, className: target.className, moved, created, reportless: !report };
}

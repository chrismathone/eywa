"use server";

/**
 * 원스크린 **보강 빼기** — 잘못 추가한 보강을 화면에서 지운다(원장 2026-08-18: *"다 삭제"*).
 *
 * ## 왜 필요했나
 * `+ 보강 학생 추가`의 반대가 없었다. 영어(ECS)는 `removeMakeupAttendee`로 뺄 수 있지만 그 게이트는
 * **영어 전용**(`requireEcsClassAccess`가 `subject !== "english"`를 거부)이라 수학 원스크린에서는 못 쓴다.
 * 게다가 그 액션은 출결만 지워서, **저장된 보강 보고서**가 남아 다음 새로고침에 행이 되살아난다
 * (원스크린 로스터는 출결(5-c)과 보고서(5-b) **양쪽**에서 보강 행을 복원한다).
 *
 * ## 무엇을 지우나 — 되살아나는 원천을 **둘 다** 끊고 진도까지 되감는다
 * ① `attendance_records`의 그 날 **보강 칸**(status='makeup') ② 순수 보강 `lesson_reports`
 * (`makeup=true` ∧ `class_id IS NULL` ∧ 내 것) ③ 그 보고서가 밀어 올린 **진도**(entries·events·컨테이너
 * 위치 재계산 — 원장 *"진도기록도 되돌려야지"*). 진도는 FK가 SET NULL이라 **보고서를 지우기 전에** 되감는다.
 *
 * 🔴 **이미 학부모에게 발송된 보강은 취소 자체를 막는다**(원장 *"발송된건은 보강취소를 못하게 강제해"*).
 *    지우려면 먼저 보고서를 회수(게시글 삭제)해야 하고, 회수 완료분은 이 문으로 지울 수 있다.
 *
 * ## 게이트 (#77 — UI에서 숨기는 건 게이트가 아니다)
 * 로그인 + 출결 쓰기 권한. 관리자(lesson_reports 쓰기)는 테넌트 전체, 그 외는 **내가 만든 보강만**
 * (출결은 `recorded_by`, 보고서는 [`ownsMakeupReport`](../makeup-owner.ts)). 강사는 출결 편집 창(7일) 안에서만.
 * 🔴 **정규 출결은 절대 손대지 않는다** — 지우는 대상은 `status='makeup'` 행뿐이다. 수강생 판정 대신
 *    이 조건을 쓰는 이유: 조건이 하나라 오해가 없고, 수강 이력이 꼬여도 정규 출석/결석이 지워질 길이 없다.
 */

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { attendanceWindowApplies } from "@/features/attendance/server/edit-window-gate";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { humanizeDbError, logDbError } from "@/lib/supabase/db-error";
import { kstToday } from "@/lib/date-kst";
import { LEGACY_REPORT_SUBJECT } from "@/features/timetable/lib/report-subject";
import { logAction } from "@/features/audit/server/log";
import { attendanceLockMessage, isWithinAttendanceEditWindow } from "@/features/attendance/edit-window";
import {
  applyProgressRollback,
  captureProgressForReports,
} from "@/features/progress/server/rollback-actions";
import { ownsMakeupReport } from "../makeup-owner";
import { makeupSessionEntries } from "../makeup-session";
import { changeMakeupSession } from "./makeup-session-store";
import { makeupRemoveBlockReason, makeupRemoveMessage, planMakeupRemoval } from "../makeup-remove-plan";
import { mappedMakeupDeleteBlock } from "@/features/makeups/server/adapters/gates";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export type RemoveMakeupResult =
  | {
      ok: true;
      /** 출결 보강 칸을 지웠나. */
      attendanceRemoved: boolean;
      /** 실제로 지운 보고서 수. */
      deleted: number;
      /** 되감은 진도 엔트리 수. */
      progressEntries: number;
      /** 화면에 그대로 띄우는 한글 요약. */
      message: string;
    }
  /** `code: "not_found"` = 지울 보강 기록(보고서·명단·출결)이 없다 — 보강 예약에서 막 선 줄을 합칠 때는 오류가 아니다(원장 2026-10-22 합치기). */
  | { ok: false; error: string; code?: "not_found" };

/**
 * 보강 한 줄을 명단에서 뺀다.
 *
 * @param studentId 대상 학생
 * @param date      그 보강 날짜(YYYY-MM-DD)
 * @param classId   보강을 한 반(앵커) — 출결 삭제 대상. '전체'에서 추가해 앵커가 없으면 null.
 * @param subject   과목 키 — 같은 날 두 과목 보강이 있을 때 그 행만 지운다. 없으면 그 날 보강 전부.
 */
export async function removeMakeupEntry(input: {
  studentId: string;
  date: string;
  classId?: string | null;
  subject?: string | null;
}): Promise<RemoveMakeupResult> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!input.studentId || !YMD_RE.test(input.date)) return { ok: false, error: "잘못된 요청입니다" };
  if (!(await canWriteTenant(user.systemRole, "attendance"))) {
    return { ok: false, error: "출석 입력 권한이 없습니다" };
  }
  const today = kstToday();
  if ((await attendanceWindowApplies(user.systemRole)) && !isWithinAttendanceEditWindow(input.date, today)) {
    return { ok: false, error: attendanceLockMessage(input.date, today) };
  }

  const isAdmin = await canWriteTenant(user.systemRole, "lesson_reports");
  const supabase = await createClient();
  // admin 클라이언트는 RLS를 우회하므로 **tenant_id 필터를 반드시 명시**한다(#104).
  const admin = createAdminClient();
  const tenantId = user.tenantId;

  // ── 1) 저장된 보강 보고서(순수 보강만) ─────────────────────────────────────────
  const { data: reportRows, error: reportErr } = await supabase
    .from("lesson_reports")
    .select("id, subject, classnote_status, share_token, classnote_read_at, created_by, teacher_name")
    .eq("student_id", input.studentId)
    .eq("report_date", input.date)
    .eq("makeup", true)
    .is("class_id", null); // 정규 보고서(반 있음)는 대상 아님 — '정규+보강' 합친 건은 체크박스로 끈다
  if (reportErr) return { ok: false, error: humanizeDbError(reportErr.message, "보강 보고서 조회") };

  // 🔴 과목 매칭은 **SQL이 아니라 JS**로 — 옛 보강은 `subject`가 NULL이고(실측 143건) 화면은 그걸
  //    LEGACY_REPORT_SUBJECT("math")로 채워 보여준다. `.eq("subject","math")`로 거르면 그 143건이
  //    한 건도 안 잡혀 "출결만 지우고 성공"이 되고, 새로고침하면 보고서가 행을 되살린다(적대 리뷰 M6).
  const targetSubject = input.subject?.trim() || null;
  const subjectMatched = (reportRows ?? []).filter(
    (r) => !targetSubject || ((r.subject as string | null)?.trim() || LEGACY_REPORT_SUBJECT) === targetSubject,
  );

  const mine = subjectMatched.filter(
    (r) =>
      isAdmin ||
      ownsMakeupReport(
        { createdBy: r.created_by as string | null, teacherName: r.teacher_name as string | null },
        user.id,
        user.displayName ?? "",
      ),
  );
  // 남의 보강이 섞여 있으면 **말해 준다** — 조용히 내 것만 지우면 "반만 빠졌다"가 원인 불명으로 남는다.
  const notMine = subjectMatched.length - mine.length;
  if (!isAdmin && notMine > 0 && mine.length === 0) {
    return { ok: false, error: "내가 작성한 보강만 뺄 수 있습니다" };
  }

  const mappedBlock = await mappedMakeupDeleteBlock({
    studentId: input.studentId, classId: input.classId ?? null, date: input.date,
  });
  if (mappedBlock) return { ok: false, error: mappedBlock };

  const plan = planMakeupRemoval(
    mine.map((r) => ({
      id: r.id as string,
      classnoteStatus: (r.classnote_status as string | null) ?? null,
      shareToken: (r.share_token as string | null) ?? null,
      // 재발급이 상태를 지워도 남는 발송 흔적 — 이게 있으면 "미발송"으로 보지 않는다(뒷문 방어).
      readAt: (r.classnote_read_at as string | null) ?? null,
    })),
  );

  // 🔴 **발송분은 여기서 끝** — 학부모가 이미 본 기록을 '보강 빼기'가 조용히 지우지 않는다
  //    (원장 2026-08-18). 출결도 건드리지 않고 그대로 돌려보낸다. 지우려면 회수가 먼저다.
  // 🔴 처리 중(발송 대기·회수 요청)도 같다 — 예전엔 통과시켜 출결만 지우고 "성공"이라 답했는데,
  //    워커가 큐에 남은 그 보고서를 **그대로 학부모에게 게시**했다(적대 리뷰 치명).
  if (plan.sentIds.length > 0 || plan.busyIds.length > 0) {
    // 사유는 **그 행의 실제 상태**로 만든다 — 예전엔 busy를 전부 "queued"로 뭉개 회수 처리 중인데도
    // "발송 처리 중"이라 답했다(적대 리뷰). 문구는 순수 함수 한 곳이 소유한다.
    const blockedId = plan.sentIds[0] ?? plan.busyIds[0];
    const blockedStatus =
      (mine.find((r) => r.id === blockedId)?.classnote_status as string | null) ?? "success";
    return { ok: false, error: makeupRemoveBlockReason(blockedStatus) ?? "지금은 뺄 수 없습니다" };
  }

  let deleted = 0;
  let progressEntries = 0;
  if (plan.deleteIds.length) {
    // 진도 되감기는 **두 단계**(rollback-actions.ts 주석): 지우기 전에 대상을 기억하고(FK가 SET NULL이라
    // 지운 뒤엔 못 찾는다), 실제 되감기는 **보고서 삭제가 성공한 뒤에** 한다(삭제가 실패했는데 진도만
    // 사라지면 그 수업 진도가 영구 유실된다 — 적대 리뷰).
    const captured = await captureProgressForReports(tenantId, plan.deleteIds);
    const { data: gone, error: delErr } = await admin
      .from("lesson_reports")
      .delete()
      .eq("tenant_id", tenantId)
      .in("id", plan.deleteIds)
      .select("id");
    if (delErr) return { ok: false, error: humanizeDbError(delErr.message, "보강 보고서 삭제") };
    deleted = (gone ?? []).length;
    const rolled = await applyProgressRollback(tenantId, captured).catch(() => ({
      entries: 0,
      containers: 0,
      droppedContainers: 0,
    }));
    progressEntries = rolled.entries;
  }

  // ── 2) 출결 보강 칸 ────────────────────────────────────────────────────────────
  // 🔴 status='makeup'만 지운다. 정규 출석/결석은 이 문으로 절대 사라지지 않는다.
  let attendanceRemoved = false;
  if (input.classId) {
    let attQuery = admin
      .from("attendance_records")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("class_id", input.classId)
      .eq("student_id", input.studentId)
      .eq("session_date", input.date)
      .eq("status", "makeup");
    // 내가 찍은 것만(관리자는 전체) — 남이 연 보강 칸을 조용히 지우지 않는다.
    if (!isAdmin) attQuery = attQuery.eq("recorded_by", user.id);
    const { data: goneAtt, error: attErr } = await attQuery.select("id");
    if (attErr) return { ok: false, error: humanizeDbError(attErr.message, "보강 출결 삭제") };
    attendanceRemoved = (goneAtt ?? []).length > 0;
  }

  // 보고서 저장 전의 보강 명단도 지운다. 다른 창의 늦은 자동저장은 tombstone을 넘지 못한다.
  const { data: draftRows, error: draftError } = await supabase.from("onescreen_daily_sessions")
    .select("student_id, updated_by, subject_progress")
    .eq("tenant_id", tenantId).eq("student_id", input.studentId).eq("session_date", input.date);
  if (draftError) {
    logDbError(draftError, "onescreen.removeMakeupEntry");
    return { ok: false, error: "보강 임시 명단을 조회하지 못했습니다" };
  }
  let rosterRemoved = false;
  for (const row of draftRows ?? []) {
    if (!row.updated_by || (!isAdmin && row.updated_by !== user.id)) continue;
    const targets = makeupSessionEntries(row.subject_progress)
      .filter(e => !targetSubject || e.subject === targetSubject);
    if (!targets.length) continue;
    const result = await changeMakeupSession(supabase, {
      tenantId, teacherId: row.updated_by, studentId: input.studentId, date: input.date,
    }, progress => {
      const next = { ...progress };
      for (const entry of targets) next[`makeup::${entry.subject}`] = { makeup: false };
      return next;
    });
    if (!result.ok) return result;
    rosterRemoved = true;
  }
  if (!attendanceRemoved && deleted === 0 && !rosterRemoved) {
    return { ok: false, error: "뺄 보강 기록을 찾지 못했습니다 — 다른 사람이 만든 보강일 수 있습니다", code: "not_found" };
  }

  // 학생 레코드를 바꾸는 경로는 감사로그 필수(2026-08-18 규칙) — 누가 지웠는지 역검수가 되게.
  const { data: stu } = await supabase
    .from("students")
    .select("name")
    .eq("id", input.studentId)
    .maybeSingle();
  await logAction({
    action: "makeup_remove",
    targetType: "student",
    targetLabel: (stu?.name as string | null) ?? null,
    metadata: {
      studentId: input.studentId,
      date: input.date,
      classId: input.classId ?? null,
      subject: input.subject ?? null,
      attendanceRemoved,
      deletedReports: deleted,
      rosterRemoved,
      rolledBackProgress: progressEntries,
    },
  });

  revalidatePath("/onescreen");
  revalidatePath("/attendance");
  revalidatePath("/ecs");
  revalidatePath("/lesson-reports");

  return {
    ok: true,
    attendanceRemoved,
    deleted,
    progressEntries,
    message: !attendanceRemoved && deleted === 0 && rosterRemoved
      ? "보강 명단에서 뺐습니다"
      : makeupRemoveMessage({ attendanceRemoved, deleted, progressEntries, notMine }),
  };
}

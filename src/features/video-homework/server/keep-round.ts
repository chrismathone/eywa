import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { videoHomeworkColumnReady } from "./assignments";
import { extraIssuesReady, findExtraIssue } from "./extra-issues";

type Db = ReturnType<typeof createAdminClient>;
type Key = { classId: string; studentId: string; date: string };

/**
 * **검사 기록만으로 선 숙제 칸을 지우기 전에 그 자리를 남긴다**(원장 2026-10-13 — 박한비 9/28·10/1 칸이 미확인으로 바꾸자 사라졌다).
 * 보고서에 '영상 과제' 표시가 없는 수업(표시는 2026-10-01부터 저장됐다)은 검사 기록이 있어야만 장부에 칸으로 선다
 * (`rounds.ts` '옛 기록은 버리지 않는다'). 미확인 = 기록 삭제라 그대로 지우면 칸이 통째로 사라지고, 학생 영상을 붙일 자리도 없어진다.
 * 그래서 따로 낸 숙제 표에 **옮겨 남긴 숙제**(`kept = true`)로 한 줄 넣는다 — 칸이 서고, 손 배정·올리기 사이트에서는 숙제로 보인다.
 * 🔴 정식 숙제로 넣지 말 것(`kept` 없이): 정식 숙제가 되면 가장 오래된 빈 숙제로서 다른 칸에 붙어 있던 영상을 가져가 그 칸이 미수행이 되고
 *    자동 판정이 미제출 알림까지 보낸다(적대적 리뷰 2026-10-13). 옮겨 남긴 숙제는 검사 기록 칸과 똑같이 ②의 뒷순위로만 영상을 받고,
 *    자동 판정·미제출 알림·운영실 집계에 들지 않는다(`extra-issues.ts`). 강사뷰 · 강사 필터에는 그날 보고서를 쓴 선생님의 칸으로 선다(own-homework.ts).
 *  · 누구의 숙제인가(`teacher_id`, **기록용** — 칸 주인 판정에 쓰지 않는다) = 그날 보고서를 쓴 사람 → 반 담임 → 누른 사람.
 *  · 이미 보고서에 표시가 있거나 따로 낸 숙제면 아무것도 안 한다.
 * 돌려주는 값: `kept`(새로 남겼다) · `assigned`(원래 숙제였다) · `skipped`(표가 아직 없다 — 종전대로 지운다) · `failed`(지우지 말 것).
 * 🔴 따로 내기 화면의 기한(다음 수업 전 · 며칠 안)은 여기 걸지 않는다 — 새로 내는 숙제가 아니라 이미 있던 칸을 지키는 것이다.
 */
export async function keepMarkOnlyRound(db: Db, tenantId: string, userId: string, key: Key,
  /** 감사로그에 더할 값 — 숙제없음 수업일에 영상을 붙이며 남긴 줄은 `{ source: "blank_lesson" }`(video-assignment.ts). */
  meta?: Record<string, unknown>): Promise<"kept" | "assigned" | "skipped" | "failed"> {
  try {
    if (!(await extraIssuesReady(db))) return "skipped";
    const [report, extra, cls] = await Promise.all([
      (async () => (await videoHomeworkColumnReady(db)) ? db.from("lesson_reports").select("video_homework,created_by")
        .eq("tenant_id", tenantId).eq("class_id", key.classId).eq("student_id", key.studentId).eq("report_date", key.date) : null)(),
      findExtraIssue(db, tenantId, key),
      db.from("classes").select("teacher_id").eq("tenant_id", tenantId).eq("id", key.classId).maybeSingle(),
    ]);
    if (report?.error || cls.error) return "failed";
    const reports = (report?.data ?? []) as { video_homework: boolean | null; created_by: string | null }[];
    if (extra || reports.some((row) => row.video_homework === true)) return "assigned";
    const teacherId = reports.find((row) => row.created_by)?.created_by ?? (cls.data?.teacher_id as string | null | undefined) ?? userId;
    const { error } = await db.from("video_homework_extra_issues").insert({ tenant_id: tenantId, class_id: key.classId,
      student_id: key.studentId, homework_date: key.date, teacher_id: teacherId, issued_by: userId, kept: true });
    if (error) return error.code === "23505" ? "assigned" : "failed";
    // 넣은 순간 남긴다 — 뒤의 기록 지우기·반려가 실패해도 이 줄이 생긴 사실은 감사로그에 있어야 한다(재리뷰 2026-10-13).
    await logAction({ action: "lesson_report_video_homework_issue", targetType: "video_homework", targetLabel: null,
      metadata: { ...meta, classId: key.classId, studentId: key.studentId, homeworkDate: key.date, teacherId, kept: true } });
    return "kept";
  } catch {
    return "failed";
  }
}

/**
 * 숙제없음 수업일에 영상을 붙이려고 **방금 남긴 줄**을, 배정이 저장되지 않았을 때 거둔다(원장 2026-10-22 — 이 배정은 영상이 붙은 칸만 만든다:
 * 줄만 남으면 장부에 없던 '미확인' 칸이 생긴다). 그사이 그 숙제일에 검사 기록이나 영상(손 배정 · 올리기 사이트에서 고름)이 생겼으면 그대로 둔다.
 * 🔴 검사 기록 칸에서 남긴 줄(`keepMarkOnlyRound` 본래 용도)에는 쓰지 말 것 — 그 줄은 칸을 지키려고 둔 것이다(video-assignment.ts).
 */
export async function releaseBlankRound(db: Db, tenantId: string, key: Key): Promise<void> {
  try {
    const [marks, videos] = await Promise.all([
      db.from("video_homework_marks").select("homework_date").eq("tenant_id", tenantId).eq("class_id", key.classId)
        .eq("student_id", key.studentId).eq("homework_date", key.date).limit(1),
      db.from("homework_video_ledger_videos").select("id").eq("tenant_id", tenantId).eq("student_id", key.studentId)
        .in("route->>classId", [key.classId]).in("route->>homeworkDate", [key.date]).limit(1),
    ]);
    if (marks.error || videos.error || marks.data?.length || videos.data?.length) return;
    const { error } = await db.from("video_homework_extra_issues").delete().eq("tenant_id", tenantId).eq("class_id", key.classId)
      .eq("student_id", key.studentId).eq("homework_date", key.date).eq("kept", true);
    if (error) return;
    await logAction({ action: "lesson_report_video_homework_issue_cancel", targetType: "video_homework", targetLabel: null,
      metadata: { classId: key.classId, studentId: key.studentId, homeworkDate: key.date, kept: true, source: "blank_lesson", reason: "assignment_failed" } });
  } catch { /* 남으면 칸이 '미확인'으로 보일 뿐이다 — 숙제 취소로 거둘 수 있다 */ }
}
